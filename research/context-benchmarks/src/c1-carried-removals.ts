import type { PiMessageView } from '@canvas-agent/pi-context-integration'
import {
  activeMessagesHash,
  applyCarriedRemovals
} from '@canvas-agent/pi-context-integration/experimental'

export interface C1CarriedRemoval {
  readonly toolCallId: string
  readonly pairFingerprint: string
  readonly removalTransitionId: string
}

export function c1ToolPairFingerprint(messages: readonly PiMessageView[], id: string): string {
  let calls = 0
  let results = 0
  const pair = messages.filter((message) => {
    if (message.role === 'toolResult' && message.toolCallId === id) {
      results += 1
      return true
    }
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return false
    const matches = message.content.filter(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'toolCall' &&
        (block as { id?: unknown }).id === id
    ).length
    calls += matches
    return matches > 0
  })
  if (calls !== 1 || results !== 1)
    throw new Error('carried removal requires an unambiguous tool pair')
  return activeMessagesHash(pair)
}

/** Only previously sent removals with unchanged provenance can be carried. */
export function c1CompositionBasis(
  messages: readonly PiMessageView[],
  removals: readonly C1CarriedRemoval[],
  retainedSourceKeys: ReadonlySet<string>
) {
  const ids = new Set<string>()
  for (const removal of removals) {
    const keys = [
      `run/tool-call://${removal.toolCallId}`,
      `run/tool-result://${removal.toolCallId}`
    ]
    if (keys.every((key) => retainedSourceKeys.has(key))) continue // explicit restoration
    if (
      keys.some((key) => retainedSourceKeys.has(key)) ||
      !removal.removalTransitionId ||
      c1ToolPairFingerprint(messages, removal.toolCallId) !== removal.pairFingerprint
    ) {
      throw new Error('carried removal provenance or pair membership changed')
    }
    ids.add(removal.toolCallId)
  }
  return {
    messages: applyCarriedRemovals(messages, ids),
    removedSourceKeys: [...ids].flatMap((id) => [
      `run/tool-call://${id}`,
      `run/tool-result://${id}`
    ])
  }
}
