import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadManifests } from '../src/manifest'
import {
  runProgressiveWaveA,
  type ProgressiveWaveATask
} from '../src/live-runner'
import {
  selectWaveAManifests,
  WAVE_A_TARGETS
} from '../src/wave-a'
import type { BenchmarkRunRecord } from '../src/types'

const researchRoot = resolve(import.meta.dirname, '..')

function recordFor(
  task: ProgressiveWaveATask,
  overrides: Partial<BenchmarkRunRecord> = {}
): BenchmarkRunRecord {
  const target = WAVE_A_TARGETS.find(
    (candidate) => candidate.taskId === task.manifest.taskId
  )
  if (target === undefined) throw new Error(`missing target: ${task.manifest.taskId}`)
  const runId = `${task.manifest.taskId}-${task.strategy.toLowerCase()}-r1`
  return {
    runId,
    taskId: task.manifest.taskId,
    category: task.manifest.category,
    strategy: task.strategy,
    repetition: 1,
    status: 'VALID',
    fixtureIdentity: target.fixtureIdentity,
    finalRepositoryRevision: null,
    finalStateHash: target.fixtureIdentity.initialStateHash,
    changedPaths: [],
    outOfScopePaths: [],
    writablePathsValid: true,
    modelProfile: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      thinkingLevel: 'medium'
    },
    semanticCallCount: 1,
    toolCallCount: 1,
    toolResultCount: 1,
    fileReadCount: task.strategy === 'SHADOW' ? 1 : 0,
    searchCount: 0,
    repeatedAccessCount: 0,
    wallClockMs: 1,
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
        id: `${task.manifest.category}-objective`,
        description: 'objective oracle',
        check: 'OBJECTIVE_ORACLE',
        passed: true,
        evidence: 'objectiveOracle:passed=true'
      }
    ],
    acceptanceCriteriaPassed: true,
    nativeCalls: task.strategy === 'NATIVE'
      ? [{
          sequence: 1,
          observedMessageTokenEstimate: 1,
          categoryCounts: { USER: 1 },
          toolResultCount: 0,
          fileAccesses: []
        }]
      : [],
    shadowCalls: [],
    observationFailures: [],
    repositoryObservations: [],
    originalMessagesUnchanged: true,
    rawProviderPayloadsCaptured: false,
    ...overrides
  }
}

async function selectedManifests() {
  return selectWaveAManifests(await loadManifests(researchRoot))
}

async function temporaryOutput(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cr005a-progressive-'))
}

