import { Router } from 'express'
import { requireAdmin } from '../adminMiddleware.js'
import { supabaseAdmin } from '../supabaseAdmin.js'

export const toolLogRouter = Router()

toolLogRouter.use(requireAdmin)

/** GET / — recent tool calls, newest first. Optional ?tool_name= and ?ok=true|false filters. */
toolLogRouter.get('/', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50))
  let q = supabaseAdmin
    .schema('kuze')
    .from('tool_call_log')
    .select('id, created_at, session_id, user_id, mode, tool_name, input, ok, output, error, duration_ms')
    .order('created_at', { ascending: false })
    .limit(limit)

  const toolName = typeof req.query.tool_name === 'string' ? req.query.tool_name : ''
  if (toolName) q = q.eq('tool_name', toolName)
  if (req.query.ok === 'true') q = q.eq('ok', true)
  if (req.query.ok === 'false') q = q.eq('ok', false)

  const { data, error } = await q
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json({ items: data ?? [] })
})

/** GET /error-count — failed calls in the last 24h, for the nav badge. */
toolLogRouter.get('/error-count', async (_req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabaseAdmin
    .schema('kuze')
    .from('tool_call_log')
    .select('id', { count: 'exact', head: true })
    .eq('ok', false)
    .gte('created_at', since)

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json({ count: count ?? 0 })
})
