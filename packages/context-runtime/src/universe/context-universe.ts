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

// Provider-neutral experimental source descriptor carried by every Universe
// entry. Explicit metadata (sourceKind/provenance) lets a consumer distinguish
// snapshot-seeded vs run-derived sources without parsing the sourceKey.
export interface ContextSourceDescriptor {
  readonly sourceKey: string
  readonly sourceKind: string
  readonly provenance: string
  readonly authority?: string
  readonly priority?: string
}

export interface ContextUniverseEntry {
  readonly source: ContextSourceDescriptor
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
  const sorted = [...entries].sort((a, b) => a.source.sourceKey.localeCompare(b.source.sourceKey))
  return sorted
    .map((entry) => {
      const state = entry.state
      return [
        entry.source.sourceKey,
        entry.source.sourceKind,
        entry.source.provenance,
        entry.source.authority ?? '-',
        entry.source.priority ?? '-',
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
    return {
      source: {
        sourceKey: seed.sourceKey,
        sourceKind: seed.sourceKind,
        provenance: seed.provenance,
        ...(seed.authority !== undefined ? { authority: seed.authority } : {}),
        ...(seed.priority !== undefined ? { priority: seed.priority } : {})
      },
      state,
      admittedVersion: version
    }
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
  // Runtime-admitted source descriptors (sourceKind/provenance) supplied by the
  // integration/adapter layer. Used when a source first enters the Universe via
  // a runtime observation; the core never infers sourceKind from the key.
  readonly sourceDescriptors?: readonly ContextSourceDescriptor[]
}

// Produces the next immutable Universe revision by applying observations to the
// previous revision's head states. Historical revisions are never mutated.
export function applySourceObservations(options: ApplyObservationsOptions): ContextUniverseRevision {
  const previous = options.previous
  const stateByKey = new Map<string, ContextSourceState>()
  const versionByKey = new Map<string, ContextSourceVersion | null>()
  const descriptorByKey = new Map<string, ContextSourceDescriptor>()
  for (const entry of previous.entries) {
    stateByKey.set(entry.source.sourceKey, entry.state)
    versionByKey.set(entry.source.sourceKey, entry.admittedVersion)
    descriptorByKey.set(entry.source.sourceKey, entry.source)
  }
  for (const descriptor of options.sourceDescriptors ?? []) {
    descriptorByKey.set(descriptor.sourceKey, descriptor)
  }

  const events: SourceReconciliationEvent[] = []
  for (let index = 0; index < options.observations.length; index += 1) {
    const observation = options.observations[index]!
    const previousState = stateByKey.get(observation.sourceKey) ?? null
    const result = reconcileSource(previousState, observation, previous.sequence + index + 1)
    stateByKey.set(observation.sourceKey, result.state)

    // Retain the previous admitted ContextSourceVersion when the reconciled
    // state still points at the same admitted version id (NO_CHANGE /
    // RETAIN_LAST_KNOWN). Only clear it on confirmed ABSENT/REMOVE or when the
    // reconcile produced a new version.
    if (result.admittedVersion !== null) {
      versionByKey.set(observation.sourceKey, result.admittedVersion)
    } else if (result.state.admittedVersionId !== null) {
      const previousVersion = versionByKey.get(observation.sourceKey)
      if (previousVersion?.versionId === result.state.admittedVersionId) {
        versionByKey.set(observation.sourceKey, previousVersion)
      }
    } else {
      versionByKey.set(observation.sourceKey, null)
    }

    events.push(result.event)
  }

  const entries: ContextUniverseEntry[] = [...stateByKey.entries()]
    .map(([sourceKey, state]) => {
      const descriptor = descriptorByKey.get(sourceKey)
      if (descriptor === undefined) {
        // No descriptor supplied and none inherited: the entry is unobservable
        // by kind. This is a malformed state for a source that just entered the
        // Universe; keep a neutral descriptor rather than guessing sourceKind
        // from the key.
        return {
          source: { sourceKey, sourceKind: 'UNKNOWN', provenance: 'UNKNOWN' },
          state,
          admittedVersion: versionByKey.get(sourceKey) ?? null
        }
      }
      return {
        source: descriptor,
        state,
        admittedVersion: versionByKey.get(sourceKey) ?? null
      }
    })
    .sort((a, b) => a.source.sourceKey.localeCompare(b.source.sourceKey))

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
  readonly observationBatches: readonly {
    readonly observations: readonly SourceObservation[]
    readonly modelCallSequence: number
    readonly sourceDescriptors?: readonly ContextSourceDescriptor[]
  }[]
  readonly attributionSummaries?: readonly (UniverseAttributionSummary | null)[]
}): ContextUniverseRevision {
  let revision = seedUniverse({
    runtimeSessionId: options.runtimeSessionId,
    seeds: options.seeds
  })
  options.observationBatches.forEach((batch, index) => {
    const baseOptions: ApplyObservationsOptions = {
      previous: revision,
      observations: batch.observations,
      modelCallSequence: batch.modelCallSequence,
      attributionSummary: options.attributionSummaries?.[index] ?? null,
      ...(batch.sourceDescriptors !== undefined ? { sourceDescriptors: batch.sourceDescriptors } : {})
    }
    revision = applySourceObservations(baseOptions)
  })
  return revision
}
