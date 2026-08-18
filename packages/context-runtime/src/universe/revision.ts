import { sha256Hex } from '../util/hash'

/** Stable identity of a source in the Context Runtime universe. */
export type ContextSourceId = string

/** Immutable identity of one observed source version. */
export type ContextVersionId = string

export const UNIVERSE_OBSERVATION_STATES = ['PRESENT', 'ABSENT', 'UNAVAILABLE'] as const
export type UniverseObservationState = (typeof UNIVERSE_OBSERVATION_STATES)[number]

export interface UniverseVersionRecord {
  readonly versionId: ContextVersionId
  readonly sourceId: ContextSourceId
  readonly contentHash: string
  readonly providerVersion?: string
  readonly observedAt: number
}

/**
 * The durable state of one source at a revision boundary.
 *
 * `observedVersionId` describes the latest successful observation. During an
 * outage it is null, while `admittedVersionId` and `lastGoodVersionId` may
 * continue to point at the last usable version. A confirmed absence clears the
 * current admitted version but preserves `lastGoodVersionId` for audit/replay.
 */
export interface UniverseEntry {
  readonly sourceId: ContextSourceId
  readonly observationState: UniverseObservationState
  readonly observedVersionId: ContextVersionId | null
  readonly admittedVersionId: ContextVersionId | null
  readonly lastGoodVersionId: ContextVersionId | null
  readonly providerVersion?: string
  readonly contentHash?: string
  readonly lastObservedAt: number
}

export type UniverseObservation =
  | {
      readonly sourceId: ContextSourceId
      readonly observationState: 'PRESENT'
      readonly contentHash: string
      readonly providerVersion?: string
      readonly observedAt: number
    }
  | {
      readonly sourceId: ContextSourceId
      readonly observationState: 'ABSENT'
      readonly observedAt: number
    }
  | {
      readonly sourceId: ContextSourceId
      readonly observationState: 'UNAVAILABLE'
      readonly reason: string
      readonly observedAt: number
    }

export const UNIVERSE_RECONCILIATION_ACTIONS = [
  'INITIALIZE',
  'NO_CHANGE',
  'UPDATE',
  'UNAVAILABLE',
  'RECOVER',
  'ABSENT'
] as const
export type UniverseReconciliationAction = (typeof UNIVERSE_RECONCILIATION_ACTIONS)[number]

export interface UniverseReconciliationEvent {
  readonly sourceId: ContextSourceId
  readonly action: UniverseReconciliationAction
  readonly previousState: UniverseObservationState | null
  readonly previousVersionId: ContextVersionId | null
  readonly nextObservedVersionId: ContextVersionId | null
  readonly nextAdmittedVersionId: ContextVersionId | null
  readonly observedAt: number
  readonly providerVersionChanged: boolean
  readonly contentHashChanged: boolean
  readonly reason?: string
}

export interface UniverseRevision {
  readonly revisionId: string
  readonly parentRevisionId: string | null
  readonly entries: ReadonlyMap<ContextSourceId, UniverseEntry>
  readonly versions: ReadonlyMap<ContextVersionId, UniverseVersionRecord>
  readonly reconciliationEvents: readonly UniverseReconciliationEvent[]
  readonly createdAt: number
  readonly logicalHash: string
}

/** A map view with no mutating Map methods exposed at runtime. */
class FrozenReadonlyMap<K, V> implements ReadonlyMap<K, V> {
  private readonly delegate: Map<K, V>

  constructor(values: Iterable<readonly [K, V]>) {
    this.delegate = new Map(values)
    Object.freeze(this)
  }

  get size(): number {
    return this.delegate.size
  }

  get(key: K): V | undefined {
    return this.delegate.get(key)
  }

  has(key: K): boolean {
    return this.delegate.has(key)
  }

  entries(): MapIterator<[K, V]> {
    return this.delegate.entries()
  }

  keys(): MapIterator<K> {
    return this.delegate.keys()
  }

  values(): MapIterator<V> {
    return this.delegate.values()
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown
  ): void {
    this.delegate.forEach((value, key) => callbackfn.call(thisArg, value, key, this))
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries()
  }
}

function readonlyMap<K, V>(values: Iterable<readonly [K, V]>): ReadonlyMap<K, V> {
  return new FrozenReadonlyMap(values)
}

function freezeVersion(version: UniverseVersionRecord): UniverseVersionRecord {
  return Object.freeze({
    versionId: version.versionId,
    sourceId: version.sourceId,
    contentHash: version.contentHash,
    ...(version.providerVersion !== undefined
      ? { providerVersion: version.providerVersion }
      : {}),
    observedAt: version.observedAt
  })
}

