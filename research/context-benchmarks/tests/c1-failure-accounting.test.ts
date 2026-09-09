import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  C1LiveBindingDriver,
  C1SandboxToolExecutor,
  type C1LiveBindingCheckpoint,
  type C1LiveModelResponse,
  type C1LiveToolExecutor
} from '../src/c1-live-binding'
import { deriveC1CallAccounting } from '../src/c1-call-accounting'
import {
  C1HardBudgetGuard,
  createC1ObservedReadTrace,
  loadC1FrozenStudy,
  prepareC1StrictProvider
} from '../src/c1-live-preflight'
import { C1LiveTaskObservationSource, C1StudyOrchestrator } from '../src/c1-live-study'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const response = (outcome: C1LiveModelResponse['outcome'] = 'COMPLETE'): C1LiveModelResponse => ({
  responseId: 'fake-response',
  assistantMessageCount: 1,
  assistantContent: 'PRIVATE_RESPONSE_CANARY',
  usage: {
    inputTokens: 10,
    outputTokens: 2,
    totalTokens: 12,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    usageSource: 'SCRIPTED_FAKE'
  },
  toolRequests: [],
  toolExecutions: [],
  outcome
})

async function fixture() {
  const study = await loadC1FrozenStudy(REPO_ROOT)
  const task = study.tasks[0]!
  const binding = await prepareC1StrictProvider({
    runIdentity: 'c1-20260908-accounting-aaaaaaaa'
  })
  const entries: C1LiveBindingCheckpoint[] = []
  const sink = {
    append: async (event: C1LiveBindingCheckpoint) => {
      entries.push(event)
    }
  }
  const driver = new C1LiveBindingDriver({
    providerBinding: binding,
    evidenceSink: sink,
    budgetGuard: new C1HardBudgetGuard({
      perLeg: {
        maxProviderCalls: 24,
        maxToolCalls: 96,
        maxWallClockMs: 600000
      },
      study: {
        maxProviderCalls: 48,
        maxToolCalls: 192,
        maxWallClockMs: 1200000,
        maxLegs: 2
      }
    })
  })
  const observation = createC1ObservedReadTrace({
    observationId: 'initial',
    prompt: task.prompt,
    fixtureFiles: ['README.md'],
    taskPhase: 'INVESTIGATE'
  })
  const next = vi.fn(async () => response())
  const input = {
    studyId: 'accounting',
    task,
    stratum: task.stratum,
    pairId: 'pair',
    arm: 'NATIVE' as const,
    runId: 'run',
    fixtureContentSha256: task.fixtureRevision.fixtureContentSha256,
    fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
    runtimeSessionId: 'accounting-session',
    observationSource: {
      initialObservation: observation,
      next: () => observation
    },
    responseSource: { kind: 'SCRIPTED_FAKE' as const, next },
    startedAtMs: 100,
    nowMs: 100,
    wallClockMs: 0
  }
  return {
    driver,
    entries,
    sink,
    input,
    next,
    dispose: () => binding.dispose()
  }
}

