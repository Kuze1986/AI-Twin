import { supabaseAdmin } from '../supabaseAdmin.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface Lead {
  email: string
  name?: string
  company?: string
}

export type TaskType = 'outreach_campaign' | 'follow_up' | 'custom' | 'agent_run' | 'team_run'

export interface CreateTaskInput {
  title: string
  type: TaskType
  goal: string
  leads?: Lead[]
  source: 'admin' | 'chat'
  scheduledFor?: string | null
  /** Extra payload keys, merged alongside `leads`. Agent/team runs carry `target_key` here. */
  payload?: Record<string, unknown>
}

export interface TaskRow {
  id: string
  title: string
  type: string
  goal: string
  status: string
  [k: string]: unknown
}

/**
 * Insert a queued task. Shared by the admin Tasks route and the chat NL path so both
 * produce identical rows the worker can drain. Leads are normalized to lowercase.
 */
export async function createTask(input: CreateTaskInput): Promise<TaskRow> {
  const leads = (input.leads ?? [])
    .filter((l) => l.email)
    .map((l) => ({ email: l.email.trim().toLowerCase(), name: l.name, company: l.company }))

  const { data, error } = await supabaseAdmin
    .schema('kuze')
    .from('tasks')
    .insert({
      title: input.title,
      type: input.type,
      goal: input.goal,
      source: input.source,
      status: 'queued',
      payload: { ...(input.payload ?? {}), leads },
      scheduled_for: input.scheduledFor ?? null,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'task insert failed')
  return data as TaskRow
}

/**
 * Parse a pasted lead list — one per line, "email, name, company" (name/company optional).
 * Shared by the Tasks route and the Agents route so a campaign launched from an agent run
 * accepts exactly the same paste format as one created by hand.
 */
export function parseLeadsText(text: string): Lead[] {
  const out: Lead[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const [email, name, company] = line.split(',').map((s) => s.trim())
    if (!email || !EMAIL_RE.test(email)) continue
    out.push({ email: email.toLowerCase(), name: name || undefined, company: company || undefined })
  }
  return out
}
