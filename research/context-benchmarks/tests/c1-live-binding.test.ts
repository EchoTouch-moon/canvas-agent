import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_LIVE_BINDING_ID,
  C1LiveBindingTransport,
  C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE,
  C1PreflightFailure,
  C1HardBudgetGuard,
  C1ScriptedResponseSource,
  captureC1PreflightArm,
  loadC1FrozenStudy,
  prepareC1StrictProvider,
  runC1LiveBindingReadiness,
  runC1LiveBudgetBoundaryProbe,
  runC1LiveBudgetTerminationProbe
} from '../src'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')

describe('C1 live execution binding', () => {
  it('keeps scripted usage explicitly separate from provider-reported usage', () => {
    const source = new C1ScriptedResponseSource([
      {
        responseId: 'scripted-response-01',
        assistantMessageCount: 1,
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 12,
          usageSource: 'SCRIPTED_FAKE'
        },
        toolRequests: [],
        toolExecutions: [],
        outcome: 'COMPLETE'
      }
    ])
    expect(source.kind).toBe('SCRIPTED_FAKE')
    expect(source.responsesServed).toBe(0)
  })

  it('permits the 24th outbound call and blocks the 25th before fake response dispatch', async () => {
    const study = await loadC1FrozenStudy(REPO_ROOT)
    const providerBinding = await prepareC1StrictProvider({
      runIdentity: 'c1-20260903-budget-test-aaaaaaaa'
    })
    try {
      const result = await runC1LiveBudgetBoundaryProbe({
        providerBinding,
        task: study.tasks[0]!
      })
      expect(result).toEqual({
        status: 'PASS',
        attemptedProviderCalls: 25,
        permittedProviderCalls: 24,
        blockedProviderCallAttempts: 1,
        fakeResponseCalls: 24,
        networkRequests: 0
      })
    } finally {
      providerBinding.dispose()
    }
  })

  it('preserves completed call evidence and forbids the next leg after a budget breach', async () => {
    const study = await loadC1FrozenStudy(REPO_ROOT)
    const providerBinding = await prepareC1StrictProvider({
      runIdentity: 'c1-20260903-termination-test-aaaaaaaa'
    })
    try {
      await expect(
        runC1LiveBudgetTerminationProbe({
          providerBinding,
          task: study.tasks[0]!
        })
      ).resolves.toMatchObject({
        status: 'PASS',
        firstLegErrorCode: 'BUDGET_BREACH',
        secondLegErrorCode: 'BUDGET_BREACH',
        preservedOutboundCheckpoints: 1,
        preservedResponseCheckpoints: 1,
        firstResponseCalls: 1,
        secondResponseCalls: 0,
        providerCalls: 1,
        studyTerminal: true,
        nextLegBlockedBeforeResponse: true,
        persistedCheckpointCount: 2
      })
    } finally {
      providerBinding.dispose()
    }
  })

  it('runs Native and Runtime through one multi-call driver without provider access', async () => {
    const report = await runC1LiveBindingReadiness({ repoRoot: REPO_ROOT })

    expect(report.bindingId).toBe(C1_LIVE_BINDING_ID)
    expect(report.status).toBe('PASS')
    expect(report.providerCalls).toBe(0)
    expect(report.networkRequests).toBe(0)
    expect(report.fakeResponseCalls).toBe(30)
    expect(report.transportSendAttempts).toBe(31)
    expect(report.blockedProviderCallAttempts).toBe(1)
    expect(report.fixtureSandboxesCreated).toBe(2)
    expect(report.fixtureSandboxesCleaned).toBe(2)
    expect(report.arms).toEqual([
      expect.objectContaining({ arm: 'NATIVE', calls: 3, toolCalls: 2 }),
      expect.objectContaining({ arm: 'RUNTIME', calls: 3, toolCalls: 1 })
    ])
    expect(report.gates.every((gate) => gate.verdict === 'PASS')).toBe(true)
  })

  it('does not dispatch an outbound request without an in-memory provider-bound message list', async () => {
    const study = await loadC1FrozenStudy(REPO_ROOT)
    const providerBinding = await prepareC1StrictProvider({
      runIdentity: 'c1-20260903-transport-test-aaaaaaaa'
    })
    try {
      const task = study.tasks[0]!
      const transport = new C1LiveBindingTransport({
        provider: 'step-plan',
        model: 'step-3.7-flash',
        endpoint: 'https://api.stepfun.com/step_plan/v1/chat/completions',
        providerConfigHash: providerBinding.providerConfigHash
      })
      transport.capture(
        captureC1PreflightArm({
          task,
          stratum: task.stratum,
          pairId: 'c1-live-binding-transport-p01',
          arm: 'NATIVE',
          runId: 'c1-20260903-transport-test-native-aaaaaaaa',
          fixtureContentSha256: task.fixtureRevision.fixtureContentSha256,
          treatmentReady: true,
          providerConfigHash: providerBinding.providerConfigHash,
          providerBoundSourceKeys: ['run/tool-call://transport-test'],
          modelVisibleSemanticContextFingerprint: 'transport-test-fingerprint'
        })
      )
      const guard = new C1HardBudgetGuard({
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
      })
      guard.beginLeg(100)
      await expect(
        transport.send({
          budgetGuard: guard,
          responseSource: new C1ScriptedResponseSource([]),
          nowMs: 100
        })
      ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILURE' })
      guard.endLeg({ wallClockMs: 0 })
      expect(transport.sentCaptures).toHaveLength(0)
    } finally {
      providerBinding.dispose()
    }
  })

  it('records an outbound permit before a response-source failure', async () => {
    const study = await loadC1FrozenStudy(REPO_ROOT)
    const providerBinding = await prepareC1StrictProvider({
      runIdentity: 'c1-20260903-response-failure-test-aaaaaaaa'
    })
    try {
      const task = study.tasks[0]!
      const transport = new C1LiveBindingTransport({
        provider: 'step-plan',
        model: 'step-3.7-flash',
        endpoint: 'https://api.stepfun.com/step_plan/v1/chat/completions',
        providerConfigHash: providerBinding.providerConfigHash
      })
      transport.capture(
        captureC1PreflightArm({
          task,
          stratum: task.stratum,
          pairId: 'c1-live-binding-response-failure-p01',
          arm: 'NATIVE',
          runId: 'c1-20260903-response-failure-native-aaaaaaaa',
          fixtureContentSha256: task.fixtureRevision.fixtureContentSha256,
          treatmentReady: true,
          providerConfigHash: providerBinding.providerConfigHash,
          providerBoundSourceKeys: ['run/tool-call://response-failure'],
          modelVisibleSemanticContextFingerprint: 'response-failure-fingerprint'
        })
      )
      transport.attachProviderBoundMessages(
        [
          {
            role: 'user',
            content: [{ type: 'text', text: 'response failure' }]
          }
        ],
        C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE
      )
      const guard = new C1HardBudgetGuard({
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
      })
      const permits: number[] = []
      guard.beginLeg(100)
      await expect(
        transport.send({
          budgetGuard: guard,
          responseSource: {
            kind: 'SCRIPTED_FAKE',
            next: async () => {
              throw new Error('synthetic response-source failure')
            }
          },
          nowMs: 100,
          onOutboundPermitted: ({ providerCallOrdinal }) => {
            permits.push(providerCallOrdinal)
          }
        })
      ).rejects.toThrow('synthetic response-source failure')
      guard.endLeg({ wallClockMs: 0 })
      expect(permits).toEqual([1])
      expect(transport.sentCaptures).toHaveLength(1)
    } finally {
      providerBinding.dispose()
    }
  })

  it('reports the original budget failure rather than silently converting it to a response', async () => {
    const guard = new C1HardBudgetGuard({
      perLeg: { maxProviderCalls: 0, maxToolCalls: 1, maxWallClockMs: 100 },
      study: {
        maxProviderCalls: 0,
        maxToolCalls: 1,
        maxWallClockMs: 100,
        maxLegs: 1
      }
    })
    guard.beginLeg(100)
    expect(() => guard.recordProviderCall()).toThrowError(
      new C1PreflightFailure('BUDGET_BREACH', 'provider-call hard budget would be exceeded')
    )
    guard.endLeg({ wallClockMs: 0 })
  })
})
