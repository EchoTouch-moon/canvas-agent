import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRunKillSwitch } from '@canvas-agent/pi-context-integration/experimental'
import { afterEach, describe, expect, it } from 'vitest'
import {
  C1F0V2HardeningToolAdapter,
  classifyTermination
} from '../c1/f0/v2/runner/c1-f0-v2-execution-runner'
import { C1F1Native32BindingDriver } from '../c1/f1/runner/c1-f1-32-execution-runner'
import {
  C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY,
  C1_F1_NATIVE32_PROVIDER_CONFIG_HASH
} from '../c1/f1/contract/c1-f1-native-feasibility-32-contract'
import { C1AuthorizedProviderResponseSource } from '../src/c1-authorized-provider'
import {
  C1LiveBindingDriver,
  type C1LiveBindingCheckpoint,
  type C1LiveBindingEvidence
} from '../src/c1-live-binding'
import { C1LiveTaskObservationSource } from '../src/c1-live-study'
import {
  C1HardBudgetGuard,
  loadC1FrozenStudy,
  prepareC1StrictProvider,
  type C1StrictProviderBinding
} from '../src/c1-live-preflight'
import type { C1F0ToolExecution } from '../c1/f0/hardening/c1-f0-tool-hardening'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const API_KEY_SENTINEL = 'c1-f1-parity-memory-only-sentinel'
const STUDY_ID = 'c1-f1-parity-study-20260915'
const RUN_ID = 'c1-f1-parity-run-01'
const PAIR_ID = 'c1-f1-parity-p01'
const FIXED_NOW = '2026-09-15T00:00:00.000Z'
const tempRoots = new Set<string>()

type Scenario = 'RECOVERY_THEN_COMPLETE' | 'MAX_CALL_BUDGET_EXHAUSTION'
type Driver = 'F0_V2' | 'F1_32'

interface CapturedProviderRequest {
  readonly endpoint: string
  readonly method: string
  readonly contentType: string | null
  readonly body: unknown
}

