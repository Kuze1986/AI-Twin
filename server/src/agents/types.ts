// Agent Fabric — shared types.
//
// An agent is a persisted seat: a charter, a scoped tool allowlist, and an autonomy ceiling.
// Nothing here grants capability on its own — the runner resolves the allowlist against the
// live tool registry, so a charter can never widen what Kuze himself can do.

export type Autonomy = 'propose' | 'draft' | 'execute'
export type AgentStatus = 'draft' | 'pending_review' | 'active' | 'paused' | 'retired'
export type ModelTier = 'fast' | 'balanced' | 'powerful'
export type GovernanceVerdict = 'approved' | 'approved_with_conditions' | 'revise' | 'rejected'

export interface AgentRow {
  id: string
  agent_key: string
  name: string
  role: string
  charter: string
  mission: string
  tool_allowlist: string[]
  mode: string
  model_tier: ModelTier
  autonomy: Autonomy
  status: AgentStatus
  guardrails: string[]
  max_iterations: number
  daily_run_cap: number
  created_by: 'brandon' | 'kuze' | 'ilita'
  governance_verdict: GovernanceVerdict | null
  governance_notes: string | null
  governance_reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface TeamRow {
  id: string
  team_key: string
  name: string
  mission: string
  lead_agent_id: string | null
  status: 'active' | 'paused' | 'retired'
  created_by: 'brandon' | 'kuze' | 'ilita'
  created_at: string
  updated_at: string
}

export interface TeamMemberRow {
  id: string
  team_id: string
  agent_id: string
  seat: string
  position: number
}

/** A team with its roster resolved, ordered by position. */
export interface TeamWithRoster extends TeamRow {
  members: Array<TeamMemberRow & { agent: AgentRow }>
}

export interface RunRow {
  id: string
  agent_id: string | null
  team_id: string | null
  parent_run_id: string | null
  status: 'running' | 'completed' | 'failed' | 'refused' | 'cancelled'
  objective: string
  output: string | null
  transcript: TranscriptEntry[]
  tools_used: string[]
  iterations: number
  sentinel_resolution: string | null
  error: string | null
  started_at: string
  finished_at: string | null
}

export interface TranscriptEntry {
  step: number
  kind: 'objective' | 'context' | 'tool' | 'output' | 'error' | 'handoff' | 'plan'
  actor: string
  content: string
}

/**
 * The shape the spawn LLM must return, and the shape a human can POST directly.
 * Deliberately narrow: no model override, no raw SQL, no arbitrary endpoints — an agent
 * is defined by intent and scope, and everything it can actually *do* comes from the
 * allowlist being intersected with the real registry.
 */
export interface AgentSpec {
  agent_key: string
  name: string
  role: string
  mission: string
  charter: string
  tool_allowlist: string[]
  guardrails: string[]
  autonomy: Autonomy
  model_tier: ModelTier
  mode: string
  max_iterations: number
  daily_run_cap: number
}

export interface TeamSpec {
  team_key: string
  name: string
  mission: string
  members: Array<{ agent_key: string; seat: string }>
  lead_agent_key?: string | null
}
