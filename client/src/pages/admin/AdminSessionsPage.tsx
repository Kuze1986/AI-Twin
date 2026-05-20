import { useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'
import { useToast } from '../../components/Toast'

type SessionRow = {
  id: string
  user_id: string
  mode: string
  created_at: string
  last_activity_at: string
  consolidated_at: string | null
  flagged_for_memory: boolean
}

type Turn = {
  id: string
  role: string
  content: string
  created_at: string
}

type SessionsResponse = {
  items: SessionRow[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 25

export function AdminSessionsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const load = (nextOffset = offset) => {
    adminFetch(`/sessions?limit=${PAGE_SIZE}&offset=${nextOffset}`)
      .then((d) => {
        // Tolerate the legacy array shape in case the deployed server is older.
        if (Array.isArray(d)) {
          setSessions(d as SessionRow[])
          setTotal((d as SessionRow[]).length)
          return
        }
        const r = d as SessionsResponse
        setSessions(r.items)
        setTotal(r.total)
      })
      .catch((e) => setError(String(e)))
  }

  useEffect(() => {
    load(offset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset])

  const view = async (id: string) => {
    setOpen(id)
    setError(null)
    try {
      const t = (await adminFetch(`/sessions/${id}/transcript`)) as Turn[]
      setTranscript(t)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed')
    }
  }

  const flag = async (id: string, flagged: boolean) => {
    try {
      await adminFetch(`/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ flagged_for_memory: flagged }),
      })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  const consolidate = async (id: string) => {
    try {
      await adminFetch(`/sessions/${id}/consolidate`, { method: 'POST', body: '{}' })
      await load()
      toast('Consolidation complete.', 'success')
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Consolidation failed', 'error')
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-medium text-zinc-900 dark:text-zinc-50">Sessions</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Browse transcripts, flag for review, or trigger memory consolidation manually.
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="mb-3 flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        <span>
          {total === 0
            ? 'No sessions'
            : `Showing ${offset + 1}–${Math.min(offset + sessions.length, total)} of ${total}`}
        </span>
        <button
          type="button"
          className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          disabled={offset === 0}
        >
          Prev
        </button>
        <button
          type="button"
          className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          disabled={offset + sessions.length >= total}
        >
          Next
        </button>
      </div>
      <ul className="space-y-2 text-sm">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center gap-2 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
          >
            <span className="font-mono text-xs text-zinc-500">{s.id.slice(0, 8)}…</span>
            <span>{s.mode}</span>
            <span className="text-zinc-500">{new Date(s.created_at).toLocaleString()}</span>
            {s.consolidated_at ? (
              <span className="text-xs text-green-600">consolidated</span>
            ) : (
              <span className="text-xs text-amber-600">pending</span>
            )}
            {s.flagged_for_memory && <span className="text-xs text-violet-600">flagged</span>}
            <button type="button" className="text-violet-600 underline" onClick={() => void view(s.id)}>
              Transcript
            </button>
            <button type="button" className="text-xs underline" onClick={() => void flag(s.id, !s.flagged_for_memory)}>
              {s.flagged_for_memory ? 'Unflag' : 'Flag'}
            </button>
            <button type="button" className="text-xs underline" onClick={() => void consolidate(s.id)}>
              Consolidate
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded bg-white p-4 dark:bg-zinc-900">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">Transcript</h2>
              <div className="flex gap-2">
                <a
                  href={`/api/sessions/${open}/export?format=json`}
                  download
                  className="text-xs text-violet-600 underline dark:text-violet-400"
                >
                  Export JSON
                </a>
                <a
                  href={`/api/sessions/${open}/export?format=txt`}
                  download
                  className="text-xs text-violet-600 underline dark:text-violet-400"
                >
                  Export TXT
                </a>
                <button type="button" className="text-sm underline" onClick={() => setOpen(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              {transcript.map((t) => (
                <div
                  key={t.id}
                  className={
                    t.role === 'user'
                      ? 'rounded bg-zinc-100 p-2 dark:bg-zinc-800'
                      : 'rounded border border-zinc-200 p-2 dark:border-zinc-700'
                  }
                >
                  <p className="text-xs text-zinc-500">{t.role}</p>
                  <p className="whitespace-pre-wrap">{t.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
