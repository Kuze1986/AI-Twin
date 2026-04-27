import Anthropic from '@anthropic-ai/sdk'
import { Router } from 'express'
import { z } from 'zod'
import type { AuthedRequest } from '../authMiddleware.js'
import { requireUserAuth } from '../authMiddleware.js'
import { fetchDemoForgeSessionState } from '../crucibleClient.js'
import { getIdentity, getModeConfig, getTopLongTermMemory } from '../data.js'
import { env } from '../env.js'
import { buildSystemPrompt } from '../promptBuilder.js'
import type { ChatMode, DemoForgeContext } from '../types.js'
import { budgetHistory, type HistoryTurn } from '../tokenBudget.js'
import { supabaseAdmin } from '../supabaseAdmin.js'

const modeEnum = z.enum(['default', 'sales', 'ops', 'outreach', 'debrief'])

const bodySchema = z.object({
  session_id: z.string().uuid().optional(),
  mode: modeEnum,
  user_message: z.string().min(1).max(200_000),
  context_override: z.string().max(100_000).optional(),
})

const demoForgeSchema = z.object({
  demoforge_session_id: z.string(),
  tenant_id: z.string(),
  journey_node_id: z.string(),
  kuze_mode: z.enum(['ambassador', 'insider', 'operator']),
  user_message: z.string().min(1).max(20_000),
  conversation_history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .optional(),
})

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

export const chatRouter = Router()
const demoforgeRateLimiter: Map<string, { count: number; windowStart: number }> = new Map()

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

chatRouter.post('/demoforge', async (req, res) => {
  const key = req.header('x-bioloop-key')
  if (!key || key !== env.BIOLOOP_SERVICE_KEY) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid x-bioloop-key' } })
    return
  }

  const parsed = demoForgeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }

  const {
    demoforge_session_id,
    tenant_id,
    journey_node_id,
    kuze_mode,
    user_message,
    conversation_history,
  } = parsed.data

  const now = Date.now()
  const current = demoforgeRateLimiter.get(demoforge_session_id)
  if (current && now - current.windowStart < 60_000) {
    if (current.count >= 20) {
      res.status(429).json({
        error: { code: 'rate_limited', message: 'Too many requests for this session' },
      })
      return
    }
    current.count += 1
  } else {
    demoforgeRateLimiter.set(demoforge_session_id, { count: 1, windowStart: now })
  }

  const crucibleState = await fetchDemoForgeSessionState({ sessionId: demoforge_session_id })

  const identity = await getIdentity()
  if (!identity) {
    res.status(503).json({ error: { code: 'not_configured', message: 'Identity profile missing' } })
    return
  }

  const modeConfig = await getModeConfig('ambassador')
  const ltm = await getTopLongTermMemory(10)

  const demoForgeContext: DemoForgeContext = {
    tenant_id,
    demoforge_session_id,
    journey_node_id,
    kuze_mode,
    engagement_trajectory: crucibleState?.engagement_trajectory ?? null,
    friction_points: crucibleState?.friction_points ?? [],
    recommended_pivot: crucibleState?.recommended_pivot ?? null,
    behavioral_confidence: crucibleState?.confidence,
  }

  const systemPrompt = buildSystemPrompt({
    identity,
    mode: 'ambassador',
    modeConfig,
    longTermTop: ltm,
    demoForgeContext,
  })

  const messages: Anthropic.MessageParam[] = [
    ...((conversation_history ?? []).map((t) => ({
      role: t.role,
      content: t.content,
    })) as Anthropic.MessageParam[]),
    { role: 'user', content: user_message },
  ]

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const send = (obj: unknown) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
  }

  send({ type: 'meta', session_id: demoforge_session_id })

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

  const baseUrl = process.env.CRUCIBLE_SIM_BASE_URL
  if (baseUrl) {
    void (async () => {
      try {
        await fetch(
          `${baseUrl.replace(/\/+$/, '')}/api/crucible/session/${encodeURIComponent(demoforge_session_id)}/signal`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-bioloop-key': env.CRUCIBLE_SIM_API_KEY,
            },
            body: JSON.stringify({
              tenant_id,
              kuze_mode,
              journey_node_id,
              signals: [
                {
                  signal_type: 'kuze_response',
                  value: assistantText.length,
                  timestamp: new Date().toISOString(),
                  source: 'kuze_adaptation',
                },
              ],
            }),
          },
        )
      } catch {
        // Intentionally silent; signal dispatch must never break response flow.
      }
    })()
  }

  send({ type: 'done' })
  res.end()
})
