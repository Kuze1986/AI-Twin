import { useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

type Violation = {
  id: string
  rule_violated: string
  severity: 'hard' | 'soft'
  proposed_output: string
  final_output: string | null
  resolution: string
  occurred_at: string
  mode: string
}

type PatternAlert = {
  id: string
  pattern_type: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  triggering_violations: string[]
  created_at: string
  status: string
}

type PaginatedResponse<T> = { items: T[]; total: number; limit: number; offset: number }

const PAGE_SIZE = 25
const SEVERITIES = ['', 'hard', 'soft'] as const

const SEVERITY_COLORS: Record<string, string> = {
  hard: 'text-red-600 dark:text-red-400',
  soft: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-700 font-semibold dark:text-red-400',
  high: 'text-red-600 dark:text-red-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-zinc-500',
}

export function AdminSentinelPage() {
  const [tab, setTab] = useState<'violations' | 'patterns'>('violations')
  const [violations, setViolations] = useState<Violation[]>([])
  const [patterns, setPatterns] = useState<PatternAlert[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [severity, setSeverity] = useState<'' | 'hard' | 'soft'>('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadViolations = async (nextOffset = 0, sev = severity) => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(nextOffset),
        ...(sev ? { severity: sev } : {}),
      })
      const d = (await adminFetch(
        `/sentinel/violations?${qs}`,
      )) as PaginatedResponse<Violation>
      setViolations(d.items)
      setTotal(d.total)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  const loadPatterns = async (nextOffset = 0) => {
    setLoading(true)
    setError(null)
    try {
      const d = (await adminFetch(
        `/sentinel/patterns?limit=${PAGE_SIZE}&offset=${nextOffset}`,
      )) as PaginatedResponse<PatternAlert>
      setPatterns(d.items)
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
    if (tab === 'violations') void loadViolations(0, severity)
    else void loadPatterns(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, severity])

  const changePage = (next: number) => {
    setOffset(next)
    if (tab === 'violations') void loadViolations(next, severity)
    else void loadPatterns(next)
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-medium text-zinc-900 dark:text-zinc-50">Sentinel</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Runtime enforcement log. Violations are individual rule breaches; patterns are recurring
        trends detected across violations.
      </p>

      <div className="mb-4 flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {(['violations', 'patterns'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`border-b-2 px-3 pb-2 text-sm capitalize ${
              tab === t
                ? 'border-violet-600 text-violet-600'
                : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'violations' && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <label className="text-zinc-600 dark:text-zinc-400">Severity</label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          >
            <option value="">All</option>
            {SEVERITIES.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-zinc-500">Loading…</p>}

      {tab === 'violations' && !loading && (
        <div className="space-y-2 text-sm">
          {violations.length === 0 && !error && (
            <p className="text-zinc-500">No violations recorded yet.</p>
          )}
          {violations.map((v) => {
            const isOpen = expanded === v.id
            return (
              <div
                key={v.id}
                className="rounded border border-zinc-200 text-sm dark:border-zinc-800"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2 text-left"
                  onClick={() => setExpanded(isOpen ? null : v.id)}
                >
                  <span className={`w-10 text-xs font-medium ${SEVERITY_COLORS[v.severity] ?? ''}`}>
                    {v.severity}
                  </span>
                  <span className="flex-1 truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">
                    {v.rule_violated}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {new Date(v.occurred_at).toLocaleString()}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && (
                  <div className="space-y-2 border-t border-zinc-200 px-3 pb-3 pt-2 text-xs dark:border-zinc-800">
                    <p>
                      <span className="text-zinc-500">Resolution:</span>{' '}
                      <span className="text-zinc-700 dark:text-zinc-300">{v.resolution}</span>
                      {v.mode && (
                        <>
                          {' · '}
                          <span className="text-zinc-500">Mode:</span>{' '}
                          <span className="text-zinc-700 dark:text-zinc-300">{v.mode}</span>
                        </>
                      )}
                    </p>
                    <div className="rounded bg-zinc-100 p-2 dark:bg-zinc-800">
                      <p className="mb-1 text-zinc-500">Proposed output</p>
                      <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                        {v.proposed_output}
                      </p>
                    </div>
                    {v.final_output && (
                      <div className="rounded border border-zinc-200 p-2 dark:border-zinc-700">
                        <p className="mb-1 text-zinc-500">Final output (after correction)</p>
                        <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                          {v.final_output}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'patterns' && !loading && (
        <div className="space-y-2 text-sm">
          {patterns.length === 0 && !error && (
            <p className="text-zinc-500">No pattern alerts recorded yet.</p>
          )}
          {patterns.map((p) => {
            const isOpen = expanded === p.id
            return (
              <div
                key={p.id}
                className="rounded border border-zinc-200 text-sm dark:border-zinc-800"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2 text-left"
                  onClick={() => setExpanded(isOpen ? null : p.id)}
                >
                  <span
                    className={`w-16 text-xs font-medium capitalize ${SEVERITY_COLORS[p.severity] ?? ''}`}
                  >
                    {p.severity}
                  </span>
                  <span className="flex-1 truncate text-zinc-700 dark:text-zinc-300">
                    {p.description}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {new Date(p.created_at).toLocaleString()}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-zinc-200 px-3 pb-3 pt-2 text-xs dark:border-zinc-800">
                    <p>
                      <span className="text-zinc-500">Type:</span>{' '}
                      <span className="font-mono text-zinc-700 dark:text-zinc-300">
                        {p.pattern_type}
                      </span>
                      {' · '}
                      <span className="text-zinc-500">Status:</span>{' '}
                      <span className="text-zinc-700 dark:text-zinc-300">{p.status}</span>
                      {' · '}
                      <span className="text-zinc-500">Triggering violations:</span>{' '}
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {p.triggering_violations?.length ?? 0}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

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
