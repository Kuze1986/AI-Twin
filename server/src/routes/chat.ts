import Anthropic from '@anthropic-ai/sdk'
import { Router } from 'express'
import { z } from 'zod'
import type { AuthedRequest } from '../authMiddleware.js'
import { requireUserAuth } from '../authMiddleware.js'
import { getIdentity, getModeConfig, getTopLongTermMemory } from '../data.js'
import { env } from '../env.js'
import { buildSystemPrompt } from '../promptBuilder.js'
import type { ChatMode } from '../types.js'
import { budgetHistory, type HistoryTurn } from '../tokenBudget.js'
import { supabaseAdmin } from '../supabaseAdmin.js'

const modeEnum = z.enum(['default', 'sales', 'ops', 'outreach', 'debrief'])

const bodySchema = z.object({
  session_id: z.string().uuid().optional(),
  mode: modeEnum,
  user_message: z.string().min(1).max(200_000),
  context_override: z.string().max(100_000).optional(),
})

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

export const chatRouter = Router()

chatRouter.post('/', requireUserAuth, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }

  const userId = (req as AuthedRequest).userId
  const { mode, user_message, context_override } = parsed.data
  let sessionId = parsed.data.session_id

  if (!sessionId) {
    const { data: created, error: cErr } = await supabaseAdmin
      .from('chat_sessions')
      .insert({
        user_id: userId,
        mode,
        last_activity_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (cErr || !created) {
      res.status(500).json({
        error: { code: 'db_error', message: cErr?.message ?? 'Could not create session' },
      })
      return
    }
    sessionId = created.id
  } else {
    const { data: sess, error: sErr } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, user_id, mode')
      .eq('id', sessionId)
      .maybeSingle()
    if (sErr || !sess) {
      res.status(404).json({ error: { code: 'not_found', message: 'Session not found' } })
      return
    }
    if (sess.user_id !== userId) {
      res.status(403).json({ error: { code: 'forbidden', message: 'Session does not belong to user' } })
      return
    }
    await supabaseAdmin
      .from('chat_sessions')
      .update({ mode, last_activity_at: new Date().toISOString() })
      .eq('id', sessionId)
  }

  const { error: uErr } = await supabaseAdmin.from('twin_memory').insert({
    session_id: sessionId,
    user_id: userId,
    role: 'user',
    content: user_message,
    metadata: { mode },
  })
  if (uErr) {
    res.status(500).json({ error: { code: 'db_error', message: uErr.message } })
    return
  }

  const identity = await getIdentity()
  if (!identity) {
    res.status(503).json({ error: { code: 'not_configured', message: 'Identity profile missing' } })
    return
  }

  const modeConfig = await getModeConfig(mode)
  const ltm = await getTopLongTermMemory(10)
  const systemPrompt = buildSystemPrompt({
    identity,
    mode: mode as ChatMode,
    modeConfig,
    longTermTop: ltm,
    contextOverride: context_override,
  })

  const { data: memRows, error: mErr } = await supabaseAdmin
    .from('twin_memory')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (mErr) {
    res.status(500).json({ error: { code: 'db_error', message: mErr.message } })
    return
  }

  const historyTurns: HistoryTurn[] = (memRows ?? []).map((r) => ({
    role: r.role as 'user' | 'assistant',
    content: r.content,
  }))

  const budgeted = budgetHistory(historyTurns, env.MAX_HISTORY_TOKENS)
  const messages: Anthropic.MessageParam[] = budgeted.map((t) => ({
    role: t.role,
    content: t.content,
  }))

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const send = (obj: unknown) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
  }

  send({ type: 'meta', session_id: sessionId })

  let assistantText = ''
  try {
    const stream = anthropic.messages.stream({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages,
    })
    stream.on('text', (textDelta) => {
      send({ type: 'text', text: textDelta })
    })
    assistantText = await stream.finalText()
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    const message = err.message ?? 'Claude request failed'
    send({ type: 'error', error: { code: 'claude_error', message } })
    res.end()
    return
  }

  const { error: aErr } = await supabaseAdmin.from('twin_memory').insert({
    session_id: sessionId,
    user_id: userId,
    role: 'assistant',
    content: assistantText,
    metadata: { mode, model: env.ANTHROPIC_MODEL },
  })
  if (aErr) {
    send({ type: 'error', error: { code: 'db_error', message: aErr.message } })
    res.end()
    return
  }

  await supabaseAdmin
    .from('chat_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', sessionId)

  send({ type: 'done' })
  res.end()
})
