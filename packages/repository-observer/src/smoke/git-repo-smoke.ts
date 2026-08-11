import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGitCommand } from '@canvas-agent/worker-runtime'
import { RepositoryObserver } from '../index'

// Credential-free real-Git smoke: proves authoritative repository transitions
// (AVAILABLE v1 -> UNAVAILABLE(dirty unsupported) -> ABSENT on deletion) with a
// real temporary Git repository. No model/API credentials involved.

const GIT_OPTIONS = {
  timeoutMs: 30_000,
  maxOutputBytes: 2 * 1024 * 1024,
  commandAllowlist: ['git'] as readonly string[],
  signal: undefined as AbortSignal | undefined
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitCommand(args, { ...GIT_OPTIONS, cwd })
  return result.stdout.trim()
}

async function run(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-repo-observer-smoke-'))
  try {
    await git(directory, ['init', '-q', '-b', 'main'])
    await git(directory, ['config', 'user.email', 'observer@canvas.local'])
    await git(directory, ['config', 'user.name', 'Repository Observer'])
    await writeFile(join(directory, 'a.ts'), 'v1', 'utf8')
    await git(directory, ['add', '-A'])
    await git(directory, ['commit', '-q', '-m', 'v1'])

    const revision1 = {
      baseCommit: await git(directory, ['rev-parse', 'HEAD']),
      treeHash: await git(directory, ['rev-parse', 'HEAD^{tree}']),
      workingTreePatchHash: null as string | null
    }
    const observer = new RepositoryObserver()

    // AVAILABLE v1.
    const available = await observer.observe({
      repositoryPath: directory,
      expectedRevision: revision1,
      paths: ['a.ts'],
      observedAt: new Date().toISOString()
    })
    console.log(`[smoke] AVAILABLE a.ts status=${available[0]?.observation.status}`)

    // Dirty revision fails closed.
    const dirty = { ...revision1, workingTreePatchHash: 'some-patch-hash' }
    const dirtyResult = await observer.observe({
      repositoryPath: directory,
      expectedRevision: dirty,
      paths: ['a.ts'],
      observedAt: new Date().toISOString()
    })
    console.log(`[smoke] dirty status=${dirtyResult[0]?.observation.status} reason=${dirtyResult[0]?.observation.status === 'UNAVAILABLE' ? dirtyResult[0].observation.reasonCode : '-'}`)

    // Deletion -> ABSENT at a new clean revision.
    const { rm: unlink } = await import('node:fs/promises')
    await unlink(join(directory, 'a.ts'))
    await git(directory, ['add', '-A'])
    await git(directory, ['commit', '-q', '-m', 'delete a.ts'])
    const revision2 = {
      baseCommit: await git(directory, ['rev-parse', 'HEAD']),
      treeHash: await git(directory, ['rev-parse', 'HEAD^{tree}']),
      workingTreePatchHash: null as string | null
    }
    const absent = await observer.observe({
      repositoryPath: directory,
      expectedRevision: revision2,
      paths: ['a.ts'],
      observedAt: new Date().toISOString()
    })
    console.log(`[smoke] deleted status=${absent[0]?.observation.status}`)

    const ok =
      available[0]?.observation.status === 'AVAILABLE' &&
      dirtyResult[0]?.observation.status === 'UNAVAILABLE' &&
      absent[0]?.observation.status === 'ABSENT'
    console.log(ok ? 'SMOKE_STATUS=EXECUTED' : 'SMOKE_STATUS=FAILED')
    if (!ok) process.exitCode = 1
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

run().catch((error: unknown) => {
  console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  console.error('SMOKE_STATUS=FAILED')
  process.exit(1)
})
