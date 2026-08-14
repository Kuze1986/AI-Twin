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
      <p className="nx-label nx-label--amber mb-2">Restricted</p>
      <h1 className="nx-display mb-2 text-3xl">Admin</h1>
      <p className="mb-4 text-sm text-[var(--nx-text-2)]">
        Password from <code className="nx-mono text-xs">ADMIN_PASSWORD</code>.{' '}
        <Link className="underline" to="/">
          Chat
        </Link>
      </p>
      <div className="nx-panel nx-panel--strong p-4">
        <input
          type="password"
          className="nx-input mb-3"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        {error && <p className="mb-2 text-sm text-[var(--nx-red)]">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void submit()} className="nx-btn nx-btn--primary w-full disabled:opacity-50">
          Sign in
        </button>
      </div>
    </div>
  )
}
