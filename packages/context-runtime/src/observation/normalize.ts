import { hashNormalizedMessage } from '../util/hash'
import { estimateChars, estimateTokens } from './token-estimate'
import type { MessageCategory, ModelMessageDescriptor } from './types'

// Provider-neutral normalized message shape produced by an agent integration
// (for example the Pi adapter). The Runtime core only ever sees this neutral
// form; it never imports Pi / OpenCode / Codex / DeepSeek payload types.
export interface NormalizedMessageInput {
  readonly role: string
  readonly category: MessageCategory
  // e.g. 'text' | 'thinking' | 'image' | 'toolCall' | 'toolResult' | 'custom'
  readonly contentType: string
  // Deterministic, bounded text extract used for hashing and size estimation.
  // For tool-call/tool-result messages this carries the tool name, not raw output.
  readonly text: string
  readonly toolName?: string
  readonly isError?: boolean
}

// Bounded per-message descriptor plus its stable content hash.
export function normalizeMessage(
  input: NormalizedMessageInput,
  position: number,
  rawPreview?: string
): ModelMessageDescriptor {
  const text = input.text ?? ''
  return {
    position,
    role: input.role,
    contentType: input.contentType,
    estimatedTokens: estimateTokens(text),
    estimatedChars: estimateChars(text),
    contentHash: hashNormalizedMessage(text),
    ...(input.toolName !== undefined ? { toolName: input.toolName } : {}),
    ...(input.isError !== undefined ? { isError: input.isError } : {}),
    ...(rawPreview !== undefined ? { rawPreview } : {})
  }
}

// Count category distribution across a message set.
export function countCategories(
  messages: readonly NormalizedMessageInput[]
): Record<MessageCategory, number> {
  const counts: Record<MessageCategory, number> = {
    USER: 0,
    ASSISTANT: 0,
    TOOL_RESULT: 0,
    OTHER: 0
  }
  for (const message of messages) {
    counts[message.category] = (counts[message.category] ?? 0) + 1
  }
  return counts
}

export function countToolResults(messages: readonly NormalizedMessageInput[]): number {
  return messages.filter((message) => message.category === 'TOOL_RESULT').length
}
