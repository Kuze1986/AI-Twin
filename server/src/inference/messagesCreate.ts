import { messagesCreate as anthropicMessagesCreate } from './adapters/anthropicSdk.js'
import { messagesCreate as openAiMessagesCreate } from './adapters/openAiCompatibleHttp.js'

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

/**
 * Unified entry matching Anthropic `messages.create` contract so all Kuze services
 * keep calling `messages.create(...)`.
 *
 * Providers:
 * - anthropic (default): Anthropic Messages API (@anthropic-ai/sdk).
 * - openai_compatible: POST `${KUZE_OPENAI_BASE_URL}`/chat/completions
 *
 * @param params - { model, max_tokens, system?, messages, stream? }
 */
export async function messagesCreate(params: {
  model: string
  max_tokens: number
  system?: string
  messages: { role: 'user' | 'assistant'; content: string | any[] }[]
  stream?: boolean
}): Promise<any> {
  const backend = getProviderName()
  if (backend === 'openai_compatible') {
    return openAiMessagesCreate(params)
  }
  return anthropicMessagesCreate(params)
}

export { getProviderName }
