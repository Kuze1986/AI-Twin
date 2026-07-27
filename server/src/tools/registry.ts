// Tool registry — loads all Kuze tools, filters them by chat mode, and wraps execution so
// that EVERY call is timed and written to kuze.tool_call_log before its result is used
// (constraint 3). Execution never throws: a thrown tool becomes an explicit ok:false result.

import { shiftDbConfigured, stripeConfigured } from '../env.js'
import { supabaseAdmin } from '../supabaseAdmin.js'
import { getProviderName } from '../inference/messagesCreate.js'
import { getAegisState } from './getAegisState.js'
import { queryShift } from './queryShift.js'
import { queryStripe } from './queryStripe.js'
import type { KuzeTool, ToolContext, ToolResult } from './types.js'

const TOOLS: KuzeTool[] = [queryShift, queryStripe, getAegisState]

const OUTPUT_MAX_BYTES = 16 * 1024

/** Tools available for a given chat mode (undefined `modes` = all modes). */
export function getToolsForMode(mode: string): KuzeTool[] {
  return TOOLS.filter((t) => !t.modes || t.modes.includes(mode))
}

/** Anthropic tool definitions for the tools passed in. */
export function toAnthropicTools(tools: KuzeTool[]): Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Record<string, unknown>,
  }))
}

function truncateOutput(data: unknown): unknown {
  if (data === undefined) return null
  const json = JSON.stringify(data)
  const bytes = Buffer.byteLength(json, 'utf8')
  if (bytes > OUTPUT_MAX_BYTES) return { truncated: true, bytes }
  return data
}

/**
 * Execute a tool by name, logging the call to kuze.tool_call_log regardless of outcome.
 * A missing tool or a thrown execute() both resolve to ok:false — never a throw.
 */
export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  const startedAt = Date.now()
  const tool = TOOLS.find((t) => t.name === name)

  let result: ToolResult
  if (!tool) {
    result = {
      ok: false,
      error: `unknown tool "${name}"`,
      meta: { durationMs: Date.now() - startedAt, source: 'registry' },
    }
  } else {
    try {
      result = await tool.execute(input, ctx)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      result = {
        ok: false,
        error: `tool "${name}" threw: ${msg}`,
        meta: { durationMs: Date.now() - startedAt, source: name },
      }
    }
  }

  // Log before returning. Logging failure must not break the chat turn.
  try {
    await supabaseAdmin
      .schema('kuze')
      .from('tool_call_log')
      .insert({
        session_id: ctx.sessionId ?? null,
        user_id: ctx.userId ?? null,
        mode: ctx.mode,
        tool_name: name,
        input: input ?? {},
        ok: result.ok,
        output: result.ok ? truncateOutput(result.data) : null,
        error: result.ok ? null : (result.error ?? 'unknown error'),
        duration_ms: result.meta.durationMs,
      })
  } catch (e) {
    console.error('[tools] failed to write tool_call_log:', (e as Error).message)
  }

  return result
}

/** Startup banner — logs the active tool list and any degraded configuration. */
export function logToolStartup(): void {
  const provider = getProviderName()
  if (provider !== 'anthropic') {
    console.warn(
      `[tools] inference provider "${provider}" does not support tool calling — Kuze runs without operational tools`,
    )
    return
  }
  console.log(`[tools] active: ${TOOLS.map((t) => t.name).join(', ')}`)
  if (!shiftDbConfigured()) {
    console.warn('[tools] SHIFT_READONLY_DATABASE_URL unset — query_shift will report "not configured"')
  }
  if (!stripeConfigured()) {
    console.warn('[tools] STRIPE_RESTRICTED_KEY unset — query_stripe will report "not configured"')
  }
}
