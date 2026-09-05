import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_AUTHORIZED_PROVIDER_MAX_TOKENS,
  C1AuthorizedProviderResponseSource,
  C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE,
  C1_SYSTEM_INSTRUCTION,
  C1LiveBindingDriver,
  C1SandboxToolExecutor,
  C1HardBudgetGuard,
  C1ScriptedObservationSource,
  C1ScriptedResponseSource,
  C1JsonlLiveBindingEvidenceSink,
  C1PreflightFailure,
  type C1LiveToolExecutor,
  captureC1PreflightArm,
  createC1ObservedReadTrace,
  loadC1FrozenStudy,
  prepareC1StrictProvider
} from '../src'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const API_KEY_SENTINEL = 'authorized-provider-test-secret'

function providerResponse(input: {
  readonly id: string
  readonly finishReason?: string
  readonly toolCalls?: readonly unknown[]
  readonly content?: string | null
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
            content: input.content === undefined ? 'provider response' : input.content,
            ...(input.toolCalls === undefined ? {} : { tool_calls: input.toolCalls })
          },
          finish_reason: input.finishReason ?? 'stop'
        }
      ],
      usage: input.usage ?? {
        prompt_tokens: 21,
        completion_tokens: 5,
        total_tokens: 26,
        cached_tokens: 3,
        cache_write_tokens: 0
      }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

async function bindingAndTask() {
  const study = await loadC1FrozenStudy(REPO_ROOT)
  const providerBinding = await prepareC1StrictProvider({
    runIdentity: 'c1-20260903-authorized-provider-test-aaaaaaaa'
  })
  return { providerBinding, task: study.tasks[0]! }
}

function requestFor(
  task: Awaited<ReturnType<typeof bindingAndTask>>['task'],
  providerConfigHash: string
) {
  return {
    capture: captureC1PreflightArm({
      task,
      stratum: task.stratum,
      pairId: 'c1-authorized-provider-p01',
      arm: 'NATIVE',
      runId: 'c1-20260903-authorized-provider-native-aaaaaaaa',
      fixtureContentSha256: task.fixtureRevision.fixtureContentSha256,
      treatmentReady: true,
      providerConfigHash,
      providerBoundSourceKeys: ['repo/src/target.js'],
      modelVisibleSemanticContextFingerprint: 'authorized-provider-fingerprint'
    }),
    providerBoundMessages: [
      { role: 'user', content: [{ type: 'text', text: 'inspect the target' }] }
    ],
    structuralEnvelope: C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE
  }
}

