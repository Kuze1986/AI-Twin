// query_stripe — read-only billing metrics via a Stripe *restricted* key (read scopes only).
// Results are cached in-memory for KUZE_STRIPE_CACHE_TTL_MS keyed by op+params so the briefing
// job and a chat question in the same minute don't double-hit Stripe. Any failure surfaces as
// a specific ok:false message (constraints 2 & 4).

import Stripe from 'stripe'
import { env, stripeConfigured } from '../env.js'
import { fail, ok, type KuzeTool } from './types.js'

const SOURCE = 'query_stripe'

// Pinned API version for deterministic response shapes. Cast avoids coupling typecheck to the
// SDK's exact literal-union of accepted versions.
const STRIPE_API_VERSION = '2024-06-20'

let client: Stripe | null = null
function stripe(): Stripe {
  if (!client) {
    client = new Stripe(env.STRIPE_RESTRICTED_KEY, { apiVersion: STRIPE_API_VERSION as never })
  }
  return client
}

const cache = new Map<string, { at: number; data: unknown }>()
function cacheGet(key: string): unknown | undefined {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < env.KUZE_STRIPE_CACHE_TTL_MS) return hit.data
  return undefined
}
function cacheSet(key: string, data: unknown): void {
  cache.set(key, { at: Date.now(), data })
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === null) return fallback
  const n = Math.trunc(Number(raw))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// Normalize a subscription item's amount to a monthly figure (minor units).
function toMonthlyMinor(unitAmount: number, quantity: number, interval: string, intervalCount: number): number {
  const perCycle = unitAmount * quantity
  const months =
    interval === 'year' ? 12 * intervalCount
    : interval === 'week' ? intervalCount / (52 / 12)
    : interval === 'day' ? intervalCount / (365 / 12)
    : intervalCount // month
  return months > 0 ? perCycle / months : perCycle
}

type Op = (params: Record<string, unknown>) => Promise<unknown>

