import { useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

type EmailMessage = {
  id: string
  thread_id: string | null
  direction: 'inbound' | 'outbound'
  status: string
  from_addr: string | null
  to_addr: string | null
  subject: string | null
  body_text: string | null
  snippet: string | null
  classification: string | null
  sentinel_resolution: string | null
  error: string | null
  created_at: string
  sent_at: string | null
}

type Status = {
  enabled: boolean
  configured: boolean
  address: string
  imap_host: string
  smtp_host: string
  poll_interval_ms: number
  daily_send_cap: number
  lastPollAt: string | null
  lastError: string | null
  running: boolean
}

const classColor: Record<string, string> = {
  known: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  warm: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  cold: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
}

export function AdminInboxPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [pending, setPending] = useState<EmailMessage[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStatus = async () => {
    try {
      setStatus((await adminFetch('/email/status')) as Status)
    } catch {
      /* status is best-effort */
    }
  }

  const loadPending = async () => {
    setLoading(true)
    setError(null)
    try {
      const d = (await adminFetch('/email/pending')) as { items: EmailMessage[] }
      setPending(d.items)
      setDrafts(Object.fromEntries(d.items.map((m) => [m.id, m.body_text ?? ''])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus()
    void loadPending()
  }, [])

  const flash = (msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice(null), 4000)
  }

  const poll = async (recover = false) => {
    setBusy(recover ? 'recover' : 'poll')
    setError(null)
    try {
      const r = (await adminFetch('/email/poll', {
        method: 'POST',
        body: JSON.stringify({ recover }),
      })) as { fetched: number; ingested: number; recover?: boolean }
      flash(
        recover
          ? `Recovery sweep — ${r.ingested} new of ${r.fetched} scanned.`
          : `Polled inbox — ${r.ingested} new message(s) ingested.`,
      )
      await loadPending()
      await loadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Poll failed')
    } finally {
      setBusy(null)
    }
  }

  const approve = async (m: EmailMessage) => {
    setBusy(m.id)
    setError(null)
    try {
      const body = drafts[m.id] ?? m.body_text ?? ''
      await adminFetch(`/email/messages/${m.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ body_text: body }),
      })
      flash(`Sent to ${m.to_addr}.`)
      setPending((prev) => prev.filter((x) => x.id !== m.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setBusy(null)
    }
  }

  const discard = async (m: EmailMessage) => {
    setBusy(m.id)
    setError(null)
    try {
      await adminFetch(`/email/messages/${m.id}/discard`, { method: 'POST', body: '{}' })
      setPending((prev) => prev.filter((x) => x.id !== m.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Discard failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-medium text-zinc-900 dark:text-zinc-50">Inbox</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => poll(false)}
            disabled={busy !== null || !status?.configured}
            className="rounded bg-violet-600 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            {busy === 'poll' ? 'Polling…' : 'Poll now'}
          </button>
          <button
            type="button"
            onClick={() => poll(true)}
            disabled={busy !== null || !status?.configured}
            title="Re-scan recent mail (including already-read) to recover messages missed while the DB schema was broken"
            className="rounded border border-violet-600 px-3 py-1 text-sm text-violet-700 disabled:opacity-40 dark:text-violet-300"
          >
            {busy === 'recover' ? 'Recovering…' : 'Recover recent'}
          </button>
        </div>
      </div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Approval queue for drafts Kuze prepared from {status?.address || 'his inbox'}. Nothing cold
        sends until you approve it here. Warm/known replies may auto-send when configured.
      </p>

      {status && (
        <p className="mb-3 text-xs text-zinc-500">
          Channel:{' '}
          {status.configured ? (
            <span className="text-emerald-600 dark:text-emerald-400">active</span>
          ) : status.enabled ? (
            <span className="text-amber-600">enabled but credentials incomplete</span>
          ) : (
            <span className="text-amber-600">dormant</span>
          )}
          {status.lastPollAt && ` · last poll ${new Date(status.lastPollAt).toLocaleString()}`}
          {status.running && ' · running…'}
        </p>
      )}

      {status && !status.configured && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Email channel is <strong>not active</strong>. Set <code>EMAIL_ENABLED=true</code> and the
          IONOS credentials (<code>KUZE_EMAIL_ADDRESS</code>, <code>KUZE_EMAIL_USER</code>,{' '}
          <code>KUZE_EMAIL_PASSWORD</code>) to start ingesting mail.
        </div>
      )}

      {status?.lastError && (
        <p className="mb-3 text-xs text-red-600">Last poll error: {status.lastError}</p>
      )}
      {notice && (
        <p className="mb-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {notice}
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-zinc-500">Loading…</p>}

      {!loading && pending.length === 0 && !error && (
        <p className="text-sm text-zinc-500">No drafts awaiting approval.</p>
      )}

      <div className="space-y-4">
        {pending.map((m) => {
          const refused = m.status === 'failed'
          return (
            <div
              key={m.id}
              className={`rounded border p-4 text-sm ${
                refused
                  ? 'border-red-300 dark:border-red-900'
                  : 'border-zinc-200 dark:border-zinc-800'
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  To: {m.to_addr}
                </span>
                {m.classification && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs capitalize ${
                      classColor[m.classification] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800'
                    }`}
                  >
                    {m.classification}
                  </span>
                )}
                {refused && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    Sentinel refused
                  </span>
                )}
                <span className="ml-auto text-xs text-zinc-400">
                  {new Date(m.created_at).toLocaleString()}
                </span>
              </div>

              <p className="mb-2 text-zinc-500">
                <span className="text-zinc-400">Subject:</span> {m.subject}
              </p>

              {refused && m.error && (
                <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {m.error} — review and edit before sending, or discard.
                </p>
              )}

              <textarea
                value={drafts[m.id] ?? ''}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))}
                rows={Math.min(16, Math.max(5, (drafts[m.id] ?? '').split('\n').length + 1))}
                className="w-full rounded border border-zinc-300 bg-white p-2 font-mono text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
              />

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => approve(m)}
                  disabled={busy === m.id}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
                >
                  {busy === m.id ? 'Sending…' : 'Approve & send'}
                </button>
                <button
                  type="button"
                  onClick={() => discard(m)}
                  disabled={busy === m.id}
                  className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400"
                >
                  Discard
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
