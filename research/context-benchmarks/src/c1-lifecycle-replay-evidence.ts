import { createHash } from 'node:crypto'
import type { C1AgentObservation } from './c1-live-preflight'
import {
  collectReadPairs,
  collectSuccessfulMutations,
  c1PairIdCounts
} from './c1-superseded-version-policy'

/**
 * Fingerprint-only lifecycle replay evidence (lifecycle contract §11 step 3b
 * requirement, introduced after the V4 EVIDENCE_CAPABILITY_GAP adjudication).
 *
 * Records are POLICY INPUT evidence, not policy verdicts: they persist the
 * five trigger-contract inputs as irreversible fingerprints and structural
 * facts, computed at runtime, so a later replay can re-adjudicate
 * SUPERSEDED / NOT_SUPERSEDED / UNKNOWN without ever storing read result
 * text, file contents, or raw mutation arguments.
 */

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

export const C1_LIFECYCLE_REPLAY_RECORD_KIND = 'C1_LIFECYCLE_REPLAY_RECORD' as const

export interface C1LifecycleReplayRecord {
  readonly schemaVersion: 1
  readonly kind: typeof C1_LIFECYCLE_REPLAY_RECORD_KIND
  readonly runId: string
  readonly callOrdinal: number
  readonly readCallId: string
  readonly path: string
  /** ISOLATED_CLEAN = passed every structural guard; GUARDED = a guard fired
   * (mixed content, error, extra args, ambiguous id, unsafe path, ...). */
  readonly pairShape: 'ISOLATED_CLEAN' | 'GUARDED'
  readonly protected: boolean
  readonly committed: boolean
  /** sha256 of the read result text captured at runtime; null when the pair
   * did not pass the clean-text guard (before-version unformed). */
  readonly beforeVersionFingerprint: string | null
  /** First later successful mutation on the same path, if any. */
  readonly mutation: {
    readonly callId: string
    readonly tool: 'edit' | 'write'
    readonly succeeded: true
  } | null
  readonly after: {
    readonly probeStatus: 'OBSERVED' | 'UNOBSERVABLE' | 'NOT_REQUESTED'
    readonly versionFingerprint: string | null
  }
  /** Binds the pair without content: sha256([readCallId, path, beforeVersionFingerprint]). */
  readonly pairFingerprint: string
  readonly sourceKeys: readonly string[]
}

export type C1LifecycleReplayVerdict = 'SUPERSEDED' | 'NOT_SUPERSEDED' | 'UNKNOWN' | 'NOT_CANDIDATE'

export interface C1LifecycleReplayCaptureOptions {
  readonly runId: string
  readonly callOrdinal: number
  readonly knownCommittedSourceKeys: ReadonlySet<string>
  readonly versionProbe?: (path: string) => string | undefined
}

/** Derive fingerprint-only records from the same observation the policy
 * sees, using the policy's own collectors so eligibility cannot drift. The
 * probe is invoked only for pairs that already satisfy conditions 1-3. */
