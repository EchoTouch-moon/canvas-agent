import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  runC1LifecycleCanary,
  c1LifecycleCanaryScriptedResponses,
  C1_LIFECYCLE_CANARY_SV1_CONTRACT,
  C1_LIFECYCLE_CANARY_SV1_CONTRACT_SHA256
} from '../src/c1-lifecycle-canary'
import { C1ScriptedResponseSource } from '../src/c1-live-binding'
import { applyC1SupersededVersionPolicy } from '../src/c1-superseded-version-policy'
import {
  captureC1LifecycleReplayEvidence,
  type C1LifecycleReplayRecord
} from '../src/c1-lifecycle-replay-evidence'
import type { C1AgentObservation } from '../src/c1-live-preflight'

const repoRoot = resolve(import.meta.dirname, '../../..')

function fakeOptions(outputRoot: string, studyId: string) {
  return {
    mode: 'FAKE' as const,
    repoRoot,
    outputRoot,
    studyId,
    executionRevision: 'fake-only'
  }
}

describe('C1_LIFECYCLE_CANARY_SV1 (Runtime-only pure-evict canary)', () => {
  it('runs the full scripted trajectory and passes every frozen gate', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'lifecycle-canary-pass-'))
    try {
      const options = fakeOptions(outputRoot, 'c1-lifecycle-20260908-aaaaaaaa')
      const report = await runC1LifecycleCanary(options)
      expect(report).toMatchObject({
        status: 'PASS',
        providerCalls: 0,
        networkRequests: 0,
        fakeResponses: 4,
        finalStage: 'TERMINAL',
        answerMatched: true,
        terminal: true,
        retired: true
      })
      expect(report.changedCalls).toEqual([3, 4])
      expect(report.toolResults.map((row) => row.toolName)).toEqual(['read', 'edit', 'read'])
      expect(report.carriedRemovedAtFinalCall).toHaveLength(2)
      expect(
        report.carriedRemovedAtFinalCall.every((key) => key.includes('lifecycle-read-1'))
      ).toBe(true)
      expect(report.reconciliation.every((entry) => entry.verdict !== 'CONTRACT_CONFLICT')).toBe(
        true
      )
      expect(report.reconciliation.find((entry) => entry.callOrdinal === 3)?.verdict).toBe('MATCH')
      const accounting = report.callAccounting.allRecorded
      expect(accounting.normalizedResponses).toBe(4)
      expect(accounting.recordedToolExecutions).toBe(3)

      // Replay evidence persisted separately, fingerprint-only.
      const replayRaw = await readFile(
        join(outputRoot, options.studyId, 'lifecycle-replay.jsonl'),
        'utf8'
      )
      const records = replayRaw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as C1LifecycleReplayRecord)
      expect(records.length).toBeGreaterThan(0)
      for (const forbidden of ['value = 1', 'value = 2', 'export const', 'ORCHID-42', 'oldText']) {
        expect(replayRaw).not.toContain(forbidden)
      }

      // Identity retired: a second run into the same output root must fail closed.
      await expect(runC1LifecycleCanary(options)).rejects.toThrow()
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 60000)

  it('blocks the third outbound request when replay and live removals conflict', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'lifecycle-canary-conflict-'))
    try {
      let served = 0
      const source = new C1ScriptedResponseSource(c1LifecycleCanaryScriptedResponses())
      // Test seam: the policy keeps everything (no removals) while replay
      // capture still adjudicates SUPERSEDED -> CONTRACT_CONFLICT at the gate.
      const keepingPolicy: typeof applyC1SupersededVersionPolicy = (observation) => observation
      const report = await runC1LifecycleCanary({
        ...fakeOptions(outputRoot, 'c1-lifecycle-20260908-bbbbbbbb'),
        policyApplier: keepingPolicy,
        fakeSourceFactory: () => ({
          kind: 'SCRIPTED_FAKE' as const,
          next: async (request: Parameters<(typeof source)['next']>[0]) => {
            served += 1
            return source.next(request)
          }
        })
      })
      expect(report.status).toBe('FAIL')
      expect(report.failureCode).toBe('CANARY_STOP')
      expect(report.reconciliation.find((entry) => entry.callOrdinal === 3)?.verdict).toBe(
        'CONTRACT_CONFLICT'
      )
      // Hard boundary: the gate fired before the third outbound request.
      expect(served).toBe(2)
      expect(report.fakeResponses).toBe(2)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 60000)

  it('stops conservatively when the probe is unobservable at the gate call', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'lifecycle-canary-unknown-'))
    try {
      let served = 0
      const source = new C1ScriptedResponseSource(c1LifecycleCanaryScriptedResponses())
      const blindCapture = (
        observation: C1AgentObservation,
        captureOptions: Parameters<typeof captureC1LifecycleReplayEvidence>[1]
      ) =>
        captureC1LifecycleReplayEvidence(observation, {
          ...captureOptions,
          versionProbe: () => undefined
        })
      const report = await runC1LifecycleCanary({
        ...fakeOptions(outputRoot, 'c1-lifecycle-20260908-cccccccc'),
        replayCapture: blindCapture,
        fakeSourceFactory: () => ({
          kind: 'SCRIPTED_FAKE' as const,
          next: async (request: Parameters<(typeof source)['next']>[0]) => {
            served += 1
            return source.next(request)
          }
        })
      })
      expect(report.status).toBe('FAIL')
      expect(served).toBeLessThanOrEqual(2)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 60000)

  it('stops on an out-of-sequence tool before executing it', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'lifecycle-canary-sequence-'))
    try {
      const responses = c1LifecycleCanaryScriptedResponses()
      const reordered = [
        { ...responses[2]!, responseId: 'lifecycle-x1' }, // reads README first
        ...responses.slice(1)
      ]
      const report = await runC1LifecycleCanary({
        ...fakeOptions(outputRoot, 'c1-lifecycle-20260908-dddddddd'),
        fakeSourceFactory: () => new C1ScriptedResponseSource(reordered)
      })
      expect(report.status).toBe('FAIL')
      expect(report.failureCode).toBe('CANARY_STOP')
      expect(report.fakeResponses).toBe(1)
      expect(report.toolResults).toHaveLength(0)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 60000)

  it('stops on a no-op edit whose fingerprint does not change', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'lifecycle-canary-noop-'))
    try {
      const responses = c1LifecycleCanaryScriptedResponses()
      const noop = responses.map((response, index) =>
        index === 1
          ? {
              ...response,
              toolRequests: [
                {
                  toolCallId: 'lifecycle-edit-1',
                  toolName: 'edit',
                  argumentsJson: '{"path":"src/a.js","oldText":"value = 1","newText":"value = 1"}'
                }
              ]
            }
          : response
      )
      const report = await runC1LifecycleCanary({
        ...fakeOptions(outputRoot, 'c1-lifecycle-20260908-eeeeeeee'),
        fakeSourceFactory: () => new C1ScriptedResponseSource(noop)
      })
      expect(report.status).toBe('FAIL')
      expect(report.failureCode).toBe('CANARY_STOP')
      // The no-op edit executes (the sandbox applies it successfully), then
      // the post-execution fingerprint check stops the run before call 3.
      expect(report.toolResults).toHaveLength(2)
      expect(report.fakeResponses).toBe(2)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 60000)

  it('rejects a wrong live authorization before identity claim or credential access', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'lifecycle-canary-auth-'))
    const getApiKey = vi.fn(() => 'credential')
    try {
      const base = {
        mode: 'LIVE' as const,
        repoRoot,
        outputRoot,
        studyId: 'c1-lifecycle-20260908-ffffffff',
        executionRevision: '0'.repeat(40),
        getApiKey
      }
      await expect(runC1LifecycleCanary(base)).rejects.toThrow('authorization')
      await expect(
        runC1LifecycleCanary({
          ...base,
          authorization: {
            decision: 'AUTHORIZED',
            studyId: base.studyId,
            executionRevision: base.executionRevision,
            contractSha256: 'wrong'
          }
        })
      ).rejects.toThrow('authorization')
      expect(getApiKey).not.toHaveBeenCalled()
      expect(await readdir(outputRoot)).toEqual([])
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('binds every frozen design item into a stable contractSha256', () => {
    const contract = C1_LIFECYCLE_CANARY_SV1_CONTRACT
    expect(contract.contractId).toBe('C1_LIFECYCLE_CANARY_SV1')
    expect(contract.arms).toEqual(['RUNTIME'])
    expect(contract.bootstrap).toBe('NEUTRAL_AGENTS_MD_CANARY_SPECIFIC_OVERRIDE')
    expect(contract.toolSequence).toEqual(['read:src/a.js', 'edit:src/a.js', 'read:README.md'])
    expect(contract.maxRequests).toBe(4)
    expect(contract.maxToolExecutions).toBe(3)
    expect(contract.marker).toBe('ORCHID-42')
    // The SHA must change if any frozen item changes: it is derived from the
    // serialized contract only, so pinning it pins every field at once.
    expect(C1_LIFECYCLE_CANARY_SV1_CONTRACT_SHA256).toBe(
      '7c4577a25499ad512883c006f773bc87d538ae5528e8692da87990158b21c7e5'
    )
  })
})
