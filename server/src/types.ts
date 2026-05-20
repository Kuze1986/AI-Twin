/** Server-side types for AI Twin. */

export type ChatMode = 'default' | 'sales' | 'ops' | 'outreach' | 'debrief'

export interface DemoForgeContext {
  tenant_id: string
  demoforge_session_id: string
  journey_node_id: string
  kuze_mode: 'ambassador' | 'insider' | 'operator'
  engagement_trajectory?: 'rising' | 'falling' | 'stable' | 'volatile' | null
  friction_points?: string[]
  recommended_pivot?: string | null
  behavioral_confidence?: number
}

export type MemoryCategory = 'relationship' | 'preference' | 'decision' | 'fact' | 'context' | 'ai_peer'

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
