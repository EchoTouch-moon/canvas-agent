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
}

export function computeShadowMetrics(input: {
  readonly modelCallSequence: number
  readonly universeSequence: number
  readonly universeHash: string
  readonly nativeContextEstimate: number
  readonly workingSet: ContextWorkingSet
  readonly decisions: readonly ContextDecision[]
}): ShadowPlanningMetrics {
  let add = 0
  let keep = 0
  let remove = 0
  let rehydrate = 0
  let replace = 0
  let compress = 0
  const reasonCodeCounts: Record<string, number> = {}
  for (const decision of input.decisions) {
    if (decision.kind === 'ADD') add += 1
    else if (decision.kind === 'KEEP') keep += 1
    else if (decision.kind === 'REMOVE') remove += 1
    else if (decision.kind === 'REHYDRATE') rehydrate += 1
    else if (decision.kind === 'REPLACE') replace += 1
    else if (decision.kind === 'COMPRESS') compress += 1
    for (const reason of decision.reasonCodes) {
      reasonCodeCounts[reason] = (reasonCodeCounts[reason] ?? 0) + 1
    }
  }
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
    reasonCodeCounts
  }
}
