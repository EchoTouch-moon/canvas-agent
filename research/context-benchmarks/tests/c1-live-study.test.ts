import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_PREFLIGHT_ARTIFACT_NAMES,
  changedC1FixturePaths,
  nodeVersionSatisfiesC1Range,
  runC1StudyDryRun,
  writableScopePass
} from '../src'

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
      expect(report.legs.every((leg) => leg.changedPaths.length > 0)).toBe(true)
      expect(report.legs.every((leg) => leg.writableScopePass)).toBe(true)
      expect(report.legs.every((leg) => leg.fixtureChangedByDryRunTool)).toBe(true)
      expect(report.failures).toEqual([])
      expect(report.gates.every((item) => item.verdict === 'PASS')).toBe(true)
      expect(report.legs.filter((leg) => leg.arm === 'NATIVE')).toHaveLength(32)
      expect(report.legs.filter((leg) => leg.arm === 'RUNTIME')).toHaveLength(32)
      expect(report.artifacts.map((artifact) => artifact.name)).toEqual(
        expect.arrayContaining([...C1_PREFLIGHT_ARTIFACT_NAMES])
      )

      const manifest = await readFile(join(report.reportDir!, 'run-manifest.json'), 'utf8')
      expect(manifest).toContain('"providerCalls": 0')
      expect(manifest).toContain('"networkRequests": 0')
      expect(manifest).not.toMatch(
        /providerBoundMessages|argumentsJson|assistantContent|toolResultContent/
      )
      const firstLeg = report.legs[0]
      if (firstLeg === undefined) throw new Error('study dry run produced no completed legs')
      const legManifest = JSON.parse(
        await readFile(join(report.reportDir!, 'legs', firstLeg.runId, 'leg-manifest.json'), 'utf8')
      ) as Record<string, unknown>
      expect(legManifest).toMatchObject({
        fixtureTreeObjectIdVerified: true,
        fixtureHashVerified: true,
        fixtureCleaned: true,
        writableScopePass: true,
        changedPaths: firstLeg.changedPaths
      })
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

  it('computes actual changed paths and rejects an out-of-scope mutation', () => {
    const before = new Map([
      ['src/allowed.js', 'before'],
      ['src/untouched.js', 'same']
    ])
    const after = new Map([
      ['src/allowed.js', 'after'],
      ['src/untouched.js', 'same'],
      ['src/escape.js', 'unexpected']
    ])

    expect(changedC1FixturePaths(before, after)).toEqual(['src/allowed.js', 'src/escape.js'])
    expect(writableScopePass(['src/allowed.js'], ['src/allowed.js'])).toBe(true)
    expect(writableScopePass(changedC1FixturePaths(before, after), ['src/allowed.js'])).toBe(false)
  })
})
