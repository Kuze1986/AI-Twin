import { env } from './env.js'
import { messagesCreate } from './inference/messagesCreate.js'
import { supabaseAdmin } from './supabaseAdmin.js'

interface ExtractedMemory {
  category: string
  summary: string
  weight: number
}

const validCategories = new Set([
  'relationship',
  'preference',
  'decision',
  'fact',
  'context',
  'ai_peer',
])

function parseJsonArray(raw: string): ExtractedMemory[] {
  const trimmed = raw.trim()
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/)
  const slice = jsonMatch ? jsonMatch[0] : trimmed
  const parsed = JSON.parse(slice) as unknown
  if (!Array.isArray(parsed)) return []
  const out: ExtractedMemory[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const cat = String(o.category ?? 'fact')
    const category = validCategories.has(cat) ? cat : 'fact'
    const summary = String(o.summary ?? '').trim()
    const w = Number(o.weight)
    const weight = Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0.5
    if (summary.length > 0) out.push({ category, summary, weight })
  }
  return out
}

export async function consolidateSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: sessionRow, error: se } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, consolidated_at')
    .eq('id', sessionId)
    .maybeSingle()

  if (se || !sessionRow) return { ok: false, error: 'session_not_found' }
  if (sessionRow.consolidated_at) return { ok: true }

  const { data: rows, error: me } = await supabaseAdmin
    .from('twin_memory')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (me) return { ok: false, error: me.message }

  const transcript = (rows ?? [])
    .map((r) => `${r.role.toUpperCase()}: ${r.content}`)
    .join('\n\n')

  if (!transcript.trim()) {
    await supabaseAdmin
      .from('chat_sessions')
      .update({ consolidated_at: new Date().toISOString() })
      .eq('id', sessionId)
    return { ok: true }
  }

  const userPrompt = `Conversation transcript:\n\n${transcript}\n\nReturn a JSON array only (no markdown) of objects with keys: category (one of relationship, preference, decision, fact, context), summary (short, specific), weight (0-1 importance). Extract only durable insights worth recalling in future sessions. If nothing new, return [].`

  let textOut = ''
  try {
    const msg = await messagesCreate({
      tier: 'fast',
      max_tokens: 4096,
      system: 'You output only valid JSON arrays. No prose, no markdown fences.',
      messages: [{ role: 'user', content: userPrompt }],
    })
    const block = msg.content.find((b: { type: string }) => b.type === 'text')
    if (block && block.type === 'text') textOut = block.text
  } catch (e: unknown) {
    const err = e as Error
    return { ok: false, error: err.message ?? 'claude_error' }
  }

  let items: ExtractedMemory[] = []
  try {
    items = parseJsonArray(textOut)
  } catch {
    return { ok: false, error: 'parse_failed' }
  }

  for (const it of items) {
    const { error: insErr } = await supabaseAdmin.from('long_term_memory_global').insert({
      category: it.category,
      summary: it.summary,
      weight: it.weight,
      source_session_id: sessionId,
    })
    if (insErr) return { ok: false, error: insErr.message }
  }

  const { error: upErr } = await supabaseAdmin
    .from('chat_sessions')
    .update({ consolidated_at: new Date().toISOString() })
    .eq('id', sessionId)

  if (upErr) return { ok: false, error: upErr.message }
  return { ok: true }
}

export async function consolidatePeerExchange(exchangeId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: rows, error: fe } = await supabaseAdmin
    .schema('kuze')
    .from('ai_peer_interactions')
    .select('peer_name, direction, content, created_at')
    .eq('exchange_id', exchangeId)
    .order('created_at', { ascending: true })

  if (fe) return { ok: false, error: fe.message }
  if (!rows || rows.length === 0) return { ok: true }

  const peerName = (rows[0] as { peer_name: string }).peer_name
  const transcript = rows
    .map((r: { direction: string; content: string }) =>
      `${r.direction === 'inbound' ? peerName.toUpperCase() : 'KUZE'}: ${r.content}`
    )
    .join('\n\n')

  const userPrompt = `This is an exchange between Kuze and ${peerName} (a sibling AI):\n\n${transcript}\n\nReturn a JSON array only (no markdown) of objects with keys: category (one of relationship, preference, decision, fact, context, ai_peer), summary (short, specific, note the peer involved), weight (0-1 importance). Extract only durable insights worth recalling in future sessions. If nothing new, return [].`

  let textOut = ''
  try {
    const msg = await messagesCreate({
      tier: 'fast',
      max_tokens: 2048,
      system: 'You output only valid JSON arrays. No prose, no markdown fences.',
      messages: [{ role: 'user', content: userPrompt }],
    })
    const block = msg.content.find((b: { type: string }) => b.type === 'text')
    if (block && block.type === 'text') textOut = block.text
  } catch (e: unknown) {
    return { ok: false, error: (e as Error).message ?? 'claude_error' }
  }

  let items: ExtractedMemory[] = []
  try {
    items = parseJsonArray(textOut)
  } catch {
    return { ok: false, error: 'parse_failed' }
  }

  for (const it of items) {
    const summary = it.summary.startsWith(`[from ${peerName}`)
      ? it.summary
      : `[from ${peerName} exchange] ${it.summary}`
    const { error: insErr } = await supabaseAdmin.from('long_term_memory_global').insert({
      category: it.category,
      summary,
      weight: it.weight,
    })
    if (insErr) return { ok: false, error: insErr.message }
  }

  if (items.length > 0) {
    const combinedSummary = items.map((i) => i.summary).join('; ')
    await supabaseAdmin
      .schema('kuze')
      .from('ai_peer_interactions')
      .update({ summary: combinedSummary })
      .eq('exchange_id', exchangeId)
  }

  return { ok: true }
}

export async function sweepStaleSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - env.INACTIVITY_MS).toISOString()
  const { data: sessions, error } = await supabaseAdmin
    .from('chat_sessions')
    .select('id')
    .is('consolidated_at', null)
    .lt('last_activity_at', cutoff)
    .limit(25)

  if (error) {
    console.error('[consolidation] list error', error.message)
    return
  }

  for (const s of sessions ?? []) {
    const r = await consolidateSession(s.id)
    if (!r.ok) console.error('[consolidation] session', s.id, r.error)
  }
}
