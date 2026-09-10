import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_AUTHORIZED_PROVIDER_MAX_TOKENS,
  C1_E0_FINAL_LIVE_BINDING_ID,
  C1_E0_EXECUTION_SURFACE_PATHS,
  C1_E0_NEUTRAL_BOOTSTRAP_FILES,
  C1_E0_PROVIDER_CONFIG_HASH,
  C1ScriptedResponseSource,
  C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE,
  captureC1PreflightArm,
  computeC1E0ExecutionBinding,
  createC1E0AuthorizedProviderResponseSource,
  loadC1E0EnrollmentManifest,
  loadC1E0RunContract,
  loadC1FrozenStudy,
  prepareC1StrictProvider,
  runC1E0FinalLiveBindingAuthorized,
  runC1E0FinalLiveBindingNoProvider,
  summarizeC1E0Efficiency,
  type C1E0LiveBindingLegFactoryInput,
  type C1LiveModelResponse
} from '../src'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')

const fakeUsage = {
  inputTokens: 10,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 12,
  usageSource: 'SCRIPTED_FAKE' as const
}

async function responseSourceFor(input: C1E0LiveBindingLegFactoryInput) {
  const referenceRoot = resolve(
    REPO_ROOT,
    input.task.fixturePath.replace(/\/fixture$/, '/reference')
  )
  const responses: C1LiveModelResponse[] = []
  for (const [index, path] of input.task.expectedWritablePaths.entries()) {
    responses.push({
      responseId: `${input.plan.runId}-read-response-${String(index + 1).padStart(2, '0')}`,
      assistantMessageCount: 1,
      assistantContent: '',
      usage: fakeUsage,
      toolRequests: [
        {
          toolCallId: `${input.plan.runId}-read-${String(index + 1).padStart(2, '0')}`,
          toolName: 'read',
          argumentsJson: JSON.stringify({ path })
        }
      ],
      toolExecutions: [],
      outcome: 'CONTINUE'
    })
    const [oldText, newText] = await Promise.all([
      readFile(join(input.fixtureRoot, path), 'utf8'),
      readFile(join(referenceRoot, path), 'utf8')
    ])
    responses.push({
      responseId: `${input.plan.runId}-edit-response-${String(index + 1).padStart(2, '0')}`,
      assistantMessageCount: 1,
      assistantContent: '',
      usage: fakeUsage,
      toolRequests: [
        {
          toolCallId: `${input.plan.runId}-edit-${String(index + 1).padStart(2, '0')}`,
          toolName: 'edit',
          argumentsJson: JSON.stringify({ path, oldText, newText })
        }
      ],
      toolExecutions: [],
      outcome: 'CONTINUE'
    })
  }
  responses.push({
    responseId: `${input.plan.runId}-response-complete`,
    assistantMessageCount: 1,
    assistantContent: 'verification complete',
    usage: fakeUsage,
    toolRequests: [],
    toolExecutions: [],
    outcome: 'COMPLETE'
  })
  return new C1ScriptedResponseSource(responses)
}

function authorizedPayload(input: {
  readonly id: string
  readonly toolCall?: {
    readonly id: string
    readonly name: 'read' | 'edit'
    readonly argumentsJson: string
  }
}): Response {
  return new Response(
    JSON.stringify({
      id: input.id,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: input.toolCall === undefined ? 'verification complete' : null,
            ...(input.toolCall === undefined
              ? {}
              : {
                  tool_calls: [
                    {
                      id: input.toolCall.id,
                      type: 'function',
                      function: {
                        name: input.toolCall.name,
                        arguments: input.toolCall.argumentsJson
                      }
                    }
                  ]
                })
          },
          finish_reason: input.toolCall === undefined ? 'stop' : 'tool_calls'
        }
      ],
      usage: {
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

async function outputRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'canvas-c1-e0-live-binding-test-'))
}

