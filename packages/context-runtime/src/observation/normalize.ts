import { hashNormalizedMessage } from '../util/hash'
import { estimateChars, estimateTokens } from './token-estimate'
import type { BinaryBlockMetadata, MessageCategory, ModelMessageDescriptor } from './types'

// Provider-neutral normalized message shape produced by an agent integration
// (for example the Pi adapter). The Runtime core only ever sees this neutral
// form; it never imports Pi / OpenCode / Codex / DeepSeek payload types.
//
// `fingerprintText` is the canonical IN-MEMORY semantic fingerprint source. It
// carries the full model-relevant AgentMessage structure available at the
// observation seam: text/thinking blocks, assistant tool-call name/id/
// arguments, and tool-result text + error semantics. It is used only for
// hashing and size estimation and is never persisted by default.
export interface NormalizedMessageInput {
  readonly role: string
  readonly category: MessageCategory
  // e.g. 'text' | 'thinking' | 'image' | 'toolCall' | 'toolResult' | 'custom'
  readonly contentType: string
  // Canonical semantic fingerprint text (in-memory only; never persisted).
  readonly fingerprintText: string
  readonly toolName?: string
  readonly toolCallId?: string
  readonly isError?: boolean
  // Bounded metadata for binary/image blocks (type + byte length + hash).
  readonly binaryBlocks?: readonly BinaryBlockMetadata[]
}

// Bounded per-message descriptor plus its stable content hash. The descriptor
// persists only hash + lengths/counts + tool metadata, never raw content.
export function normalizeMessage(
  input: NormalizedMessageInput,
  position: number,
  rawPreview?: string
): ModelMessageDescriptor {
  const fingerprint = input.fingerprintText ?? ''
  return {
    position,
    role: input.role,
    contentType: input.contentType,
    estimatedTokens: estimateTokens(fingerprint),
    estimatedChars: estimateChars(fingerprint),
    contentHash: hashNormalizedMessage(fingerprint),
    ...(input.toolName !== undefined ? { toolName: input.toolName } : {}),
    ...(input.toolCallId !== undefined ? { toolCallId: input.toolCallId } : {}),
    ...(input.isError !== undefined ? { isError: input.isError } : {}),
    ...(input.binaryBlocks !== undefined ? { binaryBlocks: input.binaryBlocks } : {}),
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

export function countBinaryBlocks(messages: readonly NormalizedMessageInput[]): number {
  return messages.reduce(
    (sum, message) => sum + (message.binaryBlocks?.length ?? 0),
    0
  )
}
