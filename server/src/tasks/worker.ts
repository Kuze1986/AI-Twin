import { getIdentity, getModeConfig, getTopLongTermMemory } from '../data.js'
import { messagesCreate } from '../inference/messagesCreate.js'
import { buildSystemPrompt } from '../promptBuilder.js'
import { supabaseAdmin } from '../supabaseAdmin.js'
import type { ChatMode } from '../types.js'
import type { ValidatorContext } from '../validators/index.js'
import { generateEnforcedDraft } from '../email/enforce.js'
import { getAgent, getTeam } from '../agents/registry.js'
import { runAgent } from '../agents/runner.js'
import { runTeam } from '../agents/orchestrator.js'

interface Lead {
  email: string
  name?: string
  company?: string
}

interface TaskRow {
  id: string
  title: string
  type: 'outreach_campaign' | 'follow_up' | 'custom' | 'agent_run' | 'team_run'
  goal: string
  status: string
  payload: { leads?: Lead[]; target_key?: string; [k: string]: unknown }
}

let running = false

function normalizeSubject(subject: string): string {
  return subject.replace(/^(\s*(re|fwd?|aw|sv)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function snippetOf(text: string, len = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > len ? `${clean.slice(0, len)}…` : clean
}

async function setTask(id: string, patch: Record<string, unknown>): Promise<void> {
  await supabaseAdmin
    .schema('kuze')
    .from('tasks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
}

async function setItem(id: string, patch: Record<string, unknown>): Promise<void> {
  await supabaseAdmin
    .schema('kuze')
    .from('task_items')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
}

/**
 * Drain the task queue: claim queued tasks and run them. Guarded so overlapping ticks
 * never process the same task twice. Non-throwing — per-task failures are recorded on
 * the row and the loop continues.
 */
export async function runTaskQueue(): Promise<{ ran: boolean; processed: number }> {
  if (running) return { ran: false, processed: 0 }
  running = true
  let processed = 0

  try {
    const nowIso = new Date().toISOString()
    const { data: tasks } = await supabaseAdmin
      .schema('kuze')
      .from('tasks')
      .select('id, title, type, goal, status, payload')
      .eq('status', 'queued')
      .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
      .order('created_at', { ascending: true })
      .limit(3)

    for (const task of (tasks ?? []) as TaskRow[]) {
      // Atomically claim: only proceed if we flip queued -> running.
      const { data: claimed } = await supabaseAdmin
        .schema('kuze')
        .from('tasks')
        .update({ status: 'running', updated_at: new Date().toISOString() })
        .eq('id', task.id)
        .eq('status', 'queued')
        .select('id')
        .maybeSingle()
      if (!claimed) continue

      processed += 1
      try {
        await runTask(task)
      } catch (e) {
        console.error('[tasks] task failed:', task.id, (e as Error).message)
        await setTask(task.id, { status: 'failed', error: (e as Error).message })
      }
    }
  } finally {
    running = false
  }

  return { ran: true, processed }
}

async function runTask(task: TaskRow): Promise<void> {
  if (task.type === 'agent_run' || task.type === 'team_run') return runFabricTask(task)
  if (task.type === 'custom') return runCustom(task)
  return runCampaign(task)
}

/**
 * Agent Fabric dispatch. The queue is what makes agent and team runs safe to trigger from a
 * chat turn: the turn returns a task id in milliseconds and the minutes of inference happen
 * here, where a failure lands on the task row instead of killing a stream.
 */
async function runFabricTask(task: TaskRow): Promise<void> {
  const targetKey = String(task.payload.target_key ?? '')
  if (!targetKey) {
    await setTask(task.id, { status: 'failed', error: 'task payload is missing target_key' })
    return
  }

  if (task.type === 'agent_run') {
    const agent = await getAgent(targetKey)
    if (!agent) {
      await setTask(task.id, { status: 'failed', error: `no agent with key "${targetKey}"` })
      return
    }
    const result = await runAgent({ agent, objective: task.goal, trigger: 'task', taskId: task.id })
    await setTask(task.id, {
      status: result.refused ? 'failed' : 'completed',
      result: { run_id: result.run.id, agent_key: agent.agent_key, output: result.output },
      error: result.refused ? (result.refusalReason ?? 'Sentinel refused the output') : null,
    })
    console.log(`[tasks] agent run ${task.id} (${agent.agent_key}) → ${result.run.status}`)
    return
  }

  const team = await getTeam(targetKey)
  if (!team) {
    await setTask(task.id, { status: 'failed', error: `no team with key "${targetKey}"` })
    return
  }
  const result = await runTeam({ team, objective: task.goal, trigger: 'task', taskId: task.id })
  await setTask(task.id, {
    status: 'completed',
    result: {
      run_id: result.run.id,
      team_key: team.team_key,
      brief: result.brief,
      members: result.memberRuns.map((m) => ({ agent_key: m.agent_key, status: m.status })),
    },
    error: null,
  })
  console.log(`[tasks] team run ${task.id} (${team.team_key}) → ${result.memberRuns.length} seat(s)`)
}

/** Outreach campaigns and follow-ups: draft one enforced email per lead into the approval queue. */
async function runCampaign(task: TaskRow): Promise<void> {
  const identity = await getIdentity()
  if (!identity) {
    await setTask(task.id, { status: 'failed', error: 'Identity profile missing' })
    return
  }

  // Materialize task_items from the payload lead list on first run.
  const { data: existingItems } = await supabaseAdmin
    .schema('kuze')
    .from('task_items')
    .select('id, contact_email, contact_name, contact_company, status')
    .eq('task_id', task.id)

  let items = existingItems ?? []
  if (items.length === 0) {
    const leads = Array.isArray(task.payload.leads) ? task.payload.leads : []
    if (leads.length === 0) {
      await setTask(task.id, { status: 'failed', error: 'No leads provided in task payload' })
      return
    }
    const rows = leads
      .filter((l) => l.email)
      .map((l) => ({
        task_id: task.id,
        contact_email: l.email.trim().toLowerCase(),
        contact_name: l.name ?? null,
        contact_company: l.company ?? null,
      }))
    const { data: inserted } = await supabaseAdmin
      .schema('kuze')
      .from('task_items')
      .insert(rows)
      .select('id, contact_email, contact_name, contact_company, status')
    items = inserted ?? []
  }

  const modeConfig = await getModeConfig('outreach')
  const ltm = await getTopLongTermMemory(10)
  const mode: ChatMode = 'outreach'

  let drafted = 0
  let failed = 0

  for (const item of items) {
    if (item.status !== 'pending') continue

    // Skip suppressed recipients outright.
    const { data: suppressed } = await supabaseAdmin
      .schema('kuze')
      .from('email_suppression')
      .select('email')
      .eq('email', item.contact_email)
      .maybeSingle()
    if (suppressed) {
      await setItem(item.id, { status: 'skipped', error: 'Recipient is suppressed' })
      continue
    }

    const contactLine = [item.contact_name, item.contact_company && `(${item.contact_company})`, `<${item.contact_email}>`]
      .filter(Boolean)
      .join(' ')

    const contextOverride = [
      '## OUTREACH_TASK',
      `You are writing a ${task.type === 'follow_up' ? 'follow-up' : 'first-touch cold outreach'} email from your inbox (kuze@bioloopnexus.com) on behalf of The Shift.`,
      `Campaign goal: ${task.goal}`,
      `Recipient: ${contactLine}`,
      '',
      'Return the email as exactly this format:',
      'Subject: <a specific, non-spammy subject line>',
      '',
      '<the email body — your voice, concise, one clear ask. No placeholder brackets, no "Dear [Name]". Sign off as yourself.>',
    ].join('\n')

    const systemPrompt = await buildSystemPrompt({ identity, mode, modeConfig, longTermTop: ltm, contextOverride })
    const context: ValidatorContext = { mode, recipientContext: item.contact_email }

    let draft
    try {
      draft = await generateEnforcedDraft({
        systemPrompt,
        messages: [{ role: 'user', content: `Write the outreach email for: ${task.goal}` }],
        context,
      })
    } catch (e) {
      failed += 1
      await setItem(item.id, { status: 'failed', error: (e as Error).message })
      continue
    }

    const { subject, body } = splitSubject(draft.text, task.title)
    const draftStatus = draft.resolution === 'refused' ? 'failed' : 'pending_approval'

    const threadKey = `outreach:${task.id}:${item.contact_email}`
    const { data: thread } = await supabaseAdmin
      .schema('kuze')
      .from('email_threads')
      .upsert(
        { thread_key: threadKey, subject, contact_email: item.contact_email, classification: 'cold', last_message_at: new Date().toISOString() },
        { onConflict: 'thread_key' },
      )
      .select('id')
      .maybeSingle()

    const { data: msg } = await supabaseAdmin
      .schema('kuze')
      .from('email_messages')
      .insert({
        thread_id: thread?.id ?? null,
        direction: 'outbound',
        status: draftStatus,
        from_addr: process.env.KUZE_EMAIL_ADDRESS ?? '',
        to_addr: item.contact_email,
        subject,
        body_text: body,
        snippet: snippetOf(body),
        classification: 'cold',
        sentinel_resolution: draft.resolution,
        error: draft.resolution === 'refused' ? draft.refusalReason : null,
      })
      .select('id')
      .maybeSingle()

    if (draft.resolution === 'refused') {
      failed += 1
      await setItem(item.id, { status: 'failed', draft_message_id: msg?.id ?? null, error: draft.refusalReason ?? 'Sentinel refused' })
    } else {
      drafted += 1
      await setItem(item.id, { status: 'drafted', draft_message_id: msg?.id ?? null, error: null })
    }
  }

  const finalStatus = drafted > 0 ? 'awaiting_approval' : 'completed'
  await setTask(task.id, {
    status: finalStatus,
    result: { drafted, failed, total: items.length },
    error: null,
  })
  console.log(`[tasks] campaign ${task.id}: ${drafted} drafted, ${failed} failed → ${finalStatus}`)
}

/** Custom one-off: Kuze produces a text answer for the goal, enforced, stored in result. */
async function runCustom(task: TaskRow): Promise<void> {
  const identity = await getIdentity()
  if (!identity) {
    await setTask(task.id, { status: 'failed', error: 'Identity profile missing' })
    return
  }
  const modeConfig = await getModeConfig('ops')
  const ltm = await getTopLongTermMemory(10)
  const mode: ChatMode = 'ops'
  const systemPrompt = await buildSystemPrompt({ identity, mode, modeConfig, longTermTop: ltm })
  const context: ValidatorContext = { mode }

  const draft = await generateEnforcedDraft({
    systemPrompt,
    messages: [{ role: 'user', content: task.goal }],
    context,
  })

  if (draft.resolution === 'refused') {
    await setTask(task.id, { status: 'failed', error: draft.refusalReason ?? 'Sentinel refused the output' })
    return
  }
  await setTask(task.id, { status: 'completed', result: { output: draft.text }, error: null })
}

function splitSubject(text: string, fallbackSubject: string): { subject: string; body: string } {
  const match = text.match(/^\s*subject:\s*(.+?)\s*(?:\n|$)/i)
  if (match) {
    const subject = match[1].trim()
    const body = text.slice(match.index! + match[0].length).replace(/^\s+/, '')
    return { subject, body: body || text }
  }
  return { subject: fallbackSubject, body: text }
}
