import {
  computeShadowMetrics,
  createRepresentation,
  planWorkingSet,
  type ContextPlanningRequest,
  type ContextRepresentationNeed,
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
    // Normalized representation needs built BEFORE the request so the
    // planningRequestHash deterministically includes them.
    readonly representationNeeds: readonly ContextRepresentationNeed[]
  }) => ContextPlanningRequest
  // Optional CR-003B file-aware materialization seam. When provided, repository
  // /file entries are materialized into FULL / LINE_RANGE / REFERENCE
  // representations before the synchronous Planner runs. When absent, the
  // default REFERENCE-only behavior is preserved (prior behavior).
  readonly representationProvider?: (input: {
    readonly entry: ContextUniverseEntry
    readonly need: ContextRepresentationNeed
  }) => Promise<ContextRepresentation | null>
  // Repository/file path candidates observed for this boundary (from explicit
  // harness config or hints). Provider-neutral; used to build representation
  // needs.
  readonly filePathCandidates?: readonly string[]
}

export interface ShadowPlannerCallResult {
  readonly enrichedResult: EnrichedShadowResult
  readonly planningRequest: ContextPlanningRequest
  readonly plannerResult: PlannerResult
  readonly metrics: ShadowPlanningMetrics
  // Fail-safe materialization record: sourceKeys + reasons that fell back to
  // REFERENCE during this boundary (empty when all materializations succeeded
  // or no file-aware provider is configured).
  readonly materializationFailures: readonly string[]
}

export class ShadowPlannerObserver {
  private readonly enriched: EnrichedPiShadowObserver
  private readonly policyVersion: string
  private readonly makePlanningRequest: NonNullable<ShadowPlannerObserverOptions['makePlanningRequest']>
  private readonly representationProvider: ShadowPlannerObserverOptions['representationProvider']
  private readonly filePathCandidates: readonly string[]
  private previousWorkingSet: ContextWorkingSet | null = null
  private readonly removalHistoryBySource = new Map<string, RemovalRecord>()
  readonly callResults: readonly ShadowPlannerCallResult[]

  constructor(options: ShadowPlannerObserverOptions) {
    this.enriched = options.enriched
    this.policyVersion = options.policyVersion ?? 'policy-v0'
    this.callResults = []
    this.representationProvider = options.representationProvider
    this.filePathCandidates = options.filePathCandidates ?? []
    this.makePlanningRequest =
      options.makePlanningRequest ??
      ((input) => defaultPlanningRequest(input.runtimeSessionId, input.sequence, input.nativeContextEstimate, input.recentEvidenceSourceKeys, input.removalHistory, input.previousWorkingSetId, input.representationNeeds))
  }

  get runtimeSessionId(): string {
    return this.enriched.runtimeSessionId
  }

