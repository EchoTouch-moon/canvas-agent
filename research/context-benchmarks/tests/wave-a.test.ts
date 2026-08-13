import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadManifests } from '../src/manifest'
import type { BenchmarkManifest, BenchmarkRunRecord } from '../src/types'
import {
  evaluateWaveAGate,
  evaluateWaveAPairGate,
  isWaveAExecutionAuthorized,
  selectWaveAManifests,
  WAVE_A_RECORD_COUNT,
  WAVE_A_TARGETS
} from '../src/wave-a'

const researchRoot = resolve(import.meta.dirname, '..')

type WaveATarget = (typeof WAVE_A_TARGETS)[number]

function run(
  target: WaveATarget,
  strategy: 'NATIVE' | 'SHADOW',
  overrides: Partial<BenchmarkRunRecord> = {}
): BenchmarkRunRecord {
  return {
    runId: `${target.taskId}-${strategy.toLowerCase()}-r1`,
    taskId: target.taskId,
    category: target.category,
    strategy,
    repetition: 1,
    status: 'VALID',
    fixtureIdentity: target.fixtureIdentity,
    finalRepositoryRevision: null,
    finalStateHash: target.fixtureIdentity.initialStateHash,
    changedPaths: ['src/example.js'],
    outOfScopePaths: [],
    writablePathsValid: true,
    modelProfile: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      thinkingLevel: 'medium'
    },
    semanticCallCount: 2,
    toolCallCount: 2,
    toolResultCount: 2,
    fileReadCount: strategy === 'SHADOW' ? 1 : 0,
    searchCount: 0,
    repeatedAccessCount: 0,
    wallClockMs: 100,
    abortReason: null,
    agentDeclaredSuccess: true,
    objectiveOracle: {
      passed: true,
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      durationMs: 1
    },
    regressionOracle: {
      passed: true,
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      durationMs: 1
    },
    acceptanceCriteriaResults: [
      {
        id: `${target.category}-1`,
        description: 'objective oracle',
        check: 'OBJECTIVE_ORACLE',
        passed: true,
        evidence: 'objectiveOracle:passed=true'
      }
    ],
    acceptanceCriteriaPassed: true,
    nativeCalls:
      strategy === 'NATIVE'
        ? [
            {
              sequence: 1,
              observedMessageTokenEstimate: 32,
              categoryCounts: { USER: 1 },
              toolResultCount: 0,
              fileAccesses: []
            }
          ]
        : [],
    shadowCalls: [],
    observationFailures: [],
    repositoryObservations: [],
    originalMessagesUnchanged: true,
    rawProviderPayloadsCaptured: false,
    ...overrides
  }
}

function validWaveARecords(): readonly BenchmarkRunRecord[] {
  return WAVE_A_TARGETS.flatMap((target) => [
    run(target, 'NATIVE'),
    run(target, 'SHADOW')
  ])
}

function replaceRecord(
  records: readonly BenchmarkRunRecord[],
  runId: string,
  replacement: BenchmarkRunRecord
): readonly BenchmarkRunRecord[] {
  return records.map((record) =>
    record.runId === runId ? replacement : record
  )
}

