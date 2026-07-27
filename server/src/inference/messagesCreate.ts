import { messagesCreate as anthropicMessagesCreate } from './adapters/anthropicSdk.js'
import {
  messagesCreate as openAiHttpMessagesCreate,
  streamText as openAiHttpStreamText,
} from './adapters/openAiCompatibleHttp.js'
import { messagesCreate as openaiMessagesCreate, streamText as openaiStreamText } from './adapters/openaiSdk.js'
import { messagesCreate as geminiMessagesCreate, streamText as geminiStreamText } from './adapters/geminiSdk.js'

export type ModelTier = 'fast' | 'balanced' | 'powerful'
export type Provider = 'anthropic' | 'openai' | 'gemini' | 'openai_compatible'

const ALIASES: Record<string, Provider> = {
  anthropic: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  gpt: 'openai',
  gemini: 'gemini',
  google: 'gemini',
  openai_compatible: 'openai_compatible',
  'openai-compatible': 'openai_compatible',
  ollama_openai: 'openai_compatible',
  ollama: 'openai_compatible',
}

/** Whether a provider has the credentials/config it needs to run. */
function providerConfigured(p: Provider): boolean {
  switch (p) {
    case 'anthropic': return !!process.env.ANTHROPIC_API_KEY
    case 'openai': return !!process.env.OPENAI_API_KEY
    case 'gemini': return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
    case 'openai_compatible': return !!process.env.KUZE_OPENAI_BASE_URL
  }
}

/**
 * The active provider: an explicit KUZE_INFERENCE_PROVIDER wins when its key is present;
 * otherwise auto-detect by priority from whichever key/config exists. Returns null when no
 * provider is usable (server still boots; chat reports it).
 */
export function resolveActiveProvider(): Provider | null {
  const explicit = (process.env.KUZE_INFERENCE_PROVIDER || '').trim().toLowerCase()
  const mapped = ALIASES[explicit]
  if (mapped && providerConfigured(mapped)) return mapped

  for (const p of ['anthropic', 'openai', 'gemini', 'openai_compatible'] as Provider[]) {
    if (providerConfigured(p)) return p
  }
  return null
}

const TIER_ENV: Record<Provider, Record<ModelTier, string>> = {
  anthropic: { fast: 'ANTHROPIC_MODEL_FAST', balanced: 'ANTHROPIC_MODEL_BALANCED', powerful: 'ANTHROPIC_MODEL_POWERFUL' },
  openai: { fast: 'OPENAI_MODEL_FAST', balanced: 'OPENAI_MODEL_BALANCED', powerful: 'OPENAI_MODEL_POWERFUL' },
  gemini: { fast: 'GEMINI_MODEL_FAST', balanced: 'GEMINI_MODEL_BALANCED', powerful: 'GEMINI_MODEL_POWERFUL' },
  // OpenAI-compatible endpoints reuse the OpenAI model names by default.
  openai_compatible: { fast: 'OPENAI_MODEL_FAST', balanced: 'OPENAI_MODEL_BALANCED', powerful: 'OPENAI_MODEL_POWERFUL' },
}

/**
 * Resolve a tier ('fast'|'balanced'|'powerful') or explicit model id to a concrete model for
 * the given provider (defaults to the active provider).
 */
export function resolveModel(
  tierOrModel: ModelTier | string = 'balanced',
  provider: Provider = resolveActiveProvider() ?? 'anthropic',
): string {
  const envKey = TIER_ENV[provider][tierOrModel as ModelTier]
  if (envKey) return process.env[envKey] ?? tierOrModel
  return tierOrModel // already an explicit model id
}

interface CreateParams {
  model?: string
  tier?: ModelTier | string
  max_tokens: number
  system?: string
  messages: { role: 'user' | 'assistant'; content: string | any[] }[]
  stream?: boolean
  tools?: any[]
  tool_choice?: any
}

export class NoProviderError extends Error {
  constructor() {
    super('no LLM provider configured — set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or KUZE_OPENAI_BASE_URL')
    this.name = 'NoProviderError'
  }
}

/**
 * Unified non-streaming completion across providers. Anthropic keeps its native tool-calling
 * passthrough; other providers are text-only here (tools are gated on supportsTools()).
 */
export async function messagesCreate(params: CreateParams): Promise<any> {
  const provider = resolveActiveProvider()
  if (!provider) throw new NoProviderError()
  const { tier, ...rest } = params
  const model = resolveModel(tier ?? rest.model ?? 'balanced', provider)

  if (provider === 'anthropic') {
    return anthropicMessagesCreate({ ...rest, model })
  }
  // Text-only providers: drop tool/stream params.
  const { tools: _t, tool_choice: _tc, stream: _s, ...textOnly } = rest
  const textParams = { ...textOnly, model }
  if (provider === 'openai') return openaiMessagesCreate(textParams)
  if (provider === 'gemini') return geminiMessagesCreate(textParams)
  return openAiHttpMessagesCreate(textParams)
}

/**
 * Provider-agnostic streaming for the normal (non-tool) chat path. Streams text chunks to
 * `onText` and resolves with the full assistant text. Throws NoProviderError / provider errors.
 */
export async function streamAssistantText(
  params: Omit<CreateParams, 'stream' | 'tools' | 'tool_choice'>,
  onText: (text: string) => void,
): Promise<string> {
  const provider = resolveActiveProvider()
  if (!provider) throw new NoProviderError()
  const { tier, ...rest } = params
  const model = resolveModel(tier ?? rest.model ?? 'balanced', provider)
  let full = ''
  const emit = (t: string) => {
    if (!t) return
    full += t
    onText(t)
  }

  if (provider === 'anthropic') {
    const stream = await anthropicMessagesCreate({ ...rest, model, stream: true })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        emit(event.delta.text as string)
      }
    }
    return full
  }
  if (provider === 'openai') {
    for await (const chunk of openaiStreamText({ ...rest, model })) emit(chunk)
    return full
  }
  if (provider === 'gemini') {
    for await (const chunk of geminiStreamText({ ...rest, model })) emit(chunk)
    return full
  }
  for await (const chunk of openAiHttpStreamText({ ...rest, model })) emit(chunk)
  return full
}

/** The active provider name, or 'anthropic' as a nominal default when none is configured. */
export function getProviderName(): Provider {
  return resolveActiveProvider() ?? 'anthropic'
}

/** True only when the active provider supports native tool calling (Anthropic today). */
export function supportsTools(): boolean {
  return resolveActiveProvider() === 'anthropic'
}
