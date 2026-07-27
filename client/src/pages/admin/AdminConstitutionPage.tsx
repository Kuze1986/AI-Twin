import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { adminFetch } from '../../lib/api'

type Constitution = {
  version: number
  title: string
  body: string
  ratified_at: string | null
}

type VersionRow = {
  version: number
  title: string
  is_active: boolean
  ratified_at: string | null
  created_at: string
}

// Minimal, safe markdown → React renderer (headings, bullets, bold, rules, paragraphs).
// Builds React nodes rather than injecting HTML, so DB content can never execute.
function renderBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>,
  )
}

function renderMarkdown(md: string): ReactNode[] {
  const out: ReactNode[] = []
  const lines = md.split('\n')
  let list: string[] = []
  const flushList = (key: string) => {
    if (list.length === 0) return
    out.push(
      <ul key={key} className="my-2 list-disc space-y-1 pl-5">
        {list.map((li, i) => (
          <li key={i}>{renderBold(li)}</li>
        ))}
      </ul>,
    )
    list = []
  }
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    if (line.startsWith('### ')) {
      flushList(`l${idx}`)
      out.push(<h3 key={idx} className="mt-4 mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{renderBold(line.slice(4))}</h3>)
    } else if (line.startsWith('## ')) {
      flushList(`l${idx}`)
      out.push(<h2 key={idx} className="mt-6 mb-2 text-base font-bold text-zinc-900 dark:text-zinc-50">{renderBold(line.slice(3))}</h2>)
    } else if (line.startsWith('# ')) {
      flushList(`l${idx}`)
      out.push(<h1 key={idx} className="mb-2 text-lg font-bold text-zinc-900 dark:text-zinc-50">{renderBold(line.slice(2))}</h1>)
    } else if (line === '---') {
      flushList(`l${idx}`)
      out.push(<hr key={idx} className="my-4 border-zinc-200 dark:border-zinc-800" />)
    } else if (line.startsWith('- ')) {
      list.push(line.slice(2))
    } else if (line.trim() === '') {
      flushList(`l${idx}`)
    } else {
      flushList(`l${idx}`)
      out.push(<p key={idx} className="my-2 leading-relaxed">{renderBold(line)}</p>)
    }
  })
  flushList('l-end')
  return out
}

export function AdminConstitutionPage() {
  const [active, setActive] = useState<Constitution | null>(null)
  const [history, setHistory] = useState<VersionRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const a = (await adminFetch('/constitution')) as { constitution: Constitution }
        setActive(a.constitution)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Load failed')
      } finally {
        setLoading(false)
      }
      try {
        const h = (await adminFetch('/constitution/history')) as { versions: VersionRow[] }
        setHistory(h.versions)
      } catch {
        /* history is best-effort */
      }
    })()
  }, [])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Constitution</h1>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          Read-only — foundational, amendable only by Brandon
        </span>
      </div>

      {loading && <p className="text-sm text-zinc-500">Loading…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {active && (
        <>
          <div className="mb-3 text-xs text-zinc-500">
            Version {active.version}
            {active.ratified_at && ` · ratified ${new Date(active.ratified_at).toLocaleDateString()}`}
          </div>
          <article className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
            {renderMarkdown(active.body)}
          </article>
        </>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="text-xs text-violet-600 underline dark:text-violet-400"
          >
            {showHistory ? 'Hide version history' : `Version history (${history.length})`}
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {history.map((v) => (
                <li key={v.version} className="flex items-center gap-2">
                  <span className="font-mono">V{v.version}</span>
                  <span>{v.title}</span>
                  {v.is_active && (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      active
                    </span>
                  )}
                  <span className="ml-auto">{new Date(v.created_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
