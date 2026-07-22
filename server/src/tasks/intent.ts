import { messagesCreate } from '../inference/messagesCreate.js'
import type { Lead } from './create.js'

export interface TaskIntent {
  type: 'outreach_campaign' | 'follow_up' | 'custom'
  title: string
  goal: string
  leads: Lead[]
}

const DIRECTIVE_RE =
  /\b(reach(ing)? out|cold outreach|outreach to|follow[-\s]?up|drip|campaign|send (an?|out|some)\s+(email|outreach|cold|note)|email\s+\S+@|contact (these|them|the following|this)|draft (an?|some)\s+(email|outreach|note))\b/i
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/

/**
 * Cheap prefilter so the classifier LLM only runs on messages that plausibly direct Kuze
 * to do outreach — keeps normal conversation fast and avoids per-message classifier cost.
 */
export function looksLikeTaskDirective(message: string): boolean {
  return DIRECTIVE_RE.test(message) || EMAIL_RE.test(message)
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function coerceLeads(raw: unknown): Lead[] {
  if (!Array.isArray(raw)) return []
  const out: Lead[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const email = String(o.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) continue
    out.push({
      email,
      name: o.name ? String(o.name) : undefined,
      company: o.company ? String(o.company) : undefined,
    })
  }
  return out
}

/**
 * Ask the fast model whether a chat message is a directive to run a task, and extract
 * structured fields. Returns null when it is not a task, or when an outreach task has no
 * usable recipients (so normal chat handles it and Kuze can ask for addresses).
 */
export async function extractTaskIntent(message: string): Promise<TaskIntent | null> {
  const system =
    'You classify whether a message is the user directing an assistant to run an outreach task or produce a concrete deliverable, and extract structured fields. Output ONLY a JSON object, no prose, no markdown fences.'
  const user = `Message:\n"""${message}"""\n\nReturn JSON with keys:\n- is_task: boolean — true ONLY if the user clearly wants the assistant to send outreach / follow-ups now, or to produce a specific written deliverable now. Casual mention, questions, or general chat are NOT tasks.\n- type: "outreach_campaign" | "follow_up" | "custom" (use "custom" when there are no recipients to email).\n- title: a short label for the task.\n- goal: one or two sentences describing what to accomplish.\n- leads: array of { "email", "name", "company" } for every recipient/email address mentioned (empty array if none).\n\nIf is_task is false, return {"is_task": false}.`

  let text = ''
  try {
    const msg = await messagesCreate({
      tier: 'fast',
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
      stream: false,
    })
    text =
      (msg as { content: Array<{ type: string; text?: string }> }).content.find((b) => b.type === 'text')
        ?.text ?? ''
  } catch (e) {
    console.error('[tasks/intent] classifier failed:', (e as Error).message)
    return null
  }

  const obj = parseJsonObject(text)
  if (!obj || obj.is_task !== true) return null

  const rawType = String(obj.type ?? 'custom')
  const leads = coerceLeads(obj.leads)
  let type: TaskIntent['type'] =
    rawType === 'outreach_campaign' || rawType === 'follow_up' || rawType === 'custom'
      ? (rawType as TaskIntent['type'])
      : 'custom'

  // An outreach task with no addresses can't be executed — let normal chat handle it.
  if ((type === 'outreach_campaign' || type === 'follow_up') && leads.length === 0) return null
  // Recipients present but classified custom → it's really outreach.
  if (type === 'custom' && leads.length > 0) type = 'outreach_campaign'

  const title = String(obj.title ?? '').trim() || (leads.length > 0 ? `Outreach to ${leads.length} lead(s)` : 'Task')
  const goal = String(obj.goal ?? '').trim() || message.trim()

  return { type, title, goal, leads }
}
