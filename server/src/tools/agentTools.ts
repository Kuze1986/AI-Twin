// Fabric-management tools — how Kuze builds and runs his own workforce from chat.
//
// These are marked `delegable: false`: a spawned agent never receives them. Authority to
// create, re-scope, or dispatch agents stays with Kuze and Brandon, so no agent can widen
// its own charter or manufacture a more permissive sibling.
//
// The two dispatch tools ENQUEUE rather than execute. A team run is minutes of inference;
// blocking a streaming chat turn on it would strand Brandon watching a spinner. They return
// a task id, and the existing task worker drains it.

import { createTask } from '../tasks/create.js'
import { getAgent, getTeam, listAgents, listTeams } from '../agents/registry.js'
import { spawnAgent } from '../agents/spawn.js'
import { createTeam } from '../agents/registry.js'
import { fail, ok, type KuzeTool, type ToolContext, type ToolResult } from './types.js'

const SOURCE = 'agent_fabric'

// Building the workforce is internal work. These tools are withheld from the outward-facing
// modes so a customer conversation can never reach the fabric, however it is steered.
const INTERNAL_MODES = ['default', 'ops', 'debrief']

const createAgentTool: KuzeTool = {
  name: 'create_agent',
  delegable: false,
  modes: INTERNAL_MODES,
  description: [
    'Design and register a new specialized agent from a plain-language description of the seat.',
    'The charter is authored automatically, then reviewed by Ilita before the agent can act.',
    'Use this when Brandon asks for a new kind of worker ("I need someone watching churn"),',
    'not for one-off questions you can answer yourself.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description:
          'What this seat is for, in Brandon\'s words plus whatever you know about the business. Include what it owns, what data it needs, and how much rope it gets.',
      },
    },
    required: ['description'],
  },
  async execute(input: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const startedAt = Date.now()
    const description = String((input as { description?: unknown })?.description ?? '').trim()
    if (!description) return fail('create_agent requires a description of the seat', SOURCE, startedAt)

    try {
      const result = await spawnAgent({ description, createdBy: 'kuze' })
      return ok(
        {
          agent_key: result.agent.agent_key,
          name: result.agent.name,
          role: result.agent.role,
          status: result.agent.status,
          autonomy: result.agent.autonomy,
          tools_granted: result.agent.tool_allowlist,
          tools_denied: result.droppedTools,
          guardrails: result.agent.guardrails,
          governance: {
            verdict: result.review.verdict,
            reviewed_by_ilita: result.review.reviewed,
            notes: result.review.notes,
          },
        },
        SOURCE,
        startedAt,
      )
    } catch (e) {
      return fail(`create_agent failed: ${(e as Error).message}`, SOURCE, startedAt)
    }
  },
}

const listAgentsTool: KuzeTool = {
  name: 'list_agents',
  delegable: false,
  modes: INTERNAL_MODES,
  description:
    'List the agents and teams that currently exist, with their status, autonomy, and governance verdict. Use this before creating an agent so you do not duplicate a seat that already exists.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['draft', 'pending_review', 'active', 'paused', 'retired'],
        description: 'Optional filter. Omit to see every agent.',
      },
    },
  },
  async execute(input: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const startedAt = Date.now()
    const status = (input as { status?: string })?.status
    try {
      const [agents, teams] = await Promise.all([listAgents(status ? { status } : {}), listTeams()])
      return ok(
        {
          agents: agents.map((a) => ({
            agent_key: a.agent_key,
            name: a.name,
            role: a.role,
            status: a.status,
            autonomy: a.autonomy,
            tools: a.tool_allowlist,
            governance_verdict: a.governance_verdict,
          })),
          teams: teams.map((t) => ({ team_key: t.team_key, name: t.name, mission: t.mission, status: t.status })),
        },
        SOURCE,
        startedAt,
      )
    } catch (e) {
      return fail(`list_agents failed: ${(e as Error).message}`, SOURCE, startedAt)
    }
  },
}