  async observeModelCall(messages: readonly PiMessageView[]): Promise<ShadowPlannerCallResult> {
    const enrichedResult = this.enriched.observeModelCall(messages)
    const universe = enrichedResult.universeRevision

    // Build normalized representation needs FIRST so they participate in the
    // planningRequestHash deterministically (P1-1). Duplicate sourceKeys are
    // rejected so input ordering cannot change semantics (P2-2).
    const representationNeeds = buildRepresentationNeeds(this.filePathCandidates)
    const needsList = [...representationNeeds.values()]

    const removalHistory = [...this.removalHistoryBySource.values()]
    const customRequest = this.makePlanningRequest({
      runtimeSessionId: this.runtimeSessionId,
      sequence: universe.modelCallSequence ?? enrichedResult.universeRevision.sequence,
      universe,
      previousWorkingSetId: this.previousWorkingSet?.workingSetId ?? null,
      nativeContextEstimate: enrichedResult.nativeContextEstimate,
      recentEvidenceSourceKeys: enrichedResult.recentEvidenceSourceKeys,
      removalHistory,
      representationNeeds: needsList
    })

    // CENTRAL enforcement (PR #22 final P1): the final PlanningRequest that
    // drives planningRequestHash and the Planner MUST carry EXACTLY the same
    // normalized representation needs that materialization will use. A custom
    // builder that omits or diverges representationNeeds must not produce a
    // hash that disagrees with the actual representation selection. We
    // centrally force the needs onto the final request so the invariant cannot
    // be violated by any caller-supplied builder.
    const finalRequest: ContextPlanningRequest = {
      ...customRequest,
      representationNeeds: needsList
    }
    const planningRequest = finalRequest

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

    // CR-003B file-aware materialization phase (async, before the synchronous
    // Planner). Uses the SAME normalized needs that entered the request hash.
    // Fail-safe: any throw from the provider is caught, recorded, and falls back
    // to the default REFERENCE representation so native Pi messages are never
    // corrupted (P1-4).
    const preparedRepresentations = new Map<string, ContextRepresentation>()
    const materializationFailures: string[] = []
    if (this.representationProvider !== undefined) {
      for (const entry of universe.entries) {
        if (entry.admittedVersion === null) continue
        const need = representationNeeds.get(entry.source.sourceKey)
        if (need === undefined) continue
        try {
          const representation = await this.representationProvider({ entry, need })
          if (representation !== null) {
            preparedRepresentations.set(entry.source.sourceKey, representation)
          } else {
            materializationFailures.push(`${entry.source.sourceKey}:null`)
          }
        } catch (error) {
          materializationFailures.push(`${entry.source.sourceKey}:${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    const plannerResult = planWorkingSet({
      universe,
      request: planningRequest,
      previousWorkingSet: this.previousWorkingSet,
      options: {
        policyVersion: this.policyVersion,
        createdAt: new Date().toISOString(),
        represent: (entry) => {
          const prepared = preparedRepresentations.get(entry.source.sourceKey)
          if (prepared !== undefined) return prepared
          return representUniverseEntry(entry)
        }
      }
    })

    const metrics = computeShadowMetrics({
      modelCallSequence: planningRequest.recompositionSequence,
      universeSequence: universe.sequence,
      universeHash: universe.logicalHash,
      nativeContextEstimate: enrichedResult.nativeContextEstimate,
      workingSet: plannerResult.workingSet,
      decisions: plannerResult.decisions,
      previousTokenEstimate: this.previousWorkingSet?.totalTokenEstimate ?? 0
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
      metrics,
      materializationFailures
    }
    ;(this.callResults as ShadowPlannerCallResult[]).push(result)
    return result
  }
}

// Build normalized representation needs for repository/file candidates. The
// default is FULL detail (DETAIL_REQUIRED); adapters/harness config may override
// by supplying a richer need map. Provider-neutral; no path-suffix parsing here.
// A sourceKey may appear at most once across candidates+overrides; duplicates
// are rejected so input order cannot change semantics (P2-2).
export function buildRepresentationNeeds(
  filePathCandidates: readonly string[],
  overrides: readonly ContextRepresentationNeed[] = []
): Map<string, ContextRepresentationNeed> {
  const needs = new Map<string, ContextRepresentationNeed>()
  for (const path of filePathCandidates) {
    const sourceKey = `repository/file://${path}`
    if (needs.has(sourceKey)) {
      throw new Error(`duplicate representation need for ${sourceKey}`)
    }
    needs.set(sourceKey, {
      sourceKey,
      preferredKind: 'FULL',
      reasonCode: 'DETAIL_REQUIRED'
    })
  }
  for (const override of overrides) {
    if (needs.has(override.sourceKey)) {
      throw new Error(`duplicate representation need for ${override.sourceKey}`)
    }
    needs.set(override.sourceKey, override)
  }
  return needs
}

// Conservative live default: GENERAL phase, empty targets, no prose parsing.
function defaultPlanningRequest(
  runtimeSessionId: string,
  sequence: number,
  nativeContextEstimate: number,
  recentEvidenceSourceKeys: readonly string[],
  removalHistory: readonly RemovalRecord[],
  previousWorkingSetId: string | null,
  representationNeeds: readonly ContextRepresentationNeed[]
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
    ...(representationNeeds.length > 0 ? { representationNeeds } : {}),
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
      await options.observer.observeModelCall(event.messages)
      return { messages: event.messages }
    })
  }
}

export type { ContextDecision }