function freezeEntry(entry: UniverseEntry): UniverseEntry {
  return Object.freeze({
    sourceId: entry.sourceId,
    observationState: entry.observationState,
    observedVersionId: entry.observedVersionId,
    admittedVersionId: entry.admittedVersionId,
    lastGoodVersionId: entry.lastGoodVersionId,
    ...(entry.providerVersion !== undefined ? { providerVersion: entry.providerVersion } : {}),
    ...(entry.contentHash !== undefined ? { contentHash: entry.contentHash } : {}),
    lastObservedAt: entry.lastObservedAt
  })
}

function canonicalVersion(version: UniverseVersionRecord): string {
  return [
    version.versionId,
    version.sourceId,
    version.contentHash,
    version.providerVersion ?? '-',
    String(version.observedAt)
  ].join('|')
}

function canonicalEntry(entry: UniverseEntry): string {
  return [
    entry.sourceId,
    entry.observationState,
    entry.observedVersionId ?? '-',
    entry.admittedVersionId ?? '-',
    entry.lastGoodVersionId ?? '-',
    entry.providerVersion ?? '-',
    entry.contentHash ?? '-',
    String(entry.lastObservedAt)
  ].join('|')
}

function canonicalEvent(event: UniverseReconciliationEvent): string {
  return [
    event.sourceId,
    event.action,
    event.previousState ?? '-',
    event.previousVersionId ?? '-',
    event.nextObservedVersionId ?? '-',
    event.nextAdmittedVersionId ?? '-',
    String(event.observedAt),
    String(event.providerVersionChanged),
    String(event.contentHashChanged),
    event.reason ?? '-'
  ].join('|')
}

function assertFiniteTimestamp(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
}

function assertEntryInvariant(
  entry: UniverseEntry,
  versions: ReadonlyMap<ContextVersionId, UniverseVersionRecord>
): void {
  if (entry.sourceId.length === 0) {
    throw new Error('UniverseEntry.sourceId must not be empty')
  }
  assertFiniteTimestamp(entry.lastObservedAt, 'UniverseEntry.lastObservedAt')

  if (entry.observationState === 'PRESENT' && entry.observedVersionId === null) {
    throw new Error(`PRESENT source ${entry.sourceId} must have observedVersionId`)
  }
  if (entry.observationState === 'ABSENT' && entry.observedVersionId !== null) {
    throw new Error(`ABSENT source ${entry.sourceId} cannot have observedVersionId`)
  }
  if (entry.observationState === 'ABSENT' && entry.admittedVersionId !== null) {
    throw new Error(`ABSENT source ${entry.sourceId} cannot have admittedVersionId`)
  }
  if (entry.observationState === 'PRESENT' && entry.admittedVersionId === null) {
    throw new Error(`PRESENT source ${entry.sourceId} must have admittedVersionId`)
  }
  if (entry.admittedVersionId !== null && entry.lastGoodVersionId !== entry.admittedVersionId) {
    throw new Error(`admittedVersionId must equal lastGoodVersionId for ${entry.sourceId}`)
  }

  for (const versionId of [
    entry.observedVersionId,
    entry.admittedVersionId,
    entry.lastGoodVersionId
  ]) {
    if (versionId === null) continue
    const version = versions.get(versionId)
    if (version === undefined) {
      throw new Error(`UniverseEntry ${entry.sourceId} references unknown version ${versionId}`)
    }
    if (version.sourceId !== entry.sourceId) {
      throw new Error(`version ${versionId} belongs to ${version.sourceId}, not ${entry.sourceId}`)
    }
  }
}

export function createContextVersionId(
  sourceId: ContextSourceId,
  contentHash: string
): ContextVersionId {
  return sha256Hex(`context-version-v1|${sourceId}|${contentHash}`)
}

