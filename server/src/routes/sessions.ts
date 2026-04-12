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
