import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  C1_LIFECYCLE_CANARY_SV2_CONTRACT_SHA256,
  runC1LifecycleCanarySv2
} from '../src/c1-lifecycle-canary-sv2'
import { C1ScriptedResponseSource } from '../src/c1-live-binding'

const repoRoot = resolve(import.meta.dirname, '../../..')

describe('C1_LIFECYCLE_CANARY_SV2 (harness-seeded, fake provider)', () => {
  it('persists replay before the one request and sends a pure-evicted context', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'c1-sv2-pass-'))
    const studyId = 'c1-lifecycle-sv2-20260909-aaaaaaaa'
    try {
      const report = await runC1LifecycleCanarySv2({
        mode: 'FAKE',
        repoRoot,
        outputRoot,
        studyId,
        executionRevision: 'fake-only'
      })
      expect(report).toMatchObject({
        status: 'PASS',
        terminal: true,
        retired: true,
        providerCalls: 0,
        networkRequests: 0,
        fakeResponses: 1,
        attemptedLegs: 1,
        completedLegs: 1,
        providerResponseObserved: true,
        providerTerminalObserved: true,
        protocolCompleted: true,
        replayRecords: 2,
        replayVerdicts: { SUPERSEDED: 1, NOT_CANDIDATE: 1 },
        removedSourceKeys: [
          'run/tool-call://sv2-seed-read-a-v1',
          'run/tool-result://sv2-seed-read-a-v1'
        ],
        stalePairPresentInProviderBoundMessages: false,
        responseOutcome: 'COMPLETE'
      })
      expect(report.providerBoundSourceKeys).not.toContain('run/tool-call://sv2-seed-read-a-v1')
      expect(report.callAccounting.allRecorded).toMatchObject({
        outboundPermits: 1,
        normalizedResponses: 1,
        permitsWithoutRecordedResponse: 0,
        responseRecorded: 1,
        toolRequests: 0,
        recordedToolExecutions: 0
      })
      const dir = join(outputRoot, studyId)
      const replay = await readFile(join(dir, 'lifecycle-replay.jsonl'), 'utf8')
      const checkpoints = await readFile(join(dir, 'checkpoints.jsonl'), 'utf8')
      const reportRaw = await readFile(join(dir, 'report.json'), 'utf8')
      for (const raw of [replay, checkpoints, reportRaw]) {
        expect(raw).not.toContain('export const value = 1')
        expect(raw).not.toContain('export const value = 2')
        expect(raw).not.toContain('This file contains no task instructions')
      }
      expect(await readdir(dir)).toEqual(
        expect.arrayContaining([
          'binding.json',
          'checkpoints.jsonl',
          'lifecycle-replay.jsonl',
          'report.json'
        ])
      )
      await expect(
        runC1LifecycleCanarySv2({
          mode: 'FAKE',
          repoRoot,
          outputRoot,
          studyId,
          executionRevision: 'fake-only'
        })
      ).rejects.toThrow()
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 30000)

  it('records a valid CONTINUE response once and stops before a second request', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'c1-sv2-continue-'))
    let served = 0
    try {
      const source = new C1ScriptedResponseSource([
        {
          responseId: 'sv2-continue',
          assistantMessageCount: 1,
          assistantContent: 'continue',
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 12,
            usageSource: 'SCRIPTED_FAKE'
          },
          toolRequests: [],
          toolExecutions: [],
          outcome: 'CONTINUE'
        }
      ])
      const report = await runC1LifecycleCanarySv2({
        mode: 'FAKE',
        repoRoot,
        outputRoot,
        studyId: 'c1-lifecycle-sv2-20260909-bbbbbbbb',
        executionRevision: 'fake-only',
        fakeSourceFactory: () => ({
          kind: 'SCRIPTED_FAKE',
          next: async (request) => {
            served += 1
            return source.next(request)
          }
        })
      })
      expect(report).toMatchObject({
        status: 'FAIL',
        providerCalls: 0,
        networkRequests: 0,
        fakeResponses: 1,
        attemptedLegs: 1,
        completedLegs: 0,
        providerResponseObserved: true,
        providerTerminalObserved: false,
        protocolCompleted: false,
        failureCode: 'PREFLIGHT_FAILURE'
      })
      expect(served).toBe(1)
      expect(report.callAccounting.allRecorded).toMatchObject({
        outboundPermits: 1,
        normalizedResponses: 1,
        permitsWithoutRecordedResponse: 0,
        responseRecorded: 1
      })
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 30000)

  it('rejects invalid live authorization before output or credential access', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'c1-sv2-auth-'))
    const getApiKey = vi.fn(() => 'credential-canary')
    try {
      await expect(
        runC1LifecycleCanarySv2({
          mode: 'LIVE',
          repoRoot,
          outputRoot,
          studyId: 'c1-lifecycle-sv2-20260909-cccccccc',
          executionRevision: '0'.repeat(40),
          authorization: {
            decision: 'AUTHORIZED',
            studyId: 'c1-lifecycle-sv2-20260909-cccccccc',
            executionRevision: '0'.repeat(40),
            contractSha256: 'wrong'
          },
          getApiKey
        })
      ).rejects.toThrow('authorization')
      expect(getApiKey).not.toHaveBeenCalled()
      expect(await readdir(outputRoot)).toEqual([])
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('exports a stable contract identity for a future authorization record', () => {
    expect(C1_LIFECYCLE_CANARY_SV2_CONTRACT_SHA256).toMatch(/^[a-f0-9]{64}$/)
  })
})
