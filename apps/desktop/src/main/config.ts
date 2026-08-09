import { realpath } from 'node:fs/promises'
import { ISOLATED_GIT_ENV, runCommand } from '@canvas-agent/worker-runtime'

export interface AppConfig {
  sourceRepositoryPath: string
  runtimeDirectory: string
}

export type ValidateRepositoryResult =
  | { ok: true; canonicalPath: string }
  | {
      ok: false
      reasonCode: 'PATH_UNREADABLE' | 'NOT_GIT_WORKTREE' | 'MISSING_HEAD'
      message: string
    }

const GIT_TIMEOUT_MS = 30_000

async function runGit(repoPath: string, args: readonly string[]): Promise<boolean> {
  const result = await runCommand({
    argv: ['git', ...args],
    cwd: repoPath,
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: 64 * 1024,
    commandAllowlist: ['git'],
    signal: undefined,
    env: ISOLATED_GIT_ENV
  })
  return result.exitCode === 0
}

export async function validateRepository(
  sourceRepositoryPath: string
): Promise<ValidateRepositoryResult> {
  let canonical: string
  try {
    canonical = await realpath(sourceRepositoryPath)
  } catch {
    return {
      ok: false,
      reasonCode: 'PATH_UNREADABLE',
      message: `repository path is not readable: ${sourceRepositoryPath}`
    }
  }

  if (!(await runGit(canonical, ['rev-parse', '--is-inside-work-tree']))) {
    return {
      ok: false,
      reasonCode: 'NOT_GIT_WORKTREE',
      message: `not a git working tree: ${sourceRepositoryPath}`
    }
  }
  if (!(await runGit(canonical, ['rev-parse', 'HEAD']))) {
    return {
      ok: false,
      reasonCode: 'MISSING_HEAD',
      message: `repository has no HEAD: ${sourceRepositoryPath}`
    }
  }

  return { ok: true, canonicalPath: canonical }
}
