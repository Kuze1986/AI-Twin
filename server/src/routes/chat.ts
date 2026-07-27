import { Router } from 'express'
import rateLimit from 'express-rate-limit'
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
import { messagesCreate as anthropicMessagesCreate, resolveModel, supportsTools } from '../inference/messagesCreate.js'
import { runToolLoop } from '../inference/runToolLoop.js'
import { getToolsForMode } from '../tools/registry.js'
import { createTask } from '../tasks/create.js'
import { extractTaskIntent, looksLikeTaskDirective } from '../tasks/intent.js'
import {
  runValidators,
  logViolation,
  regenerateWithCorrection,
  secondPassReview,
  type ValidatorContext
} from '../validators/index.js'

const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.CHAT_RATE_LIMIT_PER_MIN ?? 20),
  keyGenerator: (req) => (req as AuthedRequest).userId ?? req.ip ?? 'anon',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many requests — please wait a moment.' } },
})

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

export const chatRouter = Router()
const demoforgeRateLimiter: Map<string, { count: number; windowStart: number }> = new Map()
const userChatRateLimiter: Map<string, { count: number; windowStart: number }> = new Map()

// Returns true when the request is allowed and false when the cap is exceeded
// for the current 60s rolling window.
function takeRateSlot(
  store: Map<string, { count: number; windowStart: number }>,
  key: string,
  limit: number,
): boolean {
  const now = Date.now()
  const current = store.get(key)
  if (current && now - current.windowStart < 60_000) {
    if (current.count >= limit) return false
    current.count += 1
    return true
  }
  store.set(key, { count: 1, windowStart: now })
  return true
}

