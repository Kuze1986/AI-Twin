/** Rough token estimate for budgeting (documented in README). */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Truncate oldest turns first until estimated tokens <= maxTokens.
 * Does not drop the newest user message (caller should pass history excluding current turn or include it last).
 */
export function budgetHistory(turns: HistoryTurn[], maxTokens: number): HistoryTurn[] {
  if (turns.length === 0) return []
  let total = turns.reduce((s, t) => s + estimateTokens(t.content), 0)
  if (total <= maxTokens) return turns
  const out = [...turns]
  while (out.length > 0 && total > maxTokens) {
    const removed = out.shift()!
    total -= estimateTokens(removed.content)
  }
  return out
}
