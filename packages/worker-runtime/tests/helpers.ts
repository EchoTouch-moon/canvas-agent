import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecutionRequestContract } from '@canvas-agent/contracts'
import { ISOLATED_GIT_ENV, computeRequestHash, runCommand, type RunCommandResult } from '../src'

export const TEST_ALLOWLIST = ['git', 'node', 'sh', 'sleep', 'true', 'false', 'cat']

const tempDirs: string[] = []

export function trackTempDir(dir: string): string {
  tempDirs.push(dir)
  return dir
}

export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true }).catch(() => undefined)
    )
  )
}

export interface TempRepo {
  dir: string
  baseCommit: string
  treeHash: string
  workingTreePatchHash: null
}

export async function git(repoPath: string, args: readonly string[]): Promise<RunCommandResult> {
  const result = await runCommand({
    argv: ['git', ...args],
    cwd: repoPath,
    timeoutMs: 30_000,
    maxOutputBytes: 2 * 1024 * 1024,
    commandAllowlist: ['git'],
    signal: undefined,
    env: ISOLATED_GIT_ENV
  })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.exitCode}): ${result.stderr || result.stdout}`)
  }
  return result
}

export async function createTempGitRepo(): Promise<TempRepo> {
  const dir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-worker-')))
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'Canvas Agent Test'])
  await git(dir, ['config', 'user.email', 'test@canvas-agent.local'])
  await writeFile(join(dir, 'README.md'), '# test repository\n')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', 'initial commit'])
  const baseCommit = (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim()
  const treeHash = (await git(dir, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()
  return { dir, baseCommit, treeHash, workingTreePatchHash: null }
}

const FUTURE = '2099-01-01T00:00:00.000Z'

export function buildRequest(
  overrides: Partial<ExecutionRequestContract> = {}
): ExecutionRequestContract {
  const request: Omit<ExecutionRequestContract, 'requestHash'> = {
    executionRequestId: `req_${Math.random().toString(36).slice(2)}`,
    runId: 'run_1',
    workerAttemptNumber: 1,
    taskSpecVersionId: 'spec_1',
    contextSnapshotId: 'snap_1',
    expectedRepositoryRevision: {
      baseCommit: 'a'.repeat(40),
      treeHash: 'b'.repeat(40),
      workingTreePatchHash: null
    },
    checkpointId: null,
    requiredCapabilities: ['git', 'node'],
    agentConfiguration: { provider: 'fixture', model: 'deterministic' },
    toolPolicy: {
      allowedTools: ['write_file', 'run_command'],
      deniedPaths: ['secrets.env'],
      allowNetwork: false,
      allowShell: true
    },
    workspaceStrategy: 'ISOLATED_WORKTREE',
    resourceBudget: {
      maxDurationMs: 30_000,
      maxToolCalls: 20,
      maxDiskBytes: 1_000_000_000
    },
    schemaVersion: 1,
    expiresAt: FUTURE,
    ...overrides
  }
  const requestHash = computeRequestHash(request)
  return { ...request, requestHash }
}

export function requestForRepo(repo: TempRepo, overrides: Partial<ExecutionRequestContract> = {}): ExecutionRequestContract {
  return buildRequest({
    expectedRepositoryRevision: {
      baseCommit: repo.baseCommit,
      treeHash: repo.treeHash,
      workingTreePatchHash: repo.workingTreePatchHash
    },
    ...overrides
  })
}
