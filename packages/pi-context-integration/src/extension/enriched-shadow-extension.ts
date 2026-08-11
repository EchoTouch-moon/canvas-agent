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
}

export interface EnrichedPiShadowObserverOptions {
  readonly base: PiContextShadowObserver
  readonly seeds?: readonly SnapshotLikeSeed[]
}

export class EnrichedPiShadowObserver {
  private readonly base: PiContextShadowObserver
  private readonly seeds: readonly SnapshotLikeSeed[]
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

  observeModelCall(messages: readonly PiMessageView[]): EnrichedShadowResult {
    const sequence = this.base.beginModelCall()

    // Capture the model-call observation first so CR-001 and CR-002 share the
    // SAME observedAt timestamp for this semantic model call (no second clock,
    // no drift within the call).
    const observation = this.base.observe(messages, sequence) as { observedAt: string }
    const observedAt = observation.observedAt

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
    const { observations, descriptors } = collectSourceObservations(elements, observedAt)

    // Seed Universe #0 on the first observed model call so the very first
    // revision has a baseline.
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

    const result: EnrichedShadowResult = {
      elements,
      attributionSummary,
      sourceObservations: observations,
      sourceDescriptors: descriptors,
      universeRevision: this.universe
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
