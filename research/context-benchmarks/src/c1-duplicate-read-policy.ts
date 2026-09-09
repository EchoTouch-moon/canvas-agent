import { scanDuplicateReads } from '@canvas-agent/pi-context-integration/experimental'
import { createHash } from 'node:crypto'
import type { PiMessageView } from '@canvas-agent/pi-context-integration'
import type { C1AgentObservation, C1LegExecutionResult } from './c1-live-preflight'

export const C1_DUPLICATE_READ_POLICY_ID = 'C1_DUPLICATE_READ_CANDIDATE_V1'

type Block = Record<string, unknown>
function blocks(message: PiMessageView): Block[] {
  if (!Array.isArray(message.content)) return []
  return message.content.filter((item): item is Block => typeof item === 'object' && item !== null)
}

/**
 * Research candidate used only by diagnostic probes, NOT the frozen live launcher.
 * Only isolated read call/result pairs with exact arguments and identical text
 * qualify. Mixed assistant content, errors, opaque blocks and ambiguous IDs stay.
 * Raw paths/content remain in memory; evidence is a hash and the two source IDs.
 */
export function applyC1DuplicateReadPolicy(
  observation: C1AgentObservation,
  knownCommittedSourceKeys: ReadonlySet<string> = new Set()
): C1AgentObservation {
  const messages = observation.messages
  const idCounts = new Map<string, number>()
  for (const message of messages) {
    for (const block of blocks(message)) {
      if (block['type'] === 'toolCall' && typeof block['id'] === 'string') {
        idCounts.set(block['id'], (idCounts.get(block['id']) ?? 0) + 1)
      }
    }
    if (message.role === 'toolResult' && message.toolCallId !== undefined) {
      idCounts.set(message.toolCallId, (idCounts.get(message.toolCallId) ?? 0) + 1)
    }
  }
  const eligible = new Map<string, { sourceKeys: string[]; fingerprint: string }>()
  const excluded = new Map<string, string>()
  const protectedKeys = new Set([
    ...observation.latestVerificationSourceKeys,
    ...observation.recentEvidenceSourceKeys
  ])
  for (let index = 0; index + 1 < messages.length; index += 1) {
    const callMessage = messages[index]!
    const result = messages[index + 1]!
    const callBlocks = blocks(callMessage)
    const call = callBlocks[0]
    if (
      callMessage.role !== 'assistant' ||
      callBlocks.length !== 1 ||
      !Array.isArray(callMessage.content) ||
      callMessage.content.length !== 1 ||
      !call ||
      call['type'] !== 'toolCall' ||
      call['name'] !== 'read' ||
      typeof call['id'] !== 'string' ||
      result.role !== 'toolResult' ||
      result.toolName !== 'read' ||
      result.isError !== false ||
      result.toolCallId !== call['id'] ||
      idCounts.get(call['id']) !== 2
    )
      continue
    const args = call['arguments']
    if (typeof args !== 'object' || args === null || Array.isArray(args)) continue
    const record = args as Record<string, unknown>
    if (
      Object.keys(record).length !== 1 ||
      typeof record['path'] !== 'string' ||
      !record['path'] ||
      record['path'].startsWith('/') ||
      record['path'].includes('\\') ||
      record['path'].split('/').some((part) => part === '..' || part === '.')
    )
      continue
    const textBlocks = blocks(result)
    if (
      !Array.isArray(result.content) ||
      textBlocks.length === 0 ||
      textBlocks.length !== result.content.length ||
      textBlocks.some(
        (block) =>
          block['type'] !== 'text' ||
          typeof block['text'] !== 'string' ||
          Object.keys(block).some((key) => key !== 'type' && key !== 'text')
      )
    )
      continue
    const fingerprint = createHash('sha256').update(JSON.stringify(result.content)).digest('hex')
    const sourceKeys = [`run/tool-call://${call['id']}`, `run/tool-result://${call['id']}`]
    if (!sourceKeys.every((key) => observation.currentTargetSourceKeys.includes(key))) continue
    eligible.set(call['id'], { sourceKeys, fingerprint })
  }
  // Reuse the established v3 scanner, including its edit-between-reads barrier.
  for (const entry of scanDuplicateReads(messages).entries) {
    const anchor = eligible.get(entry.anchorCallId)
    if (anchor === undefined) continue
    for (const duplicate of entry.duplicates) {
      const previous = eligible.get(duplicate.callId)
      if (
        previous === undefined ||
        previous.fingerprint !== anchor.fingerprint ||
        previous.sourceKeys.some(
          (key) => protectedKeys.has(key) || !knownCommittedSourceKeys.has(key)
        )
      )
        continue
      const evidenceRef = `duplicate-read-sha256:${createHash('sha256')
        .update(JSON.stringify([entry.path, anchor.fingerprint, entry.anchorCallId]))
        .digest('hex')}`
      for (const key of previous.sourceKeys) excluded.set(key, evidenceRef)
    }
  }
  if (excluded.size === 0) return observation
  return {
    ...observation,
    currentTargetSourceKeys: observation.currentTargetSourceKeys.filter(
      (key) => !excluded.has(key)
    ),
    excludedSourceKeys: [...new Set([...observation.excludedSourceKeys, ...excluded.keys()])],
    sourceLifecycleSignals: [
      ...(observation.sourceLifecycleSignals ?? []),
      ...[...excluded].map(([sourceKey, evidenceRef]) => ({
        sourceKey,
        kind: 'SUPERSEDED' as const,
        evidenceRef
      }))
    ]
  }
}

/** Include proven prior removals so duplicate exclusion does not oscillate back to ADD. */
export function c1KnownCommittedSourceKeys(execution: C1LegExecutionResult): ReadonlySet<string> {
  return new Set([
    ...(execution.workingSet?.items.flatMap((item) => item.sourceKeys) ?? []),
    ...(execution.transition?.orderedDecisions
      .filter((decision) => decision.kind === 'REMOVE')
      .map((decision) => decision.sourceKey) ?? []),
    ...execution.carriedRemovedSourceKeys
  ])
}
