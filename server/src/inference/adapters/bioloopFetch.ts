/** xAI and Kimi use the OpenAI-compatible chat-completions protocol. */
import { toOpenAiMessages } from './openAiCompatibleHttp.js'

type Provider = 'xai' | 'kimi'
type Params = {
  provider: Provider
  model: string
  max_tokens: number
  system?: string
  messages: { role: string; content: string | any[] }[]
}

function apiKey(provider: Provider): string {
  return provider === 'xai'
    ? process.env.XAI_API_KEY || process.env.GROK_API_KEY || ''
    : process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || ''
}

function baseUrl(provider: Provider): string {
  const configured = provider === 'xai' ? process.env.XAI_BASE_URL : process.env.KIMI_BASE_URL
  return (configured || (provider === 'xai' ? 'https://api.x.ai/v1' : 'https://api.moonshot.ai/v1')).replace(/\/$/, '')
}

function body(params: Params, stream = false) {
  return {
    model: params.model,
    messages: toOpenAiMessages(params.system, params.messages),
    max_tokens: params.max_tokens,
    ...(stream ? { stream: true } : {}),
  }
}

function headers(key: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
}

export async function messagesCreate(params: Params): Promise<{
  content: { type: string; text: string }[]
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}> {
  const key = apiKey(params.provider)
  if (!key) throw new Error(`${params.provider} API key not configured`)
  const res = await fetch(`${baseUrl(params.provider)}/chat/completions`, {
    method: 'POST', headers: headers(key), body: JSON.stringify(body(params)),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${params.provider} HTTP error: ${json?.error?.message || res.statusText}`)
  return {
    content: [{ type: 'text', text: json.choices?.[0]?.message?.content ?? '' }],
    stop_reason: json.choices?.[0]?.finish_reason ?? 'stop',
    usage: { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 },
  }
}

export async function* streamText(params: Params): AsyncGenerator<string> {
  const key = apiKey(params.provider)
  if (!key) throw new Error(`${params.provider} API key not configured`)
  const res = await fetch(`${baseUrl(params.provider)}/chat/completions`, {
    method: 'POST', headers: headers(key), body: JSON.stringify(body(params, true)),
  })
  if (!res.ok || !res.body) throw new Error(`${params.provider} stream HTTP error: ${res.status} ${res.statusText}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const text = JSON.parse(data).choices?.[0]?.delta?.content
        if (typeof text === 'string') yield text
      } catch {
        // Ignore SSE keepalives and incomplete frames.
      }
    }
  }
}
