import { access, constants, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { ISOLATED_GIT_ENV, runCommand } from '@canvas-agent/worker-runtime'

export interface AppConfig {
  sourceRepositoryPath: string
  runtimeDirectory: string
}

export interface ConfigResult {
  config: AppConfig | null
  error: string | null
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

export async function validateRepository(sourceRepositoryPath: string): Promise<string | null> {
  let canonical: string
  try {
    canonical = await realpath(sourceRepositoryPath)
  } catch {
    return `repository path is not readable: ${sourceRepositoryPath}`
  }

  if (!(await runGit(canonical, ['rev-parse', '--is-inside-work-tree']))) {
    return `not a git working tree: ${sourceRepositoryPath}`
  }
  if (!(await runGit(canonical, ['rev-parse', 'HEAD']))) {
    return `repository has no HEAD: ${sourceRepositoryPath}`
  }

  return null
}

export function defaultRuntimeDirectory(userData: string): string {
  return join(userData, 'runtime')
}

export async function resolveAppConfig(userData: string): Promise<ConfigResult> {
  const sourceRepositoryPath = process.env['CANVAS_AGENT_REPO']
  if (!sourceRepositoryPath) {
    return { config: null, error: null }
  }

  const validationError = await validateRepository(sourceRepositoryPath)
  if (validationError !== null) {
    return { config: null, error: validationError }
  }

  const canonical = await realpath(sourceRepositoryPath)
  const runtimeDirectory = defaultRuntimeDirectory(userData)
  await mkdir(runtimeDirectory, { recursive: true })
  try {
    await access(runtimeDirectory, constants.W_OK)
  } catch {
    return { config: null, error: `runtime directory is not writable: ${runtimeDirectory}` }
  }

  return { config: { sourceRepositoryPath: canonical, runtimeDirectory }, error: null }
}
