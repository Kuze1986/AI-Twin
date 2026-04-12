import { useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

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

export function AdminSessionsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    adminFetch('/sessions')
      .then((d) => setSessions(d as SessionRow[]))
      .catch((e) => setError(String(e)))
  }

  useEffect(() => {
    load()
  }, [])

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
      alert('Consolidation job completed.')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Consolidation failed')
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-medium text-zinc-900 dark:text-zinc-50">Sessions</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Browse transcripts, flag for review, or trigger memory consolidation manually.
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
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
            <div className="mb-2 flex justify-between">
              <h2 className="font-medium">Transcript</h2>
              <button type="button" className="text-sm underline" onClick={() => setOpen(null)}>
                Close
              </button>
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
