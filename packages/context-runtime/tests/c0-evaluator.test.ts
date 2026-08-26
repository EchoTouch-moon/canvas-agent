import { describe, expect, it } from 'vitest'
import {
  GATE_D_CRITERIA,
  evaluateC0Scenario,
  type C0DecisionRecord,
  type C0FalseRemovalCandidate
} from '../src'

// Synthetic Gate C stand-in chains. No provider calls, no Universe plumbing:
// these records mirror the ContextDecision field names the live C0 runner
// will record from SHADOW-mode planWorkingSet transitions, plus the explicit
// runner-supplied evidence (model-call sequence, protection, replay,
// materialization) the evaluator consumes.

const KEY_A = 'file://src/a.ts'
const KEY_B = 'file://src/b.ts'
const VERSION_A1 = 'version:a:1'
const VERSION_B1 = 'version:b:1'
const VERSION_B2 = 'version:b:2'
const UNIVERSE_VERSION_IDS = [VERSION_A1, VERSION_B1, VERSION_B2]

function record(overrides: Partial<C0DecisionRecord> = {}): C0DecisionRecord {
  const kind = overrides.kind ?? 'ADD'
  const sourceKey = overrides.sourceKey ?? KEY_A
  const sourceVersionId = overrides.sourceVersionId ?? VERSION_A1
  return {
    decisionId: `decision:${kind}:${sourceKey}:${sourceVersionId}`,
    kind,
    sourceKey,
    sourceVersionId,
    representationId: `representation:${sourceKey}:${sourceVersionId}`,
    reasonCodes: ['CURRENT_TARGET'],
    transitionSequence: 1,
    modelCallSequence: 1,
    replayVerified: true,
    materializationStatus: 'MATERIALIZED',
    ...overrides
  }
}

// ADD -> KEEP -> ADD -> REMOVE -> REHYDRATE of the exact same SourceVersion:
// every decision explained, provenance-resolving, replay-verified,
// materialized. The full Gate D criterion bundle in one chain.
function passingChain(): readonly C0DecisionRecord[] {
  return [
    record({
      kind: 'ADD',
      sourceKey: KEY_A,
      sourceVersionId: VERSION_A1,
      reasonCodes: ['CURRENT_TARGET'],
      transitionSequence: 1,
      modelCallSequence: 1
    }),
    record({
      kind: 'KEEP',
      sourceKey: KEY_A,
      sourceVersionId: VERSION_A1,
      reasonCodes: ['PREVIOUSLY_ACTIVE'],
      transitionSequence: 2,
      modelCallSequence: 2
    }),
    record({
      kind: 'ADD',
      sourceKey: KEY_B,
      sourceVersionId: VERSION_B1,
      reasonCodes: ['RECENT_RUN_EVIDENCE'],
      transitionSequence: 2,
      modelCallSequence: 2
    }),
    record({
      kind: 'REMOVE',
      sourceKey: KEY_B,
      sourceVersionId: VERSION_B1,
      reasonCodes: ['BUDGET_PRESSURE'],
      transitionSequence: 3,
      modelCallSequence: 3,
      protection: 'NORMAL'
    }),
    record({
      kind: 'REHYDRATE',
      sourceKey: KEY_B,
      sourceVersionId: VERSION_B1,
      reasonCodes: ['REHYDRATION_TRIGGERED'],
      transitionSequence: 4,
      modelCallSequence: 4
    })
  ]
}

// Strip runner-supplied replay evidence so the criterion is NOT_OBSERVED.
function withoutReplayEvidence(
  records: readonly C0DecisionRecord[]
): readonly C0DecisionRecord[] {
  return records.map((entry) => {
    const { replayVerified: _stripped, ...rest } = entry
    return rest
  })
}

// Strip runner-supplied materialization outcomes (the shadow planning path
// never materializes, so the live runner is the only possible source).
function withoutMaterializationEvidence(
  records: readonly C0DecisionRecord[]
): readonly C0DecisionRecord[] {
  return records.map((entry) => {
    const { materializationStatus: _status, ...rest } = entry
    return rest
  })
}

