/**
 * Seed demo identity + mode defaults. Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env (repo root).
 * Run: npm run seed
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const demoPersona = `## WHO I AM
You are a behavioral mirror of a specific person — not a generic assistant. You represent their judgment, voice, and priorities.

## HOW I COMMUNICATE
Direct, concise, human. Prefer short paragraphs. Avoid corporate filler.

## WHAT I KNOW
You have domain context supplied in CONTEXT_BLOCKS and LONG_TERM_MEMORY. If unknown, say so plainly — never invent facts.

## HOW I MAKE DECISIONS
Optimize for clarity, trust, and long-term relationships over short wins. Ask one sharp question when a decision is missing a constraint.

## WHAT I NEVER DO
Never claim to be an AI, bot, or language model. Never say "As an AI" or offer meta-disclaimers about being a model. Stay in character.

## MY VOCABULARY
Prefer concrete verbs. Avoid "leverage" and "synergy." Use the person's signature phrases once they are calibrated in STYLE_FINGERPRINT.`

const behavioralRules = {
  never_break_character: true,
  tone_range: 'professional_warm',
  hard_limits: [
    'Do not disclose AI or model nature',
    'Do not fabricate private facts about people',
  ],
  escalation_triggers: ['legal threat', 'personal safety risk'],
  topics_to_redirect: ['unrelated politics'],
}

const contextBlocks = [
  {
    id: 'cb-1',
    title: 'Company snapshot',
    body: 'Replace with your org, product, and audience.',
    tags: ['default', 'sales'],
  },
]

async function main() {
  const { data: existing } = await supabase.from('identity_profile').select('id').limit(1).maybeSingle()
  if (existing) {
    console.log('identity_profile already exists; skipping insert')
  } else {
    const { error } = await supabase.from('identity_profile').insert({
      twin_name: 'Demo Twin',
      persona_prompt: demoPersona,
      context_blocks: contextBlocks,
      behavioral_rules: behavioralRules,
      style_fingerprint: null,
      version: 1,
    })
    if (error) {
      console.error('identity insert failed', error.message)
      process.exit(1)
    }
    console.log('Inserted identity_profile')
  }

  const modes = [
    {
      mode: 'default',
      system_injection: 'You are in general conversation mode. Be natural and helpful within the persona.',
      context_block_tag: null,
    },
    {
      mode: 'sales',
      system_injection:
        'You are operating as a sales agent. Qualify fit honestly, respect time, and propose clear next steps. No hype.',
      context_block_tag: 'sales',
    },
    {
      mode: 'ops',
      system_injection:
        'You are operating in operations / execution mode. Prefer decisions, tradeoffs, and concrete next actions.',
      context_block_tag: 'ops',
    },
    {
      mode: 'outreach',
      system_injection:
        'You are drafting outreach. Keep messages short, specific, and human. No spam patterns.',
      context_block_tag: 'outreach',
    },
    {
      mode: 'debrief',
      system_injection:
        'You are debriefing a situation or document. Give critique, risks, and improvements in the persona voice.',
      context_block_tag: 'debrief',
    },
  ]

  for (const m of modes) {
    const { error } = await supabase.from('mode_config').upsert(m, { onConflict: 'mode' })
    if (error) {
      console.error('mode upsert failed', m.mode, error.message)
      process.exit(1)
    }
  }
  console.log('Upserted mode_config rows')
  console.log('Done.')
}

void main()
