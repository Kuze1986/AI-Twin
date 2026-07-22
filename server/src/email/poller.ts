import { emailConfigured } from '../env.js'
import { fetchUnseen } from './ionosClient.js'
import { processInbound } from './processor.js'

let running = false
let lastPollAt: string | null = null
let lastError: string | null = null

export interface PollResult {
  ran: boolean
  fetched: number
  ingested: number
  errors: number
}

/**
 * One inbound sweep: fetch unseen mail, ingest + draft replies for anything new.
 * Guarded so overlapping ticks (or a manual trigger during a scheduled tick) never
 * run concurrently against the mailbox.
 */
export async function pollInbox(): Promise<PollResult> {
  if (!emailConfigured()) return { ran: false, fetched: 0, ingested: 0, errors: 0 }
  if (running) return { ran: false, fetched: 0, ingested: 0, errors: 0 }

  running = true
  let fetched = 0
  let ingested = 0
  let errors = 0

  try {
    const emails = await fetchUnseen()
    fetched = emails.length
    for (const email of emails) {
      try {
        const isNew = await processInbound(email)
        if (isNew) ingested += 1
      } catch (e) {
        errors += 1
        console.error('[email] processing error:', (e as Error).message)
      }
    }
    lastError = null
  } catch (e) {
    errors += 1
    lastError = (e as Error).message
    console.error('[email] poll failed:', lastError)
  } finally {
    running = false
    lastPollAt = new Date().toISOString()
  }

  if (ingested > 0) console.log(`[email] poll ingested ${ingested} new message(s)`)
  return { ran: true, fetched, ingested, errors }
}

export function pollerStatus(): { lastPollAt: string | null; lastError: string | null; running: boolean } {
  return { lastPollAt, lastError, running }
}