async function runAuthorizedDriver(input: {
  readonly providerBinding: Awaited<ReturnType<typeof bindingAndTask>>['providerBinding']
  readonly task: Awaited<ReturnType<typeof bindingAndTask>>['task']
  readonly responses: readonly Response[]
  readonly runId: string
  readonly pairId: string
  readonly toolExecutor?: C1SandboxToolExecutor
}) {
  const calls: {
    input: Parameters<typeof fetch>[0]
    init: Parameters<typeof fetch>[1]
  }[] = []
  let responseCursor = 0
  const source = new C1AuthorizedProviderResponseSource({
    providerBinding: input.providerBinding,
    apiKey: API_KEY_SENTINEL,
    fetchImpl: async (requestInput, init) => {
      calls.push({ input: requestInput, init })
      const response = input.responses[responseCursor]
      responseCursor += 1
      if (response === undefined) throw new Error('authorized provider test response exhausted')
      return response
    }
  })
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-authorized-provider-driver-'))
  try {
    const evidenceSink = new C1JsonlLiveBindingEvidenceSink(
      join(checkpointRoot, 'checkpoints.jsonl')
    )
    const driver = new C1LiveBindingDriver({
      providerBinding: input.providerBinding,
      budgetGuard: new C1HardBudgetGuard({
        perLeg: {
          maxProviderCalls: 24,
          maxToolCalls: 96,
          maxWallClockMs: 600000
        },
        study: {
          maxProviderCalls: 24,
          maxToolCalls: 96,
          maxWallClockMs: 600000,
          maxLegs: 1
        }
      }),
      evidenceSink
    })
    const observation = createC1ObservedReadTrace({
      observationId: `${input.runId}-observation`,
      prompt: input.task.prompt,
      fixtureFiles: ['src/target.js']
    })
    const result = await driver.runLeg({
      studyId: `${input.runId}-study`,
      task: input.task,
      stratum: input.task.stratum,
      pairId: input.pairId,
      arm: 'NATIVE',
      runId: input.runId,
      fixtureContentSha256: input.task.fixtureRevision.fixtureContentSha256,
      fixtureTreeObjectId: input.task.fixtureRevision.fixtureTreeObjectId,
      runtimeSessionId: `${input.runId}-session`,
      observationSource: new C1ScriptedObservationSource(
        Array.from({ length: input.responses.length }, () => observation)
      ),
      responseSource: source,
      ...(input.toolExecutor === undefined ? {} : { toolExecutor: input.toolExecutor }),
      maxCalls: input.responses.length,
      startedAtMs: 100,
      nowMs: 100,
      wallClockMs: 0
    })
    const firstCall = calls[0]
    if (firstCall === undefined) throw new Error('authorized provider test made no request')
    return {
      result,
      calls,
      body: JSON.parse(String(firstCall.init?.body)) as Record<string, unknown>,
      bodies: calls.map((call) => JSON.parse(String(call.init?.body)) as Record<string, unknown>),
      evidenceSink,
      checkpointText: await readFile(join(checkpointRoot, 'checkpoints.jsonl'), 'utf8')
    }
  } finally {
    await rm(checkpointRoot, { recursive: true, force: true })
  }
}

