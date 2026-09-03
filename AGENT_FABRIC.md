# Agent Fabric

Kuze stopped being one worker and became a workforce.

Before this, Kuze was a single persona with one prompt, three tools, and a task queue that
only understood outreach. Adding a new capability meant writing code. Now a *seat* is a row:
Brandon describes the job in plain language, Kuze writes the charter, Ilita rules on it, and
the seat starts working. Teams are rosters of those seats that run a goal end to end.

## The shape of it

```
Brandon ──"I need someone watching churn"──▶ Kuze
                                              │
                                     draftAgentSpec()  ← the fast model writes a charter
                                              │
                                     createAgent()     ← allowlist ∩ live tool registry
                                              │
                                     ┌────────▼────────┐
                                     │  ILITA REVIEW   │  POST /ilita/agents/review
                                     │  the gate       │  blocking, fails toward restraint
                                     └────────┬────────┘
                approved / approved_with_conditions ──▶ status: active
                revise ──▶ draft          rejected ──▶ retired
                                              │
                              assign_work ──▶ kuze.tasks (agent_run | team_run)
                                              │
                                     task worker drains it
                                              │
                            runAgent() ── constitution + identity + charter overlay
                                       ── scoped tools ── Sentinel validators
                                              │
                                     ┌────────▼────────┐
                                     │  ILITA AUDIT    │  POST /ilita/agents/audit
                                     │  advisory       │  findings, drift, brandon_flags
                                     └─────────────────┘
```

## What an agent actually is

| Field | What it controls |
|---|---|
| `charter` | The operating prompt overlay. Everything above it — constitution, Kuze's identity, behavioral rules — still applies. A charter narrows; it never widens. |
| `tool_allowlist` | Intersected with the live registry on **every write and every run**. A charter naming a tool that does not exist gets it dropped, and the drop is reported. |
| `autonomy` | `propose` (recommends only) → `draft` (produces artifacts for approval) → `execute` (runs its tools unattended). External side effects still route through the existing approval queues at every level. |
| `guardrails` | Concrete prohibitions, rendered into the prompt on every run. Ilita can append to this list as a condition of approval. |
| `max_iterations` | Tool round-trips per run. Bounds cost and bounds how far a confused agent can wander. |
| `daily_run_cap` | Runs per UTC day. Enforced in `runsToday()`, bypassable only for a human-initiated run from the admin UI. |

## Invariants

These hold in the schema, not just the code:

- **An agent cannot be `active` without a governance verdict.** `agents_active_requires_review`
  is a table constraint. There is no code path that activates an unreviewed seat.
- **Editing a charter, its tools, its mission, or its autonomy resets the verdict.** The
  reviewed thing no longer exists, so the agent drops to `draft` and must be re-reviewed.
- **Agents cannot spawn agents.** The fabric-management tools are `delegable: false`; the
  runner never hands them to a sub-agent. Authority to build the workforce stays with Kuze
  and Brandon.
- **The fabric is unreachable from customer-facing modes.** Fabric tools are scoped to
  `default`, `ops`, and `debrief` — never `sales` or `outreach`.
- **Every agent output passes Sentinel.** Same validators as chat and email. A hard violation
  marks the run `refused` and the output does not become a deliverable.

## Governance failure posture

Ilita is a separate service, so she can be down. The response is deliberately asymmetric:

- Charter requesting **`execute`** and Ilita unreachable → the agent stays in **draft**.
  Fail closed. Unattended action does not get granted by a timeout.
- Charter requesting **`propose`/`draft`** and Ilita unreachable → activated as
  `approved_with_conditions`, with the reason written to `governance_notes`. Fail open, but
  *visibly* — an unreviewed agent never looks the same as a reviewed one.

Audits are advisory by design. Kuze returns the run's output to Brandon whether or not the
audit lands; a finding is something to act on, not a gate on work Brandon already asked for.

## Teams

A team run is a relay, not a debate. The planner splits one goal into one concrete assignment
per seat; each seat runs in order and sees everything produced before it; the lead agent (or
Kuze) writes the closing brief.

Sequential-with-handoff is a choice. It keeps the information flow auditable — every handoff
is a row in `kuze.agent_messages` — and keeps cost linear in the roster instead of quadratic.
A seat that fails or gets refused does not abort the team: its failure is handed downstream as
a fact, and the brief has to account for it.

The brief is explicitly instructed to surface disagreement between seats rather than average
it away. A team whose members conflict is information.

## Using it

**From chat** (any internal mode):

> "Spin up someone to watch weekly churn in the Shift DB — flag any cohort dropping more than
> 5% week over week and tell me why. Don't let them touch billing."

Kuze calls `create_agent`, reports the charter, the tools granted, the tools *denied*, and
Ilita's verdict. Then `assign_work` to dispatch, `list_agents` to see the roster.

**From the admin UI**: `/admin/agents` — describe a seat, review the charter, assemble teams
by checking seats in execution order, dispatch work, and read run transcripts with Ilita's
audit attached.

**From the API**:

| Method | Route | |
|---|---|---|
| POST | `/api/admin/agents` | Spawn from a description or a full spec |
| POST | `/api/admin/agents/design` | Draft a charter *without* persisting, to edit first |
| GET | `/api/admin/agents/catalog` | Tools a charter is allowed to request |
| PATCH | `/api/admin/agents/:key` | Edit (resets the verdict on material changes) |
| POST | `/api/admin/agents/:key/review` | Re-submit to Ilita |
| POST | `/api/admin/agents/:key/run` | Queue a run → returns `task_id` |
| POST | `/api/admin/agents/teams` | Assemble a roster |
| POST | `/api/admin/agents/teams/:key/run` | Queue a team run → returns `task_id` |
| GET | `/api/admin/agents/runs/recent` | Activity feed |
| GET | `/api/admin/agents/runs/:id` | One run: handoffs, member runs, audits |

Dispatch endpoints **queue**. A team run is minutes of inference; it outlives an HTTP request
and would strand a streaming chat turn. You get a `task_id` immediately and the existing task
worker does the work.

## Deploying

1. Apply `supabase/migrations/20260903000000_kuze_agent_fabric.sql`.
2. Apply Ilita's `src/ddl/ilita_agent_governance.sql` against the same project.
3. Set `ILITA_API_URL` and `ILITA_API_KEY` (must equal Ilita's `INTERNAL_API_KEY`).
   Without them the gate degrades as described above — it does not silently vanish.

## Where this goes next

Not built yet, in rough order of value:

- **Scheduled agents.** `kuze.tasks.scheduled_for` already exists; a standing agent that runs
  every Monday is a cron row away.
- **Per-agent memory.** Agents currently read Kuze's long-term memory but write nothing back.
  A seat that learns its beat across runs is the difference between a worker and a tool.
- **Parallel team execution** for seats with no data dependency between them, once the
  planner can express that dependency.
- **Agent-authored tools.** The natural end state, and the one that most needs Ilita's gate
  to be solid first.
