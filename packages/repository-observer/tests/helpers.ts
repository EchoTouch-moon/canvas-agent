import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGitCommand, type GitRunOptions } from '@canvas-agent/worker-runtime'
import type { RepositoryRevisionContract } from '@canvas-agent/contracts'

// Credential-free temporary Git repository helper for Repository Observer
// tests. Commits with a fixed identity; no model/API credentials involved.

export interface TempRepo {
  readonly directory: string
  readonly cleanup: () => Promise<void>
  readonly git: (args: readonly string[]) => Promise<{ exitCode: number | null; stdout: string }>
  readonly readRevision: () => Promise<RepositoryRevisionContract>
}

function gitOptions(cwd: string): GitRunOptions {
  return {
    cwd,
    timeoutMs: 30_000,
    maxOutputBytes: 2 * 1024 * 1024,
    commandAllowlist: ['git'],
    signal: undefined
  }
}

export async function createTempRepo(files: Record<string, string>): Promise<TempRepo> {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-repo-observer-'))
  const git = async (args: readonly string[]): Promise<{ exitCode: number | null; stdout: string }> => {
    const result = await runGitCommand(args, gitOptions(directory))
    return { exitCode: result.exitCode, stdout: result.stdout }
  }
  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 'observer@canvas.local'])
  await git(['config', 'user.name', 'Repository Observer'])
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(directory, path), content, 'utf8')
  }
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'fixture'])
  const readRevision = async (): Promise<RepositoryRevisionContract> => {
    const baseCommit = (await git(['rev-parse', 'HEAD'])).stdout.trim()
    const treeHash = (await git(['rev-parse', 'HEAD^{tree}'])).stdout.trim()
    return { baseCommit, treeHash, workingTreePatchHash: null }
  }
  return {
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
    git,
    readRevision
  }
}
