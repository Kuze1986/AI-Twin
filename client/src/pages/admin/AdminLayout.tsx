import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { adminFetch } from '../../lib/api'

const links = [
  { to: '/admin/identity', label: 'Identity' },
  { to: '/admin/constitution', label: 'Constitution' },
  { to: '/admin/calibrate', label: 'Calibration' },
  { to: '/admin/memory', label: 'Memory' },
  { to: '/admin/sessions', label: 'Sessions' },
  { to: '/admin/modes', label: 'Modes' },
  { to: '/admin/peers', label: 'AI Peers' },
  { to: '/admin/agents', label: 'Agents' },
  { to: '/admin/tasks', label: 'Tasks' },
  { to: '/admin/inbox', label: 'Inbox' },
  { to: '/admin/tool-log', label: 'Tool Log' },
  { to: '/admin/sentinel', label: 'Sentinel' },
] as const

export function AdminLayout() {
  const loc = useLocation()
  const [ok, setOk] = useState<boolean | null>(null)
  const [patternCount, setPatternCount] = useState(0)
  const [inboxCount, setInboxCount] = useState(0)
  const [taskCount, setTaskCount] = useState(0)
  const [toolLogCount, setToolLogCount] = useState(0)
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
        adminFetch('/tool-log/error-count')
          .then((d) => setToolLogCount((d as { count: number }).count ?? 0))
          .catch(() => {})
      })
      .catch(() => setOk(false))
  }, [])

  if (ok === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--nx-text-2)]">
        <span className="nx-label flex items-center gap-2">
          <i className="nx-pulse" /> Checking admin session…
        </span>
      </div>
    )
  }
  if (!ok) {
    return <Navigate to="/admin/login" replace />
  }

  const navLinks = (
    <nav className="space-y-1 text-sm">
      <p className="nx-label nx-label--accent mb-4">Admin</p>
      {links.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          onClick={() => setNavOpen(false)}
          className={`flex items-center gap-1.5 rounded-[var(--nx-r-2)] px-2 py-1 no-underline ${
            loc.pathname === l.to
              ? 'border border-[var(--nx-accent)] bg-[rgba(0,196,232,0.08)] text-[var(--nx-accent)]'
              : 'text-[var(--nx-text-2)] hover:bg-[var(--nx-surface-2)] hover:text-[var(--nx-text)]'
          }`}
        >
          {l.label}
          {l.to === '/admin/sentinel' && patternCount > 0 && (
            <span className="nx-chip nx-chip--red !px-1.5 !py-0.5">{patternCount}</span>
          )}
          {l.to === '/admin/inbox' && inboxCount > 0 && (
            <span className="nx-chip nx-chip--cyan !px-1.5 !py-0.5">{inboxCount}</span>
          )}
          {l.to === '/admin/tasks' && taskCount > 0 && (
            <span className="nx-chip nx-chip--amber !px-1.5 !py-0.5">{taskCount}</span>
          )}
          {l.to === '/admin/tool-log' && toolLogCount > 0 && (
            <span className="nx-chip nx-chip--red !px-1.5 !py-0.5">{toolLogCount}</span>
          )}
        </Link>
      ))}
      <Link
        to="/"
        onClick={() => setNavOpen(false)}
        className="mt-6 block text-sm text-[var(--nx-accent)] underline"
      >
        ← Chat
      </Link>
    </nav>
  )

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl gap-6 px-4 py-8">
      <aside className="nx-panel hidden w-44 shrink-0 self-start p-3 sm:block">{navLinks}</aside>

      <div className="sm:hidden">
        <button type="button" onClick={() => setNavOpen((o) => !o)} className="nx-btn mb-4">
          {navOpen ? '✕ Close' : '☰ Menu'}
        </button>
        {navOpen && (
          <div className="nx-panel absolute left-0 top-0 z-20 min-h-screen w-48 px-4 py-8 shadow-lg">
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