describe('C1 failure-inclusive event accounting (fake provider only)', () => {
  it.each([1, 24])(
    'records normal completion at call %i without double counting',
    async (count) => {
      const f = await fixture()
      try {
        let calls = 0
        f.next.mockImplementation(async () => response(++calls === count ? 'COMPLETE' : 'CONTINUE'))
        await expect(f.driver.runLeg({ ...f.input, maxCalls: count })).resolves.toMatchObject({
          status: 'COMPLETED'
        })
        const accounting = deriveC1CallAccounting(f.entries, new Set(['run']), false)
        expect(accounting.allRecorded).toMatchObject({
          outboundPermits: count,
          normalizedResponses: count,
          responseRecorded: count,
          recordedResponseUsage: { totalTokens: count * 12 }
        })
        expect(accounting.incompleteLegsOnly.normalizedResponses).toBe(0)
        expect(JSON.stringify(accounting)).not.toContain('PRIVATE_RESPONSE_CANARY')
      } finally {
        f.dispose()
      }
    }
  )

  it('retains all 24 CONTINUE responses and forbids call 25 and the next leg', async () => {
    const f = await fixture()
    try {
      f.next.mockImplementation(async () => response('CONTINUE'))
      await expect(f.driver.runLeg(f.input)).rejects.toThrow('maxCalls=24')
      await expect(f.driver.runLeg({ ...f.input, runId: 'next' })).rejects.toThrow('terminal')
      expect(f.next).toHaveBeenCalledTimes(24)
      const accounting = deriveC1CallAccounting(f.entries, new Set(), false)
      expect(accounting.incompleteLegsOnly).toMatchObject({
        normalizedResponses: 24,
        responseRecorded: 24
      })
      expect(accounting.calls.every((row) => row.finalOracle === 'UNOBSERVED')).toBe(true)
    } finally {
      f.dispose()
    }
  })

  it('keeps an unanswered permit distinct from a response and retires the driver', async () => {
    const f = await fixture()
    try {
      f.next.mockRejectedValue(new Error('synthetic transport failure'))
      await expect(f.driver.runLeg(f.input)).rejects.toThrow('synthetic transport')
      await expect(f.driver.runLeg(f.input)).rejects.toThrow('terminal')
      const accounting = deriveC1CallAccounting(f.entries, new Set(), false)
      expect(accounting.allRecorded).toMatchObject({
        outboundPermits: 1,
        normalizedResponses: 0,
        permitsWithoutRecordedResponse: 1
      })
      expect(accounting.calls[0]?.receipt).toBeNull()
      expect(accounting.calls[0]?.toolExecutionsNotRecorded).toBeNull()
    } finally {
      f.dispose()
    }
  })

  it.each(['OUTBOUND_PERMITTED', 'RESPONSE_RECEIVED', 'RESPONSE_RECORDED'] as const)(
    'stops on %s persistence failure and reports an uncertain tail',
    async (phase) => {
      const f = await fixture()
      try {
        f.sink.append = async (event) => {
          if (event.phase === phase) throw new Error('synthetic disk failure')
          f.entries.push(event)
        }
        await expect(f.driver.runLeg(f.input)).rejects.toThrow('checkpoint')
        await expect(f.driver.runLeg(f.input)).rejects.toThrow('terminal')
        expect(f.next).toHaveBeenCalledTimes(phase === 'OUTBOUND_PERMITTED' ? 0 : 1)
        expect(deriveC1CallAccounting(f.entries, new Set(), true).completeness).toBe(
          'UNKNOWN_AFTER_WRITE_FAILURE'
        )
      } finally {
        f.dispose()
      }
    }
  )

  it('persists a partial tool batch when a later tool aborts the executor', async () => {
    const f = await fixture()
    try {
      f.next.mockResolvedValue({
        ...response(),
        toolRequests: ['one', 'two'].map((toolCallId) => ({
          toolCallId,
          toolName: 'read',
          argumentsJson: '{"path":"README.md"}'
        }))
      })
      const tools: C1LiveToolExecutor = {
        execute: async (input) => {
          await input.onToolExecution?.({
            toolCallId: 'one',
            toolName: 'read',
            result: 'SUCCESS'
          })
          throw new Error('synthetic interruption before second tool')
        }
      }
      await expect(f.driver.runLeg({ ...f.input, toolExecutor: tools })).rejects.toThrow(
        'synthetic interruption'
      )
      const accounting = deriveC1CallAccounting(f.entries, new Set(), false)
      expect(accounting.allRecorded).toMatchObject({
        normalizedResponses: 1,
        recordedToolExecutions: 1,
        responseRecorded: 0
      })
      expect(accounting.calls[0]?.toolExecutionsNotRecorded).toBe(1)
    } finally {
      f.dispose()
    }
  })

  it('halts the real sandbox batch when acknowledgement fails, leaving later files untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'c1-accounting-tools-'))
    try {
      await writeFile(join(root, 'file.txt'), 'old')
      const tools = new C1SandboxToolExecutor(root)
      const callback = vi.fn(async () => {
        throw new Error('disk unavailable')
      })
      await expect(
        tools.execute({
          previousObservation: {} as never,
          observationId: 'test',
          onToolExecution: callback,
          response: {
            ...response(),
            toolRequests: [
              {
                toolCallId: 'read',
                toolName: 'read',
                argumentsJson: '{"path":"file.txt"}'
              },
              {
                toolCallId: 'edit',
                toolName: 'edit',
                argumentsJson: '{"path":"file.txt","oldText":"old","newText":"new"}'
              }
            ]
          }
        })
      ).rejects.toThrow('disk unavailable')
      expect(callback).toHaveBeenCalledTimes(1)
      expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('old')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('projects an interrupted 24-call study into the manifest while keeping legacy counters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'c1-accounting-study-'))
    let responses = 0
    let factories = 0
    try {
      const report = await new C1StudyOrchestrator({
        repoRoot: REPO_ROOT,
        outputRoot: root,
        studyId: 'c1-20260908-c1-feasibility-v1-aaaaaaaa',
        runId: 'C1_ACCOUNTING_TEST',
        executionMode: 'CREDENTIAL_FREE_ACCOUNTING_TEST',
        responseSourceKind: 'SCRIPTED_FAKE',
        dryRun: false,
        maxCalls: 24,
        responseSourceFactory: () => {
          factories += 1
          return {
            kind: 'SCRIPTED_FAKE',
            next: async () => {
              responses += 1
              return {
                ...response('CONTINUE'),
                responseId: `r-${responses}`,
                toolRequests: [
                  {
                    toolCallId: `read-${responses}`,
                    toolName: 'read',
                    argumentsJson: '{"path":"README.md"}'
                  }
                ]
              }
            }
          }
        },
        observationSourceFactory: (input) =>
          C1LiveTaskObservationSource.fromFixture({
            task: input.task,
            runId: input.plan.runId,
            fixtureRoot: input.fixtureRoot
          }),
        toolExecutorFactory: (input) => new C1SandboxToolExecutor(input.fixtureRoot)
      }).run()
      expect(factories).toBe(1)
      expect(responses).toBe(24)
      expect(report.studyTerminal).toBe(true)
      expect(report.responseCalls).toBe(0)
      expect(report.legsCompleted).toBe(0)
      const manifest = JSON.parse(
        await readFile(join(report.reportDir!, 'run-manifest.json'), 'utf8')
      )
      expect(manifest.counterScope).toBe('COMPLETED_LEGS_ONLY')
      expect(manifest.callAccounting.allRecorded).toMatchObject({
        outboundPermits: 24,
        normalizedResponses: 24,
        recordedToolExecutions: 24,
        responseRecorded: 24
      })
      const persisted = (await readFile(join(report.reportDir!, 'checkpoints.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(deriveC1CallAccounting(persisted, new Set(), false)).toEqual(manifest.callAccounting)
      expect(
        manifest.callAccounting.calls.every(
          (row: { finalOracle: string }) => row.finalOracle === 'UNOBSERVED'
        )
      ).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30000)
})
