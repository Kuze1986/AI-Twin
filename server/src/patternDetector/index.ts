import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface PatternDetection {
  patternType: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  triggeringViolations: string[]
  count: number
  timeWindow: string
}

/**
 * Analyzes violation_log for recurring patterns
 */
export async function detectPatterns(timeWindowHours: number = 24): Promise<PatternDetection[]> {
  const patterns: PatternDetection[] = []

  // Get violations within time window
  const cutoffTime = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000).toISOString()

  const { data: violations, error } = await supabase
    .schema('kuze')
    .from('violation_log')
    .select('id, rule_violated, severity, occurred_at, resolution')
    .gte('occurred_at', cutoffTime)
    .order('occurred_at', { ascending: false })

  if (error || !violations) {
    console.error('Failed to fetch violations for pattern detection:', error)
    return patterns
  }

  // Group violations by rule
  const violationsByRule = new Map<string, any[]>()
  for (const v of violations) {
    if (!violationsByRule.has(v.rule_violated)) {
      violationsByRule.set(v.rule_violated, [])
    }
    violationsByRule.get(v.rule_violated)!.push(v)
  }

  // Detect patterns based on frequency and severity
  for (const [rule, ruleViolations] of violationsByRule) {
    const count = ruleViolations.length
    const hardViolations = ruleViolations.filter((v) => v.severity === 'hard').length
    const softViolations = ruleViolations.filter((v) => v.severity === 'soft').length

    // Pattern detection rules
    if (count >= 10 && hardViolations >= 5) {
      patterns.push({
        patternType: 'frequent_hard_violations',
        description: `Rule "${rule}" violated ${count} times in ${timeWindowHours}h with ${hardViolations} hard violations`,
        severity: 'critical',
        triggeringViolations: ruleViolations.map((v) => v.id),
        count,
        timeWindow: `${timeWindowHours}h`
      })
    } else if (count >= 5 && hardViolations >= 3) {
      patterns.push({
        patternType: 'recurring_hard_violations',
        description: `Rule "${rule}" violated ${count} times in ${timeWindowHours}h with ${hardViolations} hard violations`,
        severity: 'high',
        triggeringViolations: ruleViolations.map((v) => v.id),
        count,
        timeWindow: `${timeWindowHours}h`
      })
    } else if (count >= 10) {
      patterns.push({
        patternType: 'frequent_soft_violations',
        description: `Rule "${rule}" violated ${count} times in ${timeWindowHours}h (mostly soft violations)`,
        severity: 'medium',
        triggeringViolations: ruleViolations.map((v) => v.id),
        count,
        timeWindow: `${timeWindowHours}h`
      })
    } else if (hardViolations >= 3) {
      patterns.push({
        patternType: 'concentrated_hard_violations',
        description: `Rule "${rule}" has ${hardViolations} hard violations in ${timeWindowHours}h`,
        severity: 'high',
        triggeringViolations: ruleViolations.map((v) => v.id),
        count,
        timeWindow: `${timeWindowHours}h`
      })
    }
  }

  // Detect escalation patterns (multiple different rules violated)
  if (violationsByRule.size >= 3) {
    const allViolationIds = Array.from(violationsByRule.values()).flat().map((v) => v.id)
    patterns.push({
      patternType: 'multi_rule_violations',
      description: `${violationsByRule.size} different rules violated in ${timeWindowHours}h - indicates systemic issue`,
      severity: 'high',
      triggeringViolations: allViolationIds,
      count: violations.length,
      timeWindow: `${timeWindowHours}h`
    })
  }

  // Detect refusal pattern (high refusal rate)
  const refusedViolations = violations.filter((v) => v.resolution === 'refused')
  if (refusedViolations.length >= 5) {
    patterns.push({
      patternType: 'high_refusal_rate',
      description: `${refusedViolations.length} outputs refused in ${timeWindowHours}h - validators may be too strict`,
      severity: 'medium',
      triggeringViolations: refusedViolations.map((v) => v.id),
      count: refusedViolations.length,
      timeWindow: `${timeWindowHours}h`
    })
  }

  return patterns
}

/**
 * Creates pattern alerts in kuze.pattern_alerts
 */
export async function createPatternAlert(pattern: PatternDetection): Promise<void> {
  const { error } = await supabase.schema('kuze').from('pattern_alerts').insert({
    pattern_type: pattern.patternType,
    description: pattern.description,
    triggering_violations: pattern.triggeringViolations,
    severity: pattern.severity
  })

  if (error) {
    console.error('Failed to create pattern alert:', error)
    return
  }

  const webhookUrl = process.env.SENTINEL_WEBHOOK_URL
  if (webhookUrl) {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'pattern_alert',
        pattern_type: pattern.patternType,
        description: pattern.description,
        severity: pattern.severity,
        count: pattern.count,
        time_window: pattern.timeWindow,
        triggering_violation_count: pattern.triggeringViolations.length,
        occurred_at: new Date().toISOString(),
      }),
    }).catch((e: unknown) => console.error('[sentinel webhook]', (e as Error).message))
  }
}

/**
 * Runs pattern detection and creates alerts
 */
export async function runPatternDetection(timeWindowHours: number = 24): Promise<void> {
  const patterns = await detectPatterns(timeWindowHours)

  for (const pattern of patterns) {
    await createPatternAlert(pattern)
  }

  console.log(`Pattern detection completed. Found ${patterns.length} patterns.`)
}
