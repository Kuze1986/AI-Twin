// Named query catalog for query_shift — the model picks a query by name and supplies
// params; there is NO freeform SQL on the default path. This eliminates injection risk and
// keeps result shapes predictable (spec §1.3). Adding a query is a one-file change here.
//
// Every query is read-only and returns aggregates or non-PII fields only. No user emails or
// names are ever exposed through the catalog (privacy note, spec §1.3).
//
// Column/table names below were verified against the live `shift` schema. Queries GROUP BY
// the real stored values (e.g. question_attempts.mode_type, player_mode_unlocks.mode_id) so
// the mode/vertical labels come straight from the data — nothing is hardcoded or guessed.

import { env } from '../env.js'
import { shiftQuery } from './shiftDb.js'

export class CatalogError extends Error {}

function clampInt(raw: unknown, name: string, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === null) return fallback
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) throw new CatalogError(`${name} must be a number`)
  const i = Math.trunc(n)
  if (i < min || i > max) throw new CatalogError(`${name} must be between ${min} and ${max}`)
  return i
}

function param(params: unknown, key: string): unknown {
  if (params && typeof params === 'object') return (params as Record<string, unknown>)[key]
  return undefined
}

export interface CatalogEntry {
  run(params: unknown): Promise<unknown>
}

export const SHIFT_QUERY_CATALOG: Record<string, CatalogEntry> = {
  signups_summary: {
    async run(params) {
      const days = clampInt(param(params, 'days'), 'days', 1, 90, 7)
      const series = await shiftQuery<{ day: string; signups: number }>(
        `select date_trunc('day', created_at)::date as day, count(*)::int as signups
         from shift.users
         where created_at >= now() - make_interval(days => $1::int)
         group by 1 order by 1`,
        [days],
      )
      const [{ total }] = await shiftQuery<{ total: number }>(
        `select count(*)::int as total from shift.users
         where created_at >= now() - make_interval(days => $1::int)`,
        [days],
      )
      const [{ prior }] = await shiftQuery<{ prior: number }>(
        `select count(*)::int as prior from shift.users
         where created_at >= now() - make_interval(days => ($1::int * 2))
           and created_at <  now() - make_interval(days => $1::int)`,
        [days],
      )
      return { window_days: days, total, prior_period_total: prior, delta: total - prior, per_day: series }
    },
  },

  active_users: {
    async run(params) {
      const days = clampInt(param(params, 'days'), 'days', 1, 90, 7)
      const per_day = await shiftQuery<{ day: string; dau: number }>(
        `select usage_date as day, count(distinct user_id)::int as dau
         from shift.daily_usage
         where usage_date >= (now() - make_interval(days => $1::int))::date
         group by 1 order by 1`,
        [days],
      )
      const [{ unique_total }] = await shiftQuery<{ unique_total: number }>(
        `select count(distinct user_id)::int as unique_total from shift.daily_usage
         where usage_date >= (now() - make_interval(days => $1::int))::date`,
        [days],
      )
      return { window_days: days, unique_total, per_day }
    },
  },

  mode_usage: {
    async run(params) {
      const days = clampInt(param(params, 'days'), 'days', 1, 90, 7)
      const rows = await shiftQuery(
        `select coalesce(mode_type, '(unknown)') as mode,
                count(*)::int as attempts,
                count(*) filter (where correct)::int as correct,
                count(distinct player_id)::int as players
         from shift.question_attempts
         where created_at >= now() - make_interval(days => $1::int)
         group by 1 order by attempts desc`,
        [days],
      )
      return { window_days: days, by_mode: rows }
    },
  },

  vertical_breakdown: {
    async run(params) {
      const days = clampInt(param(params, 'days'), 'days', 1, 90, 7)
      const rows = await shiftQuery(
        `with ov as (
           select o.id as org_id, unnest(o.verticals) as vertical
           from shift.organizations o
           where o.verticals is not null
         )
         select ov.vertical,
                count(distinct ov.org_id)::int as organizations,
                count(distinct ou.user_id)::int as members,
                count(qa.id) filter (
                  where qa.created_at >= now() - make_interval(days => $1::int)
                )::int as attempts_in_window
         from ov
         left join shift.org_users ou on ou.org_id = ov.org_id
         left join shift.players p on p.user_id = ou.user_id
         left join shift.question_attempts qa on qa.player_id = p.id
         group by ov.vertical
         order by organizations desc, members desc`,
        [days],
      )
      return { window_days: days, by_vertical: rows }
    },
  },

  quest_chain_progress: {
    async run() {
      const rows = await shiftQuery(
        `select mode_id,
                count(distinct player_id)::int as players_unlocked,
                min(unlocked_at) as first_unlocked,
                max(unlocked_at) as last_unlocked
         from shift.player_mode_unlocks
         group by mode_id order by players_unlocked desc`,
      )
      const [{ total_players }] = await shiftQuery<{ total_players: number }>(
        `select count(*)::int as total_players from shift.players`,
      )
      return { total_players, unlocks_by_mode: rows }
    },
  },

  recent_signups: {
    async run(params) {
      const limit = clampInt(param(params, 'limit'), 'limit', 1, 50, 20)
      // Non-PII columns only — no email / full_name.
      const rows = await shiftQuery(
        `select created_at, subscription_plan, subscription_tier, subscription_status,
                account_type, onboarding_completed
         from shift.users order by created_at desc limit $1::int`,
        [limit],
      )
      return { limit, signups: rows }
    },
  },

  queue_health: {
    async run(params) {
      const days = clampInt(param(params, 'days'), 'days', 1, 90, 7)
      const rows = await shiftQuery<{ status: string; sessions: number }>(
        `select coalesce(status, '(unknown)') as status, count(*)::int as sessions
         from shift.queue_sessions
         where created_at >= now() - make_interval(days => $1::int)
         group by 1 order by sessions desc`,
        [days],
      )
      const total = rows.reduce((a, r) => a + r.sessions, 0)
      const errors = rows
        .filter((r) => /error|fail/i.test(r.status))
        .reduce((a, r) => a + r.sessions, 0)
      return { window_days: days, total_runs: total, error_runs: errors, by_status: rows }
    },
  },
}

// Escape hatch — off unless KUZE_ALLOW_FREEFORM_SHIFT_SQL=true. Single SELECT, no semicolons,
// wrapped with an outer LIMIT 200, run under the readonly role with the 5s timeout.
if (env.KUZE_ALLOW_FREEFORM_SHIFT_SQL) {
  SHIFT_QUERY_CATALOG.freeform_select = {
    async run(params) {
      const raw = String(param(params, 'sql') ?? '').trim()
      if (!raw) throw new CatalogError('freeform_select requires a "sql" string')
      if (!/^select\b/i.test(raw)) throw new CatalogError('freeform_select only allows a single SELECT')
      if (raw.includes(';')) throw new CatalogError('freeform_select must not contain semicolons')
      const rows = await shiftQuery(`select * from (${raw}) _q limit 200`)
      return { rows }
    },
  }
}

export const SHIFT_QUERY_NAMES = Object.keys(SHIFT_QUERY_CATALOG)
