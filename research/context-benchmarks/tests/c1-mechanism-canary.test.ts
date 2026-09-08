import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  runC1MechanismCanary,
  resolveC1MechanismCanaryContract,
  C1_MECHANISM_CANARY_CONTRACT,
  C1_MECHANISM_CANARY_CONTRACT_SHA256,
  C1_MECHANISM_CANARY_CONTRACT_V2,
  C1_MECHANISM_CANARY_CONTRACT_V2_SHA256
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

describe('mechanism canary contract versions', () => {
  it('keeps V1 byte-identical and resolves each contract strictly by SHA-256', () => {
    expect(C1_MECHANISM_CANARY_CONTRACT_SHA256).toBe(
      'eac271d5b01ebb6b3bfe5d899737acf21cc878b95ab9ea2ad72b56892c2a250d'
    )
    expect(C1_MECHANISM_CANARY_CONTRACT_V2.contractId).toBe('C1_MECHANISM_CANARY_V2')
    expect(C1_MECHANISM_CANARY_CONTRACT_V2_SHA256).not.toBe(C1_MECHANISM_CANARY_CONTRACT_SHA256)
    const { promptSha256: v1Prompt, ...v1Rest } = C1_MECHANISM_CANARY_CONTRACT
    const { promptSha256: v2Prompt, ...v2Rest } = C1_MECHANISM_CANARY_CONTRACT_V2
    expect(v2Rest).toEqual({ ...v1Rest, contractId: 'C1_MECHANISM_CANARY_V2' })
    expect(v2Prompt).not.toBe(v1Prompt)
    expect(resolveC1MechanismCanaryContract().contract.contractId).toBe('C1_MECHANISM_CANARY_V1')
    expect(
      resolveC1MechanismCanaryContract(C1_MECHANISM_CANARY_CONTRACT_V2_SHA256).contract.contractId
    ).toBe('C1_MECHANISM_CANARY_V2')
    expect(
      resolveC1MechanismCanaryContract(C1_MECHANISM_CANARY_CONTRACT_V2_SHA256).prompt
    ).toContain('Do not reply before both read results are present')
    expect(() => resolveC1MechanismCanaryContract('f'.repeat(64))).toThrow('Unknown canary contract')
  })

  it('runs the V2 contract end to end in fake mode and records the V2 binding', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'canary-v2-fake-'))
    try {
      const result = await runC1MechanismCanary({
        mode: 'FAKE',
        repoRoot,
        outputRoot,
        studyId: 'c1-mechanism-20260908-eeeeeeee',
        executionRevision: 'fake-only',
        contractSha256: C1_MECHANISM_CANARY_CONTRACT_V2_SHA256
      })
      expect(result.status).toBe('PASS')
      expect(result.contractId).toBe('C1_MECHANISM_CANARY_V2')
      expect(result.contractSha256).toBe(C1_MECHANISM_CANARY_CONTRACT_V2_SHA256)
      expect(result.legs.map((leg) => leg.changedCalls)).toEqual([[], [2, 3]])
      const binding = JSON.parse(
        await readFile(join(outputRoot, 'c1-mechanism-20260908-eeeeeeee', 'binding.json'), 'utf8')
      )
      expect(binding.contract.contractId).toBe('C1_MECHANISM_CANARY_V2')
      expect(binding.contractSha256).toBe(C1_MECHANISM_CANARY_CONTRACT_V2_SHA256)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('rejects a live authorization whose contract SHA selects a different version', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'canary-v2-auth-'))
    const getApiKey = vi.fn(() => 'credential-canary')
    try {
      await expect(
        runC1MechanismCanary({
          mode: 'LIVE',
          repoRoot,
          outputRoot,
          studyId: 'c1-mechanism-20260908-ffffffff',
          executionRevision: '0'.repeat(40),
          contractSha256: C1_MECHANISM_CANARY_CONTRACT_V2_SHA256,
          getApiKey,
          authorization: {
            decision: 'AUTHORIZED',
            studyId: 'c1-mechanism-20260908-ffffffff',
            executionRevision: '0'.repeat(40),
            contractSha256: C1_MECHANISM_CANARY_CONTRACT_SHA256
          }
        })
      ).rejects.toThrow('authorization')
      expect(getApiKey).not.toHaveBeenCalled()
      expect(await readdir(outputRoot)).toEqual([])
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })
})
