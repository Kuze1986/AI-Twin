import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const signIn = async () => {
    setError(null)
    setBusy(true)
    const { error: e } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (e) {
      setError(e.message)
      return
    }
    nav('/')
  }

  const signUp = async () => {
    setError(null)
    setBusy(true)
    const { error: e } = await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (e) {
      setError(e.message)
      return
    }
    nav('/')
  }

  const magic = async () => {
    setError(null)
    setBusy(true)
    const { error: e } = await supabase.auth.signInWithOtp({ email })
    setBusy(false)
    if (e) {
      setError(e.message)
      return
    }
    setError(null)
    alert('Check your email for the magic link.')
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <p className="nx-label nx-label--accent mb-2">NEXUS</p>
      <h1 className="nx-display mb-2 text-4xl">Kuze</h1>
      <p className="mb-6 text-sm text-[var(--nx-text-2)]">
        Access your twin.{' '}
        <Link className="underline" to="/admin/login">
          Admin
        </Link>
      </p>
      <div className="nx-panel nx-panel--strong nx-corners p-4">
        <label className="nx-label mb-2 block">Email</label>
        <input
          className="nx-input mb-4"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <label className="nx-label mb-2 block">Password</label>
        <input
          className="nx-input mb-4"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <p className="mb-3 text-sm text-[var(--nx-red)]">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void signIn()} className="nx-btn nx-btn--primary disabled:opacity-50">
            Sign in
          </button>
          <button type="button" disabled={busy} onClick={() => void signUp()} className="nx-btn disabled:opacity-50">
            Sign up
          </button>
          <button type="button" disabled={busy} onClick={() => void magic()} className="nx-btn nx-btn--ghost disabled:opacity-50">
            Magic link
          </button>
        </div>
      </div>
    </div>
  )
}
