import { describe, expect, it } from 'vitest'
import {
  C1_ANALYSIS_STRATA,
  adjudicateC1Study,
  reportedC1AnalysisMetric,
  unavailableC1AnalysisMetric,
  type C1AnalysisLifecycleEvidence,
  type C1AnalysisLeg,
  type C1AnalysisPair,
  type C1AnalysisStudy
} from '../src'

const reported = reportedC1AnalysisMetric

const lifecycleByStratum: Record<(typeof C1_ANALYSIS_STRATA)[number], C1AnalysisLifecycleEvidence> =
  {
    localized_investigation_distractors: {
      removalPrecision: { status: 'ESTIMABLE', numerator: 1, denominator: 1 },
      rehydrationRecoveryRate: {
        status: 'NOT_ESTIMABLE',
        reason: 'no registered demand'
      },
      coldContextPenalty: {
        status: 'NOT_APPLICABLE',
        reason: 'T1 is not a delayed-recovery task'
      }
    },
    multi_file_multi_source: {
      removalPrecision: { status: 'ESTIMABLE', numerator: 1, denominator: 1 },
      rehydrationRecoveryRate: {
        status: 'NOT_ESTIMABLE',
        reason: 'no registered demand'
      },
      coldContextPenalty: {
        status: 'NOT_APPLICABLE',
        reason: 'T2 is not a delayed-recovery task'
      }
    },
    failure_diagnosis_recovery: {
      removalPrecision: {
        status: 'NOT_ESTIMABLE',
        reason: 'not eligible for T3'
      },
      rehydrationRecoveryRate: {
        status: 'NOT_ESTIMABLE',
        reason: 'not eligible for T3'
      },
      coldContextPenalty: {
        status: 'NOT_APPLICABLE',
        reason: 'T3 has no cold anchor'
      }
    },
    delayed_context_recovery: {
      removalPrecision: { status: 'ESTIMABLE', numerator: 1, denominator: 1 },
      rehydrationRecoveryRate: {
        status: 'ESTIMABLE',
        numerator: 1,
        denominator: 1
      },
      coldContextPenalty: {
        status: 'ESTIMABLE',
        native: { inputTokens: 100, toolCalls: 4, wallClockMs: 1000 },
        runtime: { inputTokens: 90, toolCalls: 3, wallClockMs: 900 },
        anchorA: 'wrong-path-triage-complete',
        anchorB: 'first-focused-oracle-after-parser-fix',
        runtimeOriginatingRemoveTransitionId: 't4-remove-evaluate',
        runtimeRehydrateTransitionId: 't4-rehydrate-evaluate',
        lineageValid: true
      }
    }
  }

function nativeLeg(
  inputTokens = 100,
  totalTokens = 150,
  toolCalls = 4,
  wallClockMs = 1000
): C1AnalysisLeg {
  return {
    arm: 'NATIVE',
    legStatus: 'COMPLETED',
    taskOutcome: 'SUCCESS',
    inputTokens: reported(inputTokens),
    outputTokens: reported(50),
    totalTokens: reported(totalTokens),
    toolCalls: reported(toolCalls),
    wallClockMs: reported(wallClockMs)
  }
}

function runtimeLeg(
  inputTokens = 70,
  totalTokens = 100,
  toolCalls = 3,
  wallClockMs = 900,
  overrides: Partial<C1AnalysisLeg> = {}
): C1AnalysisLeg {
  return {
    arm: 'RUNTIME',
    legStatus: 'COMPLETED',
    taskOutcome: 'SUCCESS',
    inputTokens: reported(inputTokens),
    outputTokens: reported(40),
    totalTokens: reported(totalTokens),
    toolCalls: reported(toolCalls),
    wallClockMs: reported(wallClockMs),
    runtimeTreatment: 'ACTIVE',
    ...overrides
  }
}

function completePairs(): C1AnalysisPair[] {
  return C1_ANALYSIS_STRATA.flatMap((stratum) =>
    Array.from({ length: 8 }, (_, index) => ({
      pairId: `${stratum}-p${String(index + 1).padStart(2, '0')}`,
      stratum,
      native: nativeLeg(),
      runtime: runtimeLeg(),
      lifecycle: lifecycleByStratum[stratum]
    }))
  )
}

