import { supabaseAdmin } from '../supabaseAdmin.js'

export interface Lead {
  email: string
  name?: string
  company?: string
}

export interface CreateTaskInput {
  title: string
  type: 'outreach_campaign' | 'follow_up' | 'custom'
  goal: string
  leads?: Lead[]
  source: 'admin' | 'chat'
  scheduledFor?: string | null
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
      payload: { leads },
      scheduled_for: input.scheduledFor ?? null,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'task insert failed')
  return data as TaskRow
}
