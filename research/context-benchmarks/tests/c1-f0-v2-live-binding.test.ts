import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
  loadC1F0V2Contract
} from '../c1/f0/contract/c1-f0-v2-contract'
import { computeC1F0V2ExecutionBinding } from '../c1/f0/v2/runner/c1-f0-v2-execution-runner'
import {
  runC1F0V2AuthorizedStudy,
  type C1F0V2LiveAuthorization
} from '../c1/f0/v2/runner/c1-f0-v2-live-binding'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const node24 = Number(process.versions.node.split('.')[0]) === 24

async function buildAuthorization(studyId: string): Promise<C1F0V2LiveAuthorization> {
  const contract = await loadC1F0V2Contract(REPO_ROOT, 'FINAL_BOUND')
  const binding = await computeC1F0V2ExecutionBinding(REPO_ROOT)
  const contractRecord = contract as unknown as {
    readonly runContractSha256: string
    readonly enrollmentBinding: { readonly taskManifestSha256: string }
    readonly executionBinding: { readonly providerConfigHash: string }
  }
  return {
    decision: 'AUTHORIZED',
    studyId,
    executionRevision: binding.executionRevision,
    executionSurfaceHash: binding.executionSurfaceHash,
    runContractSha256: contractRecord.runContractSha256,
    finalBoundRunContractSha256: contractRecord.runContractSha256,
    enrollmentManifestSha256: contractRecord.enrollmentBinding.taskManifestSha256,
    providerConfigHash: contractRecord.executionBinding.providerConfigHash
  }
}

describe('C1 F0-v2 authorized-provider binding', () => {
  it.skipIf(!node24)('fails closed before credential read on binding mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'canvas-c1-f0-v2-live-auth-'))
    try {
      const authorization = await buildAuthorization('c1-f0-v2-20260913-aaaaaaaa')
      const report = await runC1F0V2AuthorizedStudy({
        repoRoot: REPO_ROOT,
        outputRoot: join(root, 'output'),
        envFilePath: join(root, 'missing.env'),
        authorization: {
          ...authorization,
          executionSurfaceHash: '0'.repeat(64)
        }
      })
      expect(report.status).toBe('F0_V2_NO_GO')
      expect(report.reportDir).toBeNull()
      expect(report.providerCalls).toBe(0)
      expect(report.networkRequests).toBe(0)
      expect(report.failures[0]?.code).toBe('CONTRACT_BINDING_MISMATCH')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.skipIf(!node24)(
    'runs the complete 32-run chain through an injected provider transport',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'canvas-c1-f0-v2-live-e2e-'))
      const envFilePath = join(root, '.env')
      const outputRoot = join(root, 'output')
      let requestCount = 0
      const requestBodies: Record<string, unknown>[] = []
      const fakeFetch: typeof fetch = async (input, init) => {
        expect(String(input)).toBe('https://api.stepfun.com/step_plan/v1/chat/completions')
        expect(init?.method).toBe('POST')
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        requestBodies.push(body)
        requestCount += 1
        return new Response(
          JSON.stringify({
            id: 'fake-provider-response-' + String(requestCount),
            choices: [
              {
                message: { role: 'assistant', content: 'injected provider response' },
                finish_reason: 'stop'
              }
            ],
            usage: {
              prompt_tokens: 11,
              completion_tokens: 5,
              total_tokens: 16
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      try {
        await writeFile(envFilePath, 'STEP_PLAN_API_KEY=fake-test-key\n')
        const authorization = await buildAuthorization('c1-f0-v2-20260913-bbbbbbbb')
        const report = await runC1F0V2AuthorizedStudy({
          repoRoot: REPO_ROOT,
          outputRoot,
          envFilePath,
          fetchImpl: fakeFetch,
          authorization
        })
        expect(requestCount).toBe(32)
        expect(requestBodies).toHaveLength(32)
        expect(report.executionMode).toBe('AUTHORIZED_PROVIDER_NATIVE_ONLY')
        expect(report.responseSource).toBe('AUTHORIZED_PROVIDER')
        expect(report.transportMode).toBe('INJECTED_FAKE_FETCH')
        expect(report.providerCalls).toBe(32)
        expect(report.networkRequests).toBe(0)
        expect(report.providerCallPermits).toBe(32)
        expect(report.responseCalls).toBe(32)
        expect(report.runs).toHaveLength(32)
        expect(report.runsStarted).toBe(32)
        expect(report.runsCompleted).toBe(32)
        expect(report.blockedRuns).toBe(0)
        expect(report.runs.every((run) => run.fixtureCleaned)).toBe(true)
        expect(report.runs.every((run) => run.evidenceStatus === 'COMPLETE')).toBe(true)

        const studyManifest = JSON.parse(
          await readFile(join(report.reportDir!, 'study-manifest.json'), 'utf8')
        ) as Record<string, unknown>
        expect(studyManifest).toMatchObject({
          responseSource: 'AUTHORIZED_PROVIDER',
          transportMode: 'INJECTED_FAKE_FETCH',
          providerCalls: 32,
          networkRequests: 0,
          freezeCandidateRunContractSha256: C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256
        })
        const runManifest = await readFile(join(report.reportDir!, 'run-manifest.json'), 'utf8')
        const responseLedger = await readFile(
          join(report.reportDir!, 'response-ledger.jsonl'),
          'utf8'
        )
        const provenance = await readFile(join(report.reportDir!, 'tool-provenance.jsonl'), 'utf8')
        expect(runManifest).toContain('"runsStarted": 32')
        expect(responseLedger).toContain('"usageSource":"PROVIDER_REPORTED"')
        for (const content of [runManifest, responseLedger, provenance]) {
          expect(content).not.toContain('fake-test-key')
          expect(content).not.toContain('assistantContent')
          expect(content).not.toContain('authorizationHeader')
          expect(content).not.toContain('argumentsJson')
          expect(content).not.toContain('rawProviderPayload')
          expect(content).not.toContain('toolResultContent')
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    120_000
  )
})
