import {
  sha256Hex,
  type ContextSourceDescriptor,
  type SourceObservation
} from '@canvas-agent/context-runtime'
import {
  REPOSITORY_SOURCE_KIND,
  REPOSITORY_SOURCE_PROVENANCE,
  repositorySourceKey,
  RepositoryObserver,
  type RepositoryFileObservation
} from '@canvas-agent/repository-observer'
import { decomposePiMessage } from '../element-decomposition'
import type { PiMessageView } from '../pi-message-mapper'
import {
  createLc1MapperAuthorityCandidate,
  type Lc1RuntimeAuthorityOrder,
  type Lc1RuntimeRepositoryAdmissionCandidate,
  type Lc1RuntimeRepositoryAdmissionSink,
  type Lc1RuntimeRepositoryRevision,
  type Lc1RuntimeRepositoryScope
} from './lc1-runtime-repository-admission'

// CR-004 LC1 production-boundary candidate. This module is deliberately
// exported only from the experimental package surface. It binds Pi read-event
// identity to an authoritative RepositoryObserver result, then applies
// per-session authority ordering before using the existing provider-neutral
// external-observation queue. It never rewrites Pi messages or calls a model.

export type Lc1RepositoryRevision = Lc1RuntimeRepositoryRevision

export type Lc1AuthorityOrder = Lc1RuntimeAuthorityOrder

export interface Lc1RepositoryMappingRequest {
  readonly messages: readonly PiMessageView[]
  readonly runtimeSessionId: string
  readonly modelCallSequence: number
  readonly repositoryId: string
  readonly namespace: string
  readonly expectedRevision: Lc1RepositoryRevision
  readonly authorityOrder: Lc1AuthorityOrder
  readonly observedAt: string
}

export type Lc1RepositoryScope = Lc1RuntimeRepositoryScope

export interface Lc1RepositoryPathResolver {
  /** Resolves a caller-bound repository identity; the request supplies no raw path. */
  resolve(scope: Lc1RepositoryScope): string | undefined
}

export interface Lc1ExternalObservation {
  readonly observation: SourceObservation
  readonly descriptor: ContextSourceDescriptor
}

export interface Lc1ExternalObservationSink {
  queueExternalObservations(observations: readonly Lc1ExternalObservation[]): void
}

export type Lc1ProductionMappingSink =
  Lc1ExternalObservationSink | Lc1RuntimeRepositoryAdmissionSink

export const LC1_MAPPING_REJECTION_REASONS = [
  'INVALID_REQUEST',
  'MISSING_CALL_ID',
  'DUPLICATE_CALL_RESULT',
  'CALL_ID_REMAP',
  'UNMATCHED_CALL_ID',
  'MISSING_PATH_HINT',
  'INVALID_PATH_HINT',
  'UNSUPPORTED_TOOL',
  'CALL_TOOL_NAME_MISMATCH',
  'STALE_AUTHORITY',
  'IDEMPOTENT_DUPLICATE',
  'BATCH_REJECTED'
] as const
export type Lc1MappingRejectionReason = (typeof LC1_MAPPING_REJECTION_REASONS)[number]

export const LC1_MAPPING_QUARANTINE_REASONS = [
  'REPOSITORY_SCOPE_UNBOUND',
  'AUTHORITY_OBSERVATION_FAILED',
  'UNVERIFIED_AUTHORITY',
  'AUTHORITY_KEY_MISMATCH',
  'QUEUE_REJECTED',
  'INCOMPARABLE_AUTHORITY',
  'CONFLICTING_AUTHORITY',
  'DESCRIPTOR_DRIFT',
  'CROSS_SCOPE_COLLISION'
] as const
export type Lc1MappingQuarantineReason = (typeof LC1_MAPPING_QUARANTINE_REASONS)[number]

export interface Lc1MappingIssue {
  readonly callIds: readonly string[]
  readonly sourceKey?: string
  readonly reason: Lc1MappingRejectionReason | Lc1MappingQuarantineReason
  readonly detail?: string
}

export interface Lc1AcceptedRepositoryObservation extends Lc1RuntimeRepositoryAdmissionCandidate {}

