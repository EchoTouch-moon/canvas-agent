import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildC1F0V2ExecutionPlans,
  runC1F0V2CredentialFreeStudy,
  type C1F0V2FakeScenario
} from '../c1/f0/v2/runner/c1-f0-v2-execution-runner'
import { loadC1F0V2Contract } from '../c1/f0/contract/c1-f0-v2-contract'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const node24 = Number(process.versions.node.split('.')[0]) === 24
const outputRoots = new Set<string>()

async function runScenario(scenario: C1F0V2FakeScenario, suffix: string) {
  const outputRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-f0-v2-runner-'))
  const studyId = 'c1-f0-v2-20260913-' + suffix
  outputRoots.add(outputRoot)
  return runC1F0V2CredentialFreeStudy({
    repoRoot: REPO_ROOT,
    outputRoot,
    studyId,
    scenario
  })
}

afterEach(async () => {
  await Promise.all([...outputRoots].map((root) => rm(root, { recursive: true, force: true })))
  outputRoots.clear()
})

describe('C1 F0-v2 credential-free execution runner', () => {
  it('builds the frozen 32-run plan with v2 identities and balanced task order', async () => {
    const contract = await loadC1F0V2Contract(REPO_ROOT, 'FREEZE_CANDIDATE')
    const plans = buildC1F0V2ExecutionPlans(contract, 'c1-f0-v2-20260913-aaaaaaaa')
    expect(plans).toHaveLength(32)
    expect(plans.filter((plan) => plan.taskId === 'c1-t1-localized-distractor-v1')).toHaveLength(16)
    expect(plans.filter((plan) => plan.taskId === 'c1-t2-multi-file-migration-v1')).toHaveLength(16)
    expect(plans.slice(0, 4).map((plan) => plan.taskId)).toEqual([
      'c1-t1-localized-distractor-v1',
      'c1-t2-multi-file-migration-v1',
      'c1-t1-localized-distractor-v1',
      'c1-t2-multi-file-migration-v1'
    ])
    expect(
      plans.every((plan) => /^c1-f0-v2-20260913-run-\d{2}-[0-9a-f]{8}$/.test(plan.runId))
    ).toBe(true)
    expect(new Set(plans.map((plan) => plan.runId)).size).toBe(32)
  })

  it.skipIf(!node24)(
    'runs all 32 Native legs with bounded recovery, provenance, and no network',
    async () => {
      const report = await runScenario('TOOL_RECOVERY', 'bbbbbbbb')
      expect(report.providerCalls).toBe(0)
      expect(report.networkRequests).toBe(0)
      expect(report.runsPlanned).toBe(32)
      expect(report.runsStarted).toBe(32)
      expect(report.runsCompleted).toBe(32)
      expect(report.blockedRuns).toBe(0)
      expect(report.runs).toHaveLength(32)
      expect(report.runs.every((run) => run.postRunFixtureSnapshotStatus === 'FROZEN')).toBe(true)
      expect(report.runs.every((run) => run.fixtureCleaned)).toBe(true)
      expect(report.runs.every((run) => run.recoveryStatus === 'RECOVERED')).toBe(true)
      expect(report.runs.every((run) => run.runDisposition === 'FEASIBILITY_FAILURE')).toBe(true)
      expect(report.artifacts.map((artifact) => artifact.name)).toEqual([
        'study-manifest.json',
        'run-manifest.json',
        'checkpoints.jsonl',
        'checkpoint-summary.json',
        'response-ledger.jsonl',
        'tool-provenance.jsonl',
        'post-run-snapshot-manifest.jsonl',
        'task-adjudication.jsonl',
        'feasibility-summary.json'
      ])
      const provenance = await readFile(join(report.reportDir!, 'tool-provenance.jsonl'), 'utf8')
      expect(provenance).toContain('"failureClass":"COMMAND_FAILED"')
      expect(provenance).toContain('"recoveryOfToolCallId"')
      expect(provenance).not.toContain('exit 7')
      expect(provenance).not.toContain('argumentsJson')
    },
    120_000
  )

  it.skipIf(!node24)(
    'attributes a bash side effect prospectively before cleanup',
    async () => {
      const report = await runScenario('TOOL_SIDE_EFFECT', 'cccccccc')
      expect(report.runs.every((run) => run.sideEffectAttributionStatus === 'ATTRIBUTED')).toBe(
        true
      )
      const provenance = await readFile(join(report.reportDir!, 'tool-provenance.jsonl'), 'utf8')
      expect(provenance).toContain('"sideEffectSource":"BASH_TOOL"')
      expect(provenance).toContain('"changedPaths":["package-lock.json"]')
      expect(provenance).not.toContain('side effect')
    },
    120_000
  )

  it.skipIf(!node24)(
    'keeps snapshot and oracle uncertainty separate from observed failure',
    async () => {
      const report = await runScenario('UNKNOWN_SNAPSHOT', 'dddddddd')
      expect(report.runs[0]).toMatchObject({
        postRunFixtureSnapshotStatus: 'UNAVAILABLE',
        runDisposition: 'FEASIBILITY_UNKNOWN',
        writableScopeStatus: 'UNKNOWN'
      })
      expect(report.runs[0]?.unknownReason).toContain('POST_RUN_SNAPSHOT_UNAVAILABLE')
      expect(report.feasibility.precisionGate.unknownRunRate['c1-t1-localized-distractor-v1']).toBe(
        1 / 16
      )
    },
    120_000
  )

  it.skipIf(!node24)(
    'continues ordinary run failure without blocking the remaining runs',
    async () => {
      const report = await runScenario('SINGLE_RUN_FAILURE', 'eeeeeeee')
      expect(report.runsStarted).toBe(32)
      expect(report.blockedRuns).toBe(0)
      expect(report.runs[0]?.runDisposition).toBe('FEASIBILITY_UNKNOWN')
      expect(report.feasibility.validityGate.pass).toBe(true)
    },
    120_000
  )

  it.skipIf(!node24)(
    'blocks remaining runs on a shared study invalidator',
    async () => {
      const report = await runScenario('STUDY_INVALIDATOR', 'ffffffff')
      expect(report.status).toBe('F0_V2_NO_GO')
      expect(report.studyTerminal).toBe(true)
      expect(report.blockedRuns).toBe(31)
      expect(report.runs[0]?.runDisposition).toBe('STUDY_INVALID')
      expect(report.runs.slice(1).every((run) => run.terminationStatus === 'BLOCKED')).toBe(true)
    },
    120_000
  )

  it.skipIf(!node24)(
    'blocks a third identical failure without changing the fixture',
    async () => {
      const report = await runScenario('TOOL_LOOP', '99999999')
      const provenance = await readFile(join(report.reportDir!, 'tool-provenance.jsonl'), 'utf8')
      expect(provenance).toContain('"failureClass":"REPEATED_FAILURE_BLOCKED"')
      expect(provenance).toContain('"consecutiveFailureStreak":3')
      expect(report.runs.every((run) => run.recoveryStatus === 'BLOCKED')).toBe(true)
    },
    120_000
  )
})
