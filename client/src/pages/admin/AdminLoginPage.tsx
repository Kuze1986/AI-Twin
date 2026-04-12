import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { adminLogin } from '../../lib/api'

export function AdminLoginPage() {
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      await adminLogin(password)
      nav('/admin/identity')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-4 text-xl font-medium text-zinc-900 dark:text-zinc-50">Admin</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Password from <code className="text-xs">ADMIN_PASSWORD</code>.{' '}
        <Link className="text-violet-600 underline" to="/">
          Chat
        </Link>
      </p>
      <input
        type="password"
        className="mb-3 rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Sign in
      </button>
    </div>
  )
}
