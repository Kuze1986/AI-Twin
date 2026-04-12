import { useState } from 'react'
import { adminFetch } from '../../lib/api'
import { adminFetchRaw } from '../../lib/adminRaw'

export function AdminCalibrationPage() {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const analyze = async () => {
    setError(null)
    setBusy(true)
    try {
      if (file) {
        const fd = new FormData()
        fd.append('text', text)
        fd.append('file', file)
        const data = (await adminFetchRaw('/calibrate/analyze', { method: 'POST', body: fd })) as {
          style_fingerprint: Record<string, unknown>
        }
        setPreview(data.style_fingerprint)
      } else {
        const data = (await adminFetch('/calibrate/analyze', {
          method: 'POST',
          body: JSON.stringify({ text }),
        })) as { style_fingerprint: Record<string, unknown> }
        setPreview(data.style_fingerprint)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analyze failed')
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!preview) return
    setError(null)
    setBusy(true)
    try {
      await adminFetch('/calibrate/apply', {
        method: 'POST',
        body: JSON.stringify({ style_fingerprint: preview }),
      })
      alert('Style fingerprint saved to identity (separate from persona).')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-medium text-zinc-900 dark:text-zinc-50">Style calibration</h1>
      <p className="mb-6 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        Paste writing samples or upload plain text / markdown. Review the JSON fingerprint, then approve to store it
        as a separate block from the core persona.
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <textarea
        className="mb-3 min-h-[200px] w-full rounded border border-zinc-300 bg-white p-3 font-mono text-sm dark:border-zinc-600 dark:bg-zinc-900"
        placeholder="Writing corpus…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <input
        type="file"
        accept=".txt,.md,.markdown,text/plain,text/markdown"
        className="mb-4 block text-sm"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void analyze()}
          className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Run analysis
        </button>
        <button
          type="button"
          disabled={busy || !preview}
          onClick={() => void apply()}
          className="rounded border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
        >
          Approve & save fingerprint
        </button>
      </div>
      {preview && (
        <pre className="mt-6 max-h-[400px] overflow-auto rounded border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-900">
          {JSON.stringify(preview, null, 2)}
        </pre>
      )}
    </div>
  )
}
