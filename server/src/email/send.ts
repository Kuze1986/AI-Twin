import { env } from '../env.js'
import { supabaseAdmin } from '../supabaseAdmin.js'
import { sendEmail } from './ionosClient.js'

/** Minimal shape of an outbound `kuze.email_messages` row needed to send it. */
export interface OutboundRow {
  id: string
  thread_id: string | null
  to_addr: string | null
  subject: string | null
  body_text: string | null
  in_reply_to: string | null
  classification: string | null
  status: string
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; code: 'suppressed' | 'daily_cap' | 'send_failed'; message: string }

/**
 * Send one outbound draft through every guardrail — suppression, daily cap, CAN-SPAM
 * footer — and record the outcome on the row. Shared by the admin approve route (human
 * gate) and the processor's warm-thread auto-send, so both paths enforce identically.
 */
export async function sendDraft(row: OutboundRow, overrideBody?: string): Promise<SendResult> {
  if (!row.to_addr) {
    await markFailed(row.id, 'Missing recipient address')
    return { ok: false, code: 'send_failed', message: 'Missing recipient address' }
  }

  // Never send to an opted-out / suppressed address.
  const { data: suppressed } = await supabaseAdmin
    .schema('kuze')
    .from('email_suppression')
    .select('email')
    .eq('email', row.to_addr)
    .maybeSingle()
  if (suppressed) {
    await supabaseAdmin
      .schema('kuze')
      .from('email_messages')
      .update({ status: 'suppressed', error: 'Recipient is on the suppression list' })
      .eq('id', row.id)
    return { ok: false, code: 'suppressed', message: 'Recipient has unsubscribed / is suppressed' }
  }

  // Daily send cap (counts messages already sent today).
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const { count: sentToday } = await supabaseAdmin
    .schema('kuze')
    .from('email_messages')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'outbound')
    .eq('status', 'sent')
    .gte('sent_at', since.toISOString())
  if ((sentToday ?? 0) >= env.EMAIL_DAILY_SEND_CAP) {
    return { ok: false, code: 'daily_cap', message: `Daily send cap (${env.EMAIL_DAILY_SEND_CAP}) reached` }
  }

  let body = overrideBody ?? row.body_text ?? ''
  if (row.classification === 'cold' && env.THE_SHIFT_OUTREACH_FOOTER) {
    body = `${body}\n\n${env.THE_SHIFT_OUTREACH_FOOTER}`
  }

  const references = row.in_reply_to ? [row.in_reply_to] : undefined
  try {
    const { messageId } = await sendEmail({
      to: row.to_addr,
      subject: row.subject ?? '(no subject)',
      text: body,
      inReplyTo: row.in_reply_to,
      references,
    })

    const nowIso = new Date().toISOString()
    await supabaseAdmin
      .schema('kuze')
      .from('email_messages')
      .update({ status: 'sent', body_text: body, message_id: messageId, sent_at: nowIso, error: null })
      .eq('id', row.id)

    if (row.thread_id) {
      await supabaseAdmin
        .schema('kuze')
        .from('email_threads')
        .update({ last_message_at: nowIso })
        .eq('id', row.thread_id)
    }
    await supabaseAdmin
      .schema('kuze')
      .from('email_contacts')
      .update({ last_contacted_at: nowIso, updated_at: nowIso })
      .eq('email', row.to_addr)

    return { ok: true, messageId }
  } catch (e) {
    const message = (e as Error).message
    await markFailed(row.id, `Send failed: ${message}`)
    return { ok: false, code: 'send_failed', message }
  }
}

async function markFailed(id: string, error: string): Promise<void> {
  await supabaseAdmin
    .schema('kuze')
    .from('email_messages')
    .update({ status: 'failed', error })
    .eq('id', id)
    .then(() => {}, () => {})
}