interface DriverTrace {
  readonly driver: Driver
  readonly scenario: Scenario
  readonly providerRequests: readonly CapturedProviderRequest[]
  readonly evidence: readonly C1LiveBindingEvidence[]
  readonly toolExecutions: readonly Record<string, unknown>[]
  readonly termination: string
  readonly finalOutcome: string | null
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function providerReply(input: {
  readonly responseId: string
  readonly toolCall?: {
    readonly id: string
    readonly name: string
    readonly arguments: Record<string, unknown>
  }
}): Response {
  return new Response(
    JSON.stringify({
      id: input.responseId,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: input.toolCall === undefined ? 'complete' : null,
            ...(input.toolCall === undefined
              ? {}
              : {
                  tool_calls: [
                    {
                      id: input.toolCall.id,
                      type: 'function',
                      function: {
                        name: input.toolCall.name,
                        arguments: JSON.stringify(input.toolCall.arguments)
                      }
                    }
                  ]
                })
          },
          finish_reason: input.toolCall === undefined ? 'stop' : 'tool_calls'
        }
      ],
      usage: {
        prompt_tokens: 23,
        completion_tokens: 6,
        total_tokens: 29,
        cached_tokens: 0,
        cache_write_tokens: 0
      }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

function responseFor(scenario: Scenario, ordinal: number): Response {
  const responseId = `${scenario.toLowerCase()}-response-${String(ordinal).padStart(2, '0')}`
  if (scenario === 'RECOVERY_THEN_COMPLETE') {
    if (ordinal === 1) {
      return providerReply({
        responseId,
        toolCall: {
          id: 'parity-recovery-failed-edit',
          name: 'edit',
          arguments: {
            path: 'src/scheduler/paginator.js',
            oldText: '__PARITY_EXPECTED_MISSING_TEXT__',
            newText: 'unused'
          }
        }
      })
    }
    if (ordinal === 2) {
      return providerReply({
        responseId,
        toolCall: {
          id: 'parity-recovery-corrected-edit',
          name: 'edit',
          arguments: {
            path: 'src/scheduler/paginator.js',
            oldText: 'const end = start + pageSize - 1',
            newText: 'const end = start + pageSize'
          }
        }
      })
    }
    return providerReply({ responseId })
  }
  return providerReply({
    responseId,
    toolCall: {
      id: `parity-budget-read-${String(ordinal).padStart(2, '0')}`,
      name: 'read',
      arguments: { path: 'README.md' }
    }
  })
}

function projectionOfEvidence(evidence: readonly C1LiveBindingEvidence[]): unknown {
  return evidence.map((row) => ({
    ...row,
    toolRequestEvidence: row.toolRequestEvidence.map((request) => ({ ...request })),
    toolEvents: row.toolEvents.map((event) => ({ ...event })),
    transitionDecisionKinds: [...row.transitionDecisionKinds],
    providerBoundSourceKeys: [...row.providerBoundSourceKeys],
    carriedRemovedSourceKeys: [...(row.carriedRemovedSourceKeys ?? [])],
    carriedRemovalEvidence: [...(row.carriedRemovalEvidence ?? [])],
    decisionDetails: [...(row.decisionDetails ?? [])]
  }))
}

function projectionOfToolExecutions(executions: readonly C1F0ToolExecution[]): unknown {
  return executions.map((execution) => ({
    toolCallId: execution.toolCallId,
    toolName: execution.toolName,
    ...(execution.path === undefined ? {} : { path: execution.path }),
    result: execution.result,
    provenance: execution.provenance
  }))
}

async function runDriverTrace(input: {
  readonly driver: Driver
  readonly scenario: Scenario
  readonly budget: 24 | 32
  readonly task: Awaited<ReturnType<typeof loadC1FrozenStudy>>['tasks'][number]
  readonly providerBinding: C1StrictProviderBinding
  readonly fixtureRoot: string
  readonly tempRoot: string
  readonly originalWritableFile: string
  readonly originalWritableFileText: string
}): Promise<DriverTrace> {
  const provenancePath = join(input.tempRoot, `${input.scenario}-${input.driver}.jsonl`)
  await rm(provenancePath, { force: true })
  await writeFile(input.originalWritableFile, input.originalWritableFileText, 'utf8')
  const toolExecutor = new C1F0V2HardeningToolAdapter({
    sandboxRoot: input.fixtureRoot,
    studyId: STUDY_ID,
    runId: RUN_ID,
    provenancePath
  })
  const providerRequests: CapturedProviderRequest[] = []
  let responseOrdinal = 0
  const responseSource = new C1AuthorizedProviderResponseSource({
    providerBinding: input.providerBinding,
    apiKey: API_KEY_SENTINEL,
    providerConfigHashOverride: C1_F1_NATIVE32_PROVIDER_CONFIG_HASH,
    fetchImpl: async (requestInput, init) => {
      const headers = new Headers(init?.headers)
      const bodyText = String(init?.body ?? '')
      const body = JSON.parse(bodyText) as unknown
      providerRequests.push({
        endpoint: String(requestInput),
        method: init?.method ?? 'GET',
        contentType: headers.get('content-type'),
        body
      })
      if (headers.get('authorization') !== `Bearer ${API_KEY_SENTINEL}`) {
        throw new Error('fake transport did not receive the in-memory credential')
      }
      if (bodyText.includes(API_KEY_SENTINEL)) {
        throw new Error('credential appeared in the Provider request body')
      }
      responseOrdinal += 1
      return responseFor(input.scenario, responseOrdinal)
    }
  })
  const checkpoints: C1LiveBindingCheckpoint[] = []
  const evidenceSink = {
    append: (checkpoint: C1LiveBindingCheckpoint): void => {
      checkpoints.push(checkpoint)
    }
  }
  const budgetGuard = new C1HardBudgetGuard({
    perLeg: {
      maxProviderCalls: input.budget,
      maxToolCalls: 96,
      maxWallClockMs: 600_000
    },
    study: {
      maxProviderCalls: input.budget * 32,
      maxToolCalls: 3_072,
      maxWallClockMs: 19_200_000,
      maxLegs: 32
    }
  })
  const driver =
    input.driver === 'F0_V2'
      ? new C1LiveBindingDriver({
          providerBinding: input.providerBinding,
          budgetGuard,
          evidenceSink,
          providerConfigHashOverride: C1_F1_NATIVE32_PROVIDER_CONFIG_HASH
        })
      : new C1F1Native32BindingDriver({
          providerBinding: input.providerBinding,
          budgetGuard,
          evidenceSink,
          providerConfigHashOverride: C1_F1_NATIVE32_PROVIDER_CONFIG_HASH
        })
  const observationSource = await C1LiveTaskObservationSource.fromFixture({
    task: input.task,
    runId: RUN_ID,
    fixtureRoot: input.fixtureRoot,
    bootstrapFiles: ['README.md']
  })
  let finalOutcome: string | null = null
  let termination = 'TERMINAL_FAILED'
  try {
    const result = await driver.runLeg({
      studyId: STUDY_ID,
      task: input.task,
      stratum: input.task.stratum,
      pairId: PAIR_ID,
      arm: 'NATIVE',
      runId: RUN_ID,
      fixtureContentSha256: input.task.fixtureRevision.fixtureContentSha256,
      fixtureTreeObjectId: input.task.fixtureRevision.fixtureTreeObjectId,
      runtimeSessionId: `${STUDY_ID}:${RUN_ID}`,
      observationSource,
      responseSource,
      toolExecutor,
      maxCalls: input.budget,
      startedAtMs: 100,
      nowMs: 100,
      wallClockMs: 0,
      killSwitch: createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW })
    })
    finalOutcome = result.finalOutcome
    termination = result.finalOutcome === 'COMPLETE' ? 'TERMINAL_COMPLETE' : 'TERMINAL_FAILED'
  } catch (error) {
    termination = classifyTermination(error)
  }
  const evidence = checkpoints
    .filter((checkpoint) => checkpoint.phase === 'RESPONSE_RECORDED')
    .map((checkpoint) => checkpoint.evidence)
  return {
    driver: input.driver,
    scenario: input.scenario,
    providerRequests,
    evidence,
    toolExecutions: projectionOfToolExecutions(toolExecutor.executions) as Record<
      string,
      unknown
    >[],
    termination,
    finalOutcome
  }
}

