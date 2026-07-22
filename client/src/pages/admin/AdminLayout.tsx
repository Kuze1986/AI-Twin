import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { adminFetch } from '../../lib/api'

const links = [
  { to: '/admin/identity', label: 'Identity' },
  { to: '/admin/calibrate', label: 'Calibration' },
  { to: '/admin/memory', label: 'Memory' },
  { to: '/admin/sessions', label: 'Sessions' },
  { to: '/admin/modes', label: 'Modes' },
  { to: '/admin/peers', label: 'AI Peers' },
  { to: '/admin/tasks', label: 'Tasks' },
  { to: '/admin/inbox', label: 'Inbox' },
  { to: '/admin/sentinel', label: 'Sentinel' },
] as const

export function AdminLayout() {
  const loc = useLocation()
  const [ok, setOk] = useState<boolean | null>(null)
  const [patternCount, setPatternCount] = useState(0)
  const [inboxCount, setInboxCount] = useState(0)
  const [taskCount, setTaskCount] = useState(0)
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    adminFetch('/session')
      .then(() => {
        setOk(true)
        adminFetch('/sentinel/pattern-count')
          .then((d) => setPatternCount((d as { count: number }).count ?? 0))
          .catch(() => {})
        adminFetch('/email/pending-count')
          .then((d) => setInboxCount((d as { count: number }).count ?? 0))
          .catch(() => {})
        adminFetch('/tasks/active-count')
          .then((d) => setTaskCount((d as { count: number }).count ?? 0))
          .catch(() => {})
      })
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

  const navLinks = (
    <nav className="space-y-1 text-sm">
      <p className="mb-4 font-medium text-zinc-900 dark:text-zinc-50">Admin</p>
      {links.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          onClick={() => setNavOpen(false)}
          className={`flex items-center gap-1.5 rounded px-2 py-1 ${
            loc.pathname === l.to
              ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
              : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
          }`}
        >
          {l.label}
          {l.to === '/admin/sentinel' && patternCount > 0 && (
            <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-medium text-white">
              {patternCount}
            </span>
          )}
          {l.to === '/admin/inbox' && inboxCount > 0 && (
            <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-xs font-medium text-white">
              {inboxCount}
            </span>
          )}
          {l.to === '/admin/tasks' && taskCount > 0 && (
            <span className="rounded-full bg-sky-600 px-1.5 py-0.5 text-xs font-medium text-white">
              {taskCount}
            </span>
          )}
        </Link>
      ))}
      <Link
        to="/"
        onClick={() => setNavOpen(false)}
        className="mt-6 block text-violet-600 underline dark:text-violet-400"
      >
        ← Chat
      </Link>
    </nav>
  )

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl gap-6 px-4 py-8">
      {/* Desktop sidebar */}
      <aside className="hidden w-44 shrink-0 sm:block">{navLinks}</aside>

      {/* Mobile hamburger */}
      <div className="sm:hidden">
        <button
          type="button"
          onClick={() => setNavOpen((o) => !o)}
          className="mb-4 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
        >
          {navOpen ? '✕ Close' : '☰ Menu'}
        </button>
        {navOpen && (
          <div className="absolute left-0 top-0 z-20 min-h-screen w-48 bg-white px-4 py-8 shadow-lg dark:bg-zinc-950">
            {navLinks}
          </div>
        )}
      </div>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
