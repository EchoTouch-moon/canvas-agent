import { access, constants, realpath, stat } from 'node:fs/promises'
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

async function runGitOutput(repoPath: string, args: readonly string[]): Promise<string | null> {
  try {
    const result = await runCommand({
      argv: ['git', ...args],
      cwd: repoPath,
      timeoutMs: GIT_TIMEOUT_MS,
      maxOutputBytes: 64 * 1024,
      commandAllowlist: ['git'],
      signal: undefined,
      env: ISOLATED_GIT_ENV
    })
    if (result.exitCode !== 0) {
      return null
    }
    return result.stdout.trim()
  } catch {
    // spawn/cwd errors (e.g. EACCES entering the directory) are a validation
    // failure, not a thrown internal error.
    return null
  }
}

export async function validateRepository(
  sourceRepositoryPath: string
): Promise<ValidateRepositoryResult> {
  let canonical: string
  try {
    canonical = await realpath(sourceRepositoryPath)
    const info = await stat(canonical)
    if (!info.isDirectory()) {
      return {
        ok: false,
        reasonCode: 'PATH_UNREADABLE',
        message: `repository path is not a directory: ${sourceRepositoryPath}`
      }
    }
    // `realpath`/`stat` do not prove the directory is readable and searchable;
    // probe read + execute permission so a chmod-000 repository is rejected as
    // PATH_UNREADABLE instead of letting `git` spawn fail with EACCES.
    await access(canonical, constants.R_OK | constants.X_OK)
  } catch {
    return {
      ok: false,
      reasonCode: 'PATH_UNREADABLE',
      message: `repository path is not readable: ${sourceRepositoryPath}`
    }
  }

  // `git rev-parse --is-inside-work-tree` exits 0 even for a bare repository
  // while printing `false`; accept only an exact `true` output.
  const insideWorkTree = await runGitOutput(canonical, ['rev-parse', '--is-inside-work-tree'])
  if (insideWorkTree !== 'true') {
    return {
      ok: false,
      reasonCode: 'NOT_GIT_WORKTREE',
      message: `not a git working tree: ${sourceRepositoryPath}`
    }
  }
  if ((await runGitOutput(canonical, ['rev-parse', 'HEAD'])) === null) {
    return {
      ok: false,
      reasonCode: 'MISSING_HEAD',
      message: `repository has no HEAD: ${sourceRepositoryPath}`
    }
  }

  return { ok: true, canonicalPath: canonical }
}
