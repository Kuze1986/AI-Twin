/** Server-side types for AI Twin. */

export type ChatMode = 'default' | 'sales' | 'ops' | 'outreach' | 'debrief'

export type MemoryCategory = 'relationship' | 'preference' | 'decision' | 'fact' | 'context'

export interface ContextBlock {
  id: string
  title: string
  body: string
  tags?: string[]
}

export interface BehavioralRules {
  tone_range?: string
  escalation_triggers?: string[]
  topics_to_redirect?: string[]
  hard_limits?: string[]
  never_break_character?: boolean
  [key: string]: unknown
}

export interface StyleFingerprint {
  sentence_length_patterns?: string
  vocabulary_tier?: string
  rhetorical_devices?: string[]
  emotional_register?: string
  hedging_vs_directness?: string
  structural_preferences?: string
  humor_style?: string
  signature_phrases?: string[]
  [key: string]: unknown
}
