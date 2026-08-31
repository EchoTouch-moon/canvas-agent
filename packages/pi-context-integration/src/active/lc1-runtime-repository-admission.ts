import {
  sha256Hex,
  type ContextSourceDescriptor,
  type ContextUniverseRevision,
  type SnapshotLikeSeed,
  type SourceObservation
} from '@canvas-agent/context-runtime'
import {
  REPOSITORY_SOURCE_KIND,
  REPOSITORY_SOURCE_PROVENANCE,
  REPOSITORY_UNAVAILABLE_REASONS,
  repositorySourceKey,
  type RepositoryObservationRequest
} from '@canvas-agent/repository-observer'
import {
  EnrichedPiShadowObserver,
  type EnrichedObserverSnapshot,
  type EnrichedShadowResult,
  type ExternalObservation
} from '../extension/enriched-shadow-extension'
import {
  PiContextShadowObserver,
  type PiShadowObserverOptions
} from '../extension/shadow-extension'
import type { PiMessageView } from '../pi-message-mapper'

export type Lc1RuntimeRepositoryRevision = RepositoryObservationRequest['expectedRevision']

// Package-internal capability marker. It is intentionally not re-exported from
// the experimental package surface; only the authority-verifying mapper may
// construct a first-party admission candidate.
export const LC1_MAPPER_AUTHORITY_BRAND: unique symbol = Symbol('lc1-mapper-authority')
const mapperAuthorityCandidates = new WeakSet<object>()
const claimedRuntimeSessionIds = new Set<string>()

export interface Lc1RuntimeAuthorityOrder {
  readonly streamId: string
  readonly sequence: number
}

export interface Lc1RuntimeRepositoryScope {
  readonly repositoryId: string
  readonly namespace: string
}

export interface Lc1RuntimeRepositoryAdmissionCandidate {
  readonly [LC1_MAPPER_AUTHORITY_BRAND]: true
  readonly runtimeSessionId: string
  readonly repositoryId: string
  readonly namespace: string
  readonly sourceKey: string
  readonly canonicalPath: string
  readonly callIds: readonly string[]
  readonly namespacedCallIds: readonly string[]
  readonly observation: SourceObservation
  readonly descriptor: ContextSourceDescriptor
  readonly authorityRevision: Lc1RuntimeRepositoryRevision
  readonly authorityOrder: Lc1RuntimeAuthorityOrder
  readonly representationKind: 'FULL'
}

export type Lc1RuntimeRepositoryAdmissionCandidateInput = Omit<
  Lc1RuntimeRepositoryAdmissionCandidate,
  typeof LC1_MAPPER_AUTHORITY_BRAND
>

export const LC1_RUNTIME_ADMISSION_REJECTION_REASONS = [
  'INVALID_REQUEST',
  'CALL_ID_REMAP',
  'STALE_AUTHORITY',
  'IDEMPOTENT_DUPLICATE',
  'BATCH_REJECTED',
  'KILL_SWITCH_TRIPPED'
] as const
export type Lc1RuntimeAdmissionRejectionReason =
  (typeof LC1_RUNTIME_ADMISSION_REJECTION_REASONS)[number]

export const LC1_RUNTIME_ADMISSION_QUARANTINE_REASONS = [
  'QUEUE_REJECTED',
  'INCOMPARABLE_AUTHORITY',
  'CONFLICTING_AUTHORITY',
  'DESCRIPTOR_DRIFT',
  'CROSS_SCOPE_COLLISION'
] as const
export type Lc1RuntimeAdmissionQuarantineReason =
  (typeof LC1_RUNTIME_ADMISSION_QUARANTINE_REASONS)[number]

export interface Lc1RuntimeRepositoryAdmissionIssue {
  readonly callIds: readonly string[]
  readonly sourceKey?: string
  readonly reason: Lc1RuntimeAdmissionRejectionReason | Lc1RuntimeAdmissionQuarantineReason
  readonly detail?: string
}

