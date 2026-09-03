// Agent Fabric — spawning.
//
// Brandon (or Kuze, from chat) describes a seat in plain language; the fast model turns that
// into a structured charter, which is validated, persisted as pending_review, and sent to
// Ilita. The model authors *intent and scope*. It never authors capability: the allowlist is
// intersected with the real registry in `createAgent`, and autonomy above 'draft' has to
// survive Ilita's review.

import { z } from 'zod'
import { messagesCreate } from '../inference/messagesCreate.js'
import { listDelegableTools } from '../tools/registry.js'
import { applyGovernanceVerdict, createAgent, updateAgent } from './registry.js'
import { reviewCharter } from './governance.js'
import type { AgentRow, AgentSpec } from './types.js'

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

function parseJsonObject(raw: string): unknown {
  const fenced = raw.replace(/```(?:json)?/gi, '')
  const match = fenced.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

/** Turn a plain-language description of a seat into a validated charter spec. */
export async function draftAgentSpec(description: string): Promise<AgentSpec> {
  const catalog = listDelegableTools()
  const catalogBlock =
    catalog.length > 0
      ? catalog.map((t) => `- ${t.name}: ${t.description.split('\n')[0]}`).join('\n')
      : '(no tools are currently available — the agent must work from reasoning and context alone)'

  const system = [
    'You design charters for autonomous business agents that work for a solo founder.',
    'A charter is a job description with teeth: it says what the seat owns, how it decides, and what it must never do.',
    '',
    'Rules you must follow:',
    '- Grant the NARROWEST tool set that can do the job. Prefer zero tools over a speculative one.',
    '- Only name tools from the catalog. Never invent tool names.',
    '- Default autonomy to "propose". Use "draft" only when the seat clearly produces artifacts for approval.',
    '  Use "execute" only when the description explicitly asks for the agent to act without per-run approval.',
    '- Guardrails must be concrete prohibitions specific to this seat, not generic safety boilerplate.',
    '- The charter is written in the second person, addressed to the agent.',
    '',
    'Available tools:',
    catalogBlock,
    '',
    'Output ONLY a JSON object. No prose, no markdown fences.',
  ].join('\n')

  const user = [
    'Design an agent for this request:',
    '"""',
    description.trim(),
    '"""',
    '',
    'Return JSON with exactly these keys:',
    '- agent_key: lowercase-hyphenated stable slug',
    '- name: short display name',
    '- role: one sentence — what this seat owns',
    '- mission: the standing objective, 1-3 sentences',
    '- charter: the operating prompt for this agent (second person, 100-400 words)',
    '- tool_allowlist: array of tool names from the catalog (may be empty)',
    '- guardrails: array of concrete "never" statements for this seat',
    '- autonomy: "propose" | "draft" | "execute"',
    '- model_tier: "fast" | "balanced" | "powerful"',
    '- mode: chat mode this agent operates in (use "ops" unless outward-facing, then "outreach")',
    '- max_iterations: integer 1-12, tool round-trips this agent may take per run',
    '- daily_run_cap: integer 1-500',
  ].join('\n')

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

  const obj = parseJsonObject(text)
  if (!obj) throw new Error('agent designer returned no parseable JSON')

  const parsed = specSchema.safeParse(obj)
  if (!parsed.success) throw new Error(`agent designer returned an invalid charter: ${parsed.error.message}`)

  return parsed.data as AgentSpec
}

export interface SpawnResult {
  agent: AgentRow
  droppedTools: string[]
  review: { verdict: string; notes: string; reviewed: boolean }
}

/**
 * Full spawn path: design (if needed) → persist as pending_review → Ilita charter review →
 * activate, hold for revision, or retire. The returned agent row is the post-verdict state,
 * so callers can report honestly whether the seat is live.
 */
export async function spawnAgent(args: {
  description?: string
  spec?: AgentSpec
  createdBy: 'brandon' | 'kuze' | 'ilita'
}): Promise<SpawnResult> {
  if (!args.spec && !args.description?.trim()) {
    throw new Error('spawnAgent needs a description or a spec')
  }
  const spec = args.spec ?? (await draftAgentSpec(args.description ?? ''))

  const { agent, droppedTools } = await createAgent(spec, args.createdBy)

  const review = await reviewCharter(spec)

  // Ilita's required guardrails are appended to the row so they are visible in the agent's
  // own prompt on every run, not just recorded in the review notes.
  if (review.required_guardrails.length > 0) {
    const merged = [...(agent.guardrails ?? []), ...review.required_guardrails]
    await updateAgent(agent.id, { guardrails: merged })
  }

  const finalAgent = await applyGovernanceVerdict(agent.id, review.verdict, review.notes)

  return {
    agent: finalAgent,
    droppedTools,
    review: { verdict: review.verdict, notes: review.notes, reviewed: review.reviewed },
  }
}
