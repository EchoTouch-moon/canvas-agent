import {
  computeShadowMetrics,
  createRepresentation,
  planWorkingSet,
  type ContextPlanningRequest,
  type ContextUniverseEntry,
  type ContextUniverseRevision,
  type ShadowPlanningMetrics,
  type ContextRepresentation,
  type PlannerResult
} from '@canvas-agent/context-runtime'
import { EnrichedPiShadowObserver, type EnrichedShadowResult } from './enriched-shadow-extension'
import type { PiMessageView } from '../pi-message-mapper'

// CR-003A Shadow planner observer. It extends the CR-002 enriched observer so
// that after each model call it constructs a minimal normalized planning
// request, invokes the provider-neutral Policy V0 planner over the current
// Universe revision, and records Shadow Working Set + Transition + metrics.
// The Pi `context` seam remains untouched: real messages are returned
// unchanged by the extension factory.

export interface ShadowPlannerObserverOptions {
  readonly enriched: EnrichedPiShadowObserver
  readonly policyVersion?: string
  // Override the planning request construction for tests/fixtures. The live
  // default is conservative (GENERAL, no prose parsing, no hint promotion).
  readonly makePlanningRequest?: (input: {
    readonly runtimeSessionId: string
    readonly sequence: number
    readonly universe: ContextUniverseRevision
    readonly previousWorkingSetId: string | null
  }) => ContextPlanningRequest
}

export interface ShadowPlannerCallResult {
  readonly enrichedResult: EnrichedShadowResult
  readonly planningRequest: ContextPlanningRequest
  readonly plannerResult: PlannerResult
  readonly metrics: ShadowPlanningMetrics
}

export class ShadowPlannerObserver {
  private readonly enriched: EnrichedPiShadowObserver
  private readonly policyVersion: string
  private readonly makePlanningRequest: NonNullable<ShadowPlannerObserverOptions['makePlanningRequest']>
  private previousWorkingSetId: string | null = null
  readonly callResults: readonly ShadowPlannerCallResult[]

  constructor(options: ShadowPlannerObserverOptions) {
    this.enriched = options.enriched
    this.policyVersion = options.policyVersion ?? 'policy-v0-test'
    this.callResults = []
    this.makePlanningRequest =
      options.makePlanningRequest ?? ((input) => defaultPlanningRequest(input.runtimeSessionId, input.sequence, input.universe, input.previousWorkingSetId))
  }

  get runtimeSessionId(): string {
    return this.enriched.runtimeSessionId
  }

  observeModelCall(messages: readonly PiMessageView[]): ShadowPlannerCallResult {
    const enrichedResult = this.enriched.observeModelCall(messages)
    const universe = enrichedResult.universeRevision

    const planningRequest = this.makePlanningRequest({
      runtimeSessionId: this.runtimeSessionId,
      sequence: universe.modelCallSequence ?? enrichedResult.universeRevision.sequence,
      universe,
      previousWorkingSetId: this.previousWorkingSetId
    })

    const plannerResult = planWorkingSet({
      universe,
      request: planningRequest,
      previousWorkingSet: null, // Shadow planning is stateless across calls here; previous set id is carried in the request for continuity tests.
      options: {
        policyVersion: this.policyVersion,
        createdAt: new Date().toISOString(),
        represent: (entry) => representUniverseEntry(entry)
      }
    })

    const metrics = computeShadowMetrics({
      modelCallSequence: planningRequest.recompositionSequence,
      universeSequence: universe.sequence,
      universeHash: universe.logicalHash,
      nativeContextEstimate: 0,
      workingSet: plannerResult.workingSet,
      decisions: plannerResult.decisions
    })

    this.previousWorkingSetId = plannerResult.workingSet.workingSetId

    const result: ShadowPlannerCallResult = {
      enrichedResult,
      planningRequest,
      plannerResult,
      metrics
    }
    ;(this.callResults as ShadowPlannerCallResult[]).push(result)
    return result
  }
}

// Conservative live default: GENERAL phase, empty targets, empty pins/excludes.
function defaultPlanningRequest(
  runtimeSessionId: string,
  sequence: number,
  universe: ContextUniverseRevision,
  previousWorkingSetId: string | null
): ContextPlanningRequest {
  void universe
  return {
    runtimeSessionId,
    recompositionSequence: sequence,
    taskPhase: 'GENERAL',
    budget: { maxSemanticTokens: 8000 },
    pinnedSourceKeys: [],
    excludedSourceKeys: [],
    currentTargetSourceKeys: [],
    latestVerificationSourceKeys: [],
    previousWorkingSetId
  }
}

// Map an admitted Universe entry to an experimental REFERENCE representation.
// Only trustworthy admitted state is represented; DERIVED_HINT repository/file
// paths are not promoted here (they are not admitted into the Universe).
export function representUniverseEntry(entry: ContextUniverseEntry): ContextRepresentation | null {
  const version = entry.admittedVersion
  if (version === null) return null
  return createRepresentation({
    kind: 'REFERENCE',
    sourceVersionIds: [version.versionId],
    contentHash: version.contentHash,
    tokenEstimate: 1,
    lossiness: 'NONE',
    derivation: { sourceKey: entry.source.sourceKey, sourceKind: entry.source.sourceKind }
  })
}
