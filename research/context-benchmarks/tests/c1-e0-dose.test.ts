import { describe, expect, it } from 'vitest'
import {
  C1_E0_DOSE_SCHEMA_ID,
  aggregateC1E0Dose,
  assertC1E0RuntimePolicyInput,
  classifyC1E0ResponseEvidence,
  evaluateC1E0BatchQualification,
  evaluateC1E0ReadinessScenario,
  evaluateC1E0TreatmentIntegrity,
  shouldRunC1E0Counterpart,
  validateC1E0DoseObservation
} from '../src'
import type { C1E0DoseObservation, C1E0DoseSummary, C1E0RuntimePolicyInput } from '../src'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const REMOVED_CALL = 'run/tool-call://pair-01'
const REMOVED_RESULT = 'run/tool-result://pair-01'

function observation(overrides: Partial<C1E0DoseObservation> = {}): C1E0DoseObservation {
  return {
    schemaId: C1_E0_DOSE_SCHEMA_ID,
    schemaVersion: 1,
    experimentPairId: 'pair-01',
    callOrdinal: 1,
    prePolicyProviderBoundMessagesHash: HASH_A,
    postPolicyProviderBoundMessagesHash: HASH_B,
    uniqueEligiblePairIds: ['pair-01'],
    uniqueSelectedPairIds: ['pair-01'],
    uniqueRemovedPairIds: ['pair-01'],
    uniqueRemovedSourceElementKeys: [REMOVED_CALL, REMOVED_RESULT],
    newRemovalPairIds: ['pair-01'],
    carriedRemovalPairIds: [],
    suppressedStalePairIds: ['pair-01'],
    suppressedStalePairCallExposures: 1,
    suppressedSourceElementCallExposures: 2,
    tokensBeforeComposition: 100,
    tokensAfterComposition: 80,
    removedBytes: 80,
    removedTokens: 20,
    activeStaleElements: 1,
    rehydrateCount: 0,
    lifecycleUnknownCountByReason: {},
    protectedRemovalCount: 0,
    contractConflictCount: 0,
    runtimeContextChanged: true,
    ...overrides
  }
}

function summaryWith(overrides: Partial<C1E0DoseSummary> = {}): C1E0DoseSummary {
  return {
    ...aggregateC1E0Dose([observation()]),
    ...overrides
  }
}

function inactiveSummary(overrides: Partial<C1E0DoseSummary> = {}): C1E0DoseSummary {
  return summaryWith({
    runtimeContextChangedCalls: 0,
    uniqueEligiblePairs: [],
    uniqueSelectedPairs: [],
    uniqueRemovedPairs: [],
    uniqueRemovedSourceElements: [],
    treatmentExposureRatio: 0,
    ...overrides
  })
}

function emptyRuntimePolicyInput(): Record<string, unknown> {
  return {
    modelVisibleMessages: [],
    toolRequests: [],
    toolExecutionResults: [],
    versionProbeFingerprints: {},
    runtimeTransitionEvidence: [],
    carriedRemovalEvidence: []
  }
}

function unsafeRuntimePolicyInput(value: unknown): C1E0RuntimePolicyInput {
  return value as C1E0RuntimePolicyInput
}

