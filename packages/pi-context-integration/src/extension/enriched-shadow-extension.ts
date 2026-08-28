import {
  applySourceObservations,
  countAttributions,
  createAvailableObservation,
  seedUniverse,
  type ContextSourceDescriptor,
  type ContextUniverseRevision,
  type SnapshotLikeSeed,
  type SourceAttribution,
  type SourceObservation,
  type UniverseAttributionSummary
} from '@canvas-agent/context-runtime'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { PiContextShadowObserver } from './shadow-extension'
import { decomposePiMessages, type ElementWithAttribution } from '../element-decomposition'
import { PI_SOURCE_KINDS, PI_SOURCE_PROVENANCE } from '../pi-source-methods'
import type { PiMessageView } from '../pi-message-mapper'

// Enriched CR-002 shadow observer. It keeps the CR-001 observation seam intact
// (Pi messages returned unchanged) and additionally:
//   - decomposes messages into ObservedContextElements;
//   - derives deterministic SourceAttributions;
//   - converts EXACT/DERIVED_HINT source keys into provisional source
//     observations (AVAILABLE only for structured event identities; resource
//     hints stay hints and are recorded as coverage, not source state);
//   - advances an immutable Shadow ContextUniverseRevision per model call.

export interface EnrichedShadowResult {
  readonly elements: readonly ElementWithAttribution[]
  readonly attributionSummary: UniverseAttributionSummary
  readonly sourceObservations: readonly SourceObservation[]
  readonly sourceDescriptors: readonly ContextSourceDescriptor[]
  readonly universeRevision: ContextUniverseRevision
  // CR-001 native estimate for this model call, scoped to
  // agent-messages-pre-provider (real value, not a placeholder).
  readonly nativeContextEstimate: number
  // Provider-neutral recent trustworthy run-evidence source keys (adapter
  // supplies this; core never compares Pi literals).
  readonly recentEvidenceSourceKeys: readonly string[]
}

export interface EnrichedPiShadowObserverOptions {
  readonly base: PiContextShadowObserver
  readonly seeds?: readonly SnapshotLikeSeed[]
}

/**
 * Transactional observation snapshot (CR-004 hardening): the observer state one
 * `observeModelCall` mutates — the base observation seam, the universe
 * revision, the call-result log, and the pending external-observation queue.
 * `restoreTransaction` rewinds all of it so a rolled-back boundary can be
 * re-observed exactly (external observations queued before the snapshot are
 * re-queued and consumed again by the re-observation).
 */
export interface EnrichedObserverSnapshot {
  readonly base: ReturnType<PiContextShadowObserver['snapshotForTransaction']>
  readonly universe: ContextUniverseRevision | null
  readonly callResultCount: number
  readonly pendingExternalObservations: ReadonlyMap<string, ExternalObservation>
}

// Provider-neutral external observation: an authoritative adapter queues a
// SourceObservation (AVAILABLE / ABSENT / UNAVAILABLE) with its explicit source
// descriptor. Applied at the next model-call boundary through the normal
// Source Reconciliation path.
export interface ExternalObservation {
  readonly observation: SourceObservation
  readonly descriptor: ContextSourceDescriptor
}

export class EnrichedPiShadowObserver {
  private readonly base: PiContextShadowObserver
  private readonly seeds: readonly SnapshotLikeSeed[]
  private readonly pendingExternalObservations = new Map<string, ExternalObservation>()
  private universe: ContextUniverseRevision | null
  readonly callResults: readonly EnrichedShadowResult[]

  constructor(options: EnrichedPiShadowObserverOptions) {
    this.base = options.base
    this.seeds = options.seeds ?? []
    this.universe = null
    this.callResults = []
  }

  get runtimeSessionId(): string {
    return this.base.runtimeSession.runtimeSessionId
  }

  get universeRevision(): ContextUniverseRevision | null {
    return this.universe
  }

  get callCount(): number {
    return this.callResults.length
  }

