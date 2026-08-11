import {
  computeShadowMetrics,
  createRepresentation,
  planWorkingSet,
  type ContextPlanningRequest,
  type ContextUniverseEntry,
  type ContextUniverseRevision,
  type ShadowPlanningMetrics,
  type ContextRepresentation,
  type PlannerResult,
  type ContextWorkingSet,
  type RemovalRecord,
  type ContextDecision
} from '@canvas-agent/context-runtime'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { EnrichedPiShadowObserver, type EnrichedShadowResult } from './enriched-shadow-extension'
import type { PiMessageView } from '../pi-message-mapper'

// CR-003A Shadow planner observer. It extends the CR-002 enriched observer so
// that after each model call it constructs a minimal normalized planning
// request, invokes the provider-neutral Policy V0 planner over the current
// Universe revision with the ACTUAL previous Shadow Working Set, and records
// Shadow Working Set + Transition + metrics. The Pi `context` seam remains
// untouched: real messages are returned unchanged by the extension factory.

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
    readonly nativeContextEstimate: number
    readonly recentEvidenceSourceKeys: readonly string[]
    readonly removalHistory: readonly RemovalRecord[]
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
  private previousWorkingSet: ContextWorkingSet | null = null
  private readonly removalHistoryBySource = new Map<string, RemovalRecord>()
  readonly callResults: readonly ShadowPlannerCallResult[]

  constructor(options: ShadowPlannerObserverOptions) {
    this.enriched = options.enriched
    this.policyVersion = options.policyVersion ?? 'policy-v0'
    this.callResults = []
    this.makePlanningRequest =
      options.makePlanningRequest ??
      ((input) => defaultPlanningRequest(input.runtimeSessionId, input.sequence, input.nativeContextEstimate, input.recentEvidenceSourceKeys, input.removalHistory, input.previousWorkingSetId))
  }

  get runtimeSessionId(): string {
    return this.enriched.runtimeSessionId
  }

  observeModelCall(messages: readonly PiMessageView[]): ShadowPlannerCallResult {
    const enrichedResult = this.enriched.observeModelCall(messages)
    const universe = enrichedResult.universeRevision

    const removalHistory = [...this.removalHistoryBySource.values()]
    const planningRequest = this.makePlanningRequest({
      runtimeSessionId: this.runtimeSessionId,
      sequence: universe.modelCallSequence ?? enrichedResult.universeRevision.sequence,
      universe,
      previousWorkingSetId: this.previousWorkingSet?.workingSetId ?? null,
      nativeContextEstimate: enrichedResult.nativeContextEstimate,
      recentEvidenceSourceKeys: enrichedResult.recentEvidenceSourceKeys,
      removalHistory
    })

    // Validate consistency: if the request claims a previous set id it must
    // Validate bidirectional strict consistency: the request's claimed previous
    // Working Set id must equal the actual previous Working Set supplied to the
    // planner. Both mismatches (request non-null vs actual null, and request
    // null vs actual non-null) are rejected so PlanningRequest hashing and the
    // planner input cannot disagree for replay/audit.
    const actualPreviousWorkingSetId = this.previousWorkingSet?.workingSetId ?? null
    if (planningRequest.previousWorkingSetId !== actualPreviousWorkingSetId) {
      throw new Error(
        `previousWorkingSetId mismatch: request=${planningRequest.previousWorkingSetId} actual=${actualPreviousWorkingSetId}`
      )
    }

    const plannerResult = planWorkingSet({
      universe,
      request: planningRequest,
      previousWorkingSet: this.previousWorkingSet,
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
      nativeContextEstimate: enrichedResult.nativeContextEstimate,
      workingSet: plannerResult.workingSet,
      decisions: plannerResult.decisions
    })

    // Record removal/cold history for future REHYDRATE decisions (bounded,
    // provider-neutral; preserves original removal reason + evidence).
    for (const decision of plannerResult.decisions) {
      if (decision.kind === 'REMOVE') {
        this.removalHistoryBySource.set(decision.sourceKey, {
          sourceKey: decision.sourceKey,
          originalRemovalReasonCodes: decision.reasonCodes,
          removedAtSequence: planningRequest.recompositionSequence,
          removedFromWorkingSetId: decision.fromWorkingSetId
        })
      }
    }

    this.previousWorkingSet = plannerResult.workingSet

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

// Conservative live default: GENERAL phase, empty targets, no prose parsing.
function defaultPlanningRequest(
  runtimeSessionId: string,
  sequence: number,
  nativeContextEstimate: number,
  recentEvidenceSourceKeys: readonly string[],
  removalHistory: readonly RemovalRecord[],
  previousWorkingSetId: string | null
): ContextPlanningRequest {
  void nativeContextEstimate
  return {
    runtimeSessionId,
    recompositionSequence: sequence,
    taskPhase: 'GENERAL',
    budget: { maxSemanticTokens: 8000 },
    pinnedSourceKeys: [],
    excludedSourceKeys: [],
    currentTargetSourceKeys: [],
    latestVerificationSourceKeys: [],
    recentEvidenceSourceKeys,
    ...(removalHistory.length > 0 ? { removalHistory } : {}),
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

// Real Pi extension factory: runs the CR-001 observation seam, CR-002 Universe
// advancement, and CR-003A Shadow planning inside the `context` callback, and
// returns the ORIGINAL messages unchanged.
export function createShadowPlannerPiExtension(options: {
  readonly observer: ShadowPlannerObserver
}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on('context', async (event: ContextEvent) => {
      options.observer.observeModelCall(event.messages)
      return { messages: event.messages }
    })
  }
}

export type { ContextDecision }