function candidateFor(
  verdict: ReturnType<typeof evaluateC0Scenario>,
  sourceKey: string
): C0FalseRemovalCandidate {
  const candidate = verdict.counts.falseRemovalCandidates.find(
    (entry) => entry.sourceKey === sourceKey
  )
  if (candidate === undefined) {
    throw new Error(`no false-removal candidate for ${sourceKey}`)
  }
  return candidate
}

describe('Gate D criterion bundle (passing chain)', () => {
  it('implements exactly the eight Gate D criteria', () => {
    expect(GATE_D_CRITERIA).toHaveLength(8)
  })

  it('ADD -> KEEP -> REMOVE -> REHYDRATE (exact version) passes overall', () => {
    const verdict = evaluateC0Scenario({
      records: passingChain(),
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.overall).toBe('PASS')
    expect(verdict.criteria).toEqual({
      REMOVE_OBSERVED: 'PASS',
      REHYDRATE_AFTER_REMOVE: 'PASS',
      FALSE_REMOVAL_AUDITABLE: 'PASS',
      NO_MANDATORY_EVICTION: 'PASS',
      EXACT_SOURCE_VERSION_REHYDRATION: 'PASS',
      DETERMINISTIC_REPLAY: 'PASS',
      NO_UNEXPLAINED_MATERIALIZATION_FAILURE: 'PASS',
      REASON_CODE_COVERAGE: 'PASS'
    })
    expect(verdict.counts.removeObserved).toBe(1)
    expect(verdict.counts.rehydrateAfterRemoveObserved).toBe(1)
    expect(verdict.counts.orphanRehydrates).toBe(0)
    expect(verdict.counts.mandatoryEvictions).toBe(0)
    expect(verdict.counts.wrongVersionRehydrates).toBe(0)
    expect(verdict.counts.replayMismatches).toBe(0)
    expect(verdict.counts.unexplainedMaterializationFailures).toBe(0)
    expect(verdict.counts.unexplainedDecisions).toBe(0)
    expect(verdict.counts.activeSetChanges).toBe(4)
    expect(verdict.counts.explainedActiveSetChanges).toBe(4)
    expect(verdict.counts.reasonCodeCoverage).toBe(1)
    expect(verdict.counts.provenanceRetained).toBe(1)
  })

  it('classifies the REMOVE -> REHYDRATE pair within both horizon bounds', () => {
    const verdict = evaluateC0Scenario({
      records: passingChain(),
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    const candidate = candidateFor(verdict, KEY_B)
    expect(candidate.modelCallDistance).toBe(1)
    expect(candidate.transitionDistance).toBe(1)
    expect(candidate.priority).toBe('HIGH_PRIORITY')
  })
})

describe('per-criterion negative evidence', () => {
  it('REHYDRATE without prior REMOVE does not count and fails the chain', () => {
    const verdict = evaluateC0Scenario({
      records: [
        record({
          kind: 'ADD',
          sourceKey: KEY_A,
          sourceVersionId: VERSION_A1,
          reasonCodes: ['CURRENT_TARGET']
        }),
        record({
          kind: 'KEEP',
          sourceKey: KEY_A,
          sourceVersionId: VERSION_A1,
          reasonCodes: ['PREVIOUSLY_ACTIVE'],
          transitionSequence: 2,
          modelCallSequence: 2
        }),
        record({
          kind: 'REHYDRATE',
          sourceKey: KEY_B,
          sourceVersionId: VERSION_B1,
          reasonCodes: ['REHYDRATION_TRIGGERED'],
          transitionSequence: 3,
          modelCallSequence: 3
        })
      ],
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.removeObserved).toBe(0)
    expect(verdict.counts.rehydrateObserved).toBe(1)
    expect(verdict.counts.rehydrateAfterRemoveObserved).toBe(0)
    expect(verdict.counts.orphanRehydrates).toBe(1)
    expect(verdict.criteria.REMOVE_OBSERVED).toBe('FAIL')
    expect(verdict.criteria.REHYDRATE_AFTER_REMOVE).toBe('FAIL')
    expect(verdict.criteria.EXACT_SOURCE_VERSION_REHYDRATION).toBe('NOT_OBSERVED')
    expect(verdict.overall).toBe('FAIL')
  })

  it('a consumed removal is not reused by a second REHYDRATE', () => {
    const verdict = evaluateC0Scenario({
      records: [
        record({
          kind: 'REMOVE',
          sourceKey: KEY_B,
          sourceVersionId: VERSION_B1,
          reasonCodes: ['BUDGET_PRESSURE'],
          protection: 'NORMAL'
        }),
        record({
          kind: 'REHYDRATE',
          sourceKey: KEY_B,
          sourceVersionId: VERSION_B1,
          reasonCodes: ['REHYDRATION_TRIGGERED'],
          transitionSequence: 2,
          modelCallSequence: 2
        }),
        record({
          kind: 'REHYDRATE',
          sourceKey: KEY_B,
          sourceVersionId: VERSION_B1,
          reasonCodes: ['REHYDRATION_TRIGGERED'],
          transitionSequence: 3,
          modelCallSequence: 3
        })
      ],
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.rehydrateAfterRemoveObserved).toBe(1)
    expect(verdict.counts.orphanRehydrates).toBe(1)
    expect(verdict.criteria.REHYDRATE_AFTER_REMOVE).toBe('FAIL')
    expect(verdict.overall).toBe('FAIL')
  })

  it('REMOVE of a MANDATORY-protected subject is a mandatory eviction', () => {
    const records = passingChain().map((entry) =>
      entry.kind === 'REMOVE' ? { ...entry, protection: 'MANDATORY' as const } : entry
    )
    const verdict = evaluateC0Scenario({
      records,
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.mandatoryEvictions).toBe(1)
    expect(verdict.criteria.NO_MANDATORY_EVICTION).toBe('FAIL')
    expect(verdict.overall).toBe('FAIL')
  })

  it('REMOVE carrying USER_PINNED reason is a protected eviction without the field', () => {
    const records = passingChain().map((entry) => {
      if (entry.kind !== 'REMOVE') return entry
      const { protection: _protection, ...rest } = entry
      return { ...rest, reasonCodes: ['USER_PINNED'] as const }
    })
    const verdict = evaluateC0Scenario({
      records,
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.mandatoryEvictions).toBe(1)
    expect(verdict.criteria.NO_MANDATORY_EVICTION).toBe('FAIL')
    expect(verdict.overall).toBe('FAIL')
  })

  it('a single replay mismatch fails deterministic replay', () => {
    const records = passingChain().map((entry) =>
      entry.kind === 'REHYDRATE' ? { ...entry, replayVerified: false } : entry
    )
    const verdict = evaluateC0Scenario({
      records,
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.replayEvidenceCount).toBe(5)
    expect(verdict.counts.replayMismatches).toBe(1)
    expect(verdict.criteria.DETERMINISTIC_REPLAY).toBe('FAIL')
    expect(verdict.overall).toBe('FAIL')
  })

  it('absent replay evidence is NOT_OBSERVED and blocks overall PASS', () => {
    const verdict = evaluateC0Scenario({
      records: withoutReplayEvidence(passingChain()),
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.replayMismatches).toBe(0)
    expect(verdict.criteria.DETERMINISTIC_REPLAY).toBe('NOT_OBSERVED')
    expect(verdict.overall).toBe('FAIL')
  })

  it('an active-set change with empty reasonCodes fails coverage', () => {
    const records = passingChain().map((entry) =>
      entry.kind === 'ADD' && entry.sourceKey === KEY_B
        ? { ...entry, reasonCodes: [] }
        : entry
    )
    const verdict = evaluateC0Scenario({
      records,
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.unexplainedDecisions).toBe(1)
    expect(verdict.counts.reasonCodeCoverage).toBe(0.75)
    expect(verdict.criteria.REASON_CODE_COVERAGE).toBe('FAIL')
    expect(verdict.overall).toBe('FAIL')
  })

  it('an unexplained KEEP keeps coverage at 1 but still fails overall', () => {
    const records = passingChain().map((entry) =>
      entry.kind === 'KEEP' ? { ...entry, reasonCodes: [] } : entry
    )
    const verdict = evaluateC0Scenario({
      records,
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.activeSetChanges).toBe(4)
    expect(verdict.counts.reasonCodeCoverage).toBe(1)
    expect(verdict.criteria.REASON_CODE_COVERAGE).toBe('PASS')
    expect(verdict.counts.unexplainedDecisions).toBe(1)
    expect(verdict.overall).toBe('FAIL')
  })

  it('a sourceVersionId outside the supplied Universe breaks provenance', () => {
    const records = passingChain().map((entry) =>
      entry.kind === 'KEEP'
        ? { ...entry, sourceVersionId: 'version:ghost:9' }
        : entry
    )
    const verdict = evaluateC0Scenario({
      records,
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.provenanceResolved).toBe(4)
    expect(verdict.counts.provenanceTotal).toBe(5)
    expect(verdict.counts.provenanceRetained).toBe(0.8)
    expect(verdict.overall).toBe('FAIL')
  })

  it('REHYDRATE of a different SourceVersion than the REMOVEd one fails exactness', () => {
    const records = passingChain().map((entry) =>
      entry.kind === 'REHYDRATE'
        ? { ...entry, sourceVersionId: VERSION_B2 }
        : entry
    )
    const verdict = evaluateC0Scenario({
      records,
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.rehydrateAfterRemoveObserved).toBe(1)
    expect(verdict.counts.wrongVersionRehydrates).toBe(1)
    expect(verdict.criteria.EXACT_SOURCE_VERSION_REHYDRATION).toBe('FAIL')
    expect(verdict.overall).toBe('FAIL')
  })

  it('an unexplained materialization failure fails the criterion', () => {
    const records = passingChain().map((entry) =>
      entry.kind === 'REMOVE'
        ? { ...entry, materializationStatus: 'REJECTED' as const }
        : entry
    )
    const verdict = evaluateC0Scenario({
      records,
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.unexplainedMaterializationFailures).toBe(1)
    expect(verdict.criteria.NO_UNEXPLAINED_MATERIALIZATION_FAILURE).toBe('FAIL')
    expect(verdict.overall).toBe('FAIL')
  })

  it('an explained materialization failure does not fail the criterion', () => {
    const records = passingChain().map((entry) =>
      entry.kind === 'REMOVE'
        ? {
            ...entry,
            materializationStatus: 'DEFERRED' as const,
            materializationFailureReason: 'budget exceeded before render'
          }
        : entry
    )
    const verdict = evaluateC0Scenario({
      records,
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.unexplainedMaterializationFailures).toBe(0)
    expect(verdict.criteria.NO_UNEXPLAINED_MATERIALIZATION_FAILURE).toBe('PASS')
  })

  it('absent materialization evidence is NOT_OBSERVED (shadow path never materializes)', () => {
    const verdict = evaluateC0Scenario({
      records: withoutMaterializationEvidence(passingChain()),
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.counts.unexplainedMaterializationFailures).toBe(0)
    expect(verdict.criteria.NO_UNEXPLAINED_MATERIALIZATION_FAILURE).toBe('NOT_OBSERVED')
    expect(verdict.overall).toBe('FAIL')
  })

  it('an empty chain fails overall with unobservable coverage and provenance', () => {
    const verdict = evaluateC0Scenario({
      records: [],
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    expect(verdict.criteria.REMOVE_OBSERVED).toBe('FAIL')
    expect(verdict.criteria.REASON_CODE_COVERAGE).toBe('NOT_OBSERVED')
    expect(verdict.counts.provenanceRetained).toBeNull()
    expect(verdict.overall).toBe('FAIL')
  })
})

describe('false-removal horizon classification', () => {
  function removeRehydratePair(
    remove: Partial<C0DecisionRecord>,
    rehydrate: Partial<C0DecisionRecord>
  ): readonly C0DecisionRecord[] {
    return [
      record({
        kind: 'REMOVE',
        sourceKey: KEY_B,
        sourceVersionId: VERSION_B1,
        reasonCodes: ['BUDGET_PRESSURE'],
        protection: 'NORMAL',
        ...remove
      }),
      record({
        kind: 'REHYDRATE',
        sourceKey: KEY_B,
        sourceVersionId: VERSION_B1,
        reasonCodes: ['REHYDRATION_TRIGGERED'],
        ...rehydrate
      })
    ]
  }

  it('model-call distance <= 3 is HIGH_PRIORITY even beyond the transition bound', () => {
    const verdict = evaluateC0Scenario({
      records: removeRehydratePair(
        { transitionSequence: 5, modelCallSequence: 10 },
        { transitionSequence: 20, modelCallSequence: 12 }
      ),
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    const candidate = candidateFor(verdict, KEY_B)
    expect(candidate.modelCallDistance).toBe(2)
    expect(candidate.transitionDistance).toBe(15)
    expect(candidate.priority).toBe('HIGH_PRIORITY')
  })

  it('transition distance <= 5 is HIGH_PRIORITY even beyond the call bound', () => {
    const verdict = evaluateC0Scenario({
      records: removeRehydratePair(
        { transitionSequence: 5, modelCallSequence: 10 },
        { transitionSequence: 10, modelCallSequence: 40 }
      ),
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    const candidate = candidateFor(verdict, KEY_B)
    expect(candidate.modelCallDistance).toBe(30)
    expect(candidate.transitionDistance).toBe(5)
    expect(candidate.priority).toBe('HIGH_PRIORITY')
  })

  it('beyond both bounds is LOW_PRIORITY', () => {
    const verdict = evaluateC0Scenario({
      records: removeRehydratePair(
        { transitionSequence: 5, modelCallSequence: 10 },
        { transitionSequence: 20, modelCallSequence: 20 }
      ),
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    const candidate = candidateFor(verdict, KEY_B)
    expect(candidate.modelCallDistance).toBe(10)
    expect(candidate.transitionDistance).toBe(15)
    expect(candidate.priority).toBe('LOW_PRIORITY')
  })

  it('missing call sequences leave the call axis NOT_OBSERVED but still classify', () => {
    const verdict = evaluateC0Scenario({
      records: removeRehydratePair(
        { transitionSequence: 5, modelCallSequence: null },
        { transitionSequence: 9, modelCallSequence: null }
      ),
      universeVersionIds: UNIVERSE_VERSION_IDS
    })
    const candidate = candidateFor(verdict, KEY_B)
    expect(candidate.modelCallDistance).toBeNull()
    expect(candidate.transitionDistance).toBe(4)
    expect(candidate.priority).toBe('HIGH_PRIORITY')
    // The audit criterion demands both axes, so an incomplete audit FAILs.
    expect(verdict.criteria.FALSE_REMOVAL_AUDITABLE).toBe('FAIL')
  })

  it('horizon bounds are overridable via evaluator options', () => {
    const records = removeRehydratePair(
      { transitionSequence: 5, modelCallSequence: 10 },
      { transitionSequence: 20, modelCallSequence: 20 }
    )
    const widened = evaluateC0Scenario(
      { records, universeVersionIds: UNIVERSE_VERSION_IDS },
      { highPriorityMaxModelCallDistance: 10 }
    )
    expect(candidateFor(widened, KEY_B).priority).toBe('HIGH_PRIORITY')
    const narrowed = evaluateC0Scenario(
      { records, universeVersionIds: UNIVERSE_VERSION_IDS },
      { highPriorityMaxModelCallDistance: 0, highPriorityMaxTransitionDistance: 1 }
    )
    expect(candidateFor(narrowed, KEY_B).priority).toBe('LOW_PRIORITY')
  })
})