function stableDigest(value: unknown): string {
  return sha256(canonical(value))
}

afterEach(async () => {
  await Promise.all([...tempRoots].map((root) => rm(root, { recursive: true, force: true })))
  tempRoots.clear()
})

describe('C1 F1-32 effective execution-surface parity', () => {
  it('matches F0-v2 request, recovery, evidence, and termination behavior except for the frozen budget', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-f1-parity-'))
    tempRoots.add(tempRoot)
    const study = await loadC1FrozenStudy(REPO_ROOT)
    const task = study.tasks.find(
      (candidate) => candidate.taskId === 'c1-t1-localized-distractor-v1'
    )
    if (task === undefined) throw new Error('F0-v2 anchor task was not found')
    const fixtureRoot = join(tempRoot, 'fixture')
    await cp(resolve(REPO_ROOT, task.fixturePath), fixtureRoot, { recursive: true })
    const writablePath = join(fixtureRoot, 'src/scheduler/paginator.js')
    const originalWritableFileText = await readFile(writablePath, 'utf8')
    const providerBinding = await prepareC1StrictProvider({
      runIdentity: 'c1-f1-parity-20260915-a1b2c3d4',
      env: { STEP_PLAN_API_KEY: API_KEY_SENTINEL }
    })

    try {
      const scenarioPairs: {
        readonly scenario: Scenario
        readonly baseline: DriverTrace
        readonly target: DriverTrace
      }[] = []
      for (const scenario of ['RECOVERY_THEN_COMPLETE', 'MAX_CALL_BUDGET_EXHAUSTION'] as const) {
        const baseline = await runDriverTrace({
          driver: 'F0_V2',
          scenario,
          budget: 24,
          task,
          providerBinding,
          fixtureRoot,
          tempRoot,
          originalWritableFile: writablePath,
          originalWritableFileText
        })
        const target = await runDriverTrace({
          driver: 'F1_32',
          scenario,
          budget: 32,
          task,
          providerBinding,
          fixtureRoot,
          tempRoot,
          originalWritableFile: writablePath,
          originalWritableFileText
        })
        scenarioPairs.push({ scenario, baseline, target })
      }

      const recovery = scenarioPairs[0]
      const budget = scenarioPairs[1]
      if (recovery === undefined || budget === undefined)
        throw new Error('missing parity scenarios')

      expect(recovery.baseline.providerRequests).toEqual(recovery.target.providerRequests)
      expect(recovery.baseline.evidence).toEqual(recovery.target.evidence)
      expect(recovery.baseline.toolExecutions).toEqual(recovery.target.toolExecutions)
      expect(recovery.baseline.termination).toBe('TERMINAL_COMPLETE')
      expect(recovery.target.termination).toBe('TERMINAL_COMPLETE')
      expect(recovery.baseline.finalOutcome).toBe('COMPLETE')
      expect(recovery.target.finalOutcome).toBe('COMPLETE')
      expect(recovery.baseline.providerRequests).toHaveLength(3)
      expect(recovery.target.providerRequests).toHaveLength(3)
      expect(recovery.baseline.toolExecutions).toMatchObject([
        { result: 'ERROR' },
        {
          result: 'SUCCESS',
          provenance: {
            recoveryOfToolCallId: 'parity-recovery-failed-edit',
            recoveryAttemptOrdinal: 1
          }
        }
      ])

      expect(budget.baseline.providerRequests.slice(0, 24)).toEqual(
        budget.target.providerRequests.slice(0, 24)
      )
      expect(budget.baseline.evidence).toEqual(budget.target.evidence.slice(0, 24))
      expect(budget.baseline.toolExecutions).toEqual(budget.target.toolExecutions.slice(0, 24))
      expect(budget.baseline.providerRequests).toHaveLength(24)
      expect(budget.target.providerRequests).toHaveLength(32)
      expect(budget.baseline.termination).toBe('BUDGET_EXHAUSTED')
      expect(budget.target.termination).toBe('BUDGET_EXHAUSTED')
      expect(budget.baseline.finalOutcome).toBeNull()
      expect(budget.target.finalOutcome).toBeNull()

      const parityRecord = {
        schemaVersion: 1,
        policyId: C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.policyId,
        baselineContractId: C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.baselineContractId,
        baselineExecutionSurfaceHash:
          C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.baselineExecutionSurfaceHash,
        baselineProviderRequestsPerRun:
          C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.baselineProviderRequestsPerRun,
        targetProviderRequestsPerRun:
          C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.targetProviderRequestsPerRun,
        baselineProviderRequestsPerStudy:
          C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.baselineProviderRequestsPerStudy,
        targetProviderRequestsPerStudy:
          C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.targetProviderRequestsPerStudy,
        baselineDriver: C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.baselineDriver,
        targetDriver: C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.targetDriver,
        responseSource: C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.responseSource,
        toolExecutor: C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.toolExecutor,
        comparedSemantics: C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.comparedSemantics,
        onlyPermittedDifferences:
          C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.onlyPermittedDifferences,
        scenarioExpectations: C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.scenarioEvidence,
        transportMode: 'INJECTED_FAKE_FETCH',
        actualNetworkRequests: 0,
        scenarios: [
          {
            scenarioId: recovery.scenario,
            baselineProviderRequestsSha256: stableDigest(recovery.baseline.providerRequests),
            targetProviderRequestsSha256: stableDigest(recovery.target.providerRequests),
            baselineResponseEvidenceSha256: stableDigest(
              projectionOfEvidence(recovery.baseline.evidence)
            ),
            targetResponseEvidenceSha256: stableDigest(
              projectionOfEvidence(recovery.target.evidence)
            ),
            baselineToolRecoveryEvidenceSha256: stableDigest(recovery.baseline.toolExecutions),
            targetToolRecoveryEvidenceSha256: stableDigest(recovery.target.toolExecutions),
            baselineTermination: recovery.baseline.termination,
            targetTermination: recovery.target.termination,
            baselineProviderCalls: recovery.baseline.providerRequests.length,
            targetProviderCalls: recovery.target.providerRequests.length
          },
          {
            scenarioId: budget.scenario,
            baselineProviderRequestPrefixSha256: stableDigest(
              budget.baseline.providerRequests.slice(0, 24)
            ),
            targetProviderRequestPrefixSha256: stableDigest(
              budget.target.providerRequests.slice(0, 24)
            ),
            baselineResponseEvidencePrefixSha256: stableDigest(
              projectionOfEvidence(budget.baseline.evidence)
            ),
            targetResponseEvidencePrefixSha256: stableDigest(
              projectionOfEvidence(budget.target.evidence.slice(0, 24))
            ),
            baselineToolExecutionPrefixSha256: stableDigest(budget.baseline.toolExecutions),
            targetToolExecutionPrefixSha256: stableDigest(
              budget.target.toolExecutions.slice(0, 24)
            ),
            baselineTermination: budget.baseline.termination,
            targetTermination: budget.target.termination,
            baselineProviderCalls: budget.baseline.providerRequests.length,
            targetProviderCalls: budget.target.providerRequests.length,
            targetOnlyAdditionalProviderCalls:
              budget.target.providerRequests.length - budget.baseline.providerRequests.length
          }
        ]
      }
      const parityEvidenceSha256 = stableDigest(parityRecord)
      expect(parityEvidenceSha256).toBe(
        C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY.parityEvidenceSha256
      )
    } finally {
      providerBinding.dispose()
    }
  }, 120_000)
})
