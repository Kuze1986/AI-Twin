import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import { env } from '../env.js'

/** A parsed inbound email, normalized to the fields Kuze's processor needs. */
export interface FetchedEmail {
  imapUid: number
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  fromAddr: string
  fromName: string | null
  toAddr: string
  ccAddr: string | null
  subject: string
  bodyText: string
  bodyHtml: string | null
  date: string
}

function imapClient(): ImapFlow {
  return new ImapFlow({
    host: env.IONOS_IMAP_HOST,
    port: env.IONOS_IMAP_PORT,
    secure: true,
    auth: { user: env.KUZE_EMAIL_USER, pass: env.KUZE_EMAIL_PASSWORD },
    logger: false,
  })
}

export interface FetchInboundOptions {
  /** Default true. When false, pull recent mail (seen + unseen) for recovery after failed ingests. */
  unseenOnly?: boolean
  /** Used when unseenOnly is false. Default 14 days. */
  sinceDays?: number
  limit?: number
}

/**
 * Fetch messages from INBOX and parse them. Does NOT mark \Seen — the poller marks UIDs
 * only after processInbound succeeds. Marking earlier stranded mail forever when DB inserts
 * failed (e.g. Invalid schema: kuze).
 */
export async function fetchInbound(options: FetchInboundOptions = {}): Promise<FetchedEmail[]> {
  const unseenOnly = options.unseenOnly ?? true
  const limit = options.limit ?? 25
  const sinceDays = options.sinceDays ?? 14
  const client = imapClient()
  const out: FetchedEmail[] = []

  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const criteria = unseenOnly
        ? { seen: false }
        : { since: new Date(Date.now() - sinceDays * 86_400_000) }
      const uids = await client.search(criteria, { uid: true })
      const take = (uids || []).slice(-limit) // most recent UIDs when recovering a window
      if (take.length === 0) return out

      for await (const msg of client.fetch(
        take,
        { uid: true, source: true },
        { uid: true },
      )) {
        if (!msg.source) continue
        const parsed = await simpleParser(msg.source)

        const from = parsed.from?.value?.[0]
        const to = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to
        const cc = Array.isArray(parsed.cc) ? parsed.cc[0] : parsed.cc

        out.push({
          imapUid: Number(msg.uid),
          messageId: parsed.messageId ?? null,
          inReplyTo: parsed.inReplyTo ?? null,
          references: normalizeRefs(parsed.references),
          fromAddr: (from?.address ?? '').toLowerCase(),
          fromName: from?.name || null,
          toAddr: to?.text ?? env.KUZE_EMAIL_ADDRESS,
          ccAddr: cc?.text ?? null,
          subject: parsed.subject ?? '(no subject)',
          bodyText: parsed.text ?? '',
          bodyHtml: typeof parsed.html === 'string' ? parsed.html : null,
          date: (parsed.date ?? new Date()).toISOString(),
        })
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  return out
}

/** @deprecated Prefer fetchInbound — kept for any callers still importing the old name. */
export async function fetchUnseen(limit = 25): Promise<FetchedEmail[]> {
  return fetchInbound({ unseenOnly: true, limit })
}

/** Mark UIDs \Seen after successful DB ingest (best-effort). */
export async function markSeen(uids: number[]): Promise<void> {
  if (uids.length === 0) return
  const client = imapClient()
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true })
    } finally {
      lock.release()
    }
  } catch (e) {
    console.warn('[email] could not mark messages seen:', (e as Error).message)
  } finally {
    await client.logout().catch(() => {})
  }
}

function normalizeRefs(refs: string | string[] | undefined): string[] {
  if (!refs) return []
  return Array.isArray(refs) ? refs : [refs]
}

export interface OutboundEmail {
  to: string
  subject: string
  text: string
  html?: string
  inReplyTo?: string | null
  references?: string[]
}

/** Send an email as kuze@bioloopnexus.com via IONOS SMTP. Returns the sent Message-ID. */
export async function sendEmail(msg: OutboundEmail): Promise<{ messageId: string }> {
  const transporter = nodemailer.createTransport({
    host: env.IONOS_SMTP_HOST,
    port: env.IONOS_SMTP_PORT,
    secure: env.IONOS_SMTP_PORT === 465,
    auth: { user: env.KUZE_EMAIL_USER, pass: env.KUZE_EMAIL_PASSWORD },
  })

  const info = await transporter.sendMail({
    from: env.KUZE_EMAIL_ADDRESS,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    inReplyTo: msg.inReplyTo ?? undefined,
    references: msg.references && msg.references.length > 0 ? msg.references : undefined,
  })

  return { messageId: info.messageId }
}

/** Lightweight connectivity probe used by the admin status endpoint. */
export async function verifyImap(): Promise<{ ok: boolean; error?: string }> {
  const client = imapClient()
  try {
    await client.connect()
    await client.logout().catch(() => {})
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
