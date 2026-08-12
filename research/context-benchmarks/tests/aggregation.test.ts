import { describe, expect, it } from 'vitest'
import { aggregateRuns, replayShadowEvidenceHash } from '../src/aggregation'
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
  return {
    sequence,
    universeSequence: sequence,
    universeHash: `universe-${sequence}`,
    workingSetId: `working-set-${sequence}`,
    workingSetHash: `working-set-hash-${sequence}`,
    planningRequestHash: `planning-request-${sequence}`,
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

function run(strategy: 'NATIVE' | 'SHADOW', runId: string): BenchmarkRunRecord {
  const calls = [
    shadowCall(1, [decision('REMOVE')]),
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
    nativeCalls: [{ sequence: 1, observedMessageTokenEstimate: 12, categoryCounts: { USER: 1 }, toolResultCount: 1, fileAccesses: [] }],
    shadowCalls: strategy === 'SHADOW' ? calls : [],
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
    expect(forward.falseRemovalCandidates).toHaveLength(1)
    expect(forward.falseRemovalCandidates[0]?.classification).toBe('INDETERMINATE')
    expect(forward.shadowDecisionCounts).toEqual({ REMOVE: 1, ADD: 1, REHYDRATE: 1 })
    expect(forward.providerSavings).toBeNull()
  })

  it('keeps replay evidence deterministic when run IDs are changed', () => {
    const first = run('SHADOW', 'shadow-run-a')
    const second = run('SHADOW', 'shadow-run-b')
    expect(replayShadowEvidenceHash(first)).toBe(replayShadowEvidenceHash(second))
  })
})