export function captureC1LifecycleReplayEvidence(
  observation: C1AgentObservation,
  options: C1LifecycleReplayCaptureOptions
): C1LifecycleReplayRecord[] {
  const idCounts = c1PairIdCounts(observation.messages)
  const currentTarget = new Set(observation.currentTargetSourceKeys)
  const protectedKeys = new Set([
    ...observation.latestVerificationSourceKeys,
    ...observation.recentEvidenceSourceKeys
  ])
  const cleanPairs = collectReadPairs(observation.messages, idCounts, currentTarget)
  const cleanCallIds = new Set(cleanPairs.map((pair) => pair.callId))
  const mutations = collectSuccessfulMutations(observation.messages, idCounts)

  // Every read tool-call id visible in the stream, including guarded pairs.
  const allReadIds: { callId: string; path: string | null }[] = []
  for (const message of observation.messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>)['type'] === 'toolCall' &&
        (block as Record<string, unknown>)['name'] === 'read' &&
        typeof (block as Record<string, unknown>)['id'] === 'string'
      ) {
        const args = (block as Record<string, unknown>)['arguments']
        const path =
          typeof args === 'object' && args !== null && !Array.isArray(args)
            ? ((args as Record<string, unknown>)['path'] as string | undefined)
            : undefined
        allReadIds.push({
          callId: (block as Record<string, unknown>)['id'] as string,
          path: typeof path === 'string' ? path : null
        })
      }
    }
  }

  const records: C1LifecycleReplayRecord[] = []
  for (const read of allReadIds) {
    const clean = cleanCallIds.has(read.callId)
      ? cleanPairs.find((pair) => pair.callId === read.callId)!
      : undefined
    const path = clean?.path ?? read.path
    if (path === null || path === undefined) continue
    const mutation = clean
      ? mutations
          .filter((entry) => entry.path === clean.path && entry.messageIndex > clean.messageIndex)
          .sort((a, b) => a.messageIndex - b.messageIndex)[0]
      : undefined
    const before = clean?.v1Fingerprint ?? null
    let after: C1LifecycleReplayRecord['after'] = {
      probeStatus: 'NOT_REQUESTED',
      versionFingerprint: null
    }
    if (clean !== undefined && mutation !== undefined) {
      const probe = options.versionProbe?.(clean.path)
      after =
        probe === undefined
          ? { probeStatus: 'UNOBSERVABLE', versionFingerprint: null }
          : { probeStatus: 'OBSERVED', versionFingerprint: probe }
    }
    const sourceKeys = [`run/tool-call://${read.callId}`, `run/tool-result://${read.callId}`]
    records.push({
      schemaVersion: 1,
      kind: C1_LIFECYCLE_REPLAY_RECORD_KIND,
      runId: options.runId,
      callOrdinal: options.callOrdinal,
      readCallId: read.callId,
      path,
      pairShape: clean === undefined ? 'GUARDED' : 'ISOLATED_CLEAN',
      protected: sourceKeys.some((key) => protectedKeys.has(key)),
      committed: sourceKeys.every((key) => options.knownCommittedSourceKeys.has(key)),
      beforeVersionFingerprint: before,
      mutation:
        mutation === undefined
          ? null
          : { callId: mutation.callId, tool: mutation.tool, succeeded: true },
      after,
      pairFingerprint: sha256(JSON.stringify([read.callId, path, before])),
      sourceKeys
    })
  }
  return records
}

/** Re-adjudicate a record against the five-condition trigger contract. This
 * recomputes the verdict from stored inputs; it never reads a stored verdict
 * (none exists). Mirrors the live policy exactly. */
export function adjudicateC1LifecycleReplayRecord(
  record: C1LifecycleReplayRecord
): C1LifecycleReplayVerdict {
  if (record.pairShape !== 'ISOLATED_CLEAN' || record.protected || !record.committed)
    return 'NOT_CANDIDATE'
  if (record.mutation === null) return 'NOT_CANDIDATE'
  if (record.beforeVersionFingerprint === null) return 'UNKNOWN'
  if (record.after.probeStatus !== 'OBSERVED' || record.after.versionFingerprint === null)
    return 'UNKNOWN'
  if (record.after.versionFingerprint === record.beforeVersionFingerprint) return 'NOT_SUPERSEDED'
  return 'SUPERSEDED'
}

/** Per-call reconciliation between replay verdicts and the removals the live
 * policy actually performed (decision evidence). CONTRACT_CONFLICT is the
 * only failure mode; UNKNOWN is the contract's conservative correctness. */
export function reconcileC1LifecycleReplayCall(input: {
  readonly records: readonly C1LifecycleReplayRecord[]
  readonly removedSourceKeys: readonly string[]
}): {
  readonly verdict: 'MATCH' | 'CONTRACT_CONFLICT'
  readonly supersededCallIds: readonly string[]
  readonly conflicts: readonly string[]
} {
  const removed = new Set(input.removedSourceKeys)
  const superseded = input.records.filter(
    (record) => adjudicateC1LifecycleReplayRecord(record) === 'SUPERSEDED'
  )
  const conflicts: string[] = []
  for (const record of superseded) {
    if (!record.sourceKeys.every((key) => removed.has(key))) {
      conflicts.push(`replay SUPERSEDED but live kept: ${record.readCallId}`)
    }
  }
  const supersededKeys = new Set(superseded.flatMap((record) => record.sourceKeys))
  for (const key of removed) {
    if (!supersededKeys.has(key)) conflicts.push(`live removed without replay SUPERSEDED: ${key}`)
  }
  return {
    verdict: conflicts.length === 0 ? 'MATCH' : 'CONTRACT_CONFLICT',
    supersededCallIds: superseded.map((record) => record.readCallId),
    conflicts
  }
}
