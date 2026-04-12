import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { adminFetch } from '../../lib/api'

const links = [
  { to: '/admin/identity', label: 'Identity' },
  { to: '/admin/calibrate', label: 'Calibration' },
  { to: '/admin/memory', label: 'Memory' },
  { to: '/admin/sessions', label: 'Sessions' },
  { to: '/admin/modes', label: 'Modes' },
] as const

export function AdminLayout() {
  const loc = useLocation()
  const [ok, setOk] = useState<boolean | null>(null)

  useEffect(() => {
    adminFetch('/identity')
      .then(() => setOk(true))
      .catch(() => setOk(false))
  }, [])

  if (ok === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-500">
        Checking admin session…
      </div>
    )
  }
  if (!ok) {
    return <Navigate to="/admin/login" replace />
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl gap-6 px-4 py-8">
      <nav className="w-44 shrink-0 space-y-2 text-sm">
        <p className="mb-4 font-medium text-zinc-900 dark:text-zinc-50">Admin</p>
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className={`block rounded px-2 py-1 ${
              loc.pathname === l.to
                ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
            }`}
          >
            {l.label}
          </Link>
        ))}
        <Link to="/" className="mt-6 block text-violet-600 underline dark:text-violet-400">
          ← Chat
        </Link>
      </nav>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
