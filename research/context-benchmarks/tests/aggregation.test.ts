import { describe, expect, it } from 'vitest'
import { planWorkingSet, seedUniverse } from '@canvas-agent/context-runtime'
import { aggregateRuns, replayShadowCallsHash } from '../src/aggregation'
import type { BenchmarkRunRecord, ShadowCallEvidence, ShadowDecisionEvidence } from '../src/types'

const hash = 'a'.repeat(64)

function decision(kind: ShadowDecisionEvidence['kind'], sourceKey = 'repository/file://src/example.ts'): ShadowDecisionEvidence {
  return {
    kind,
    sourceKey,
    sourceVersionId: 'version-1',
    representationId: `representation-${kind}`,
    fromWorkingSetId: kind === 'ADD' ? null : 'working-set-1',
    toWorkingSetId: 'working-set-2',
    reasonCodes: kind === 'REMOVE' ? ['BUDGET_PRESSURE'] : ['EVIDENCE_REQUIRED'],
    tokenDelta: kind === 'REMOVE' ? -4 : 4,
    previousRepresentationKind: kind === 'REPLACE' ? 'FULL' : null,
    representationKind: kind === 'REPLACE' ? 'LINE_RANGE' : 'FULL'
  }
}

function shadowCall(sequence: number, decisions: readonly ShadowDecisionEvidence[], fileAccesses: ShadowCallEvidence['fileAccesses'] = []): ShadowCallEvidence {
  const replay = replayMetadata(sequence)
  return {
    sequence,
    ...replay,
    proposedSemanticTokenEstimate: sequence + 2,
    itemCount: sequence,
    nativeContextEstimate: 12,
    decisions,
    representationCounts: { FULL: 1 },
    reasonCodeCounts: { EVIDENCE_REQUIRED: decisions.length },
    materializationFailures: [],
    fileAccesses
  }
}

function replayMetadata(sequence: number): Pick<ShadowCallEvidence, 'universeSequence' | 'universeHash' | 'workingSetId' | 'workingSetHash' | 'planningRequestHash' | 'universe' | 'planningRequest' | 'previousWorkingSet' | 'policyVersion' | 'transitionHash' | 'representations'> {
  const universe = seedUniverse({ runtimeSessionId: `replay-${sequence}`, seeds: [] })
  const planningRequest = {
    runtimeSessionId: universe.runtimeSessionId,
    recompositionSequence: sequence,
    taskPhase: 'GENERAL' as const,
    budget: { maxSemanticTokens: 8000 },
    pinnedSourceKeys: [],
    excludedSourceKeys: [],
    currentTargetSourceKeys: [],
    latestVerificationSourceKeys: [],
    recentEvidenceSourceKeys: [],
    previousWorkingSetId: null
  }
  const replayed = planWorkingSet({
    universe,
    request: planningRequest,
    previousWorkingSet: null,
    options: { policyVersion: 'policy-v0', createdAt: '2026-01-01T00:00:00.000Z', represent: () => null }
  })
  return {
    universeSequence: universe.sequence,
    universeHash: universe.logicalHash,
    workingSetId: replayed.workingSet.workingSetId,
    workingSetHash: replayed.workingSet.logicalHash,
    planningRequestHash: replayed.workingSet.planningRequestHash,
    universe,
    planningRequest,
    previousWorkingSet: null,
    policyVersion: 'policy-v0',
    transitionHash: replayed.transition.logicalHash,
    representations: []
  }
}

