import { Router } from 'express'
import { z } from 'zod'
import type { AuthedRequest } from '../authMiddleware.js'
import { requireUserAuth } from '../authMiddleware.js'
import { supabaseAdmin } from '../supabaseAdmin.js'

const modeEnum = z.enum(['default', 'sales', 'ops', 'outreach', 'debrief'])

export const sessionsRouter = Router()

sessionsRouter.get('/:id/messages', requireUserAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId
  const { data: sess, error: se } = await supabaseAdmin
    .from('chat_sessions')
    .select('user_id')
    .eq('id', req.params.id)
    .maybeSingle()
  if (se || !sess) {
    res.status(404).json({ error: { code: 'not_found', message: 'Session not found' } })
    return
  }
  if (sess.user_id !== userId) {
    res.status(403).json({ error: { code: 'forbidden', message: 'Not your session' } })
    return
  }
  const { data, error } = await supabaseAdmin
    .from('twin_memory')
    .select('id, role, content, created_at')
    .eq('session_id', req.params.id)
    .order('created_at', { ascending: true })
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json(data ?? [])
})

// ── Search ────────────────────────────────────────────────────────────────────

sessionsRouter.get('/search', requireUserAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) {
    res.status(400).json({ error: { code: 'validation', message: 'Query q is required' } })
    return
  }
  const limit = Math.min(Number(req.query.limit ?? 20), 50)
  const offset = Math.max(Number(req.query.offset ?? 0), 0)

  // Find sessions owned by this user
  const { data: userSessions } = await supabaseAdmin
    .from('chat_sessions')
    .select('id')
    .eq('user_id', userId)

  const sessionIds = (userSessions ?? []).map((s: { id: string }) => s.id)
  if (sessionIds.length === 0) {
    res.json({ items: [], total: 0 })
    return
  }

  const { data, error, count } = await supabaseAdmin
    .from('twin_memory')
    .select('id, session_id, role, content, created_at', { count: 'exact' })
    .in('session_id', sessionIds)
    .ilike('content', `%${q}%`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }

  const items = (data ?? []).map((r: { id: string; session_id: string; role: string; content: string; created_at: string }) => ({
    id: r.id,
    session_id: r.session_id,
    role: r.role,
    snippet: r.content.slice(0, 200),
    created_at: r.created_at,
  }))

  res.json({ items, total: count ?? 0 })
})

// ── Export ────────────────────────────────────────────────────────────────────

sessionsRouter.get('/:id/export', requireUserAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId
  const format = req.query.format === 'txt' ? 'txt' : 'json'

  const { data: sess } = await supabaseAdmin
    .from('chat_sessions')
    .select('user_id, mode, created_at')
    .eq('id', req.params.id)
    .maybeSingle()

  if (!sess) {
    res.status(404).json({ error: { code: 'not_found', message: 'Session not found' } })
    return
  }
  if (sess.user_id !== userId) {
    res.status(403).json({ error: { code: 'forbidden', message: 'Not your session' } })
    return
  }

  const { data, error } = await supabaseAdmin
    .from('twin_memory')
    .select('role, content, created_at')
    .eq('session_id', req.params.id)
    .order('created_at', { ascending: true })

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }

  const messages = data ?? []

  if (format === 'txt') {
    const txt = messages
      .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="session-${req.params.id.slice(0, 8)}.txt"`)
    res.send(txt)
  } else {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="session-${req.params.id.slice(0, 8)}.json"`)
    res.json(messages)
  }
})

// ── Ratings ───────────────────────────────────────────────────────────────────

sessionsRouter.post('/:sessionId/messages/:messageId/rate', requireUserAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId
  const { sessionId, messageId } = req.params

  const parsed = z.object({ rating: z.union([z.literal(1), z.literal(-1)]), note: z.string().max(500).optional() }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }

  const { data: sess } = await supabaseAdmin
    .from('chat_sessions')
    .select('user_id')
    .eq('id', sessionId)
    .maybeSingle()

  if (!sess || sess.user_id !== userId) {
    res.status(403).json({ error: { code: 'forbidden', message: 'Not your session' } })
    return
  }

  const { error } = await supabaseAdmin
    .from('message_ratings')
    .upsert(
      { message_id: messageId, session_id: sessionId, user_id: userId, rating: parsed.data.rating, note: parsed.data.note ?? null },
      { onConflict: 'message_id,user_id' },
    )

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json({ ok: true })
})

sessionsRouter.post('/', requireUserAuth, async (req, res) => {
  const parsed = z.object({ mode: modeEnum }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }
  const userId = (req as AuthedRequest).userId
  const { data, error } = await supabaseAdmin
    .from('chat_sessions')
    .insert({
      user_id: userId,
      mode: parsed.data.mode,
      last_activity_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !data) {
    res.status(500).json({ error: { code: 'db_error', message: error?.message ?? 'insert failed' } })
    return
  }
  res.json({ session_id: data.id })
})
