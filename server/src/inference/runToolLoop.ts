// Tool-execution loop for the Anthropic provider. Streams text to the client in real time
// while transparently running any tools the model requests, then continuing the conversation
// with the tool results — up to `maxIterations` provider round-trips (spec §1.1).
//
// Only the Anthropic path reaches here; callers gate on supportsTools(). The final assistant
// text (everything the user saw streamed) is returned so the existing Sentinel validator chain
// can run on it unchanged.

import { messagesCreate } from './messagesCreate.js'
import { executeTool, toAnthropicTools } from '../tools/registry.js'
import type { KuzeTool, ToolContext } from '../tools/types.js'

export type ToolEventState = 'running' | 'done' | 'error'

interface ToolUseBlock {
  id: string
  name: string
  inputJson: string
}

export interface RunToolLoopArgs {
  system: string
  messages: { role: 'user' | 'assistant'; content: string | any[] }[]
  tools: KuzeTool[]
  ctx: ToolContext
  maxIterations: number
  maxTokens?: number
  tier?: string
  onText: (text: string) => void
  onToolEvent: (tool: string, state: ToolEventState) => void
}

/**
 * Runs the streaming tool loop and resolves with the full assistant text the user saw.
 * Throws on provider/inference errors so the caller can emit an SSE error, matching the
 * non-tool streaming path.
 */
export async function runToolLoop(args: RunToolLoopArgs): Promise<string> {
  const { system, tools, ctx, maxIterations, onText, onToolEvent } = args
  const anthropicTools = toAnthropicTools(tools)
  const messages = [...args.messages]
  let assistantText = ''

  for (let iteration = 0; iteration <= maxIterations; iteration++) {
    // On the final permitted iteration, drop tools so the model must answer in text and the
    // loop is guaranteed to terminate rather than requesting yet another tool.
    const offerTools = iteration < maxIterations
    const stream = await messagesCreate({
      tier: args.tier ?? 'balanced',
      max_tokens: args.maxTokens ?? 8192,
      system,
      messages,
      stream: true,
      ...(offerTools ? { tools: anthropicTools } : {}),
    })

    // Reconstruct the assistant turn from streamed events.
    const textParts: string[] = []
    const toolBlocks = new Map<number, ToolUseBlock>()
    let stopReason: string | null = null

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block?.type === 'tool_use') {
          toolBlocks.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            inputJson: '',
          })
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') {
          const text = event.delta.text as string
          assistantText += text
          textParts.push(text)
          onText(text)
        } else if (event.delta?.type === 'input_json_delta') {
          const block = toolBlocks.get(event.index)
          if (block) block.inputJson += event.delta.partial_json as string
        }
      } else if (event.type === 'message_delta') {
        stopReason = event.delta?.stop_reason ?? stopReason
      }
    }

    if (stopReason !== 'tool_use' || toolBlocks.size === 0) {
      // Final answer — already streamed to the client.
      return assistantText
    }

    // Rebuild the assistant message (text + tool_use blocks) and run the tools.
    const assistantContent: any[] = []
    const turnText = textParts.join('')
    if (turnText) assistantContent.push({ type: 'text', text: turnText })

    const toolResults: any[] = []
    for (const block of toolBlocks.values()) {
      assistantContent.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: safeParse(block.inputJson),
      })
      onToolEvent(block.name, 'running')
      const result = await executeTool(block.name, safeParse(block.inputJson), ctx)
      onToolEvent(block.name, result.ok ? 'done' : 'error')
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result.ok ? result.data : { error: result.error }),
        is_error: !result.ok,
      })
    }

    messages.push({ role: 'assistant', content: assistantContent })
    messages.push({ role: 'user', content: toolResults })
  }

  return assistantText
}

function safeParse(json: string): unknown {
  if (!json.trim()) return {}
  try {
    return JSON.parse(json)
  } catch {
    return {}
  }
}
