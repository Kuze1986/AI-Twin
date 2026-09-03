-- Kuze Agent Fabric — Phase 6
--
-- Kuze stops being a single worker and becomes a workforce. An agent is a row: a charter,
-- a scoped tool allowlist, an autonomy ceiling, and a budget. A team is an ordered roster of
-- agents that runs a goal end to end. Every run is traced; every charter is reviewed by Ilita
-- before it can act; every completed run is auditable.
--
-- Invariants encoded here, not just in code:
--   * An agent only reaches 'active' through review (governance_verdict must be set).
--   * autonomy is a ceiling, never an escape hatch — 'execute' agents still route external
--     side effects through the existing approval queues.
--   * Everything is service-role only (RLS on, no policies), like the rest of the kuze schema.

CREATE SCHEMA IF NOT EXISTS kuze;

-- ── AGENTS ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kuze.agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key      text NOT NULL UNIQUE,          -- stable slug: 'collections-analyst'
  name           text NOT NULL,                 -- display name: 'Collections Analyst'
  role           text NOT NULL,                 -- one line: what this seat is for
  charter        text NOT NULL,                 -- the agent's operating prompt overlay
  mission        text NOT NULL,                 -- the standing objective
  -- Tools this agent may call. Empty array = no tools (reasoning/writing only).
  -- Names are validated against the live registry at run time; unknown names are dropped
  -- with a warning rather than silently granting anything.
  tool_allowlist text[] NOT NULL DEFAULT '{}',
  mode           text NOT NULL DEFAULT 'ops',   -- chat mode whose config/context blocks apply
  model_tier     text NOT NULL DEFAULT 'balanced'
                   CHECK (model_tier IN ('fast', 'balanced', 'powerful')),
  -- propose: writes recommendations only. draft: may produce artifacts into approval queues.
  -- execute: may run its tools and complete tasks without a per-run human prompt.
  autonomy       text NOT NULL DEFAULT 'propose'
                   CHECK (autonomy IN ('propose', 'draft', 'execute')),
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'pending_review', 'active', 'paused', 'retired')),
  guardrails     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- explicit "never" list, shown in-prompt
  max_iterations int  NOT NULL DEFAULT 4 CHECK (max_iterations BETWEEN 1 AND 12),
  daily_run_cap  int  NOT NULL DEFAULT 24 CHECK (daily_run_cap BETWEEN 1 AND 500),
  created_by     text NOT NULL DEFAULT 'brandon' CHECK (created_by IN ('brandon', 'kuze', 'ilita')),
  -- Ilita's charter verdict. NULL = never reviewed; an agent may not be 'active' without one.
  governance_verdict  text CHECK (governance_verdict IN ('approved', 'approved_with_conditions', 'revise', 'rejected')),
  governance_notes    text,
  governance_reviewed_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agents_active_requires_review
    CHECK (status <> 'active' OR governance_verdict IN ('approved', 'approved_with_conditions'))
);

CREATE INDEX IF NOT EXISTS agents_status ON kuze.agents (status, created_at DESC);

-- ── TEAMS ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kuze.agent_teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_key    text NOT NULL UNIQUE,
  name        text NOT NULL,
  mission     text NOT NULL,
  -- The agent that plans the work and writes the final brief. NULL = Kuze himself leads.
  lead_agent_id uuid REFERENCES kuze.agents (id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'retired')),
  created_by  text NOT NULL DEFAULT 'brandon' CHECK (created_by IN ('brandon', 'kuze', 'ilita')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kuze.team_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id   uuid NOT NULL REFERENCES kuze.agent_teams (id) ON DELETE CASCADE,
  agent_id  uuid NOT NULL REFERENCES kuze.agents (id) ON DELETE CASCADE,
  seat      text NOT NULL,                 -- what this member does on THIS team
  position  int  NOT NULL DEFAULT 0,       -- execution order within the team
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, agent_id)
);

CREATE INDEX IF NOT EXISTS team_members_team ON kuze.team_members (team_id, position);

-- ── RUNS ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kuze.agent_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid REFERENCES kuze.agents (id) ON DELETE SET NULL,
  team_id     uuid REFERENCES kuze.agent_teams (id) ON DELETE SET NULL,
  -- Set when a run was spawned by a team; lets a team's member runs be gathered as children.
  parent_run_id uuid REFERENCES kuze.agent_runs (id) ON DELETE SET NULL,
  task_id     uuid REFERENCES kuze.tasks (id) ON DELETE SET NULL,
  trigger     text NOT NULL DEFAULT 'manual'
                CHECK (trigger IN ('manual', 'chat', 'task', 'team', 'schedule')),
  objective   text NOT NULL,
  status      text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'completed', 'failed', 'refused', 'cancelled')),
  output      text,
  transcript  jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ step, kind, content }]
  tools_used  text[] NOT NULL DEFAULT '{}',
  iterations  int NOT NULL DEFAULT 0,
  -- Sentinel outcome for this run's output: passed | regenerated | refused
  sentinel_resolution text,
  error       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS agent_runs_agent   ON kuze.agent_runs (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_team    ON kuze.agent_runs (team_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_status  ON kuze.agent_runs (status, started_at DESC);

-- Inter-agent bus: what one seat handed to the next. Kept separate from the transcript so a
-- team's information flow can be read on its own.
CREATE TABLE IF NOT EXISTS kuze.agent_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid REFERENCES kuze.agent_runs (id) ON DELETE CASCADE,
  team_id    uuid REFERENCES kuze.agent_teams (id) ON DELETE CASCADE,
  from_agent text NOT NULL,     -- agent_key, or 'kuze' / 'brandon'
  to_agent   text NOT NULL,
  kind       text NOT NULL DEFAULT 'handoff'
               CHECK (kind IN ('assignment', 'handoff', 'question', 'result', 'audit')),
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_messages_run ON kuze.agent_messages (run_id, created_at);

-- Ilita's (or Sentinel's) verdict on a completed run.
CREATE TABLE IF NOT EXISTS kuze.agent_audits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid NOT NULL REFERENCES kuze.agent_runs (id) ON DELETE CASCADE,
  auditor    text NOT NULL DEFAULT 'ilita' CHECK (auditor IN ('ilita', 'sentinel', 'brandon')),
  verdict    text NOT NULL CHECK (verdict IN ('clean', 'concerns', 'violation')),
  findings   jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_audits_run ON kuze.agent_audits (run_id, created_at DESC);

-- ── TASK QUEUE: two new task types the worker can drain ───────────────────────
-- 'agent_run' runs a single agent against a goal; 'team_run' runs a whole roster.

ALTER TABLE kuze.tasks DROP CONSTRAINT IF EXISTS tasks_type_check;
ALTER TABLE kuze.tasks ADD CONSTRAINT tasks_type_check
  CHECK (type IN ('outreach_campaign', 'follow_up', 'custom', 'agent_run', 'team_run'));

-- ── RLS (service-role only, consistent with the rest of the schema) ───────────

ALTER TABLE kuze.agents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuze.agent_teams   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuze.team_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuze.agent_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuze.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuze.agent_audits  ENABLE ROW LEVEL SECURITY;
