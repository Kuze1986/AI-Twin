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

export async function getActiveConstitution(): Promise<{
  version: number
  title: string
  body: string
  ratified_at: string | null
} | null> {
  const { data, error } = await supabaseAdmin
    .schema('kuze')
    .from('constitution')
    .select('version, title, body, ratified_at')
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data) return null
  return data as { version: number; title: string; body: string; ratified_at: string | null }
}

export async function getConstitutionHistory(): Promise<
  { version: number; title: string; is_active: boolean; ratified_at: string | null; created_at: string }[]
> {
  const { data, error } = await supabaseAdmin
    .schema('kuze')
    .from('constitution')
    .select('version, title, is_active, ratified_at, created_at')
    .order('version', { ascending: false })

  if (error || !data) return []
  return data as {
    version: number
    title: string
    is_active: boolean
    ratified_at: string | null
    created_at: string
  }[]
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
