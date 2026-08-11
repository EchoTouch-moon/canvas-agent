import {
  hashNormalizedMessage,
  utf8ByteLength,
  type BinaryBlockMetadata,
  type NormalizedMessageInput
} from '@canvas-agent/context-runtime'

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

// Deterministic canonical serialization of tool-call arguments. Key order is
// sorted so the same arguments always produce the same fingerprint string.
export function stableSerializeArguments(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerializeArguments(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerializeArguments(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

interface FingerprintParts {
  readonly fingerprintText: string
  readonly binaryBlocks: readonly BinaryBlockMetadata[]
}

// Builds the canonical in-memory semantic fingerprint for a message. Text and
// thinking blocks contribute their content; assistant tool-calls contribute
// name/id/arguments; image/binary blocks contribute type + byte length + hash
// (never the payload). Tool-result messages contribute their text content and
// error semantics via the caller-provided tool context.
export function buildMessageFingerprint(
  message: PiMessageView,
  toolContext: { toolName?: string; toolCallId?: string; isError?: boolean } = {}
): FingerprintParts {
  const blocks = asBlocks(message.content)
  const parts: string[] = []
  const binaryBlocks: BinaryBlockMetadata[] = []
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push(`thinking:${block.thinking}`)
    } else if (block.type === 'toolCall') {
      const args = stableSerializeArguments(block.arguments)
      const id = block.id ?? ''
      const name = block.name ?? ''
      parts.push(`toolCall:${name}:${id}:${args}`)
    } else if (block.type === 'image') {
      const data = typeof block.data === 'string' ? block.data : ''
      const byteLength = utf8ByteLength(data)
      const contentHash = hashNormalizedMessage(data)
      binaryBlocks.push({
        type: 'image',
        ...(block.mimeType !== undefined ? { mimeType: block.mimeType } : {}),
        byteLength,
        contentHash
      })
      parts.push(`image:${block.mimeType ?? ''}:${byteLength}:${contentHash}`)
    }
  }
  if (message.toolName !== undefined || message.toolCallId !== undefined || message.isError !== undefined) {
    const context: string[] = []
    if (toolContext.toolName !== undefined) context.push(`toolName:${toolContext.toolName}`)
    if (toolContext.toolCallId !== undefined) context.push(`toolCallId:${toolContext.toolCallId}`)
    if (toolContext.isError !== undefined) context.push(`isError:${String(toolContext.isError)}`)
    parts.push(`toolContext:${context.join(',')}`)
  }
  return { fingerprintText: parts.join('\n'), binaryBlocks }
}

// Map a Pi message to the provider-neutral normalized input used by the
// Context Runtime. The mapping is deterministic and never leaks raw payload.
export function mapPiMessage(message: PiMessageView): NormalizedMessageInput {
  const role = message.role
  const toolContext: { toolName?: string; toolCallId?: string; isError?: boolean } = {}
  if (message.toolName !== undefined) toolContext.toolName = message.toolName
  if (message.toolCallId !== undefined) toolContext.toolCallId = message.toolCallId
  if (message.isError !== undefined) toolContext.isError = message.isError
  const { fingerprintText, binaryBlocks } = buildMessageFingerprint(message, toolContext)

  if (role === 'user') {
    return {
      role: 'user',
      category: 'USER',
      contentType: 'text',
      fingerprintText,
      ...(binaryBlocks.length > 0 ? { binaryBlocks } : {})
    }
  }
  if (role === 'assistant') {
    return {
      role: 'assistant',
      category: 'ASSISTANT',
      contentType: 'text',
      fingerprintText,
      ...(binaryBlocks.length > 0 ? { binaryBlocks } : {})
    }
  }
  if (role === 'toolResult') {
    return {
      role: 'toolResult',
      category: 'TOOL_RESULT',
      contentType: 'toolResult',
      fingerprintText,
      ...(message.toolName !== undefined ? { toolName: message.toolName } : {}),
      ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
      ...(message.isError !== undefined ? { isError: message.isError } : {}),
      ...(binaryBlocks.length > 0 ? { binaryBlocks } : {})
    }
  }
  return {
    role,
    category: 'OTHER',
    contentType: message.customType ?? 'custom',
    fingerprintText,
    ...(binaryBlocks.length > 0 ? { binaryBlocks } : {})
  }
}

export function mapPiMessages(messages: readonly PiMessageView[]): NormalizedMessageInput[] {
  return messages.map(mapPiMessage)
}
