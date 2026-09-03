// Agent Fabric — persistence layer over kuze.agents / agent_teams / team_members.
//
// Every write goes through here so the invariants live in one place: keys are slugified,
// allowlists are intersected with the live tool registry before storage, and an agent can
// only be activated once Ilita has ruled on its charter.

import { supabaseAdmin } from '../supabaseAdmin.js'
import { resolveAllowlist } from '../tools/registry.js'
import type { AgentRow, AgentSpec, GovernanceVerdict, TeamRow, TeamSpec, TeamWithRoster } from './types.js'

const db = () => supabaseAdmin.schema('kuze')

/** Lowercase, hyphenated, safe as a stable identifier. */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export async function listAgents(opts: { status?: string } = {}): Promise<AgentRow[]> {
  let q = db().from('agents').select('*').order('created_at', { ascending: false })
  if (opts.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) throw new Error(`listAgents: ${error.message}`)
  return (data ?? []) as AgentRow[]
}

export async function getAgent(idOrKey: string): Promise<AgentRow | null> {
  const column = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(idOrKey) ? 'id' : 'agent_key'
  const { data, error } = await db().from('agents').select('*').eq(column, idOrKey).maybeSingle()
  if (error) throw new Error(`getAgent: ${error.message}`)
  return (data as AgentRow) ?? null
}

/**
 * Persist a spec as a `pending_review` agent. The allowlist is filtered to tools that
 * actually exist and are delegable; dropped names are returned so the caller can tell
 * Brandon that a requested capability was not granted.
 */
export async function createAgent(
  spec: AgentSpec,
  createdBy: 'brandon' | 'kuze' | 'ilita',
): Promise<{ agent: AgentRow; droppedTools: string[] }> {
  const key = slugify(spec.agent_key || spec.name)
  if (!key) throw new Error('agent_key could not be derived from the spec')

  const existing = await getAgent(key)
  if (existing) throw new Error(`an agent with key "${key}" already exists`)

  const { tools, unknown } = resolveAllowlist(spec.tool_allowlist ?? [])

  const { data, error } = await db()
    .from('agents')
    .insert({
      agent_key: key,
      name: spec.name,
      role: spec.role,
      charter: spec.charter,
      mission: spec.mission,
      tool_allowlist: tools.map((t) => t.name),
      mode: spec.mode || 'ops',
      model_tier: spec.model_tier || 'balanced',
      autonomy: spec.autonomy || 'propose',
      status: 'pending_review',
      guardrails: spec.guardrails ?? [],
      max_iterations: spec.max_iterations ?? 4,
      daily_run_cap: spec.daily_run_cap ?? 24,
      created_by: createdBy,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(`createAgent: ${error?.message ?? 'insert returned no row'}`)
  return { agent: data as AgentRow, droppedTools: unknown }
}

export async function updateAgent(id: string, patch: Record<string, unknown>): Promise<AgentRow> {
  // Re-filter the allowlist on every write; a direct PATCH is as much a grant as a spawn is.
  if (Array.isArray(patch.tool_allowlist)) {
    patch.tool_allowlist = resolveAllowlist(patch.tool_allowlist as string[]).tools.map((t) => t.name)
  }
  const { data, error } = await db()
    .from('agents')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error || !data) throw new Error(`updateAgent: ${error?.message ?? 'no row'}`)
  return data as AgentRow
}

/** Record Ilita's charter verdict and move the agent to the status that verdict implies. */
export async function applyGovernanceVerdict(
  id: string,
  verdict: GovernanceVerdict,
  notes: string,
): Promise<AgentRow> {
  const status =
    verdict === 'approved' || verdict === 'approved_with_conditions'
      ? 'active'
      : verdict === 'rejected'
        ? 'retired'
        : 'draft'

  return updateAgent(id, {
    governance_verdict: verdict,
    governance_notes: notes,
    governance_reviewed_at: new Date().toISOString(),
    status,
  })
}

/** Runs started by this agent since midnight UTC — enforces daily_run_cap. */
export async function runsToday(agentId: string): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { count, error } = await db()
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .gte('started_at', since.toISOString())
  if (error) throw new Error(`runsToday: ${error.message}`)
  return count ?? 0
}

// ── TEAMS ─────────────────────────────────────────────────────────────────────

export async function listTeams(): Promise<TeamRow[]> {
  const { data, error } = await db().from('agent_teams').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(`listTeams: ${error.message}`)
  return (data ?? []) as TeamRow[]
}

/** A team plus its roster, each seat resolved to the full agent row, in execution order. */
export async function getTeam(idOrKey: string): Promise<TeamWithRoster | null> {
  const column = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(idOrKey) ? 'id' : 'team_key'
  const { data: team, error } = await db().from('agent_teams').select('*').eq(column, idOrKey).maybeSingle()
  if (error) throw new Error(`getTeam: ${error.message}`)
  if (!team) return null

  const { data: members, error: mErr } = await db()
    .from('team_members')
    .select('id, team_id, agent_id, seat, position, agent:agents(*)')
    .eq('team_id', (team as TeamRow).id)
    .order('position', { ascending: true })
  if (mErr) throw new Error(`getTeam members: ${mErr.message}`)

  // PostgREST returns an embedded one-to-one relation as an array in some client versions;
  // flatten it so callers always see `member.agent` as a single row.
  const roster = (members ?? [])
    .map((m) => {
      const raw = (m as { agent: unknown }).agent
      const agent = (Array.isArray(raw) ? raw[0] : raw) as AgentRow | undefined
      return agent ? { ...(m as object), agent } : null
    })
    .filter(Boolean) as TeamWithRoster['members']

  return { ...(team as TeamRow), members: roster }
}

/**
 * Create a team from a spec. Every named member must already exist as an agent — a team is
 * a roster of reviewed seats, never a way to conjure unreviewed ones.
 */
export async function createTeam(
  spec: TeamSpec,
  createdBy: 'brandon' | 'kuze' | 'ilita',
): Promise<TeamWithRoster> {
  const key = slugify(spec.team_key || spec.name)
  if (!key) throw new Error('team_key could not be derived from the spec')
  if (!spec.members?.length) throw new Error('a team needs at least one member')

  const resolved: Array<{ agent: AgentRow; seat: string }> = []
  for (const m of spec.members) {
    const agent = await getAgent(m.agent_key)
    if (!agent) throw new Error(`unknown agent "${m.agent_key}" — create and review it first`)
    resolved.push({ agent, seat: m.seat })
  }

  let leadId: string | null = null
  if (spec.lead_agent_key) {
    const lead = await getAgent(spec.lead_agent_key)
    if (!lead) throw new Error(`unknown lead agent "${spec.lead_agent_key}"`)
    leadId = lead.id
  }

  const { data: team, error } = await db()
    .from('agent_teams')
    .insert({ team_key: key, name: spec.name, mission: spec.mission, lead_agent_id: leadId, created_by: createdBy })
    .select('*')
    .single()
  if (error || !team) throw new Error(`createTeam: ${error?.message ?? 'insert returned no row'}`)

  const { error: mErr } = await db()
    .from('team_members')
    .insert(
      resolved.map((r, i) => ({
        team_id: (team as TeamRow).id,
        agent_id: r.agent.id,
        seat: r.seat,
        position: i,
      })),
    )
  if (mErr) throw new Error(`createTeam roster: ${mErr.message}`)

  const full = await getTeam((team as TeamRow).id)
  if (!full) throw new Error('createTeam: team vanished after insert')
  return full
}