export function createUniverseRevision(input: {
  readonly parentRevisionId: string | null
  readonly entries: ReadonlyMap<ContextSourceId, UniverseEntry> | readonly UniverseEntry[]
  readonly versions?: ReadonlyMap<ContextVersionId, UniverseVersionRecord> | readonly UniverseVersionRecord[]
  readonly reconciliationEvents?: readonly UniverseReconciliationEvent[]
  readonly createdAt: number
  readonly revisionId?: string
}): UniverseRevision {
  assertFiniteTimestamp(input.createdAt, 'UniverseRevision.createdAt')

  const entryValues = Array.isArray(input.entries)
    ? Array.from(input.entries)
    : Array.from(input.entries.values())
  const versionValues = input.versions === undefined
    ? []
    : Array.isArray(input.versions)
      ? Array.from(input.versions)
      : Array.from(input.versions.values())

  const normalizedEntries = entryValues
    .map(freezeEntry)
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
  const normalizedVersions = versionValues
    .map(freezeVersion)
    .sort((a, b) => a.versionId.localeCompare(b.versionId))
  const versions = readonlyMap(normalizedVersions.map((version) => [version.versionId, version] as const))
  const entries = readonlyMap(normalizedEntries.map((entry) => [entry.sourceId, entry] as const))
  for (const entry of normalizedEntries) {
    assertEntryInvariant(entry, versions)
  }

  const reconciliationEvents = Object.freeze(
    [...(input.reconciliationEvents ?? [])].map((event) => Object.freeze({ ...event }))
  )
  const canonical = [
    'universe-revision-v1',
    input.parentRevisionId ?? '-',
    String(input.createdAt),
    ...normalizedEntries.map(canonicalEntry),
    ...normalizedVersions.map(canonicalVersion),
    ...reconciliationEvents.map(canonicalEvent)
  ].join('\u241F')
  const logicalHash = sha256Hex(canonical)
  const expectedRevisionId = `universe-revision:${logicalHash.slice(0, 24)}`
  if (input.revisionId !== undefined && input.revisionId !== expectedRevisionId) {
    throw new Error(`UniverseRevision.revisionId must equal ${expectedRevisionId}`)
  }
  const revisionId = expectedRevisionId

  return Object.freeze({
    revisionId,
    parentRevisionId: input.parentRevisionId,
    entries,
    versions,
    reconciliationEvents,
    createdAt: input.createdAt,
    logicalHash
  })
}

function nextEntry(
  previous: UniverseEntry | undefined,
  observation: UniverseObservation,
  versions: Map<ContextVersionId, UniverseVersionRecord>
): { entry: UniverseEntry; event: UniverseReconciliationEvent } {
  if (previous !== undefined && observation.observedAt < previous.lastObservedAt) {
    throw new Error(
      `out-of-order observation for ${observation.sourceId}: ${observation.observedAt} < ${previous.lastObservedAt}`
    )
  }

  const previousState = previous?.observationState ?? null
  const previousVersionId = previous?.admittedVersionId ?? null
  const previousContentHash = previous?.contentHash

  if (observation.observationState === 'PRESENT') {
    const versionId = createContextVersionId(observation.sourceId, observation.contentHash)
    if (!versions.has(versionId)) {
      versions.set(
        versionId,
        freezeVersion({
          versionId,
          sourceId: observation.sourceId,
          contentHash: observation.contentHash,
          ...(observation.providerVersion !== undefined
            ? { providerVersion: observation.providerVersion }
            : {}),
          observedAt: observation.observedAt
        })
      )
    }
    const action: UniverseReconciliationAction = previous === undefined
      ? 'INITIALIZE'
      : previous.observationState === 'UNAVAILABLE' || previous.observationState === 'ABSENT'
        ? 'RECOVER'
        : previous.admittedVersionId === versionId
          ? 'NO_CHANGE'
          : 'UPDATE'
    const entry: UniverseEntry = freezeEntry({
      sourceId: observation.sourceId,
      observationState: 'PRESENT',
      observedVersionId: versionId,
      admittedVersionId: versionId,
      lastGoodVersionId: versionId,
      ...(observation.providerVersion !== undefined
        ? { providerVersion: observation.providerVersion }
        : {}),
      contentHash: observation.contentHash,
      lastObservedAt: observation.observedAt
    })
    return {
      entry,
      event: Object.freeze({
        sourceId: observation.sourceId,
        action,
        previousState,
        previousVersionId,
        nextObservedVersionId: versionId,
        nextAdmittedVersionId: versionId,
        observedAt: observation.observedAt,
        providerVersionChanged:
          previous?.providerVersion !== observation.providerVersion,
        contentHashChanged: previousContentHash !== observation.contentHash
      })
    }
  }

  if (observation.observationState === 'UNAVAILABLE') {
    const entry: UniverseEntry = freezeEntry({
      sourceId: observation.sourceId,
      observationState: 'UNAVAILABLE',
      observedVersionId: null,
      admittedVersionId: previous?.admittedVersionId ?? null,
      lastGoodVersionId: previous?.lastGoodVersionId ?? null,
      ...(previous?.providerVersion !== undefined
        ? { providerVersion: previous.providerVersion }
        : {}),
      ...(previous?.contentHash !== undefined ? { contentHash: previous.contentHash } : {}),
      lastObservedAt: observation.observedAt
    })
    return {
      entry,
      event: Object.freeze({
        sourceId: observation.sourceId,
        action: 'UNAVAILABLE',
        previousState,
        previousVersionId,
        nextObservedVersionId: null,
        nextAdmittedVersionId: entry.admittedVersionId,
        observedAt: observation.observedAt,
        providerVersionChanged: false,
        contentHashChanged: false,
        reason: observation.reason
      })
    }
  }

  const entry: UniverseEntry = freezeEntry({
    sourceId: observation.sourceId,
    observationState: 'ABSENT',
    observedVersionId: null,
    admittedVersionId: null,
    lastGoodVersionId: previous?.lastGoodVersionId ?? previous?.admittedVersionId ?? null,
    ...(previous?.providerVersion !== undefined
      ? { providerVersion: previous.providerVersion }
      : {}),
    ...(previous?.contentHash !== undefined ? { contentHash: previous.contentHash } : {}),
    lastObservedAt: observation.observedAt
  })
  return {
    entry,
    event: Object.freeze({
      sourceId: observation.sourceId,
      action: 'ABSENT',
      previousState,
      previousVersionId,
      nextObservedVersionId: null,
      nextAdmittedVersionId: null,
      observedAt: observation.observedAt,
      providerVersionChanged: false,
      contentHashChanged: false
    })
  }
}

