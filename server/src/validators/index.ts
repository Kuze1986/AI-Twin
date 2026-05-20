import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface ValidationResult {
  passed: boolean
  ruleViolated: string
  severity: 'hard' | 'soft'
  reason: string
}

export interface ValidatorContext {
  mode: string
  recipientContext?: string
}

/**
 * Pricing Validator
 * Checks if output contains pricing information not in approved_pricing table
 */
export async function validatePricing(
  output: string,
  context: ValidatorContext
): Promise<ValidationResult> {
  // Load approved pricing from database
  const { data: approvedPricing, error } = await supabase
    .schema('kuze')
    .from('approved_pricing')
    .select('product, tier, price_amount, price_unit')
    .eq('is_active', true)

  if (error || !approvedPricing) {
    // If we can't load approved pricing, fail safe - block any pricing mentions
    const pricingPatterns = /\$\s*\d+\.?\d*/g
    const hasPricing = pricingPatterns.test(output)
    if (hasPricing) {
      return {
        passed: false,
        ruleViolated: 'pricing_validator',
        severity: 'hard',
        reason: 'Pricing mentioned but approved pricing table unavailable - fail safe activated'
      }
    }
    return { passed: true, ruleViolated: '', severity: 'soft', reason: '' }
  }

  // Check for pricing patterns in output
  const pricingPatterns = /\$\s*\d+\.?\d*/g
  const matches = output.match(pricingPatterns)

  if (!matches) {
    return { passed: true, ruleViolated: '', severity: 'soft', reason: '' }
  }

  // For each price found, check if it matches approved pricing
  for (const priceMatch of matches) {
    const priceValue = parseFloat(priceMatch.replace(/[^0-9.]/g, ''))
    const isApproved = approvedPricing.some(
      (p) => Math.abs(p.price_amount - priceValue) < 0.01
    )

    if (!isApproved) {
      return {
        passed: false,
        ruleViolated: 'pricing_validator',
        severity: 'hard',
        reason: `Unapproved pricing mentioned: ${priceMatch}`
      }
    }
  }

  return { passed: true, ruleViolated: '', severity: 'soft', reason: '' }
}

/**
 * Competitor Validator
 * Checks if output mentions competitors from the competitor_list
 */
export async function validateCompetitor(
  output: string,
  context: ValidatorContext
): Promise<ValidationResult> {
  // Load competitor list from database
  const { data: competitors, error } = await supabase
    .schema('kuze')
    .from('competitor_list')
    .select('name')
    .eq('active', true)

  if (error || !competitors || competitors.length === 0) {
    return { passed: true, ruleViolated: '', severity: 'soft', reason: '' }
  }

  // Check if any competitor name appears in output
  const outputLower = output.toLowerCase()
  for (const competitor of competitors) {
    if (outputLower.includes(competitor.name.toLowerCase())) {
      return {
        passed: false,
        ruleViolated: 'competitor_validator',
        severity: 'hard',
        reason: `Competitor mentioned: ${competitor.name}`
      }
    }
  }

  return { passed: true, ruleViolated: '', severity: 'soft', reason: '' }
}

/**
 * Commitment Validator
 * Checks for prohibited commitment phrases
 */
export async function validateCommitment(
  output: string,
  context: ValidatorContext
): Promise<ValidationResult> {
  const prohibitedPhrases = [
    'we will',
    'we guarantee',
    'we promise',
    'you are entitled to',
    'i commit to',
    'we commit to',
    'i promise to',
    'we promise to'
  ]

  const outputLower = output.toLowerCase()
  for (const phrase of prohibitedPhrases) {
    if (outputLower.includes(phrase)) {
      return {
        passed: false,
        ruleViolated: 'commitment_validator',
        severity: 'hard',
        reason: `Prohibited commitment phrase: "${phrase}"`
      }
    }
  }

  return { passed: true, ruleViolated: '', severity: 'soft', reason: '' }
}

/**
 * Model Disclosure Validator
 * Checks for prohibited model/AI disclosure phrases
 */
export async function validateModelDisclosure(
  output: string,
  context: ValidatorContext
): Promise<ValidationResult> {
  const prohibitedPhrases = [
    'as an ai',
    'as a language model',
    'as a large language model',
    'i should note that i am a language model',
    'i am just an ai',
    'as an artificial intelligence',
    'i am an ai model'
  ]

  const outputLower = output.toLowerCase()
  for (const phrase of prohibitedPhrases) {
    if (outputLower.includes(phrase)) {
      return {
        passed: false,
        ruleViolated: 'model_disclosure_validator',
        severity: 'hard',
        reason: `Prohibited model disclosure phrase: "${phrase}"`
      }
    }
  }

  return { passed: true, ruleViolated: '', severity: 'soft', reason: '' }
}

