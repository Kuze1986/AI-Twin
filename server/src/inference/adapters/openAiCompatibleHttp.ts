/**
 * Maps AI-Twin's Anthropic Messages API-shaped calls onto OpenAI-compatible HTTP
 * POST /chat/completions (Ollama, vLLM, LiteLLM, many local stacks).
 */

function normalizeBaseUrl(raw: string | undefined): string {
  const s = String(raw || '').trim().replace(/\/$/, '')
  if (!s) return ''
  if (/\/v1$/i.test(s)) return s
  return `${s}/v1`
}

function anthropicBlocksToOpenAIContent(content: string | { type: string; text?: string; source?: any }[]): string | { type: string; text?: string; image_url?: { url: string } }[] {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content ?? '') }]
  const parts: { type: string; text?: string; image_url?: { url: string } }[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'image' && block.source?.type === 'base64') {
      const mt = block.source.media_type || 'image/jpeg'
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${mt};base64,${block.source.data}`
        }
      })
    }
  }
  if (parts.length === 0) return ''
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text || ''
  return parts
}

export function normalizeOpenAiBase(): string {
  const base = normalizeBaseUrl(process.env.KUZE_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL)
  if (!base) {
    throw new Error('[inference] openai_compatible: set KUZE_OPENAI_BASE_URL (e.g. http://localhost:11434/v1)')
  }
  return base
}

/**
 * Streaming variant for the OpenAI-compatible endpoint. Yields text deltas. Parses the SSE
 * `data:` frames from POST /chat/completions with stream:true.
 */
export async function* streamText(params: {
  model: string
  max_tokens: number
  system?: string
  messages: { role: string; content: string | any[] }[]
}): AsyncGenerator<string> {
  const url = `${normalizeOpenAiBase()}/chat/completions`
  const apiKey = process.env.KUZE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.model,
      messages: toOpenAiMessages(params.system, params.messages),
      max_tokens: params.max_tokens,
      stream: true,
    }),
  })
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '')
    throw new Error(`[inference] openai_compatible stream HTTP error: ${res.status} ${res.statusText} ${txt}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, sep).trim()
      buffer = buffer.slice(sep + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (typeof delta === 'string') yield delta
      } catch {
        /* ignore keepalive / partial frames */
      }
    }
  }
}

export function toOpenAiMessages(system: string | undefined, anthropicMessages: { role: string; content: string | any[] }[]): { role: string; content: string | any[] }[] {
  const out: { role: string; content: string | any[] }[] = []
  if (system != null && String(system).trim() !== '') {
    out.push({ role: 'system', content: String(system) })
  }
  const list = Array.isArray(anthropicMessages) ? anthropicMessages : []
  for (const m of list) {
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    out.push({
      role,
      content: anthropicBlocksToOpenAIContent(m.content)
    })
  }
  return out
}

/**
 * Mirrors Anthropic's messages.create resolved shape loosely:
 * { content: [{ type: 'text', text }], usage: { input_tokens, output_tokens } }
 */
export async function messagesCreate(params: {
  model: string
  max_tokens: number
  system?: string
  messages: { role: string; content: string | any[] }[]
}): Promise<{ content: { type: string; text: string }[]; usage: { input_tokens: number; output_tokens: number } }> {
  const base = normalizeBaseUrl(
    process.env.KUZE_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL
  )
  if (!base) {
    throw new Error(
      '[inference] openai_compatible: set KUZE_OPENAI_BASE_URL (e.g. http://localhost:11434/v1)'
    )
  }

  const url = `${base}/chat/completions`
  const apiKey = process.env.KUZE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? ''

  const body = {
    model: params.model,
    messages: toOpenAiMessages(params.system, params.messages),
    max_tokens: params.max_tokens
  }

  const headers: { 'Content-Type': string; Authorization?: string } = { 'Content-Type': 'application/json' }
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      typeof json?.error === 'object'
        ? json.error.message || JSON.stringify(json.error)
        : json?.error || `${res.status} ${res.statusText}`
    throw new Error(`[inference] openai_compatible HTTP error: ${msg}`)
  }

  const choice = json.choices?.[0]
  const raw = choice?.message?.content
  const text =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw
          .filter((p: any) => p?.type === 'text' && p.text)
          .map((p: any) => p.text)
          .join('\n')
        : ''

  const u = json.usage || {}
  return {
    content: [{ type: 'text', text: text || '' }],
    usage: {
      input_tokens: u.prompt_tokens || 0,
      output_tokens: u.completion_tokens || 0
    }
  }
}
