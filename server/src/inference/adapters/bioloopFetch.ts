/**
 * xAI / Kimi completions via @bioloop/llm (Anthropic-shaped result for messagesCreate).
 */
import {
  completeOnSlot,
  openaiCompatibleBaseUrl,
  openaiCompatibleStream,
  providerApiKey,
  type LlmProvider,
} from '@bioloop/llm'

function blockText(content: string | any[]): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')
  return content
    .map((b) => {
      if (!b || typeof b !== 'object') return ''
      if (typeof (b as { text?: string }).text === 'string') return (b as { text: string }).text
      return ''
    })
    .join('')
}

function flattenPrompt(
  system: string | undefined,
  messages: { role: string; content: string | any[] }[],
): { system?: string; prompt: string } {
  const parts: string[] = []
  for (const m of messages) {
    const text = blockText(m.content).trim()
    if (!text) continue
    if (m.role === 'user') parts.push(`User: ${text}`)
    else if (m.role === 'assistant') parts.push(`Assistant: ${text}`)
  }
  const prompt = parts.length ? parts.join('\n\n') : 'Hello'
  return { system: system?.trim() || undefined, prompt }
}

export async function messagesCreate(params: {
  provider: 'xai' | 'kimi'
  model: string
  max_tokens: number
  system?: string
  messages: { role: string; content: string | any[] }[]
}): Promise<{
  content: { type: string; text: string }[]
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}> {
  const key = providerApiKey(params.provider as LlmProvider)
  if (!key) throw new Error(`${params.provider} API key not configured`)
  const { system, prompt } = flattenPrompt(params.system, params.messages)
  const text = await completeOnSlot({
    prompt,
    system,
    maxTokens: params.max_tokens,
    slot: { provider: params.provider, model: params.model },
  })
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'stop',
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}

export async function* streamText(params: {
  provider: 'xai' | 'kimi'
  model: string
  max_tokens: number
  system?: string
  messages: { role: string; content: string | any[] }[]
}): AsyncGenerator<string> {
  const key = providerApiKey(params.provider as LlmProvider)
  if (!key) throw new Error(`${params.provider} API key not configured`)
  const { system, prompt } = flattenPrompt(params.system, params.messages)
  const label = params.provider === 'xai' ? 'xAI' : 'Kimi'
  yield* openaiCompatibleStream({
    apiKey: key,
    baseUrl: openaiCompatibleBaseUrl(params.provider),
    prompt,
    system,
    maxTokens: params.max_tokens,
    model: params.model,
    label,
  })
}
