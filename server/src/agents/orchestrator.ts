// Agent Fabric — team orchestration.
//
// A team run is a relay, not a debate: the planner splits one goal into one concrete
// assignment per seat, each seat runs in order with its predecessors' output handed to it,
// and the lead writes the closing brief. Sequential-with-handoff is chosen deliberately —
// it keeps the information flow auditable (every handoff is a row in kuze.agent_messages)
// and keeps cost proportional to the roster instead of to the square of it.
//
// A member that refuses or fails does not abort the team. Its failure is handed downstream
// as a fact, and the final brief has to account for it.

import { messagesCreate } from '../inference/messagesCreate.js'
import { supabaseAdmin } from '../supabaseAdmin.js'
import { runAgent } from './runner.js'
import type { RunRow, TeamWithRoster, TranscriptEntry } from './types.js'

const db = () => supabaseAdmin.schema('kuze')

export interface TeamRunResult {
  run: RunRow
  brief: string
  memberRuns: Array<{ agent_key: string; seat: string; status: string; output: string }>
}

interface Assignment {
  agent_key: string
  seat: string
  subtask: string
}

function parseJsonArray(raw: string): unknown[] | null {
  const match = raw.replace(/```(?:json)?/gi, '').match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Split the goal across the roster. Falls back to handing every seat the goal verbatim if
 * the planner returns nothing usable — a degraded plan is better than a dead team run.
 */
async function planTeamWork(team: TeamWithRoster, objective: string): Promise<Assignment[]> {
  const roster = team.members
    .map((m, i) => `${i + 1}. ${m.agent.agent_key} — seat: "${m.seat}" — role: ${m.agent.role}`)
    .join('\n')

  const system =
    'You are a chief of staff assigning work across a small team. Each member runs once, in the order listed, and can see the output of everyone before them. Split the goal so no two members do the same work and nothing important is unowned. Output ONLY a JSON array.'

  const user = [
    `Team: ${team.name}`,
    `Team mission: ${team.mission}`,
    '',
    'Roster (execution order):',
    roster,
    '',
    `Goal for this run: ${objective}`,
    '',
    'Return a JSON array with one object per roster member, in the same order:',
    '[{ "agent_key": "...", "subtask": "the specific, concrete assignment for this member" }]',
    '',
    'Each subtask must be actionable on its own and must state what the member should hand to the next seat.',
  ].join('\n')

  let assignments: Assignment[] = []
  try {
    const result = await messagesCreate({
      tier: 'balanced',
      max_tokens: 2_048,
      system,
      messages: [{ role: 'user', content: user }],
      stream: false,
    })
    const text =
      (result as { content: Array<{ type: string; text?: string }> }).content.find((b) => b.type === 'text')
        ?.text ?? ''
    const arr = parseJsonArray(text) ?? []
    const byKey = new Map(arr.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => [String(x.agent_key ?? ''), String(x.subtask ?? '')]))

    assignments = team.members.map((m) => ({
      agent_key: m.agent.agent_key,
      seat: m.seat,
      subtask: byKey.get(m.agent.agent_key)?.trim() || objective,
    }))
  } catch (e) {
    console.error('[agents/orchestrator] planning failed, falling back to the raw goal:', (e as Error).message)
    assignments = team.members.map((m) => ({ agent_key: m.agent.agent_key, seat: m.seat, subtask: objective }))
  }

  return assignments
}

async function bus(args: {
  runId: string
  teamId: string
  from: string
  to: string
  kind: 'assignment' | 'handoff' | 'result'
  content: string
}): Promise<void> {
  const { error } = await db().from('agent_messages').insert({
    run_id: args.runId,
    team_id: args.teamId,
    from_agent: args.from,
    to_agent: args.to,
    kind: args.kind,
    content: args.content,
  })
  if (error) console.error('[agents/orchestrator] bus write failed:', error.message)
}

/** Run a whole team against one goal and return the lead's closing brief. */
export async function runTeam(args: {
  team: TeamWithRoster
  objective: string
  trigger?: 'manual' | 'chat' | 'task' | 'schedule'
  taskId?: string | null
}): Promise<TeamRunResult> {
  const { team, objective } = args

  if (team.status !== 'active') throw new Error(`team "${team.team_key}" is ${team.status}`)
  const runnable = team.members.filter((m) => m.agent.status === 'active')
  if (runnable.length === 0) {
    throw new Error(`team "${team.team_key}" has no active members — every seat is still awaiting review`)
  }

  const { data: created, error } = await db()
    .from('agent_runs')
    .insert({
      team_id: team.id,
      task_id: args.taskId ?? null,
      trigger: args.trigger === 'schedule' || args.trigger === 'task' ? args.trigger : 'manual',
      objective,
      status: 'running',
    })
    .select('*')
    .single()
  if (error || !created) throw new Error(`runTeam: could not open team run — ${error?.message}`)
  const teamRun = created as RunRow

  const plan = await planTeamWork({ ...team, members: runnable }, objective)
  const transcript: TranscriptEntry[] = [
    { step: 0, kind: 'objective', actor: team.team_key, content: objective },
    { step: 0, kind: 'plan', actor: 'planner', content: JSON.stringify(plan, null, 2) },
  ]

  const memberRuns: TeamRunResult['memberRuns'] = []
  const handoffs: string[] = []

  for (const [i, member] of runnable.entries()) {
    const assignment = plan[i] ?? { agent_key: member.agent.agent_key, seat: member.seat, subtask: objective }

    await bus({
      runId: teamRun.id,
      teamId: team.id,
      from: 'kuze',
      to: member.agent.agent_key,
      kind: 'assignment',
      content: assignment.subtask,
    })

    const context = [
      `Team goal: ${objective}`,
      `Your seat on this team: ${member.seat}`,
      handoffs.length > 0 ? `\nWhat your teammates produced before you:\n\n${handoffs.join('\n\n---\n\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    let output = ''
    let status = 'completed'
    try {
      const result = await runAgent({
        agent: member.agent,
        objective: assignment.subtask,
        context,
        trigger: 'team',
        teamId: team.id,
        parentRunId: teamRun.id,
        taskId: args.taskId ?? null,
        bypassCap: false,
      })
      output = result.output
      status = result.run.status
      if (result.refused) output = `[refused] ${result.refusalReason ?? 'Sentinel blocked this output'}`
    } catch (e) {
      status = 'failed'
      output = `[failed] ${(e as Error).message}`
    }

    memberRuns.push({ agent_key: member.agent.agent_key, seat: member.seat, status, output })
    const handoff = `## ${member.agent.name} (${member.seat}) — ${status}\n${output}`
    handoffs.push(handoff)

    const next = runnable[i + 1]
    await bus({
      runId: teamRun.id,
      teamId: team.id,
      from: member.agent.agent_key,
      to: next ? next.agent.agent_key : 'kuze',
      kind: next ? 'handoff' : 'result',
      content: output,
    })

    transcript.push({ step: i + 1, kind: 'handoff', actor: member.agent.agent_key, content: output })
  }

  const brief = await synthesizeBrief(team, objective, handoffs)
  transcript.push({ step: runnable.length + 1, kind: 'output', actor: 'lead', content: brief })

  const anyFailed = memberRuns.some((m) => m.status === 'failed' || m.status === 'refused')

  const { data: finished, error: finErr } = await db()
    .from('agent_runs')
    .update({
      status: 'completed',
      output: brief,
      transcript,
      iterations: runnable.length,
      error: anyFailed ? 'one or more seats did not complete — see the brief' : null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', teamRun.id)
    .select('*')
    .single()
  if (finErr) console.error('[agents/orchestrator] failed to close team run:', finErr.message)

  return { run: (finished ?? teamRun) as RunRow, brief, memberRuns }
}

/**
 * The closing brief. Written by the lead agent's charter when the team has one, otherwise
 * by Kuze directly. Explicitly told to surface disagreement rather than average it away —
 * a team whose members conflict is information, not noise.
 */
async function synthesizeBrief(team: TeamWithRoster, objective: string, handoffs: string[]): Promise<string> {
  const lead = team.members.find((m) => m.agent.id === team.lead_agent_id)?.agent

  const system = lead
    ? `You are ${lead.name}, leading the "${team.name}" team. Your charter:\n\n${lead.charter}\n\nYou are writing the closing brief for Brandon, a solo founder. Be direct and short.`
    : `You are Kuze, Brandon's AI twin, closing out a run of the "${team.name}" team. Write the brief for Brandon, a solo founder. Be direct and short.`

  const user = [
    `Team mission: ${team.mission}`,
    `Goal for this run: ${objective}`,
    '',
    'What each seat produced:',
    '',
    handoffs.join('\n\n---\n\n'),
    '',
    'Write the closing brief:',
    '1. The answer or outcome, up front, in two or three sentences.',
    '2. What each seat contributed that actually mattered (skip the ones that did not).',
    '3. Where the seats disagreed or where a seat failed — name it, do not smooth it over.',
    '4. The decisions Brandon has to make, and what you recommend for each.',
    '',
    'No preamble. No restating the goal.',
  ].join('\n')

  try {
    const result = await messagesCreate({
      tier: 'balanced',
      max_tokens: 4_096,
      system,
      messages: [{ role: 'user', content: user }],
      stream: false,
    })
    return (
      (result as { content: Array<{ type: string; text?: string }> }).content.find((b) => b.type === 'text')
        ?.text ?? ''
    )
  } catch (e) {
    console.error('[agents/orchestrator] brief synthesis failed:', (e as Error).message)
    // Never lose the members' work to a synthesis failure — hand back the raw handoffs.
    return `Brief synthesis failed (${(e as Error).message}). Raw output from each seat:\n\n${handoffs.join('\n\n---\n\n')}`
  }
}
