// Admin API for the Agent Fabric.
//
// Dispatch endpoints queue rather than execute: a team run outlives an HTTP request, so
// /run returns a task id and the UI polls the run row. The only synchronous work here is
// charter design and review, which is seconds, not minutes.

import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../adminMiddleware.js'
import { supabaseAdmin } from '../supabaseAdmin.js'
import { createTask, parseLeadsText, type Lead } from '../tasks/create.js'
import { listDelegableTools } from '../tools/registry.js'
import {
  applyGovernanceVerdict,
  createTeam,
  getAgent,
  getTeam,
  listAgents,
  listTeams,
  updateAgent,
} from '../agents/registry.js'
import { reviewCharter } from '../agents/governance.js'
import { draftAgentSpec, spawnAgent } from '../agents/spawn.js'
import type { AgentSpec } from '../agents/types.js'

export const agentsRouter = Router()
agentsRouter.use(requireAdmin)

const db = () => supabaseAdmin.schema('kuze')

function serverError(res: import('express').Response, e: unknown) {
  res.status(500).json({ error: { code: 'server_error', message: (e as Error).message } })
}

// ── CATALOG ───────────────────────────────────────────────────────────────────

/** GET /catalog — the tools a charter is allowed to request. */
agentsRouter.get('/catalog', (_req, res) => {
  res.json({ tools: listDelegableTools() })
})

// ── AGENTS ────────────────────────────────────────────────────────────────────

/** GET / — every agent and team, for the roster view. */
agentsRouter.get('/', async (_req, res) => {
  try {
    const [agents, teams] = await Promise.all([listAgents(), listTeams()])
    res.json({ agents, teams })
  } catch (e) {
    serverError(res, e)
  }
})

const specSchema = z.object({
  agent_key: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  role: z.string().min(1).max(300),
  mission: z.string().min(1).max(2_000),
  charter: z.string().min(1).max(8_000),
  tool_allowlist: z.array(z.string()).max(20).default([]),
  guardrails: z.array(z.string().max(400)).max(15).default([]),
  autonomy: z.enum(['propose', 'draft', 'execute']).default('propose'),
  model_tier: z.enum(['fast', 'balanced', 'powerful']).default('balanced'),
  mode: z.string().max(40).default('ops'),
  max_iterations: z.number().int().min(1).max(12).default(4),
  daily_run_cap: z.number().int().min(1).max(500).default(24),
})

const createAgentSchema = z
  .object({ description: z.string().min(1).max(10_000).optional(), spec: specSchema.optional() })
  .refine((v) => v.description || v.spec, { message: 'provide a description or a full spec' })

/** POST / — spawn an agent from a description, or from a hand-written spec. */
agentsRouter.post('/', async (req, res) => {
  const parsed = createAgentSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }
  try {
    const result = await spawnAgent({
      description: parsed.data.description,
      spec: parsed.data.spec as AgentSpec | undefined,
      createdBy: 'brandon',
    })
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: { code: 'spawn_failed', message: (e as Error).message } })
  }
})

/** POST /design — draft a charter WITHOUT persisting it, so Brandon can edit before saving. */
agentsRouter.post('/design', async (req, res) => {
  const description = String(req.body?.description ?? '').trim()
  if (!description) {
    res.status(400).json({ error: { code: 'validation', message: 'description is required' } })
    return
  }
  try {
    res.json({ spec: await draftAgentSpec(description) })
  } catch (e) {
    res.status(502).json({ error: { code: 'design_failed', message: (e as Error).message } })
  }
})

/** GET /:key — an agent with its recent runs. */
agentsRouter.get('/:key', async (req, res) => {
  try {
    const agent = await getAgent(req.params.key)
    if (!agent) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such agent' } })
      return
    }
    const { data: runs } = await db()
      .from('agent_runs')
      .select('id, objective, status, output, iterations, tools_used, started_at, finished_at')
      .eq('agent_id', agent.id)
      .order('started_at', { ascending: false })
      .limit(25)
    res.json({ agent, runs: runs ?? [] })
  } catch (e) {
    serverError(res, e)
  }
})

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  role: z.string().min(1).max(300).optional(),
  charter: z.string().min(1).max(8_000).optional(),
  mission: z.string().min(1).max(2_000).optional(),
  tool_allowlist: z.array(z.string()).max(20).optional(),
  guardrails: z.array(z.string().max(400)).max(15).optional(),
  autonomy: z.enum(['propose', 'draft', 'execute']).optional(),
  model_tier: z.enum(['fast', 'balanced', 'powerful']).optional(),
  max_iterations: z.number().int().min(1).max(12).optional(),
  daily_run_cap: z.number().int().min(1).max(500).optional(),
  status: z.enum(['draft', 'pending_review', 'active', 'paused', 'retired']).optional(),
})

