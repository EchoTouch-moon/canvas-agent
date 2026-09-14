import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { C1_F0_LIVE_BINDING_ID, runC1F0AuthorizedStudy } from '../c1/f0/runner/c1-f0-live-binding'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const node24 = Number(process.versions.node.split('.')[0]) === 24

describe('C1 F0 authorized live binding', () => {
  it.skipIf(!node24)(
    'rejects a stale authorization before identity claim or credential read',
    async () => {
      const outputRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-f0-live-auth-'))
      const missingEnv = join(outputRoot, 'missing.env')
      try {
        const report = await runC1F0AuthorizedStudy({
          repoRoot: REPO_ROOT,
          outputRoot,
          envFilePath: missingEnv,
          authorization: {
            decision: 'AUTHORIZED',
            studyId: 'c1-f0-20260912-aaaaaaaa',
            executionRevision: '0'.repeat(40),
            executionSurfaceHash: '0'.repeat(64),
            runContractSha256: '0'.repeat(64),
            providerConfigHash: '0'.repeat(64)
          }
        })
        expect(report.bindingId).toBe(C1_F0_LIVE_BINDING_ID)
        expect(report.status).toBe('F0_NO_GO')
        expect(report.reportDir).toBeNull()
        expect(report.failures).toEqual([expect.objectContaining({ code: 'NOT_AUTHORIZED' })])
      } finally {
        await rm(outputRoot, { recursive: true, force: true })
      }
    }
  )

  it.skipIf(!node24)(
    'runs all 32 Native legs through an injected fake fetch without external network',
    async () => {
      const outputRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-f0-live-fake-'))
      const envFile = join(outputRoot, '.env')
      await writeFile(envFile, 'STEP_PLAN_API_KEY=test-only-memory-key\n', 'utf8')
      try {
        const report = await runC1F0AuthorizedStudy({
          repoRoot: REPO_ROOT,
          outputRoot,
          envFilePath: envFile,
          authorization: {
            decision: 'AUTHORIZED',
            studyId: 'c1-f0-20260912-bbbbbbbb',
            executionRevision: 'c38785ada3573c2cc7a3927fd53c6670142eb537',
            executionSurfaceHash:
              '587e4ec6cd7532ff405cb18214215f15d8cd7b0e90a8a58a6220336e82f5eeff',
            runContractSha256: 'a564ae3f3102678142d7a67c3e0a33f238c22d3221784d7926cc2b44d8349122',
            providerConfigHash: 'bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a'
          },
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                id: 'fake-f0-response',
                choices: [
                  { message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }
                ],
                usage: {
                  prompt_tokens: 12,
                  completion_tokens: 2,
                  total_tokens: 14,
                  prompt_tokens_details: { cached_tokens: 4 }
                }
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )
        })
        expect(report.status).toBe('F0_FEASIBILITY_NO_GO')
        expect(report.providerCalls).toBe(32)
        expect(report.networkRequests).toBe(32)
        expect(report.providerCallPermits).toBe(32)
        expect(report.runsStarted).toBe(32)
        expect(report.runsCompleted).toBe(32)
        expect(report.runs.every((run) => run.diagnostics.responseCalls === 1)).toBe(true)
        expect(report.runs.every((run) => run.oracleStatus === 'FAIL')).toBe(true)
        const ledger = await readFile(join(report.reportDir!, 'response-ledger.jsonl'), 'utf8')
        expect(ledger).toContain('PROVIDER_REPORTED')
        expect(ledger).not.toContain('test-only-memory-key')
        expect(ledger).not.toMatch(
          /providerBoundMessages|argumentsJson|assistantContent|rawProviderPayload|authorizationHeader|toolResultContent/
        )
      } finally {
        await rm(outputRoot, { recursive: true, force: true })
      }
    },
    60_000
  )
})
