import Anthropic from '@anthropic-ai/sdk'

let cached: Anthropic | null = null

function getClient(): Anthropic {
  if (!cached) {
    cached = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    })
  }
  return cached
}

/**
 * Passthrough to Anthropic Messages API ({ model, max_tokens, system?, messages })
 */
export async function messagesCreate(params: {
  model: string
  max_tokens: number
  system?: string
  messages: Anthropic.MessageParam[]
  stream?: boolean
  tools?: any[]
  tool_choice?: any
}): Promise<any> {
  return getClient().messages.create(params as Anthropic.MessageCreateParams)
}
