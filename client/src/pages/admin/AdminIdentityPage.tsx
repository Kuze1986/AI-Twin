import { useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

type Identity = {
  id: string
  twin_name: string
  persona_prompt: string
  context_blocks: { id: string; title: string; body: string; tags?: string[] }[]
  behavioral_rules: Record<string, unknown>
  version: number
}

export function AdminIdentityPage() {
  const [row, setRow] = useState<Identity | null>(null)
  const [twinName, setTwinName] = useState('')
  const [persona, setPersona] = useState('')
  const [blocksJson, setBlocksJson] = useState('[]')
  const [rulesJson, setRulesJson] = useState('{}')
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
        setBlocksJson(JSON.stringify(r.context_blocks ?? [], null, 2))
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

  const save = async () => {
    setError(null)
    let context_blocks: Identity['context_blocks']
    let behavioral_rules: Record<string, unknown>
    try {
      context_blocks = JSON.parse(blocksJson) as Identity['context_blocks']
    } catch {
      setError('context_blocks must be valid JSON array')
      return
    }
    try {
      behavioral_rules = JSON.parse(rulesJson) as Record<string, unknown>
    } catch {
      setError('behavioral_rules must be valid JSON object')
      return
    }
    setSaving(true)
    try {
      const updated = (await adminFetch('/identity', {
        method: 'PUT',
        body: JSON.stringify({
          twin_name: twinName,
          persona_prompt: persona,
          context_blocks,
          behavioral_rules,
        }),
      })) as Identity
      setRow(updated)
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
      <label className="mb-1 block text-sm">context_blocks (JSON array)</label>
      <textarea
        className="mb-4 min-h-[120px] w-full rounded border border-zinc-300 bg-white p-3 font-mono text-sm dark:border-zinc-600 dark:bg-zinc-900"
        value={blocksJson}
        onChange={(e) => setBlocksJson(e.target.value)}
      />
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
