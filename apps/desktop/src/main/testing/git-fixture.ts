import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ISOLATED_GIT_ENV, runCommand } from '@canvas-agent/worker-runtime'

const tempDirs: string[] = []

export function trackTempDir(dir: string): string {
  tempDirs.push(dir)
  return dir
}

export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined))
  )
}

export async function git(repoPath: string, args: readonly string[]): Promise<void> {
  await gitOutput(repoPath, args)
}

export async function gitOutput(repoPath: string, args: readonly string[]): Promise<string> {
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
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

export async function createTempGitRepo(): Promise<string> {
  const dir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-main-')))
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'Canvas Agent Test'])
  await git(dir, ['config', 'user.email', 'test@canvas-agent.local'])
  await writeFile(join(dir, 'README.md'), '# main process test\n')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', 'initial commit'])
  return dir
}