describe('C1 E0 dose schema', () => {
  it('counts one removed pair once while preserving source-key cardinality', () => {
    const summary = aggregateC1E0Dose([observation()])

    expect(summary.uniqueEligiblePairs).toEqual(['pair-01'])
    expect(summary.experimentPairId).toBe('pair-01')
    expect(summary.uniqueSelectedPairs).toEqual(['pair-01'])
    expect(summary.uniqueRemovedPairs).toEqual(['pair-01'])
    expect(summary.uniqueRemovedSourceElements).toEqual([REMOVED_CALL, REMOVED_RESULT])
    expect(summary.newRemovalPairCalls).toBe(1)
    expect(summary.carriedRemovalPairCalls).toBe(0)
    expect(summary.suppressedStalePairCallExposures).toBe(1)
    expect(summary.suppressedSourceElementCallExposures).toBe(2)
    expect(summary.treatmentExposureRatio).toBe(1)
    expect(summary.removedTokenRatio).toBe(0.2)
  })

  it('keeps unique=1 while carried and suppressed exposures grow across calls', () => {
    const rows = [
      observation({ callOrdinal: 1 }),
      observation({
        callOrdinal: 2,
        prePolicyProviderBoundMessagesHash: HASH_B,
        postPolicyProviderBoundMessagesHash: HASH_C,
        newRemovalPairIds: [],
        carriedRemovalPairIds: ['pair-01']
      }),
      observation({
        callOrdinal: 3,
        prePolicyProviderBoundMessagesHash: HASH_C,
        postPolicyProviderBoundMessagesHash: HASH_A,
        newRemovalPairIds: [],
        carriedRemovalPairIds: ['pair-01']
      })
    ]
    const summary = aggregateC1E0Dose(rows)

    expect(summary.uniqueRemovedPairs).toHaveLength(1)
    expect(summary.uniqueRemovedSourceElements).toHaveLength(2)
    expect(summary.newRemovalPairCalls).toBe(1)
    expect(summary.carriedRemovalPairCalls).toBe(2)
    expect(summary.suppressedStalePairCallExposures).toBe(3)
    expect(summary.suppressedSourceElementCallExposures).toBe(6)
    expect(summary.runtimeOutboundCalls).toBe(3)
    expect(summary.runtimeContextChangedCalls).toBe(3)
  })

  it('retains no-eligible and UNKNOWN observations as non-treatment states', () => {
    const noEligible = aggregateC1E0Dose([
      observation({
        prePolicyProviderBoundMessagesHash: HASH_A,
        postPolicyProviderBoundMessagesHash: HASH_A,
        uniqueEligiblePairIds: [],
        uniqueSelectedPairIds: [],
        uniqueRemovedPairIds: [],
        uniqueRemovedSourceElementKeys: [],
        newRemovalPairIds: [],
        suppressedStalePairIds: [],
        suppressedStalePairCallExposures: 0,
        suppressedSourceElementCallExposures: 0,
        runtimeContextChanged: false
      })
    ])
    expect(noEligible.uniqueRemovedPairs).toEqual([])
    expect(noEligible.treatmentExposureRatio).toBe(0)
    expect(
      evaluateC1E0TreatmentIntegrity({
        dose: noEligible,
        replayVerdict: 'UNKNOWN',
        envelopePreserved: true,
        protectedEvidenceRemoved: false,
        noFallback: true,
        checkpointComplete: true
      }).verdict
    ).toBe('INACTIVE')

    const unknown = validateC1E0DoseObservation(
      observation({
        prePolicyProviderBoundMessagesHash: HASH_A,
        postPolicyProviderBoundMessagesHash: HASH_A,
        uniqueSelectedPairIds: [],
        uniqueRemovedPairIds: [],
        uniqueRemovedSourceElementKeys: [],
        newRemovalPairIds: [],
        suppressedStalePairIds: [],
        suppressedStalePairCallExposures: 0,
        suppressedSourceElementCallExposures: 0,
        lifecycleUnknownCountByReason: { AFTER_VERSION_UNOBSERVABLE: 1 },
        runtimeContextChanged: false
      })
    )
    expect(unknown.lifecycleUnknownCountByReason).toEqual({ AFTER_VERSION_UNOBSERVABLE: 1 })
    expect(unknown.uniqueRemovedPairIds).toEqual([])
  })

  it('rejects a broken pure-evict pair and a hash-equal claimed removal', () => {
    expect(() =>
      validateC1E0DoseObservation(observation({ uniqueRemovedSourceElementKeys: [REMOVED_CALL] }))
    ).toThrow(/exactly two source keys/)

    const hashEqual = summaryWith({
      runtimeContextChangedCalls: 0,
      uniqueRemovedPairs: ['pair-01'],
      uniqueRemovedSourceElements: [REMOVED_CALL, REMOVED_RESULT]
    })
    expect(
      evaluateC1E0TreatmentIntegrity({
        dose: hashEqual,
        replayVerdict: 'MATCH',
        envelopePreserved: true,
        protectedEvidenceRemoved: false,
        noFallback: true,
        checkpointComplete: true
      }).verdict
    ).toBe('FAIL')

    expect(() =>
      aggregateC1E0Dose([
        observation({
          carriedRemovalPairIds: ['pair-01'],
          newRemovalPairIds: []
        })
      ])
    ).toThrow(/no prior new removal/)

    expect(() =>
      validateC1E0DoseObservation(
        observation({ suppressedStalePairIds: [], suppressedStalePairCallExposures: 1 })
      )
    ).toThrow(/at most once/)
  })

  it('keeps experiment pair identity separate from lifecycle pair identity', () => {
    const first = observation({
      uniqueRemovedPairIds: ['lifecycle-a'],
      uniqueSelectedPairIds: ['lifecycle-a'],
      uniqueEligiblePairIds: ['lifecycle-a'],
      uniqueRemovedSourceElementKeys: ['run/tool-call://a', 'run/tool-result://a'],
      newRemovalPairIds: ['lifecycle-a'],
      suppressedStalePairIds: ['lifecycle-a']
    })
    const second = observation({
      callOrdinal: 2,
      experimentPairId: 'pair-02',
      prePolicyProviderBoundMessagesHash: HASH_B,
      postPolicyProviderBoundMessagesHash: HASH_C,
      uniqueRemovedPairIds: [],
      uniqueSelectedPairIds: [],
      uniqueEligiblePairIds: [],
      uniqueRemovedSourceElementKeys: [],
      newRemovalPairIds: [],
      suppressedStalePairIds: [],
      suppressedStalePairCallExposures: 0,
      suppressedSourceElementCallExposures: 0,
      runtimeContextChanged: true
    })
    expect(() => aggregateC1E0Dose([first, second])).toThrow(/one experiment pair/)
  })

  it('separates counterpart execution from experiment invalidation', () => {
    expect(shouldRunC1E0Counterpart('TASK_OUTCOME')).toBe(true)
    expect(shouldRunC1E0Counterpart('ISOLATED_HARNESS_FAILURE')).toBe(true)
    expect(shouldRunC1E0Counterpart('EXPERIMENT_INVALIDATOR')).toBe(false)
    expect(
      evaluateC1E0ReadinessScenario({
        scenarioId: 'native-task-failure',
        failureSignal: 'TASK_OUTCOME',
        expected: 'counterpart executes'
      })
    ).toMatchObject({ verdict: 'PASS', counterpartRuns: true })
    expect(
      evaluateC1E0ReadinessScenario({
        scenarioId: 'contract-conflict',
        failureSignal: 'EXPERIMENT_INVALIDATOR',
        expected: 'counterpart blocked'
      })
    ).toMatchObject({ verdict: 'PASS', counterpartRuns: false })
  })

  it('fails closed when ground truth appears in the Runtime policy input', () => {
    expect(() => assertC1E0RuntimePolicyInput({ changedPaths: [] })).toThrow(/allowlist/)
    expect(() =>
      assertC1E0RuntimePolicyInput({ ...emptyRuntimePolicyInput(), metadata: {} })
    ).toThrow(/allowlist/)
    expect(() =>
      assertC1E0RuntimePolicyInput({
        ...emptyRuntimePolicyInput(),
        modelVisibleMessages: [{ objectiveOracle: {} }]
      })
    ).toThrow(/ground-truth leakage/)
    expect(() => assertC1E0RuntimePolicyInput(emptyRuntimePolicyInput())).not.toThrow()
  })

  it('keeps a missing response unknown instead of substituting numeric zeroes', () => {
    expect(
      classifyC1E0ResponseEvidence({ responseRecorded: false, usageStatus: 'UNAVAILABLE' })
    ).toEqual({
      status: 'UNKNOWN',
      usage: 'UNKNOWN',
      zeroSubstitutionAllowed: false
    })
    expect(
      classifyC1E0ResponseEvidence({ responseRecorded: true, usageStatus: 'AVAILABLE' })
    ).toEqual({
      status: 'OBSERVED',
      usage: 'AVAILABLE',
      zeroSubstitutionAllowed: false
    })
    expect(
      classifyC1E0ResponseEvidence({ responseRecorded: true, usageStatus: 'UNAVAILABLE' })
    ).toEqual({
      status: 'OBSERVED',
      usage: 'UNAVAILABLE',
      zeroSubstitutionAllowed: false
    })
  })

  it('rejects a replay conflict or protected removal at the integrity layer', () => {
    const conflict = evaluateC1E0TreatmentIntegrity({
      dose: summaryWith({ contractConflictCount: 1 }),
      replayVerdict: 'CONTRACT_CONFLICT',
      envelopePreserved: true,
      protectedEvidenceRemoved: false,
      noFallback: true,
      checkpointComplete: true
    })
    expect(conflict.verdict).toBe('FAIL')
    expect(conflict.reasons.join(' ')).toMatch(/contract conflict/)

    const protectedFailure = evaluateC1E0TreatmentIntegrity({
      dose: summaryWith({ protectedRemovalCount: 1 }),
      replayVerdict: 'MATCH',
      envelopePreserved: true,
      protectedEvidenceRemoved: true,
      noFallback: true,
      checkpointComplete: true
    })
    expect(protectedFailure.verdict).toBe('FAIL')
    expect(protectedFailure.reasons.join(' ')).toMatch(/protected evidence/)
  })

  it('prioritizes hard integrity failures over an inactive zero-dose verdict', () => {
    const cases = [
      {
        name: 'ground-truth leakage',
        overrides: {},
        extra: {
          runtimePolicyInput: unsafeRuntimePolicyInput({
            ...emptyRuntimePolicyInput(),
            metadata: {}
          })
        },
        reason: /allowlist/
      },
      {
        name: 'contract conflict',
        overrides: { contractConflictCount: 1 },
        extra: { replayVerdict: 'CONTRACT_CONFLICT' as const },
        reason: /contract conflict/
      },
      {
        name: 'protected removal',
        overrides: { protectedRemovalCount: 1 },
        extra: { protectedEvidenceRemoved: true },
        reason: /protected evidence/
      },
      {
        name: 'envelope drift',
        overrides: {},
        extra: { envelopePreserved: false },
        reason: /envelope drifted/
      },
      {
        name: 'checkpoint gap',
        overrides: {},
        extra: { checkpointComplete: false },
        reason: /checkpoint join incomplete/
      }
    ] as const

    for (const testCase of cases) {
      const result = evaluateC1E0TreatmentIntegrity({
        dose: inactiveSummary(testCase.overrides),
        replayVerdict: 'UNKNOWN',
        envelopePreserved: true,
        protectedEvidenceRemoved: false,
        noFallback: true,
        checkpointComplete: true,
        ...testCase.extra
      })
      expect(result.verdict, testCase.name).toBe('FAIL')
      expect(result.reasons.join(' '), testCase.name).toMatch(testCase.reason)
    }
  })

  it('requires non-zero treatment on two distinct tasks for the E0 batch gate', () => {
    expect(
      evaluateC1E0BatchQualification({
        pairCount: 4,
        completedPairCount: 4,
        nonZeroTreatmentPairTaskIds: ['task-a', 'task-a']
      })
    ).toMatchObject({
      verdict: 'INCONCLUSIVE',
      nonZeroTreatmentPairs: 2,
      nonZeroDistinctTasks: 1
    })
    expect(
      evaluateC1E0BatchQualification({
        pairCount: 4,
        completedPairCount: 4,
        nonZeroTreatmentPairTaskIds: ['task-a', 'task-b']
      })
    ).toMatchObject({
      verdict: 'PASS',
      nonZeroTreatmentPairs: 2,
      nonZeroDistinctTasks: 2
    })
    expect(
      evaluateC1E0BatchQualification({
        pairCount: 4,
        completedPairCount: 3,
        nonZeroTreatmentPairTaskIds: ['task-a', 'task-b']
      }).verdict
    ).toBe('INCONCLUSIVE')
    expect(
      evaluateC1E0BatchQualification({
        pairCount: 4,
        completedPairCount: 4,
        nonZeroTreatmentPairTaskIds: ['task-a', 'task-b'],
        experimentInvalidator: true
      }).verdict
    ).toBe('NO_GO')
  })
})
