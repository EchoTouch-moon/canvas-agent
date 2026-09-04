import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { C1_PREFLIGHT_ARTIFACT_NAMES, nodeVersionSatisfiesC1Range, runC1StudyDryRun } from '../src'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')

describe('C1 study-level credential-free orchestration', () => {
  it('fails closed before claiming an identity outside the frozen Node range', async () => {
    if (nodeVersionSatisfiesC1Range()) return

    const report = await runC1StudyDryRun({ repoRoot: REPO_ROOT })

    expect(report.status).toBe('FAIL')
    expect(report.providerCalls).toBe(0)
    expect(report.networkRequests).toBe(0)
    expect(report.studyId).toBeNull()
    expect(report.failures[0]?.code).toBe('NODE_RANGE_MISMATCH')
  })

  it('runs all frozen legs through one driver and writes metadata-only artifacts', async () => {
    if (!nodeVersionSatisfiesC1Range()) return

    const outputRoot = await mkdtemp(join('/tmp', 'canvas-c1-study-test-'))
    try {
      const report = await runC1StudyDryRun({
        repoRoot: REPO_ROOT,
        outputRoot
      })

      expect(report.status).toBe('PASS')
      expect(report.providerCalls).toBe(0)
      expect(report.networkRequests).toBe(0)
      expect(report.driverInstances).toBe(1)
      expect(report.legsAttempted).toBe(64)
      expect(report.legsCompleted).toBe(64)
      expect(report.fakeProviderCallPermits).toBe(192)
      expect(report.fakeResponseCalls).toBe(192)
      expect(report.toolExecutions).toBe(192)
      expect(report.fixtureSandboxesCreated).toBe(64)
      expect(report.fixtureSandboxesCleaned).toBe(64)
      expect(report.failures).toEqual([])
      expect(report.gates.every((item) => item.verdict === 'PASS')).toBe(true)
      expect(report.legs.filter((leg) => leg.arm === 'NATIVE')).toHaveLength(32)
      expect(report.legs.filter((leg) => leg.arm === 'RUNTIME')).toHaveLength(32)
      expect(report.legs.some((leg) => leg.transitionDecisionKinds.flat().includes('REMOVE'))).toBe(
        true
      )
      expect(
        report.legs.some((leg) => leg.transitionDecisionKinds.flat().includes('REHYDRATE'))
      ).toBe(true)
      expect(report.artifacts.map((artifact) => artifact.name)).toEqual(
        expect.arrayContaining([...C1_PREFLIGHT_ARTIFACT_NAMES])
      )

      const manifest = await readFile(join(report.reportDir!, 'run-manifest.json'), 'utf8')
      expect(manifest).toContain('"providerCalls": 0')
      expect(manifest).toContain('"networkRequests": 0')
      expect(manifest).not.toMatch(
        /providerBoundMessages|argumentsJson|assistantContent|toolResultContent/
      )
      for (const name of C1_PREFLIGHT_ARTIFACT_NAMES) {
        const content = await readFile(join(report.reportDir!, name), 'utf8')
        expect(content).not.toMatch(
          /providerBoundMessages|argumentsJson|assistantContent|rawProviderPayload|authorizationHeader|toolResultContent/
        )
      }
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 30_000)

  it('stops before the next leg when the operator kill switch is tripped', async () => {
    if (!nodeVersionSatisfiesC1Range()) return

    const outputRoot = await mkdtemp(join('/tmp', 'canvas-c1-study-kill-test-'))
    const signals = new EventEmitter()
    try {
      const report = await runC1StudyDryRun({
        repoRoot: REPO_ROOT,
        outputRoot,
        signalSource: signals,
        beforeLeg: (plan) => {
          if (plan.legIndex === 1) signals.emit('SIGINT')
        }
      })

      expect(report.status).toBe('FAIL')
      expect(report.operatorSignal).toBe('SIGINT')
      expect(report.studyTerminal).toBe(true)
      expect(report.legsCompleted).toBe(1)
      expect(report.fakeResponseCalls).toBe(3)
      expect(report.failures.some((failure) => failure.code === 'KILL_SWITCH_BLOCKED')).toBe(true)
      expect(report.gates.some((item) => item.gateId === 'artifact_set')).toBe(true)
      const manifest = JSON.parse(
        await readFile(join(report.reportDir!, 'run-manifest.json'), 'utf8')
      ) as {
        attemptedLegs: number
        completedLegs: number
      }
      expect(manifest.attemptedLegs).toBe(1)
      expect(manifest.completedLegs).toBe(1)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })
})
