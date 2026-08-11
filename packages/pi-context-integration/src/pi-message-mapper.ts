import type { NormalizedMessageInput } from '@canvas-agent/context-runtime'

// Provider-neutral structural view of a Pi AgentMessage. We deliberately do not
// depend on Pi's exact AgentMessage type here: the mapper only reads role and
// content fields that are stable across Pi versions, so the Runtime core stays
// Pi-free. `content` is the union of Pi message content arrays.
export interface PiMessageView {
  readonly role: string
  readonly content?: readonly unknown[] | string
  readonly toolName?: string
  readonly toolCallId?: string
  readonly isError?: boolean
  readonly customType?: string
}

export interface PiContentBlockView {
  readonly type: string
  readonly text?: string
  readonly thinking?: string
  readonly name?: string
  readonly id?: string
  readonly arguments?: unknown
  readonly data?: string
  readonly mimeType?: string
}

function asBlocks(content: unknown): readonly PiContentBlockView[] {
  if (content === undefined) {
    return []
  }
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  if (Array.isArray(content)) {
    return content.filter(isBlockView)
  }
  return []
}

function isBlockView(value: unknown): value is PiContentBlockView {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { type?: unknown }).type === 'string'
}

// Deterministic, bounded text extract used for hashing and size estimation.
// Only text/thinking payloads and tool names contribute; image data and tool
// arguments are deliberately excluded so raw secret-bearing payload never
// reaches the Runtime descriptors.
export function extractBoundedText(content: unknown): string {
  const blocks = asBlocks(content)
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push(block.thinking)
    }
  }
  return parts.join('\n')
}

// Map a Pi message to the provider-neutral normalized input used by the
// Context Runtime. The mapping is deterministic and never leaks raw payload.
export function mapPiMessage(message: PiMessageView): NormalizedMessageInput {
  const role = message.role
  if (role === 'user') {
    return {
      role: 'user',
      category: 'USER',
      contentType: 'text',
      text: extractBoundedText(message.content)
    }
  }
  if (role === 'assistant') {
    return {
      role: 'assistant',
      category: 'ASSISTANT',
      contentType: 'text',
      text: extractBoundedText(message.content)
    }
  }
  if (role === 'toolResult') {
    return {
      role: 'toolResult',
      category: 'TOOL_RESULT',
      contentType: 'toolResult',
      text: message.toolName ?? 'tool',
      ...(message.toolName !== undefined ? { toolName: message.toolName } : {}),
      ...(message.isError !== undefined ? { isError: message.isError } : {})
    }
  }
  return {
    role,
    category: 'OTHER',
    contentType: message.customType ?? 'custom',
    text: extractBoundedText(message.content)
  }
}

export function mapPiMessages(messages: readonly PiMessageView[]): NormalizedMessageInput[] {
  return messages.map(mapPiMessage)
}
