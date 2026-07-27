// Kuze Operational Tool Layer — shared types (Phase 1).
// Each tool is read-only against product data; the only thing the layer writes is
// kuze.tool_call_log. Every tool MUST surface failures explicitly (ok:false + a specific
// message) — never return empty/default data on error.

// A minimal JSON-Schema shape; the model sees this to decide how to call the tool.
export type JSONSchema = Record<string, unknown>

export interface ToolContext {
  userId?: string
  sessionId?: string
  mode: string
}

export interface ToolResult {
  ok: boolean
  data?: unknown // JSON-serializable
  error?: string // human-readable, specific ("shift database connection refused")
  meta: { durationMs: number; source: string }
}

export interface KuzeTool {
  name: string
  description: string // written for the model
  inputSchema: JSONSchema
  modes?: string[] // restrict to these modes; undefined = all modes
  productTags?: string[] // Phase 5; unused in Phase 1 but carried on the interface
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>
}

/** Convenience for tools: stamp meta onto a result. */
export function ok(data: unknown, source: string, startedAt: number): ToolResult {
  return { ok: true, data, meta: { durationMs: Date.now() - startedAt, source } }
}

export function fail(error: string, source: string, startedAt: number): ToolResult {
  return { ok: false, error, meta: { durationMs: Date.now() - startedAt, source } }
}