describe('CR-005A progressive Wave A runner', () => {
  it('stops after a failed C2 pair and never starts C3-C6', async () => {
    const manifests = await selectedManifests()
    const outputDirectory = await temporaryOutput()
    const calls: string[] = []
    try {
      const result = await runProgressiveWaveA({
        researchRoot,
        manifests,
        baselineSha: 'baseline-cr005a-c2-failure',
        outputDirectory,
        executeTask: async (task) => {
          calls.push(`${task.manifest.category}:${task.strategy}`)
          return task.manifest.category === 'C2-multi-file-feature' && task.strategy === 'SHADOW'
            ? recordFor(task, { status: 'INVALID', acceptanceCriteriaPassed: false })
            : recordFor(task)
        }
      })

      expect(result.status).toBe('STOPPED')
      expect(result.records).toHaveLength(2)
      expect(calls).toEqual([
        'C2-multi-file-feature:NATIVE',
        'C2-multi-file-feature:SHADOW'
      ])
      expect(result.stopReason).toContain('record_gate_failed')

      const progress = JSON.parse(await readFile(join(result.checkpointDirectory!, 'progress.json'), 'utf8')) as {
        status: string
        completedPairs: string[]
      }
      expect(progress.status).toBe('STOPPED')
      expect(progress.completedPairs).toEqual([])
      expect(await readFile(join(result.checkpointDirectory!, 'aggregate.json'), 'utf8')).toContain(
        'totalRuns'
      )
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  }, 30_000)

  it('stops on the C4 checkpoint failure and never starts C5-C6', async () => {
    const manifests = await selectedManifests()
    const outputDirectory = await temporaryOutput()
    const calls: string[] = []
    try {
      const result = await runProgressiveWaveA({
        researchRoot,
        manifests,
        baselineSha: 'baseline-cr005a-c4-checkpoint',
        outputDirectory,
        checkpointWriteInterceptor: async (event) => {
          if (
            event.kind === 'progress' &&
            event.metadata.status === 'RUNNING' &&
            event.metadata.recordCount === 6
          ) {
            throw new Error('synthetic checkpoint failure')
          }
        },
        executeTask: async (task) => {
          calls.push(`${task.manifest.category}:${task.strategy}`)
          return recordFor(task)
        }
      })

      expect(result.status).toBe('STOPPED')
      expect(result.records).toHaveLength(6)
      expect(result.completedPairs).toBe(3)
      expect(calls).toHaveLength(6)
      expect(calls.at(-1)).toBe('C4-constrained-refactor:SHADOW')
      expect(calls.some((call) => call.startsWith('C5-'))).toBe(false)
      expect(calls.some((call) => call.startsWith('C6-'))).toBe(false)
      expect(result.stopReason).toBe('checkpoint_persistence_failed')
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  }, 30_000)

  it('runs the exact ten records in frozen pair order with no provider executor', async () => {
    const manifests = await selectedManifests()
    const outputDirectory = await temporaryOutput()
    const calls: string[] = []
    try {
      const result = await runProgressiveWaveA({
        researchRoot,
        manifests,
        baselineSha: 'baseline-cr005a-success',
        outputDirectory,
        executeTask: async (task) => {
          calls.push(`${task.manifest.category}:${task.strategy}`)
          return recordFor(task)
        }
      })

      expect(result.status).toBe('PASS')
      expect(result.records).toHaveLength(10)
      expect(result.completedPairs).toBe(5)
      expect(calls).toEqual([
        'C2-multi-file-feature:NATIVE',
        'C2-multi-file-feature:SHADOW',
        'C3-failing-test-diagnosis:NATIVE',
        'C3-failing-test-diagnosis:SHADOW',
        'C4-constrained-refactor:NATIVE',
        'C4-constrained-refactor:SHADOW',
        'C5-unrelated-discovery:NATIVE',
        'C5-unrelated-discovery:SHADOW',
        'C6-wrong-path-rehydration:NATIVE',
        'C6-wrong-path-rehydration:SHADOW'
      ])
      const checkpointManifest = await readFile(
        join(result.checkpointDirectory!, 'manifest.json'),
        'utf8'
      )
      expect(checkpointManifest).not.toContain(manifests[0]?.prompt ?? '')
      const progress = JSON.parse(await readFile(join(result.checkpointDirectory!, 'progress.json'), 'utf8')) as {
        status: string
        recordCount: number
        completedPairs: string[]
      }
      expect(progress).toMatchObject({ status: 'PASS', recordCount: 10 })
      expect(progress.completedPairs).toHaveLength(5)
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  }, 30_000)

  it('rejects unsafe durable evidence before starting another category', async () => {
    const manifests = await selectedManifests()
    const outputDirectory = await temporaryOutput()
    const calls: string[] = []
    try {
      const result = await runProgressiveWaveA({
        researchRoot,
        manifests,
        baselineSha: 'baseline-cr005a-evidence',
        outputDirectory,
        executeTask: async (task) => {
          calls.push(`${task.manifest.category}:${task.strategy}`)
          return recordFor(task, {
            observationFailures: ['/Users/example/credential-file.txt']
          })
        }
      })

      expect(result.status).toBe('STOPPED')
      expect(result.records).toHaveLength(0)
      expect(calls).toEqual(['C2-multi-file-feature:NATIVE'])
      expect(result.stopReason).toBe('durable_evidence_unsafe')
      expect(await readFile(join(result.checkpointDirectory!, 'records.jsonl'), 'utf8')).toBe('')
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  }, 30_000)

  it('requires explicit authorization before resuming an existing checkpoint', async () => {
    const manifests = await selectedManifests()
    const outputDirectory = await temporaryOutput()
    try {
      const first = await runProgressiveWaveA({
        researchRoot,
        manifests,
        baselineSha: 'baseline-cr005a-resume',
        outputDirectory,
        executeTask: async (task) => recordFor(task)
      })
      expect(first.status).toBe('PASS')
      const runId = first.checkpointDirectory?.split('/').at(-1)
      if (runId === undefined) throw new Error('missing checkpoint run id')

      await expect(
        runProgressiveWaveA({
          researchRoot,
          manifests,
          baselineSha: 'baseline-cr005a-resume',
          outputDirectory,
          runId,
          resume: true,
          executeTask: async (task) => recordFor(task)
        })
      ).rejects.toThrow('wave_a_resume_authorization_required')
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  }, 30_000)

  it('recovers a crash checkpoint without repeating completed work, but never auto-resumes', async () => {
    const manifests = await selectedManifests()
    const outputDirectory = await temporaryOutput()
    const calls: string[] = []
    try {
      const first = await runProgressiveWaveA({
        researchRoot,
        manifests,
        baselineSha: 'baseline-cr005a-crash-resume',
        outputDirectory,
        checkpointWriteInterceptor: async (event) => {
          if (
            event.kind === 'progress' &&
            event.metadata.status === 'RUNNING' &&
            event.metadata.recordCount === 1
          ) {
            throw new Error('synthetic process interruption')
          }
        },
        executeTask: async (task) => {
          calls.push(`${task.manifest.category}:${task.strategy}`)
          return recordFor(task)
        }
      })
      expect(first.status).toBe('STOPPED')
      expect(first.records).toHaveLength(1)

      const runId = first.checkpointDirectory?.split('/').at(-1)
      if (runId === undefined) throw new Error('missing checkpoint run id')
      const progressPath = join(first.checkpointDirectory!, 'progress.json')
      const aggregatePath = join(first.checkpointDirectory!, 'aggregate.json')
      const stoppedProgress = JSON.parse(await readFile(progressPath, 'utf8')) as {
        recordIds: readonly string[]
        recordHashes: readonly string[]
      }
      // Model the durable state left by a process crash after records.jsonl was
      // synced but before terminal STOPPED metadata was written.
      await rm(aggregatePath, { force: true })
      await writeFile(
        progressPath,
        `${JSON.stringify({
          schemaVersion: 1,
          runId,
          baselineSha: 'baseline-cr005a-crash-resume',
          status: 'RUNNING',
          completedPairs: [],
          nextCategory: 'C2-multi-file-feature',
          nextStrategy: 'SHADOW',
          recordCount: stoppedProgress.recordIds.length,
          recordIds: stoppedProgress.recordIds,
          recordHashes: stoppedProgress.recordHashes,
          stopReason: null
        })}\n`,
        'utf8'
      )

      await expect(
        runProgressiveWaveA({
          researchRoot,
          manifests,
          baselineSha: 'baseline-cr005a-crash-resume',
          outputDirectory,
          runId,
          resume: true,
          providerExecutionAuthorized: false,
          executeTask: async (task) => recordFor(task)
        })
      ).rejects.toThrow('wave_a_resume_authorization_required')

      const resumed = await runProgressiveWaveA({
        researchRoot,
        manifests,
        baselineSha: 'baseline-cr005a-crash-resume',
        outputDirectory,
        runId,
        resume: true,
        providerExecutionAuthorized: true,
        executeTask: async (task) => {
          calls.push(`${task.manifest.category}:${task.strategy}`)
          return recordFor(task)
        }
      })
      expect(resumed.status).toBe('PASS')
      expect(resumed.records).toHaveLength(10)
      expect(calls[0]).toBe('C2-multi-file-feature:NATIVE')
      expect(calls[1]).toBe('C2-multi-file-feature:SHADOW')
      expect(calls).toHaveLength(10)
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  }, 30_000)
})