export interface Lc1ProductionMappingResult {
  readonly accepted: readonly Lc1AcceptedRepositoryObservation[]
  readonly rejected: readonly Lc1MappingIssue[]
  readonly quarantined: readonly Lc1MappingIssue[]
  readonly authoritativeObservations: readonly RepositoryFileObservation[]
}

export interface Lc1ProductionMappingSnapshot {
  readonly acceptedBySource: readonly {
    readonly key: string
    readonly authorityOrder: Lc1AuthorityOrder
    readonly envelopeFingerprint: string
    readonly descriptorFingerprint: string
  }[]
  readonly callBindings: readonly {
    readonly key: string
    readonly binding: {
      readonly repositoryId: string
      readonly namespace: string
      readonly canonicalPath: string
      readonly sourceKey: string
    }
  }[]
  readonly sourceScopes: readonly {
    readonly key: string
    readonly scope: Lc1RepositoryScope
  }[]
}

interface ToolCallRecord {
  readonly toolName: string
  readonly path: string | null
  readonly pathStatus: 'VALID' | 'MISSING' | 'INVALID'
}

interface ToolResultRecord {
  readonly callId: string
  readonly toolName: string | undefined
  readonly eventSourceKey: string | undefined
}

interface ReadCandidate {
  readonly path: string
  readonly callIds: readonly string[]
}

interface AcceptedState {
  readonly authorityOrder: Lc1AuthorityOrder
  readonly envelopeFingerprint: string
  readonly descriptorFingerprint: string
}

interface CallBinding {
  readonly repositoryId: string
  readonly namespace: string
  readonly canonicalPath: string
  readonly sourceKey: string
}

