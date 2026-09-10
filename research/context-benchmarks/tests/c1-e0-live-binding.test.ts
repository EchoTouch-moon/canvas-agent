import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_AUTHORIZED_PROVIDER_MAX_TOKENS,
  C1_E0_FINAL_LIVE_BINDING_ID,
  C1_E0_PROVIDER_CONFIG_HASH,
  C1ScriptedResponseSource,
  C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE,
  captureC1PreflightArm,
  createC1E0AuthorizedProviderResponseSource,
  loadC1FrozenStudy,
  prepareC1StrictProvider,
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
    const [oldText, newText] = await Promise.all([
      readFile(join(input.fixtureRoot, path), 'utf8'),
      readFile(join(referenceRoot, path), 'utf8')
    ])
    responses.push({
      responseId: `${input.plan.runId}-response-${String(index + 1).padStart(2, '0')}`,
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
        bootstrapFiles: (task) => task.expectedWritablePaths.slice(0, 2),
        responseSourceFactory: responseSourceFor
      })

      expect(report.bindingId).toBe(C1_E0_FINAL_LIVE_BINDING_ID)
      expect(report.executionMode).toBe('NO_PROVIDER_EXECUTION')
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
      expect(t2Pair?.runtimeDoseSummary?.uniqueRemovedPairs).toHaveLength(2)
      expect(t2Pair?.runtimeDoseSummary?.uniqueRemovedSourceElements).toHaveLength(4)
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

  it('keeps provider usage and latency unknown when only scripted evidence exists', () => {
    const summary = summarizeC1E0Efficiency([])
    expect(summary).toMatchObject({
      responseReceipt: 'UNKNOWN',
      providerUsage: 'UNKNOWN',
      latencyMs: 'UNAVAILABLE'
    })
  })
})
