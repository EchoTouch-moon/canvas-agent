import { sha256Hex } from '../util/hash'
import { createSourceVersionId } from '../source/source-types'
import { reconcileSource } from '../source/reconciliation'
import type {
  ContextSourceState,
  ContextSourceVersion,
  SourceObservation,
  SourceReconciliationEvent
} from '../source/source-types'
import type { AttributionConfidence } from '../attribution/attribution'

// EXPERIMENTAL / NOT PUBLIC CONTRACT / NOT PERSISTED SCHEMA.

export interface SnapshotLikeSeed {
  readonly sourceKey: string
  readonly sourceKind: string
  readonly contentHash: string
  readonly authority?: string
  readonly priority?: string
  readonly provenance: string
  readonly observedAt: string
}

export interface ContextUniverseEntry {
  readonly sourceKey: string
  readonly state: ContextSourceState
  readonly admittedVersion: ContextSourceVersion | null
}

export interface UniverseAttributionSummary {
  readonly total: number
  readonly exact: number
  readonly derivedHint: number
  readonly unattributed: number
  readonly opaque: number
  readonly resourceHints: number
}

export interface ContextUniverseRevision {
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly modelCallSequence: number | null
  readonly previousRevisionId?: string
  readonly revisionId: string
  readonly entries: readonly ContextUniverseEntry[]
  readonly reconciliationEvents: readonly SourceReconciliationEvent[]
  readonly attributionSummary: UniverseAttributionSummary | null
  readonly logicalHash: string
}

function canonicalEntries(entries: readonly ContextUniverseEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
  return sorted
    .map((entry) => {
      const state = entry.state
      return [
        entry.sourceKey,
        state.observationStatus,
        state.admittedVersionId ?? '-',
        state.lastAvailableVersionId ?? '-',
        state.reconciliationSequence,
        state.lastObservedAt,
        entry.admittedVersion?.contentHash ?? '-'
      ].join('|')
    })
    .join('\n')
}

export function computeUniverseLogicalHash(
  runtimeSessionId: string,
  sequence: number,
  modelCallSequence: number | null,
  entries: readonly ContextUniverseEntry[],
  reconciliationEvents: readonly SourceReconciliationEvent[]
): string {
  const canonical = [
    runtimeSessionId,
    String(sequence),
    String(modelCallSequence ?? '-'),
    canonicalEntries(entries),
    reconciliationEvents.map((event) => event.action).join(',')
  ].join('\n')
  return sha256Hex(`universe-v1|${canonical}`)
}

export function createUniverseRevision(input: {
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly modelCallSequence: number | null
  readonly previousRevisionId?: string
  readonly entries: readonly ContextUniverseEntry[]
  readonly reconciliationEvents: readonly SourceReconciliationEvent[]
  readonly attributionSummary?: UniverseAttributionSummary | null
}): ContextUniverseRevision {
  const logicalHash = computeUniverseLogicalHash(
    input.runtimeSessionId,
    input.sequence,
    input.modelCallSequence,
    input.entries,
    input.reconciliationEvents
  )
  return {
    runtimeSessionId: input.runtimeSessionId,
    sequence: input.sequence,
    modelCallSequence: input.modelCallSequence,
    ...(input.previousRevisionId !== undefined
      ? { previousRevisionId: input.previousRevisionId }
      : {}),
    revisionId: `universe:${input.runtimeSessionId}:rev-${input.sequence}`,
    entries: input.entries,
    reconciliationEvents: input.reconciliationEvents,
    attributionSummary: input.attributionSummary ?? null,
    logicalHash
  }
}

export interface SeedUniverseOptions {
  readonly runtimeSessionId: string
  readonly seeds: readonly SnapshotLikeSeed[]
}

// Universe sequence 0: snapshot-like seed only. The seed version is immutable
// and addressable; runtime observations later create new revisions whose
// admitted head may advance while the seed version stays reachable.
export function seedUniverse(options: SeedUniverseOptions): ContextUniverseRevision {
  const entries: ContextUniverseEntry[] = options.seeds.map((seed) => {
    const versionId = createSourceVersionId(seed.sourceKey, seed.contentHash)
    const state: ContextSourceState = {
      sourceKey: seed.sourceKey,
      observationStatus: 'AVAILABLE',
      admittedVersionId: versionId,
      lastAvailableVersionId: versionId,
      reconciliationSequence: 0,
      lastObservedAt: seed.observedAt
    }
    const version: ContextSourceVersion = {
      versionId,
      sourceKey: seed.sourceKey,
      contentHash: seed.contentHash,
      observedAt: seed.observedAt
    }
    return { sourceKey: seed.sourceKey, state, admittedVersion: version }
  })
  return createUniverseRevision({
    runtimeSessionId: options.runtimeSessionId,
    sequence: 0,
    modelCallSequence: null,
    entries,
    reconciliationEvents: [],
    attributionSummary: null
  })
}