export interface Lc1RuntimeRepositoryAdmissionResult {
  readonly accepted: readonly Lc1RuntimeRepositoryAdmissionCandidate[]
  readonly rejected: readonly Lc1RuntimeRepositoryAdmissionIssue[]
  readonly quarantined: readonly Lc1RuntimeRepositoryAdmissionIssue[]
}

export interface Lc1RuntimeRepositoryAdmissionSink {
  readonly lc1RepositoryAdmissionMode: 'RUNTIME_OWNED'
  admitLc1RepositoryObservations(
    candidates: readonly Lc1RuntimeRepositoryAdmissionCandidate[]
  ): Lc1RuntimeRepositoryAdmissionResult
}

interface AcceptedState {
  readonly authorityOrder: Lc1RuntimeAuthorityOrder
  readonly envelopeFingerprint: string
  readonly descriptorFingerprint: string
}

interface CallBinding {
  readonly repositoryId: string
  readonly namespace: string
  readonly canonicalPath: string
  readonly sourceKey: string
}

export interface Lc1RuntimeRepositoryAdmissionSnapshot {
  readonly runtimeSessionId: string
  readonly boundScope: Lc1RuntimeRepositoryScope | null
  readonly acceptedBySource: readonly {
    readonly sourceKey: string
    readonly state: AcceptedState
  }[]
  readonly callBindings: readonly {
    readonly callId: string
    readonly binding: CallBinding
  }[]
  readonly integrityHash: string
}

export interface Lc1RuntimeRepositoryAdmissionHostSnapshot {
  /** Opaque in-memory owner token. Host snapshots are rollback-only, not portable. */
  readonly transactionOwner: object
  readonly enriched: EnrichedObserverSnapshot
  readonly admission: Lc1RuntimeRepositoryAdmissionSnapshot
  readonly integrityHash: string
}

export interface Lc1RuntimeRepositoryAdmissionHostOptions {
  readonly observer?: PiShadowObserverOptions
  readonly seeds?: readonly SnapshotLikeSeed[]
}

