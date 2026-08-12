import { planWorkingSet, sha256Hex, type ContextRepresentation } from '@canvas-agent/context-runtime'
import type {
  AggregateResult,
  BenchmarkRunRecord,
  FalseRemovalCandidate,
  RehydrationObservation,
  ShadowCallEvidence
} from './types'
import { BENCHMARK_CATEGORIES, type BenchmarkCategory } from './types'

interface RemovalEvidence {
  readonly sourceKey: string
  readonly sequence: number
  readonly reasonCodes: readonly string[]
}

function emptyCategoryCounts(): Record<BenchmarkCategory, { native: number; shadow: number }> {
  return {
    'C1-localized-bug-fix': { native: 0, shadow: 0 },
    'C2-multi-file-feature': { native: 0, shadow: 0 },
    'C3-failing-test-diagnosis': { native: 0, shadow: 0 },
    'C4-constrained-refactor': { native: 0, shadow: 0 },
    'C5-unrelated-discovery': { native: 0, shadow: 0 },
    'C6-wrong-path-rehydration': { native: 0, shadow: 0 }
  }
}

function isValidRun(run: BenchmarkRunRecord): boolean {
  return (
    run.status === 'VALID' &&
    run.objectiveOracle.passed &&
    run.regressionOracle.passed &&
    run.acceptanceCriteriaPassed &&
    run.acceptanceCriteriaResults.length > 0 &&
    run.acceptanceCriteriaResults.every((criterion) => criterion.passed) &&
    run.originalMessagesUnchanged &&
    run.writablePathsValid &&
    !run.rawProviderPayloadsCaptured
  )
}

function sourceMatchesAccess(sourceKey: string, path: string): boolean {
  const prefix = 'repository/file://'
  const sourcePath = sourceKey.startsWith(prefix) ? sourceKey.slice(prefix.length) : sourceKey
  return path === sourceKey || path === sourcePath || path.endsWith(`/${sourcePath}`)
}

function sortedShadowCalls(run: BenchmarkRunRecord): readonly ShadowCallEvidence[] {
  return [...run.shadowCalls].sort((left, right) => left.sequence - right.sequence)
}

