import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FixtureAgentAdapter, createWorker, type DispatchResult } from '../src'
import {
  TEST_ALLOWLIST,
  cleanupTempDirs,
  createTempGitRepo,
  requestForRepo
} from './helpers'

async function makeWorker(runtimeDir: string, sourceRepoPath: string, request: unknown): Promise<DispatchResult> {
  const worker = createWorker({
    runtimeDirectory: runtimeDir,
    sourceRepositoryPath: sourceRepoPath,
    capabilities: ['git', 'node'],
    commandAllowlist: TEST_ALLOWLIST,
    verificationCommands: [],
    agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
  })
  return worker.dispatch({ request })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readdir(path)
    return true
  } catch {
    return false
  }
}

describe('execution request validation gate', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('rejects a request whose hash does not match its content', async () => {
    const repo = await createTempGitRepo()
    const runtimeDir = await mkdtemp(join(tmpdir(), 'ca-runtime-'))
    const request = requestForRepo(repo)
    const tampered = { ...request, resourceBudget: { ...request.resourceBudget, maxToolCalls: 999 } }

    const result = await makeWorker(runtimeDir, repo.dir, tampered)
    expect(result.outcome).toBe('VALIDATION_REJECTED')
    expect(result.claimGranted).toBe(false)
    expect(await pathExists(join(runtimeDir, 'worktrees'))).toBe(false)
    expect(await pathExists(join(runtimeDir, 'artifacts'))).toBe(false)
  })

  it('rejects an expired request before creating any worktree', async () => {
    const repo = await createTempGitRepo()
    const runtimeDir = await mkdtemp(join(tmpdir(), 'ca-runtime-'))
    const request = requestForRepo(repo, { expiresAt: '2020-01-01T00:00:00.000Z' })

    const result = await makeWorker(runtimeDir, repo.dir, request)
    expect(result.outcome).toBe('VALIDATION_REJECTED')
    expect(result.rejectionReason).toContain('expired')
    expect(await pathExists(join(runtimeDir, 'worktrees'))).toBe(false)
  })

  it('rejects a request that requires a missing capability', async () => {
    const repo = await createTempGitRepo()
    const runtimeDir = await mkdtemp(join(tmpdir(), 'ca-runtime-'))
    const request = requestForRepo(repo, { requiredCapabilities: ['docker'] })

    const result = await makeWorker(runtimeDir, repo.dir, request)
    expect(result.outcome).toBe('VALIDATION_REJECTED')
    expect(result.rejectionReason).toContain('docker')
    expect(await pathExists(join(runtimeDir, 'worktrees'))).toBe(false)
  })

  it('accepts a structurally valid request with a matching hash', async () => {
    const repo = await createTempGitRepo()
    const runtimeDir = await mkdtemp(join(tmpdir(), 'ca-runtime-'))
    const result = await makeWorker(runtimeDir, repo.dir, requestForRepo(repo))
    expect(result.outcome).toBe('SUCCEEDED')
    expect(result.claimGranted).toBe(true)
  })
})