/**
 * PATCH /:key — edit an agent. Changing the charter, tools, or autonomy invalidates the
 * existing governance verdict: the reviewed thing no longer exists, so the agent drops back
 * to draft and has to be re-reviewed before it can run again.
 */
agentsRouter.patch('/:key', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }
  try {
    const agent = await getAgent(req.params.key)
    if (!agent) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such agent' } })
      return
    }

    const patch: Record<string, unknown> = { ...parsed.data }
    const materialKeys = ['charter', 'tool_allowlist', 'autonomy', 'mission'] as const
    const material = materialKeys.some((k) => patch[k] !== undefined)

    if (material) {
      patch.governance_verdict = null
      patch.governance_notes = 'Charter changed after review — re-review required.'
      patch.governance_reviewed_at = null
      patch.status = 'draft'
    }

    res.json({ agent: await updateAgent(agent.id, patch) })
  } catch (e) {
    serverError(res, e)
  }
})

/** POST /:key/review — (re)submit the charter to Ilita and apply her verdict. */
agentsRouter.post('/:key/review', async (req, res) => {
  try {
    const agent = await getAgent(req.params.key)
    if (!agent) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such agent' } })
      return
    }
    const review = await reviewCharter({
      agent_key: agent.agent_key,
      name: agent.name,
      role: agent.role,
      mission: agent.mission,
      charter: agent.charter,
      tool_allowlist: agent.tool_allowlist,
      guardrails: agent.guardrails ?? [],
      autonomy: agent.autonomy,
      model_tier: agent.model_tier,
      mode: agent.mode,
      max_iterations: agent.max_iterations,
      daily_run_cap: agent.daily_run_cap,
    })

    if (review.required_guardrails.length > 0) {
      await updateAgent(agent.id, { guardrails: [...(agent.guardrails ?? []), ...review.required_guardrails] })
    }
    const updated = await applyGovernanceVerdict(agent.id, review.verdict, review.notes)
    res.json({ agent: updated, review })
  } catch (e) {
    serverError(res, e)
  }
})

/** POST /:key/run — queue a run for this agent. Returns a task id, not the output. */
agentsRouter.post('/:key/run', async (req, res) => {
  const objective = String(req.body?.objective ?? '').trim()
  if (!objective) {
    res.status(400).json({ error: { code: 'validation', message: 'objective is required' } })
    return
  }
  try {
    const agent = await getAgent(req.params.key)
    if (!agent) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such agent' } })
      return
    }
    if (agent.status !== 'active') {
      res.status(409).json({
        error: { code: 'inactive', message: `Agent is ${agent.status}. Review and activate it before assigning work.` },
      })
      return
    }
    const task = await createTask({
      title: `Agent run — ${agent.agent_key}`,
      type: 'agent_run',
      goal: objective,
      source: 'admin',
      payload: { target_key: agent.agent_key },
    })
    res.json({ task_id: task.id })
  } catch (e) {
    serverError(res, e)
  }
})

// ── TEAMS ─────────────────────────────────────────────────────────────────────

const teamSchema = z.object({
  name: z.string().min(1).max(80),
  mission: z.string().min(1).max(2_000),
  members: z
    .array(z.object({ agent_key: z.string().min(1), seat: z.string().min(1).max(200) }))
    .min(1)
    .max(12),
  lead_agent_key: z.string().min(1).optional().nullable(),
})

/** POST /teams — assemble existing agents into a roster. */
agentsRouter.post('/teams', async (req, res) => {
  const parsed = teamSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }
  try {
    const team = await createTeam({ ...parsed.data, team_key: parsed.data.name }, 'brandon')
    res.json({ team })
  } catch (e) {
    res.status(400).json({ error: { code: 'create_failed', message: (e as Error).message } })
  }
})

/** GET /teams/:key — a team with its roster and recent team runs. */
agentsRouter.get('/teams/:key', async (req, res) => {
  try {
    const team = await getTeam(req.params.key)
    if (!team) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such team' } })
      return
    }
    const { data: runs } = await db()
      .from('agent_runs')
      .select('id, objective, status, output, started_at, finished_at')
      .eq('team_id', team.id)
      .is('agent_id', null)
      .order('started_at', { ascending: false })
      .limit(25)
    res.json({ team, runs: runs ?? [] })
  } catch (e) {
    serverError(res, e)
  }
})

