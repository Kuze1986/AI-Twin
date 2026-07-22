import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminFetch } from '../../lib/api'

type Task = {
  id: string
  title: string
  type: 'outreach_campaign' | 'follow_up' | 'custom'
  goal: string
  status: string
  result: { drafted?: number; failed?: number; total?: number; output?: string } | null
  error: string | null
  created_at: string
}

type TaskItem = {
  id: string
  contact_email: string
  contact_name: string | null
  contact_company: string | null
  status: string
  error: string | null
}

const statusColor: Record<string, string> = {
  queued: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  running: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  awaiting_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500',
}

const TASK_TYPES = [
  { value: 'outreach_campaign', label: 'Outreach campaign' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'custom', label: 'Custom (text output)' },
] as const

export function AdminTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [items, setItems] = useState<Record<string, TaskItem[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  // Create form
  const [title, setTitle] = useState('')
  const [type, setType] = useState<Task['type']>('outreach_campaign')
  const [goal, setGoal] = useState('')
  const [leadsText, setLeadsText] = useState('')

  const isOutreach = type === 'outreach_campaign' || type === 'follow_up'

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const d = (await adminFetch('/tasks')) as { items: Task[] }
      setTasks(d.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const flash = (m: string) => {
    setNotice(m)
    window.setTimeout(() => setNotice(null), 4000)
  }

  const toggle = async (task: Task) => {
    if (expanded === task.id) {
      setExpanded(null)
      return
    }
    setExpanded(task.id)
    if (!items[task.id]) {
      try {
        const d = (await adminFetch(`/tasks/${task.id}`)) as { items: TaskItem[] }
        setItems((prev) => ({ ...prev, [task.id]: d.items }))
      } catch {
        /* item load is best-effort */
      }
    }
  }

  const create = async () => {
    setBusy('create')
    setError(null)
    try {
      const body: Record<string, unknown> = { title, type, goal }
      if (isOutreach) body.leads_text = leadsText
      const r = (await adminFetch('/tasks', { method: 'POST', body: JSON.stringify(body) })) as {
        lead_count: number
      }
      flash(
        isOutreach
          ? `Task queued for ${r.lead_count} lead(s). Kuze will draft into the Inbox for approval.`
          : 'Task queued.',
      )
      setTitle('')
      setGoal('')
      setLeadsText('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(null)
    }
  }

  const act = async (task: Task, action: 'cancel' | 'retry') => {
    setBusy(task.id)
    setError(null)
    try {
      await adminFetch(`/tasks/${task.id}/${action}`, { method: 'POST', body: '{}' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : `${action} failed`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-medium text-zinc-900 dark:text-zinc-50">Tasks</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Send Kuze work for The Shift. Outreach tasks draft one email per lead into the{' '}
        <Link to="/admin/inbox" className="text-violet-600 underline dark:text-violet-400">
          Inbox
        </Link>{' '}
        for your approval — nothing sends without you.
      </p>

      {/* Create */}
      <div className="mb-8 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">New task</h2>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (e.g. Q3 clinic outreach)"
              className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Task['type'])}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {TASK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            placeholder={
              isOutreach
                ? 'Goal / angle for the outreach — what Kuze should accomplish and offer.'
                : 'What should Kuze produce? (e.g. "Draft a 3-sentence positioning blurb for The Shift.")'
            }
            className="w-full rounded border border-zinc-300 bg-white p-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          {isOutreach && (
            <div>
              <textarea
                value={leadsText}
                onChange={(e) => setLeadsText(e.target.value)}
                rows={5}
                placeholder={'Leads — one per line:\nemail@example.com, Name, Company\njane@clinic.com, Jane Doe, Northside Clinic'}
                className="w-full rounded border border-zinc-300 bg-white p-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
              <p className="mt-1 text-xs text-zinc-500">
                One lead per line: <code>email, name, company</code> (name and company optional).
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={create}
            disabled={busy === 'create' || !title.trim() || !goal.trim() || (isOutreach && !leadsText.trim())}
            className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy === 'create' ? 'Queuing…' : 'Queue task'}
          </button>
        </div>
      </div>

      {notice && (
        <p className="mb-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {notice}
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-zinc-500">Loading…</p>}
      {!loading && tasks.length === 0 && !error && (
        <p className="text-sm text-zinc-500">No tasks yet.</p>
      )}

      <div className="space-y-3">
        {tasks.map((task) => {
          const isOpen = expanded === task.id
          return (
            <div key={task.id} className="rounded border border-zinc-200 text-sm dark:border-zinc-800">
              <button
                type="button"
                onClick={() => toggle(task)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    statusColor[task.status] ?? 'bg-zinc-100 text-zinc-600'
                  }`}
                >
                  {task.status.replace('_', ' ')}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-zinc-900 dark:text-zinc-100">
                  {task.title}
                </span>
                <span className="shrink-0 text-xs text-zinc-400">
                  {new Date(task.created_at).toLocaleDateString()}
                </span>
                <span className="shrink-0 text-xs text-zinc-400">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="border-t border-zinc-200 px-3 pb-3 pt-2 dark:border-zinc-800">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">
                    {task.type.replace('_', ' ')}
                  </p>
                  <p className="mb-3 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{task.goal}</p>

                  {task.result?.output && (
                    <div className="mb-3 rounded bg-zinc-50 p-2 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                      <p className="mb-1 text-xs text-zinc-400">Output</p>
                      <p className="whitespace-pre-wrap">{task.result.output}</p>
                    </div>
                  )}
                  {typeof task.result?.drafted === 'number' && (
                    <p className="mb-3 text-xs text-zinc-500">
                      {task.result.drafted} drafted · {task.result.failed} failed · {task.result.total} total —{' '}
                      <Link to="/admin/inbox" className="text-violet-600 underline dark:text-violet-400">
                        review in Inbox
                      </Link>
                    </p>
                  )}
                  {task.error && <p className="mb-3 text-xs text-red-600">Error: {task.error}</p>}

                  {items[task.id] && items[task.id].length > 0 && (
                    <div className="mb-3 space-y-1">
                      {items[task.id].map((it) => (
                        <div key={it.id} className="flex items-center gap-2 text-xs">
                          <span
                            className={`rounded px-1 py-0.5 ${
                              statusColor[it.status] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800'
                            }`}
                          >
                            {it.status}
                          </span>
                          <span className="text-zinc-600 dark:text-zinc-400">
                            {it.contact_name ? `${it.contact_name} · ` : ''}
                            {it.contact_email}
                          </span>
                          {it.error && <span className="text-red-500">— {it.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {['queued', 'running', 'awaiting_approval'].includes(task.status) && (
                      <button
                        type="button"
                        onClick={() => act(task, 'cancel')}
                        disabled={busy === task.id}
                        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400"
                      >
                        Cancel
                      </button>
                    )}
                    {task.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => act(task, 'retry')}
                        disabled={busy === task.id}
                        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