  // An integration adapter may queue authoritative, metadata-only observations
  // discovered outside the Pi message stream. They are consumed exactly once at
  // the next model-call boundary, after the adapter has verified the source
  // against its own authority. AVAILABLE may admit/advance; UNAVAILABLE updates
  // the observation status but retains the last admitted version; ABSENT
  // follows existing absence semantics. This additive seam is intentionally
  // inert unless a caller supplies observations; it never promotes Pi
  // resource-hint paths by itself.
  queueExternalObservations(observations: readonly ExternalObservation[]): void {
    for (const item of observations) {
      if (item.observation.sourceKey !== item.descriptor.sourceKey) {
        throw new Error('external_observation_descriptor_source_key_mismatch')
      }
    }
    for (const item of observations) {
      this.pendingExternalObservations.set(item.observation.sourceKey, item)
    }
  }

  // Backward-compatible convenience: SnapshotLikeSeed is an AVAILABLE snapshot
  // seed. Converts to an AVAILABLE observation + descriptor.
  queueExternalSeeds(seeds: readonly SnapshotLikeSeed[]): void {
    this.queueExternalObservations(
      seeds.map((seed) => ({
        observation: createAvailableObservation(seed.sourceKey, seed.contentHash, seed.observedAt),
        descriptor: {
          sourceKey: seed.sourceKey,
          sourceKind: seed.sourceKind,
          provenance: seed.provenance,
          ...(seed.authority !== undefined ? { authority: seed.authority } : {}),
          ...(seed.priority !== undefined ? { priority: seed.priority } : {})
        }
      }))
    )
  }

  snapshotForTransaction(): EnrichedObserverSnapshot {
    return {
      base: this.base.snapshotForTransaction(),
      universe: this.universe,
      callResultCount: this.callResults.length,
      pendingExternalObservations: new Map(this.pendingExternalObservations)
    }
  }

  restoreTransaction(snapshot: EnrichedObserverSnapshot): void {
    this.base.restoreTransaction(snapshot.base)
    this.universe = snapshot.universe
    if (this.callResults.length > snapshot.callResultCount) {
      ;(this.callResults as EnrichedShadowResult[]).length = snapshot.callResultCount
    }
    this.pendingExternalObservations.clear()
    for (const [key, value] of snapshot.pendingExternalObservations) {
      this.pendingExternalObservations.set(key, value)
    }
  }

  private takeExternalObservations(): readonly ExternalObservation[] {
    const items = [...this.pendingExternalObservations.values()]
    this.pendingExternalObservations.clear()
    return items.sort((left, right) =>
      left.observation.sourceKey.localeCompare(right.observation.sourceKey)
    )
  }

