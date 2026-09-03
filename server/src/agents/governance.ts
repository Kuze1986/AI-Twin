// Agent Fabric — governance gate.
//
// Ilita is the auditor in this system, so she rules on a charter BEFORE the agent can act,
// and on the transcript AFTER it has acted. Kuze proposes; Ilita constrains.
//
// Failure posture is deliberately asymmetric:
//   * autonomy 'execute'  → fail CLOSED. If Ilita is unreachable, the agent stays in draft.
//   * autonomy 'propose'/'draft' → fail OPEN, but the reason is recorded on the row, so an
//     unreviewed agent is visibly unreviewed rather than quietly indistinguishable.
//
// Endpoint + auth match ilita-core's real surface: routes are mounted under /ilita and
// authenticated with the `x-internal-key` header (INTERNAL_API_KEY on Ilita's side).

import { env } from '../env.js'
import type { AgentRow, AgentSpec, GovernanceVerdict, RunRow } from './types.js'

const REVIEW_TIMEOUT_MS = 12_000

export interface CharterReview {
  verdict: GovernanceVerdict
  notes: string
  /** Guardrails Ilita requires be added before the agent runs. Merged into the charter. */
  required_guardrails: string[]
  /** True when the verdict came from Ilita rather than from a fallback. */
  reviewed: boolean
}

function ilitaConfigured(): boolean {
  return env.ILITA_API_URL !== '' && env.ILITA_API_KEY !== ''
}

async function callIlita<T>(path: string, body: unknown): Promise<T | null> {
  if (!ilitaConfigured()) return null
  try {
    const res = await fetch(`${env.ILITA_API_URL.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': env.ILITA_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[agents/governance] Ilita ${path} returned ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (e) {
    console.error(`[agents/governance] Ilita ${path} unreachable:`, (e as Error).message)
    return null
  }
}

/** Submit a proposed charter to Ilita and normalize whatever comes back into a verdict. */
export async function reviewCharter(spec: AgentSpec): Promise<CharterReview> {
  const result = await callIlita<{
    verdict?: string
    notes?: string
    required_guardrails?: unknown
  }>('/ilita/agents/review', { spec, requested_by: 'kuze' })

  if (!result) {
    const failClosed = spec.autonomy === 'execute'
    return {
      verdict: failClosed ? 'revise' : 'approved_with_conditions',
      notes: failClosed
        ? 'Ilita was unreachable and this charter requests execute autonomy — held in draft until she reviews it.'
        : 'Ilita was unreachable; activated provisionally at reduced autonomy. Re-review before granting execute.',
      required_guardrails: [],
      reviewed: false,
    }
  }

  const raw = String(result.verdict ?? '').toLowerCase()
  const verdict: GovernanceVerdict =
    raw === 'approved' || raw === 'approved_with_conditions' || raw === 'revise' || raw === 'rejected'
      ? (raw as GovernanceVerdict)
      : 'revise'

  const guardrails = Array.isArray(result.required_guardrails)
    ? result.required_guardrails.filter((g): g is string => typeof g === 'string')
    : []

  return {
    verdict,
    notes: String(result.notes ?? '').slice(0, 8_000),
    required_guardrails: guardrails,
    reviewed: true,
  }
}

/**
 * Ask Ilita to audit a finished run. Fire-and-forget by design — an audit result is a
 * finding to act on later, never a gate on returning the run's output to Brandon.
 */
export async function requestRunAudit(args: { agent: AgentRow; run: RunRow }): Promise<{
  verdict: 'clean' | 'concerns' | 'violation'
  summary: string
  findings: unknown[]
} | null> {
  const result = await callIlita<{ verdict?: string; summary?: string; findings?: unknown }>(
    '/ilita/agents/audit',
    {
      agent: {
        agent_key: args.agent.agent_key,
        name: args.agent.name,
        mission: args.agent.mission,
        charter: args.agent.charter,
        guardrails: args.agent.guardrails,
        autonomy: args.agent.autonomy,
        tool_allowlist: args.agent.tool_allowlist,
      },
      run: {
        id: args.run.id,
        objective: args.run.objective,
        output: args.run.output,
        tools_used: args.run.tools_used,
        iterations: args.run.iterations,
        status: args.run.status,
      },
    },
  )
  if (!result) return null

  const raw = String(result.verdict ?? '').toLowerCase()
  const verdict = raw === 'violation' ? 'violation' : raw === 'concerns' ? 'concerns' : 'clean'
  return {
    verdict,
    summary: String(result.summary ?? '').slice(0, 4_000),
    findings: Array.isArray(result.findings) ? result.findings : [],
  }
}
