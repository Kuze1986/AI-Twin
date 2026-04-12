import { useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

type Ltm = {
  id: string
  category: string
  summary: string
  weight: number
  source_session_id: string | null
  created_at: string
}

export function AdminMemoryPage() {
  const [rows, setRows] = useState<Ltm[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Ltm | null>(null)
  const [newRow, setNewRow] = useState({ category: 'fact', summary: '', weight: 0.5 })

  const load = () => {
    adminFetch('/long-term-memory')
      .then((d) => setRows(d as Ltm[]))
      .catch((e) => setError(String(e)))
  }

  useEffect(() => {
    load()
  }, [])

  const remove = async (id: string) => {
    if (!confirm('Delete this memory?')) return
    setError(null)
    try {
      await adminFetch(`/long-term-memory/${id}`, { method: 'DELETE' })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    setError(null)
    try {
      await adminFetch(`/long-term-memory/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          category: editing.category,
          summary: editing.summary,
          weight: editing.weight,
        }),
      })
      setEditing(null)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  const add = async () => {
    setError(null)
    try {
      await adminFetch('/long-term-memory', {
        method: 'POST',
        body: JSON.stringify(newRow),
      })
      setNewRow({ category: 'fact', summary: '', weight: 0.5 })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Add failed')
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-medium text-zinc-900 dark:text-zinc-50">Long-term memory (global)</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Top-weighted entries are injected into the system prompt. Phase 2 adds per-user overlay.
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-6 flex flex-wrap gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <select
          value={newRow.category}
          onChange={(e) => setNewRow((n) => ({ ...n, category: e.target.value }))}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
        >
          {['relationship', 'preference', 'decision', 'fact', 'context'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          className="min-w-[200px] flex-1 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          placeholder="Summary"
          value={newRow.summary}
          onChange={(e) => setNewRow((n) => ({ ...n, summary: e.target.value }))}
        />
        <input
          type="number"
          step="0.05"
          min={0}
          max={1}
          className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          value={newRow.weight}
          onChange={(e) => setNewRow((n) => ({ ...n, weight: Number(e.target.value) }))}
        />
        <button
          type="button"
          onClick={() => void add()}
          className="rounded bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Add
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="py-2 pr-2">Weight</th>
              <th className="py-2 pr-2">Category</th>
              <th className="py-2 pr-2">Summary</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-2">{r.weight}</td>
                <td className="py-2 pr-2">{r.category}</td>
                <td className="max-w-md py-2 pr-2">{r.summary}</td>
                <td className="py-2">
                  <button type="button" className="mr-2 text-violet-600 underline" onClick={() => setEditing(r)}>
                    Edit
                  </button>
                  <button type="button" className="text-red-600 underline" onClick={() => void remove(r.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded bg-white p-4 dark:bg-zinc-900">
            <h2 className="mb-2 font-medium">Edit memory</h2>
            <label className="mb-1 block text-xs">Category</label>
            <select
              value={editing.category}
              onChange={(e) => setEditing({ ...editing, category: e.target.value })}
              className="mb-2 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600"
            >
              {['relationship', 'preference', 'decision', 'fact', 'context'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="mb-1 block text-xs">Summary</label>
            <textarea
              className="mb-2 w-full rounded border border-zinc-300 p-2 dark:border-zinc-600"
              rows={4}
              value={editing.summary}
              onChange={(e) => setEditing({ ...editing, summary: e.target.value })}
            />
            <label className="mb-1 block text-xs">Weight</label>
            <input
              type="number"
              step="0.05"
              min={0}
              max={1}
              className="mb-4 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600"
              value={editing.weight}
              onChange={(e) => setEditing({ ...editing, weight: Number(e.target.value) })}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveEdit()}
                className="rounded bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Save
              </button>
              <button type="button" onClick={() => setEditing(null)} className="text-sm underline">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