function deriveShadowEvidence(run: BenchmarkRunRecord): {
  readonly rehydrations: readonly RehydrationObservation[]
  readonly falseRemovalCandidates: readonly FalseRemovalCandidate[]
  readonly rehydratedWithin: { readonly within1: number; readonly within3: number; readonly within5: number }
  readonly readAfterRemoveCount: number
  readonly searchAfterRemoveCount: number
  readonly removedNeverNeededAgain: number
  readonly removedLaterNeeded: number
  readonly representationTransitions: {
    readonly fullToLineRange: number
    readonly lineRangeToFull: number
    readonly sourceVersionAdvancedReplace: number
  }
  readonly materializationFailures: readonly string[]
} {
  const removals = new Map<string, RemovalEvidence>()
  const neededAgain = new Set<string>()
  const rehydrations: RehydrationObservation[] = []
  const falseRemovalCandidates: FalseRemovalCandidate[] = []
  let readAfterRemoveCount = 0
  let searchAfterRemoveCount = 0
  let fullToLineRange = 0
  let lineRangeToFull = 0
  let sourceVersionAdvancedReplace = 0
  const materializationFailures: string[] = []
  const calls = sortedShadowCalls(run)

  for (const call of calls) {
    for (const decision of call.decisions) {
      if (decision.kind === 'REMOVE') {
        removals.set(decision.sourceKey, {
          sourceKey: decision.sourceKey,
          sequence: call.sequence,
          reasonCodes: decision.reasonCodes
        })
      } else if (decision.kind === 'REHYDRATE') {
        const removal = removals.get(decision.sourceKey)
        if (removal !== undefined && call.sequence > removal.sequence) {
          neededAgain.add(decision.sourceKey)
          rehydrations.push({
            taskId: run.taskId,
            runId: run.runId,
            sourceKey: decision.sourceKey,
            removalSequence: removal.sequence,
            rehydrateSequence: call.sequence,
            distance: call.sequence - removal.sequence,
            evidence: 'REHYDRATE'
          })
        }
      } else if (decision.kind === 'REPLACE') {
        if (decision.previousRepresentationKind === 'FULL' && decision.representationKind === 'LINE_RANGE') {
          fullToLineRange += 1
        }
        if (decision.previousRepresentationKind === 'LINE_RANGE' && decision.representationKind === 'FULL') {
          lineRangeToFull += 1
        }
        if (decision.reasonCodes.includes('SOURCE_VERSION_ADVANCED')) sourceVersionAdvancedReplace += 1
      }
    }
    for (const access of call.fileAccesses) {
      for (const removal of removals.values()) {
        // A tool read emitted after the Planner's REMOVE decision can belong to
        // the same semantic model call. Keep equality so the most important
        // same-call false-removal evidence is not discarded.
        if (call.sequence < removal.sequence || !sourceMatchesAccess(removal.sourceKey, access.path)) continue
        neededAgain.add(removal.sourceKey)
        if (access.kind === 'READ') readAfterRemoveCount += 1
        if (access.kind === 'SEARCH') searchAfterRemoveCount += 1
        falseRemovalCandidates.push({
          taskId: run.taskId,
          runId: run.runId,
          sourceKey: removal.sourceKey,
          removalSequence: removal.sequence,
          removalReasonCodes: removal.reasonCodes,
          nextAccessSequence: call.sequence,
          distance: call.sequence - removal.sequence,
          evidence: 'READ_AFTER_REMOVE',
          taskPassedAtObservation: run.objectiveOracle.passed,
          classification: 'INDETERMINATE'
        })
      }
    }
    materializationFailures.push(...call.materializationFailures.map((failure) => `${run.taskId}|${run.runId}|${failure}`))
  }

  const removedLaterNeeded = [...removals.keys()].filter((sourceKey) => neededAgain.has(sourceKey)).length

  return {
    rehydrations: rehydrations.sort((left, right) =>
      `${left.taskId}|${left.runId}|${left.sourceKey}|${left.rehydrateSequence}`.localeCompare(
        `${right.taskId}|${right.runId}|${right.sourceKey}|${right.rehydrateSequence}`
      )
    ),
    falseRemovalCandidates: falseRemovalCandidates.sort((left, right) =>
      `${left.taskId}|${left.runId}|${left.sourceKey}|${left.nextAccessSequence}`.localeCompare(
        `${right.taskId}|${right.runId}|${right.sourceKey}|${right.nextAccessSequence}`
      )
    ),
    rehydratedWithin: {
      within1: rehydrations.filter((entry) => entry.distance <= 1).length,
      within3: rehydrations.filter((entry) => entry.distance <= 3).length,
      within5: rehydrations.filter((entry) => entry.distance <= 5).length
    },
    readAfterRemoveCount,
    searchAfterRemoveCount,
    removedNeverNeededAgain: removals.size - removedLaterNeeded,
    removedLaterNeeded,
    representationTransitions: { fullToLineRange, lineRangeToFull, sourceVersionAdvancedReplace },
    materializationFailures: materializationFailures.sort()
  }
}

function sumNativeEstimate(run: BenchmarkRunRecord): number {
  return run.nativeCalls.reduce((sum, call) => sum + call.observedMessageTokenEstimate, 0)
}

function sumShadowEstimate(run: BenchmarkRunRecord): number {
  return run.shadowCalls.reduce((sum, call) => sum + call.proposedSemanticTokenEstimate, 0)
}

