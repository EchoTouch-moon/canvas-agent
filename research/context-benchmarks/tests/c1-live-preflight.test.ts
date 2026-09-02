import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_C_ASSIGNMENT_MATRIX_SHA256,
  C1_C_CONTRACT_SHA256,
  C1_C_TASK_MANIFEST_SHA256,
  C1_C_TREATMENT_REVISION,
  C1PreflightFailure,
  C1PreflightFakeTransport,
  C1HardBudgetGuard,
  C1_CONTRACT_RELATIVE_PATH,
  buildC1PreflightLegPlan,
  captureC1PreflightArm,
  claimSingleUseC1StudyDir,
  computeC1AssignmentMatrixSha256,
  computeC1ContractSha256,
  createC1PreflightIdentity,
  installC1OperatorKillSwitch,
  loadC1FrozenStudy,
  nodeVersionSatisfiesC1Range,
  runC1LivePreflight,
  validateC1ProviderUsage,
  writableScopePass,
  writeIndependentC1Artifacts
} from '../src'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')

describe('C1 live runner credential-free preflight', () => {
  it('loads the exact frozen C1 contract, manifest, and readiness bindings', async () => {
    const study = await loadC1FrozenStudy(REPO_ROOT)

    expect(study.tasks).toHaveLength(4)
    expect(study.assignments).toHaveLength(32)
    expect(study.contractSha256).toBe(C1_C_CONTRACT_SHA256)
    expect(study.assignmentMatrixSha256).toBe(C1_C_ASSIGNMENT_MATRIX_SHA256)
    expect(study.taskManifestSha256).toBe(C1_C_TASK_MANIFEST_SHA256)
    expect(study.provider).toBe('step-plan')
    expect(study.model).toBe('step-3.7-flash')
    expect(study.perLegBudgets).toEqual({
      maxProviderCalls: 24,
      maxToolCalls: 96,
      maxWallClockMs: 600000
    })
    expect(study.studyBudgets).toEqual({
      maxProviderCalls: 1536,
      maxToolCalls: 6144,
      maxWallClockMs: 43200000,
      maxLegs: 64
    })
  })

  it('recomputes the frozen canonical hashes and rejects mutation by digest', async () => {
    const contract = JSON.parse(
      await readFile(join(REPO_ROOT, C1_CONTRACT_RELATIVE_PATH), 'utf8')
    ) as Record<string, unknown>
    expect(computeC1ContractSha256(contract)).toBe(C1_C_CONTRACT_SHA256)
    const mutatedContract = JSON.parse(JSON.stringify(contract)) as Record<string, unknown>
    const design = mutatedContract['design'] as Record<string, unknown>
    design['pairsPerStratum'] = 7
    expect(computeC1ContractSha256(mutatedContract)).not.toBe(C1_C_CONTRACT_SHA256)

    const randomization = contract['randomization'] as Record<string, unknown>
    const assignmentMatrix = randomization['assignmentMatrix']
    expect(computeC1AssignmentMatrixSha256(assignmentMatrix)).toBe(C1_C_ASSIGNMENT_MATRIX_SHA256)
    const mutatedAssignments = JSON.parse(JSON.stringify(assignmentMatrix)) as Array<
      Record<string, unknown>
    >
    mutatedAssignments[0]!['pairOrdinal'] = 2
    expect(computeC1AssignmentMatrixSha256(mutatedAssignments)).not.toBe(
      C1_C_ASSIGNMENT_MATRIX_SHA256
    )
  })

  it('builds exactly 64 fresh leg identities in the frozen assignment order', async () => {
    const study = await loadC1FrozenStudy(REPO_ROOT)
    const identity = createC1PreflightIdentity(new Date('2026-09-02T00:00:00.000Z'))
    const plans = buildC1PreflightLegPlan(study, identity)

    expect(plans).toHaveLength(64)
    expect(plans.map((plan) => plan.legIndex)).toEqual([...Array(64).keys()])
    expect(new Set(plans.map((plan) => plan.runId)).size).toBe(64)
    expect(plans[0]).toMatchObject({
      legIndex: 0,
      taskId: 'c1-t1-localized-distractor-v1',
      pairId: 'c1-t1-localized-distractor-v1-p01',
      arm: 'NATIVE'
    })
    expect(plans[1]?.arm).toBe('RUNTIME')
    expect(plans.filter((plan) => plan.arm === 'NATIVE')).toHaveLength(32)
    expect(plans.filter((plan) => plan.arm === 'RUNTIME')).toHaveLength(32)
    expect(C1_C_TREATMENT_REVISION).toHaveLength(40)
  })

  it('does not silently fall back when Runtime treatment is unavailable', async () => {
    const study = await loadC1FrozenStudy(REPO_ROOT)
    const task = study.tasks[0]!
    const transport = new C1PreflightFakeTransport()

    expect(() => {
      const request = captureC1PreflightArm({
        task,
        stratum: task.stratum,
        pairId: 'c1-preflight-p01',
        arm: 'RUNTIME',
        runId: 'c1-20260902-preflight-p01-RUNTIME-aaaaaaaa',
        fixtureContentSha256: task.fixtureRevision.fixtureContentSha256,
        treatmentReady: false
      })
      transport.capture(request)
    }).toThrowError(
      new C1PreflightFailure(
        'TREATMENT_INACTIVE',
        'Runtime treatment was not ready; Native fallback is forbidden'
      )
    )
    expect(transport.requests).toHaveLength(0)
  })

  it('latches the first operator signal and blocks the fake transport', () => {
    const events = new EventEmitter()
    const transport = new C1PreflightFakeTransport()
    let trips = 0
    const killSwitch = installC1OperatorKillSwitch(events, () => {
      trips += 1
      transport.block()
    })

    events.emit('SIGINT')
    events.emit('SIGTERM')

    expect(killSwitch.isTripped).toBe(true)
    expect(killSwitch.firstSignal).toBe('SIGINT')
    expect(trips).toBe(1)
    expect(transport.isBlocked).toBe(true)
    killSwitch.dispose()
  })

  it('enforces per-leg hard budgets before an over-budget call', () => {
    const guard = new C1HardBudgetGuard({
      perLeg: { maxProviderCalls: 2, maxToolCalls: 2, maxWallClockMs: 100 },
      study: {
        maxProviderCalls: 4,
        maxToolCalls: 4,
        maxWallClockMs: 200,
        maxLegs: 1
      }
    })
    guard.beginLeg()
    guard.recordProviderCall()
    guard.recordProviderCall()
    expect(() => guard.recordProviderCall()).toThrowError(C1PreflightFailure)
  })

  it('accepts only complete provider-reported usage at the message_end boundary', () => {
    expect(
      validateC1ProviderUsage({
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        totalTokens: 17,
        usageSource: 'PROVIDER_REPORTED'
      })
    ).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      totalTokens: 17,
      usageSource: 'PROVIDER_REPORTED'
    })
    expect(() =>
      validateC1ProviderUsage({
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        usageSource: 'LOCAL_ESTIMATE'
      })
    ).toThrowError(
      new C1PreflightFailure(
        'USAGE_CONTRACT_MISMATCH',
        'provider usage must be marked PROVIDER_REPORTED'
      )
    )
  })

  it('keeps identity claims single-use and finalizes artifacts independently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'canvas-c1-preflight-test-'))
    try {
      const studyId = 'c1-20260902-c1-feasibility-v1-aaaaaaaa'
      await claimSingleUseC1StudyDir(root, studyId)
      await expect(claimSingleUseC1StudyDir(root, studyId)).rejects.toMatchObject({
        code: 'IDENTITY_REUSE'
      })

      const attempted: string[] = []
      const result = await writeIndependentC1Artifacts({
        reportDir: root,
        documents: [
          { name: 'first.json', content: '{}\n' },
          { name: 'second.json', content: '{}\n' }
        ],
        write: async (path, content) => {
          attempted.push(path.endsWith('first.json') ? 'first.json' : 'second.json')
          if (path.endsWith('first.json')) throw new Error('injected write failure')
          await writeFile(path, content, 'utf8')
        }
      })
      expect(result.failed).toEqual(['first.json'])
      expect(attempted).toEqual(['first.json', 'second.json'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an out-of-scope writable change', () => {
    expect(writableScopePass(['src/target.js'], ['src/target.js'])).toBe(true)
    expect(writableScopePass(['src/target.js', 'src/escape.js'], ['src/target.js'])).toBe(false)
  })

  it('returns a no-network preflight result', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-live-preflight-run-'))
    try {
      const report = await runC1LivePreflight({
        repoRoot: REPO_ROOT,
        outputRoot
      })
      if (nodeVersionSatisfiesC1Range()) {
        expect(report.status).toBe('PASS')
        expect(report.providerCalls).toBe(0)
        expect(report.networkRequests).toBe(0)
        expect(report.fakeProviderBoundCaptures).toBe(64)
        expect(report.legs).toHaveLength(64)
        expect(report.artifacts.map((artifact) => artifact.name)).toEqual(
          expect.arrayContaining([
            'run-manifest.json',
            'provider-usage-ledger.jsonl',
            'transition-evidence.jsonl',
            'decision-evidence.jsonl',
            'tool-latency-evidence.jsonl',
            'outcome-evidence.jsonl',
            'replay-evidence.jsonl'
          ])
        )
      } else {
        expect(report.status).toBe('FAIL')
        expect(report.failures[0]?.code).toBe('NODE_RANGE_MISMATCH')
        expect(report.providerCalls).toBe(0)
      }
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 30000)
})