  observeModelCall(messages: readonly PiMessageView[]): EnrichedShadowResult {
    const sequence = this.base.beginModelCall()

    // Capture the model-call observation first so CR-001 and CR-002 share the
    // SAME observedAt timestamp for this semantic model call (no second clock,
    // no drift within the call).
    const observation = this.base.observe(messages, sequence) as {
      observedAt: string
      observedMessageTokenEstimate: number
    }
    const observedAt = observation.observedAt
    const nativeContextEstimate = observation.observedMessageTokenEstimate

    const elements = decomposePiMessages(messages, {
      runtimeSessionId: this.runtimeSessionId,
      modelCallSequence: sequence
    })
    const attributionSummary: UniverseAttributionSummary = countAttributions({
      primaryConfidences: elements.map((entry) => entry.attribution.confidence),
      resourceHintCount: elements.reduce(
        (sum, entry) => sum + (entry.attribution.resourceHints?.length ?? 0),
        0
      )
    })
    const piSources = collectSourceObservations(elements, observedAt)
    const externalItems = this.takeExternalObservations()
    const externalObservations = externalItems.map((item) => item.observation)
    const externalDescriptors = externalItems.map((item) => item.descriptor)
    const observations = [...externalObservations, ...piSources.observations]
    const descriptors = [...externalDescriptors, ...piSources.descriptors]

    // Seed Universe #0 on the first observed model call so the very first
    // revision has a baseline. Only constructor-supplied snapshot seeds form
    // the baseline; queued external observations (any status) are applied below
    // through normal Source Reconciliation.
    if (this.universe === null) {
      this.universe = seedUniverse({
        runtimeSessionId: this.runtimeSessionId,
        seeds: this.seeds
      })
    }
    this.universe = applySourceObservations({
      previous: this.universe,
      observations,
      sourceDescriptors: descriptors,
      modelCallSequence: sequence,
      attributionSummary
    })

    // Adapter supplies the provider-neutral recent-evidence signal from the
    // Pi context seam: every EXACT run-event source just observed is recent
    // trustworthy evidence. Only AVAILABLE external observations count as
    // recent trustworthy evidence; ABSENT/UNAVAILABLE do not.
    const externalAvailableKeys = externalItems
      .filter((item) => item.observation.status === 'AVAILABLE')
      .map((item) => item.descriptor.sourceKey)
    const recentEvidenceSourceKeys = descriptors
      .filter((d) => d.provenance === PI_SOURCE_PROVENANCE.CONTEXT_EVENT)
      .map((d) => d.sourceKey)
      .concat(externalAvailableKeys)

    const result: EnrichedShadowResult = {
      elements,
      attributionSummary,
      sourceObservations: observations,
      sourceDescriptors: descriptors,
      universeRevision: this.universe,
      nativeContextEstimate,
      recentEvidenceSourceKeys
    }
    ;(this.callResults as EnrichedShadowResult[]).push(result)
    return result
  }
}

// Deterministic conversion from attributed elements to provisional source
// observations. Only EXACT identities produce AVAILABLE observations (the event
// id is directly exposed by the harness). DERIVED_HINT resource paths are NOT
// converted to source observations: a read result is not proven canonical file
// state. UNATTRIBUTED / OPAQUE produce no observation.
//
// The runtime source descriptor (sourceKind/provenance) is created HERE in the
// Pi integration layer; the Runtime core never infers sourceKind from the key.
export function collectSourceObservations(
  elements: readonly ElementWithAttribution[],
  observedAt: string
): {
  readonly observations: readonly SourceObservation[]
  readonly descriptors: readonly ContextSourceDescriptor[]
} {
  const observations: SourceObservation[] = []
  const descriptors: ContextSourceDescriptor[] = []
  for (const entry of elements) {
    const attribution: SourceAttribution = entry.attribution
    if (attribution.confidence !== 'EXACT') continue
    if (attribution.sourceKey === undefined) continue
    const sourceKey = attribution.sourceKey
    if (sourceKey.startsWith('run/tool-call://')) {
      const contentHash = entry.element.semanticHash
      observations.push(createAvailableObservation(sourceKey, contentHash, observedAt))
      descriptors.push({
        sourceKey,
        sourceKind: PI_SOURCE_KINDS.RUN_TOOL_CALL,
        provenance: PI_SOURCE_PROVENANCE.CONTEXT_EVENT
      })
    } else if (sourceKey.startsWith('run/tool-result://')) {
      const contentHash = entry.element.semanticHash
      observations.push(createAvailableObservation(sourceKey, contentHash, observedAt))
      descriptors.push({
        sourceKey,
        sourceKind: PI_SOURCE_KINDS.RUN_TOOL_RESULT,
        provenance: PI_SOURCE_PROVENANCE.CONTEXT_EVENT
      })
    }
  }
  return { observations, descriptors }
}

// Enriched Pi extension factory: runs the CR-001 observation seam plus CR-002
// element/attribution/universe enrichment, and returns the ORIGINAL messages.
export function createEnrichedPiContextShadowExtension(options: {
  readonly observer: EnrichedPiShadowObserver
}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on('context', async (event: ContextEvent) => {
      options.observer.observeModelCall(event.messages)
      return { messages: event.messages }
    })
  }
}