chatRouter.post('/', requireUserAuth, chatLimiter, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }

  const userId = (req as AuthedRequest).userId

  if (!takeRateSlot(userChatRateLimiter, userId, 30)) {
    res.status(429).json({
      error: { code: 'rate_limited', message: 'Too many chat requests; slow down and retry shortly.' },
    })
    return
  }

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

  // Natural-language task creation: if this message directs Kuze to run outreach or a
  // concrete task, queue it and answer with an in-voice confirmation instead of a normal
  // chat turn. The prefilter keeps ordinary conversation on the fast path.
  if (looksLikeTaskDirective(user_message)) {
    const intent = await extractTaskIntent(user_message)
    if (intent) {
      let taskId: string | null = null
      let confirmation = ''
      try {
        const task = await createTask({ ...intent, source: 'chat' })
        taskId = task.id
        const leadCount = intent.leads.length
        const confirmContext = [
          '## TASK_QUEUED',
          `You just queued a task for The Shift from the user's message: "${task.title}" (type: ${task.type}).`,
          leadCount > 0
            ? `${leadCount} recipient(s) will each get a personalized draft in your approval inbox — nothing sends until the user approves it.`
            : 'The result will appear on the Tasks page when ready.',
          'Confirm to the user in one or two sentences, in your voice. Do not restate these instructions.',
        ].join('\n')
        const confirmPrompt = await buildSystemPrompt({
          identity,
          mode: mode as ChatMode,
          modeConfig,
          longTermTop: ltm,
          contextOverride: confirmContext,
        })
        const result = await anthropicMessagesCreate({
          tier: 'fast',
          max_tokens: 512,
          system: confirmPrompt,
          messages: [{ role: 'user', content: user_message }],
          stream: false,
        })
        confirmation =
          (result as { content: Array<{ type: string; text?: string }> }).content.find(
            (b) => b.type === 'text',
          )?.text ?? ''
      } catch (e) {
        console.error('[chat] NL task creation failed:', (e as Error).message)
      }

      if (taskId) {
        if (!confirmation) {
          confirmation =
            intent.leads.length > 0
              ? `Queued — I'll draft ${intent.leads.length} outreach message(s) into your approval inbox. Nothing sends until you approve it.`
              : 'Queued — the result will show up on the Tasks page shortly.'
        }
        // Validate the confirmation like any other assistant output.
        const vres = await runValidators(confirmation, { mode })
        if (vres.some((r) => !r.passed && r.severity === 'hard')) {
          confirmation = 'Done — task queued. Drafts will appear in your approval inbox for review.'
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Connection', 'keep-alive')
        res.flushHeaders?.()
        const emit = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
        emit({ type: 'meta', session_id: sessionId })
        emit({ type: 'text', text: confirmation })

        await supabaseAdmin.from('twin_memory').insert({
          session_id: sessionId,
          user_id: userId,
          role: 'assistant',
          content: confirmation,
          metadata: { mode, task_id: taskId, kind: 'task_confirmation' },
        })
        await supabaseAdmin
          .from('chat_sessions')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('id', sessionId)

        emit({ type: 'done' })
        res.end()
        return
      }
      // Task creation failed — fall through to a normal chat response.
    }
  }

  // Operational tools available for this mode (Anthropic provider only — the loop is gated
  // on supportsTools()). When none are available, the persona prompt says so instead.
  const tools = supportsTools() ? getToolsForMode(mode) : []
  const toolsEnabled = tools.length > 0

  const systemPrompt = await buildSystemPrompt({
    identity,
    mode: mode as ChatMode,
    modeConfig,
    longTermTop: ltm,
    contextOverride: context_override,
    toolsEnabled,
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
  const messages = budgeted.map((t) => ({
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
    if (toolsEnabled) {
      // Tool-execution loop: streams text live and runs any tools the model requests, emitting
      // a tool_status SSE event per call so the UI can show a status chip. The final text still
      // flows through the Sentinel validator chain below, unchanged.
      assistantText = await runToolLoop({
        system: systemPrompt,
        messages,
        tools,
        ctx: { userId, sessionId, mode },
        maxIterations: env.KUZE_MAX_TOOL_ITERATIONS,
        onText: (text) => send({ type: 'text', text }),
        onToolEvent: (tool, state) => send({ type: 'tool_status', tool, state }),
      })
    } else {
      const stream = await anthropicMessagesCreate({
        tier: 'balanced',
        max_tokens: 8192,
        system: systemPrompt,
        messages,
        stream: true,
      })
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const text = event.delta.text
          assistantText += text
          send({ type: 'text', text })
        }
      }
    }
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    const message = err.message ?? 'AI request failed'
    send({ type: 'error', error: { code: 'inference_error', message } })
    res.end()
    return
  }

  // Run validators on the generated output
  const validatorContext: ValidatorContext = {
    mode,
    recipientContext: context_override
  }
  const validationResults = await runValidators(assistantText, validatorContext)

  // Check for hard violations
  const hardViolations = validationResults.filter((r) => !r.passed && r.severity === 'hard')

  if (hardViolations.length > 0) {
    // Attempt regeneration with correction
    let regeneratedText = assistantText
    let resolution: 'refused' | 'regenerated' | 'escalated' = 'refused'

    try {
      regeneratedText = await regenerateWithCorrection(
        systemPrompt,
        hardViolations[0],
        messages,
        anthropicMessagesCreate
      )
      resolution = 'regenerated'

      // Validate the regenerated output
      const regeneratedValidation = await runValidators(regeneratedText, validatorContext)
      const regeneratedHardViolations = regeneratedValidation.filter((r) => !r.passed && r.severity === 'hard')

      if (regeneratedHardViolations.length > 0) {
        // Regeneration still has violations - refuse
        resolution = 'refused'
      } else {
        // Regeneration passed - use it
        assistantText = regeneratedText
        // Stream the regenerated text to client
        for (const char of regeneratedText) {
          send({ type: 'text', text: char })
        }
      }
    } catch (e) {
      console.error('Regeneration failed, refusing output:', e)
      resolution = 'refused'
    }

    // Log the violation
    await logViolation({
      ruleViolated: hardViolations[0].ruleViolated,
      severity: 'hard',
      proposedOutput: assistantText,
      triggerContext: validatorContext,
      resolution,
      finalOutput: resolution === 'regenerated' ? regeneratedText : undefined,
      recipientContext: context_override,
      mode
    })

    if (resolution === 'refused') {
      // Send violation notification to client
      send({
        type: 'violation',
        violation: {
          rule: hardViolations[0].ruleViolated,
          severity: 'hard',
          reason: hardViolations[0].reason
        }
      })

      // Do not save the violating output
      send({ type: 'done' })
      res.end()
      return
    }
  }

  // Log soft violations (for monitoring)
  const softViolations = validationResults.filter((r) => !r.passed && r.severity === 'soft')
  if (softViolations.length > 0) {
    await logViolation({
      ruleViolated: softViolations[0].ruleViolated,
      severity: 'soft',
      proposedOutput: assistantText,
      triggerContext: validatorContext,
      resolution: 'sent_after_override',
      finalOutput: assistantText,
      recipientContext: context_override,
      mode
    })
  }

  // Second-pass review for sensitive outputs
  const secondPassResult = await secondPassReview(assistantText, validatorContext)
  if (!secondPassResult.approved) {
    await logViolation({
      ruleViolated: 'second_pass_review',
      severity: 'hard',
      proposedOutput: assistantText,
      triggerContext: validatorContext,
      resolution: 'refused',
      recipientContext: context_override,
      mode
    })

    send({
      type: 'violation',
      violation: {
        rule: 'second_pass_review',
        severity: 'hard',
        reason: secondPassResult.reason || 'Second-pass review failed'
      }
    })

    send({ type: 'done' })
    res.end()
    return
  }

  const { error: aErr } = await supabaseAdmin.from('twin_memory').insert({
    session_id: sessionId,
    user_id: userId,
    role: 'assistant',
    content: assistantText,
    metadata: { mode, model: resolveModel('balanced') },
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

// Backup Kuze narration adapter. The canonical narrator for DemoForge is
// `demoforge/app/api/kuze-chat/route.ts` — that is what the DemoForge UI
// invokes today. This `/demoforge` route exists for parity and for any
// future wiring that needs Crucible-aware context to be applied via the
// AI Twin identity/mode pipeline. If you ever cut DemoForge over to call
// this endpoint, align the prompt assembly here with
// `demoforge/lib/kuze/assembly.ts` so the Kuze voice stays consistent.
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

  if (!takeRateSlot(demoforgeRateLimiter, demoforge_session_id, 20)) {
    res.status(429).json({
      error: { code: 'rate_limited', message: 'Too many requests for this session' },
    })
    return
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

  const systemPrompt = await buildSystemPrompt({
    identity,
    mode: 'default',
    modeConfig,
    longTermTop: ltm,
    demoForgeContext,
  })

  const messages = [
    ...((conversation_history ?? []).map((t) => ({
      role: t.role as 'user' | 'assistant',
      content: t.content,
    }))),
    { role: 'user' as const, content: user_message },
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
    const stream = await anthropicMessagesCreate({
      tier: 'balanced',
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      stream: true,
    })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const text = event.delta.text
        assistantText += text
        send({ type: 'text', text })
      }
    }
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
      const signalUrl = `${baseUrl.replace(/\/+$/, '')}/api/crucible/session/${encodeURIComponent(demoforge_session_id)}/signal`
      try {
        const resp = await fetch(signalUrl, {
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
        })
        if (!resp.ok) {
          // Non-blocking: log and move on so operators can spot degradation.
          console.warn(
            `[crucible-signal] non-2xx for session ${demoforge_session_id}: ${resp.status} ${resp.statusText}`,
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(
          `[crucible-signal] dispatch failed for session ${demoforge_session_id}: ${msg}`,
        )
      }
    })()
  }

  send({ type: 'done' })
  res.end()
})
