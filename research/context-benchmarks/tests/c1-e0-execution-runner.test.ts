import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  C1_E0_PROVIDER_CONFIG_HASH,
  C1_E0_RUN_CONTRACT_ID,
  loadC1E0EnrollmentManifest,
  loadC1E0RunContract
} from '../src'
import {
  buildC1E0ExecutionPlans,
  evaluateC1E0ProviderBoundary,
  runC1E0CredentialFreeStudy,
  type C1E0ExecutionReport
} from '../src/c1-e0-execution-runner'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const createdRoots: string[] = []

async function outputRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'canvas-c1-e0-runner-test-'))
  createdRoots.push(root)
  return root
}

async function allArtifactText(report: C1E0ExecutionReport): Promise<string> {
  if (report.reportDir === null) return ''
  const files = await readdir(report.reportDir, { recursive: true })
  const names = files.filter((name): name is string => typeof name === 'string')
  const contents: string[] = []
  for (const name of names) {
    const path = join(report.reportDir, name)
    if (name.endsWith('.json') || name.endsWith('.jsonl'))
      contents.push(await readFile(path, 'utf8'))
  }
  return contents.join('\n')
}

afterEach(async () => {
  await Promise.all(
    createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('C1 E0 credential-free execution runner', () => {
  it('separates Provider boundary traversal from fallback evidence', () => {
    expect(
      evaluateC1E0ProviderBoundary(
        [{ networkSent: false }, { networkSent: false }],
        'SCRIPTED_FAKE'
      )
    ).toEqual({
      verdict: 'PASS',
      expectedNetworkSent: false,
      observedNetworkSent: [false, false]
    })
    expect(
      evaluateC1E0ProviderBoundary(
        [{ networkSent: true }, { networkSent: true }],
        'AUTHORIZED_PROVIDER'
      )
    ).toEqual({
      verdict: 'PASS',
      expectedNetworkSent: true,
      observedNetworkSent: [true, true]
    })
    expect(evaluateC1E0ProviderBoundary([{ networkSent: true }], 'SCRIPTED_FAKE').verdict).toBe(
      'FAIL'
    )
    expect(
      evaluateC1E0ProviderBoundary([{ networkSent: false }], 'AUTHORIZED_PROVIDER').verdict
    ).toBe('FAIL')
  })

  it('builds the frozen 4-pair / 8-leg plan with deterministic identities and 2:2 order quota', async () => {
    const enrollment = await loadC1E0EnrollmentManifest(REPO_ROOT)
    const contract = await loadC1E0RunContract(REPO_ROOT)
    const plans = buildC1E0ExecutionPlans(contract, enrollment, 'c1-e0-20260910-aaaaaaaa')

    expect(plans).toHaveLength(8)
    expect(new Set(plans.map((plan) => plan.runId)).size).toBe(8)
    expect(plans.map((plan) => plan.taskId)).toEqual([
      'c1-t2-multi-file-migration-v1',
      'c1-t2-multi-file-migration-v1',
      'c1-t1-localized-distractor-v1',
      'c1-t1-localized-distractor-v1',
      'c1-t2-multi-file-migration-v1',
      'c1-t2-multi-file-migration-v1',
      'c1-t1-localized-distractor-v1',
      'c1-t1-localized-distractor-v1'
    ])
    expect(plans.filter((plan) => plan.order === 'NATIVE_THEN_RUNTIME')).toHaveLength(4)
    expect(plans.filter((plan) => plan.order === 'RUNTIME_THEN_NATIVE')).toHaveLength(4)
    expect(
      plans.every((plan) =>
        /^c1-e0-20260910-c1-e0-0[1-4]-(?:NATIVE|RUNTIME)-[0-9a-f]{8}$/.test(plan.runId)
      )
    ).toBe(true)
  })

  it('runs both tasks through all 8 legs and qualifies the fake state machine', async () => {
    const report = await runC1E0CredentialFreeStudy({
      repoRoot: REPO_ROOT,
      outputRoot: await outputRoot(),
      studyId: 'c1-e0-20260910-aaaaaaaa',
      scenario: 'BOTH_TASKS_NON_ZERO'
    })

    expect(report.status).toBe('PASS')
    expect(report.runContractId).toBe(C1_E0_RUN_CONTRACT_ID)
    expect(report.runContractCodeRevision).toBe('PENDING_E0_EXECUTION')
    expect(report.executionRevision).toMatch(/^[0-9a-f]{40}$/)
    expect(report.providerConfigHash).toBe(C1_E0_PROVIDER_CONFIG_HASH)
    expect(report.providerCalls).toBe(0)
    expect(report.networkRequests).toBe(0)
    expect(report.fakeProviderCallPermits).toBe(24)
    expect(report.responseCalls).toBe(24)
    expect(report.toolExecutions).toBe(16)
    expect(report.budget).toMatchObject({ completedLegs: 8, providerCalls: 24, toolCalls: 16 })
    expect(report.legsCompleted).toBe(8)
    expect(report.blockedLegs).toBe(0)
    expect(report.studyTerminal).toBe(false)
    expect(report.batchQualification).toMatchObject({
      verdict: 'PASS',
      nonZeroTreatmentPairs: 4,
      nonZeroDistinctTasks: 2
    })
    expect(report.pairAdjudications).toHaveLength(4)
    expect(report.pairAdjudications.every((pair) => pair.pairStatus === 'COMPLETE')).toBe(true)
    expect(report.pairAdjudications.every((pair) => pair.treatmentIntegrity === 'PASS')).toBe(true)
    expect(
      report.pairAdjudications.every(
        (pair) => pair.runtimeDoseSummary?.uniqueRemovedPairs.length === 2
      )
    ).toBe(true)
    const pairStarted = report.events.filter((event) => event.event === 'PAIR_STARTED')
    expect(pairStarted.map((event) => event.pairId)).toEqual([
      'c1-e0-01',
      'c1-e0-02',
      'c1-e0-03',
      'c1-e0-04'
    ])
    for (const event of pairStarted) {
      const firstLeg = report.legs.find((leg) => leg.pairId === event.pairId)
      const firstLegEvent = report.events.find(
        (candidate) => candidate.event === 'LEG_STARTED' && candidate.runId === firstLeg?.runId
      )
      expect(firstLegEvent?.sequence).toBeGreaterThan(event.sequence)
    }
    expect(
      report.pairAdjudications.every(
        (pair) =>
          pair.runtimeDoseSummary?.newRemovalPairCalls === 2 &&
          pair.runtimeDoseSummary.carriedRemovalPairCalls === 2 &&
          pair.runtimeDoseSummary.suppressedStalePairCallExposures === 4
      )
    ).toBe(true)
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
    const raw = await allArtifactText(report)
    expect(raw).not.toMatch(
      /providerBoundMessages|argumentsJson|assistantContent|rawProviderPayload|authorizationHeader|toolResultContent/
    )
    const responseRows = (await readFile(join(report.reportDir!, 'response-ledger.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
    expect(responseRows).toHaveLength(24)
    expect(JSON.parse(responseRows[0]!).responseEvidence).toEqual({
      status: 'OBSERVED',
      usage: 'UNAVAILABLE',
      zeroSubstitutionAllowed: false
    })
  })

  it('keeps within-task repetition from qualifying the batch', async () => {
    const report = await runC1E0CredentialFreeStudy({
      repoRoot: REPO_ROOT,
      outputRoot: await outputRoot(),
      studyId: 'c1-e0-20260910-bbbbbbbb',
      scenario: 'ONLY_T1_NON_ZERO'
    })

    expect(report.status).toBe('INCONCLUSIVE')
    expect(report.legsCompleted).toBe(8)
    expect(report.batchQualification).toMatchObject({
      verdict: 'INCONCLUSIVE',
      nonZeroTreatmentPairs: 2,
      nonZeroDistinctTasks: 1
    })
    const t1 = report.pairAdjudications.filter(
      (pair) => pair.taskId === 'c1-t1-localized-distractor-v1'
    )
    const t2 = report.pairAdjudications.filter(
      (pair) => pair.taskId === 'c1-t2-multi-file-migration-v1'
    )
    expect(t1.every((pair) => pair.runtimeDoseSummary?.uniqueRemovedPairs.length === 2)).toBe(true)
    expect(t2.every((pair) => pair.runtimeDoseSummary?.uniqueRemovedPairs.length === 0)).toBe(true)
    expect(t2.every((pair) => pair.treatmentIntegrity === 'INACTIVE')).toBe(true)
    expect(report.providerCalls).toBe(0)
    expect(report.networkRequests).toBe(0)
  })

  it('blocks the counterpart and remaining legs on an experiment invalidator', async () => {
    const report = await runC1E0CredentialFreeStudy({
      repoRoot: REPO_ROOT,
      outputRoot: await outputRoot(),
      studyId: 'c1-e0-20260910-cccccccc',
      scenario: 'EXPERIMENT_INVALIDATOR'
    })

    expect(report.status).toBe('NO_GO')
    expect(report.studyTerminal).toBe(true)
    expect(report.operatorSignal).toBe('SIGINT')
    expect(report.legsCompleted).toBe(1)
    expect(report.legsAttempted).toBe(1)
    expect(report.blockedLegs).toBe(7)
    expect(report.fakeProviderCallPermits).toBe(3)
    expect(report.responseCalls).toBe(3)
    expect(report.toolExecutions).toBe(2)
    expect(report.budget).toMatchObject({ completedLegs: 1, providerCalls: 3, toolCalls: 2 })
    expect(report.batchQualification).toMatchObject({ verdict: 'NO_GO' })
    expect(
      report.pairAdjudications.every((pair) => pair.pairStatus === 'INVALID_FOR_ENDPOINT')
    ).toBe(true)
    expect(
      report.pairAdjudications.every(
        (pair) => pair.counterpartDecision === 'BLOCKED_EXPERIMENT_INVALIDATOR'
      )
    ).toBe(true)
    expect(report.failures.some((failure) => failure.code === 'EXPERIMENT_INVALIDATOR')).toBe(true)
    const eventNames = report.events.map((event) => event.event)
    expect(eventNames).toContain('LEG_BLOCKED')
    expect(eventNames).toContain('STUDY_TERMINATED')
  })

  it('continues the frozen counterpart after an isolated harness failure', async () => {
    const report = await runC1E0CredentialFreeStudy({
      repoRoot: REPO_ROOT,
      outputRoot: await outputRoot(),
      studyId: 'c1-e0-20260910-eeeeeeee',
      scenario: 'ISOLATED_HARNESS_FAILURE'
    })

    expect(report.status).toBe('INCONCLUSIVE')
    expect(report.studyTerminal).toBe(false)
    expect(report.legsAttempted).toBe(8)
    expect(report.legsCompleted).toBe(7)
    expect(report.blockedLegs).toBe(0)
    expect(report.fakeProviderCallPermits).toBe(21)
    expect(report.responseCalls).toBe(21)
    expect(report.toolExecutions).toBe(14)
    expect(report.batchQualification).toMatchObject({
      verdict: 'INCONCLUSIVE',
      nonZeroTreatmentPairs: 4,
      nonZeroDistinctTasks: 2
    })
    expect(report.pairAdjudications[0]).toMatchObject({
      pairStatus: 'INCOMPLETE',
      counterpartDecision: 'EXECUTED_AFTER_ISOLATED_FAILURE',
      taskCorrectnessCoverage: 'UNKNOWN'
    })
    expect(report.pairAdjudications.slice(1).every((pair) => pair.pairStatus === 'COMPLETE')).toBe(
      true
    )
    expect(report.failures).toEqual([expect.objectContaining({ code: 'ISOLATED_HARNESS_FAILURE' })])
  })

  it('retains single-use study identity after a completed fake run', async () => {
    const root = await outputRoot()
    const first = await runC1E0CredentialFreeStudy({
      repoRoot: REPO_ROOT,
      outputRoot: root,
      studyId: 'c1-e0-20260910-dddddddd',
      scenario: 'BOTH_TASKS_NON_ZERO'
    })
    const second = await runC1E0CredentialFreeStudy({
      repoRoot: REPO_ROOT,
      outputRoot: root,
      studyId: 'c1-e0-20260910-dddddddd',
      scenario: 'BOTH_TASKS_NON_ZERO'
    })

    expect(first.status).toBe('PASS')
    expect(second.status).toBe('NO_GO')
    expect(second.reportDir).toBe(null)
    expect(second.providerCalls).toBe(0)
    expect(second.networkRequests).toBe(0)
    expect(second.failures).toEqual([expect.objectContaining({ code: 'IDENTITY_REUSE' })])
  })
})