/**
 * Reconcile one immutable UniverseRevision from an ordered observation batch.
 * Observation is deliberately isolated from proposal/commit state.
 */
export function reconcileUniverseRevision(
  previous: UniverseRevision,
  observations: readonly UniverseObservation[]
): UniverseRevision {
  const entries = new Map(previous.entries)
  const versions = new Map(previous.versions)
  const seen = new Set<string>()
  const events: UniverseReconciliationEvent[] = []

  for (const observation of observations) {
    if (seen.has(observation.sourceId)) {
      throw new Error(`duplicate observation in one batch: ${observation.sourceId}`)
    }
    seen.add(observation.sourceId)
    const result = nextEntry(entries.get(observation.sourceId), observation, versions)
    entries.set(observation.sourceId, result.entry)
    events.push(result.event)
  }

  const createdAt = observations.reduce(
    (latest, observation) => Math.max(latest, observation.observedAt),
    previous.createdAt
  )
  return createUniverseRevision({
    parentRevisionId: previous.revisionId,
    entries,
    versions,
    reconciliationEvents: events,
    createdAt
  })
}

export function createEmptyUniverseRevision(createdAt = 0): UniverseRevision {
  return createUniverseRevision({
    parentRevisionId: null,
    entries: [],
    versions: [],
    reconciliationEvents: [],
    createdAt
  })
}

export interface SerializedUniverseRevision {
  readonly schemaVersion: 1
  readonly revisionId: string
  readonly parentRevisionId: string | null
  readonly entries: readonly UniverseEntry[]
  readonly versions: readonly UniverseVersionRecord[]
  readonly reconciliationEvents: readonly UniverseReconciliationEvent[]
  readonly createdAt: number
  readonly logicalHash: string
}

export function serializeUniverseRevision(revision: UniverseRevision): string {
  const serialized: SerializedUniverseRevision = {
    schemaVersion: 1,
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    entries: [...revision.entries.values()],
    versions: [...revision.versions.values()],
    reconciliationEvents: revision.reconciliationEvents,
    createdAt: revision.createdAt,
    logicalHash: revision.logicalHash
  }
  return JSON.stringify(serialized)
}

export function deserializeUniverseRevision(
  serialized: string | SerializedUniverseRevision
): UniverseRevision {
  const value = typeof serialized === 'string'
    ? (JSON.parse(serialized) as SerializedUniverseRevision)
    : serialized
  if (value.schemaVersion !== 1) {
    throw new Error(`unsupported UniverseRevision schema: ${String(value.schemaVersion)}`)
  }
  const revision = createUniverseRevision({
    revisionId: value.revisionId,
    parentRevisionId: value.parentRevisionId,
    entries: value.entries,
    versions: value.versions,
    reconciliationEvents: value.reconciliationEvents,
    createdAt: value.createdAt
  })
  if (revision.logicalHash !== value.logicalHash) {
    throw new Error('UniverseRevision logicalHash mismatch during deserialization')
  }
  return revision
}
