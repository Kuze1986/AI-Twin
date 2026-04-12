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
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
  SUPABASE_URL: req('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: req('SUPABASE_SERVICE_ROLE_KEY'),
  MAX_HISTORY_TOKENS: Number(process.env.MAX_HISTORY_TOKENS ?? 3000),
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'dev-change-me',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? '',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  CONSOLIDATION_INTERVAL_MS: Number(process.env.CONSOLIDATION_INTERVAL_MS ?? 60_000),
  INACTIVITY_MS: Number(process.env.INACTIVITY_MS ?? 5 * 60 * 1000),
}
