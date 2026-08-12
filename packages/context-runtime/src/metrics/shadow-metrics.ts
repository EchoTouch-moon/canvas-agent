import type { ContextDecision, ContextWorkingSet } from '../working-set/working-set-types'

// EXPERIMENTAL bounded Shadow metrics for one planning boundary. Native CR-001
// estimate stays scoped to `agent-messages-pre-provider`; the proposed Shadow
// Working Set estimate is a separate semantic planning metric. No provider
// billing is claimed.

export interface ShadowPlanningMetrics {
  readonly modelCallSequence: number
  readonly universeSequence: number
  readonly universeHash: string
  readonly nativeContextEstimate: number
  readonly nativeEstimateScope: 'agent-messages-pre-provider'
  readonly workingSetId: string
  readonly proposedSemanticTokenEstimate: number
  readonly add: number
  readonly keep: number
  readonly remove: number
  readonly rehydrate: number
  readonly replace: number
  readonly compress: number
  readonly churn: number
  readonly reasonCodeCounts: Record<string, number>
  // File-aware representation accounting (DS-012 / CR-003B).
  readonly representationCounts: {
    readonly full: number
    readonly lineRange: number
    readonly reference: number
  }
  // Representation-only token delta: sum of REPLACE tokenDelta across
  // representation transitions (membership ADD/REMOVE is NOT included, so this
  // measures FULL->LINE_RANGE savings / LINE_RANGE->FULL re-expansion / stale
  // replacements).
  readonly representationTokenDelta: number
  readonly representationDeltaBreakdown: {
    readonly narrowed: number
    readonly detailed: number
    readonly sourceVersionAdvanced: number
  }
}

export function computeShadowMetrics(input: {
  readonly modelCallSequence: number
  readonly universeSequence: number
  readonly universeHash: string
  readonly nativeContextEstimate: number
  readonly workingSet: ContextWorkingSet
  readonly decisions: readonly ContextDecision[]
  // Previous working set token total (deprecated for representation delta;
  // retained for callers that still want total WS delta).
  readonly previousTokenEstimate?: number
}): ShadowPlanningMetrics {
  let add = 0
  let keep = 0
  let remove = 0
  let rehydrate = 0
  let replace = 0
  let compress = 0
  const reasonCodeCounts: Record<string, number> = {}
  // Representation-only accounting: accumulate REPLACE tokenDelta and classify
  // by the leading representation reason.
  let representationTokenDelta = 0
  let narrowed = 0
  let detailed = 0
  let sourceVersionAdvanced = 0
  for (const decision of input.decisions) {
    if (decision.kind === 'ADD') add += 1
    else if (decision.kind === 'KEEP') keep += 1
    else if (decision.kind === 'REMOVE') remove += 1
    else if (decision.kind === 'REHYDRATE') rehydrate += 1
    else if (decision.kind === 'REPLACE') {
      replace += 1
      representationTokenDelta += decision.tokenDelta
      if (decision.reasonCodes.includes('SOURCE_VERSION_ADVANCED')) sourceVersionAdvanced += 1
      else if (decision.reasonCodes.includes('REPRESENTATION_NARROWED')) narrowed += 1
      else if (decision.reasonCodes.includes('DETAIL_REQUIRED')) detailed += 1
    }
    else if (decision.kind === 'COMPRESS') compress += 1
    for (const reason of decision.reasonCodes) {
      reasonCodeCounts[reason] = (reasonCodeCounts[reason] ?? 0) + 1
    }
  }
  let full = 0
  let lineRange = 0
  let reference = 0
  for (const item of input.workingSet.items) {
    const kind = item.representationKind
    if (kind === 'FULL') full += 1
    else if (kind === 'LINE_RANGE') lineRange += 1
    else if (kind === 'REFERENCE') reference += 1
  }
  void input.previousTokenEstimate
  return {
    modelCallSequence: input.modelCallSequence,
    universeSequence: input.universeSequence,
    universeHash: input.universeHash,
    nativeContextEstimate: input.nativeContextEstimate,
    nativeEstimateScope: 'agent-messages-pre-provider',
    workingSetId: input.workingSet.workingSetId,
    proposedSemanticTokenEstimate: input.workingSet.totalTokenEstimate,
    add,
    keep,
    remove,
    rehydrate,
    replace,
    compress,
    churn: add + remove + rehydrate,
    reasonCodeCounts,
    representationCounts: { full, lineRange, reference },
    representationTokenDelta,
    representationDeltaBreakdown: { narrowed, detailed, sourceVersionAdvanced }
  }
}
