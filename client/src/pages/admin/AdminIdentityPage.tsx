import { useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

type ContextBlock = { id: string; title: string; body: string; tags?: string[] }

type Identity = {
  id: string
  twin_name: string
  persona_prompt: string
  context_blocks: ContextBlock[]
  behavioral_rules: Record<string, unknown>
  version: number
}

const newBlockId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export function AdminIdentityPage() {
  const [row, setRow] = useState<Identity | null>(null)
  const [twinName, setTwinName] = useState('')
  const [persona, setPersona] = useState('')
  const [blocks, setBlocks] = useState<ContextBlock[]>([])
  const [rulesJson, setRulesJson] = useState('{}')
  const [showRawBlocks, setShowRawBlocks] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<unknown[]>([])

  const load = () => {
    adminFetch('/identity')
      .then((d) => {
        const r = d as Identity
        setRow(r)
        setTwinName(r.twin_name)
        setPersona(
          r.persona_prompt ||
            '## WHO I AM\n\n## HOW I COMMUNICATE\n\n## WHAT I KNOW\n\n## HOW I MAKE DECISIONS\n\n## WHAT I NEVER DO\n\n## MY VOCABULARY\n',
        )
        setBlocks(Array.isArray(r.context_blocks) ? r.context_blocks : [])
        setRulesJson(JSON.stringify(r.behavioral_rules ?? {}, null, 2))
      })
      .catch((e) => setError(String(e)))
    adminFetch('/identity/history')
      .then((h) => setHistory(h as unknown[]))
      .catch(() => {})
  }

  useEffect(() => {
    load()
  }, [])

  const updateBlock = (id: string, patch: Partial<ContextBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }

  const addBlock = () => {
    setBlocks((prev) => [...prev, { id: newBlockId(), title: '', body: '', tags: [] }])
  }

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  const save = async () => {
    setError(null)
    let behavioral_rules: Record<string, unknown>
    try {
      behavioral_rules = JSON.parse(rulesJson) as Record<string, unknown>
    } catch {
      setError('behavioral_rules must be valid JSON object')
      return
    }
    const cleanedBlocks: ContextBlock[] = blocks.map((b) => ({
      id: b.id,
      title: b.title,
      body: b.body,
      tags: (b.tags ?? []).filter((t) => t.trim().length > 0),
    }))
    setSaving(true)
    try {
      const updated = (await adminFetch('/identity', {
        method: 'PUT',
        body: JSON.stringify({
          twin_name: twinName,
          persona_prompt: persona,
          context_blocks: cleanedBlocks,
          behavioral_rules,
        }),
      })) as Identity
      setRow(updated)
      setBlocks(updated.context_blocks ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-medium text-zinc-900 dark:text-zinc-50">Identity editor</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Version {row?.version ?? '—'}. Saves are confirmed server-side before UI updates.
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <label className="mb-1 block text-sm">Twin display name</label>
      <input
        className="mb-4 w-full max-w-md rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
        value={twinName}
        onChange={(e) => setTwinName(e.target.value)}
      />
      <label className="mb-1 block text-sm">Persona prompt (sections)</label>
      <textarea
        className="mb-4 min-h-[320px] w-full rounded border border-zinc-300 bg-white p-3 font-mono text-sm dark:border-zinc-600 dark:bg-zinc-900"
        value={persona}
        onChange={(e) => setPersona(e.target.value)}
      />
      <div className="mb-2 flex items-center justify-between">
        <label className="text-sm">Context blocks</label>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            className="underline"
            onClick={() => setShowRawBlocks((v) => !v)}
          >
            {showRawBlocks ? 'Hide raw JSON' : 'Show raw JSON'}
          </button>
          <button
            type="button"
            className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700"
            onClick={addBlock}
          >
            + Add block
          </button>
        </div>
      </div>
      <ul className="mb-4 space-y-3">
        {blocks.length === 0 && (
          <li className="rounded border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700">
            No context blocks yet. Click <span className="font-medium">+ Add block</span> to create one.
          </li>
        )}
        {blocks.map((b) => (
          <li
            key={b.id}
            className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <div className="mb-2 flex items-center gap-2">
              <input
                placeholder="Title"
                className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                value={b.title}
                onChange={(e) => updateBlock(b.id, { title: e.target.value })}
              />
              <button
                type="button"
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-800"
                onClick={() => removeBlock(b.id)}
              >
                Delete
              </button>
            </div>
            <textarea
              placeholder="Body"
              className="mb-2 min-h-[80px] w-full rounded border border-zinc-300 bg-white p-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              value={b.body}
              onChange={(e) => updateBlock(b.id, { body: e.target.value })}
            />
            <input
              placeholder="Tags (comma-separated, e.g. sales,outreach)"
              className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900"
              value={(b.tags ?? []).join(', ')}
              onChange={(e) =>
                updateBlock(b.id, {
                  tags: e.target.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter((t) => t.length > 0),
                })
              }
            />
            <p className="mt-1 text-[10px] text-zinc-500">id: {b.id}</p>
          </li>
        ))}
      </ul>
      {showRawBlocks && (
        <pre className="mb-4 max-h-60 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
          {JSON.stringify(blocks, null, 2)}
        </pre>
      )}
      <label className="mb-1 block text-sm">behavioral_rules (JSON)</label>
      <textarea
        className="mb-4 min-h-[120px] w-full rounded border border-zinc-300 bg-white p-3 font-mono text-sm dark:border-zinc-600 dark:bg-zinc-900"
        value={rulesJson}
        onChange={(e) => setRulesJson(e.target.value)}
      />
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>

      <h2 className="mt-10 mb-2 text-lg font-medium">Version history</h2>
      <ul className="space-y-2 text-xs text-zinc-600 dark:text-zinc-400">
        {(history as { id: string; version: number; created_at: string }[]).map((h) => (
          <li key={h.id}>
            v{h.version} — {new Date(h.created_at).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  )
}