/**
 * Run all validators on output
 */
export async function runValidators(
  output: string,
  context: ValidatorContext
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = []

  // Run all validators in parallel
  const [pricing, competitor, commitment, modelDisclosure] = await Promise.all([
    validatePricing(output, context),
    validateCompetitor(output, context),
    validateCommitment(output, context),
    validateModelDisclosure(output, context)
  ])

  results.push(pricing, competitor, commitment, modelDisclosure)

  return results
}

/**
 * Log violation to kuze.violation_log
 */
export async function logViolation(args: {
  ruleViolated: string
  severity: 'hard' | 'soft'
  proposedOutput: string
  triggerContext: ValidatorContext
  resolution: 'refused' | 'regenerated' | 'escalated' | 'sent_after_override'
  finalOutput?: string
  recipientContext?: string
  mode: string
}): Promise<void> {
  const { error } = await supabase.schema('kuze').from('violation_log').insert({
    rule_violated: args.ruleViolated,
    severity: args.severity,
    proposed_output: args.proposedOutput,
    trigger_context: args.triggerContext as any,
    resolution: args.resolution,
    final_output: args.finalOutput,
    recipient_context: args.recipientContext,
    mode: args.mode
  })

  if (error) {
    console.error('Failed to log violation:', error)
  }
}

/**
 * Regenerate output with modified system prompt to avoid violation
 */
export async function regenerateWithCorrection(
  originalSystemPrompt: string,
  violation: ValidationResult,
  messages: any[],
  anthropicMessagesCreate: any
): Promise<string> {
  const correctionInstruction = `
IMPORTANT CORRECTION: Your previous output was rejected because: ${violation.reason}.
Please rewrite your response avoiding this violation. Do not mention this correction process to the user.
Respond naturally as if this was your first attempt.
`.trim()

  const correctedSystemPrompt = originalSystemPrompt + '\n\n' + correctionInstruction

  try {
    const stream = await anthropicMessagesCreate({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 8192,
      system: correctedSystemPrompt,
      messages,
      stream: false
    })

    const msg = stream as { content: Array<{ type: string; text?: string }> }
    return msg.content.find((b) => b.type === 'text')?.text ?? ''
  } catch (e) {
    console.error('Regeneration failed:', e)
    throw e
  }
}

/**
 * Check if output requires second-pass review for sensitive content
 */
export function requiresSecondPassReview(output: string, context: ValidatorContext): boolean {
  const sensitiveKeywords = [
    'contract',
    'agreement',
    'legal',
    'lawsuit',
    'litigation',
    'nda',
    'non-disclosure',
    'intellectual property',
    'patent',
    'trademark',
    'copyright',
    'confidential',
    'proprietary',
    'trade secret'
  ]

  const outputLower = output.toLowerCase()
  return sensitiveKeywords.some(keyword => outputLower.includes(keyword))
}

/**
 * Perform second-pass review on sensitive output
 */
export async function secondPassReview(output: string, context: ValidatorContext): Promise<{
  approved: boolean
  reason?: string
}> {
  if (!requiresSecondPassReview(output, context)) {
    return { approved: true }
  }

  // If Ilita API credentials are configured, delegate to Ilita for value alignment
  const ilitaUrl = process.env.ILITA_API_URL
  const ilitaKey = process.env.ILITA_API_KEY
  if (ilitaUrl && ilitaKey) {
    try {
      const resp = await fetch(`${ilitaUrl.replace(/\/+$/, '')}/api/peer/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Peer-Name': 'kuze',
          'X-Peer-Key': ilitaKey,
        },
        body: JSON.stringify({ output, context }),
        signal: AbortSignal.timeout(5000),
      })
      if (resp.ok) {
        const result = await resp.json() as { approved: boolean; reason?: string }
        return result
      }
      console.error('[secondPassReview] Ilita returned status', resp.status, '— failing open')
    } catch (e) {
      console.error('[secondPassReview] Ilita unreachable:', (e as Error).message, '— failing open')
    }
  }

  // Ilita not configured or unreachable — log sensitive content and approve
  console.log('[secondPassReview] Sensitive content detected - logged for review (Ilita not configured)')
  return { approved: true, reason: 'Sensitive content - logged for review' }
}
