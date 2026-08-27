import type { MessageCategory } from '@canvas-agent/context-runtime'
import { decomposePiMessage } from '../element-decomposition'
import type { PiContentBlockView, PiMessageView } from '../pi-message-mapper'
import { piActiveRoleCategory } from './capability-profile'

// CR-004 Stage 0 — structural analysis of the native Pi message list.
//
// Message-to-source derivation REUSES the shadow seam's exported
// `decomposePiMessage` (element-decomposition.ts): the EXACT attributions it
// produces are the authoritative source keys (`run/tool-call://<id>` for
// assistant toolCall blocks with an id, `run/tool-result://<callId>` for
// toolResult messages with a call id). The Active composer must classify
// membership with exactly the same derivation the shadow planner used, so it
// never re-invents source identity.
//
// Block-shape facts (opaque content, mixed removable/keepable content) are
// derived from a local block walk because the mapper's internal `asBlocks`
// helper is not exported; the walk below replicates its content handling
// faithfully (string content => one text block; arrays keep block views).
//
// Offline only: no I/O, no clock, no network, no provider.

export interface AnalyzedNativeMessage {
  readonly index: number
  readonly role: string
  readonly category: MessageCategory
  /** EXACT source keys derived by the shadow decomposition, deduplicated, in order. */
  readonly sourceKeys: readonly string[]
  /** toolCall ids carried by assistant toolCall blocks (in block order). */
  readonly toolCallIds: readonly string[]
  /** toolResult call id, when this message is a tool result with a call id. */
  readonly resultToolCallId: string | undefined
  /** Count of opaque/reasoning blocks (thinking, image, structured, no-blocks). */
  readonly opaqueBlockCount: number
  /** Count of content that carries no EXACT source (text blocks, custom content). */
  readonly unattributedBlockCount: number
  /**
   * True when dropping this WHOLE message would remove only EXACT-attributed,
   * non-opaque content (pure toolCall-only assistant message, or a text-only
   * toolResult with a call id). Anything else must be preserved verbatim.
   */
  readonly droppable: boolean
}

export interface NativeToolPair {
  readonly toolCallId: string
  readonly callMessageIndex: number | undefined
  readonly resultMessageIndex: number | undefined
}

export interface AnalyzedNativeConversation {
  readonly messages: readonly AnalyzedNativeMessage[]
  /** Tool-call/result pairs found in the native list, keyed by call id. */
  readonly toolPairs: readonly NativeToolPair[]
  readonly opaqueBlockCount: number
}

function toBlocks(content: unknown): readonly PiContentBlockView[] {
  if (content === undefined) return []
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) return content.filter(isBlockView)
  return []
}

function isBlockView(value: unknown): value is PiContentBlockView {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { type?: unknown }).type === 'string'
}

function analyzeMessage(
  message: PiMessageView,
  index: number,
  ctx: { readonly runtimeSessionId: string; readonly modelCallSequence: number }
): AnalyzedNativeMessage {
  const role = message.role
  // Reused derivation: EXACT attributions come from the shadow decomposition,
  // so membership classification matches what the planner actually planned.
  const elements = decomposePiMessage(message, { ...ctx, messagePosition: index })
  const sourceKeys: string[] = []
  for (const { attribution } of elements) {
    if (attribution.confidence === 'EXACT' && attribution.sourceKey !== undefined) {
      if (!sourceKeys.includes(attribution.sourceKey)) sourceKeys.push(attribution.sourceKey)
    }
  }

  const blocks = toBlocks(message.content)
  const toolCallIds: string[] = []
  let opaqueBlockCount = 0
  let unattributedBlockCount = 0
  for (const block of blocks) {
    if (role === 'assistant') {
      if (block.type === 'toolCall') {
        const id = block.id ?? ''
        if (id !== '') toolCallIds.push(id)
        // A toolCall without an id has no EXACT source and cannot be dropped.
        if (id === '') unattributedBlockCount += 1
      } else if (block.type === 'text') {
        unattributedBlockCount += 1
      } else {
        // thinking (incl. redacted), images, structured blocks: opaque.
        opaqueBlockCount += 1
      }
    } else if (role === 'toolResult') {
      // The decomposition attributes the WHOLE tool-result message (text
      // included) to `run/tool-result://<callId>`, so text blocks here are
      // source content, not unattributed content. Non-text blocks are opaque.
      if (block.type !== 'text') {
        opaqueBlockCount += 1
      }
    } else if (role === 'user') {
      if (block.type === 'text') {
        unattributedBlockCount += 1
      } else {
        // images / structured blocks in user content: opaque.
        opaqueBlockCount += 1
      }
    } else {
      // custom messages: content is opaque, always preserved verbatim.
      opaqueBlockCount += 1
    }
  }
  if (blocks.length === 0 && role !== 'toolResult') {
    // A non-tool-result message with no recognizable blocks is an opaque whole
    // (mirrors the decomposition's OPAQUE_BLOCK fallback) and must be preserved.
    opaqueBlockCount += 1
  }

  const resultToolCallId = role === 'toolResult' ? message.toolCallId : undefined
  const droppable =
    sourceKeys.length > 0 &&
    opaqueBlockCount === 0 &&
    unattributedBlockCount === 0 &&
    ((role === 'assistant' && toolCallIds.length === blocks.length) ||
      role === 'toolResult')

  return {
    index,
    role,
    category: piActiveRoleCategory(role),
    sourceKeys,
    toolCallIds,
    resultToolCallId,
    opaqueBlockCount,
    unattributedBlockCount,
    droppable
  }
}

/**
 * Deterministically analyze the native Pi message list. The ctx ids only feed
 * the decomposition's observation refs (never persisted); the analysis output
 * is a pure function of the message list.
 */
export function analyzeNativeMessages(
  messages: readonly PiMessageView[],
  ctx: { readonly runtimeSessionId: string; readonly modelCallSequence: number }
): AnalyzedNativeConversation {
  const analyzed = messages.map((message, index) => analyzeMessage(message, index, ctx))

  const callsById = new Map<string, number>()
  const resultsById = new Map<string, number>()
  for (const message of analyzed) {
    for (const id of message.toolCallIds) {
      if (!callsById.has(id)) callsById.set(id, message.index)
    }
    if (message.resultToolCallId !== undefined && !resultsById.has(message.resultToolCallId)) {
      resultsById.set(message.resultToolCallId, message.index)
    }
  }
  const ids = [...new Set([...callsById.keys(), ...resultsById.keys()])].sort()
  const toolPairs: NativeToolPair[] = ids.map((toolCallId) => ({
    toolCallId,
    callMessageIndex: callsById.get(toolCallId),
    resultMessageIndex: resultsById.get(toolCallId)
  }))

  return {
    messages: analyzed,
    toolPairs,
    opaqueBlockCount: analyzed.reduce((sum, message) => sum + message.opaqueBlockCount, 0)
  }
}
