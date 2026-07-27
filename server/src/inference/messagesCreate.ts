import { messagesCreate as anthropicMessagesCreate } from './adapters/anthropicSdk.js'
import { messagesCreate as openAiMessagesCreate } from './adapters/openAiCompatibleHttp.js'

export type ModelTier = 'fast' | 'balanced' | 'powerful'

/**
 * @returns {'anthropic' | 'openai_compatible'}
 */
function getProviderName(): 'anthropic' | 'openai_compatible' {
  const v = (process.env.KUZE_INFERENCE_PROVIDER || 'anthropic').trim().toLowerCase()
  if (['openai_compatible', 'openai-compatible', 'ollama_openai'].includes(v)) {
    return 'openai_compatible'
  }
  return 'anthropic'
}

const TIER_ENV: Record<ModelTier, string> = {
  fast:     'ANTHROPIC_MODEL_FAST',
  balanced: 'ANTHROPIC_MODEL_BALANCED',
  powerful: 'ANTHROPIC_MODEL_POWERFUL',
}

/**
 * Resolves a tier name ('fast'|'balanced'|'powerful') or explicit model ID to a model string.
 * Tier env vars take precedence over built-in defaults.
 */
export function resolveModel(tierOrModel: ModelTier | string = 'balanced'): string {
  const envKey = TIER_ENV[tierOrModel as ModelTier]
  if (envKey) return process.env[envKey] ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'
  return tierOrModel
}

/**
 * Unified entry matching Anthropic `messages.create` contract so all Kuze services
 * keep calling `messages.create(...)`.
 *
 * Providers:
 * - anthropic (default): Anthropic Messages API (@anthropic-ai/sdk).
 * - openai_compatible: POST `${KUZE_OPENAI_BASE_URL}`/chat/completions
 *
 * @param params - Anthropic params + optional `tier` ('fast'|'balanced'|'powerful').
 *   When `tier` is given it takes precedence over `model`.
 */
export async function messagesCreate(params: {
  model?: string
  tier?: ModelTier | string
  max_tokens: number
  system?: string
  messages: { role: 'user' | 'assistant'; content: string | any[] }[]
  stream?: boolean
  tools?: any[]
  tool_choice?: any
}): Promise<any> {
  const { tier, ...rest } = params
  const resolved = { ...rest, model: resolveModel(tier ?? rest.model ?? 'balanced') }
  const backend = getProviderName()
  if (backend === 'openai_compatible') {
    // The OpenAI-compatible adapter is text-only (no tool calling / no streaming). Drop any
    // tool params so it degrades gracefully; the tool loop is gated on supportsTools() upstream.
    const { tools: _t, tool_choice: _tc, stream: _s, ...textOnly } = resolved
    return openAiMessagesCreate(textOnly)
  }
  return anthropicMessagesCreate(resolved)
}

/** True when the active inference provider supports native tool calling (Anthropic only today). */
export function supportsTools(): boolean {
  return getProviderName() === 'anthropic'
}

export { getProviderName }
