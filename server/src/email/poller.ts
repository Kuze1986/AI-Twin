import { emailConfigured } from '../env.js'
import { fetchInbound, markSeen } from './ionosClient.js'
import { processInbound } from './processor.js'

let running = false
let lastPollAt: string | null = null
let lastError: string | null = null

export interface PollResult {
  ran: boolean
  fetched: number
  ingested: number
  errors: number
  recover: boolean
}

export interface PollOptions {
  /**
   * Re-scan recent mail (seen + unseen) so messages previously marked \Seen before a failed
   * DB ingest can still be recovered. Message-ID unique index dedupes already-stored rows.
   */
  recover?: boolean
}

/**
 * One inbound sweep: fetch mail, ingest + draft replies for anything new.
 * Guarded so overlapping ticks (or a manual trigger during a scheduled tick) never
 * run concurrently against the mailbox.
 *
 * \Seen is applied only after processInbound succeeds (or reports a duplicate), never before.
 */
export async function pollInbox(options: PollOptions = {}): Promise<PollResult> {
  const recover = Boolean(options.recover)
  if (!emailConfigured()) return { ran: false, fetched: 0, ingested: 0, errors: 0, recover }
  if (running) return { ran: false, fetched: 0, ingested: 0, errors: 0, recover }

  running = true
  let fetched = 0
  let ingested = 0
  let errors = 0
  const okUids: number[] = []

  try {
    const emails = await fetchInbound(
      recover ? { unseenOnly: false, sinceDays: 14, limit: 50 } : { unseenOnly: true, limit: 25 },
    )
    fetched = emails.length
    for (const email of emails) {
      try {
        const isNew = await processInbound(email)
        if (isNew) ingested += 1
        // Mark seen on success OR duplicate — both mean we should not keep re-fetching.
        if (Number.isFinite(email.imapUid) && email.imapUid > 0) okUids.push(email.imapUid)
      } catch (e) {
        errors += 1
        console.error('[email] processing error:', (e as Error).message)
      }
    }
    if (okUids.length > 0) await markSeen(okUids)
    lastError = null
  } catch (e) {
    errors += 1
    lastError = (e as Error).message
    console.error('[email] poll failed:', lastError)
  } finally {
    running = false
    lastPollAt = new Date().toISOString()
  }

  if (ingested > 0) console.log(`[email] poll ingested ${ingested} new message(s)${recover ? ' (recover)' : ''}`)
  return { ran: true, fetched, ingested, errors, recover }
}

export function pollerStatus(): { lastPollAt: string | null; lastError: string | null; running: boolean } {
  return { lastPollAt, lastError, running }
}
