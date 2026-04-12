import { useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

type ModeRow = {
  id: string
  mode: string
  system_injection: string
  context_block_tag: string | null
}

export function AdminModesPage() {
  const [rows, setRows] = useState<ModeRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const load = () => {
    adminFetch('/modes')
      .then((d) => setRows(d as ModeRow[]))
      .catch((e) => setError(String(e)))
  }

  useEffect(() => {
    load()
  }, [])

  const save = async (r: ModeRow) => {
    setError(null)
    setSaving(r.mode)
    try {
      await adminFetch(`/modes/${r.mode}`, {
        method: 'PUT',
        body: JSON.stringify({
          system_injection: r.system_injection,
          context_block_tag: r.context_block_tag,
        }),
      })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-medium text-zinc-900 dark:text-zinc-50">Mode configuration</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Each mode appends a system injection after the persona. Optional tag filters context_blocks (include blocks
        with that tag, or untagged blocks).
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="space-y-8">
        {rows.map((r) => (
          <div key={r.id} className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="mb-2 font-medium capitalize">{r.mode}</h2>
            <label className="mb-1 block text-xs text-zinc-500">System injection</label>
            <textarea
              className="mb-3 min-h-[100px] w-full rounded border border-zinc-300 bg-white p-2 font-mono text-sm dark:border-zinc-600 dark:bg-zinc-900"
              value={r.system_injection}
              onChange={(e) =>
                setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, system_injection: e.target.value } : x)))
              }
            />
            <label className="mb-1 block text-xs text-zinc-500">Context block tag (optional)</label>
            <input
              className="mb-3 w-full max-w-xs rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              value={r.context_block_tag ?? ''}
              onChange={(e) =>
                setRows((prev) =>
                  prev.map((x) =>
                    x.id === r.id ? { ...x, context_block_tag: e.target.value || null } : x,
                  ),
                )
              }
            />
            <button
              type="button"
              disabled={saving === r.mode}
              onClick={() => void save(r)}
              className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {saving === r.mode ? 'Saving…' : 'Save'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