describe('C1 E0 final live binding', () => {
  it('runs all eight legs through the natural lifecycle, Dose, and Layer 2 oracle path', async () => {
    const root = await outputRoot()
    try {
      const report = await runC1E0FinalLiveBindingNoProvider({
        repoRoot: REPO_ROOT,
        outputRoot: root,
        studyId: 'c1-e0-20260911-aaaaaaa1',
        allowUnsupportedNodeForTests: true,
        responseSourceFactory: responseSourceFor
      })

      expect(report.bindingId).toBe(C1_E0_FINAL_LIVE_BINDING_ID)
      expect(report.executionMode).toBe('NO_PROVIDER_EXECUTION')
      expect(C1_E0_NEUTRAL_BOOTSTRAP_FILES).toEqual(['README.md'])
      expect(report.finalBindingReady).toBe(false)
      expect(report.status).toBe('PASS')
      expect(report.legsPlanned).toBe(8)
      expect(report.legsCompleted).toBe(8)
      expect(report.legsFailed).toBe(0)
      expect(report.blockedLegs).toBe(0)
      expect(report.providerCalls).toBe(0)
      expect(report.networkRequests).toBe(0)
      expect(report.fakeProviderCallPermits).toBeGreaterThan(0)
      expect(report.batchQualification).toMatchObject({
        verdict: 'PASS',
        nonZeroTreatmentPairs: 4,
        nonZeroDistinctTasks: 2
      })
      expect(report.pairAdjudications).toHaveLength(4)
      expect(report.pairAdjudications.every((pair) => pair.pairStatus === 'COMPLETE')).toBe(true)
      expect(report.pairAdjudications.every((pair) => pair.treatmentIntegrity === 'PASS')).toBe(
        true
      )
      expect(report.pairAdjudications.every((pair) => pair.taskCorrectness === 'PASS')).toBe(true)
      expect(
        report.pairAdjudications.every(
          (pair) => (pair.runtimeDoseSummary?.uniqueRemovedPairs.length ?? 0) >= 1
        )
      ).toBe(true)
      const t2Pair = report.pairAdjudications.find(
        (pair) => pair.taskId === 'c1-t2-multi-file-migration-v1'
      )
      expect(t2Pair?.runtimeDoseSummary?.uniqueRemovedPairs.length).toBeGreaterThanOrEqual(2)
      expect(t2Pair?.runtimeDoseSummary?.uniqueRemovedSourceElements.length).toBeGreaterThanOrEqual(
        4
      )
      expect(
        report.legs
          .filter((leg) => leg.arm === 'RUNTIME')
          .every((leg) => leg.taskEvaluation?.status === 'PASS')
      ).toBe(true)
      expect(
        report.legs
          .filter((leg) => leg.arm === 'RUNTIME')
          .every((leg) => leg.efficiency.providerUsage === 'UNAVAILABLE')
      ).toBe(true)
      expect(report.runContractCodeRevision).toBe('PENDING_E0_EXECUTION')
      expect(report.runContractSha256).toBe(
        '1fa1840c5869b2a3c60f891cb37b10706fc41830651f1bc56131e87753ffdfb3'
      )
      expect(report.artifacts.map((artifact) => artifact.name)).toEqual([
        'checkpoints.jsonl',
        'checkpoint-summary.json',
        'study-events.jsonl',
        'response-ledger.jsonl',
        'dose-evidence.jsonl',
        'pair-adjudication.jsonl',
        'batch-qualification.json',
        'run-manifest.json'
      ])
      const artifactText = await Promise.all(
        report.artifacts.map((artifact) => readFile(join(report.reportDir!, artifact.name), 'utf8'))
      )
      expect(artifactText.join('\n')).not.toMatch(
        /providerBoundMessages|argumentsJson|assistantContent|rawProviderPayload|authorizationHeader|toolResultContent/
      )
      const responseRows = (
        await readFile(join(report.reportDir!, 'response-ledger.jsonl'), 'utf8')
      )
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              arm: string
              lifecycleEligible: boolean
              transitionDecisionKinds: string[]
            }
        )
      expect(
        responseRows.some(
          (row) =>
            row.arm === 'RUNTIME' &&
            row.lifecycleEligible &&
            row.transitionDecisionKinds.includes('REMOVE')
        )
      ).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)

  it('binds the authorized adapter to the E0 request hash without reading env credentials', async () => {
    const study = await loadC1FrozenStudy(REPO_ROOT)
    const task = study.tasks[0]!
    const providerBinding = await prepareC1StrictProvider({
      runIdentity: 'c1-e0-20260911-authorized-adapter-aaaaaaa1'
    })
    const calls: RequestInit[] = []
    try {
      const source = createC1E0AuthorizedProviderResponseSource({
        providerBinding,
        apiKey: 'memory-only-test-sentinel',
        fetchImpl: async (_input, init) => {
          calls.push(init ?? {})
          return new Response(
            JSON.stringify({
              id: 'e0-authorized-response-01',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'done' },
                  finish_reason: 'stop'
                }
              ],
              usage: {
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
      })
      const request = {
        capture: captureC1PreflightArm({
          task,
          stratum: task.stratum,
          pairId: 'c1-e0-authorized-adapter-p01',
          arm: 'NATIVE',
          runId: 'c1-e0-20260911-c1-e0-01-NATIVE-bbbbbbb1',
          fixtureContentSha256: task.fixtureRevision.fixtureContentSha256,
          treatmentReady: true,
          studyId: 'c1-e0-20260911-authorized-adapter-aaaaaaa1',
          turnId: 'e0-adapter-turn-01',
          modelCallId: 'e0-adapter-call-01',
          providerConfigHash: C1_E0_PROVIDER_CONFIG_HASH,
          providerBoundSourceKeys: ['run/tool-call://e0-adapter-read-01'],
          modelVisibleSemanticContextFingerprint: 'e0-adapter-fingerprint',
          systemDeveloperToolStructuresFingerprint:
            C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE.structuralFingerprint
        }),
        providerBoundMessages: [
          { role: 'user', content: [{ type: 'text', text: 'adapter test' }] }
        ],
        structuralEnvelope: C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE
      }
      const response = await source.next(request)
      expect(response.responseId).toBe('e0-authorized-response-01')
      expect(response.usage.usageSource).toBe('PROVIDER_REPORTED')
      expect(calls).toHaveLength(1)
      expect(JSON.parse(String(calls[0]?.body))).toMatchObject({
        model: 'step-3.7-flash',
        max_tokens: C1_AUTHORIZED_PROVIDER_MAX_TOKENS
      })
    } finally {
      providerBinding.dispose()
    }
  })

  it('runs the complete eight-leg scheduler through the authorized source kind with a fake fetch', async () => {
    const binding = await computeC1E0ExecutionBinding(REPO_ROOT)
    const enrollment = await loadC1E0EnrollmentManifest(REPO_ROOT)
    const contract = await loadC1E0RunContract(REPO_ROOT)
    const root = await outputRoot()
    const cursors = new Map<string, number>()
    const t2Paths = [
      'utils/format.js',
      'models/product.js',
      'models/order.js',
      'models/shipment.js',
      'services/cart.js',
      'services/pricing.js',
      'services/inventory.js',
      'services/billing.js',
      'index.js'
    ]
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        readonly messages: readonly {
          readonly role: string
          readonly content?: string | null
          readonly tool_calls?: readonly { readonly id: string }[]
        }[]
      }
      const bootstrap = body.messages.find(
        (message) =>
          message.role === 'assistant' &&
          message.tool_calls?.[0]?.id.startsWith('c1-live-bootstrap-')
      )
      if (bootstrap?.tool_calls?.[0] === undefined) throw new Error('missing neutral bootstrap')
      const runId = bootstrap.tool_calls[0].id
        .replace(/^c1-live-bootstrap-/, '')
        .replace(/-\d{2}$/, '')
      const isT1 = runId.includes('c1-e0-02') || runId.includes('c1-e0-04')
      const paths = isT1 ? ['src/scheduler/paginator.js'] : t2Paths
      const cursor = cursors.get(runId) ?? 0
      cursors.set(runId, cursor + 1)
      if (cursor >= paths.length * 2) {
        return authorizedPayload({ id: `${runId}-complete` })
      }
      const path = paths[Math.floor(cursor / 2)]!
      if (cursor % 2 === 0) {
        return authorizedPayload({
          id: `${runId}-read-${String(cursor / 2 + 1).padStart(2, '0')}`,
          toolCall: {
            id: `${runId}-read-${String(cursor / 2 + 1).padStart(2, '0')}`,
            name: 'read',
            argumentsJson: JSON.stringify({ path })
          }
        })
      }
      const lastTool = [...body.messages].reverse().find((message) => message.role === 'tool')
      const oldText = lastTool?.content ?? ''
      const referenceRoot = resolve(
        REPO_ROOT,
        paths === t2Paths
          ? 'research/context-benchmarks/corpus/L1-multi-file-refactor/reference'
          : 'research/context-benchmarks/corpus/L3-noisy-bug-hunt/reference'
      )
      const newText = await readFile(join(referenceRoot, path), 'utf8')
      return authorizedPayload({
        id: `${runId}-edit-${String(cursor / 2 + 1).padStart(2, '0')}`,
        toolCall: {
          id: `${runId}-edit-${String(cursor / 2 + 1).padStart(2, '0')}`,
          name: 'edit',
          argumentsJson: JSON.stringify({ path, oldText, newText })
        }
      })
    }
    try {
      const report = await runC1E0FinalLiveBindingAuthorized({
        repoRoot: REPO_ROOT,
        outputRoot: root,
        authorization: {
          decision: 'AUTHORIZED',
          studyId: 'c1-e0-20260911-ccccccc3',
          executionRevision: binding.executionRevision,
          executionSurfaceHash: binding.executionSurfaceHash,
          runContractSha256: contract.runContractSha256,
          enrollmentManifestSha256: enrollment.manifestSha256,
          providerConfigHash: C1_E0_PROVIDER_CONFIG_HASH
        },
        apiKey: 'memory-only-authorized-test-sentinel',
        fetchImpl,
        allowPendingContractForTests: true
      })
      expect(report.responseSource).toBe('AUTHORIZED_PROVIDER')
      expect(report.executionMode).toBe('AUTHORIZED_PROVIDER')
      expect(report.status).toBe('PASS')
      expect(report.providerCalls).toBeGreaterThan(0)
      expect(report.providerCalls).toBe(report.networkRequests)
      expect(report.pairAdjudications.every((pair) => pair.treatmentIntegrity === 'PASS')).toBe(
        true
      )
      expect(report.pairAdjudications.every((pair) => pair.taskCorrectness === 'PASS')).toBe(true)
      expect(report.legs.every((leg) => leg.responseSource === 'AUTHORIZED_PROVIDER')).toBe(true)
      expect(report.legs.every((leg) => leg.efficiency.providerUsage === 'AVAILABLE')).toBe(true)
      expect(report.finalBindingReady).toBe(false)
      const ledger = await readFile(join(report.reportDir!, 'response-ledger.jsonl'), 'utf8')
      expect(ledger).toContain('"networkSent":true')
      expect(ledger).not.toContain('memory-only-authorized-test-sentinel')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 180_000)

  it('keeps provider usage and latency unknown when only scripted evidence exists', () => {
    const summary = summarizeC1E0Efficiency([])
    expect(summary).toMatchObject({
      responseReceipt: 'UNKNOWN',
      providerUsage: 'UNKNOWN',
      latencyMs: 'UNAVAILABLE'
    })
  })

  it('binds execution identity to the headless research surface, including policy/runtime files', async () => {
    const binding = await computeC1E0ExecutionBinding(REPO_ROOT)
    expect(binding.executionRevision).toMatch(/^[0-9a-f]{40}$/)
    expect(binding.executionSurfaceHash).toMatch(/^[0-9a-f]{64}$/)
    expect(C1_E0_EXECUTION_SURFACE_PATHS).toContain('research/context-benchmarks/src')
    expect(C1_E0_EXECUTION_SURFACE_PATHS).toContain('packages/context-runtime')
    expect(C1_E0_EXECUTION_SURFACE_PATHS).toContain('pnpm-lock.yaml')
    expect(C1_E0_EXECUTION_SURFACE_PATHS).not.toContain('apps/electron')
  })
})
