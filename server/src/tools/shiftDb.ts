// Dedicated read-only Postgres pool for The Shift's schema.
// Uses the `kuze_readonly` role via SHIFT_READONLY_DATABASE_URL — NEVER the service-role
// Supabase client. A 5s statement timeout is enforced at the role level too; we set it here
// as a belt-and-suspenders guard in case the URL points at a role without it.

import pg from 'pg'
import { env } from '../env.js'

let pool: pg.Pool | null = null

export class ShiftDbNotConfiguredError extends Error {
  constructor() {
    super('shift read-only database is not configured (SHIFT_READONLY_DATABASE_URL unset)')
    this.name = 'ShiftDbNotConfiguredError'
  }
}

function getPool(): pg.Pool {
  if (!env.SHIFT_READONLY_DATABASE_URL) throw new ShiftDbNotConfiguredError()
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.SHIFT_READONLY_DATABASE_URL,
      max: 4,
      statement_timeout: 5_000,
      query_timeout: 6_000,
      connectionTimeoutMillis: 5_000,
    })
    pool.on('error', (e) => {
      console.error('[shiftDb] idle client error:', e.message)
    })
  }
  return pool
}

/**
 * Run a parameterized read-only query against the shift schema. Throws on connection/timeout
 * errors so the caller can convert them into an explicit ToolResult failure (never a fake row).
 */
export async function shiftQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await getPool().connect()
  try {
    const res = await client.query(text, params as any[])
    return res.rows as T[]
  } finally {
    client.release()
  }
}
