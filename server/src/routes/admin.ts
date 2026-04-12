import Anthropic from '@anthropic-ai/sdk'
import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { requireAdmin } from '../adminMiddleware.js'
import { consolidateSession } from '../consolidation.js'
import { env } from '../env.js'
import { supabaseAdmin } from '../supabaseAdmin.js'

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

export const adminRouter = Router()

adminRouter.post('/login', (req, res) => {
  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }
  if (!env.ADMIN_PASSWORD) {
    res.status(503).json({
      error: { code: 'admin_disabled', message: 'Set ADMIN_PASSWORD in environment' },
    })
    return
  }
  if (parsed.data.password !== env.ADMIN_PASSWORD) {
    res.status(401).json({ error: { code: 'invalid', message: 'Invalid password' } })
    return
  }
  req.session!.admin = true
  res.json({ ok: true })
})

adminRouter.post('/logout', (req, res) => {
  req.session?.destroy((err) => {
    if (err) {
      res.status(500).json({ error: { code: 'logout_failed', message: err.message } })
      return
    }
    res.json({ ok: true })
  })
})

adminRouter.get('/identity', requireAdmin, async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('identity_profile')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  if (!data) {
    res.status(404).json({ error: { code: 'not_found', message: 'No identity' } })
    return
  }
  res.json(data)
})

const identityPut = z.object({
  twin_name: z.string().min(1),
  persona_prompt: z.string(),
  context_blocks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      tags: z.array(z.string()).optional(),
    }),
  ),
  behavioral_rules: z.record(z.string(), z.unknown()),
})

adminRouter.put('/identity', requireAdmin, async (req, res) => {
  const parsed = identityPut.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }

  const { data: current } = await supabaseAdmin
    .from('identity_profile')
    .select('id, version, persona_prompt, context_blocks, behavioral_rules')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!current) {
    res.status(404).json({ error: { code: 'not_found', message: 'No identity' } })
    return
  }

  const nextVersion = (current.version ?? 1) + 1

  const { error: histErr } = await supabaseAdmin.from('identity_profile_history').insert({
    identity_profile_id: current.id,
    persona_prompt: current.persona_prompt,
    context_blocks: current.context_blocks,
    behavioral_rules: current.behavioral_rules,
    version: current.version ?? 1,
  })
  if (histErr) {
    res.status(500).json({ error: { code: 'db_error', message: histErr.message } })
    return
  }

  const { data: updated, error: upErr } = await supabaseAdmin
    .from('identity_profile')
    .update({
      twin_name: parsed.data.twin_name,
      persona_prompt: parsed.data.persona_prompt,
      context_blocks: parsed.data.context_blocks,
      behavioral_rules: parsed.data.behavioral_rules,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', current.id)
    .select()
    .single()

  if (upErr || !updated) {
    res.status(500).json({ error: { code: 'db_error', message: upErr?.message ?? 'update failed' } })
    return
  }
  res.json(updated)
})

adminRouter.get('/identity/history', requireAdmin, async (_req, res) => {
  const { data: idRow } = await supabaseAdmin
    .from('identity_profile')
    .select('id')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!idRow) {
    res.json([])
    return
  }
  const { data, error } = await supabaseAdmin
    .from('identity_profile_history')
    .select('*')
    .eq('identity_profile_id', idRow.id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json(data ?? [])
})

adminRouter.get('/modes', requireAdmin, async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('mode_config').select('*').order('mode')
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json(data ?? [])
})

const modePut = z.object({
  system_injection: z.string(),
  context_block_tag: z.string().nullable().optional(),
})

adminRouter.put('/modes/:mode', requireAdmin, async (req, res) => {
  const mode = req.params.mode
  const parsed = modePut.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }
  const { data, error } = await supabaseAdmin
    .from('mode_config')
    .update({
      system_injection: parsed.data.system_injection,
      context_block_tag: parsed.data.context_block_tag ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('mode', mode)
    .select()
    .single()
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json(data)
})

adminRouter.get('/long-term-memory', requireAdmin, async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('long_term_memory_global')
    .select('*')
    .order('weight', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json(data ?? [])
})

const ltmPost = z.object({
  category: z.enum(['relationship', 'preference', 'decision', 'fact', 'context']),
  summary: z.string().min(1),
  weight: z.number().min(0).max(1).optional(),
})

adminRouter.post('/long-term-memory', requireAdmin, async (req, res) => {
  const parsed = ltmPost.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }
  const { data, error } = await supabaseAdmin
    .from('long_term_memory_global')
    .insert({
      category: parsed.data.category,
      summary: parsed.data.summary,
      weight: parsed.data.weight ?? 0.5,
    })
    .select()
    .single()
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json(data)
})