function roundMean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export function aggregateRuns(records: readonly BenchmarkRunRecord[]): AggregateResult {
  const byCategory = emptyCategoryCounts()
  const shadowDecisionCounts: Record<string, number> = {}
  const representationCounts: Record<string, number> = {}
  const rehydrations: RehydrationObservation[] = []
  const falseRemovalCandidates: FalseRemovalCandidate[] = []
  let rehydratedWithin1 = 0
  let rehydratedWithin3 = 0
  let rehydratedWithin5 = 0
  let readAfterRemoveCount = 0
  let searchAfterRemoveCount = 0
  let removedNeverNeededAgain = 0
  let removedLaterNeeded = 0
  let fullToLineRange = 0
  let lineRangeToFull = 0
  let sourceVersionAdvancedReplace = 0
  const materializationFailures: string[] = []
  const observationFailures: string[] = []
  const runIdsExcludedFromValidity: string[] = []
  const validRuns = records.filter(isValidRun)
  const nativeByPair = new Map<string, number[]>()
  const shadowByPair = new Map<string, number[]>()

  for (const record of records) {
    if (!isValidRun(record)) runIdsExcludedFromValidity.push(record.runId)
    observationFailures.push(...record.observationFailures.map((failure) => `${record.taskId}|${record.runId}|${failure}`))
  }
  for (const record of validRuns) {
    byCategory[record.category][record.strategy === 'NATIVE' ? 'native' : 'shadow'] += 1
    if (record.strategy === 'NATIVE') {
      const key = `${record.taskId}|${record.repetition}`
      const values = nativeByPair.get(key) ?? []
      values.push(sumNativeEstimate(record))
      nativeByPair.set(key, values)
    } else {
      const key = `${record.taskId}|${record.repetition}`
      const values = shadowByPair.get(key) ?? []
      values.push(sumShadowEstimate(record))
      shadowByPair.set(key, values)
      for (const call of record.shadowCalls) {
        for (const decision of call.decisions) {
          shadowDecisionCounts[decision.kind] = (shadowDecisionCounts[decision.kind] ?? 0) + 1
        }
        for (const [kind, count] of Object.entries(call.representationCounts)) {
          representationCounts[kind] = (representationCounts[kind] ?? 0) + count
        }
      }
      const evidence = deriveShadowEvidence(record)
      rehydrations.push(...evidence.rehydrations)
      falseRemovalCandidates.push(...evidence.falseRemovalCandidates)
      rehydratedWithin1 += evidence.rehydratedWithin.within1
      rehydratedWithin3 += evidence.rehydratedWithin.within3
      rehydratedWithin5 += evidence.rehydratedWithin.within5
      readAfterRemoveCount += evidence.readAfterRemoveCount
      searchAfterRemoveCount += evidence.searchAfterRemoveCount
      removedNeverNeededAgain += evidence.removedNeverNeededAgain
      removedLaterNeeded += evidence.removedLaterNeeded
      fullToLineRange += evidence.representationTransitions.fullToLineRange
      lineRangeToFull += evidence.representationTransitions.lineRangeToFull
      sourceVersionAdvancedReplace += evidence.representationTransitions.sourceVersionAdvancedReplace
      materializationFailures.push(...evidence.materializationFailures)
    }
  }

  const pairs = [...new Set([...nativeByPair.keys()].filter((key) => shadowByPair.has(key)))].sort()
  const nativeVsShadowEstimatePairs = pairs.map((key) => {
    const [taskId, repetitionText] = key.split('|')
    return {
      taskId: taskId ?? key,
      repetition: Number(repetitionText ?? 0),
      nativeEstimate: roundMean(nativeByPair.get(key) ?? []),
      shadowEstimate: roundMean(shadowByPair.get(key) ?? [])
    }
  })

  const totals = validRuns.reduce(
    (result, record) => {
      result.semanticCallCount += record.semanticCallCount
      result.toolCallCount += record.toolCallCount
      result.nativeEstimateTotal += sumNativeEstimate(record)
      result.shadowEstimateTotal += sumShadowEstimate(record)
      return result
    },
    { semanticCallCount: 0, toolCallCount: 0, nativeEstimateTotal: 0, shadowEstimateTotal: 0 }
  )

  return {
    totalRuns: records.length,
    validRuns: validRuns.length,
    skippedRuns: records.filter((record) => record.status === 'SKIPPED').length,
    abortedRuns: records.filter((record) => record.status === 'ABORTED').length,
    byCategory,
    semanticCallCount: totals.semanticCallCount,
    toolCallCount: totals.toolCallCount,
    nativeEstimateTotal: totals.nativeEstimateTotal,
    shadowEstimateTotal: totals.shadowEstimateTotal,
    shadowDecisionCounts,
    representationCounts,
    rehydrations,
    falseRemovalCandidates,
    runIdsExcludedFromValidity: runIdsExcludedFromValidity.sort(),
    nativeVsShadowEstimatePairs,
    rehydratedWithin: { within1: rehydratedWithin1, within3: rehydratedWithin3, within5: rehydratedWithin5 },
    readAfterRemoveCount,
    searchAfterRemoveCount,
    removedNeverNeededAgain,
    removedLaterNeeded,
    representationTransitions: { fullToLineRange, lineRangeToFull, sourceVersionAdvancedReplace },
    materializationFailureCount: materializationFailures.length,
    materializationFailures: materializationFailures.sort(),
    observationFailureCount: observationFailures.length,
    observationFailures: observationFailures.sort(),
    providerSavings: null
  }
}

