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
  // Email channel (kuze@bioloopnexus.com via IONOS IMAP/SMTP). Master switch — the
  // inbound poller and outbound sender stay dormant until this is 'true' AND creds are set.
  EMAIL_ENABLED: (process.env.EMAIL_ENABLED ?? 'false').trim().toLowerCase() === 'true',
  KUZE_EMAIL_ADDRESS: process.env.KUZE_EMAIL_ADDRESS ?? '',
  KUZE_EMAIL_USER: process.env.KUZE_EMAIL_USER ?? process.env.KUZE_EMAIL_ADDRESS ?? '',
  KUZE_EMAIL_PASSWORD: process.env.KUZE_EMAIL_PASSWORD ?? '',
  IONOS_IMAP_HOST: process.env.IONOS_IMAP_HOST ?? 'imap.ionos.com',
  IONOS_IMAP_PORT: Number(process.env.IONOS_IMAP_PORT ?? 993),
  IONOS_SMTP_HOST: process.env.IONOS_SMTP_HOST ?? 'smtp.ionos.com',
  IONOS_SMTP_PORT: Number(process.env.IONOS_SMTP_PORT ?? 587),
  EMAIL_POLL_INTERVAL_MS: Number(process.env.EMAIL_POLL_INTERVAL_MS ?? 120_000),
  EMAIL_DAILY_SEND_CAP: Number(process.env.EMAIL_DAILY_SEND_CAP ?? 50),
  // Hybrid autonomy: auto-send Kuze's replies on warm/known inbound threads. Cold outreach
  // and campaign drafts always require human approval regardless of this flag.
  EMAIL_AUTOSEND_WARM: (process.env.EMAIL_AUTOSEND_WARM ?? 'true').trim().toLowerCase() === 'true',
  // How often the task worker drains the queue.
  TASK_WORKER_INTERVAL_MS: Number(process.env.TASK_WORKER_INTERVAL_MS ?? 30_000),
  // Appended to cold outreach (CAN-SPAM: physical address + opt-out line).
  THE_SHIFT_OUTREACH_FOOTER: process.env.THE_SHIFT_OUTREACH_FOOTER ?? '',
}

/** True only when the email channel is switched on and all IONOS credentials are present. */
export function emailConfigured(): boolean {
  return (
    env.EMAIL_ENABLED &&
    env.KUZE_EMAIL_ADDRESS !== '' &&
    env.KUZE_EMAIL_USER !== '' &&
    env.KUZE_EMAIL_PASSWORD !== ''
  )
}