const OPS: Record<string, Op> = {
  async revenue_summary(params) {
    const days = clampInt(params.days, 1, 90, 7)
    const since = Math.floor(Date.now() / 1000) - days * 86400
    const perDay = new Map<string, { gross: number; refunds: number }>()
    let gross = 0
    let refunds = 0
    let currency = 'usd'
    for await (const ch of stripe().charges.list({ created: { gte: since }, limit: 100 })) {
      if (ch.paid && ch.status === 'succeeded') {
        gross += ch.amount
        refunds += ch.amount_refunded
        currency = ch.currency || currency
        const day = new Date(ch.created * 1000).toISOString().slice(0, 10)
        const bucket = perDay.get(day) ?? { gross: 0, refunds: 0 }
        bucket.gross += ch.amount
        bucket.refunds += ch.amount_refunded
        perDay.set(day, bucket)
      }
    }
    const series = [...perDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, v]) => ({ day, gross: v.gross / 100, refunds: v.refunds / 100 }))
    return {
      window_days: days,
      currency,
      gross: gross / 100,
      refunds: refunds / 100,
      net: (gross - refunds) / 100,
      per_day: series,
    }
  },

  async mrr_snapshot() {
    let mrrMinor = 0
    let count = 0
    let currency = 'usd'
    const byPlan = new Map<string, { count: number; mrr: number }>()
    for await (const sub of stripe().subscriptions.list({ status: 'active', limit: 100 })) {
      count += 1
      for (const item of sub.items.data) {
        const price = item.price
        if (!price?.unit_amount || !price.recurring) continue
        currency = price.currency || currency
        const monthly = toMonthlyMinor(
          price.unit_amount,
          item.quantity ?? 1,
          price.recurring.interval,
          price.recurring.interval_count ?? 1,
        )
        mrrMinor += monthly
        const label = price.nickname || (typeof price.product === 'string' ? price.product : price.id)
        const b = byPlan.get(label) ?? { count: 0, mrr: 0 }
        b.count += 1
        b.mrr += monthly / 100
        byPlan.set(label, b)
      }
    }
    return {
      active_subscriptions: count,
      currency,
      mrr: mrrMinor / 100,
      by_plan: [...byPlan.entries()].map(([plan, v]) => ({ plan, ...v })),
    }
  },

  async recent_subscriptions(params) {
    const limit = clampInt(params.limit, 1, 25, 10)
    const res = await stripe().subscriptions.list({ limit, status: 'all' })
    return {
      subscriptions: res.data.map((s) => ({
        created: new Date(s.created * 1000).toISOString(),
        status: s.status,
        customer: typeof s.customer === 'string' ? s.customer : s.customer.id,
        plan: s.items.data[0]?.price?.nickname ?? s.items.data[0]?.price?.id ?? null,
        amount: (s.items.data[0]?.price?.unit_amount ?? 0) / 100,
        currency: s.items.data[0]?.price?.currency ?? null,
      })),
    }
  },

  async failed_payments(params) {
    const days = clampInt(params.days, 1, 30, 7)
    const since = Math.floor(Date.now() / 1000) - days * 86400
    const out: unknown[] = []
    for await (const ch of stripe().charges.list({ created: { gte: since }, limit: 100 })) {
      if (ch.status === 'failed') {
        out.push({
          created: new Date(ch.created * 1000).toISOString(),
          amount: ch.amount / 100,
          currency: ch.currency,
          failure_code: ch.failure_code,
          failure_message: ch.failure_message,
          customer: typeof ch.customer === 'string' ? ch.customer : (ch.customer?.id ?? null),
        })
      }
      if (out.length >= 100) break
    }
    return { window_days: days, failed_count: out.length, failures: out }
  },

  async churn(params) {
    const days = clampInt(params.days, 1, 90, 30)
    const since = Math.floor(Date.now() / 1000) - days * 86400
    const out: unknown[] = []
    for await (const s of stripe().subscriptions.list({ status: 'canceled', limit: 100 })) {
      if ((s.canceled_at ?? 0) >= since) {
        out.push({
          canceled_at: s.canceled_at ? new Date(s.canceled_at * 1000).toISOString() : null,
          customer: typeof s.customer === 'string' ? s.customer : s.customer.id,
          plan: s.items.data[0]?.price?.nickname ?? s.items.data[0]?.price?.id ?? null,
          reason: s.cancellation_details?.reason ?? null,
          comment: s.cancellation_details?.comment ?? null,
        })
      }
      if (out.length >= 100) break
    }
    return { window_days: days, canceled_count: out.length, canceled: out }
  },

  async disputes() {
    const res = await stripe().disputes.list({ limit: 100 })
    const open = res.data.filter((d) => d.status !== 'won' && d.status !== 'lost')
    return {
      open_count: open.length,
      disputes: open.map((d) => ({
        amount: d.amount / 100,
        currency: d.currency,
        status: d.status,
        reason: d.reason,
        due_by: d.evidence_details?.due_by
          ? new Date(d.evidence_details.due_by * 1000).toISOString()
          : null,
      })),
    }
  },

  async balance() {
    const b = await stripe().balance.retrieve()
    const norm = (arr: Stripe.Balance.Available[] | Stripe.Balance.Pending[]) =>
      arr.map((x) => ({ amount: x.amount / 100, currency: x.currency }))
    return { available: norm(b.available), pending: norm(b.pending) }
  },
}

const OP_NAMES = Object.keys(OPS)

export const queryStripe: KuzeTool = {
  name: 'query_stripe',
  description:
    'Read-only Stripe billing metrics for The Shift. Pick an operation. Amounts are in major ' +
    'currency units. Operations: revenue_summary(days 1-90), mrr_snapshot(), ' +
    'recent_subscriptions(limit ≤25), failed_payments(days ≤30), churn(days ≤90), disputes(), ' +
    'balance(). State the time window for any number you report.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: OP_NAMES },
      params: { type: 'object', description: 'Operation params, e.g. { "days": 30 }' },
    },
    required: ['operation'],
  },
  async execute(input, _ctx) {
    const startedAt = Date.now()
    if (!stripeConfigured()) {
      return fail(
        'Stripe is not configured (STRIPE_RESTRICTED_KEY unset) — cannot read live billing data',
        SOURCE,
        startedAt,
      )
    }
    const { operation, params } = (input ?? {}) as { operation?: string; params?: Record<string, unknown> }
    if (!operation || !OPS[operation]) {
      return fail(
        `unknown operation "${operation ?? ''}"; valid operations: ${OP_NAMES.join(', ')}`,
        SOURCE,
        startedAt,
      )
    }
    const cacheKey = `${operation}:${JSON.stringify(params ?? {})}`
    const cached = cacheGet(cacheKey)
    if (cached !== undefined) return ok(cached, SOURCE, startedAt)
    try {
      const data = await OPS[operation](params ?? {})
      cacheSet(cacheKey, data)
      return ok(data, SOURCE, startedAt)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return fail(`stripe operation "${operation}" failed: ${msg}`, SOURCE, startedAt)
    }
  },
}
