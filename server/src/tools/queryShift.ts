// query_shift — read-only access to The Shift's Postgres via a named query catalog.
// On any failure (unknown query, bad params, connection refused, timeout) it returns a
// specific ok:false message — never empty/default data (constraints 2 & 4).

import { shiftDbConfigured } from '../env.js'
import { CatalogError, SHIFT_QUERY_CATALOG, SHIFT_QUERY_NAMES } from './shiftQueries.js'
import { ShiftDbNotConfiguredError } from './shiftDb.js'
import { fail, ok, type KuzeTool } from './types.js'

const SOURCE = 'query_shift'

export const queryShift: KuzeTool = {
  name: 'query_shift',
  description:
    "Read-only metrics for The Shift (the live product). Pick a named query and pass params. " +
    'Returns aggregates only — no user PII. Queries: ' +
    'signups_summary(days 1-90), active_users(days 1-90, DAU), mode_usage(days), ' +
    'vertical_breakdown(days), quest_chain_progress(), recent_signups(limit ≤50), ' +
    'queue_health(days). Always state the time window of any number you report.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', enum: SHIFT_QUERY_NAMES },
      params: { type: 'object', description: 'Query params, e.g. { "days": 7 } or { "limit": 20 }' },
    },
    required: ['query'],
  },
  async execute(input, _ctx) {
    const startedAt = Date.now()
    if (!shiftDbConfigured()) {
      return fail(
        'shift database is not configured (SHIFT_READONLY_DATABASE_URL unset) — cannot read live Shift data',
        SOURCE,
        startedAt,
      )
    }
    const { query, params } = (input ?? {}) as { query?: string; params?: unknown }
    if (!query || typeof query !== 'string') {
      return fail('query_shift requires a "query" name', SOURCE, startedAt)
    }
    const entry = SHIFT_QUERY_CATALOG[query]
    if (!entry) {
      return fail(
        `unknown query "${query}"; valid queries: ${SHIFT_QUERY_NAMES.join(', ')}`,
        SOURCE,
        startedAt,
      )
    }
    try {
      const data = await entry.run(params)
      return ok(data, SOURCE, startedAt)
    } catch (e) {
      if (e instanceof CatalogError) return fail(e.message, SOURCE, startedAt)
      if (e instanceof ShiftDbNotConfiguredError) return fail(e.message, SOURCE, startedAt)
      const msg = e instanceof Error ? e.message : String(e)
      return fail(`shift query "${query}" failed: ${msg}`, SOURCE, startedAt)
    }
  },
}
