// Google Gemini adapter (@google/generative-ai). Normalizes to the Anthropic-shaped result.

import { GoogleGenerativeAI } from '@google/generative-ai'

let cached: GoogleGenerativeAI | null = null
function getClient(): GoogleGenerativeAI {
  if (!cached) {
    cached = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '')
  }
  return cached
}

// Extract plain text from an Anthropic-style content value (string or content blocks).
function blockText(content: string | any[]): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

function toGeminiContents(messages: { role: string; content: string | any[] }[]) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: blockText(m.content) }],
  }))
}

function getModel(model: string, system?: string) {
  return getClient().getGenerativeModel({
    model,
    ...(system && system.trim() ? { systemInstruction: system } : {}),
  })
}

export async function messagesCreate(params: {
  model: string
  max_tokens: number
  system?: string
  messages: { role: string; content: string | any[] }[]
}): Promise<{ content: { type: string; text: string }[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }> {
  const result = await getModel(params.model, params.system).generateContent({
    contents: toGeminiContents(params.messages),
    generationConfig: { maxOutputTokens: params.max_tokens },
  })
  const usage = result.response.usageMetadata
  return {
    content: [{ type: 'text', text: result.response.text() }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: usage?.promptTokenCount ?? 0,
      output_tokens: usage?.candidatesTokenCount ?? 0,
    },
  }
}

export async function* streamText(params: {
  model: string
  max_tokens: number
  system?: string
  messages: { role: string; content: string | any[] }[]
}): AsyncGenerator<string> {
  const result = await getModel(params.model, params.system).generateContentStream({
    contents: toGeminiContents(params.messages),
    generationConfig: { maxOutputTokens: params.max_tokens },
  })
  for await (const chunk of result.stream) {
    const text = chunk.text()
    if (text) yield text
  }
}
