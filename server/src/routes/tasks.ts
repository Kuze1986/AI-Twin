import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../adminMiddleware.js'
import { supabaseAdmin } from '../supabaseAdmin.js'
import { createTask, parseLeadsText, type Lead } from '../tasks/create.js'

export const tasksRouter = Router()

tasksRouter.use(requireAdmin)

const leadSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  company: z.string().optional(),
})

const createSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(['outreach_campaign', 'follow_up', 'custom']),
  goal: z.string().min(1).max(10_000),
  leads: z.array(leadSchema).optional(),
  leads_text: z.string().max(100_000).optional(),
  scheduled_for: z.string().datetime().optional(),
})

/** POST / — queue a new task. */
tasksRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }
  const { title, type, goal, leads, leads_text, scheduled_for } = parsed.data

  const parsedLeads: Lead[] = [
    ...(leads ?? []),
    ...(leads_text ? parseLeadsText(leads_text) : []),
  ]

  if ((type === 'outreach_campaign' || type === 'follow_up') && parsedLeads.length === 0) {
    res.status(400).json({ error: { code: 'no_leads', message: 'Outreach tasks need at least one valid lead email' } })
    return
  }

  try {
    const task = await createTask({ title, type, goal, leads: parsedLeads, source: 'admin', scheduledFor: scheduled_for })
    res.json({ task, lead_count: parsedLeads.length })
  } catch (e) {
    res.status(500).json({ error: { code: 'db_error', message: (e as Error).message } })
  }
})

/** GET / — recent tasks. */
tasksRouter.get('/', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .schema('kuze')
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json({ items: data ?? [] })
})

/** GET /active-count — queued + running, for the nav badge. */
tasksRouter.get('/active-count', async (_req, res) => {
  const { count, error } = await supabaseAdmin
    .schema('kuze')
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'running', 'awaiting_approval'])

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json({ count: count ?? 0 })
})

/** GET /:id — task with its per-lead items. */
tasksRouter.get('/:id', async (req, res) => {
  const { data: task, error: tErr } = await supabaseAdmin
    .schema('kuze')
    .from('tasks')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle()

  if (tErr || !task) {
    res.status(404).json({ error: { code: 'not_found', message: 'Task not found' } })
    return
  }

  const { data: items } = await supabaseAdmin
    .schema('kuze')
    .from('task_items')
    .select('*')
    .eq('task_id', req.params.id)
    .order('created_at', { ascending: true })

  res.json({ task, items: items ?? [] })
})

/** POST /:id/cancel — cancel a task that has not finished. */
tasksRouter.post('/:id/cancel', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .schema('kuze')
    .from('tasks')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .in('status', ['queued', 'running', 'awaiting_approval'])
    .select('id')
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  if (!data) {
    res.status(409).json({ error: { code: 'invalid_state', message: 'Task cannot be cancelled in its current state' } })
    return
  }
  res.json({ ok: true })
})

/** POST /:id/retry — requeue a failed task. */
tasksRouter.post('/:id/retry', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .schema('kuze')
    .from('tasks')
    .update({ status: 'queued', error: null, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'failed')
    .select('id')
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  if (!data) {
    res.status(409).json({ error: { code: 'invalid_state', message: 'Only failed tasks can be retried' } })
    return
  }
  res.json({ ok: true })
})