export function replayShadowCallsHash(calls: readonly ShadowCallEvidence[]): string {
  const canonical = [...calls]
    .sort((left, right) => left.sequence - right.sequence)
    .map((call) => {
      if (call.universe.sequence !== call.universeSequence || call.universe.logicalHash !== call.universeHash) {
        throw new Error(`${call.sequence}: saved Universe identity mismatch`)
      }
      if (call.planningRequest.recompositionSequence !== call.sequence) {
        throw new Error(`${call.sequence}: saved PlanningRequest sequence mismatch`)
      }
      const representations = new Map<string, ContextRepresentation>(
        call.representations.map(({ sourceKey, representation }) => [sourceKey, representation])
      )
      const replayed = planWorkingSet({
        universe: call.universe,
        request: call.planningRequest,
        previousWorkingSet: call.previousWorkingSet,
        options: {
          policyVersion: call.policyVersion,
          createdAt: '2026-01-01T00:00:00.000Z',
          represent: (entry) => representations.get(entry.source.sourceKey) ?? null
        }
      })
      if (replayed.workingSet.workingSetId !== call.workingSetId) {
        throw new Error(`${call.sequence}: replay Working Set id mismatch`)
      }
      if (replayed.workingSet.logicalHash !== call.workingSetHash) {
        throw new Error(`${call.sequence}: replay Working Set hash mismatch`)
      }
      if (replayed.workingSet.planningRequestHash !== call.planningRequestHash) {
        throw new Error(`${call.sequence}: replay PlanningRequest hash mismatch`)
      }
      if (replayed.transition.logicalHash !== call.transitionHash) {
        throw new Error(`${call.sequence}: replay transition hash mismatch`)
      }
      return [
        call.sequence,
        call.universeSequence,
        call.universeHash,
        replayed.workingSet.workingSetId,
        replayed.workingSet.logicalHash,
        replayed.workingSet.planningRequestHash,
        replayed.transition.logicalHash,
        replayed.decisions.map((decision) => decision.decisionId).join(';')
      ].join('\u241f')
    })
    .join('\n')
  return sha256Hex(`shadow-planner-replay-v1|${canonical}`)
}

export function replayShadowEvidenceHash(run: BenchmarkRunRecord): string {
  return replayShadowCallsHash(run.shadowCalls)
}

export function allCategoriesHaveNativeAndShadow(aggregate: AggregateResult): boolean {
  return BENCHMARK_CATEGORIES.every((category) => {
    const counts = aggregate.byCategory[category]
    return counts.native > 0 && counts.shadow > 0
  })
}
