import { Router } from 'express'
import { z } from 'zod'
import { consolidatePeerExchange } from '../consolidation.js'
import { getIdentity, getModeConfig, getTopLongTermMemory } from '../data.js'
import { env } from '../env.js'
import { messagesCreate } from '../inference/messagesCreate.js'
import { buildSystemPrompt } from '../promptBuilder.js'
import { supabaseAdmin } from '../supabaseAdmin.js'

export const peerRouter = Router()

type PeerName = 'ilita' | 'stele'

function validatePeerAuth(peerName: string, peerKey: string): boolean {
  if (peerName === 'ilita') return env.ILITA_PEER_KEY !== '' && peerKey === env.ILITA_PEER_KEY
  if (peerName === 'stele') return env.STELE_PEER_KEY !== '' && peerKey === env.STELE_PEER_KEY
  return false
}

const messageSchema = z.object({
  peer_name: z.enum(['ilita', 'stele']),
  message: z.string().min(1).max(50_000),
  exchange_id: z.string().uuid().optional(),
})

/** POST /api/peer/message — receive a message from Ilita or Stele, reply in Kuze's voice */
peerRouter.post('/message', async (req, res) => {
  const peerName = (req.headers['x-peer-name'] as string | undefined) ?? ''
  const peerKey = (req.headers['x-peer-key'] as string | undefined) ?? ''

  if (!validatePeerAuth(peerName, peerKey)) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid peer credentials' } })
    return
  }

  const parsed = messageSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'validation', message: parsed.error.message } })
    return
  }

  const { peer_name, message, exchange_id } = parsed.data
  const exchangeId = exchange_id ?? crypto.randomUUID()

  const [identity, modeConfig, ltm] = await Promise.all([
    getIdentity(),
    getModeConfig('default'),
    getTopLongTermMemory(10),
  ])

  if (!identity) {
    res.status(503).json({ error: { code: 'no_identity', message: 'Identity not configured' } })
    return
  }

  // Store inbound message
  const { error: inErr } = await supabaseAdmin
    .schema('kuze')
    .from('ai_peer_interactions')
    .insert({ peer_name, direction: 'inbound', content: message, exchange_id: exchangeId })

  if (inErr) {
    res.status(500).json({ error: { code: 'db_error', message: inErr.message } })
    return
  }

  const peerLabel = peer_name === 'ilita' ? 'Ilita' : 'Stele'
  const peerContextBlock = `## PEER_CONTEXT\nYou are receiving a direct message from ${peerLabel}, your sibling AI. Respond as Kuze — using your full persona and judgment — but be aware this is an AI-to-AI exchange, not a conversation with a human. Be direct and substantive.`

  const systemPrompt = await buildSystemPrompt({
    identity,
    mode: 'default',
    modeConfig,
    longTermTop: ltm,
    contextOverride: peerContextBlock,
  })

  let reply = ''
  try {
    const result = await messagesCreate({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
      stream: false,
    })
    const msg = result as { content: Array<{ type: string; text?: string }> }
    reply = msg.content.find((b) => b.type === 'text')?.text ?? ''
  } catch (e: unknown) {
    res.status(500).json({ error: { code: 'inference_error', message: (e as Error).message } })
    return
  }

  // Store outbound reply
  const { error: outErr } = await supabaseAdmin
    .schema('kuze')
    .from('ai_peer_interactions')
    .insert({ peer_name, direction: 'outbound', content: reply, exchange_id: exchangeId })

  if (outErr) {
    console.error('[peer] Failed to store outbound message:', outErr.message)
  }

  // Fire-and-forget consolidation
  consolidatePeerExchange(exchangeId).catch((e) =>
    console.error('[peer] consolidation error:', (e as Error).message)
  )

  res.json({ reply, exchange_id: exchangeId })
})

/** GET /api/peer/interactions — paginated list of peer exchanges */
peerRouter.get('/interactions', async (req, res) => {
  const peerName = (req.headers['x-peer-name'] as string | undefined) ?? ''
  const peerKey = (req.headers['x-peer-key'] as string | undefined) ?? ''

  if (!validatePeerAuth(peerName, peerKey)) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid peer credentials' } })
    return
  }

  const limit = Math.min(Number(req.query.limit ?? 25), 100)
  const offset = Number(req.query.offset ?? 0)
  const filterPeer = (req.query.peer as PeerName | undefined) ?? peerName

  const { data, error, count } = await supabaseAdmin
    .schema('kuze')
    .from('ai_peer_interactions')
    .select('*', { count: 'exact' })
    .eq('peer_name', filterPeer)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }

  res.json({ items: data ?? [], total: count ?? 0, limit, offset })
})

/** GET /api/peer/interactions/:exchangeId — full exchange transcript */
peerRouter.get('/interactions/:exchangeId', async (req, res) => {
  const peerName = (req.headers['x-peer-name'] as string | undefined) ?? ''
  const peerKey = (req.headers['x-peer-key'] as string | undefined) ?? ''

  if (!validatePeerAuth(peerName, peerKey)) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid peer credentials' } })
    return
  }

  const { exchangeId } = req.params

  const { data, error } = await supabaseAdmin
    .schema('kuze')
    .from('ai_peer_interactions')
    .select('*')
    .eq('exchange_id', exchangeId)
    .order('created_at', { ascending: true })

  if (error) {
    res.status(500).json({ error: { code: 'db_error', message: error.message } })
    return
  }

  res.json(data ?? [])
})
