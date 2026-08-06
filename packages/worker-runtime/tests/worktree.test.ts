import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createIsolatedWorktree, removeWorktree } from '../src'
import { TEST_ALLOWLIST, cleanupTempDirs, createTempGitRepo } from './helpers'

describe('isolated worktree management', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('creates a detached worktree under the runtime directory and removes it', async () => {
    const repo = await createTempGitRepo()
    const runtime = await mkdtemp(join(tmpdir(), 'ca-runtime-'))

    const handle = await createIsolatedWorktree({
      cwd: repo.dir,
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
      commandAllowlist: TEST_ALLOWLIST,
      signal: undefined,
      sourceRepoPath: repo.dir,
      runtimeDirectory: runtime,
      executionRequestId: 'req_wt',
      baseCommit: repo.baseCommit
    })

    expect(handle.worktreePath).toContain('req_wt')
    expect(existsSync(handle.worktreePath)).toBe(true)
    expect(existsSync(join(handle.worktreePath, 'README.md'))).toBe(true)

    const removed = await removeWorktree({
      cwd: repo.dir,
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
      commandAllowlist: TEST_ALLOWLIST,
      signal: undefined,
      sourceRepoPath: repo.dir,
      worktreePath: handle.worktreePath
    })
    expect(removed).toBe(true)
    expect(existsSync(handle.worktreePath)).toBe(false)
  })
})
