import { messagesCreate } from '../inference/messagesCreate.js'
import {
  logViolation,
  regenerateWithCorrection,
  runValidators,
  secondPassReview,
  type ValidatorContext,
} from '../validators/index.js'

export type EnforceResolution = 'passed' | 'regenerated' | 'refused'

export interface EnforcedDraft {
  text: string
  resolution: EnforceResolution
  /** Populated when resolution is 'refused' — the reason the draft was blocked. */
  refusalReason?: string
}

/**
 * Generate an assistant output and run it through the full Sentinel pipeline —
 * the same validators, regeneration, and second-pass review used by the chat route,
 * but non-streaming and scoped to email drafting.
 *
 * On a hard violation it attempts one correction pass. If the corrected text still
 * violates (or second-pass review rejects), the draft is marked 'refused' and the
 * caller must NOT send it — it is surfaced to a human instead.
 */
export async function generateEnforcedDraft(args: {
  systemPrompt: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  context: ValidatorContext
  maxTokens?: number
}): Promise<EnforcedDraft> {
  const { systemPrompt, messages, context, maxTokens = 4096 } = args

  const first = await messagesCreate({
    tier: 'balanced',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
    stream: false,
  })
  let text: string =
    (first as { content: Array<{ type: string; text?: string }> }).content.find(
      (b) => b.type === 'text',
    )?.text ?? ''

  const validation = await runValidators(text, context)
  const hard = validation.filter((r) => !r.passed && r.severity === 'hard')

  if (hard.length > 0) {
    let resolution: EnforceResolution = 'refused'
    let regenerated = text
    try {
      regenerated = await regenerateWithCorrection(systemPrompt, hard[0], messages, messagesCreate)
      const reValidation = await runValidators(regenerated, context)
      const reHard = reValidation.filter((r) => !r.passed && r.severity === 'hard')
      if (reHard.length === 0) {
        resolution = 'regenerated'
        text = regenerated
      }
    } catch (e) {
      console.error('[email/enforce] regeneration failed:', (e as Error).message)
    }

    await logViolation({
      ruleViolated: hard[0].ruleViolated,
      severity: 'hard',
      proposedOutput: text,
      triggerContext: context,
      resolution: resolution === 'regenerated' ? 'regenerated' : 'refused',
      finalOutput: resolution === 'regenerated' ? regenerated : undefined,
      recipientContext: context.recipientContext,
      mode: context.mode,
    })

    if (resolution === 'refused') {
      return { text, resolution, refusalReason: hard[0].reason }
    }
  }

  // Log soft violations for monitoring; they do not block the draft.
  const soft = validation.filter((r) => !r.passed && r.severity === 'soft')
  if (soft.length > 0) {
    await logViolation({
      ruleViolated: soft[0].ruleViolated,
      severity: 'soft',
      proposedOutput: text,
      triggerContext: context,
      resolution: 'sent_after_override',
      finalOutput: text,
      recipientContext: context.recipientContext,
      mode: context.mode,
    })
  }

  const secondPass = await secondPassReview(text, context)
  if (!secondPass.approved) {
    await logViolation({
      ruleViolated: 'second_pass_review',
      severity: 'hard',
      proposedOutput: text,
      triggerContext: context,
      resolution: 'refused',
      recipientContext: context.recipientContext,
      mode: context.mode,
    })
    return {
      text,
      resolution: 'refused',
      refusalReason: secondPass.reason ?? 'Second-pass review failed',
    }
  }

  return { text, resolution: hard.length > 0 ? 'regenerated' : 'passed' }
}
