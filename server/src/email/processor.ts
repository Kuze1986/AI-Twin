import { env } from '../env.js'
import { getIdentity, getModeConfig, getTopLongTermMemory } from '../data.js'
import { buildSystemPrompt } from '../promptBuilder.js'
import { supabaseAdmin } from '../supabaseAdmin.js'
import type { ChatMode } from '../types.js'
import type { ValidatorContext } from '../validators/index.js'
import { generateEnforcedDraft } from './enforce.js'
import type { FetchedEmail } from './ionosClient.js'
import { sendDraft } from './send.js'

const UNSUBSCRIBE_RE = /\b(unsubscribe|opt[\s-]?out|remove me|stop emailing|do not (contact|email))\b/i

type Classification = 'known' | 'warm' | 'cold'

function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fwd?|aw|sv)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function snippetOf(text: string, len = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > len ? `${clean.slice(0, len)}…` : clean
}

/** Look up (or lazily create) the contact and derive its classification. */
async function resolveContact(email: string): Promise<{ classification: Classification; suppressed: boolean }> {
  const { data: existing } = await supabaseAdmin
    .schema('kuze')
    .from('email_contacts')
    .select('relationship, status')
    .eq('email', email)
    .maybeSingle()

  const { data: suppressed } = await supabaseAdmin
    .schema('kuze')
    .from('email_suppression')
    .select('email')
    .eq('email', email)
    .maybeSingle()

  const isSuppressed = Boolean(suppressed) || existing?.status === 'suppressed' || existing?.status === 'unsubscribed'

  if (!existing) {
    await supabaseAdmin
      .schema('kuze')
      .from('email_contacts')
      .insert({ email, relationship: 'cold', status: 'active' })
      .then(() => {}, () => {})
    return { classification: 'cold', suppressed: isSuppressed }
  }

  const classification: Classification = existing.relationship === 'known' ? 'known' : 'cold'
  return { classification, suppressed: isSuppressed }
}

/** Resolve the thread this email belongs to, creating one if needed. Returns thread id + whether Kuze has replied before. */
async function resolveThread(
  email: FetchedEmail,
  fallbackClassification: Classification,
): Promise<{ threadId: string; hasPriorOutbound: boolean }> {
  // A direct reply to something Kuze sent — attach to that message's thread.
  if (email.inReplyTo) {
    const { data: parent } = await supabaseAdmin
      .schema('kuze')
      .from('email_messages')
      .select('thread_id')
      .eq('message_id', email.inReplyTo)
      .maybeSingle()
    if (parent?.thread_id) {
      const hasPriorOutbound = await threadHasOutbound(parent.thread_id)
      return { threadId: parent.thread_id, hasPriorOutbound }
    }
  }

  const threadKey = `${email.fromAddr}::${normalizeSubject(email.subject)}`
  const { data: existing } = await supabaseAdmin
    .schema('kuze')
    .from('email_threads')
    .select('id')
    .eq('thread_key', threadKey)
    .maybeSingle()

  if (existing) {
    const hasPriorOutbound = await threadHasOutbound(existing.id)
    return { threadId: existing.id, hasPriorOutbound }
  }

  const { data: created, error } = await supabaseAdmin
    .schema('kuze')
    .from('email_threads')
    .insert({
      thread_key: threadKey,
      subject: email.subject,
      contact_email: email.fromAddr,
      classification: fallbackClassification,
      last_message_at: email.date,
    })
    .select('id')
    .single()

  if (error || !created) throw new Error(`thread insert failed: ${error?.message}`)
  return { threadId: created.id, hasPriorOutbound: false }
}

async function threadHasOutbound(threadId: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .schema('kuze')
    .from('email_messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', threadId)
    .eq('direction', 'outbound')
  return (count ?? 0) > 0
}

