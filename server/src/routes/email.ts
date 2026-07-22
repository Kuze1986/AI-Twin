import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../adminMiddleware.js'
import { emailConfigured, env } from '../env.js'
import { pollInbox, pollerStatus } from '../email/poller.js'
import { sendDraft } from '../email/send.js'
import { supabaseAdmin } from '../supabaseAdmin.js'

export const emailRouter = Router()

emailRouter.use(requireAdmin)

/** GET /status — channel configuration + last poll health. */
emailRouter.get('/status', (_req, res) => {
  res.json({
    enabled: env.EMAIL_ENABLED,
    configured: emailConfigured(),
    address: env.KUZE_EMAIL_ADDRESS,
    imap_host: env.IONOS_IMAP_HOST,
    smtp_host: env.IONOS_SMTP_HOST,
    poll_interval_ms: env.EMAIL_POLL_INTERVAL_MS,
    daily_send_cap: env.EMAIL_DAILY_SEND_CAP,
    ...pollerStatus(),
  })
})

/** POST /poll — trigger an inbound sweep on demand. */
emailRouter.post('/poll', async (_req, res) => {
  if (!emailConfigured()) {
    res.status(503).json({ error: { code: 'email_disabled', message: 'Email channel not configured' } })
    return
  }
  const result = await pollInbox()
  res.json(result)
})

/** GET /pending — approval queue: drafts awaiting a human + any Sentinel-refused drafts. */
emailRouter.get('/pending', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .schema('kuze')
    .from('email_messages')
    .select('*')
    .eq('direction', 'outbound')
    .in('status', ['pending_approval', 'failed'])
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json({ items: data ?? [] })
})

/** GET /pending-count — badge count of drafts awaiting approval. */
emailRouter.get('/pending-count', async (_req, res) => {
  const { count, error } = await supabaseAdmin
    .schema('kuze')
    .from('email_messages')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'outbound')
    .eq('status', 'pending_approval')

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json({ count: count ?? 0 })
})

/** GET /threads — recent conversations with latest snippet. */
emailRouter.get('/threads', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .schema('kuze')
    .from('email_threads')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100)

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json({ items: data ?? [] })
})

/** GET /threads/:id — full message list for a thread. */
emailRouter.get('/threads/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .schema('kuze')
    .from('email_messages')
    .select('*')
    .eq('thread_id', req.params.id)
    .order('created_at', { ascending: true })

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json({ items: data ?? [] })
})

const approveSchema = z.object({ body_text: z.string().min(1).max(50_000).optional() })

/**
 * POST /messages/:id/approve — send a pending draft via IONOS SMTP.
 * Optionally overrides the body with an edited version. This is the human "send" gate:
 * nothing leaves the mailbox without an admin approving it here.
 */
emailRouter.post('/messages/:id/approve', async (req, res) => {
  if (!emailConfigured()) {
    res.status(503).json({ error: { code: 'email_disabled', message: 'Email channel not configured' } })
    return
  }

  const parsed = approveSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }

  const { data: msg, error: mErr } = await supabaseAdmin
    .schema('kuze')
    .from('email_messages')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle()

  if (mErr || !msg) {
    res.status(404).json({ error: { code: 'not_found', message: 'Draft not found' } })
    return
  }
  if (msg.direction !== 'outbound' || (msg.status !== 'pending_approval' && msg.status !== 'failed')) {
    res.status(409).json({ error: { code: 'invalid_state', message: `Cannot send a message in status "${msg.status}"` } })
    return
  }

  const result = await sendDraft(msg, parsed.data.body_text)
  if (result.ok) {
    res.json({ ok: true, message_id: result.messageId })
    return
  }

  const httpStatus = result.code === 'daily_cap' ? 429 : result.code === 'suppressed' ? 409 : 502
  res.status(httpStatus).json({ error: { code: result.code, message: result.message } })
})

/** POST /messages/:id/discard — drop a draft without sending. */
emailRouter.post('/messages/:id/discard', async (req, res) => {
  const { data: msg, error } = await supabaseAdmin
    .schema('kuze')
    .from('email_messages')
    .select('id, direction, status')
    .eq('id', req.params.id)
    .maybeSingle()

  if (error || !msg) {
    res.status(404).json({ error: { code: 'not_found', message: 'Draft not found' } })
    return
  }
  if (msg.direction !== 'outbound') {
    res.status(409).json({ error: { code: 'invalid_state', message: 'Only outbound drafts can be discarded' } })
    return
  }

  await supabaseAdmin.schema('kuze').from('email_messages')
    .update({ status: 'discarded' }).eq('id', msg.id)
  res.json({ ok: true })
})