export interface ApplyObservationsOptions {
  readonly previous: ContextUniverseRevision
  readonly observations: readonly SourceObservation[]
  readonly modelCallSequence: number
  readonly attributionSummary?: UniverseAttributionSummary | null
}

// Produces the next immutable Universe revision by applying observations to the
// previous revision's head states. Historical revisions are never mutated.
export function applySourceObservations(options: ApplyObservationsOptions): ContextUniverseRevision {
  const previous = options.previous
  const stateByKey = new Map<string, ContextSourceState>()
  const versionByKey = new Map<string, ContextSourceVersion | null>()
  for (const entry of previous.entries) {
    stateByKey.set(entry.sourceKey, entry.state)
    versionByKey.set(entry.sourceKey, entry.admittedVersion)
  }

  const events: SourceReconciliationEvent[] = []
  for (let index = 0; index < options.observations.length; index += 1) {
    const observation = options.observations[index]!
    const previousState = stateByKey.get(observation.sourceKey) ?? null
    const result = reconcileSource(previousState, observation, previous.sequence + index + 1)
    stateByKey.set(observation.sourceKey, result.state)
    versionByKey.set(observation.sourceKey, result.admittedVersion)
    events.push(result.event)
  }

  const entries: ContextUniverseEntry[] = [...stateByKey.entries()]
    .map(([sourceKey, state]) => ({
      sourceKey,
      state,
      admittedVersion: versionByKey.get(sourceKey) ?? null
    }))
    .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))

  return createUniverseRevision({
    runtimeSessionId: previous.runtimeSessionId,
    sequence: previous.sequence + 1,
    modelCallSequence: options.modelCallSequence,
    previousRevisionId: previous.revisionId,
    entries,
    reconciliationEvents: events,
    attributionSummary: options.attributionSummary ?? null
  })
}

export interface AttributionCounts {
  readonly total: number
  readonly exact: number
  readonly derivedHint: number
  readonly unattributed: number
  readonly opaque: number
  // Secondary resource hints attached to elements (e.g. repository paths from
  // read args). Cross-cutting count, separate from primary classification.
  readonly resourceHints: number
}

export interface AttributionCountsInput {
  readonly primaryConfidences: readonly AttributionConfidence[]
  readonly resourceHintCount: number
}

// Counts primary attribution classes plus separately-attached derived resource
// hints. An element is classified once by its primary confidence; resourceHints
// is a secondary cross-cutting count (a single EXACT element can carry hints).
export function countAttributions(input: AttributionCountsInput): AttributionCounts {
  const summary = summarizeAttribution(input.primaryConfidences)
  return {
    ...summary,
    resourceHints: input.resourceHintCount
  }
}

export function summarizeAttribution(
  confidences: readonly AttributionConfidence[]
): UniverseAttributionSummary {
  let exact = 0
  let derivedHint = 0
  let unattributed = 0
  let opaque = 0
  for (const confidence of confidences) {
    if (confidence === 'EXACT') exact += 1
    else if (confidence === 'DERIVED_HINT') derivedHint += 1
    else if (confidence === 'UNATTRIBUTED') unattributed += 1
    else opaque += 1
  }
  return { total: confidences.length, exact, derivedHint, unattributed, opaque, resourceHints: 0 }
}

// Replay: re-derive the final Universe revision from seed + ordered observations
// without relying on prior computed revisions. Each replay produces the same
// logicalHash for the same inputs.
export function replayUniverse(options: {
  readonly runtimeSessionId: string
  readonly seeds: readonly SnapshotLikeSeed[]
  readonly observationBatches: readonly { readonly observations: readonly SourceObservation[]; readonly modelCallSequence: number }[]
  readonly attributionSummaries?: readonly (UniverseAttributionSummary | null)[]
}): ContextUniverseRevision {
  let revision = seedUniverse({
    runtimeSessionId: options.runtimeSessionId,
    seeds: options.seeds
  })
  options.observationBatches.forEach((batch, index) => {
    revision = applySourceObservations({
      previous: revision,
      observations: batch.observations,
      modelCallSequence: batch.modelCallSequence,
      attributionSummary: options.attributionSummaries?.[index] ?? null
    })
  })
  return revision
}
