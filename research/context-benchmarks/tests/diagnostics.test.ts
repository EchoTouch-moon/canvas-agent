import { describe, expect, it } from 'vitest'
import { aggregateRuns } from '../src/aggregation'
import { diagnoseBenchmarkFailure } from '../src/diagnostics'
import type { BenchmarkRunRecord } from '../src/types'

function record(overrides: Partial<BenchmarkRunRecord> = {}): BenchmarkRunRecord {
  return {
    runId: 'cr005-c2-native-r1',
    taskId: 'cr005-c2-multi-file-feature',
    category: 'C2-multi-file-feature',
    strategy: 'NATIVE',
    repetition: 1,
    status: 'INVALID',
    fixtureIdentity: {
      repositoryRevision: { baseCommit: 'a'.repeat(40), treeHash: 'b'.repeat(40), workingTreePatchHash: null },
      initialStateHash: 'c'.repeat(64)
    },
    finalRepositoryRevision: null,
    finalStateHash: null,
    changedPaths: [],
    outOfScopePaths: [],
    writablePathsValid: true,
    modelProfile: { provider: 'deepseek', model: 'deepseek-v4-flash', thinkingLevel: 'medium' },
    semanticCallCount: 1,
    toolCallCount: 1,
    toolResultCount: 1,
    fileReadCount: 1,
    searchCount: 0,
    repeatedAccessCount: 0,
    wallClockMs: 1,
    abortReason: null,
    agentDeclaredSuccess: true,
    objectiveOracle: { passed: true, exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 },
    regressionOracle: { passed: true, exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 },
    acceptanceCriteriaResults: [
      {
        id: 'C2-3',
        description: 'contract',
        check: 'C2_MULTI_FILE_CONTRACT',
        passed: false,
        evidence: 'c2MultiFileContract:configRuntime=false;greetingRuntime=false;indexForwarding=true;probeTimedOut=false;outputLimitExceeded=false;protocolValid=true'
      }
    ],
    acceptanceCriteriaPassed: false,
    nativeCalls: [],
    shadowCalls: [],
    observationFailures: [],
    originalMessagesUnchanged: true,
    rawProviderPayloadsCaptured: false,
    ...overrides
  }
}

describe('CR-005 failure diagnosis', () => {
  it('keeps a trustworthy C2 contract failure classified as task failure', () => {
    expect(diagnoseBenchmarkFailure(record())).toEqual({
      failureClass: 'TASK_FAILURE',
      failureSignals: ['C2_MULTI_FILE_CONTRACT_FAILED']
    })
  })

  it('marks an otherwise clean C2 probe failure for harness review only when evidence is untrustworthy', () => {
    const diagnosis = diagnoseBenchmarkFailure(record({
      acceptanceCriteriaResults: [{
        id: 'C2-3',
        description: 'contract',
        check: 'C2_MULTI_FILE_CONTRACT',
        passed: false,
        evidence: 'c2MultiFileContract:configRuntime=false;greetingRuntime=false;indexForwarding=false;probeTimedOut=true;outputLimitExceeded=false;protocolValid=false'
      }]
    }))

    expect(diagnosis).toEqual({
      failureClass: 'HARNESS_CONTRACT_FAILURE',
      failureSignals: ['C2_MULTI_FILE_CONTRACT_FAILED', 'C2_PROBE_UNTRUSTWORTHY']
    })
  })

  it('keeps task failure attribution when a scope violation coexists with C2 failure', () => {
    const diagnosis = diagnoseBenchmarkFailure(record({
      changedPaths: ['package.json'],
      outOfScopePaths: ['package.json'],
      writablePathsValid: false
    }))

    expect(diagnosis.failureClass).toBe('TASK_FAILURE')
    expect(diagnosis.failureSignals).toEqual([
      'C2_MULTI_FILE_CONTRACT_FAILED',
      'WRITABLE_PATH_SCOPE_FAILED'
    ])
  })

  it('marks objective failure as task failure even when the contract probe fails', () => {
    const diagnosis = diagnoseBenchmarkFailure(record({
      objectiveOracle: { passed: false, exitCode: 1, timedOut: false, stdout: '', stderr: '', durationMs: 1 }
    }))

    expect(diagnosis.failureClass).toBe('TASK_FAILURE')
    expect(diagnosis.failureSignals).toEqual([
      'OBJECTIVE_ORACLE_FAILED',
      'C2_MULTI_FILE_CONTRACT_FAILED'
    ])
  })

  it('exposes the split in aggregate metadata without changing validity counts', () => {
    const harnessRecord = record({
      runId: 'harness-contract-record',
      acceptanceCriteriaResults: [{
        id: 'C2-3',
        description: 'contract',
        check: 'C2_MULTI_FILE_CONTRACT',
        passed: false,
        evidence: 'c2MultiFileContract:runtime_probe_failed'
      }]
    })
    const taskRecord = record({
      runId: 'task-failure-record',
      changedPaths: ['package.json'],
      outOfScopePaths: ['package.json'],
      writablePathsValid: false
    })

    const aggregate = aggregateRuns([harnessRecord, taskRecord])

    expect(aggregate.validRuns).toBe(0)
    expect(aggregate.taskFailureRuns).toBe(1)
    expect(aggregate.harnessContractFailureRuns).toBe(1)
  })
})
