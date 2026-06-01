import 'dotenv/config'

function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env: ${name}`)
  return v
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 3001),
  ANTHROPIC_API_KEY: req('ANTHROPIC_API_KEY'),
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
  ANTHROPIC_MODEL_FAST: process.env.ANTHROPIC_MODEL_FAST ?? 'claude-haiku-4-5-20251001',
  ANTHROPIC_MODEL_BALANCED: process.env.ANTHROPIC_MODEL_BALANCED ?? 'claude-sonnet-4-6',
  ANTHROPIC_MODEL_POWERFUL: process.env.ANTHROPIC_MODEL_POWERFUL ?? 'claude-opus-4-8',
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  SUPABASE_URL: req('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: req('SUPABASE_SERVICE_ROLE_KEY'),
  MAX_HISTORY_TOKENS: Number(process.env.MAX_HISTORY_TOKENS ?? 3000),
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'dev-change-me',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? '',
  CRUCIBLE_SIM_BASE_URL: process.env.CRUCIBLE_SIM_BASE_URL ?? '',
  CRUCIBLE_SIM_API_KEY: process.env.CRUCIBLE_SIM_API_KEY ?? '',
  BIOLOOP_SERVICE_KEY: process.env.BIOLOOP_SERVICE_KEY ?? '',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  CONSOLIDATION_INTERVAL_MS: Number(process.env.CONSOLIDATION_INTERVAL_MS ?? 60_000),
  INACTIVITY_MS: Number(process.env.INACTIVITY_MS ?? 5 * 60 * 1000),
  KUZE_INFERENCE_PROVIDER: process.env.KUZE_INFERENCE_PROVIDER ?? 'anthropic',
  KUZE_OPENAI_BASE_URL: process.env.KUZE_OPENAI_BASE_URL,
  KUZE_OPENAI_API_KEY: process.env.KUZE_OPENAI_API_KEY,
  // Peer AI auth keys — set these to enable API-to-API calls from Ilita/Stele
  ILITA_PEER_KEY: process.env.ILITA_PEER_KEY ?? '',
  STELE_PEER_KEY: process.env.STELE_PEER_KEY ?? '',
  // Ilita API integration — set when Ilita's API details are known
  ILITA_API_URL: process.env.ILITA_API_URL ?? '',
  ILITA_API_KEY: process.env.ILITA_API_KEY ?? '',
  // Sentinel webhook — set to receive pattern alert POSTs (Slack, Discord, n8n, etc.)
  SENTINEL_WEBHOOK_URL: process.env.SENTINEL_WEBHOOK_URL ?? '',
  // Chat rate limiting
  CHAT_RATE_LIMIT_PER_MIN: Number(process.env.CHAT_RATE_LIMIT_PER_MIN ?? 20),
}
