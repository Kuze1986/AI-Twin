import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

type ToolCall = {
  id: string
  created_at: string
  session_id: string | null
  user_id: string | null
  mode: string | null
  tool_name: string
  input: unknown
  ok: boolean
  output: unknown
  error: string | null
  duration_ms: number
}

const TOOL_NAMES = ['query_shift', 'query_stripe', 'get_aegis_state']

function pretty(v: unknown): string {
  if (v === null || v === undefined) return '—'
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

export function AdminToolLogPage() {
  const [items, setItems] = useState<ToolCall[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toolFilter, setToolFilter] = useState('')
  const [okFilter, setOkFilter] = useState<'' | 'true' | 'false'>('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (toolFilter) qs.set('tool_name', toolFilter)
      if (okFilter) qs.set('ok', okFilter)
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      const d = (await adminFetch(`/tool-log${suffix}`)) as { items: ToolCall[] }
      setItems(d.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [toolFilter, okFilter])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Tool Call Log</h1>
        <div className="flex items-center gap-2 text-sm">
          <select
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">All tools</option>
            {TOOL_NAMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={okFilter}
            onChange={(e) => setOkFilter(e.target.value as '' | 'true' | 'false')}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">All results</option>
            <option value="true">OK only</option>
            <option value="false">Failures only</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-sm text-zinc-500">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="text-sm text-zinc-500">No tool calls logged yet.</p>
      )}

      <div className="space-y-2">
        {items.map((it) => (
          <div
            key={it.id}
            className="rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  it.ok
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                }`}
              >
                {it.ok ? 'OK' : 'FAIL'}
              </span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">{it.tool_name}</span>
              {it.mode && <span className="text-xs text-zinc-500">mode: {it.mode}</span>}
              <span className="text-xs text-zinc-500">{it.duration_ms} ms</span>
              <span className="ml-auto text-xs text-zinc-400">
                {new Date(it.created_at).toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() => setExpanded(expanded === it.id ? null : it.id)}
                className="text-xs text-violet-600 underline dark:text-violet-400"
              >
                {expanded === it.id ? 'Hide' : 'Details'}
              </button>
            </div>
            {!it.ok && it.error && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{it.error}</p>
            )}
            {expanded === it.id && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-zinc-500">Input</p>
                  <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                    {pretty(it.input)}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-zinc-500">Output</p>
                  <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                    {it.ok ? pretty(it.output) : '—'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