function assertNoRepositorySeeds(seeds: readonly SnapshotLikeSeed[] | undefined): void {
  for (const seed of seeds ?? []) {
    if (
      seed.sourceKey.startsWith('repository/file://') ||
      seed.sourceKind === REPOSITORY_SOURCE_KIND ||
      seed.provenance === REPOSITORY_SOURCE_PROVENANCE
    ) {
      throw new Error('lc1_repository_seed_bypasses_runtime_admission')
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isGitObjectHash(value: unknown): value is string {
  return typeof value === 'string' && /^([a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)
}

function isContentHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function isRepositoryRevision(value: unknown): value is Lc1RuntimeRepositoryRevision {
  if (typeof value !== 'object' || value === null) return false
  const revision = value as Record<string, unknown>
  return (
    isGitObjectHash(revision['baseCommit']) &&
    isGitObjectHash(revision['treeHash']) &&
    (revision['workingTreePatchHash'] === null || isContentHash(revision['workingTreePatchHash']))
  )
}

function sameScope(left: Lc1RuntimeRepositoryScope, right: Lc1RuntimeRepositoryScope): boolean {
  return left.repositoryId === right.repositoryId && left.namespace === right.namespace
}

function sameBinding(left: CallBinding, right: CallBinding): boolean {
  return (
    left.repositoryId === right.repositoryId &&
    left.namespace === right.namespace &&
    left.canonicalPath === right.canonicalPath &&
    left.sourceKey === right.sourceKey
  )
}

function descriptorFingerprint(descriptor: ContextSourceDescriptor): string {
  return JSON.stringify({
    sourceKey: descriptor.sourceKey,
    sourceKind: descriptor.sourceKind,
    provenance: descriptor.provenance,
    authority: descriptor.authority ?? null,
    priority: descriptor.priority ?? null
  })
}

function observationFingerprint(observation: SourceObservation): string {
  if (observation.status === 'AVAILABLE') {
    return JSON.stringify([
      observation.sourceKey,
      observation.status,
      observation.observedAt,
      observation.contentHash
    ])
  }
  if (observation.status === 'UNAVAILABLE') {
    return JSON.stringify([
      observation.sourceKey,
      observation.status,
      observation.observedAt,
      observation.reasonCode
    ])
  }
  return JSON.stringify([observation.sourceKey, observation.status, observation.observedAt])
}

function revisionFingerprint(revision: Lc1RuntimeRepositoryRevision): string {
  return JSON.stringify([revision.baseCommit, revision.treeHash, revision.workingTreePatchHash])
}

function envelopeFingerprint(candidate: Lc1RuntimeRepositoryAdmissionCandidate): string {
  return JSON.stringify({
    runtimeSessionId: candidate.runtimeSessionId,
    repositoryId: candidate.repositoryId,
    namespace: candidate.namespace,
    sourceKey: candidate.sourceKey,
    canonicalPath: candidate.canonicalPath,
    callIds: candidate.callIds,
    namespacedCallIds: candidate.namespacedCallIds,
    observation: observationFingerprint(candidate.observation),
    descriptor: descriptorFingerprint(candidate.descriptor),
    authorityRevision: revisionFingerprint(candidate.authorityRevision),
    authorityOrder: [candidate.authorityOrder.streamId, candidate.authorityOrder.sequence],
    representationKind: candidate.representationKind
  })
}

function authorityScopeId(scope: Lc1RuntimeRepositoryScope): string {
  return `repository-scope:v1:${sha256Hex(JSON.stringify([scope.repositoryId, scope.namespace]))}`
}

function validRepositoryObservation(observation: SourceObservation): boolean {
  if (!isNonEmptyString(observation.observedAt)) return false
  if (observation.status === 'AVAILABLE') return isContentHash(observation.contentHash)
  if (observation.status === 'UNAVAILABLE') {
    return REPOSITORY_UNAVAILABLE_REASONS.some((reason) => reason === observation.reasonCode)
  }
  return observation.status === 'ABSENT'
}

function validCandidate(
  value: unknown,
  runtimeSessionId: string
): value is Lc1RuntimeRepositoryAdmissionCandidate {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Lc1RuntimeRepositoryAdmissionCandidate
  if (
    typeof candidate.observation !== 'object' ||
    candidate.observation === null ||
    typeof candidate.descriptor !== 'object' ||
    candidate.descriptor === null ||
    typeof candidate.authorityOrder !== 'object' ||
    candidate.authorityOrder === null ||
    !Array.isArray(candidate.callIds) ||
    !Array.isArray(candidate.namespacedCallIds)
  ) {
    return false
  }
  const scope = {
    repositoryId: candidate.repositoryId,
    namespace: candidate.namespace
  }
  return (
    mapperAuthorityCandidates.has(candidate) &&
    candidate[LC1_MAPPER_AUTHORITY_BRAND] === true &&
    candidate.runtimeSessionId === runtimeSessionId &&
    isNonEmptyString(candidate.repositoryId) &&
    isNonEmptyString(candidate.namespace) &&
    isNonEmptyString(candidate.canonicalPath) &&
    candidate.sourceKey === repositorySourceKey(candidate.canonicalPath) &&
    candidate.observation.sourceKey === candidate.sourceKey &&
    candidate.descriptor.sourceKey === candidate.sourceKey &&
    candidate.descriptor.sourceKind === REPOSITORY_SOURCE_KIND &&
    candidate.descriptor.provenance === REPOSITORY_SOURCE_PROVENANCE &&
    candidate.descriptor.authority === authorityScopeId(scope) &&
    isRepositoryRevision(candidate.authorityRevision) &&
    validRepositoryObservation(candidate.observation) &&
    candidate.callIds.length > 0 &&
    candidate.callIds.length === candidate.namespacedCallIds.length &&
    new Set(candidate.callIds).size === candidate.callIds.length &&
    new Set(candidate.namespacedCallIds).size === candidate.namespacedCallIds.length &&
    candidate.callIds.every(
      (callId, index) =>
        isNonEmptyString(callId) &&
        candidate.namespacedCallIds[index] === `pi-evidence:v1:${runtimeSessionId}:${callId}`
    ) &&
    isNonEmptyString(candidate.authorityOrder.streamId) &&
    Number.isInteger(candidate.authorityOrder.sequence) &&
    candidate.authorityOrder.sequence >= 0 &&
    candidate.representationKind === 'FULL'
  )
}

function issueIdentity(value: unknown): {
  readonly callIds: readonly string[]
  readonly sourceKey?: string
} {
  if (typeof value !== 'object' || value === null) return { callIds: [] }
  const candidate = value as {
    readonly callIds?: unknown
    readonly sourceKey?: unknown
  }
  const callIds = Array.isArray(candidate.callIds)
    ? candidate.callIds.filter((callId): callId is string => typeof callId === 'string')
    : []
  return {
    callIds,
    ...(typeof candidate.sourceKey === 'string' ? { sourceKey: candidate.sourceKey } : {})
  }
}

function toExternalObservation(
  candidate: Lc1RuntimeRepositoryAdmissionCandidate
): ExternalObservation {
  return {
    observation: candidate.observation,
    descriptor: candidate.descriptor
  }
}

function immutableCandidate(
  candidate: Lc1RuntimeRepositoryAdmissionCandidate
): Lc1RuntimeRepositoryAdmissionCandidate {
  const observation: SourceObservation = Object.freeze({
    ...candidate.observation
  })
  const descriptor: ContextSourceDescriptor = Object.freeze({
    ...candidate.descriptor
  })
  const authorityRevision: Lc1RuntimeRepositoryRevision = Object.freeze({
    ...candidate.authorityRevision
  })
  const authorityOrder: Lc1RuntimeAuthorityOrder = Object.freeze({
    ...candidate.authorityOrder
  })
  return Object.freeze({
    ...candidate,
    callIds: Object.freeze([...candidate.callIds]),
    namespacedCallIds: Object.freeze([...candidate.namespacedCallIds]),
    observation,
    descriptor,
    authorityRevision,
    authorityOrder
  })
}

/** Package-internal mapper capability; intentionally absent from the package surface. */
export function createLc1MapperAuthorityCandidate(
  input: Lc1RuntimeRepositoryAdmissionCandidateInput
): Lc1RuntimeRepositoryAdmissionCandidate {
  const candidate = immutableCandidate({
    ...input,
    [LC1_MAPPER_AUTHORITY_BRAND]: true
  })
  mapperAuthorityCandidates.add(candidate)
  return candidate
}

function hostSnapshotIntegrity(
  enriched: EnrichedObserverSnapshot,
  admission: Lc1RuntimeRepositoryAdmissionSnapshot
): string {
  const pendingExternalObservations = [...enriched.pendingExternalObservations]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceKey, value]) => ({ sourceKey, value }))
  return sha256Hex(
    JSON.stringify({
      enriched: {
        base: enriched.base,
        universe: enriched.universe,
        callResultCount: enriched.callResultCount,
        pendingExternalObservations
      },
      admission
    })
  )
}

class Lc1RuntimeRepositoryAdmissionCoordinator {
  private readonly runtimeSessionId: string
  private readonly queueAccepted: (observations: readonly ExternalObservation[]) => void
  private boundScope: Lc1RuntimeRepositoryScope | null = null
  private readonly acceptedBySource = new Map<string, AcceptedState>()
  private readonly callBindings = new Map<string, CallBinding>()

  constructor(options: {
    readonly runtimeSessionId: string
    readonly queueAccepted: (observations: readonly ExternalObservation[]) => void
  }) {
    this.runtimeSessionId = options.runtimeSessionId
    this.queueAccepted = options.queueAccepted
  }

  snapshotForTransaction(): Lc1RuntimeRepositoryAdmissionSnapshot {
    const payload = {
      runtimeSessionId: this.runtimeSessionId,
      boundScope: this.boundScope === null ? null : { ...this.boundScope },
      acceptedBySource: [...this.acceptedBySource]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sourceKey, state]) => ({
          sourceKey,
          state: {
            authorityOrder: { ...state.authorityOrder },
            envelopeFingerprint: state.envelopeFingerprint,
            descriptorFingerprint: state.descriptorFingerprint
          }
        })),
      callBindings: [...this.callBindings]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([callId, binding]) => ({ callId, binding: { ...binding } }))
    }
    return { ...payload, integrityHash: sha256Hex(JSON.stringify(payload)) }
  }

  validateTransactionSnapshot(snapshot: Lc1RuntimeRepositoryAdmissionSnapshot): void {
    if (typeof snapshot !== 'object' || snapshot === null) {
      throw new Error('lc1_admission_snapshot_integrity_mismatch')
    }
    if (snapshot.runtimeSessionId !== this.runtimeSessionId) {
      throw new Error('lc1_admission_snapshot_runtime_session_mismatch')
    }
    const { integrityHash, ...payload } = snapshot
    if (sha256Hex(JSON.stringify(payload)) !== integrityHash) {
      throw new Error('lc1_admission_snapshot_integrity_mismatch')
    }
  }

  restoreTransaction(snapshot: Lc1RuntimeRepositoryAdmissionSnapshot): void {
    this.validateTransactionSnapshot(snapshot)
    this.boundScope = snapshot.boundScope === null ? null : { ...snapshot.boundScope }
    this.acceptedBySource.clear()
    for (const item of snapshot.acceptedBySource) {
      this.acceptedBySource.set(item.sourceKey, {
        authorityOrder: { ...item.state.authorityOrder },
        envelopeFingerprint: item.state.envelopeFingerprint,
        descriptorFingerprint: item.state.descriptorFingerprint
      })
    }
    this.callBindings.clear()
    for (const item of snapshot.callBindings) {
      this.callBindings.set(item.callId, { ...item.binding })
    }
  }

  admit(
    candidates: readonly Lc1RuntimeRepositoryAdmissionCandidate[]
  ): Lc1RuntimeRepositoryAdmissionResult {
    const rejected: Lc1RuntimeRepositoryAdmissionIssue[] = []
    const quarantined: Lc1RuntimeRepositoryAdmissionIssue[] = []
    if (!Array.isArray(candidates)) {
      return {
        accepted: [],
        rejected: [
          {
            callIds: [],
            reason: 'INVALID_REQUEST',
            detail: 'candidate batch is not an array'
          }
        ],
        quarantined
      }
    }
    const staged: Lc1RuntimeRepositoryAdmissionCandidate[] = []
    const stagedStates = new Map<string, AcceptedState>()
    const stagedBindings = new Map<string, CallBinding>()
    const seenSourceKeys = new Set<string>()
    let stagedScope = this.boundScope

    for (const candidate of candidates) {
      if (!validCandidate(candidate, this.runtimeSessionId)) {
        const identity = issueIdentity(candidate)
        rejected.push({
          callIds: identity.callIds,
          ...(identity.sourceKey === undefined ? {} : { sourceKey: identity.sourceKey }),
          reason: 'INVALID_REQUEST'
        })
        continue
      }
      if (seenSourceKeys.has(candidate.sourceKey)) {
        rejected.push({
          callIds: [...candidate.callIds],
          sourceKey: candidate.sourceKey,
          reason: 'INVALID_REQUEST',
          detail: 'duplicate source in admission batch'
        })
        continue
      }
      seenSourceKeys.add(candidate.sourceKey)

      const immutable = immutableCandidate(candidate)

      const scope = {
        repositoryId: immutable.repositoryId,
        namespace: immutable.namespace
      }
      if (stagedScope !== null && !sameScope(stagedScope, scope)) {
        quarantined.push({
          callIds: [...immutable.callIds],
          sourceKey: immutable.sourceKey,
          reason: 'CROSS_SCOPE_COLLISION'
        })
        continue
      }
      stagedScope ??= scope

      const binding: CallBinding = {
        repositoryId: immutable.repositoryId,
        namespace: immutable.namespace,
        canonicalPath: immutable.canonicalPath,
        sourceKey: immutable.sourceKey
      }
      const remappedCallIds = immutable.callIds.filter((callId) => {
        const previous = this.callBindings.get(callId) ?? stagedBindings.get(callId)
        return previous !== undefined && !sameBinding(previous, binding)
      })
      if (remappedCallIds.length > 0) {
        rejected.push({
          callIds: remappedCallIds,
          sourceKey: immutable.sourceKey,
          reason: 'CALL_ID_REMAP'
        })
        continue
      }

      const nextState: AcceptedState = {
        authorityOrder: immutable.authorityOrder,
        envelopeFingerprint: envelopeFingerprint(immutable),
        descriptorFingerprint: descriptorFingerprint(immutable.descriptor)
      }
      const previous = this.acceptedBySource.get(immutable.sourceKey)
      if (previous !== undefined) {
        if (previous.descriptorFingerprint !== nextState.descriptorFingerprint) {
          quarantined.push({
            callIds: [...immutable.callIds],
            sourceKey: immutable.sourceKey,
            reason: 'DESCRIPTOR_DRIFT'
          })
          continue
        }
        if (previous.authorityOrder.streamId !== immutable.authorityOrder.streamId) {
          quarantined.push({
            callIds: [...immutable.callIds],
            sourceKey: immutable.sourceKey,
            reason: 'INCOMPARABLE_AUTHORITY'
          })
          continue
        }
        if (immutable.authorityOrder.sequence < previous.authorityOrder.sequence) {
          rejected.push({
            callIds: [...immutable.callIds],
            sourceKey: immutable.sourceKey,
            reason: 'STALE_AUTHORITY'
          })
          continue
        }
        if (immutable.authorityOrder.sequence === previous.authorityOrder.sequence) {
          if (previous.envelopeFingerprint === nextState.envelopeFingerprint) {
            rejected.push({
              callIds: [...immutable.callIds],
              sourceKey: immutable.sourceKey,
              reason: 'IDEMPOTENT_DUPLICATE'
            })
          } else {
            quarantined.push({
              callIds: [...immutable.callIds],
              sourceKey: immutable.sourceKey,
              reason: 'CONFLICTING_AUTHORITY'
            })
          }
          continue
        }
      }

      staged.push(immutable)
      stagedStates.set(immutable.sourceKey, nextState)
      for (const callId of immutable.callIds) stagedBindings.set(callId, binding)
    }

    if (rejected.length > 0 || quarantined.length > 0) {
      const decidedCallIds = new Set(
        [...rejected, ...quarantined].flatMap((issue) => issue.callIds)
      )
      for (const candidate of staged) {
        const undecided = candidate.callIds.filter((callId) => !decidedCallIds.has(callId))
        if (undecided.length > 0) {
          rejected.push({
            callIds: undecided,
            sourceKey: candidate.sourceKey,
            reason: 'BATCH_REJECTED'
          })
        }
      }
      return { accepted: [], rejected, quarantined }
    }

    if (staged.length === 0) return { accepted: [], rejected, quarantined }

    try {
      this.queueAccepted(staged.map(toExternalObservation))
    } catch {
      return {
        accepted: [],
        rejected,
        quarantined: staged.map((candidate) => ({
          callIds: [...candidate.callIds],
          sourceKey: candidate.sourceKey,
          reason: 'QUEUE_REJECTED' as const
        }))
      }
    }

    this.boundScope = stagedScope
    for (const [sourceKey, state] of stagedStates) this.acceptedBySource.set(sourceKey, state)
    for (const [callId, binding] of stagedBindings) this.callBindings.set(callId, binding)
    return { accepted: staged, rejected, quarantined }
  }
}

