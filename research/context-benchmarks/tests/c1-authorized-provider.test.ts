import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_AUTHORIZED_PROVIDER_MAX_TOKENS,
  C1AuthorizedProviderResponseSource,
  C1LiveBindingDriver,
  C1HardBudgetGuard,
  C1ScriptedObservationSource,
  C1JsonlLiveBindingEvidenceSink,
  C1PreflightFailure,
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
            content: 'provider response',
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

function requestFor(task: Awaited<ReturnType<typeof bindingAndTask>>['task'], providerConfigHash: string) {
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
      { role: 'system', content: [{ type: 'text', text: 'system instruction' }] },
      { role: 'user', content: [{ type: 'text', text: 'inspect the target' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'tool-call-1',
            name: 'read',
            arguments: { path: 'src/target.js' }
          }
        ]
      },
      {
        role: 'toolResult',
        content: [{ type: 'text', text: 'target contents' }],
        toolCallId: 'tool-call-1',
        toolName: 'read',
        isError: false
      }
    ]
  }
}

describe('C1 authorized provider response source', () => {
  it('binds the exact endpoint, model, auth header, messages, tools, and usage', async () => {
    const { providerBinding, task } = await bindingAndTask()
    const calls: { input: Parameters<typeof fetch>[0]; init: Parameters<typeof fetch>[1] }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input, init })
      return providerResponse({
        id: 'authorized-response-01',
        toolCalls: [
          {
            id: 'provider-tool-1',
            type: 'function',
            function: { name: 'read', arguments: '{"path":"src/target.js"}' }
          }
        ],
        finishReason: 'tool_calls'
      })
    }
    const source = new C1AuthorizedProviderResponseSource({
      providerBinding,
      apiKey: API_KEY_SENTINEL,
      fetchImpl,
      tools: [
        {
          type: 'function',
          function: {
            name: 'read',
            description: 'Read a fixture file',
            parameters: { type: 'object', properties: { path: { type: 'string' } } }
          }
        }
      ]
    })
    try {
      const request = requestFor(task, providerBinding.providerConfigHash)
      const response = await source.next(request)
      expect(response).toMatchObject({
        responseId: 'authorized-response-01',
        assistantMessageCount: 1,
        outcome: 'CONTINUE',
        usage: {
          inputTokens: 21,
          outputTokens: 5,
          cacheReadTokens: 3,
          cacheWriteTokens: 0,
          totalTokens: 26,
          usageSource: 'PROVIDER_REPORTED'
        },
        toolCalls: [
          {
            toolCallId: 'provider-tool-1',
            toolName: 'read',
            path: 'src/target.js',
            result: 'SUCCESS'
          }
        ]
      })
      expect(source.requestCount).toBe(1)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.input).toBe('https://api.stepfun.com/step_plan/v1/chat/completions')
      expect(calls[0]?.init?.method).toBe('POST')
      expect(calls[0]?.init?.headers).toMatchObject({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY_SENTINEL}`
      })
      const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        model: 'step-3.7-flash',
        stream: false,
        max_tokens: C1_AUTHORIZED_PROVIDER_MAX_TOKENS
      })
      expect(body['tools']).toHaveLength(1)
      expect(body['messages']).toEqual([
        { role: 'system', content: 'system instruction' },
        { role: 'user', content: 'inspect the target' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'tool-call-1',
              type: 'function',
              function: { name: 'read', arguments: '{"path":"src/target.js"}' }
            }
          ]
        },
        { role: 'tool', content: 'target contents', tool_call_id: 'tool-call-1' }
      ])
      expect(JSON.stringify(source)).not.toContain(API_KEY_SENTINEL)
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
          perLeg: { maxProviderCalls: 24, maxToolCalls: 96, maxWallClockMs: 600000 },
          study: { maxProviderCalls: 24, maxToolCalls: 96, maxWallClockMs: 600000, maxLegs: 1 }
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
      await expect(httpSource.next(requestFor(task, providerBinding.providerConfigHash))).rejects.toMatchObject({
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
        capture: { ...request.capture, endpoint: 'https://unexpected.example.test' }
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
