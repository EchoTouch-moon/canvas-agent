import { createHash } from 'node:crypto'
import type { PiMessageView } from '@canvas-agent/pi-context-integration'
import type { C1AgentObservation, C1LegExecutionResult } from './c1-live-preflight'

export const C1_SUPERSEDED_VERSION_POLICY_ID = 'C1_SUPERSEDED_VERSION_V1'

/**
 * SUPERSEDED_VERSION lifecycle policy (diagnostic candidate, NOT the frozen
 * live launcher). Implements the five-condition trigger contract from
 * docs/plan/c1-superseded-version-lifecycle-contract-2026-09-08.zh-CN.md:
 *
 *   1. exact path identity (read args path === edit/write args path, byte-equal)
 *   2. successful mutation execution (edit/write tool result is not an error)
 *   3. before-version known (clean text read result, v1 = sha256(text))
 *   4. after-version observable (versionProbe returns the current fingerprint)
 *   5. version fingerprint changed (v2 !== v1; no-op edits do not trigger)
 *
 * Any undecidable condition -> UNKNOWN diagnostics entry -> no action.
 * Pure eviction: the stale read call/result pair leaves the working set;
 * nothing (no v2 content, no marker) is injected.
 *
 * Ground-truth ban: this module never sees expectedWritablePaths,
 * changedPaths, manifests, fixtures or oracle data. Its only inputs are the
 * model-visible message stream, tool result status, and the injected probe.
 */

export type C1LifecycleUnknownReason =
  | 'AFTER_VERSION_UNOBSERVABLE'
  | 'BEFORE_VERSION_UNFORMED'
  | 'VERSION_UNCHANGED'

export interface C1LifecycleUnknown {
  readonly status: 'UNKNOWN' | 'NOT_SUPERSEDED'
  readonly reason: C1LifecycleUnknownReason
  readonly path: string
  readonly readCallId: string
}

export interface C1SupersededVersionPolicyOptions {
  /** Returns sha256 hex of the current content of path, or undefined when the
   * current version cannot be observed. Must be identical across arms and
   * must never be exposed to the model. */
  readonly versionProbe?: (path: string) => string | undefined
  /** Optional diagnostics sink; entries contain no content, only ids/paths. */
  readonly unknownSink?: C1LifecycleUnknown[]
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

type Block = Record<string, unknown>
function blocks(message: PiMessageView): Block[] {
  if (!Array.isArray(message.content)) return []
  return message.content.filter((item): item is Block => typeof item === 'object' && item !== null)
}

function validRelativePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').some((part) => part === '..' || part === '.')
  )
}

export interface ReadPair {
  readonly callId: string
  readonly path: string
  readonly v1Fingerprint: string
  readonly sourceKeys: readonly string[]
  readonly messageIndex: number
}

export interface Mutation {
  readonly path: string
  readonly callId: string
  readonly tool: 'edit' | 'write'
  readonly messageIndex: number
}

/** toolCall/toolResult id occurrence counts used by the pair collectors. */
export function c1PairIdCounts(messages: readonly PiMessageView[]): Map<string, number> {
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
  return idCounts
}

/** Strict, isolated read call/result pair detection (same guards as the
 * duplicate-read candidate): single-toolCall assistant message, clean paired
 * text result, exact {path} arguments, unambiguous ids.
 * Exported so lifecycle replay evidence derives from the identical collector. */
export function collectReadPairs(
  messages: readonly PiMessageView[],
  idCounts: ReadonlyMap<string, number>,
  currentTarget: ReadonlySet<string>
): ReadPair[] {
  const pairs: ReadPair[] = []
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
    if (Object.keys(record).length !== 1 || !validRelativePath(record['path'])) continue
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
    const text = textBlocks.map((block) => block['text'] as string).join('')
    const sourceKeys = [`run/tool-call://${call['id']}`, `run/tool-result://${call['id']}`]
    if (!sourceKeys.every((key) => currentTarget.has(key))) continue
    pairs.push({
      callId: call['id'],
      path: record['path'],
      v1Fingerprint: sha256(text),
      sourceKeys,
      messageIndex: index
    })
  }
  return pairs
}

/** Successful edit/write executions: isolated single-toolCall assistant
 * message with a string path, paired non-error toolResult.
 * Exported so lifecycle replay evidence derives from the identical collector. */
export function collectSuccessfulMutations(
  messages: readonly PiMessageView[],
  idCounts: ReadonlyMap<string, number>
): Mutation[] {
  const mutations: Mutation[] = []
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
      (call['name'] !== 'edit' && call['name'] !== 'write') ||
      typeof call['id'] !== 'string' ||
      result.role !== 'toolResult' ||
      result.toolName !== call['name'] ||
      result.isError !== false ||
      result.toolCallId !== call['id'] ||
      idCounts.get(call['id']) !== 2
    )
      continue
    const args = call['arguments']
    if (typeof args !== 'object' || args === null || Array.isArray(args)) continue
    const path = (args as Record<string, unknown>)['path']
    if (!validRelativePath(path)) continue
    mutations.push({ path, callId: call['id'], tool: call['name'], messageIndex: index })
  }
  return mutations
}

export function applyC1SupersededVersionPolicy(
  observation: C1AgentObservation,
  knownCommittedSourceKeys: ReadonlySet<string> = new Set(),
  options: C1SupersededVersionPolicyOptions = {}
): C1AgentObservation {
  const messages = observation.messages
  const idCounts = c1PairIdCounts(messages)
  const currentTarget = new Set(observation.currentTargetSourceKeys)
  const protectedKeys = new Set([
    ...observation.latestVerificationSourceKeys,
    ...observation.recentEvidenceSourceKeys
  ])
  const readPairs = collectReadPairs(messages, idCounts, currentTarget)
  const mutations = collectSuccessfulMutations(messages, idCounts)
  const excluded = new Map<string, string>()
  for (const pair of readPairs) {
    const mutation = mutations
      .filter((entry) => entry.path === pair.path && entry.messageIndex > pair.messageIndex)
      .sort((a, b) => a.messageIndex - b.messageIndex)[0]
    if (mutation === undefined) continue
    if (
      pair.sourceKeys.some((key) => protectedKeys.has(key) || !knownCommittedSourceKeys.has(key))
    )
      continue
    const probe = options.versionProbe?.(pair.path)
    if (probe === undefined) {
      options.unknownSink?.push({
        status: 'UNKNOWN',
        reason: 'AFTER_VERSION_UNOBSERVABLE',
        path: pair.path,
        readCallId: pair.callId
      })
      continue
    }
    if (probe === pair.v1Fingerprint) {
      options.unknownSink?.push({
        status: 'NOT_SUPERSEDED',
        reason: 'VERSION_UNCHANGED',
        path: pair.path,
        readCallId: pair.callId
      })
      continue
    }
    const evidenceRef = `superseded-version-sha256:${sha256(
      JSON.stringify([pair.path, pair.v1Fingerprint, probe, mutation.callId])
    )}`
    for (const key of pair.sourceKeys) excluded.set(key, evidenceRef)
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

/** Include proven prior removals so superseded exclusion does not oscillate. */
export function c1SupersededVersionCommittedKeys(
  execution: C1LegExecutionResult
): ReadonlySet<string> {
  return new Set([
    ...(execution.workingSet?.items.flatMap((item) => item.sourceKeys) ?? []),
    ...(execution.transition?.orderedDecisions
      .filter((decision) => decision.kind === 'REMOVE')
      .map((decision) => decision.sourceKey) ?? []),
    ...execution.carriedRemovedSourceKeys
  ])
}