describe('CR-005 Wave A execution gate', () => {
  it('selects exactly C2-C6 in frozen order and rejects ambiguous or renamed manifests', async () => {
    const manifests = await loadManifests(researchRoot)
    const selected = selectWaveAManifests(manifests)
    expect(selected.map(({ category }) => category)).toEqual(
      WAVE_A_TARGETS.map(({ category }) => category)
    )

    const c2 = selected[0]
    if (c2 === undefined) throw new Error('missing C2 manifest')
    expect(() => selectWaveAManifests([...manifests, c2])).toThrow(
      'wave_a_manifest_count_invalid'
    )

    const renamed = {
      ...c2,
      taskId: 'cr005-renamed-task'
    } satisfies BenchmarkManifest
    expect(() =>
      selectWaveAManifests([
        ...manifests.filter((manifest) => manifest.category !== c2.category),
        renamed
      ])
    ).toThrow('wave_a_manifest_task_invalid')

    const changedPrompt = {
      ...c2,
      prompt: `${c2.prompt}\nUnapproved extra instruction.`
    } satisfies BenchmarkManifest
    expect(() =>
      selectWaveAManifests([
        ...manifests.filter((manifest) => manifest.category !== c2.category),
        changedPrompt
      ])
    ).toThrow('wave_a_manifest_fingerprint_invalid')
  })

  it('requires the dedicated opt-in and ignores the broad live switch', () => {
    expect(isWaveAExecutionAuthorized({})).toBe(false)
    expect(isWaveAExecutionAuthorized({ CANVAS_CR005_LIVE: '1' })).toBe(false)
    expect(isWaveAExecutionAuthorized({ CANVAS_CR005_WAVE_A: 'true' })).toBe(
      false
    )
    expect(isWaveAExecutionAuthorized({ CANVAS_CR005_WAVE_A: '1' })).toBe(true)
    expect(
      isWaveAExecutionAuthorized({
        CANVAS_CR005_WAVE_A: '1',
        CANVAS_CR005_LIVE: '1'
      })
    ).toBe(false)
    expect(
      isWaveAExecutionAuthorized({
        CANVAS_CR005_WAVE_A: '1',
        CANVAS_CR005_REPLACEMENT_CANARY: '1'
      })
    ).toBe(false)
  })

  it('passes only the exact ten-record C2-C6 repetition-one matrix', () => {
    const records = validWaveARecords()
    const gate = evaluateWaveAGate(records)
    expect(records).toHaveLength(WAVE_A_RECORD_COUNT)
    expect(gate.status).toBe('PASS')
    expect(Object.values(gate.checks).every(Boolean)).toBe(true)
  })

  it('fails closed for an extra, missing, or duplicate-strategy record', () => {
    const records = validWaveARecords()
    const first = records[0]
    if (first === undefined) throw new Error('missing first Wave A record')
    const extra = evaluateWaveAGate([...records, first])
    expect(extra.status).toBe('FAIL')
    expect(extra.checks.exactRecordCount).toBe(false)
    expect(extra.checks.uniqueRunIds).toBe(false)

    const missing = evaluateWaveAGate(records.slice(1))
    expect(missing.status).toBe('FAIL')
    expect(missing.checks.exactRecordCount).toBe(false)
    expect(missing.checks.exactStrategyPairPerTask).toBe(false)

    const c2Target = WAVE_A_TARGETS[0]
    const duplicateNative = replaceRecord(
      records,
      `${c2Target.taskId}-shadow-r1`,
      run(c2Target, 'NATIVE', { runId: `${c2Target.taskId}-shadow-r1` })
    )
    const duplicateGate = evaluateWaveAGate(duplicateNative)
    expect(duplicateGate.status).toBe('FAIL')
    expect(duplicateGate.checks.exactStrategyPairPerTask).toBe(false)
  })

  it('rejects C1 substitution, repetition two, and forged run ids', () => {
    const records = validWaveARecords()
    const c2Native = records[0]
    if (c2Native === undefined) throw new Error('missing C2 Native record')
    const withC1 = replaceRecord(records, c2Native.runId, {
      ...c2Native,
      runId: 'cr005-c1-localized-bug-fix-native-r1',
      taskId: 'cr005-c1-localized-bug-fix',
      category: 'C1-localized-bug-fix'
    })
    expect(evaluateWaveAGate(withC1).checks.exactCategoryAndTaskSet).toBe(false)

    const repetitionTwo = replaceRecord(records, c2Native.runId, {
      ...c2Native,
      runId: `${c2Native.taskId}-native-r2`,
      repetition: 2
    })
    const repetitionGate = evaluateWaveAGate(repetitionTwo)
    expect(repetitionGate.status).toBe('FAIL')
    expect(repetitionGate.checks.exactRepetition).toBe(false)
    expect(repetitionGate.checks.exactRunIds).toBe(false)

    const forgedRunId = replaceRecord(records, c2Native.runId, {
      ...c2Native,
      runId: 'forged-but-otherwise-valid'
    })
    expect(evaluateWaveAGate(forgedRunId).checks.exactRunIds).toBe(false)
  })

  it('requires each Native/Shadow pair to share fixture identity and model profile', () => {
    const records = validWaveARecords()
    const c2Target = WAVE_A_TARGETS[0]
    const shadowRunId = `${c2Target.taskId}-shadow-r1`
    const shadow = records.find((record) => record.runId === shadowRunId)
    if (shadow === undefined) throw new Error('missing C2 Shadow record')

    const identityMismatch = replaceRecord(records, shadowRunId, {
      ...shadow,
      fixtureIdentity: {
        ...shadow.fixtureIdentity,
        initialStateHash: 'f'.repeat(64)
      }
    })
    const identityMismatchGate = evaluateWaveAGate(identityMismatch)
    expect(identityMismatchGate.checks.pairedFixtureIdentityMatches).toBe(false)
    expect(identityMismatchGate.checks.exactFixtureIdentity).toBe(false)

    const bothC2IdentitiesChanged = records.map((record) =>
      record.taskId === c2Target.taskId
        ? {
            ...record,
            fixtureIdentity: {
              ...record.fixtureIdentity,
              initialStateHash: 'f'.repeat(64)
            }
          }
        : record
    )
    const exactIdentityGate = evaluateWaveAGate(bothC2IdentitiesChanged)
    expect(exactIdentityGate.checks.pairedFixtureIdentityMatches).toBe(true)
    expect(exactIdentityGate.checks.exactFixtureIdentity).toBe(false)

    const modelMismatch = replaceRecord(records, shadowRunId, {
      ...shadow,
      modelProfile: { ...shadow.modelProfile, thinkingLevel: 'high' }
    })
    const modelMismatchGate = evaluateWaveAGate(modelMismatch)
    expect(modelMismatchGate.checks.pairedModelProfileMatches).toBe(false)
    expect(modelMismatchGate.checks.exactModelProfile).toBe(false)

    const bothC2ProfilesChanged = records.map((record) =>
      record.taskId === c2Target.taskId
        ? {
            ...record,
            modelProfile: {
              ...record.modelProfile,
              thinkingLevel: 'high' as const
            }
          }
        : record
    )
    const exactModelGate = evaluateWaveAGate(bothC2ProfilesChanged)
    expect(exactModelGate.checks.pairedModelProfileMatches).toBe(true)
    expect(exactModelGate.checks.exactModelProfile).toBe(false)
  })

  it('rejects invalid acceptance evidence and retained credential material', () => {
    const records = validWaveARecords()
    const first = records[0]
    if (first === undefined) throw new Error('missing first Wave A record')
    const invalid = replaceRecord(records, first.runId, {
      ...first,
      status: 'INVALID',
      acceptanceCriteriaPassed: false
    })
    expect(evaluateWaveAGate(invalid).checks.allRecordsValid).toBe(false)

    const credential = 'wave-a-credential-canary-value'
    const leaked = replaceRecord(records, first.runId, {
      ...first,
      abortReason: credential
    })
    const credentialGate = evaluateWaveAGate(leaked, credential)
    expect(credentialGate.status).toBe('FAIL')
    expect(credentialGate.checks.credentialValueAbsent).toBe(false)
  })

  it('rejects machine paths and credential-shaped retained evidence', () => {
    const records = validWaveARecords()
    const first = records[0]
    if (first === undefined) throw new Error('missing first Wave A record')

    const machinePath = replaceRecord(records, first.runId, {
      ...first,
      observationFailures: ['/private/tmp/wave-a-fixture/src/example.js']
    })
    expect(
      evaluateWaveAGate(machinePath).checks.retainedEvidenceSanitized
    ).toBe(false)

    const secretPattern = replaceRecord(records, first.runId, {
      ...first,
      observationFailures: ['transport:Bearer wave-a-secret-token-12345']
    })
    expect(evaluateWaveAGate(secretPattern).checks.secretPatternsAbsent).toBe(
      false
    )
  })

  it('pair gate rejects materialization failures and Shadow replay mismatches', () => {
    const records = validWaveARecords()
    const c2Shadow = records.find(
      (record) =>
        record.taskId === WAVE_A_TARGETS[0]?.taskId && record.strategy === 'SHADOW'
    )
    if (c2Shadow === undefined) throw new Error('missing C2 Shadow record')
    const forgedShadow = {
      ...c2Shadow,
      shadowCalls: [
        { materializationFailures: ['REVISION_MISMATCH'] } as unknown as BenchmarkRunRecord['shadowCalls'][number]
      ]
    }
    const pair = records.map((record) =>
      record.runId === c2Shadow.runId ? forgedShadow : record
    ).slice(0, 2)
    const gate = evaluateWaveAPairGate(pair)
    expect(gate.status).toBe('FAIL')
    expect(gate.checks.materializationFailuresAbsent).toBe(false)
    expect(gate.checks.shadowReplayValid).toBe(false)
  })
})
