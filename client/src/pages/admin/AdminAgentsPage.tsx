import { useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

type Agent = {
  id: string
  agent_key: string
  name: string
  role: string
  mission: string
  charter: string
  tool_allowlist: string[]
  guardrails: string[]
  autonomy: 'propose' | 'draft' | 'execute'
  status: 'draft' | 'pending_review' | 'active' | 'paused' | 'retired'
  model_tier: string
  max_iterations: number
  daily_run_cap: number
  governance_verdict: string | null
  governance_notes: string | null
  created_by: string
  created_at: string
}

type Team = {
  id: string
  team_key: string
  name: string
  mission: string
  status: string
}

type Run = {
  id: string
  agent_id: string | null
  team_id: string | null
  objective: string
  status: string
  iterations: number
  tools_used: string[]
  started_at: string
  finished_at: string | null
}

type RunDetail = {
  run: Run & { output: string | null; error: string | null; transcript: unknown }
  messages: Array<{ id: string; from_agent: string; to_agent: string; kind: string; content: string }>
  audits: Array<{ id: string; auditor: string; verdict: string; summary: string | null }>
  member_runs: Array<{ id: string; objective: string; status: string; output: string | null }>
}

const statusColor: Record<string, string> = {
  draft: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  pending_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  paused: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400',
  retired: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  running: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  refused: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

const autonomyBlurb: Record<Agent['autonomy'], string> = {
  propose: 'Recommends only',
  draft: 'Produces artifacts for approval',
  execute: 'Runs its tools unattended',
}

function Chip({ value }: { value: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${statusColor[value] ?? statusColor.draft}`}>
      {value.replace(/_/g, ' ')}
    </span>
  )
}

export function AdminAgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  // Spawn form
  const [description, setDescription] = useState('')

  // Launch-as-campaign form (belongs to whichever run is expanded)
  const [campaignTitle, setCampaignTitle] = useState('')
  const [campaignLeads, setCampaignLeads] = useState('')

  // Team form
  const [teamName, setTeamName] = useState('')
  const [teamMission, setTeamMission] = useState('')
  const [seats, setSeats] = useState<Array<{ agent_key: string; seat: string }>>([])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [roster, feed] = await Promise.all([
        adminFetch('/agents') as Promise<{ agents: Agent[]; teams: Team[] }>,
        adminFetch('/agents/runs/recent?limit=40') as Promise<{ items: Run[] }>,
      ])
      setAgents(roster.agents)
      setTeams(roster.teams)
      setRuns(feed.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const spawn = async () => {
    if (!description.trim()) return
    setBusy('spawn')
    setError(null)
    setNotice(null)
    try {
      const res = (await adminFetch('/agents', {
        method: 'POST',
        body: JSON.stringify({ description }),
      })) as { agent: Agent; droppedTools: string[]; review: { verdict: string; reviewed: boolean } }

      const bits = [`${res.agent.name} created — ${res.agent.status}.`, `Ilita: ${res.review.verdict}${res.review.reviewed ? '' : ' (she was unreachable)'}.`]
      if (res.droppedTools.length > 0) bits.push(`Tools not granted: ${res.droppedTools.join(', ')}.`)
      setNotice(bits.join(' '))
      setDescription('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Spawn failed')
    } finally {
      setBusy(null)
    }
  }

  const review = async (key: string) => {
    setBusy(key)
    setError(null)
    try {
      const res = (await adminFetch(`/agents/${key}/review`, { method: 'POST', body: '{}' })) as {
        agent: Agent
        review: { verdict: string; notes: string }
      }
      setNotice(`${res.agent.name}: ${res.review.verdict} → ${res.agent.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed')
    } finally {
      setBusy(null)
    }
  }

  const setStatus = async (key: string, status: string) => {
    setBusy(key)
    try {
      await adminFetch(`/agents/${key}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  const assign = async (kind: 'agent' | 'team', key: string) => {
    const objective = window.prompt(`Objective for ${key}:`)
    if (!objective?.trim()) return
    setBusy(key)
    setError(null)
    try {
      const path = kind === 'team' ? `/agents/teams/${key}/run` : `/agents/${key}/run`
      await adminFetch(path, { method: 'POST', body: JSON.stringify({ objective }) })
      setNotice('Queued. The worker picks it up within a minute — refresh the run feed for output.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dispatch failed')
    } finally {
      setBusy(null)
    }
  }

  const openRun = async (id: string) => {
    if (expanded === id) {
      setExpanded(null)
      setDetail(null)
      return
    }
    setExpanded(id)
    setDetail(null)
    setCampaignTitle('')
    setCampaignLeads('')
    try {
      setDetail((await adminFetch(`/agents/runs/${id}`)) as RunDetail)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load run')
    }
  }

  const launchCampaign = async (runId: string) => {
    if (!campaignTitle.trim() || !campaignLeads.trim()) return
    setBusy(runId)
    setError(null)
    try {
      const res = (await adminFetch(`/agents/runs/${runId}/campaign`, {
        method: 'POST',
        body: JSON.stringify({ title: campaignTitle, leads_text: campaignLeads }),
      })) as { task_id: string; lead_count: number }
      setNotice(
        `Campaign queued for ${res.lead_count} recipient(s). Drafts land in the Inbox for approval — nothing sends on its own.`,
      )
      setCampaignTitle('')
      setCampaignLeads('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Launch failed')
    } finally {
      setBusy(null)
    }
  }

  const createTeam = async () => {
    if (!teamName.trim() || !teamMission.trim() || seats.length === 0) return
    setBusy('team')
    setError(null)
    try {
      await adminFetch('/agents/teams', {
        method: 'POST',
        body: JSON.stringify({ name: teamName, mission: teamMission, members: seats }),
      })
      setNotice(`Team "${teamName}" assembled.`)
      setTeamName('')
      setTeamMission('')
      setSeats([])
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Team creation failed')
    } finally {
      setBusy(null)
    }
  }

  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? null
  const teamName_ = (id: string | null) => teams.find((t) => t.id === id)?.name ?? null

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">Agents</h1>
        <p className="mt-1 text-sm text-[var(--nx-text-2)]">
          Your workforce. Describe a seat and Kuze writes the charter; Ilita reviews it before it can act.
        </p>
      </header>

      {error && <p className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
      {notice && <p className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{notice}</p>}

      {/* ── SPAWN ─────────────────────────────────────────── */}
      <section className="nx-panel space-y-3 p-4">
        <h2 className="nx-label nx-label--accent">Hire an agent</h2>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="I need someone watching weekly churn in the Shift DB — flag any cohort that drops more than 5% week over week, tell me why, and don't touch billing."
          className="nx-input w-full"
        />
        <button type="button" className="nx-btn" disabled={busy === 'spawn' || !description.trim()} onClick={spawn}>
          {busy === 'spawn' ? 'Designing charter…' : 'Design + submit for review'}
        </button>
      </section>

      {/* ── ROSTER ────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="nx-label nx-label--accent">Roster ({agents.length})</h2>
        {loading && <p className="text-sm text-[var(--nx-text-2)]">Loading…</p>}
        {!loading && agents.length === 0 && (
          <p className="text-sm text-[var(--nx-text-2)]">No agents yet. Describe one above.</p>
        )}
        {agents.map((a) => (
          <article key={a.id} className="nx-panel space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{a.name}</h3>
              <code className="text-xs text-[var(--nx-text-2)]">{a.agent_key}</code>
              <Chip value={a.status} />
              <span className="text-xs text-[var(--nx-text-2)]">
                {a.autonomy} · {autonomyBlurb[a.autonomy]}
              </span>
            </div>
            <p className="text-sm">{a.role}</p>

            <div className="text-xs text-[var(--nx-text-2)]">
              Tools: {a.tool_allowlist.length > 0 ? a.tool_allowlist.join(', ') : 'none (reasoning only)'} ·{' '}
              {a.max_iterations} iterations · {a.daily_run_cap}/day · created by {a.created_by}
            </div>

            {a.guardrails?.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-[var(--nx-text-2)]">
                {a.guardrails.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            )}

            {a.governance_notes && (
              <p className="rounded bg-[var(--nx-surface-2)] p-2 text-xs">
                <strong>Ilita ({a.governance_verdict ?? 'unreviewed'}):</strong> {a.governance_notes}
              </p>
            )}

            <details className="text-xs">
              <summary className="cursor-pointer text-[var(--nx-text-2)]">Charter</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans">{a.charter}</pre>
            </details>

            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" className="nx-btn" disabled={busy === a.agent_key} onClick={() => review(a.agent_key)}>
                Re-review
              </button>
              {a.status === 'active' && (
                <>
                  <button type="button" className="nx-btn" disabled={busy === a.agent_key} onClick={() => assign('agent', a.agent_key)}>
                    Assign work
                  </button>
                  <button type="button" className="nx-btn" onClick={() => setStatus(a.agent_key, 'paused')}>
                    Pause
                  </button>
                </>
              )}
              {a.status === 'paused' && (
                <button type="button" className="nx-btn" onClick={() => setStatus(a.agent_key, 'active')}>
                  Resume
                </button>
              )}
              {a.status !== 'retired' && (
                <button type="button" className="nx-btn" onClick={() => setStatus(a.agent_key, 'retired')}>
                  Retire
                </button>
              )}
            </div>
          </article>
        ))}
      </section>

      {/* ── TEAMS ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="nx-label nx-label--accent">Teams ({teams.length})</h2>

        {teams.map((t) => (
          <article key={t.id} className="nx-panel flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <h3 className="font-medium">
                {t.name} <code className="text-xs text-[var(--nx-text-2)]">{t.team_key}</code>
              </h3>
              <p className="text-sm text-[var(--nx-text-2)]">{t.mission}</p>
            </div>
            <Chip value={t.status} />
            <button type="button" className="nx-btn" disabled={busy === t.team_key} onClick={() => assign('team', t.team_key)}>
              Run team
            </button>
          </article>
        ))}

        <div className="nx-panel space-y-3 p-4">
          <h3 className="nx-label">Assemble a team</h3>
          <input
            className="nx-input w-full"
            placeholder="Team name — e.g. Revenue Watch"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
          />
          <input
            className="nx-input w-full"
            placeholder="Mission — what this team exists to do"
            value={teamMission}
            onChange={(e) => setTeamMission(e.target.value)}
          />
          <p className="text-xs text-[var(--nx-text-2)]">
            Pick seats in execution order — each one sees everything produced before it.
          </p>
          <div className="space-y-1">
            {agents
              .filter((a) => a.status === 'active')
              .map((a) => {
                const idx = seats.findIndex((s) => s.agent_key === a.agent_key)
                return (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={idx >= 0}
                      onChange={(e) =>
                        setSeats((prev) =>
                          e.target.checked
                            ? [...prev, { agent_key: a.agent_key, seat: a.role }]
                            : prev.filter((s) => s.agent_key !== a.agent_key),
                        )
                      }
                    />
                    {idx >= 0 && <span className="text-xs text-[var(--nx-accent)]">#{idx + 1}</span>}
                    {a.name}
                  </label>
                )
              })}
            {agents.filter((a) => a.status === 'active').length === 0 && (
              <p className="text-sm text-[var(--nx-text-2)]">No active agents yet — review one first.</p>
            )}
          </div>
          <button
            type="button"
            className="nx-btn"
            disabled={busy === 'team' || seats.length === 0 || !teamName.trim() || !teamMission.trim()}
            onClick={createTeam}
          >
            Assemble
          </button>
        </div>
      </section>

      {/* ── RUN FEED ──────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="nx-label nx-label--accent">Recent runs</h2>
          <button type="button" className="nx-btn" onClick={load}>
            Refresh
          </button>
        </div>

        {runs.length === 0 && <p className="text-sm text-[var(--nx-text-2)]">Nothing has run yet.</p>}

        {runs.map((r) => (
          <article key={r.id} className="nx-panel p-4">
            <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => openRun(r.id)}>
              <Chip value={r.status} />
              <span className="text-sm font-medium">
                {agentName(r.agent_id) ?? teamName_(r.team_id) ?? 'Team run'}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--nx-text-2)]">{r.objective}</span>
              <span className="text-xs text-[var(--nx-text-2)]">{new Date(r.started_at).toLocaleString()}</span>
            </button>

            {expanded === r.id && (
              <div className="mt-3 space-y-3 border-t border-[var(--nx-line)] pt-3 text-sm">
                {!detail && <p className="text-[var(--nx-text-2)]">Loading…</p>}
                {detail && (
                  <>
                    {detail.audits.map((a) => (
                      <p key={a.id} className="rounded bg-[var(--nx-surface-2)] p-2 text-xs">
                        <strong>Audit — {a.auditor} ({a.verdict}):</strong> {a.summary}
                      </p>
                    ))}
                    {detail.run.error && <p className="text-xs text-red-500">{detail.run.error}</p>}
                    {detail.member_runs.length > 0 && (
                      <div className="space-y-2">
                        <p className="nx-label">Seats</p>
                        {detail.member_runs.map((m) => (
                          <details key={m.id} className="text-xs">
                            <summary className="cursor-pointer">
                              {m.status} — {m.objective}
                            </summary>
                            <pre className="mt-1 whitespace-pre-wrap font-sans">{m.output}</pre>
                          </details>
                        ))}
                      </div>
                    )}
                    <div>
                      <p className="nx-label">Output</p>
                      <pre className="mt-1 whitespace-pre-wrap font-sans">{detail.run.output ?? '(none)'}</pre>
                    </div>

                    {detail.run.status === 'completed' && detail.run.output && (
                      <div className="space-y-2 rounded border border-[var(--nx-line)] p-3">
                        <p className="nx-label">Send this as a campaign</p>
                        <p className="text-xs text-[var(--nx-text-2)]">
                          This copy becomes the approved source. Kuze personalizes it per recipient through
                          the full Sentinel pipeline, and every draft waits in the Inbox — nothing sends here.
                        </p>
                        <input
                          className="nx-input w-full"
                          placeholder="Campaign title"
                          value={campaignTitle}
                          onChange={(e) => setCampaignTitle(e.target.value)}
                        />
                        <textarea
                          className="nx-input w-full font-mono text-xs"
                          rows={4}
                          placeholder={'one per line:\nname@company.com, Jane Doe, Acme'}
                          value={campaignLeads}
                          onChange={(e) => setCampaignLeads(e.target.value)}
                        />
                        <button
                          type="button"
                          className="nx-btn"
                          disabled={busy === r.id || !campaignTitle.trim() || !campaignLeads.trim()}
                          onClick={() => launchCampaign(r.id)}
                        >
                          {busy === r.id ? 'Queueing…' : 'Draft campaign for approval'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  )
}
