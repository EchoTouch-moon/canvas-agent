import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildFinalBoundF1Contract,
  computeC1F1Native32ExecutionBinding,
  runC1F1Native32AuthorizedStudy,
  type C1F1Native32LiveAuthorization
} from '../c1/f1/runner/c1-f1-32-execution-runner'
import { loadC1F1Native32Contract } from '../c1/f1/contract/c1-f1-native-feasibility-32-contract'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const API_KEY_SENTINEL = 'f1-authorized-runner-test-only-key'
const outputRoots = new Set<string>()

async function temporaryOutputRoot(): Promise<string> {
  const outputRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-f1-32-authorized-'))
  outputRoots.add(outputRoot)
  return outputRoot
}

async function authorizedRecord(studyId: string): Promise<C1F1Native32LiveAuthorization> {
  const candidate = await loadC1F1Native32Contract(REPO_ROOT, 'FREEZE_CANDIDATE')
  const binding = await computeC1F1Native32ExecutionBinding(REPO_ROOT)
  const { contract } = buildFinalBoundF1Contract({ candidate, binding })
  const root = contract as unknown as Record<string, unknown>
  const execution = root['executionBinding'] as Record<string, unknown>
  const enrollment = root['enrollmentBinding'] as Record<string, unknown>
  return {
    schemaVersion: 1,
    decision: 'AUTHORIZED',
    scope: 'C1_F1_NATIVE_FEASIBILITY_32_ONLY',
    owner: 'synthetic-test-owner',
    authorizedAt: new Date().toISOString(),
    studyId,
    identityStatus: 'FRESH_NEVER_CLAIMED_SINGLE_USE',
    executionRevision: binding.executionRevision,
    executionSurfaceHash: binding.executionSurfaceHash,
    bindingControlSurfaceHash: binding.bindingControlSurfaceHash,
    runContractSha256: String(root['runContractSha256']),
    finalBoundRunContractSha256: String(root['finalBoundRunContractSha256']),
    freezeCandidateRunContractSha256: String(root['freezeCandidateRunContractSha256']),
    enrollmentManifestSha256: String(enrollment['taskManifestSha256']),
    providerConfigHash: String(execution['providerConfigHash']),
    provider: String(execution['provider']),
    model: String(execution['model']),
    endpoint: String(execution['endpoint']),
    budgets: root['budgets'] as Record<string, unknown>,
    runtimeIntervention: 'DISABLED',
    fallback: 'NONE',
    retry: 'FORBIDDEN',
    resume: 'FORBIDDEN',
    reuse: 'FORBIDDEN',
    credentialPersistence: 'MEMORY_ONLY'
  }
}