function run(strategy: 'NATIVE' | 'SHADOW', runId: string): BenchmarkRunRecord {
  const calls = [
    shadowCall(1, [decision('REMOVE')], [
      { toolName: 'read', path: 'src/example.ts', kind: 'READ', sequence: 1 }
    ]),
    shadowCall(2, [decision('ADD')], [
      { toolName: 'read', path: 'src/example.ts', kind: 'READ', sequence: 2 }
    ]),
    shadowCall(3, [decision('REHYDRATE')])
  ]
  return {
    runId,
    taskId: 'cr005-c1-localized-bug-fix',
    category: 'C1-localized-bug-fix',
    strategy,
    repetition: 1,
    status: 'VALID',
    fixtureIdentity: {
      repositoryRevision: { baseCommit: 'b'.repeat(40), treeHash: 'c'.repeat(40), workingTreePatchHash: null },
      initialStateHash: hash
    },
    finalRepositoryRevision: null,
    finalStateHash: null,
    changedPaths: [],
    outOfScopePaths: [],
    writablePathsValid: true,
    modelProfile: { provider: 'deepseek', model: 'deepseek-v4-flash', thinkingLevel: 'medium' },
    semanticCallCount: 3,
    toolCallCount: 4,
    toolResultCount: 4,
    fileReadCount: strategy === 'SHADOW' ? 1 : 0,
    searchCount: 0,
    repeatedAccessCount: 0,
    wallClockMs: 100,
    abortReason: null,
    agentDeclaredSuccess: true,
    objectiveOracle: { passed: true, exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 2 },
    regressionOracle: { passed: true, exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 2 },
    acceptanceCriteriaResults: [
      {
        id: 'C1-1',
        description: 'synthetic acceptance criterion',
        check: 'OBJECTIVE_ORACLE',
        passed: true,
        evidence: 'objectiveOracle:passed=true'
      }
    ],
    acceptanceCriteriaPassed: true,
    nativeCalls: [{ sequence: 1, observedMessageTokenEstimate: 12, categoryCounts: { USER: 1 }, toolResultCount: 1, fileAccesses: [] }],
    shadowCalls: strategy === 'SHADOW' ? calls : [],
    observationFailures: [],
    originalMessagesUnchanged: true,
    rawProviderPayloadsCaptured: false
  }
}

describe('CR-005 aggregation', () => {
  it('is order-independent and only counts explicit REHYDRATE transitions', () => {
    const native = run('NATIVE', 'native-run')
    const shadow = run('SHADOW', 'shadow-run')
    const forward = aggregateRuns([native, shadow])
    const reverse = aggregateRuns([shadow, native])

    expect(reverse).toEqual(forward)
    expect(forward.validRuns).toBe(2)
    expect(forward.byCategory['C1-localized-bug-fix']).toEqual({ native: 1, shadow: 1 })
    expect(forward.rehydrations).toHaveLength(1)
    expect(forward.rehydrations[0]?.distance).toBe(2)
    expect(forward.falseRemovalCandidates).toHaveLength(2)
    expect(forward.falseRemovalCandidates.map((candidate) => candidate.distance)).toEqual([0, 1])
    expect(forward.falseRemovalCandidates.every((candidate) => candidate.classification === 'INDETERMINATE')).toBe(true)
    expect(forward.readAfterRemoveCount).toBe(2)
    expect(forward.shadowDecisionCounts).toEqual({ REMOVE: 1, ADD: 1, REHYDRATE: 1 })
    expect(forward.providerSavings).toBeNull()
  })

  it('replays the Planner from saved metadata and rejects tampered identity', () => {
    const call = shadowCall(1, [])
    const first = replayShadowCallsHash([call])
    const second = replayShadowCallsHash([{ ...call, fileAccesses: [] }])
    expect(first).toBe(second)
    expect(() => replayShadowCallsHash([{ ...call, workingSetHash: 'tampered' }])).toThrow(/Working Set hash mismatch/)
  })

  it('excludes a run with an out-of-scope final change from validity totals', () => {
    const outOfScope = {
      ...run('NATIVE', 'native-out-of-scope'),
      outOfScopePaths: ['src/unexpected.ts'],
      writablePathsValid: false
    }
    const aggregate = aggregateRuns([outOfScope])
    expect(aggregate.validRuns).toBe(0)
    expect(aggregate.runIdsExcludedFromValidity).toEqual(['native-out-of-scope'])
  })

  it('retains bounded observation failures in aggregate evidence', () => {
    const record = {
      ...run('SHADOW', 'shadow-observation-failure'),
      observationFailures: ['repository-observation:src/example.ts:DIRTY_REVISION_UNSUPPORTED']
    }
    const aggregate = aggregateRuns([record])

    expect(aggregate.observationFailureCount).toBe(1)
    expect(aggregate.observationFailures).toEqual([
      'cr005-c1-localized-bug-fix|shadow-observation-failure|repository-observation:src/example.ts:DIRTY_REVISION_UNSUPPORTED'
    ])
  })
})
