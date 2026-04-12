import type { IdentityRow, LtmRow, ModeConfigRow } from './promptBuilder.js'
import { supabaseAdmin } from './supabaseAdmin.js'

export async function getIdentity(): Promise<IdentityRow | null> {
  const { data, error } = await supabaseAdmin
    .from('identity_profile')
    .select('twin_name, persona_prompt, context_blocks, behavioral_rules, style_fingerprint')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data as IdentityRow
}

export async function getModeConfig(mode: string): Promise<ModeConfigRow | null> {
  const { data, error } = await supabaseAdmin
    .from('mode_config')
    .select('mode, system_injection, context_block_tag')
    .eq('mode', mode)
    .maybeSingle()

  if (error || !data) return null
  return data as ModeConfigRow
}

export async function getTopLongTermMemory(limit = 10): Promise<LtmRow[]> {
  const { data, error } = await supabaseAdmin
    .from('long_term_memory_global')
    .select('summary, category, weight, created_at')
    .order('weight', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) return []
  return data as LtmRow[]
}
