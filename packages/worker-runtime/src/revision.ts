import type { RepositoryRevisionContract } from '@canvas-agent/contracts'
import { RevisionMismatchError } from './errors'
import { runCommand, type RunCommandResult } from './process-runner'
import { sha256Hex } from './validation'

export const ISOLATED_GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Canvas Agent Worker',
  GIT_AUTHOR_EMAIL: 'worker@canvas-agent.local',
  GIT_COMMITTER_NAME: 'Canvas Agent Worker',
  GIT_COMMITTER_EMAIL: 'worker@canvas-agent.local'
}

export interface GitRunOptions {
  cwd: string
  timeoutMs: number
  maxOutputBytes: number
  commandAllowlist: readonly string[]
  signal: AbortSignal | undefined
}

export async function runGitCommand(argv: readonly string[], options: GitRunOptions): Promise<RunCommandResult> {
  return runCommand({
    argv: ['git', ...argv],
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    commandAllowlist: options.commandAllowlist,
    signal: options.signal,
    env: ISOLATED_GIT_ENV
  })
}

export interface ActualRepositoryRevision {
  baseCommit: string | null
  treeHash: string | null
  workingTreePatchHash: string | null
}

export async function readRepositoryRevision(
  repoPath: string,
  options: GitRunOptions
): Promise<ActualRepositoryRevision> {
  const baseCommit = await runGitCommand(['rev-parse', 'HEAD'], options)
  const treeHash = await runGitCommand(['rev-parse', 'HEAD^{tree}'], options)
  const diff = await runGitCommand(['diff', 'HEAD'], options)
  const untracked = await runGitCommand(['ls-files', '--others', '--exclude-standard'], options)

  const baseCommitValue = baseCommit.exitCode === 0 ? baseCommit.stdout.trim() || null : null
  const treeHashValue = treeHash.exitCode === 0 ? treeHash.stdout.trim() || null : null
  const workingPatchContent = `${diff.stdout}${untracked.stdout}`
  const workingTreePatchHash = workingPatchContent.length > 0 ? sha256Hex(workingPatchContent) : null

  return {
    baseCommit: baseCommitValue,
    treeHash: treeHashValue,
    workingTreePatchHash
  }
}

export async function verifyRepositoryRevision(
  repoPath: string,
  expected: RepositoryRevisionContract,
  options: GitRunOptions,
  executionRequestId?: string
): Promise<ActualRepositoryRevision> {
  const actual = await readRepositoryRevision(repoPath, options)
  const id = executionRequestId ?? 'unknown'

  if (actual.baseCommit !== expected.baseCommit) {
    throw new RevisionMismatchError(id, 'baseCommit', expected.baseCommit, actual.baseCommit)
  }
  if (actual.treeHash !== expected.treeHash) {
    throw new RevisionMismatchError(id, 'treeHash', expected.treeHash, actual.treeHash)
  }
  if (actual.workingTreePatchHash !== expected.workingTreePatchHash) {
    throw new RevisionMismatchError(
      id,
      'workingTreePatchHash',
      expected.workingTreePatchHash,
      actual.workingTreePatchHash
    )
  }
  return actual
}
