import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  C1AuthorizedProviderResponseSource,
  C1LiveTaskObservationSource,
  C1_PREFLIGHT_ARTIFACT_NAMES,
  C1SandboxToolExecutor,
  C1ScriptedResponseSource,
  C1ScriptedObservationSource,
  C1StudyOrchestrator,
  changedC1FixturePaths,
  createC1ObservedReadTrace,
  loadC1FrozenStudy,
  materializeFreshC1Fixture,
  nodeVersionSatisfiesC1Range,
  runC1LiveStudy,
  runC1StudyDryRun,
  runC1TaskOracles,
  verifyC1FixtureBinding,
  writableScopePass
} from '../src'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')

function amendedProviderResponse(input: {
  readonly id: string
  readonly finishReason?: string
  readonly toolCalls?: readonly unknown[]
  readonly usage?: Record<string, unknown>
}): Response {
  return new Response(
    JSON.stringify({
      id: input.id,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'amendment compatibility response',
            ...(input.toolCalls === undefined ? {} : { tool_calls: input.toolCalls })
          },
          finish_reason: input.finishReason ?? 'stop'
        }
      ],
      usage: input.usage ?? {
        prompt_tokens: 21,
        completion_tokens: 5,
        total_tokens: 26,
        cached_tokens: 3
      }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

describe('C1 study-level credential-free orchestration', () => {
  it('uses a fixed non-ground-truth bootstrap and forwards only real tool observations', async () => {
    if (!nodeVersionSatisfiesC1Range()) return

    const study = await loadC1FrozenStudy(REPO_ROOT)
    const task = study.tasks[0]
    if (task === undefined) throw new Error('frozen C1 study has no task')
    const fixtureBinding = await verifyC1FixtureBinding(study, task)
    const fixture = await materializeFreshC1Fixture(fixtureBinding.sourcePath)
    try {
      const source = await C1LiveTaskObservationSource.fromFixture({
        task,
        runId: 'c1-20260905-c1-live-bootstrap-NATIVE-aaaaaaaa',
        fixtureRoot: fixture.path
      })
      const expectedBootstrapContent = await readFile(join(fixture.path, 'README.md'), 'utf8')
      const bootstrapPaths = source.initialObservation.messages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) =>
          Array.isArray(message.content)
            ? message.content
                .filter(
                  (block): block is {
                    readonly type: 'toolCall'
                    readonly arguments: { readonly path?: unknown }
                  } =>
                    typeof block === 'object' &&
                    block !== null &&
                    'type' in block &&
                    block.type === 'toolCall' &&
                    'arguments' in block &&
                    typeof block.arguments === 'object' &&
                    block.arguments !== null
                )
                .map((block) => block.arguments.path)
                .filter((path): path is string => typeof path === 'string')
            : []
        )
      expect(bootstrapPaths).toEqual(['README.md'])
      const bootstrapContent = source.initialObservation.messages
        .filter((message) => message.role === 'toolResult')
        .map((message) =>
          Array.isArray(message.content)
            ? message.content
                .filter(
                  (block): block is { readonly type: 'text'; readonly text: string } =>
                    typeof block === 'object' &&
                    block !== null &&
                    'type' in block &&
                    block.type === 'text' &&
                    'text' in block &&
                    typeof block.text === 'string'
                )
                .map((block) => block.text)
                .join('')
            : message.content ?? ''
        )
        .join('\n')
      expect(bootstrapContent).toContain(expectedBootstrapContent)
      expect(source.initialObservation.sourceLifecycleSignals).toBeUndefined()

      const toolObservation = {
        ...source.initialObservation,
        observationId: 'c1-live-after-tool'
      }
      expect(
        source.next({
          callOrdinal: 1,
          previousObservation: source.initialObservation,
          previousExecution: {} as never,
          response: {} as never,
          toolObservation
        })
      ).toBe(toolObservation)
    } finally {
      await fixture.cleanup()
    }
  })

  it('runs frozen objective and regression oracles as task evidence', async () => {
    if (!nodeVersionSatisfiesC1Range()) return

    const study = await loadC1FrozenStudy(REPO_ROOT)
    const task = study.tasks[0]
    if (task === undefined) throw new Error('frozen C1 study has no task')
    const fixtureBinding = await verifyC1FixtureBinding(study, task)
    const fixture = await materializeFreshC1Fixture(fixtureBinding.sourcePath)
    try {
      const evaluation = await runC1TaskOracles({ task, fixtureRoot: fixture.path })

      expect(evaluation.status).toBe('TASK_FAILURE')
      expect(evaluation.taskOutcome).toBe('FAILURE')
      expect(evaluation.objective.status).toBe('FAIL')
      expect(evaluation.regression.status).toBe('PASS')
      expect(evaluation.objective.stdoutSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(evaluation.regression.stderrSha256).toMatch(/^[0-9a-f]{64}$/)

      expect(evaluation.writableScopePass).toBe(true)

      const unavailable = await runC1TaskOracles({
        task: {
          ...task,
          objectiveOracle: {
            ...task.objectiveOracle,
            args: ['-e', 'setTimeout(() => {}, 1000)'],
            timeoutMs: 10
          }
        },
        fixtureRoot: fixture.path
      })
      expect(unavailable.status).toBe('HARNESS_CONTRACT_FAILURE')
      expect(unavailable.taskOutcome).toBe('NOT_OBSERVED')
      expect(unavailable.objective.status).toBe('UNAVAILABLE')
    } finally {
      await fixture.cleanup()
    }
  }, 30_000)

  it('reports writable-scope violations as hard failures before task oracle classification', async () => {
    if (!nodeVersionSatisfiesC1Range()) return

    const outputRoot = await mkdtemp(join('/tmp', 'canvas-c1-study-scope-gate-test-'))
    let taskOracleCalls = 0
    try {
      const report = await new C1StudyOrchestrator({
        repoRoot: REPO_ROOT,
        outputRoot,
        studyId: 'c1-20260905-c1-feasibility-v1-eeeeeeee',
        runId: 'C1_WRITABLE_SCOPE_GATE_REGRESSION_V1',
        executionMode: 'CREDENTIAL_FREE_SCOPE_GATE_REGRESSION',
        responseSourceKind: 'SCRIPTED_FAKE',
        dryRun: false,
        maxCalls: 1,
        responseSourceFactory: async (input) => {
          const path = 'README.md'
          const originalContent = await readFile(join(input.fixtureRoot, path), 'utf8')
          return new C1ScriptedResponseSource([
            {
              responseId: `${input.plan.runId}-response-01`,
              assistantMessageCount: 1,
              assistantContent: 'scope gate regression',
              usage: {
                inputTokens: 10,
                outputTokens: 5,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 15,
                usageSource: 'SCRIPTED_FAKE'
              },
              toolRequests: [
                {
                  toolCallId: `${input.plan.runId}-edit-01`,
                  toolName: 'edit',
                  argumentsJson: JSON.stringify({
                    path,
                    oldText: originalContent,
                    newText: `${originalContent}\nSCOPE_GATE_REGRESSION\n`
                  })
                }
              ],
              toolExecutions: [],
              outcome: 'COMPLETE'
            }
          ])
        },
        observationSourceFactory: (input) =>
          new C1ScriptedObservationSource([
            createC1ObservedReadTrace({
              observationId: `${input.plan.runId}-initial`,
              prompt: input.task.prompt,
              fixtureFiles: ['README.md'],
              taskPhase: 'INVESTIGATE'
            })
          ]),
        toolExecutorFactory: (input) => new C1SandboxToolExecutor(input.fixtureRoot),
        evaluateTask: async (input) => {
          taskOracleCalls += 1
          return runC1TaskOracles({ task: input.task, fixtureRoot: input.fixtureRoot })
        }
      }).run()

      expect(report.status).toBe('FAIL')
      expect(report.legsAttempted).toBe(1)
      expect(report.legsCompleted).toBe(0)
      expect(report.failures[0]?.code).toBe('WRITABLE_SCOPE_FAILURE')
      expect(taskOracleCalls).toBe(0)
      expect(report.fixtureSandboxesCreated).toBe(1)
      expect(report.fixtureSandboxesCleaned).toBe(1)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 30_000)

  it('rejects direct live entrypoint calls without an explicit authorization capability', async () => {
    const outputRoot = await mkdtemp(join('/tmp', 'canvas-c1-live-authorization-gate-test-'))
    let fetchCalls = 0
    try {
      await expect(
        runC1LiveStudy({
          repoRoot: REPO_ROOT,
          outputRoot,
          authorization: undefined as never,
          apiKey: 'c1-test-only-api-key',
          fetchImpl: async () => {
            fetchCalls += 1
            throw new Error('fetch must not be called')
          }
        })
      ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
      expect(await readdir(outputRoot)).toEqual([])
      expect(fetchCalls).toBe(0)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('rejects a mismatched live revision before claiming an identity or fetching', async () => {
    const outputRoot = await mkdtemp(join('/tmp', 'canvas-c1-live-entrypoint-gate-test-'))
    let fetchCalls = 0
    try {
      await expect(
        runC1LiveStudy({
          repoRoot: REPO_ROOT,
          outputRoot,
          authorization: {
            decision: 'AUTHORIZED',
            studyId: 'c1-20260905-c1-feasibility-v1-dddddddd',
            executionRevision: '0000000000000000000000000000000000000000'
          },
          apiKey: 'c1-test-only-api-key',
          fetchImpl: async () => {
            fetchCalls += 1
            throw new Error('fetch must not be called')
          }
        })
      ).rejects.toMatchObject({ code: 'CONTRACT_BINDING_MISMATCH' })
      expect(await readdir(outputRoot)).toEqual([])
      expect(fetchCalls).toBe(0)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('fails closed before claiming an identity outside the frozen Node range', async () => {
    if (nodeVersionSatisfiesC1Range()) return

    const report = await runC1StudyDryRun({ repoRoot: REPO_ROOT })

    expect(report.status).toBe('FAIL')
    expect(report.providerCalls).toBe(0)
    expect(report.networkRequests).toBe(0)
    expect(report.studyId).toBeNull()
    expect(report.failures[0]?.code).toBe('NODE_RANGE_MISMATCH')
  })

  it('runs all frozen legs through one driver and writes metadata-only artifacts', async () => {
    if (!nodeVersionSatisfiesC1Range()) return

    const outputRoot = await mkdtemp(join('/tmp', 'canvas-c1-study-test-'))
    try {
      const report = await runC1StudyDryRun({
        repoRoot: REPO_ROOT,
        outputRoot
      })

      expect(report.status).toBe('PASS')
      expect(report.providerCalls).toBe(0)
      expect(report.networkRequests).toBe(0)
      expect(report.driverInstances).toBe(1)
      expect(report.legsAttempted).toBe(64)
      expect(report.legsCompleted).toBe(64)
      expect(report.fakeProviderCallPermits).toBe(192)
      expect(report.fakeResponseCalls).toBe(192)
      expect(report.toolExecutions).toBe(192)
      expect(report.fixtureSandboxesCreated).toBe(64)
      expect(report.fixtureSandboxesCleaned).toBe(64)
      expect(report.legs.every((leg) => leg.changedPaths.length > 0)).toBe(true)
      expect(report.legs.every((leg) => leg.writableScopePass)).toBe(true)
      expect(report.legs.every((leg) => leg.fixtureChangedByDryRunTool)).toBe(true)
      expect(report.failures).toEqual([])
      expect(report.gates.every((item) => item.verdict === 'PASS')).toBe(true)
      expect(report.legs.filter((leg) => leg.arm === 'NATIVE')).toHaveLength(32)
      expect(report.legs.filter((leg) => leg.arm === 'RUNTIME')).toHaveLength(32)
      expect(report.artifacts.map((artifact) => artifact.name)).toEqual(
        expect.arrayContaining([...C1_PREFLIGHT_ARTIFACT_NAMES])
      )

      const manifest = await readFile(join(report.reportDir!, 'run-manifest.json'), 'utf8')
      expect(manifest).toContain('"providerCalls": 0')
      expect(manifest).toContain('"networkRequests": 0')
      expect(manifest).not.toMatch(
        /providerBoundMessages|argumentsJson|assistantContent|toolResultContent/
      )
      const firstLeg = report.legs[0]
      if (firstLeg === undefined) throw new Error('study dry run produced no completed legs')
      const legManifest = JSON.parse(
        await readFile(join(report.reportDir!, 'legs', firstLeg.runId, 'leg-manifest.json'), 'utf8')
      ) as Record<string, unknown>
      expect(legManifest).toMatchObject({
        fixtureTreeObjectIdVerified: true,
        fixtureHashVerified: true,
        fixtureCleaned: true,
        writableScopePass: true,
        changedPaths: firstLeg.changedPaths
      })
      for (const name of C1_PREFLIGHT_ARTIFACT_NAMES) {
        const content = await readFile(join(report.reportDir!, name), 'utf8')
        expect(content).not.toMatch(
          /providerBoundMessages|argumentsJson|assistantContent|rawProviderPayload|authorizationHeader|toolResultContent/
        )
      }
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 30_000)

  it('stops before the next leg when the operator kill switch is tripped', async () => {
    if (!nodeVersionSatisfiesC1Range()) return

    const outputRoot = await mkdtemp(join('/tmp', 'canvas-c1-study-kill-test-'))
    const signals = new EventEmitter()
    try {
      const report = await runC1StudyDryRun({
        repoRoot: REPO_ROOT,
        outputRoot,
        signalSource: signals,
        beforeLeg: (plan) => {
          if (plan.legIndex === 1) signals.emit('SIGINT')
        }
      })

      expect(report.status).toBe('FAIL')
      expect(report.operatorSignal).toBe('SIGINT')
      expect(report.studyTerminal).toBe(true)
      expect(report.legsCompleted).toBe(1)
      expect(report.fakeResponseCalls).toBe(3)
      expect(report.failures.some((failure) => failure.code === 'KILL_SWITCH_BLOCKED')).toBe(true)
      expect(report.gates.some((item) => item.gateId === 'artifact_set')).toBe(true)
      const manifest = JSON.parse(
        await readFile(join(report.reportDir!, 'run-manifest.json'), 'utf8')
      ) as {
        attemptedLegs: number
        completedLegs: number
      }
      expect(manifest.attemptedLegs).toBe(1)
      expect(manifest.completedLegs).toBe(1)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('computes actual changed paths and rejects an out-of-scope mutation', () => {
    const before = new Map([
      ['src/allowed.js', 'before'],
      ['src/untouched.js', 'same']
    ])
    const after = new Map([
      ['src/allowed.js', 'after'],
      ['src/untouched.js', 'same'],
      ['src/escape.js', 'unexpected']
    ])

    expect(changedC1FixturePaths(before, after)).toEqual(['src/allowed.js', 'src/escape.js'])
    expect(writableScopePass(['src/allowed.js'], ['src/allowed.js'])).toBe(true)
    expect(writableScopePass(changedC1FixturePaths(before, after), ['src/allowed.js'])).toBe(false)
  })

  it('uses the real clock for non-dry-run wall-clock enforcement', async () => {
    if (!nodeVersionSatisfiesC1Range()) return

    const outputRoot = await mkdtemp(join('/tmp', 'canvas-c1-study-clock-test-'))
    const realDateNow = Date.now.bind(Date)
    const dateNow = vi.spyOn(Date, 'now')
    let clockActive = false
    let dateReads = 0
    dateNow.mockImplementation(() => {
      if (!clockActive) return realDateNow()
      return dateReads++ === 0 ? 0 : 600_001
    })
    let responseCalls = 0
    try {
      const report = await new C1StudyOrchestrator({
        repoRoot: REPO_ROOT,
        outputRoot,
        studyId: 'c1-20260905-c1-feasibility-v1-aaaaaaaa',
        runId: 'C1_LIVE_CLOCK_LEG_TEST_V1',
        executionMode: 'CREDENTIAL_FREE_CLOCK_REGRESSION',
        responseSourceKind: 'SCRIPTED_FAKE',
        dryRun: false,
        maxCalls: 1,
        responseSourceFactory: () => {
          clockActive = true
          return {
            kind: 'SCRIPTED_FAKE' as const,
            next: async () => {
              responseCalls += 1
              throw new Error('response source must not run after a wall-clock breach')
            }
          }
        },
        observationSourceFactory: (input) =>
          new C1ScriptedObservationSource([
            createC1ObservedReadTrace({
              observationId: `${input.plan.runId}-initial`,
              prompt: input.task.prompt,
              fixtureFiles: [input.task.expectedWritablePaths[0] ?? 'src/target.js'],
              taskPhase: 'INVESTIGATE'
            })
          ]),
        toolExecutorFactory: () => ({
          execute: async () => {
            throw new Error('tool executor must not run after a wall-clock breach')
          }
        })
      }).run()

      expect(report.status).toBe('FAIL')
      expect(report.studyTerminal).toBe(true)
      expect(report.legsAttempted).toBe(1)
      expect(report.legsCompleted).toBe(0)
      expect(report.failures[0]?.code).toBe('BUDGET_BREACH')
      expect(responseCalls).toBe(0)
      expect(report.providerCalls).toBe(0)
      expect(report.networkRequests).toBe(0)
    } finally {
      dateNow.mockRestore()
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('aborts an in-flight authorized fetch through the study kill switch', async () => {
    if (!nodeVersionSatisfiesC1Range()) return

    const outputRoot = await mkdtemp(join('/tmp', 'canvas-c1-study-abort-test-'))
    const signals = new EventEmitter()
    let resolveFetchStarted!: () => void
    const fetchStarted = new Promise<void>((resolveFetch) => {
      resolveFetchStarted = resolveFetch
    })
    let fetchCalls = 0
    let fetchSignal: AbortSignal | undefined
    const factoryLegIndexes: number[] = []
    try {
      const runPromise = new C1StudyOrchestrator({
        repoRoot: REPO_ROOT,
        outputRoot,
        studyId: 'c1-20260905-c1-feasibility-v1-bbbbbbbb',
        runId: 'C1_LIVE_ABORT_INTEGRATION_TEST_V1',
        executionMode: 'CREDENTIAL_FREE_ABORT_REGRESSION',
        responseSourceKind: 'AUTHORIZED_PROVIDER',
        dryRun: false,
        maxCalls: 1,
        signalSource: signals,
        responseSourceFactory: (input) => {
          factoryLegIndexes.push(input.plan.legIndex)
          return new C1AuthorizedProviderResponseSource({
            providerBinding: input.providerBinding,
            apiKey: 'c1-test-only-api-key',
            requestTimeoutMs: 60_000,
            fetchImpl: async (_input, init) => {
              fetchCalls += 1
              fetchSignal = init?.signal ?? undefined
              resolveFetchStarted()
              return await new Promise<Response>((_resolveResponse, reject) => {
                const signal = init?.signal
                if (signal?.aborted) {
                  reject(new Error('synthetic fetch aborted'))
                  return
                }
                signal?.addEventListener(
                  'abort',
                  () => reject(new Error('synthetic fetch aborted')),
                  {
                    once: true
                  }
                )
              })
            }
          })
        },
        observationSourceFactory: (input) =>
          new C1ScriptedObservationSource([
            createC1ObservedReadTrace({
              observationId: `${input.plan.runId}-initial`,
              prompt: input.task.prompt,
              fixtureFiles: [input.task.expectedWritablePaths[0] ?? 'src/target.js'],
              taskPhase: 'INVESTIGATE'
            })
          ]),
        toolExecutorFactory: () => ({
          execute: async () => {
            throw new Error('tool executor must not run during the hanging fetch')
          }
        })
      }).run()

      await fetchStarted
      signals.emit('SIGINT')
      const report = await runPromise

      expect(fetchCalls).toBe(1)
      expect(fetchSignal?.aborted).toBe(true)
      expect(report.failures.some((failure) => failure.code === 'KILL_SWITCH_BLOCKED')).toBe(true)
      expect(report.studyTerminal).toBe(true)
      expect(report.legsAttempted).toBe(1)
      expect(report.legsCompleted).toBe(0)
      expect(report.fixtureSandboxesCreated).toBe(1)
      expect(report.fixtureSandboxesCleaned).toBe(1)
      expect(factoryLegIndexes).toEqual([0])
      expect(report.providerCalls).toBe(0)
      expect(report.networkRequests).toBe(0)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('keeps the first study leg valid when the provider omits cache-write usage', async () => {
    if (!nodeVersionSatisfiesC1Range()) return

    const outputRoot = await mkdtemp(join('/tmp', 'canvas-c1-study-usage-amendment-test-'))
    const signals = new EventEmitter()
    const factoryLegIndexes: number[] = []
    let fetchCalls = 0
    try {
      const report = await new C1StudyOrchestrator({
        repoRoot: REPO_ROOT,
        outputRoot,
        studyId: 'c1-20260905-c1-feasibility-v1-cccccccc',
        runId: 'C1_USAGE_AMENDMENT_COMPATIBILITY_TEST_V1',
        executionMode: 'CREDENTIAL_FREE_USAGE_AMENDMENT_REGRESSION',
        responseSourceKind: 'AUTHORIZED_PROVIDER',
        dryRun: false,
        maxCalls: 2,
        signalSource: signals,
        beforeLeg: (plan) => {
          if (plan.legIndex === 1) signals.emit('SIGINT')
        },
        responseSourceFactory: async (input) => {
          factoryLegIndexes.push(input.plan.legIndex)
          const editPath = input.task.expectedWritablePaths[0]
          if (editPath === undefined) throw new Error('usage compatibility task has no edit path')
          const originalContent = await readFile(join(input.fixtureRoot, editPath), 'utf8')
          let responseIndex = 0
          const responses = [
            amendedProviderResponse({
              id: `${input.plan.runId}-response-01`,
              finishReason: 'tool_calls',
              toolCalls: [
                {
                  id: `${input.plan.runId}-edit-01`,
                  type: 'function',
                  function: {
                    name: 'edit',
                    arguments: JSON.stringify({
                      path: editPath,
                      oldText: originalContent,
                      newText: `AMENDMENT_COMPATIBILITY_PROBE_${String(input.plan.legIndex)}\n`
                    })
                  }
                }
              ]
            }),
            amendedProviderResponse({
              id: `${input.plan.runId}-response-02`
            })
          ]
          return new C1AuthorizedProviderResponseSource({
            providerBinding: input.providerBinding,
            apiKey: 'c1-test-only-api-key',
            fetchImpl: async () => {
              fetchCalls += 1
              const response = responses[responseIndex]
              responseIndex += 1
              if (response === undefined) throw new Error('usage compatibility response exhausted')
              return response
            }
          })
        },
        observationSourceFactory: (input) =>
          new C1ScriptedObservationSource([
            createC1ObservedReadTrace({
              observationId: `${input.plan.runId}-initial`,
              prompt: input.task.prompt,
              fixtureFiles: [input.task.expectedWritablePaths[0] ?? 'src/target.js'],
              taskPhase: 'INVESTIGATE'
            })
          ]),
        toolExecutorFactory: (input) => new C1SandboxToolExecutor(input.fixtureRoot),
        expectedProviderCallPermits: 2,
        expectedResponseCalls: 2,
        expectedToolExecutions: 1
      }).run()

      expect(report.status).toBe('FAIL')
      expect(report.legsAttempted).toBe(1)
      expect(report.legsCompleted).toBe(1)
      expect(report.studyTerminal).toBe(true)
      expect(report.operatorSignal).toBe('SIGINT')
      expect(report.providerCalls).toBe(0)
      expect(report.networkRequests).toBe(0)
      expect(fetchCalls).toBe(2)
      expect(factoryLegIndexes).toEqual([0])

      const usageLedger = await readFile(
        join(report.reportDir!, 'provider-usage-ledger.jsonl'),
        'utf8'
      )
      expect(usageLedger).toContain(
        '"cacheWriteTokens":{"status":"UNAVAILABLE","reason":"NOT_REPORTED_BY_PROVIDER"}'
      )
      expect(usageLedger).toContain('"usageSource":"PROVIDER_REPORTED"')
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 60_000)
})