const REPOSITORY_FILE_PREFIX = 'repository/file://'

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${label} must not be empty`)
  return trimmed
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

function isRepositoryRevision(value: unknown): value is Lc1RepositoryRevision {
  if (typeof value !== 'object' || value === null) return false
  const revision = value as Record<string, unknown>
  return (
    isGitObjectHash(revision['baseCommit']) &&
    isGitObjectHash(revision['treeHash']) &&
    (revision['workingTreePatchHash'] === null || isContentHash(revision['workingTreePatchHash']))
  )
}

function isPiMessageView(value: unknown): value is PiMessageView {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return (
    typeof message['role'] === 'string' &&
    (message['content'] === undefined ||
      typeof message['content'] === 'string' ||
      Array.isArray(message['content'])) &&
    (message['toolName'] === undefined || typeof message['toolName'] === 'string') &&
    (message['toolCallId'] === undefined || typeof message['toolCallId'] === 'string') &&
    (message['isError'] === undefined || typeof message['isError'] === 'boolean') &&
    (message['customType'] === undefined || typeof message['customType'] === 'string')
  )
}

function isMappingRequest(value: unknown): value is Lc1RepositoryMappingRequest {
  if (typeof value !== 'object' || value === null) return false
  const request = value as Record<string, unknown>
  const order = request['authorityOrder']
  const validAuthorityOrder =
    typeof order === 'object' &&
    order !== null &&
    isNonEmptyString((order as Record<string, unknown>)['streamId']) &&
    Number.isInteger((order as Record<string, unknown>)['sequence']) &&
    ((order as Record<string, unknown>)['sequence'] as number) >= 0
  return (
    Array.isArray(request['messages']) &&
    request['messages'].every(isPiMessageView) &&
    isNonEmptyString(request['runtimeSessionId']) &&
    isNonEmptyString(request['repositoryId']) &&
    isNonEmptyString(request['namespace']) &&
    isRepositoryRevision(request['expectedRevision']) &&
    Number.isInteger(request['modelCallSequence']) &&
    (request['modelCallSequence'] as number) >= 1 &&
    validAuthorityOrder &&
    isNonEmptyString(request['observedAt'])
  )
}

function isExternalObservationSink(value: unknown): value is Lc1ExternalObservationSink {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { queueExternalObservations?: unknown }).queueExternalObservations ===
      'function'
  )
}

function isRuntimeAdmissionSink(value: unknown): value is Lc1RuntimeRepositoryAdmissionSink {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { lc1RepositoryAdmissionMode?: unknown }).lc1RepositoryAdmissionMode ===
      'RUNTIME_OWNED' &&
    typeof (value as { admitLc1RepositoryObservations?: unknown })
      .admitLc1RepositoryObservations === 'function'
  )
}

function isMappingSink(value: unknown): value is Lc1ProductionMappingSink {
  return isExternalObservationSink(value) || isRuntimeAdmissionSink(value)
}

/** Normalize a Pi path hint without ever treating the hint as repository truth. */
export function normalizeLc1RepositoryPath(path: string): string {
  const raw = nonEmpty(path, 'repository path').replaceAll('\\', '/')
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.includes('\0')) {
    throw new Error('repository path must be relative and POSIX-safe')
  }

  const segments: string[] = []
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) throw new Error('repository path escapes root')
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  if (segments.length === 0) throw new Error('repository path resolves to empty')
  return segments.join('/')
}

function revisionFingerprint(revision: Lc1RepositoryRevision): string {
  return JSON.stringify([revision.baseCommit, revision.treeHash, revision.workingTreePatchHash])
}

function scopeFingerprint(input: {
  readonly runtimeSessionId: string
  readonly repositoryId: string
  readonly namespace: string
  readonly path: string
}): string {
  return sha256Hex(
    JSON.stringify([input.runtimeSessionId, input.repositoryId, input.namespace, input.path])
  )
}

function authorityScopeId(scope: Lc1RepositoryScope): string {
  return `repository-scope:v1:${sha256Hex(JSON.stringify([scope.repositoryId, scope.namespace]))}`
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

function callBindingKey(runtimeSessionId: string, callId: string): string {
  return JSON.stringify([runtimeSessionId, callId])
}

function sourceScopeKey(runtimeSessionId: string, sourceKey: string): string {
  return JSON.stringify([runtimeSessionId, sourceKey])
}

function sameCallBinding(left: CallBinding, right: CallBinding): boolean {
  return (
    left.repositoryId === right.repositoryId &&
    left.namespace === right.namespace &&
    left.canonicalPath === right.canonicalPath &&
    left.sourceKey === right.sourceKey
  )
}

function sameRepositoryScope(left: Lc1RepositoryScope, right: Lc1RepositoryScope): boolean {
  return left.repositoryId === right.repositoryId && left.namespace === right.namespace
}

function validOrder(order: Lc1AuthorityOrder): boolean {
  return isNonEmptyString(order.streamId) && Number.isInteger(order.sequence) && order.sequence >= 0
}

function sameRevision(left: Lc1RepositoryRevision, right: Lc1RepositoryRevision): boolean {
  return revisionFingerprint(left) === revisionFingerprint(right)
}

function normalizeHintFromEntry(
  sourceKey: string
): { readonly path: string; readonly status: 'VALID' | 'INVALID' } | null {
  if (!sourceKey.startsWith(REPOSITORY_FILE_PREFIX)) return null
  const raw = sourceKey.slice(REPOSITORY_FILE_PREFIX.length)
  try {
    return { path: normalizeLc1RepositoryPath(raw), status: 'VALID' }
  } catch {
    return { path: raw, status: 'INVALID' }
  }
}

function collectReadCandidates(
  messages: readonly PiMessageView[],
  runtimeSessionId: string,
  modelCallSequence: number
): {
  readonly candidates: readonly ReadCandidate[]
  readonly rejected: readonly Lc1MappingIssue[]
} {
  const callsById = new Map<string, ToolCallRecord>()
  const remappedCallIds = new Set<string>()
  const resultRecords: ToolResultRecord[] = []
  const resultCallIds = new Set<string>()
  const rejected: Lc1MappingIssue[] = []

  messages.forEach((message, messagePosition) => {
    const entries = decomposePiMessage(message, {
      runtimeSessionId,
      modelCallSequence,
      messagePosition
    })
    for (const entry of entries) {
      if (entry.element.elementKind === 'TOOL_CALL') {
        const callId = entry.element.toolCallId
        if (callId === undefined) continue
        const hint = (entry.attribution.resourceHints ?? [])
          .map((candidate) => normalizeHintFromEntry(candidate.sourceKey))
          .find((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
        const next: ToolCallRecord = {
          toolName: entry.element.toolName ?? '',
          path: hint?.status === 'VALID' ? hint.path : null,
          pathStatus: hint === undefined ? 'MISSING' : hint.status
        }
        const previous = callsById.get(callId)
        if (
          previous !== undefined &&
          (previous.toolName !== next.toolName ||
            previous.path !== next.path ||
            previous.pathStatus !== next.pathStatus)
        ) {
          remappedCallIds.add(callId)
        }
        callsById.set(callId, next)
      }
    }

    if (message.role !== 'toolResult') return
    const callId = message.toolCallId
    const eventSourceKey = entries.find((entry) => entry.element.elementKind === 'TOOL_RESULT')
      ?.attribution.sourceKey
    if (callId === undefined) {
      rejected.push({
        callIds: [],
        reason: 'MISSING_CALL_ID',
        ...(eventSourceKey === undefined ? {} : { detail: eventSourceKey })
      })
      return
    }
    if (resultCallIds.has(callId)) {
      rejected.push({
        callIds: [callId],
        reason: 'DUPLICATE_CALL_RESULT',
        ...(eventSourceKey === undefined ? {} : { detail: eventSourceKey })
      })
      return
    }
    resultCallIds.add(callId)
    resultRecords.push({ callId, toolName: message.toolName, eventSourceKey })
  })

  const candidatesByPath = new Map<string, string[]>()
  for (const result of resultRecords) {
    if (remappedCallIds.has(result.callId)) {
      rejected.push({
        callIds: [result.callId],
        reason: 'CALL_ID_REMAP',
        ...(result.eventSourceKey === undefined ? {} : { detail: result.eventSourceKey })
      })
      continue
    }
    const call = callsById.get(result.callId)
    if (call === undefined) {
      rejected.push({
        callIds: [result.callId],
        reason: 'UNMATCHED_CALL_ID',
        ...(result.eventSourceKey === undefined ? {} : { detail: result.eventSourceKey })
      })
      continue
    }
    if (result.toolName !== undefined && result.toolName !== call.toolName) {
      rejected.push({
        callIds: [result.callId],
        reason: 'CALL_TOOL_NAME_MISMATCH',
        detail: `${call.toolName} != ${result.toolName}`
      })
      continue
    }
    if (call.toolName !== 'read') {
      rejected.push({
        callIds: [result.callId],
        reason: 'UNSUPPORTED_TOOL',
        detail: call.toolName
      })
      continue
    }
    if (call.pathStatus === 'MISSING') {
      rejected.push({ callIds: [result.callId], reason: 'MISSING_PATH_HINT' })
      continue
    }
    if (call.pathStatus === 'INVALID' || call.path === null) {
      rejected.push({ callIds: [result.callId], reason: 'INVALID_PATH_HINT' })
      continue
    }
    const callIds = candidatesByPath.get(call.path) ?? []
    callIds.push(result.callId)
    candidatesByPath.set(call.path, callIds)
  }

  return {
    candidates: [...candidatesByPath.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, callIds]) => ({ path, callIds })),
    rejected
  }
}

function isVerifiedObservation(
  observed: RepositoryFileObservation,
  expectedRevision: Lc1RepositoryRevision
): boolean {
  if (!sameRevision(observed.expectedRevision, expectedRevision)) return false
  if (observed.observation.status === 'UNAVAILABLE') {
    return (
      observed.verifiedRevision === null ||
      sameRevision(observed.verifiedRevision, expectedRevision)
    )
  }
  return (
    observed.verifiedRevision !== null && sameRevision(observed.verifiedRevision, expectedRevision)
  )
}

function isAuthorityObservationFor(
  observed: RepositoryFileObservation,
  sourceKey: string,
  expectedRevision: Lc1RepositoryRevision
): boolean {
  return (
    observed.sourceKey === sourceKey &&
    observed.observation.sourceKey === sourceKey &&
    observed.sourceKind === REPOSITORY_SOURCE_KIND &&
    observed.provenance === REPOSITORY_SOURCE_PROVENANCE &&
    isVerifiedObservation(observed, expectedRevision)
  )
}

function toAcceptedObservation(
  observed: RepositoryFileObservation,
  candidate: ReadCandidate,
  request: Lc1RepositoryMappingRequest
): Lc1AcceptedRepositoryObservation {
  const descriptor: ContextSourceDescriptor = {
    sourceKey: observed.sourceKey,
    sourceKind: observed.sourceKind,
    provenance: observed.provenance,
    authority: authorityScopeId({
      repositoryId: request.repositoryId,
      namespace: request.namespace
    })
  }
  return createLc1MapperAuthorityCandidate({
    runtimeSessionId: request.runtimeSessionId,
    repositoryId: request.repositoryId,
    namespace: request.namespace,
    sourceKey: observed.sourceKey,
    canonicalPath: candidate.path,
    callIds: [...candidate.callIds],
    namespacedCallIds: candidate.callIds.map(
      (callId) => `pi-evidence:v1:${request.runtimeSessionId}:${callId}`
    ),
    observation: observed.observation,
    descriptor,
    authorityRevision: request.expectedRevision,
    authorityOrder: request.authorityOrder,
    representationKind: 'FULL'
  })
}

function acceptedEnvelopeFingerprint(item: Lc1AcceptedRepositoryObservation): string {
  return JSON.stringify({
    repositoryId: item.repositoryId,
    namespace: item.namespace,
    sourceKey: item.sourceKey,
    canonicalPath: item.canonicalPath,
    callIds: item.callIds,
    namespacedCallIds: item.namespacedCallIds,
    observation: observationFingerprint(item.observation),
    descriptor: descriptorFingerprint(item.descriptor),
    authorityRevision: revisionFingerprint(item.authorityRevision),
    authorityOrder: [item.authorityOrder.streamId, item.authorityOrder.sequence],
    representationKind: item.representationKind
  })
}

function toExternalObservation(item: Lc1AcceptedRepositoryObservation): Lc1ExternalObservation {
  return {
    observation: item.observation,
    descriptor: item.descriptor
  }
}

/**
 * Explicit, read-only Pi → RepositoryObserver → external queue candidate.
 * No caller-supplied repository path or Pi result content is trusted.
 */
export class Lc1ProductionRepositoryMapper {
  private readonly repositoryObserver: Pick<RepositoryObserver, 'observe'>
  private readonly pathResolver: Lc1RepositoryPathResolver
  private readonly acceptedBySource = new Map<string, AcceptedState>()
  private readonly callBindings = new Map<string, CallBinding>()
  private readonly sourceScopes = new Map<string, Lc1RepositoryScope>()

  constructor(options: {
    readonly pathResolver: Lc1RepositoryPathResolver
    readonly repositoryObserver?: Pick<RepositoryObserver, 'observe'>
  }) {
    this.pathResolver = options.pathResolver
    this.repositoryObserver = options.repositoryObserver ?? new RepositoryObserver()
  }

  snapshotForTransaction(): Lc1ProductionMappingSnapshot {
    return {
      acceptedBySource: [...this.acceptedBySource].map(([key, state]) => ({
        key,
        authorityOrder: { ...state.authorityOrder },
        envelopeFingerprint: state.envelopeFingerprint,
        descriptorFingerprint: state.descriptorFingerprint
      })),
      callBindings: [...this.callBindings].map(([key, binding]) => ({
        key,
        binding: { ...binding }
      })),
      sourceScopes: [...this.sourceScopes].map(([key, scope]) => ({
        key,
        scope: { ...scope }
      }))
    }
  }

  restoreTransaction(snapshot: Lc1ProductionMappingSnapshot): void {
    this.acceptedBySource.clear()
    for (const item of snapshot.acceptedBySource) {
      this.acceptedBySource.set(item.key, {
        authorityOrder: { ...item.authorityOrder },
        envelopeFingerprint: item.envelopeFingerprint,
        descriptorFingerprint: item.descriptorFingerprint
      })
    }
    this.callBindings.clear()
    for (const item of snapshot.callBindings) {
      this.callBindings.set(item.key, { ...item.binding })
    }
    this.sourceScopes.clear()
    for (const item of snapshot.sourceScopes) {
      this.sourceScopes.set(item.key, { ...item.scope })
    }
  }

  async observeAndQueue(
    request: Lc1RepositoryMappingRequest,
    sink: Lc1ProductionMappingSink
  ): Promise<Lc1ProductionMappingResult> {
    const rejected: Lc1MappingIssue[] = []
    const quarantined: Lc1MappingIssue[] = []
    if (!isMappingRequest(request) || !isMappingSink(sink) || !validOrder(request.authorityOrder)) {
      return {
        accepted: [],
        rejected: [{ callIds: [], reason: 'INVALID_REQUEST' }],
        quarantined: [],
        authoritativeObservations: []
      }
    }
    const runtimeAdmissionSink = isRuntimeAdmissionSink(sink) ? sink : null

    let repositoryPath: string | undefined
    try {
      repositoryPath = this.pathResolver.resolve({
        repositoryId: request.repositoryId,
        namespace: request.namespace
      })
    } catch {
      return {
        accepted: [],
        rejected: [],
        quarantined: [{ callIds: [], reason: 'REPOSITORY_SCOPE_UNBOUND' }],
        authoritativeObservations: []
      }
    }
    if (typeof repositoryPath !== 'string' || repositoryPath.trim().length === 0) {
      return {
        accepted: [],
        rejected: [],
        quarantined: [{ callIds: [], reason: 'REPOSITORY_SCOPE_UNBOUND' }],
        authoritativeObservations: []
      }
    }

    const collected = collectReadCandidates(
      request.messages,
      request.runtimeSessionId,
      request.modelCallSequence
    )
    rejected.push(...collected.rejected)
    if (collected.candidates.length === 0) {
      return {
        accepted: [],
        rejected,
        quarantined,
        authoritativeObservations: []
      }
    }

    let authoritativeObservations: readonly RepositoryFileObservation[]
    try {
      authoritativeObservations = await this.repositoryObserver.observe({
        repositoryPath,
        expectedRevision: request.expectedRevision,
        paths: collected.candidates.map((candidate) => candidate.path),
        observedAt: request.observedAt
      })
    } catch {
      return {
        accepted: [],
        rejected,
        quarantined: [
          ...quarantined,
          ...collected.candidates.map((candidate) => ({
            callIds: [...candidate.callIds],
            sourceKey: repositorySourceKey(candidate.path),
            reason: 'AUTHORITY_OBSERVATION_FAILED' as const
          }))
        ],
        authoritativeObservations: []
      }
    }

    const observationsByKey = new Map<string, RepositoryFileObservation[]>()
    for (const observation of authoritativeObservations) {
      const values = observationsByKey.get(observation.sourceKey) ?? []
      values.push(observation)
      observationsByKey.set(observation.sourceKey, values)
    }

    const staged: Lc1AcceptedRepositoryObservation[] = []
    const stagedStates = new Map<string, AcceptedState>()
    const stagedCallBindings = new Map<string, CallBinding>()
    const stagedSourceScopes = new Map<string, Lc1RepositoryScope>()
    for (const candidate of collected.candidates) {
      const sourceKey = repositorySourceKey(candidate.path)
      const matches = observationsByKey.get(sourceKey) ?? []
      if (matches.length !== 1) {
        quarantined.push({
          callIds: [...candidate.callIds],
          sourceKey,
          reason: 'AUTHORITY_KEY_MISMATCH'
        })
        continue
      }
      const observed = matches[0]!
      if (!isAuthorityObservationFor(observed, sourceKey, request.expectedRevision)) {
        quarantined.push({
          callIds: [...candidate.callIds],
          sourceKey,
          reason: 'UNVERIFIED_AUTHORITY'
        })
        continue
      }

      const accepted = toAcceptedObservation(observed, candidate, request)
      if (runtimeAdmissionSink !== null) {
        staged.push(accepted)
        continue
      }
      const sourceScope = {
        repositoryId: request.repositoryId,
        namespace: request.namespace
      }
      const runtimeSourceKey = sourceScopeKey(request.runtimeSessionId, sourceKey)
      const previousScope =
        this.sourceScopes.get(runtimeSourceKey) ?? stagedSourceScopes.get(runtimeSourceKey)
      if (previousScope !== undefined && !sameRepositoryScope(previousScope, sourceScope)) {
        quarantined.push({
          callIds: [...candidate.callIds],
          sourceKey,
          reason: 'CROSS_SCOPE_COLLISION'
        })
        continue
      }

      const remappedCallIds = candidate.callIds.filter((callId) => {
        const binding: CallBinding = {
          repositoryId: request.repositoryId,
          namespace: request.namespace,
          canonicalPath: candidate.path,
          sourceKey
        }
        const bindingKey = callBindingKey(request.runtimeSessionId, callId)
        const previousBinding =
          this.callBindings.get(bindingKey) ?? stagedCallBindings.get(bindingKey)
        return previousBinding !== undefined && !sameCallBinding(previousBinding, binding)
      })
      if (remappedCallIds.length > 0) {
        rejected.push({
          callIds: remappedCallIds,
          sourceKey,
          reason: 'CALL_ID_REMAP'
        })
        continue
      }

      const stateKey = scopeFingerprint({
        runtimeSessionId: request.runtimeSessionId,
        repositoryId: request.repositoryId,
        namespace: request.namespace,
        path: candidate.path
      })
      const nextState: AcceptedState = {
        authorityOrder: request.authorityOrder,
        envelopeFingerprint: acceptedEnvelopeFingerprint(accepted),
        descriptorFingerprint: descriptorFingerprint(accepted.descriptor)
      }
      const previous = this.acceptedBySource.get(stateKey) ?? stagedStates.get(stateKey)
      if (previous !== undefined) {
        if (previous.descriptorFingerprint !== nextState.descriptorFingerprint) {
          quarantined.push({
            callIds: [...candidate.callIds],
            sourceKey,
            reason: 'DESCRIPTOR_DRIFT'
          })
          continue
        }
        if (previous.authorityOrder.streamId !== request.authorityOrder.streamId) {
          quarantined.push({
            callIds: [...candidate.callIds],
            sourceKey,
            reason: 'INCOMPARABLE_AUTHORITY'
          })
          continue
        }
        if (request.authorityOrder.sequence < previous.authorityOrder.sequence) {
          rejected.push({
            callIds: [...candidate.callIds],
            sourceKey,
            reason: 'STALE_AUTHORITY'
          })
          continue
        }
        if (request.authorityOrder.sequence === previous.authorityOrder.sequence) {
          if (previous.envelopeFingerprint === nextState.envelopeFingerprint) {
            rejected.push({
              callIds: [...candidate.callIds],
              sourceKey,
              reason: 'IDEMPOTENT_DUPLICATE'
            })
          } else {
            quarantined.push({
              callIds: [...candidate.callIds],
              sourceKey,
              reason: 'CONFLICTING_AUTHORITY'
            })
          }
          continue
        }
      }
      staged.push(accepted)
      stagedStates.set(stateKey, nextState)
      stagedSourceScopes.set(runtimeSourceKey, sourceScope)
      for (const callId of candidate.callIds) {
        stagedCallBindings.set(callBindingKey(request.runtimeSessionId, callId), {
          repositoryId: request.repositoryId,
          namespace: request.namespace,
          canonicalPath: candidate.path,
          sourceKey
        })
      }
    }

    if (staged.length === 0) {
      return { accepted: [], rejected, quarantined, authoritativeObservations }
    }

    if (runtimeAdmissionSink !== null) {
      if (rejected.length > 0 || quarantined.length > 0) {
        rejected.push(
          ...staged.map((item) => ({
            callIds: [...item.callIds],
            sourceKey: item.sourceKey,
            reason: 'BATCH_REJECTED' as const
          }))
        )
        return {
          accepted: [],
          rejected,
          quarantined,
          authoritativeObservations
        }
      }
      const admission = runtimeAdmissionSink.admitLc1RepositoryObservations(staged)
      return {
        accepted: admission.accepted,
        rejected: [...rejected, ...admission.rejected],
        quarantined: [...quarantined, ...admission.quarantined],
        authoritativeObservations
      }
    }

    try {
      if (!isExternalObservationSink(sink)) throw new Error('invalid external observation sink')
      sink.queueExternalObservations(staged.map(toExternalObservation))
    } catch {
      return {
        accepted: [],
        rejected,
        quarantined: [
          ...quarantined,
          ...staged.map((item) => ({
            callIds: [...item.callIds],
            sourceKey: item.sourceKey,
            reason: 'QUEUE_REJECTED' as const
          }))
        ],
        authoritativeObservations
      }
    }

    for (const [key, state] of stagedStates) this.acceptedBySource.set(key, state)
    for (const [key, binding] of stagedCallBindings) this.callBindings.set(key, binding)
    for (const [key, scope] of stagedSourceScopes) this.sourceScopes.set(key, scope)
    return {
      accepted: staged,
      rejected,
      quarantined,
      authoritativeObservations
    }
  }
}