function providerResponse(input: {
  readonly responseId: string
  readonly finishReason: 'stop' | 'tool_calls'
  readonly toolCallId?: string
}): Response {
  return new Response(
    JSON.stringify({
      id: input.responseId,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'fake-provider-private-content',
            ...(input.finishReason === 'tool_calls'
              ? {
                  tool_calls: [
                    {
                      id: input.toolCallId,
                      type: 'function',
                      function: {
                        name: 'read',
                        arguments: JSON.stringify({ path: 'README.md' })
                      }
                    }
                  ]
                }
              : {})
          },
          finish_reason: input.finishReason
        }
      ],
      usage: {
        prompt_tokens: 21,
        completion_tokens: 5,
        total_tokens: 26,
        cached_tokens: 3,
        cache_write_tokens: 0
      }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

afterEach(async () => {
  await Promise.all([...outputRoots].map((root) => rm(root, { recursive: true, force: true })))
  outputRoots.clear()
})

describe('C1 F1-32 authorized Provider runner', () => {
  it('rejects a stale surface binding before credential access, identity claim, or fetch', async () => {
    const outputRoot = await temporaryOutputRoot()
    const authorization = await authorizedRecord('c1-f1-32-20260915-aaaaaaaa')
    const staleAuthorization = {
      ...authorization,
      executionSurfaceHash: '0'.repeat(64)
    }
    let credentialReads = 0
    let fetchCalls = 0
    const report = await runC1F1Native32AuthorizedStudy({
      repoRoot: REPO_ROOT,
      outputRoot,
      authorization: staleAuthorization,
      readApiKey: () => {
        credentialReads += 1
        return API_KEY_SENTINEL
      },
      fetchImpl: async () => {
        fetchCalls += 1
        return providerResponse({ responseId: 'should-not-fetch', finishReason: 'stop' })
      }
    })

    expect(report.status).toBe('NO_GO')
    expect(report.reportDir).toBeNull()
    expect(report.failures.map((failure) => failure.code)).toContain('NOT_AUTHORIZED')
    expect(credentialReads).toBe(0)
    expect(fetchCalls).toBe(0)
    expect(await readdir(outputRoot)).toEqual([])
  })

  it('runs the frozen 32-run schedule through an injected fake Provider transport without network access', async () => {
    const outputRoot = await temporaryOutputRoot()
    const authorization = await authorizedRecord('c1-f1-32-20260915-bbbbbbbb')
    let credentialReads = 0
    let fetchCalls = 0
    let identityAlreadyClaimedAtCredentialRead = false
    let sawExpectedAuthorizationHeader = false
    const report = await runC1F1Native32AuthorizedStudy({
      repoRoot: REPO_ROOT,
      outputRoot,
      authorization,
      readApiKey: async () => {
        credentialReads += 1
        try {
          await stat(join(outputRoot, authorization.studyId))
          identityAlreadyClaimedAtCredentialRead = true
        } catch {
          identityAlreadyClaimedAtCredentialRead = false
        }
        return API_KEY_SENTINEL
      },
      fetchImpl: async (input, init) => {
        fetchCalls += 1
        if (fetchCalls === 1) {
          expect(String(input)).toBe('https://api.stepfun.com/step_plan/v1/chat/completions')
          expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + API_KEY_SENTINEL)
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          expect(body['model']).toBe('step-3.7-flash')
          expect(body['max_tokens']).toBe(16384)
          sawExpectedAuthorizationHeader = true
        }
        return providerResponse({
          responseId: 'fake-provider-' + String(fetchCalls),
          finishReason: fetchCalls <= 32 ? 'tool_calls' : 'stop',
          ...(fetchCalls <= 32 ? { toolCallId: 'fake-tool-' + String(fetchCalls) } : {})
        })
      }
    })

    expect(report.executionMode).toBe('CREDENTIAL_FREE_FAKE_PROVIDER')
    expect(report.responseSource).toBe('AUTHORIZED_PROVIDER')
    expect(report.transportMode).toBe('INJECTED_FAKE_FETCH')
    expect(report.runsPlanned).toBe(32)
    expect(report.runsStarted).toBe(32)
    expect(report.runsCompleted).toBe(32)
    expect(report.providerCalls).toBe(63)
    expect(report.providerCallPermits).toBe(63)
    expect(report.networkRequests).toBe(0)
    expect(credentialReads).toBe(1)
    expect(identityAlreadyClaimedAtCredentialRead).toBe(false)
    expect(fetchCalls).toBe(63)
    expect(report.studyTerminal).toBe(false)
    expect(report.failures.some((failure) => failure.message.includes('maxCalls=32'))).toBe(true)
    expect(sawExpectedAuthorizationHeader).toBe(true)
    expect(report.reportDir).not.toBeNull()
    const claimedIdentity = await stat(join(outputRoot, authorization.studyId))
    expect(claimedIdentity.isDirectory()).toBe(true)
    const studyManifest = JSON.parse(
      await readFile(join(report.reportDir!, 'study-manifest.json'), 'utf8')
    ) as Record<string, unknown>
    expect(studyManifest).toMatchObject({
      responseSource: 'AUTHORIZED_PROVIDER',
      transportMode: 'INJECTED_FAKE_FETCH',
      providerCalls: 63,
      networkRequests: 0,
      providerCallPermits: 63,
      fallback: 'NONE',
      runtimeIntervention: 'DISABLED'
    })
    const artifacts = await Promise.all(
      [
        'study-manifest.json',
        'run-manifest.json',
        'checkpoints.jsonl',
        'response-ledger.jsonl',
        'tool-provenance.jsonl',
        'post-run-snapshot-manifest.jsonl',
        'task-adjudication.jsonl',
        'feasibility-summary.json'
      ].map((name) => readFile(join(report.reportDir!, name), 'utf8'))
    )
    expect(artifacts.join('\n')).not.toContain(API_KEY_SENTINEL)
    expect(artifacts.join('\n')).not.toContain('fake-provider-private-content')
  }, 30_000)

  it('enforces the per-run 32-call ceiling through the authorized source before stopping the run', async () => {
    const outputRoot = await temporaryOutputRoot()
    const authorization = await authorizedRecord('c1-f1-32-20260915-cccccccc')
    let fetchCalls = 0
    const report = await runC1F1Native32AuthorizedStudy({
      repoRoot: REPO_ROOT,
      outputRoot,
      authorization,
      testRunLimit: 1,
      readApiKey: () => API_KEY_SENTINEL,
      fetchImpl: async () => {
        fetchCalls += 1
        return providerResponse({
          responseId: 'fake-loop-' + String(fetchCalls),
          finishReason: 'tool_calls',
          toolCallId: 'fake-tool-' + String(fetchCalls)
        })
      }
    })

    expect(report.executionMode).toBe('CREDENTIAL_FREE_FAKE_PROVIDER')
    expect(report.runsPlanned).toBe(32)
    expect(report.runsStarted).toBe(1)
    expect(report.providerCalls).toBe(32)
    expect(report.providerCallPermits).toBe(32)
    expect(report.networkRequests).toBe(0)
    expect(fetchCalls).toBe(32)
  })
})