const createTeamTool: KuzeTool = {
  name: 'create_team',
  delegable: false,
  modes: INTERNAL_MODES,
  description:
    'Assemble existing agents into a team that runs a goal end to end, each seat handing its output to the next. Every member must already exist — call create_agent for any seat that does not.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Display name for the team.' },
      mission: { type: 'string', description: 'The standing mission this team exists to serve.' },
      members: {
        type: 'array',
        description: 'The roster, in execution order.',
        items: {
          type: 'object',
          properties: {
            agent_key: { type: 'string' },
            seat: { type: 'string', description: 'What this member does on THIS team.' },
          },
          required: ['agent_key', 'seat'],
        },
      },
      lead_agent_key: {
        type: 'string',
        description: 'Optional — the agent that writes the closing brief. Omit and Kuze writes it.',
      },
    },
    required: ['name', 'mission', 'members'],
  },
  async execute(input: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const startedAt = Date.now()
    const spec = input as {
      name?: string
      mission?: string
      members?: Array<{ agent_key: string; seat: string }>
      lead_agent_key?: string
    }
    if (!spec?.name || !spec?.mission || !Array.isArray(spec.members) || spec.members.length === 0) {
      return fail('create_team requires name, mission, and at least one member', SOURCE, startedAt)
    }
    try {
      const team = await createTeam(
        {
          team_key: spec.name,
          name: spec.name,
          mission: spec.mission,
          members: spec.members,
          lead_agent_key: spec.lead_agent_key ?? null,
        },
        'kuze',
      )
      return ok(
        {
          team_key: team.team_key,
          name: team.name,
          members: team.members.map((m) => ({
            agent_key: m.agent.agent_key,
            seat: m.seat,
            status: m.agent.status,
          })),
          inactive_seats: team.members.filter((m) => m.agent.status !== 'active').map((m) => m.agent.agent_key),
        },
        SOURCE,
        startedAt,
      )
    } catch (e) {
      return fail(`create_team failed: ${(e as Error).message}`, SOURCE, startedAt)
    }
  },
}

const assignWorkTool: KuzeTool = {
  name: 'assign_work',
  delegable: false,
  modes: INTERNAL_MODES,
  description: [
    'Dispatch a goal to an existing agent or team. The work is queued and runs in the background;',
    'this returns a task id immediately, not the result. Tell Brandon it is running and that the',
    'output will appear under Agents when it finishes.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      target_type: { type: 'string', enum: ['agent', 'team'] },
      target_key: { type: 'string', description: 'The agent_key or team_key to dispatch to.' },
      objective: { type: 'string', description: 'The concrete goal for this run.' },
    },
    required: ['target_type', 'target_key', 'objective'],
  },
  async execute(input: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const startedAt = Date.now()
    const { target_type, target_key, objective } = (input ?? {}) as {
      target_type?: string
      target_key?: string
      objective?: string
    }
    if (!target_type || !target_key || !objective?.trim()) {
      return fail('assign_work requires target_type, target_key, and objective', SOURCE, startedAt)
    }

    try {
      // Verify the target exists and can actually run before queueing — a task that is
      // guaranteed to fail is worse than an honest refusal now.
      if (target_type === 'agent') {
        const agent = await getAgent(target_key)
        if (!agent) return fail(`no agent with key "${target_key}"`, SOURCE, startedAt)
        if (agent.status !== 'active') {
          return fail(`agent "${target_key}" is ${agent.status}, not active — it cannot be assigned work yet`, SOURCE, startedAt)
        }
      } else {
        const team = await getTeam(target_key)
        if (!team) return fail(`no team with key "${target_key}"`, SOURCE, startedAt)
        if (!team.members.some((m) => m.agent.status === 'active')) {
          return fail(`team "${target_key}" has no active members yet`, SOURCE, startedAt)
        }
      }

      const task = await createTask({
        title: `${target_type === 'team' ? 'Team' : 'Agent'} run — ${target_key}`,
        type: target_type === 'team' ? 'team_run' : 'agent_run',
        goal: objective.trim(),
        source: 'chat',
        payload: { target_key },
      })

      return ok({ task_id: task.id, status: task.status, target_type, target_key }, SOURCE, startedAt)
    } catch (e) {
      return fail(`assign_work failed: ${(e as Error).message}`, SOURCE, startedAt)
    }
  },
}

export const agentTools: KuzeTool[] = [createAgentTool, listAgentsTool, createTeamTool, assignWorkTool]