describe('C1 authorized provider response source', () => {
  it('binds the actual driver path to the executor-owned envelope and provider usage', async () => {
    const { providerBinding, task } = await bindingAndTask()
    try {
      const { result, calls, body, evidenceSink } = await runAuthorizedDriver({
        providerBinding,
        task,
        responses: [providerResponse({ id: 'authorized-response-01' })],
        runId: 'c1-20260903-authorized-provider-envelope-native-aaaaaaaa',
        pairId: 'c1-authorized-provider-envelope-p01'
      })
      expect(result.evidence).toHaveLength(1)
      expect(result.evidence[0]).toMatchObject({
        responseId: 'authorized-response-01',
        responseSource: 'AUTHORIZED_PROVIDER',
        usage: {
          inputTokens: 21,
          outputTokens: 5,
          cacheReadTokens: 3,
          cacheWriteTokens: 0,
          totalTokens: 26,
          usageSource: 'PROVIDER_REPORTED'
        }
      })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.input).toBe('https://api.stepfun.com/step_plan/v1/chat/completions')
      expect(calls[0]?.init?.method).toBe('POST')
      expect(calls[0]?.init?.headers).toMatchObject({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY_SENTINEL}`
      })
      expect(body).toMatchObject({
        model: 'step-3.7-flash',
        stream: false,
        max_tokens: C1_AUTHORIZED_PROVIDER_MAX_TOKENS
      })
      expect(body['tools']).toEqual(C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE.tools)
      expect(body['messages']).toEqual([
        { role: 'system', content: C1_SYSTEM_INSTRUCTION },
        { role: 'user', content: task.prompt },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1-observation-c1-20260903-authorized-provider-envelope-native-aaaaaaaa-observation-1',
              type: 'function',
              function: { name: 'read', arguments: '{"path":"src/target.js"}' }
            }
          ]
        },
        {
          role: 'tool',
          content: 'observation captured for src/target.js',
          tool_call_id:
            'c1-observation-c1-20260903-authorized-provider-envelope-native-aaaaaaaa-observation-1'
        }
      ])
      expect(JSON.stringify(evidenceSink.checkpoints)).not.toContain(API_KEY_SENTINEL)
    } finally {
      providerBinding.dispose()
    }
  })

  it('runs through the shared C1 driver and marks provider-backed evidence as network-sent', async () => {
    const { providerBinding, task } = await bindingAndTask()
    let fetchCalls = 0
    const source = new C1AuthorizedProviderResponseSource({
      providerBinding,
      apiKey: API_KEY_SENTINEL,
      fetchImpl: async () => {
        fetchCalls += 1
        return providerResponse({ id: 'driver-response-01' })
      }
    })
    const checkpointRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-authorized-provider-test-'))
    try {
      const evidenceSink = new C1JsonlLiveBindingEvidenceSink(
        join(checkpointRoot, 'checkpoints.jsonl')
      )
      const driver = new C1LiveBindingDriver({
        providerBinding,
        budgetGuard: new C1HardBudgetGuard({
          perLeg: {
            maxProviderCalls: 24,
            maxToolCalls: 96,
            maxWallClockMs: 600000
          },
          study: {
            maxProviderCalls: 24,
            maxToolCalls: 96,
            maxWallClockMs: 600000,
            maxLegs: 1
          }
        }),
        evidenceSink
      })
      const observation = createC1ObservedReadTrace({
        observationId: 'c1-authorized-provider-driver-observation',
        prompt: task.prompt,
        fixtureFiles: ['src/target.js']
      })
      const result = await driver.runLeg({
        studyId: 'c1-20260903-authorized-provider-study-aaaaaaaa',
        task,
        stratum: task.stratum,
        pairId: 'c1-authorized-provider-driver-p01',
        arm: 'NATIVE',
        runId: 'c1-20260903-authorized-provider-driver-native-aaaaaaaa',
        fixtureContentSha256: task.fixtureRevision.fixtureContentSha256,
        fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
        runtimeSessionId: 'c1-authorized-provider-driver-session-v1',
        observationSource: new C1ScriptedObservationSource([observation]),
        responseSource: source,
        startedAtMs: 100,
        nowMs: 100,
        wallClockMs: 0
      })
      expect(result.evidence).toHaveLength(1)
      expect(result.evidence[0]).toMatchObject({
        responseSource: 'AUTHORIZED_PROVIDER',
        networkSent: true,
        usage: { usageSource: 'PROVIDER_REPORTED' }
      })
      expect(result.budget.providerCalls).toBe(1)
      expect(fetchCalls).toBe(1)
      expect(source.requestCount).toBe(1)
      expect(JSON.stringify(evidenceSink.checkpoints)).not.toContain(API_KEY_SENTINEL)
    } finally {
      providerBinding.dispose()
      await rm(checkpointRoot, { recursive: true, force: true })
    }
  })

  it.each([
    ['read', { path: 'src/target.js' }],
    ['edit', { path: 'src/target.js', oldText: 'before', newText: 'after' }],
    ['bash', { command: 'pnpm test --filter context-benchmarks' }]
  ] as const)(
    'preserves lossless %s tool arguments in the in-memory provider response',
    async (toolName, args) => {
      const { providerBinding, task } = await bindingAndTask()
      try {
        const argumentsJson = JSON.stringify(args)
        const source = new C1AuthorizedProviderResponseSource({
          providerBinding,
          apiKey: API_KEY_SENTINEL,
          fetchImpl: async () =>
            providerResponse({
              id: `${toolName}-request-response`,
              toolCalls: [
                {
                  id: `${toolName}-request-01`,
                  type: 'function',
                  function: { name: toolName, arguments: argumentsJson }
                }
              ],
              finishReason: 'tool_calls'
            })
        })
        const response = await source.next(requestFor(task, providerBinding.providerConfigHash))
        expect(response.toolRequests).toEqual([
          { toolCallId: `${toolName}-request-01`, toolName, argumentsJson }
        ])
        expect(response.toolExecutions).toEqual([])
      } finally {
        providerBinding.dispose()
      }
    }
  )

  it('executes a provider read request and carries the exact result into the next request', async () => {
    const { providerBinding, task } = await bindingAndTask()
    const sandboxRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-tool-loop-read-'))
    try {
      await mkdir(join(sandboxRoot, 'src'), { recursive: true })
      await writeFile(join(sandboxRoot, 'src', 'target.js'), 'fixture read result\n', 'utf8')
      const argumentsJson = JSON.stringify({ path: 'src/target.js' })
      const { result, bodies, evidenceSink } = await runAuthorizedDriver({
        providerBinding,
        task,
        toolExecutor: new C1SandboxToolExecutor(sandboxRoot),
        responses: [
          providerResponse({
            id: 'read-loop-response-01',
            content: 'I found the target; I will inspect it.',
            toolCalls: [
              {
                id: 'read-loop-call-01',
                type: 'function',
                function: { name: 'read', arguments: argumentsJson }
              }
            ],
            finishReason: 'tool_calls'
          }),
          providerResponse({
            id: 'read-loop-response-02',
            content: 'The file is understood.'
          })
        ],
        runId: 'c1-20260903-authorized-provider-read-loop-aaaaaaaa',
        pairId: 'c1-authorized-provider-read-loop-p01'
      })
      const secondMessages = bodies[1]?.['messages']
      expect(secondMessages).toEqual(
        expect.arrayContaining([
          {
            role: 'assistant',
            content: 'I found the target; I will inspect it.',
            tool_calls: [
              {
                id: 'read-loop-call-01',
                type: 'function',
                function: { name: 'read', arguments: argumentsJson }
              }
            ]
          },
          {
            role: 'tool',
            content: 'fixture read result\n',
            tool_call_id: 'read-loop-call-01'
          }
        ])
      )
      expect(result.evidence[0]?.toolEvents).toEqual([
        {
          toolCallId: 'read-loop-call-01',
          toolName: 'read',
          path: 'src/target.js',
          result: 'SUCCESS'
        }
      ])
      expect(JSON.stringify(evidenceSink.checkpoints)).not.toContain('fixture read result')
      expect(JSON.stringify(evidenceSink.checkpoints)).not.toContain(
        'I found the target; I will inspect it.'
      )
    } finally {
      providerBinding.dispose()
      await rm(sandboxRoot, { recursive: true, force: true })
    }
  })

  it('keeps raw tool arguments and results out of durable evidence', async () => {
    const { providerBinding, task } = await bindingAndTask()
    const sandboxRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-tool-evidence-sanitizer-'))
    try {
      await mkdir(join(sandboxRoot, 'src'), { recursive: true })
      await writeFile(join(sandboxRoot, 'src', 'read.js'), 'SECRET_TOOL_RESULT\n', 'utf8')
      await writeFile(join(sandboxRoot, 'src', 'edit.js'), 'SECRET_OLD_TEXT\n', 'utf8')
      const readArguments = JSON.stringify({ path: 'src/read.js' })
      const editArguments = JSON.stringify({
        path: 'src/edit.js',
        oldText: 'SECRET_OLD_TEXT',
        newText: 'SECRET_NEW_TEXT'
      })
      const bashArguments = JSON.stringify({
        command: "printf 'SECRET_BASH_RESULT' # SECRET_BASH_COMMAND"
      })
      const { result, checkpointText } = await runAuthorizedDriver({
        providerBinding,
        task,
        toolExecutor: new C1SandboxToolExecutor(sandboxRoot),
        responses: [
          providerResponse({
            id: 'evidence-sanitizer-response-01',
            content: 'SECRET_ASSISTANT_TEXT',
            toolCalls: [
              {
                id: 'evidence-sanitizer-read-01',
                type: 'function',
                function: { name: 'read', arguments: readArguments }
              },
              {
                id: 'evidence-sanitizer-edit-01',
                type: 'function',
                function: { name: 'edit', arguments: editArguments }
              },
              {
                id: 'evidence-sanitizer-bash-01',
                type: 'function',
                function: { name: 'bash', arguments: bashArguments }
              }
            ],
            finishReason: 'tool_calls'
          }),
          providerResponse({ id: 'evidence-sanitizer-response-02' })
        ],
        runId: 'c1-20260903-authorized-provider-evidence-sanitizer-aaaaaaaa',
        pairId: 'c1-authorized-provider-evidence-sanitizer-p01'
      })
      const serializedEvidence = JSON.stringify(result.evidence)
      expect(result.evidence[0]?.toolRequestEvidence).toEqual([
        {
          toolCallId: 'evidence-sanitizer-read-01',
          toolName: 'read',
          argumentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          path: 'src/read.js'
        },
        {
          toolCallId: 'evidence-sanitizer-edit-01',
          toolName: 'edit',
          argumentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          path: 'src/edit.js'
        },
        {
          toolCallId: 'evidence-sanitizer-bash-01',
          toolName: 'bash',
          argumentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      ])
      expect(checkpointText).not.toContain('argumentsJson')
      for (const sentinel of [
        'SECRET_TOOL_RESULT',
        'SECRET_OLD_TEXT',
        'SECRET_NEW_TEXT',
        'SECRET_BASH_COMMAND',
        'SECRET_BASH_RESULT',
        'SECRET_ASSISTANT_TEXT'
      ]) {
        expect(checkpointText).not.toContain(sentinel)
        expect(serializedEvidence).not.toContain(sentinel)
      }
    } finally {
      providerBinding.dispose()
      await rm(sandboxRoot, { recursive: true, force: true })
    }
  })

  it('requires a tool executor for authorized provider tool requests', async () => {
    const { providerBinding, task } = await bindingAndTask()
    const checkpointRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-tool-executor-required-'))
    try {
      let firstFetchCalls = 0
      const firstSource = new C1AuthorizedProviderResponseSource({
        providerBinding,
        apiKey: API_KEY_SENTINEL,
        fetchImpl: async () => {
          firstFetchCalls += 1
          return providerResponse({
            id: 'tool-executor-required-response-01',
            toolCalls: [
              {
                id: 'tool-executor-required-call-01',
                type: 'function',
                function: {
                  name: 'read',
                  arguments: JSON.stringify({ path: 'src/target.js' })
                }
              }
            ],
            finishReason: 'tool_calls'
          })
        }
      })
      let secondFetchCalls = 0
      const secondSource = new C1AuthorizedProviderResponseSource({
        providerBinding,
        apiKey: API_KEY_SENTINEL,
        fetchImpl: async () => {
          secondFetchCalls += 1
          return providerResponse({ id: 'should-not-be-called' })
        }
      })
      const driver = new C1LiveBindingDriver({
        providerBinding,
        budgetGuard: new C1HardBudgetGuard({
          perLeg: {
            maxProviderCalls: 2,
            maxToolCalls: 96,
            maxWallClockMs: 600000
          },
          study: {
            maxProviderCalls: 2,
            maxToolCalls: 96,
            maxWallClockMs: 600000,
            maxLegs: 2
          }
        }),
        evidenceSink: new C1JsonlLiveBindingEvidenceSink(join(checkpointRoot, 'checkpoints.jsonl'))
      })
      const observation = createC1ObservedReadTrace({
        observationId: 'c1-tool-executor-required-observation',
        prompt: task.prompt,
        fixtureFiles: ['src/target.js']
      })
      const commonInput = {
        studyId: 'c1-tool-executor-required-study',
        task,
        stratum: task.stratum,
        pairId: 'c1-tool-executor-required-p01',
        arm: 'NATIVE' as const,
        fixtureContentSha256: task.fixtureRevision.fixtureContentSha256,
        fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
        runtimeSessionId: 'c1-tool-executor-required-session-v1',
        observationSource: new C1ScriptedObservationSource([observation]),
        maxCalls: 1,
        startedAtMs: 100,
        nowMs: 100,
        wallClockMs: 0
      }
      await expect(
        driver.runLeg({
          ...commonInput,
          runId: 'c1-tool-executor-required-leg-01-aaaaaaaa',
          responseSource: firstSource
        })
      ).rejects.toMatchObject({
        code: 'PREFLIGHT_FAILURE',
        message: 'authorized provider tool requests require a tool executor'
      })
      expect(firstFetchCalls).toBe(1)
      expect(driver.isStudyTerminal).toBe(true)
      await expect(
        driver.runLeg({
          ...commonInput,
          pairId: 'c1-tool-executor-required-p02',
          runId: 'c1-tool-executor-required-leg-02-bbbbbbbb',
          runtimeSessionId: 'c1-tool-executor-required-session-v2',
          responseSource: secondSource
        })
      ).rejects.toMatchObject({ code: 'BUDGET_BREACH' })
      expect(secondFetchCalls).toBe(0)
    } finally {
      providerBinding.dispose()
      await rm(checkpointRoot, { recursive: true, force: true })
    }
  })

  it('reserves an entire tool batch before allowing executor side effects', async () => {
    const { providerBinding, task } = await bindingAndTask()
    const sandboxRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-tool-budget-'))
    const checkpointRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-tool-budget-checkpoints-'))
    try {
      await mkdir(join(sandboxRoot, 'src'), { recursive: true })
      const targetPath = join(sandboxRoot, 'src', 'target.js')
      await writeFile(targetPath, 'ORIGINAL_CONTENT\n', 'utf8')
      const sandboxExecutor = new C1SandboxToolExecutor(sandboxRoot)
      let executorCalls = 0
      const toolExecutor: C1LiveToolExecutor = {
        execute: async (input) => {
          executorCalls += 1
          return sandboxExecutor.execute(input)
        }
      }
      const responseSource = new C1ScriptedResponseSource([
        {
          responseId: 'tool-budget-response-01',
          assistantMessageCount: 1,
          assistantContent: 'tool budget probe',
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 12,
            usageSource: 'SCRIPTED_FAKE' as const
          },
          toolRequests: [
            {
              toolCallId: 'tool-budget-edit-01',
              toolName: 'edit',
              argumentsJson: JSON.stringify({
                path: 'src/target.js',
                oldText: 'ORIGINAL_CONTENT',
                newText: 'FIRST_SIDE_EFFECT'
              })
            },
            {
              toolCallId: 'tool-budget-edit-02',
              toolName: 'edit',
              argumentsJson: JSON.stringify({
                path: 'src/target.js',
                oldText: 'ORIGINAL_CONTENT',
                newText: 'SECOND_SIDE_EFFECT'
              })
            }
          ],
          toolExecutions: [],
          outcome: 'CONTINUE' as const
        }
      ])
      const budgetGuard = new C1HardBudgetGuard({
        perLeg: {
          maxProviderCalls: 1,
          maxToolCalls: 1,
          maxWallClockMs: 600000
        },
        study: {
          maxProviderCalls: 1,
          maxToolCalls: 1,
          maxWallClockMs: 600000,
          maxLegs: 2
        }
      })
      const driver = new C1LiveBindingDriver({
        providerBinding,
        budgetGuard,
        evidenceSink: new C1JsonlLiveBindingEvidenceSink(join(checkpointRoot, 'checkpoints.jsonl'))
      })
      const observation = createC1ObservedReadTrace({
        observationId: 'c1-tool-budget-observation',
        prompt: task.prompt,
        fixtureFiles: ['src/target.js']
      })
      await expect(
        driver.runLeg({
          studyId: 'c1-tool-budget-study',
          task,
          stratum: task.stratum,
          pairId: 'c1-tool-budget-p01',
          arm: 'NATIVE',
          runId: 'c1-20260903-tool-budget-native-aaaaaaaa',
          fixtureContentSha256: task.fixtureRevision.fixtureContentSha256,
          fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
          runtimeSessionId: 'c1-tool-budget-session-v1',
          observationSource: new C1ScriptedObservationSource([observation]),
          responseSource,
          toolExecutor,
          maxCalls: 1,
          startedAtMs: 100,
          nowMs: 100,
          wallClockMs: 0
        })
      ).rejects.toMatchObject({ code: 'BUDGET_BREACH' })
      await expect(readFile(targetPath, 'utf8')).resolves.toBe('ORIGINAL_CONTENT\n')
      expect(executorCalls).toBe(0)
      expect(budgetGuard.ledger.toolCalls).toBe(0)
      expect(driver.isStudyTerminal).toBe(true)
    } finally {
      providerBinding.dispose()
      await rm(sandboxRoot, { recursive: true, force: true })
      await rm(checkpointRoot, { recursive: true, force: true })
    }
  })

  it('executes an edit request against the fresh sandbox before the next provider turn', async () => {
    const { providerBinding, task } = await bindingAndTask()
    const sandboxRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-tool-loop-edit-'))
    try {
      await mkdir(join(sandboxRoot, 'src'), { recursive: true })
      const targetPath = join(sandboxRoot, 'src', 'target.js')
      await writeFile(targetPath, 'before value\n', 'utf8')
      const argumentsJson = JSON.stringify({
        path: 'src/target.js',
        oldText: 'before value',
        newText: 'after value'
      })
      const { result } = await runAuthorizedDriver({
        providerBinding,
        task,
        toolExecutor: new C1SandboxToolExecutor(sandboxRoot),
        responses: [
          providerResponse({
            id: 'edit-loop-response-01',
            toolCalls: [
              {
                id: 'edit-loop-call-01',
                type: 'function',
                function: { name: 'edit', arguments: argumentsJson }
              }
            ],
            finishReason: 'tool_calls'
          }),
          providerResponse({ id: 'edit-loop-response-02' })
        ],
        runId: 'c1-20260903-authorized-provider-edit-loop-aaaaaaaa',
        pairId: 'c1-authorized-provider-edit-loop-p01'
      })
      await expect(readFile(targetPath, 'utf8')).resolves.toBe('after value\n')
      expect(result.evidence[0]?.toolEvents).toEqual([
        {
          toolCallId: 'edit-loop-call-01',
          toolName: 'edit',
          path: 'src/target.js',
          result: 'SUCCESS'
        }
      ])
    } finally {
      providerBinding.dispose()
      await rm(sandboxRoot, { recursive: true, force: true })
    }
  })

  it('executes a bash request in the fresh sandbox and carries stdout into the next turn', async () => {
    const { providerBinding, task } = await bindingAndTask()
    const sandboxRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-tool-loop-bash-'))
    try {
      const argumentsJson = JSON.stringify({ command: "printf 'bash result'" })
      const { result, bodies } = await runAuthorizedDriver({
        providerBinding,
        task,
        toolExecutor: new C1SandboxToolExecutor(sandboxRoot),
        responses: [
          providerResponse({
            id: 'bash-loop-response-01',
            toolCalls: [
              {
                id: 'bash-loop-call-01',
                type: 'function',
                function: { name: 'bash', arguments: argumentsJson }
              }
            ],
            finishReason: 'tool_calls'
          }),
          providerResponse({ id: 'bash-loop-response-02' })
        ],
        runId: 'c1-20260903-authorized-provider-bash-loop-aaaaaaaa',
        pairId: 'c1-authorized-provider-bash-loop-p01'
      })
      const secondMessages = bodies[1]?.['messages']
      expect(secondMessages).toEqual(
        expect.arrayContaining([
          {
            role: 'tool',
            content: 'bash result',
            tool_call_id: 'bash-loop-call-01'
          }
        ])
      )
      expect(result.evidence[0]?.toolEvents).toEqual([
        {
          toolCallId: 'bash-loop-call-01',
          toolName: 'bash',
          result: 'SUCCESS'
        }
      ])
    } finally {
      providerBinding.dispose()
      await rm(sandboxRoot, { recursive: true, force: true })
    }
  })

  it('aborts an in-flight provider request from an external operator signal', async () => {
    const { providerBinding, task } = await bindingAndTask()
    const operatorAbort = new AbortController()
    let resolveFetchStarted!: () => void
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve
    })
    let requestSignal: AbortSignal | undefined
    const source = new C1AuthorizedProviderResponseSource({
      providerBinding,
      apiKey: API_KEY_SENTINEL,
      requestTimeoutMs: 60_000,
      fetchImpl: async (_input, init) => {
        requestSignal = init?.signal ?? undefined
        resolveFetchStarted()
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted) {
            reject(new Error('fetch aborted'))
            return
          }
          signal?.addEventListener('abort', () => reject(new Error('fetch aborted')), {
            once: true
          })
        })
      }
    })
    try {
      const pending = source.next(requestFor(task, providerBinding.providerConfigHash), {
        signal: operatorAbort.signal
      })
      await fetchStarted
      operatorAbort.abort()
      await expect(pending).rejects.toMatchObject({
        code: 'KILL_SWITCH_BLOCKED',
        message: 'authorized provider request was aborted by the operator stop signal'
      })
      expect(requestSignal?.aborted).toBe(true)
      expect(source.requestCount).toBe(1)
    } finally {
      providerBinding.dispose()
    }
  })

  it('fails closed on HTTP errors and incomplete provider usage without exposing response bodies', async () => {
    const { providerBinding, task } = await bindingAndTask()
    try {
      const httpSource = new C1AuthorizedProviderResponseSource({
        providerBinding,
        apiKey: API_KEY_SENTINEL,
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: API_KEY_SENTINEL }), {
            status: 503,
            headers: { 'content-type': 'application/json' }
          })
      })
      await expect(
        httpSource.next(requestFor(task, providerBinding.providerConfigHash))
      ).rejects.toMatchObject({
        code: 'PROVIDER_PREPARATION_FAILURE',
        message: 'authorized provider returned HTTP 503'
      })
      await expect(
        new C1AuthorizedProviderResponseSource({
          providerBinding,
          apiKey: API_KEY_SENTINEL,
          fetchImpl: async () =>
            providerResponse({
              id: 'incomplete-usage-response',
              usage: { prompt_tokens: 10, total_tokens: 10 }
            })
        }).next(requestFor(task, providerBinding.providerConfigHash))
      ).rejects.toMatchObject({ code: 'USAGE_CONTRACT_MISMATCH' })

      await expect(
        new C1AuthorizedProviderResponseSource({
          providerBinding,
          apiKey: API_KEY_SENTINEL,
          fetchImpl: async () =>
            providerResponse({
              id: 'missing-cache-write-response',
              usage: {
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 12,
                cached_tokens: 0
              }
            })
        }).next(requestFor(task, providerBinding.providerConfigHash))
      ).rejects.toMatchObject({
        code: 'USAGE_CONTRACT_MISMATCH',
        message: 'provider usage is missing cacheWriteTokens'
      })
    } finally {
      providerBinding.dispose()
    }
  })

  it('rejects a request whose binding does not match the frozen provider', async () => {
    const { providerBinding, task } = await bindingAndTask()
    try {
      const source = new C1AuthorizedProviderResponseSource({
        providerBinding,
        apiKey: API_KEY_SENTINEL,
        fetchImpl: async () => providerResponse({ id: 'should-not-be-called' })
      })
      const request = requestFor(task, providerBinding.providerConfigHash)
      const mismatched = {
        ...request,
        capture: {
          ...request.capture,
          endpoint: 'https://unexpected.example.test'
        }
      }
      await expect(source.next(mismatched as typeof request)).rejects.toMatchObject({
        code: 'PROVIDER_BINDING_MISMATCH'
      })
      expect(source.requestCount).toBe(0)
    } finally {
      providerBinding.dispose()
    }
  })
})
