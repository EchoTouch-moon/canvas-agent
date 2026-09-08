import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  runC1MechanismCanary,
  C1_MECHANISM_CANARY_CONTRACT_SHA256
} from '../src/c1-mechanism-canary'
import { C1ScriptedResponseSource } from '../src/c1-live-binding'

const repoRoot = resolve(import.meta.dirname, '../../..')

describe('independent read-only mechanism canary', () => {
  it('runs the complete canary with scripted responses and retires its identity', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'canary-fake-'))
    const getApiKey = vi.fn(() => {
      throw new Error('fake mode must not read credentials')
    })
    try {
      const options = {
        mode: 'FAKE' as const,
        repoRoot,
        outputRoot,
        studyId: 'c1-mechanism-20260908-aaaaaaaa',
        executionRevision: 'fake-only',
        getApiKey
      }
      const result = await runC1MechanismCanary(options)
      expect(result.status).toBe('PASS')
      expect(result).toMatchObject({
        providerCalls: 0,
        networkRequests: 0,
        fakeResponses: 6,
        completedLegs: 2,
        terminal: true,
        retired: true
      })
      expect(result.legs.map((leg) => leg.changedCalls)).toEqual([[], [2, 3]])
      const lastRuntime = result.callAccounting.calls
        .filter((call) => call.arm === 'RUNTIME')
        .at(-1)!
      expect(lastRuntime.receipt?.carriedRemovedSourceKeys).toHaveLength(2)
      expect(lastRuntime.receipt?.providerBoundSourceKeys).toHaveLength(2)
      const removals = lastRuntime.receipt?.decisionDetails?.filter(
        (decision) => decision.kind === 'REMOVE'
      )
      expect(removals).toHaveLength(2)
      expect(
        removals?.every(
          (decision) =>
            decision.reasonCodes.includes('SUPERSEDED') && decision.sourceVersionId.length > 0
        )
      ).toBe(true)
      expect(lastRuntime.receipt?.carriedRemovalEvidence?.[0]?.removalTransitionId).toBeTruthy()
      expect(result.callAccounting.allRecorded).toMatchObject({
        normalizedResponses: 6,
        recordedToolExecutions: 4
      })
      expect(getApiKey).not.toHaveBeenCalled()
      const snapshot = await readFile(join(outputRoot, options.studyId, 'report.json'), 'utf8')
      await expect(runC1MechanismCanary(options)).rejects.toThrow()
      expect(await readFile(join(outputRoot, options.studyId, 'report.json'), 'utf8')).toBe(
        snapshot
      )
      expect(snapshot).not.toContain('COBALT-17')
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('rejects a missing or wrong live authorization before claiming identity or reading credentials', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'canary-auth-'))
    const getApiKey = vi.fn(() => 'credential-canary')
    try {
      const options = {
        mode: 'LIVE' as const,
        repoRoot,
        outputRoot,
        studyId: 'c1-mechanism-20260908-bbbbbbbb',
        executionRevision: '0'.repeat(40),
        getApiKey
      }
      await expect(runC1MechanismCanary(options)).rejects.toThrow('authorization')
      await expect(
        runC1MechanismCanary({
          ...options,
          authorization: {
            decision: 'AUTHORIZED',
            studyId: options.studyId,
            executionRevision: options.executionRevision,
            contractSha256: 'wrong'
          }
        })
      ).rejects.toThrow('authorization')
      await expect(
        runC1MechanismCanary({
          ...options,
          authorization: {
            decision: 'AUTHORIZED',
            studyId: options.studyId,
            executionRevision: options.executionRevision,
            contractSha256: C1_MECHANISM_CANARY_CONTRACT_SHA256
          }
        })
      ).rejects.toThrow('revision mismatch')
      expect(getApiKey).not.toHaveBeenCalled()
      expect(await readdir(outputRoot)).toEqual([])
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('blocks a non-read tool before execution and never starts Runtime', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'canary-scope-'))
    const factory = vi.fn(
      () =>
        new C1ScriptedResponseSource([
          {
            responseId: 'unsafe-fake',
            assistantMessageCount: 1,
            assistantContent: '',
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              usageSource: 'SCRIPTED_FAKE'
            },
            toolRequests: [
              {
                toolCallId: 'forbidden',
                toolName: 'bash',
                argumentsJson: '{"command":"echo DO_NOT_EXECUTE"}'
              }
            ],
            toolExecutions: [],
            outcome: 'CONTINUE'
          }
        ])
    )
    try {
      const result = await runC1MechanismCanary({
        mode: 'FAKE',
        repoRoot,
        outputRoot,
        studyId: 'c1-mechanism-20260908-cccccccc',
        executionRevision: 'fake-only',
        fakeSourceFactory: factory
      })
      expect(result).toMatchObject({
        status: 'FAIL',
        fakeResponses: 1,
        attemptedLegs: 1,
        completedLegs: 0,
        unexecutedLegs: 1
      })
      expect(result.callAccounting.allRecorded).toMatchObject({
        normalizedResponses: 1,
        recordedToolExecutions: 0
      })
      expect(factory).toHaveBeenCalledTimes(1)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })
  it('keeps a permanent live identity claim across output roots without reaching a provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'canary-identity-registry-'))
    const isolatedRepo = join(root, 'repo')
    const getApiKey = vi.fn(() => {
      throw new Error('TEST_ONLY_CREDENTIAL_FAILURE')
    })
    try {
      await mkdir(isolatedRepo)
      execFileSync('git', ['init', '-q', isolatedRepo])
      execFileSync(
        'git',
        [
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'commit.gpgSign=false',
          '-c',
          'user.name=Canary Test',
          '-c',
          'user.email=canary@example.invalid',
          'commit',
          '--allow-empty',
          '-qm',
          'isolated test'
        ],
        { cwd: isolatedRepo }
      )
      const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: isolatedRepo,
        encoding: 'utf8'
      }).trim()
      const studyId = 'c1-mechanism-20260908-dddddddd'
      const options = {
        mode: 'LIVE' as const,
        repoRoot: isolatedRepo,
        studyId,
        executionRevision: revision,
        getApiKey,
        authorization: {
          decision: 'AUTHORIZED' as const,
          studyId,
          executionRevision: revision,
          contractSha256: C1_MECHANISM_CANARY_CONTRACT_SHA256
        }
      }
      const first = await runC1MechanismCanary({ ...options, outputRoot: join(root, 'first') })
      expect(first).toMatchObject({
        status: 'FAIL',
        providerCalls: 0,
        networkRequests: 0,
        attemptedLegs: 0,
        terminal: true
      })
      await expect(
        runC1MechanismCanary({ ...options, outputRoot: join(root, 'different-output') })
      ).rejects.toThrow()
      expect(getApiKey).toHaveBeenCalledTimes(1)
      expect(await readdir(join(isolatedRepo, '.git', 'c1-mechanism-identities'))).toEqual([
        `${studyId}.json`
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
