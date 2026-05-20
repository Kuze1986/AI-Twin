import { useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

type Interaction = {
  id: string
  peer_name: 'ilita' | 'stele'
  direction: 'inbound' | 'outbound'
  content: string
  exchange_id: string
  summary: string | null
  weight: number
  created_at: string
}

type InteractionsResponse = {
  items: Interaction[]
  total: number
  limit: number
  offset: number
}

type Exchange = { id: string; peer: string; messages: Interaction[]; summary: string | null }

const PAGE_SIZE = 20
const PEER_NAMES = ['ilita', 'stele'] as const

function groupByExchange(items: Interaction[]): Exchange[] {
  const map = new Map<string, Interaction[]>()
  for (const item of items) {
    if (!map.has(item.exchange_id)) map.set(item.exchange_id, [])
    map.get(item.exchange_id)!.push(item)
  }
  return Array.from(map.entries()).map(([id, messages]) => ({
    id,
    peer: messages[0]?.peer_name ?? 'unknown',
    messages: messages.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ),
    summary: messages.find((m) => m.summary)?.summary ?? null,
  }))
}

export function AdminPeersPage() {
  const [activePeer, setActivePeer] = useState<'ilita' | 'stele'>('ilita')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (peer: 'ilita' | 'stele', nextOffset = 0) => {
    setLoading(true)
    setError(null)
    try {
      const d = (await adminFetch(
        `/peers/interactions?peer=${peer}&limit=${PAGE_SIZE}&offset=${nextOffset}`,
      )) as InteractionsResponse
      setExchanges(groupByExchange(d.items))
      setTotal(d.total)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setOffset(0)
    setExpanded(null)
    void load(activePeer, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePeer])

  const changePage = (next: number) => {
    setOffset(next)
    void load(activePeer, next)
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-medium text-zinc-900 dark:text-zinc-50">AI Peers</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Exchanges between Kuze and his sibling AIs. Each entry shows inbound and outbound messages
        with extracted memory summaries.
      </p>

      <div className="mb-4 flex gap-2">
        {PEER_NAMES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setActivePeer(p)}
            className={`rounded px-3 py-1 text-sm capitalize ${
              activePeer === p
                ? 'bg-violet-600 text-white'
                : 'border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-zinc-500">Loading…</p>}

      {!loading && exchanges.length === 0 && !error && (
        <p className="text-sm text-zinc-500">No exchanges with {activePeer} yet.</p>
      )}

      <div className="space-y-3">
        {exchanges.map((ex) => {
          const first = ex.messages[0]
          const isOpen = expanded === ex.id
          return (
            <div
              key={ex.id}
              className="rounded border border-zinc-200 text-sm dark:border-zinc-800"
            >
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
                onClick={() => setExpanded(isOpen ? null : ex.id)}
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-zinc-400">
                    {ex.id.slice(0, 8)}…{' '}
                    {first ? `· ${new Date(first.created_at).toLocaleString()}` : ''}
                  </p>
                  {ex.summary ? (
                    <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">{ex.summary}</p>
                  ) : (
                    <p className="mt-0.5 truncate text-zinc-500">
                      {first?.content.slice(0, 100) ?? '(empty)'}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-zinc-400">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="border-t border-zinc-200 px-3 pb-3 pt-2 dark:border-zinc-800">
                  <div className="space-y-2">
                    {ex.messages.map((m) => (
                      <div
                        key={m.id}
                        className={
                          m.direction === 'inbound'
                            ? 'rounded bg-zinc-100 p-2 dark:bg-zinc-800'
                            : 'rounded border border-zinc-200 p-2 dark:border-zinc-700'
                        }
                      >
                        <p className="mb-1 text-xs font-medium capitalize text-zinc-500">
                          {m.direction === 'inbound' ? ex.peer : 'Kuze'}
                        </p>
                        <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                          {m.content}
                        </p>
                      </div>
                    ))}
                  </div>
                  {ex.summary && (
                    <p className="mt-2 text-xs text-zinc-500">
                      Memory:{' '}
                      <span className="text-zinc-700 dark:text-zinc-300">{ex.summary}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            type="button"
            className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
            disabled={offset === 0}
            onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))}
          >
            Prev
          </button>
          <button
            type="button"
            className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => changePage(offset + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
