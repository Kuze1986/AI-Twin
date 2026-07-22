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

/**
 * Fetch unseen messages from INBOX, parse them, and (best-effort) mark them \Seen so a
 * later poll does not re-surface them. Dedupe against already-ingested Message-IDs still
 * happens in the DB layer — this is just the first line of defense.
 */
export async function fetchUnseen(limit = 25): Promise<FetchedEmail[]> {
  const client = imapClient()
  const out: FetchedEmail[] = []

  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids = await client.search({ seen: false }, { uid: true })
      const take = (uids || []).slice(0, limit)
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

      // Mark processed messages as seen (best-effort — a failure here just means we
      // re-fetch and dedupe on Message-ID next cycle).
      try {
        await client.messageFlagsAdd(take, ['\\Seen'], { uid: true })
      } catch (e) {
        console.warn('[email] could not mark messages seen:', (e as Error).message)
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  return out
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