function studyFrom(
  pairs: readonly C1AnalysisPair[],
  overrides: Partial<C1AnalysisStudy> = {}
): C1AnalysisStudy {
  return {
    studyStatus: 'COMPLETED',
    pairs,
    ...overrides
  }
}

describe('C1 offline adjudicator', () => {
  it('selects BETTER only when primary, outcome, coverage, reliability, and secondary gates pass', () => {
    const result = adjudicateC1Study(studyFrom(completePairs()))

    expect(result.overallDecision).toBe('BETTER')
    expect(result.analysisStatus).toBe('COMPLETE')
    expect(result.primary.status).toBe('ESTIMABLE')
    expect(result.primary.pooledEligiblePairs).toBe(32)
    expect(result.primary.pooledMedianReduction).toBeCloseTo(0.3)
    expect(result.primary.fisherCombinedPValue).toBeLessThan(0.05)
    expect(result.reliability).toMatchObject({
      nativeInvalidLegs: 0,
      runtimeInvalidLegs: 0,
      betterInvalidLegGatePass: true
    })
    expect(
      result.lifecycle.find((item) => item.endpointId === 'rehydration_recovery_rate')
    ).toMatchObject({
      status: 'ESTIMABLE',
      numerator: 8,
      denominator: 8
    })
    expect(result.providerCalls).toBe(0)
    expect(result.networkRequests).toBe(0)
  })

  it('selects TRADE_OFF for a qualifying primary gain with a protected secondary regression', () => {
    const pairs = completePairs().map((pair) => ({
      ...pair,
      runtime: runtimeLeg(70, 210, 3, 900)
    }))
    const result = adjudicateC1Study(studyFrom(pairs))

    expect(result.overallDecision).toBe('TRADE_OFF')
    expect(result.primary.qualifies).toBe(true)
    expect(
      result.secondary.find((item) => item.endpointId === 'provider_total_tokens')
    ).toMatchObject({
      materialRegression: true
    })
  })

  it('selects WORSE when Runtime task failures cross the frozen non-inferiority bound', () => {
    const pairs = completePairs().map((pair, index) =>
      index < 3
        ? {
            ...pair,
            runtime: runtimeLeg(70, 100, 3, 900, { taskOutcome: 'FAILURE' })
          }
        : pair
    )
    const result = adjudicateC1Study(studyFrom(pairs))

    expect(result.overallDecision).toBe('WORSE')
    expect(result.outcomes).toMatchObject({
      runtimeTaskFailures: 3,
      additionalRuntimeFailures: 3,
      nonInferiorityPass: false
    })
    expect(result.reliability.runtimeInvalidLegs).toBe(0)
  })

  it('selects TRADE_OFF, rather than treating a tolerated task failure as infrastructure attrition', () => {
    const pairs = completePairs().map((pair, index) =>
      index === 0
        ? {
            ...pair,
            runtime: runtimeLeg(70, 100, 3, 900, { taskOutcome: 'FAILURE' })
          }
        : pair
    )
    const result = adjudicateC1Study(studyFrom(pairs))

    expect(result.overallDecision).toBe('TRADE_OFF')
    expect(result.outcomes.additionalRuntimeTaskFailure).toBe(true)
    expect(result.reliability.runtimeInvalidLegs).toBe(0)
  })

  it('counts missing core usage as evidence attrition without converting task outcome to failure', () => {
    const pairs = completePairs().map((pair) =>
      pair.stratum === C1_ANALYSIS_STRATA[0] && Number(pair.pairId.slice(-2)) <= 3
        ? {
            ...pair,
            runtime: runtimeLeg(70, 100, 3, 900, {
              inputTokens: unavailableC1AnalysisMetric('NOT_REPORTED_BY_PROVIDER')
            })
          }
        : pair
    )
    const result = adjudicateC1Study(studyFrom(pairs))

    expect(result.overallDecision).toBe('WORSE')
    expect(result.outcomes.runtimeTaskFailures).toBe(0)
    expect(result.outcomes.additionalRuntimeFailures).toBe(0)
    expect(result.reliability).toMatchObject({
      runtimeInvalidLegs: 3,
      runtimeEvidenceAttrition: 3
    })
    expect(result.primary.status).toBe('NOT_ESTIMABLE')
    expect(result.primary.strata[0]).toMatchObject({
      eligiblePairs: 5,
      minimumCoveragePass: false,
      exclusions: expect.arrayContaining([
        expect.objectContaining({ reason: 'INPUT_USAGE_UNAVAILABLE' })
      ])
    })
  })

  it('blocks BETTER when missing core usage is spread across two Runtime strata', () => {
    const pairs = completePairs().map((pair) => {
      const missingRuntimeUsage =
        (pair.stratum === C1_ANALYSIS_STRATA[0] && pair.pairId.endsWith('01')) ||
        (pair.stratum === C1_ANALYSIS_STRATA[1] && pair.pairId.endsWith('01'))
      return missingRuntimeUsage
        ? {
            ...pair,
            runtime: runtimeLeg(70, 100, 3, 900, {
              inputTokens: unavailableC1AnalysisMetric('NOT_REPORTED_BY_PROVIDER')
            })
          }
        : pair
    })
    const result = adjudicateC1Study(studyFrom(pairs))

    expect(result.overallDecision).toBe('INCONCLUSIVE')
    expect(result.outcomes.runtimeTaskFailures).toBe(0)
    expect(result.reliability).toMatchObject({
      runtimeInvalidLegs: 2,
      runtimeEvidenceAttrition: 2,
      runtimeOperationalSuccessMinimumPass: false,
      betterInvalidLegGatePass: false
    })
    expect(result.primary.strata[0]?.eligiblePairs).toBe(7)
    expect(result.primary.strata[1]?.eligiblePairs).toBe(7)
  })

  it('computes protected secondary endpoints from paired differences', () => {
    const nativeToolCalls = [170, 125, 65, 188, 114, 182, 152, 5]
    const runtimeToolCalls = [190, 50, 85, 208, 46, 156, 172, 25]
    const pairs = completePairs().map((pair, index) => {
      const profileIndex = index % nativeToolCalls.length
      const nativeToolCallsValue = nativeToolCalls[profileIndex]
      const runtimeToolCallsValue = runtimeToolCalls[profileIndex]
      if (nativeToolCallsValue === undefined || runtimeToolCallsValue === undefined) {
        throw new Error('secondary profile is incomplete')
      }
      return {
        ...pair,
        native: nativeLeg(100, 150, nativeToolCallsValue, 1000),
        runtime: runtimeLeg(70, 100, runtimeToolCallsValue, 900)
      }
    })
    const result = adjudicateC1Study(studyFrom(pairs))
    const toolEndpoint = result.secondary.find((item) => item.endpointId === 'tool_calls')

    expect(toolEndpoint).toMatchObject({
      status: 'ESTIMABLE',
      eligiblePairs: 32,
      nativeMedian: 138.5,
      runtimeMedian: 120.5,
      pairedMedianDifference: 20,
      materialRegression: false
    })
    expect(toolEndpoint?.pairedMedianRelativeIncrease).toBeCloseTo(20 / 138.5)
  })

  it('uses the Native median denominator for tool-call regression guards', () => {
    const nativeToolCalls = [1, 1, 1, 1, 90, 90, 90, 90]
    const runtimeToolCalls = nativeToolCalls.map((value) => value + 3)
    const pairs = completePairs().map((pair, index) => {
      const profileIndex = index % nativeToolCalls.length
      const nativeToolCallsValue = nativeToolCalls[profileIndex]
      const runtimeToolCallsValue = runtimeToolCalls[profileIndex]
      if (nativeToolCallsValue === undefined || runtimeToolCallsValue === undefined) {
        throw new Error('tool-call denominator profile is incomplete')
      }
      return {
        ...pair,
        native: nativeLeg(100, 150, nativeToolCallsValue, 1000),
        runtime: runtimeLeg(70, 100, runtimeToolCallsValue, 900)
      }
    })
    const result = adjudicateC1Study(studyFrom(pairs))
    const toolEndpoint = result.secondary.find((item) => item.endpointId === 'tool_calls')

    expect(toolEndpoint).toMatchObject({
      status: 'ESTIMABLE',
      nativeMedian: 45.5,
      runtimeMedian: 48.5,
      pairedMedianDifference: 3,
      pairedMedianRelativeIncrease: 3 / 45.5,
      materialRegression: false
    })
  })

  it('keeps Cold Context Penalty signed and expressed in physical units', () => {
    const pairs = completePairs().map((pair) =>
      pair.stratum === 'delayed_context_recovery'
        ? {
            ...pair,
            lifecycle: {
              ...pair.lifecycle,
              coldContextPenalty: {
                status: 'ESTIMABLE' as const,
                native: { inputTokens: 100, toolCalls: 4, wallClockMs: 1000 },
                runtime: {
                  inputTokens: 5100,
                  toolCalls: 100,
                  wallClockMs: 500000
                },
                anchorA: 'wrong-path-triage-complete',
                anchorB: 'first-focused-oracle-after-parser-fix',
                runtimeOriginatingRemoveTransitionId: 't4-remove-evaluate',
                runtimeRehydrateTransitionId: 't4-rehydrate-evaluate',
                lineageValid: true as const
              }
            }
          }
        : pair
    )
    const result = adjudicateC1Study(studyFrom(pairs))
    const endpoint = result.lifecycle.find((item) => item.endpointId === 'cold_context_penalty')

    expect(endpoint).toMatchObject({
      status: 'ESTIMABLE',
      eligiblePairs: 8,
      medianInputTokenDelta: 5000,
      medianToolCallDelta: 96,
      medianWallClockDeltaMs: 499000
    })
  })

  it('excludes a zero Native denominator without producing NaN or changing the raw pair evidence', () => {
    const pairs = completePairs().map((pair, index) =>
      index === 0 ? { ...pair, native: nativeLeg(0, 150, 4, 1000) } : pair
    )
    const result = adjudicateC1Study(studyFrom(pairs))
    const firstStratum = result.primary.strata[0]

    expect(firstStratum).toMatchObject({
      eligiblePairs: 7,
      betterCoveragePass: true,
      exclusions: [
        {
          pairId: expect.stringContaining('localized_investigation_distractors'),
          reason: 'NATIVE_DENOMINATOR_ZERO'
        }
      ]
    })
    expect(result.primary.pooledMedianReduction).not.toBeNaN()
  })

  it('treats two invalid Runtime legs as operational INCONCLUSIVE and preserves their classification', () => {
    const pairs = completePairs().map((pair, index) =>
      index < 2
        ? {
            ...pair,
            runtime: runtimeLeg(70, 100, 3, 900, {
              legStatus: 'ABORTED',
              taskOutcome: 'NOT_OBSERVED'
            })
          }
        : pair
    )
    const result = adjudicateC1Study(studyFrom(pairs))

    expect(result.overallDecision).toBe('INCONCLUSIVE')
    expect(result.failureClassification).toBe('INFRASTRUCTURE_FAILURE')
    expect(result.reliability).toMatchObject({
      runtimeInvalidLegs: 2,
      runtimeOperationalSuccessMinimumPass: false
    })
  })

  it('keeps a stopped study terminal and never converts lifecycle NOT_ESTIMABLE to zero', () => {
    const pairs = completePairs()
      .slice(0, 1)
      .map((pair) => ({
        ...pair,
        runtime: runtimeLeg(70, 100, 3, 900, {
          legStatus: 'STOPPED',
          taskOutcome: 'NOT_OBSERVED'
        })
      }))
    const result = adjudicateC1Study(
      studyFrom(pairs, {
        studyStatus: 'STOPPED'
      })
    )

    expect(result.overallDecision).toBe('INCONCLUSIVE')
    expect(result.failureClassification).toBe('STUDY_STOPPED')
    expect(result.primary.status).toBe('NOT_ESTIMABLE')
    expect(
      result.lifecycle.find((item) => item.endpointId === 'rehydration_recovery_rate')
    ).toMatchObject({
      status: 'NOT_ESTIMABLE',
      numerator: null,
      denominator: null,
      value: null
    })
  })

  it('returns INCONCLUSIVE rather than selecting an endpoint when the frozen primary region is not met', () => {
    const pairs = completePairs().map((pair) => ({
      ...pair,
      runtime: runtimeLeg(100, 150, 4, 1000)
    }))
    const result = adjudicateC1Study(studyFrom(pairs))

    expect(result.overallDecision).toBe('INCONCLUSIVE')
    expect(result.primary.qualifies).toBe(false)
    expect(result.decisionReasons).toContain('the frozen primary decision region was not selected')
  })
})
