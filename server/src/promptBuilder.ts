import type {
  BehavioralRules,
  ChatMode,
  ContextBlock,
  DemoForgeContext,
  StyleFingerprint,
} from './types.js'

export interface ModeConfigRow {
  mode: string
  system_injection: string
  context_block_tag: string | null
}

export interface IdentityRow {
  twin_name: string
  persona_prompt: string
  context_blocks: ContextBlock[] | unknown
  behavioral_rules: BehavioralRules | unknown
  style_fingerprint: StyleFingerprint | null
}

export interface LtmRow {
  summary: string
  category: string
  weight: number
  created_at: string
}

function asBlocks(raw: unknown): ContextBlock[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((b) => b && typeof (b as ContextBlock).body === 'string') as ContextBlock[]
}

function serializeBehavioralRules(rules: unknown): string {
  if (!rules || typeof rules !== 'object') return '(none)'
  return JSON.stringify(rules as BehavioralRules, null, 2)
}

function filterContextBlocks(blocks: ContextBlock[], tag: string | null): ContextBlock[] {
  if (!tag) return blocks
  return blocks.filter((b) => {
    const tags = b.tags
    if (!tags || tags.length === 0) return true
    return tags.includes(tag) || tags.includes('default')
  })
}

function formatStyleFingerprintBlock(fp: StyleFingerprint | null): string {
  if (!fp || Object.keys(fp).length === 0) {
    return '(No style calibration data yet. Respond using persona and behavioral rules only.)'
  }
  const lines: string[] = ['## STYLE_FINGERPRINT (mirror — follow closely, do not quote this header)']
  const entries = Object.entries(fp)
  for (const [k, v] of entries) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      lines.push(`- ${k}: ${v.join('; ')}`)
    } else if (typeof v === 'object') {
      lines.push(`- ${k}: ${JSON.stringify(v)}`)
    } else {
      lines.push(`- ${k}: ${String(v)}`)
    }
  }
  return lines.join('\n')
}

function formatLtm(rows: LtmRow[]): string {
  if (rows.length === 0) return '(No long-term memories yet.)'
  return rows
    .map((r, i) => `${i + 1}. [${r.category}] (weight ${r.weight}) ${r.summary}`)
    .join('\n')
}

/**
 * Assembles the single system prompt in the required order:
 * 1. persona_prompt first
 * 2. mode injection
 * 3. behavioral_rules
 * 4. context blocks (filtered)
 * 5. top long-term memories
 * 6. style fingerprint (separate block)
 * 7. optional context_override (last among static blocks)
 */
export function buildSystemPrompt(args: {
  identity: IdentityRow
  mode: ChatMode
  modeConfig: ModeConfigRow | null
  longTermTop: LtmRow[]
  demoForgeContext?: DemoForgeContext | null
  contextOverride?: string
}): string {
  const { identity, modeConfig, longTermTop, demoForgeContext, contextOverride } = args
  const blocks = asBlocks(identity.context_blocks)
  const filtered = filterContextBlocks(blocks, modeConfig?.context_block_tag ?? null)

  const parts: string[] = []

  parts.push(identity.persona_prompt.trim())

  const injection = modeConfig?.system_injection?.trim() ?? ''
  if (injection) {
    parts.push(`## MODE: ${args.mode}\n${injection}`)
  }

  parts.push(`## BEHAVIORAL_RULES\n${serializeBehavioralRules(identity.behavioral_rules)}`)

  if (filtered.length > 0) {
    const cb = filtered
      .map((b) => `### ${b.title}\n${b.body}`)
      .join('\n\n')
    parts.push(`## CONTEXT_BLOCKS\n${cb}`)
  } else {
    parts.push('## CONTEXT_BLOCKS\n(none active for this mode filter)')
  }

  parts.push(`## LONG_TERM_MEMORY (top weighted)\n${formatLtm(longTermTop)}`)

  parts.push(formatStyleFingerprintBlock(identity.style_fingerprint))

  if (demoForgeContext) {
    const engagementDescriptions: Record<'rising' | 'falling' | 'stable' | 'volatile', string> = {
      rising: 'prospect is deepening engagement',
      falling: 'interest declining',
      stable: 'baseline maintained',
      volatile: 'inconsistent signals',
    }
    const engagement = demoForgeContext.engagement_trajectory
    const engagementLine =
      engagement && engagement in engagementDescriptions
        ? `${engagement} — ${engagementDescriptions[engagement]}`
        : '(unknown)'
    const friction =
      demoForgeContext.friction_points && demoForgeContext.friction_points.length > 0
        ? demoForgeContext.friction_points.join(', ')
        : '(none detected)'
    const confidence =
      demoForgeContext.behavioral_confidence ??
      (demoForgeContext as DemoForgeContext & { confidence?: number }).confidence

    const demoForgeLines = [
      '## DEMOFORGE_LIVE_CONTEXT',
      'You are operating in Ambassador mode inside a live DemoForge demo session.',
      `Tenant: ${demoForgeContext.tenant_id}`,
      `Journey position: ${demoForgeContext.journey_node_id}`,
      '',
      'BEHAVIORAL INTELLIGENCE (live, from Crucible):',
      `- Engagement trajectory: ${engagementLine}`,
      `- Friction points: ${friction}`,
      `- Recommended pivot: ${demoForgeContext.recommended_pivot ?? '(none)'}`,
      `- Signal confidence: ${confidence ?? '(unknown)'}`,
    ]

    if (typeof confidence === 'number' && confidence < 0.4) {
      demoForgeLines.push(
        'These signals are early — weight lightly and default to persona-driven behavior.',
      )
    }
    if (engagement === 'falling' && demoForgeContext.recommended_pivot) {
      demoForgeLines.push(
        'Actively work toward the recommended pivot in your next response.',
      )
    }

    parts.push(demoForgeLines.join('\n'))
  }

  if (contextOverride?.trim()) {
    parts.push(`## CONTEXT_OVERRIDE (user-requested)\n${contextOverride.trim()}`)
  }

  return parts.join('\n\n')
}
