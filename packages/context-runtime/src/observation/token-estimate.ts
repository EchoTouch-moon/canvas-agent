// Documented token estimator. Mirrors the v0.2 ContextResolver heuristic so the
// research observations are comparable to existing context accounting: whitespace
// is collapsed and every 4 non-whitespace characters count as one token.
export function estimateTokens(text: string): number {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return Math.max(1, Math.ceil(normalized.length / 4))
}

export function estimateChars(text: string): number {
  return text.length
}