/**
 * Experimental LC1 runtime composition. The raw external-observation queue is
 * private to this host, so repository authority can only enter through the
 * runtime-owned coordinator.
 */
export class Lc1RuntimeRepositoryAdmissionHost implements Lc1RuntimeRepositoryAdmissionSink {
  readonly lc1RepositoryAdmissionMode = 'RUNTIME_OWNED' as const
  readonly #enriched: EnrichedPiShadowObserver
  readonly #coordinator: Lc1RuntimeRepositoryAdmissionCoordinator
  readonly #transactionOwner = Object.freeze({})

  constructor(options: Lc1RuntimeRepositoryAdmissionHostOptions = {}) {
    assertNoRepositorySeeds(options.seeds)
    this.#enriched = new EnrichedPiShadowObserver({
      base: new PiContextShadowObserver(options.observer),
      ...(options.seeds === undefined ? {} : { seeds: options.seeds })
    })
    if (claimedRuntimeSessionIds.has(this.#enriched.runtimeSessionId)) {
      throw new Error('lc1_runtime_session_already_claimed')
    }
    claimedRuntimeSessionIds.add(this.#enriched.runtimeSessionId)
    this.#coordinator = new Lc1RuntimeRepositoryAdmissionCoordinator({
      runtimeSessionId: this.#enriched.runtimeSessionId,
      queueAccepted: (observations) => this.#enriched.queueExternalObservations(observations)
    })
  }

  get runtimeSessionId(): string {
    return this.#enriched.runtimeSessionId
  }

  get universeRevision(): ContextUniverseRevision | null {
    return this.#enriched.universeRevision
  }

  get callCount(): number {
    return this.#enriched.callCount
  }

  get callResults(): readonly EnrichedShadowResult[] {
    return this.#enriched.callResults
  }

  observeModelCall(messages: readonly PiMessageView[]): EnrichedShadowResult {
    return this.#enriched.observeModelCall(messages)
  }

  admitLc1RepositoryObservations(
    candidates: readonly Lc1RuntimeRepositoryAdmissionCandidate[]
  ): Lc1RuntimeRepositoryAdmissionResult {
    return this.#coordinator.admit(candidates)
  }

  snapshotForTransaction(): Lc1RuntimeRepositoryAdmissionHostSnapshot {
    const enriched = this.#enriched.snapshotForTransaction()
    const admission = this.#coordinator.snapshotForTransaction()
    return Object.freeze({
      transactionOwner: this.#transactionOwner,
      enriched,
      admission,
      integrityHash: hostSnapshotIntegrity(enriched, admission)
    })
  }

  restoreTransaction(snapshot: Lc1RuntimeRepositoryAdmissionHostSnapshot): void {
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      snapshot.transactionOwner !== this.#transactionOwner
    ) {
      throw new Error('lc1_admission_snapshot_host_mismatch')
    }
    this.#coordinator.validateTransactionSnapshot(snapshot.admission)
    let integrityHash: string
    try {
      integrityHash = hostSnapshotIntegrity(snapshot.enriched, snapshot.admission)
    } catch {
      throw new Error('lc1_admission_host_snapshot_integrity_mismatch')
    }
    if (integrityHash !== snapshot.integrityHash) {
      throw new Error('lc1_admission_host_snapshot_integrity_mismatch')
    }
    this.#coordinator.restoreTransaction(snapshot.admission)
    this.#enriched.restoreTransaction(snapshot.enriched)
  }
}
