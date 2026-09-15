import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  C1_F1_NATIVE32_EXECUTION_SURFACE_PATH,
  buildC1F1Native32ExecutionPlans,
  computeC1F1Native32ExecutionBinding,
  runC1F1Native32CredentialFreeStudy,
  type C1F1Native32FakeScenario
} from '../c1/f1/runner/c1-f1-32-execution-runner'
import {
  assertC1F1Native32BindingControlSurfaceMatchesActualInventory,
  loadC1F1Native32Contract
} from '../c1/f1/contract/c1-f1-native-feasibility-32-contract'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const execFileAsync = promisify(execFile)
const outputRoots = new Set<string>()

async function runScenario(scenario: C1F1Native32FakeScenario, suffix: string, testRunLimit = 1) {
  const outputRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-f1-32-runner-'))
  outputRoots.add(outputRoot)
  return runC1F1Native32CredentialFreeStudy({
    repoRoot: REPO_ROOT,
    outputRoot,
    studyId: 'c1-f1-32-20260914-' + suffix,
    scenario,
    testRunLimit
  })
}

afterEach(async () => {
  await Promise.all([...outputRoots].map((root) => rm(root, { recursive: true, force: true })))
  outputRoots.clear()
})

describe('C1 F1-32 credential-free execution runner', () => {
  it('builds the frozen 32-run plan in the F1 identity namespace', async () => {
    const contract = await loadC1F1Native32Contract(REPO_ROOT, 'FREEZE_CANDIDATE')
    const plans = buildC1F1Native32ExecutionPlans(contract, 'c1-f1-32-20260914-aaaaaaaa')
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
      plans.every((plan) => /^c1-f1-32-20260914-run-\d{2}-[0-9a-f]{8}$/.test(plan.runId))
    ).toBe(true)
    expect(new Set(plans.map((plan) => plan.runId)).size).toBe(32)
  })

  it('derives an actual checkout inventory and aggregate binding without network access', async () => {
    const binding = await computeC1F1Native32ExecutionBinding(REPO_ROOT)
    expect(binding.inventory.length).toBe(282)
    expect(
      binding.inventory.some((entry) => entry.path === C1_F1_NATIVE32_EXECUTION_SURFACE_PATH)
    ).toBe(true)
    expect(binding.checkoutRevision).toMatch(/^[a-f0-9]{40}$/)
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
    expect(binding.checkoutRevision).toBe(stdout.trim())
    expect(binding.executionSurfaceRevision).toMatch(/^[a-f0-9]{40}$/)
    expect(binding.executionSurfaceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(binding.bindingControlInventory.length).toBe(4)
    expect(
      binding.bindingControlInventory.some((entry) => entry.path.endsWith('c1-carried-removals.ts'))
    ).toBe(true)
    expect(binding.bindingControlSurfaceHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('runs a credential-free leg and persists final-bound witness evidence', async () => {
    const report = await runScenario('COMPLETE', 'aaaaaaaa')
    expect(report.providerCalls).toBe(0)
    expect(report.networkRequests).toBe(0)
    expect(report.runsPlanned).toBe(32)
    expect(report.runsStarted).toBe(1)
    expect(report.executionSurfaceRevision).toMatch(/^[a-f0-9]{40}$/)
    expect(report.pointLabel).toBe('INCONCLUSIVE')
    expect(report.surfaceWitness).toMatchObject({
      phase: 'FINAL_BOUND',
      witnessStatus: 'COMPLETE',
      targetInventoryDigest: report.executionSurfaceHash
    })
    expect(report.finalBoundRunContractSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(report.bindingControlSurfaceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(report.reportDir).not.toBeNull()
    const witness = JSON.parse(
      await readFile(join(report.reportDir!, 'surface-witness.json'), 'utf8')
    ) as Record<string, unknown>
    expect(witness['targetSurfacePaths']).toHaveLength(282)
    const finalBound = JSON.parse(
      await readFile(join(report.reportDir!, 'final-bound-contract.json'), 'utf8')
    ) as Record<string, unknown>
    const binding = await computeC1F1Native32ExecutionBinding(REPO_ROOT)
    expect(() =>
      assertC1F1Native32BindingControlSurfaceMatchesActualInventory(
        finalBound,
        binding.bindingControlInventory
      )
    ).not.toThrow()
    const driftedControlInventory = binding.bindingControlInventory.map((entry) =>
      entry.path.endsWith('c1-carried-removals.ts') ? { ...entry, sha256: '0'.repeat(64) } : entry
    )
    expect(() =>
      assertC1F1Native32BindingControlSurfaceMatchesActualInventory(
        finalBound,
        driftedControlInventory
      )
    ).toThrow('bindingControlSurface supplemental dependency')
    await expect(readFile(join(report.reportDir!, '.env'), 'utf8')).rejects.toThrow()
  })

  it('runs the complete 32-leg fake study with the derived 1024-call study ceiling', async () => {
    const report = await runScenario('COMPLETE', 'dddddddd', 32)
    expect(report.providerCalls).toBe(0)
    expect(report.networkRequests).toBe(0)
    expect(report.runsPlanned).toBe(32)
    expect(report.runsStarted).toBe(32)
    expect(report.runsCompleted).toBe(32)
    expect(report.blockedRuns).toBe(0)
    expect(report.responseCalls).toBe(32)
    expect(report.runs).toHaveLength(32)
    expect(report.surfaceWitness?.['targetInventoryDigest']).toBe(report.executionSurfaceHash)
  }, 120_000)

  it('enforces the 32-call per-run budget with a scripted continuation loop', async () => {
    const report = await runScenario('BUDGET_EXHAUSTION', 'bbbbbbbb')
    expect(report.providerCalls).toBe(0)
    expect(report.networkRequests).toBe(0)
    expect(report.responseCalls).toBe(32)
    expect(report.runs[0]?.terminationStatus).toBe('BUDGET_EXHAUSTED')
    expect(report.runs[0]?.fixtureCleaned).toBe(true)
  }, 30_000)

  it('records prospective side-effect provenance before cleanup', async () => {
    const report = await runScenario('TOOL_SIDE_EFFECT', 'cccccccc')
    expect(report.providerCalls).toBe(0)
    expect(report.runs[0]?.sideEffectAttributionStatus).toBe('ATTRIBUTED')
    const provenance = await readFile(join(report.reportDir!, 'tool-provenance.jsonl'), 'utf8')
    expect(provenance).toContain('"sideEffectSource":"BASH_TOOL"')
    expect(provenance).toContain('"changedPaths":["package-lock.json"]')
    expect(provenance).not.toContain('argumentsJson')
  })
})
