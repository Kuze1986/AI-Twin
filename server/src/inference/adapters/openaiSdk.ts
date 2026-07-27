// Native OpenAI adapter (official `openai` SDK). Normalizes to the Anthropic-shaped result
// so the unified messagesCreate layer stays uniform.

import OpenAI from 'openai'
import { toOpenAiMessages } from './openAiCompatibleHttp.js'

let cached: OpenAI | null = null
function getClient(): OpenAI {
  if (!cached) {
    cached = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    })
  }
  return cached
}

export async function messagesCreate(params: {
  model: string
  max_tokens: number
  system?: string
  messages: { role: string; content: string | any[] }[]
}): Promise<{ content: { type: string; text: string }[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }> {
  const res = await getClient().chat.completions.create({
    model: params.model,
    max_tokens: params.max_tokens,
    messages: toOpenAiMessages(params.system, params.messages) as OpenAI.Chat.ChatCompletionMessageParam[],
  })
  const choice = res.choices[0]
  return {
    content: [{ type: 'text', text: choice?.message?.content ?? '' }],
    stop_reason: choice?.finish_reason ?? 'stop',
    usage: {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
    },
  }
}

export async function* streamText(params: {
  model: string
  max_tokens: number
  system?: string
  messages: { role: string; content: string | any[] }[]
}): AsyncGenerator<string> {
  const stream = await getClient().chat.completions.create({
    model: params.model,
    max_tokens: params.max_tokens,
    messages: toOpenAiMessages(params.system, params.messages) as OpenAI.Chat.ChatCompletionMessageParam[],
    stream: true,
  })
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (typeof delta === 'string' && delta) yield delta
  }
}
