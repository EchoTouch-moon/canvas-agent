import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  adjudicateC1F0Study,
  buildC1F0ExecutionPlans,
  clopperPearsonLower,
  clopperPearsonUpper,
  loadC1F0Contract,
  runC1F0CredentialFreeStudy,
  type C1F0RunRecord
} from '../c1/f0/runner/c1-f0-execution-runner'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const node24 = Number(process.versions.node.split('.')[0]) === 24

function allPassRun(plan: ReturnType<typeof buildC1F0ExecutionPlans>[number]): C1F0RunRecord {
  return {
    runOrdinal: plan.runOrdinal,
    repetition: plan.repetition,
    taskOrdinal: plan.taskOrdinal,
    taskId: plan.taskId,
    stratum: plan.stratum,
    runId: plan.runId,
    pairId: plan.pairId,
    terminationStatus: 'TERMINAL_COMPLETE',
    oracleStatus: 'PASS',
    objectiveOracleStatus: 'PASS',
    regressionOracleStatus: 'PASS',
    evidenceStatus: 'COMPLETE',
    fixtureCleaned: true,
    changedPaths: [],
    writableScopePass: true,
    diagnostics: {
      providerCallPermits: 1,
      responseCalls: 1,
      toolRequestCount: 0,
      toolExecutionCount: 0,
      toolErrorCount: 0,
      recoveredToolErrorCount: 0,
      providerErrorCount: 0,
      unrecoveredToolFailure: false,
      checkpointJoinComplete: true
    }
  }
}

describe('C1 F0 execution feasibility runner', () => {
  it('loads the frozen two-task contract and builds 32 deterministic Native runs', async () => {
    const contract = await loadC1F0Contract(REPO_ROOT)
    const plans = buildC1F0ExecutionPlans(contract, 'c1-f0-20260912-aaaaaaaa')

    expect(plans).toHaveLength(32)
    expect(plans.filter((plan) => plan.taskId === 'c1-t1-localized-distractor-v1')).toHaveLength(16)
    expect(plans.filter((plan) => plan.taskId === 'c1-t2-multi-file-migration-v1')).toHaveLength(16)
    expect(plans.slice(0, 4).map((plan) => plan.taskId)).toEqual([
      'c1-t1-localized-distractor-v1',
      'c1-t2-multi-file-migration-v1',
      'c1-t1-localized-distractor-v1',
      'c1-t2-multi-file-migration-v1'
    ])
    expect(new Set(plans.map((plan) => plan.runId)).size).toBe(32)
    expect(plans.every((plan) => /^c1-f0-20260912-run-\d{2}-[0-9a-f]{8}$/.test(plan.runId))).toBe(
      true
    )
  })

  it('uses one-sided exact Clopper–Pearson bounds at the frozen n=16 boundary', () => {
    expect(clopperPearsonLower(16, 16)).toBeCloseTo(0.8289, 3)
    expect(clopperPearsonUpper(0, 16)).toBeCloseTo(0.1709, 3)
    expect(clopperPearsonLower(0, 16)).toBe(0)
    expect(clopperPearsonUpper(16, 16)).toBe(1)
  })

  it('separates precision and feasibility adjudication without reading fixtures', async () => {
    const contract = await loadC1F0Contract(REPO_ROOT)
    const plans = buildC1F0ExecutionPlans(contract, 'c1-f0-20260912-bbbbbbbb')
    const allPass = plans.map(allPassRun)
    const pass = adjudicateC1F0Study(contract, allPass)
    expect(pass.status).toBe('GO_TO_T0_DESIGN')
    expect(pass.precisionGate.pass).toBe(true)
    expect(pass.feasibilityGate.pass).toBe(true)

    const oneBudgetFailure = allPass.map((run, index) =>
      index === 0 ? { ...run, terminationStatus: 'BUDGET_EXHAUSTED' as const } : run
    )
    const noGo = adjudicateC1F0Study(contract, oneBudgetFailure)
    expect(noGo.status).toBe('F0_FEASIBILITY_NO_GO')
    expect(noGo.precisionGate.pass).toBe(true)
    expect(noGo.taskSummaries[0]?.gates.endToEndSuccess).toBe(false)
  })

  it.skipIf(!node24)(
    'runs the complete credential-free 32-run state machine with no network',
    async () => {
      const outputRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-f0-runner-test-'))
      try {
        const report = await runC1F0CredentialFreeStudy({
          repoRoot: REPO_ROOT,
          outputRoot,
          studyId: 'c1-f0-20260912-cccccccc',
          scenario: 'TOOL_LOOP'
        })
        expect(report.status).toBe('F0_FEASIBILITY_NO_GO')
        expect(report.providerCalls).toBe(0)
        expect(report.networkRequests).toBe(0)
        expect(report.runsPlanned).toBe(32)
        expect(report.runsStarted).toBe(32)
        expect(report.runsCompleted).toBe(32)
        expect(report.blockedRuns).toBe(0)
        expect(report.runs).toHaveLength(32)
        expect(report.runs.every((run) => run.terminationStatus === 'TERMINAL_COMPLETE')).toBe(true)
        expect(report.runs.every((run) => run.oracleStatus === 'FAIL')).toBe(true)
        expect(report.feasibility.precisionGate.pass).toBe(true)
        expect(report.artifacts.map((artifact) => artifact.name)).toEqual([
          'study-manifest.json',
          'run-manifest.json',
          'checkpoints.jsonl',
          'checkpoint-summary.json',
          'response-ledger.jsonl',
          'task-adjudication.jsonl',
          'feasibility-summary.json'
        ])
        const files = await readdir(report.reportDir!, { recursive: true })
        for (const file of files.filter((value): value is string => typeof value === 'string')) {
          if (!file.endsWith('.json') && !file.endsWith('.jsonl')) continue
          const content = await readFile(join(report.reportDir!, file), 'utf8')
          expect(content).not.toMatch(
            /providerBoundMessages|argumentsJson|assistantContent|rawProviderPayload|authorizationHeader|toolResultContent/
          )
        }
      } finally {
        await rm(outputRoot, { recursive: true, force: true })
      }
    },
    30_000
  )

  it.skipIf(!node24)(
    'keeps an ordinary failed run in the denominator and continues the study',
    async () => {
      const outputRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-f0-failure-test-'))
      try {
        const report = await runC1F0CredentialFreeStudy({
          repoRoot: REPO_ROOT,
          outputRoot,
          studyId: 'c1-f0-20260912-dddddddd',
          scenario: 'SINGLE_RUN_FAILURE'
        })
        expect(report.runsStarted).toBe(32)
        expect(report.runsCompleted).toBe(32)
        expect(report.blockedRuns).toBe(0)
        expect(report.runs[0]).toMatchObject({
          terminationStatus: 'TERMINAL_FAILED',
          failureCode: 'RUN_FAILURE'
        })
        expect(
          report.runs.slice(1).every((run) => run.terminationStatus === 'TERMINAL_COMPLETE')
        ).toBe(true)
        expect(report.feasibility.precisionGate.pass).toBe(true)
      } finally {
        await rm(outputRoot, { recursive: true, force: true })
      }
    },
    30_000
  )
})