const ltmPut = z.object({
  summary: z.string().min(1),
  weight: z.number().min(0).max(1),
  category: z.enum(['relationship', 'preference', 'decision', 'fact', 'context']),
})

adminRouter.put('/long-term-memory/:id', requireAdmin, async (req, res) => {
  const parsed = ltmPut.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }
  const { data, error } = await supabaseAdmin
    .from('long_term_memory_global')
    .update({
      summary: parsed.data.summary,
      weight: parsed.data.weight,
      category: parsed.data.category,
    })
    .eq('id', req.params.id)
    .select()
    .single()
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json(data)
})

adminRouter.delete('/long-term-memory/:id', requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from('long_term_memory_global').delete().eq('id', req.params.id)
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json({ ok: true })
})

adminRouter.get('/sessions', requireAdmin, async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('chat_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json(data ?? [])
})

adminRouter.get('/sessions/:id/transcript', requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('twin_memory')
    .select('*')
    .eq('session_id', req.params.id)
    .order('created_at', { ascending: true })
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json(data ?? [])
})

adminRouter.patch('/sessions/:id', requireAdmin, async (req, res) => {
  const parsed = z.object({ flagged_for_memory: z.boolean() }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }
  const { data, error } = await supabaseAdmin
    .from('chat_sessions')
    .update({ flagged_for_memory: parsed.data.flagged_for_memory })
    .eq('id', req.params.id)
    .select()
    .single()
  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }
  res.json(data)
})

adminRouter.post('/sessions/:id/consolidate', requireAdmin, async (req, res) => {
  const r = await consolidateSession(req.params.id)
  if (!r.ok) {
    res.status(500).json({ error: { code: 'consolidation_failed', message: r.error ?? 'unknown' } })
    return
  }
  res.json({ ok: true })
})

const maybeUploadFile = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers['content-type']?.includes('multipart/form-data')) {
    upload.single('file')(req, res, next)
  } else {
    next()
  }
}

adminRouter.post('/calibrate/analyze', requireAdmin, maybeUploadFile, async (req, res) => {
  let corpus = typeof req.body?.text === 'string' ? req.body.text : ''
  if (req.file?.buffer) {
    corpus += (corpus ? '\n\n' : '') + req.file.buffer.toString('utf8')
  }
  corpus = corpus.trim()
  if (!corpus) {
    res.status(400).json({ error: { code: 'validation', message: 'Provide text or file' } })
    return
  }

  const instruction = `Analyze this writing. Extract and return ONLY valid JSON (no markdown fences) with keys:
sentence_length_patterns (string),
vocabulary_tier (string),
rhetorical_devices (array of strings),
emotional_register (string),
hedging_vs_directness (string),
structural_preferences (string),
humor_style (string),
signature_phrases (array of exactly 10 strings).
Writing samples:\n\n${corpus.slice(0, 200_000)}`

  try {
    const msg = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: 'You output only compact JSON objects. No markdown.',
      messages: [{ role: 'user', content: instruction }],
    })
    const block = msg.content.find((b) => b.type === 'text')
    const text = block && block.type === 'text' ? block.text : ''
    let parsedJson: unknown
    try {
      const m = text.match(/\{[\s\S]*\}/)
      parsedJson = JSON.parse(m ? m[0] : text)
    } catch {
      res.status(502).json({ error: { code: 'parse_failed', message: 'Could not parse Claude response' } })
      return
    }
    res.json({ style_fingerprint: parsedJson })
  } catch (e: unknown) {
    const err = e as Error
    res.status(502).json({ error: { code: 'claude_error', message: err.message } })
  }
})

const applyFp = z.object({
  style_fingerprint: z.record(z.string(), z.unknown()),
})

adminRouter.post('/calibrate/apply', requireAdmin, async (req, res) => {
  const parsed = applyFp.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }
  const { data: current } = await supabaseAdmin
    .from('identity_profile')
    .select('id')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!current) {
    res.status(404).json({ error: { code: 'not_found', message: 'No identity' } })
    return
  }
  const { data, error } = await supabaseAdmin
    .from('identity_profile')
    .update({
      style_fingerprint: parsed.data.style_fingerprint,
      updated_at: new Date().toISOString(),
    })
    .eq('id', current.id)
    .select()
    .single()
  if (error || !data) {
    res.status(500).json({ error: { code: 'db_error', message: error?.message ?? 'update failed' } })
    return
  }
  res.json(data)
})
