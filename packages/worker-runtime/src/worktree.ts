import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runGitCommand, type GitRunOptions } from './revision'

export interface CreateWorktreeOptions extends GitRunOptions {
  sourceRepoPath: string
  runtimeDirectory: string
  executionRequestId: string
  baseCommit: string
}

export interface WorktreeHandle {
  worktreePath: string
}

export async function createIsolatedWorktree(options: CreateWorktreeOptions): Promise<WorktreeHandle> {
  const worktreePath = join(options.runtimeDirectory, 'worktrees', options.executionRequestId)
  await mkdir(join(options.runtimeDirectory, 'worktrees'), { recursive: true })
  const result = await runGitCommand(
    ['worktree', 'add', '--detach', worktreePath, options.baseCommit],
    options
  )
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create isolated worktree: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  return { worktreePath }
}

export interface RemoveWorktreeOptions extends GitRunOptions {
  sourceRepoPath: string
  worktreePath: string
}

export async function removeWorktree(options: RemoveWorktreeOptions): Promise<boolean> {
  const result = await runGitCommand(['worktree', 'remove', '--force', options.worktreePath], options)
  return result.exitCode === 0
}

export async function exportWorktreePatch(options: { worktreePath: string } & GitRunOptions): Promise<string> {
  // The worker stages the worktree once and validates the staged diff before
  // calling this; a failed diff must not be silently turned into an empty patch.
  const diff = await runGitCommand(['diff', '--cached', 'HEAD'], options)
  if (diff.exitCode !== 0) {
    throw new Error(`Failed to export the staged patch: ${diff.stderr.trim() || diff.stdout.trim()}`)
  }
  return diff.stdout
}
