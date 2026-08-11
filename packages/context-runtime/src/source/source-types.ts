import { sha256Hex } from '../util/hash'

// EXPERIMENTAL / NOT PUBLIC CONTRACT / NOT PERSISTED SCHEMA.
// These types model PROPOSAL-030 semantics in-memory only, for CR-002 research.

export const SOURCE_OBSERVATION_STATUSES = ['AVAILABLE', 'ABSENT', 'UNAVAILABLE'] as const
export type SourceObservationStatus = (typeof SOURCE_OBSERVATION_STATUSES)[number]

// Provisional stable semantic identity of a source. The sourceKey is separate
// from any content hash: a mutable repository file keeps one sourceKey while
// its content versions advance.
export interface ExperimentalContextSource {
  readonly sourceKey: string
  readonly sourceKind: string
  readonly provenance: string
}

// Immutable observed value of a source. Version identity is deterministic:
// same sourceKey + same contentHash => same versionId; changed content => new
// versionId; same content under a different sourceKey => different versionId.
export interface ContextSourceVersion {
  readonly versionId: string
  readonly sourceKey: string
  readonly contentHash: string
  readonly observedAt: string
}

export function createSourceVersionId(sourceKey: string, contentHash: string): string {
  return sha256Hex(`version-v1|${sourceKey}|${contentHash}`)
}

export function createContextSourceVersion(
  sourceKey: string,
  contentHash: string,
  observedAt: string
): ContextSourceVersion {
  return {
    versionId: createSourceVersionId(sourceKey, contentHash),
    sourceKey,
    contentHash,
    observedAt
  }
}

// A source observation reports what an observer actually established. ABSENT is
// a confirmed absence (observer succeeded and the source no longer exists).
// UNAVAILABLE is a failed attempt (state cannot be established). A source
// merely missing from AgentMessage[] is neither.
//
// Discriminated union so malformed states are unrepresentable:
//   AVAILABLE   => contentHash required
//   ABSENT      => no contentHash
//   UNAVAILABLE => reasonCode required
export type SourceObservation =
  | {
      readonly sourceKey: string
      readonly status: 'AVAILABLE'
      readonly observedAt: string
      readonly contentHash: string
    }
  | {
      readonly sourceKey: string
      readonly status: 'ABSENT'
      readonly observedAt: string
    }
  | {
      readonly sourceKey: string
      readonly status: 'UNAVAILABLE'
      readonly observedAt: string
      readonly reasonCode: string
    }

export function createAvailableObservation(
  sourceKey: string,
  contentHash: string,
  observedAt: string
): SourceObservation {
  return { sourceKey, status: 'AVAILABLE', observedAt, contentHash }
}

export function createAbsentObservation(sourceKey: string, observedAt: string): SourceObservation {
  return { sourceKey, status: 'ABSENT', observedAt }
}

export function createUnavailableObservation(
  sourceKey: string,
  reasonCode: string,
  observedAt: string
): SourceObservation {
  return { sourceKey, status: 'UNAVAILABLE', observedAt, reasonCode }
}

// Reconciled head state for one source within a runtime session.
export interface ContextSourceState {
  readonly sourceKey: string
  readonly observationStatus: SourceObservationStatus
  readonly admittedVersionId: string | null
  readonly lastAvailableVersionId: string | null
  readonly reconciliationSequence: number
  readonly lastObservedAt: string
}

export const SOURCE_RECONCILIATION_ACTIONS = [
  'INITIALIZE',
  'NO_CHANGE',
  'UPDATE',
  'REMOVE',
  'RETAIN_LAST_KNOWN'
] as const
export type SourceReconciliationAction = (typeof SOURCE_RECONCILIATION_ACTIONS)[number]

export interface SourceReconciliationEvent {
  readonly sourceKey: string
  readonly previousState: ContextSourceState | null
  readonly observation: SourceObservation
  readonly action: SourceReconciliationAction
  readonly previousVersionId: string | null
  readonly nextVersionId: string | null
  readonly sequence: number
  readonly timestamp: string
}