async function recentThreadHistory(threadId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .schema('kuze')
    .from('email_messages')
    .select('direction, from_addr, subject, body_text, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(8)
  if (!data || data.length === 0) return ''
  return data
    .map((m) => `${m.direction === 'inbound' ? m.from_addr : 'Kuze'}: ${snippetOf(m.body_text ?? '', 400)}`)
    .join('\n\n')
}

async function suppress(email: string, reason: string): Promise<void> {
  await supabaseAdmin
    .schema('kuze')
    .from('email_suppression')
    .upsert({ email, reason }, { onConflict: 'email' })
    .then(() => {}, () => {})
  await supabaseAdmin
    .schema('kuze')
    .from('email_contacts')
    .update({ status: 'unsubscribed', updated_at: new Date().toISOString() })
    .eq('email', email)
    .then(() => {}, () => {})
}

/**
 * Ingest one inbound email and, when appropriate, produce a Sentinel-cleared draft reply.
 *
 * Phase 1 behavior: nothing is ever auto-sent. Every draft lands in status
 * 'pending_approval' for a human to approve (or 'failed' if Sentinel refused it).
 * Classification is still recorded so Phase 2 can flip warm/known threads to auto-send.
 *
 * Returns true when a new inbound message was ingested (i.e. not a duplicate).
 */
export async function processInbound(email: FetchedEmail): Promise<boolean> {
  const { classification: contactClass, suppressed } = await resolveContact(email.fromAddr)
  const { threadId, hasPriorOutbound } = await resolveThread(email, contactClass)

  const classification: Classification =
    contactClass === 'known' ? 'known' : hasPriorOutbound ? 'warm' : 'cold'

  // Insert inbound; unique index on message_id dedupes re-fetched mail.
  const { data: inserted, error: inErr } = await supabaseAdmin
    .schema('kuze')
    .from('email_messages')
    .insert({
      thread_id: threadId,
      direction: 'inbound',
      status: 'received',
      message_id: email.messageId,
      in_reply_to: email.inReplyTo,
      imap_uid: email.imapUid,
      from_addr: email.fromAddr,
      to_addr: email.toAddr,
      cc_addr: email.ccAddr,
      subject: email.subject,
      body_text: email.bodyText,
      body_html: email.bodyHtml,
      snippet: snippetOf(email.bodyText),
      classification,
    })
    .select('id')
    .maybeSingle()

  if (inErr) {
    // 23505 = unique violation → already ingested this Message-ID. Not an error worth surfacing.
    if ((inErr as { code?: string }).code === '23505') return false
    throw new Error(`inbound insert failed: ${inErr.message}`)
  }
  if (!inserted) return false

  await supabaseAdmin
    .schema('kuze')
    .from('email_threads')
    .update({ last_message_at: email.date, classification })
    .eq('id', threadId)
    .then(() => {}, () => {})

  // Honor unsubscribe requests immediately and do not draft a reply.
  if (UNSUBSCRIBE_RE.test(email.bodyText) || UNSUBSCRIBE_RE.test(email.subject)) {
    await suppress(email.fromAddr, 'inbound_unsubscribe')
    console.log('[email] suppressed', email.fromAddr, '(unsubscribe request)')
    return true
  }

  if (suppressed) {
    console.log('[email] inbound from suppressed address, no draft:', email.fromAddr)
    return true
  }

  await draftReply({ email, threadId, classification })
  return true
}

async function draftReply(args: {
  email: FetchedEmail
  threadId: string
  classification: Classification
}): Promise<void> {
  const { email, threadId, classification } = args

  const identity = await getIdentity()
  if (!identity) {
    console.warn('[email] no identity configured — cannot draft reply')
    return
  }

  const mode: ChatMode = 'outreach'
  const modeConfig = await getModeConfig('outreach')
  const ltm = await getTopLongTermMemory(10)
  const history = await recentThreadHistory(threadId)

  const contextOverride = [
    '## EMAIL_REPLY_TASK',
    'You are drafting a reply from your own inbox (kuze@bioloopnexus.com) on behalf of The Shift.',
    `Sender: ${email.fromName ? `${email.fromName} <${email.fromAddr}>` : email.fromAddr}`,
    `Relationship: ${classification}`,
    `Subject: ${email.subject}`,
    history ? `\nThread so far:\n${history}` : '',
    '\nWrite ONLY the body of the reply email — no "Subject:" line, no email headers, no placeholder brackets.',
    'Sign off naturally as yourself. Keep it in your voice and appropriate to the relationship above.',
  ]
    .filter(Boolean)
    .join('\n')

  const systemPrompt = await buildSystemPrompt({
    identity,
    mode,
    modeConfig,
    longTermTop: ltm,
    contextOverride,
  })

  const context: ValidatorContext = { mode, recipientContext: email.fromAddr }

  let draft
  try {
    draft = await generateEnforcedDraft({
      systemPrompt,
      messages: [{ role: 'user', content: email.bodyText || email.subject }],
      context,
    })
  } catch (e) {
    console.error('[email] draft generation failed:', (e as Error).message)
    await insertOutbound({ email, threadId, classification, status: 'failed', body: '', resolution: 'error', error: (e as Error).message })
    return
  }

  const replySubject = /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`

  if (draft.resolution === 'refused') {
    await insertOutbound({
      email,
      threadId,
      classification,
      status: 'failed',
      body: draft.text,
      resolution: 'refused',
      error: draft.refusalReason ?? 'Sentinel refused the draft',
      subject: replySubject,
    })
    console.log('[email] draft refused by Sentinel for', email.fromAddr, '—', draft.refusalReason)
    return
  }

  const outboundId = await insertOutbound({
    email,
    threadId,
    classification,
    status: 'pending_approval',
    body: draft.text,
    resolution: draft.resolution,
    subject: replySubject,
  })

  // Hybrid autonomy: warm/known threads auto-send; cold stays in the approval queue.
  const isWarm = classification === 'warm' || classification === 'known'
  if (outboundId && isWarm && env.EMAIL_AUTOSEND_WARM) {
    const result = await sendDraft({
      id: outboundId,
      thread_id: threadId,
      to_addr: email.fromAddr,
      subject: replySubject,
      body_text: draft.text,
      in_reply_to: email.messageId,
      classification,
      status: 'pending_approval',
    })
    if (result.ok) {
      console.log(`[email] auto-sent ${classification} reply to ${email.fromAddr}`)
    } else {
      console.warn(`[email] auto-send held for ${email.fromAddr} (${result.code}) — left in queue`)
    }
    return
  }

  console.log(`[email] drafted ${classification} reply to ${email.fromAddr} (pending approval)`)
}

async function insertOutbound(args: {
  email: FetchedEmail
  threadId: string
  classification: Classification
  status: 'pending_approval' | 'failed'
  body: string
  resolution: string
  error?: string
  subject?: string
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .schema('kuze')
    .from('email_messages')
    .insert({
      thread_id: args.threadId,
      direction: 'outbound',
      status: args.status,
      in_reply_to: args.email.messageId,
      from_addr: env.KUZE_EMAIL_ADDRESS,
      to_addr: args.email.fromAddr,
      subject: args.subject ?? args.email.subject,
      body_text: args.body,
      snippet: snippetOf(args.body),
      classification: args.classification,
      sentinel_resolution: args.resolution,
      error: args.error,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[email] outbound insert failed:', error.message)
    return null
  }
  return data?.id ?? null
}
