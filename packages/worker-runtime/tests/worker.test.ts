import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { FixtureAgentAdapter, createWorker, type DispatchResult } from '../src'
import {
  TEST_ALLOWLIST,
  cleanupTempDirs,
  createTempGitRepo,
  git,
  requestForRepo
} from './helpers'

async function runtimeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ca-runtime-'))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readdir(path)
    return true
  } catch {
    return false
  }
}

describe('worker dispatch against a temporary git repository', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('executes in an isolated worktree and returns patch, verification data and summary hashes', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const request = requestForRepo(repo)
    const agent = new FixtureAgentAdapter({
      steps: [{ kind: 'appendFile', file: 'docs/change.md', lines: ['# Change', 'made by fixture'] }],
      summary: 'wrote docs/change.md'
    })
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [
        ['node', '-e', 'process.exit(require("fs").existsSync("docs/change.md") ? 0 : 1)']
      ],
      agent
    })

    const result = await worker.dispatch({ request })

    expect(result.outcome).toBe('SUCCEEDED')
    expect(result.claimGranted).toBe(true)
    expect(result.patch).toBeDefined()
    expect(result.patch).toContain('docs/change.md')
    expect(result.patchHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.verificationResults).toHaveLength(1)
    expect(result.verificationResults?.[0]?.exitCode).toBe(0)
    expect(result.agentSummary).toBe('wrote docs/change.md')
    expect(result.artifacts?.some((artifact) => artifact.kind === 'PATCH')).toBe(true)
    expect(result.artifacts?.some((artifact) => artifact.kind === 'TEST_RESULT')).toBe(true)

    const patchArtifact = result.artifacts?.find((artifact) => artifact.kind === 'PATCH')
    if (patchArtifact === undefined) {
      throw new Error('expected a PATCH artifact')
    }
    const written = await readFile(
      join(runtime, 'artifacts', request.executionRequestId, patchArtifact.fileName),
      'utf8'
    )
    expect(written).toContain('docs/change.md')

    expect(await pathExists(join(runtime, 'worktrees', request.executionRequestId))).toBe(false)
    expect(existsSync(join(repo.dir, 'docs', 'change.md'))).toBe(false)
  })

  it('only one claim succeeds for the same execution request', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const agent = new FixtureAgentAdapter({ steps: [], summary: 'idle' })
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent
    })
    const request = requestForRepo(repo)

    const first = await worker.dispatch({ request })
    const second = await worker.dispatch({ request })

    expect(first.outcome).toBe('SUCCEEDED')
    expect(second.outcome).toBe('CLAIM_REJECTED')
    expect(second.claimGranted).toBe(false)
  })

  it('reports a repository revision mismatch without touching the original repository', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
    })
    const staleRequest = requestForRepo(repo)

    await writeFile(join(repo.dir, 'README.md'), '# test repository\nchanged by another author\n')
    await git(repo.dir, ['commit', '-am', 'external change'])

    const result = await worker.dispatch({ request: staleRequest })
    expect(result.outcome).toBe('REVISION_MISMATCH')
    expect(result.revisionMismatch?.field).toBe('baseCommit')
    expect(await pathExists(join(runtime, 'worktrees'))).toBe(false)
  })

  it('stops a timed-out verification process tree and returns bounded partial evidence', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [['node', '-e', 'setTimeout(() => {}, 30_000)']],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' }),
      gitTimeoutMs: 30_000
    })
    const started = Date.now()

    const result = await worker.dispatch({
      request: requestForRepo(repo, {
        resourceBudget: { maxDurationMs: 600, maxToolCalls: 5, maxDiskBytes: 100_000_000 }
      })
    })

    expect(result.outcome).toBe('PARTIAL')
    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(result.verificationResults?.[0]?.timedOut).toBe(true)
    expect(result.artifacts?.some((artifact) => artifact.kind === 'AGENT_PARTIAL')).toBe(true)
    expect(result.recovery?.state).toBe('interrupted')
  })

  it('returns explicit partial evidence when an adapter action is denied', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const agent = new FixtureAgentAdapter({
      steps: [{ kind: 'appendFile', file: '../escape.txt', lines: ['nope'] }],
      summary: 'attempting escape'
    })
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent
    })

    const result = await worker.dispatch({ request: requestForRepo(repo) })

    expect(result.outcome).toBe('PARTIAL')
    expect(result.rejectionReason).toContain('denied')
    expect(result.artifacts?.some((artifact) => artifact.kind === 'AGENT_PARTIAL')).toBe(true)
    expect(result.recovery?.state).toBe('interrupted')
  })

  it('a frozen logical wall clock cannot freeze the elapsed budget', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [['true']],
      now: () => '2030-01-01T00:00:00.000Z',
      agent: new FixtureAgentAdapter({
        steps: [{ kind: 'runCommand', argv: ['node', '-e', 'setTimeout(() => {}, 100)'] }],
        summary: 'busy'
      })
    })

    const result = await worker.dispatch({
      request: requestForRepo(repo, {
        expiresAt: '2099-01-01T00:00:00.000Z',
        resourceBudget: { maxDurationMs: 1, maxToolCalls: 5, maxDiskBytes: 100_000_000 }
      })
    })

    expect(result.outcome).toBe('PARTIAL')
    expect(result.rejectionReason).toBe('budget exceeded: maxDurationMs')
    expect(result.recovery?.state).toBe('interrupted')
  })

  it('cancels a running dispatch and returns a bounded partial result', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const agent = new FixtureAgentAdapter({
      steps: [{ kind: 'runCommand', argv: ['node', '-e', 'setTimeout(() => {}, 30_000)'] }],
      summary: 'busy'
    })
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent,
      gitTimeoutMs: 30_000
    })
    const controller = new AbortController()
    const dispatchPromise = worker.dispatch({
      request: requestForRepo(repo, {
        resourceBudget: { maxDurationMs: 30_000, maxToolCalls: 5, maxDiskBytes: 100_000_000 }
      }),
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 300)

    const result = await dispatchPromise
    expect(result.outcome).toBe('CANCELLED')
    expect(result.artifacts?.some((artifact) => artifact.kind === 'AGENT_PARTIAL')).toBe(true)
  })

  it('converges a preflight cancellation to CANCELLED regardless of phase', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
    })
    const controller = new AbortController()
    controller.abort()

    const result = await worker.dispatch({
      request: requestForRepo(repo, {
        resourceBudget: { maxDurationMs: 30_000, maxToolCalls: 5, maxDiskBytes: 100_000_000 }
      }),
      signal: controller.signal
    })

    expect(result.outcome).toBe('CANCELLED')
    expect(result.claimGranted).toBe(true)
    expect(await pathExists(join(runtime, 'worktrees'))).toBe(false)
  })
})