/** POST /teams/:key/run — queue a full team run. */
agentsRouter.post('/teams/:key/run', async (req, res) => {
  const objective = String(req.body?.objective ?? '').trim()
  if (!objective) {
    res.status(400).json({ error: { code: 'validation', message: 'objective is required' } })
    return
  }
  try {
    const team = await getTeam(req.params.key)
    if (!team) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such team' } })
      return
    }
    if (!team.members.some((m) => m.agent.status === 'active')) {
      res.status(409).json({
        error: { code: 'no_active_members', message: 'Every seat on this team is still awaiting review.' },
      })
      return
    }
    const task = await createTask({
      title: `Team run — ${team.team_key}`,
      type: 'team_run',
      goal: objective,
      source: 'admin',
      payload: { target_key: team.team_key },
    })
    res.json({ task_id: task.id })
  } catch (e) {
    serverError(res, e)
  }
})

// ── RUNS ──────────────────────────────────────────────────────────────────────

/** GET /runs/recent — the activity feed across every agent and team. */
agentsRouter.get('/runs/recent', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  try {
    const { data, error } = await db()
      .from('agent_runs')
      .select('id, agent_id, team_id, objective, status, iterations, tools_used, started_at, finished_at')
      .order('started_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    res.json({ items: data ?? [] })
  } catch (e) {
    serverError(res, e)
  }
})

/** GET /runs/:id — one run with its handoffs and Ilita's audit. */
agentsRouter.get('/runs/:id', async (req, res) => {
  try {
    const { data: run } = await db().from('agent_runs').select('*').eq('id', req.params.id).maybeSingle()
    if (!run) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such run' } })
      return
    }
    const [{ data: messages }, { data: audits }, { data: children }] = await Promise.all([
      db().from('agent_messages').select('*').eq('run_id', req.params.id).order('created_at'),
      db().from('agent_audits').select('*').eq('run_id', req.params.id).order('created_at', { ascending: false }),
      db()
        .from('agent_runs')
        .select('id, agent_id, objective, status, output, started_at')
        .eq('parent_run_id', req.params.id)
        .order('started_at'),
    ])
    res.json({ run, messages: messages ?? [], audits: audits ?? [], member_runs: children ?? [] })
  } catch (e) {
    serverError(res, e)
  }
})

// ── RUN → CAMPAIGN ────────────────────────────────────────────────────────────

const campaignSchema = z.object({
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(10_000).optional(),
  type: z.enum(['outreach_campaign', 'follow_up']).default('outreach_campaign'),
  leads: z
    .array(z.object({ email: z.string().email(), name: z.string().optional(), company: z.string().optional() }))
    .optional(),
  leads_text: z.string().max(100_000).optional(),
})

/**
 * POST /runs/:id/campaign — turn a completed agent run into a real outreach campaign.
 *
 * This is the seam between the fabric and the send path. The run's output becomes approved
 * source copy; the existing campaign worker then personalizes it per lead through the full
 * enforced-draft pipeline — Sentinel validators, suppression checks, the approval queue.
 * Nothing here sends: it produces drafts that still need a human in the Inbox.
 *
 * A refused or failed run is rejected outright. Copy that Sentinel already blocked is not
 * source material for fifty more drafts of the same thing.
 */
agentsRouter.post('/runs/:id/campaign', async (req, res) => {
  const parsed = campaignSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }

  try {
    const { data: run } = await db()
      .from('agent_runs')
      .select('id, status, output, objective')
      .eq('id', req.params.id)
      .maybeSingle()

    if (!run) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such run' } })
      return
    }
    if (run.status !== 'completed') {
      res.status(409).json({
        error: {
          code: 'run_not_usable',
          message: `This run is ${run.status}. Only a completed run can seed a campaign.`,
        },
      })
      return
    }
    if (!run.output?.trim()) {
      res.status(409).json({ error: { code: 'no_output', message: 'This run produced no copy to send.' } })
      return
    }

    const leads: Lead[] = [
      ...(parsed.data.leads ?? []),
      ...(parsed.data.leads_text ? parseLeadsText(parsed.data.leads_text) : []),
    ]
    if (leads.length === 0) {
      res.status(400).json({
        error: { code: 'no_leads', message: 'Add at least one valid recipient email.' },
      })
      return
    }

    const task = await createTask({
      title: parsed.data.title,
      type: parsed.data.type,
      goal: parsed.data.goal?.trim() || run.objective,
      leads,
      source: 'admin',
      payload: { source_run_id: run.id },
    })

    res.json({ task_id: task.id, lead_count: leads.length })
  } catch (e) {
    serverError(res, e)
  }
})
