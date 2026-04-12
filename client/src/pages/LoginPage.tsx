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
      <h1 className="mb-6 text-2xl font-medium text-zinc-900 dark:text-zinc-50">Sign in</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Access your twin.{' '}
        <Link className="text-violet-600 underline dark:text-violet-400" to="/admin/login">
          Admin
        </Link>
      </p>
      <label className="mb-2 text-sm text-zinc-700 dark:text-zinc-300">Email</label>
      <input
        className="mb-4 rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <label className="mb-2 text-sm text-zinc-700 dark:text-zinc-300">Password</label>
      <input
        className="mb-4 rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void signIn()}
          className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Sign in
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void signUp()}
          className="rounded border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
        >
          Sign up
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void magic()}
          className="rounded border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
        >
          Magic link
        </button>
      </div>
    </div>
  )
}
