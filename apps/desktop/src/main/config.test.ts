import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRepository } from './config'
import { cleanupTempDirs, createTempGitRepo, git, trackTempDir } from './testing/git-fixture'

describe('validateRepository', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('accepts a valid non-bare worktree', async () => {
    const repo = await createTempGitRepo()
    const result = await validateRepository(repo)
    expect(result.ok).toBe(true)
  })

  it('rejects a bare repository even though rev-parse exits 0 (prints false)', async () => {
    const bare = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-bare-')))
    await git(bare, ['init', '--bare'])
    const result = await validateRepository(bare)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasonCode).toBe('NOT_GIT_WORKTREE')
    }
  })

  it('rejects a plain file path as PATH_UNREADABLE', async () => {
    const dir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-file-')))
    const file = join(dir, 'x.txt')
    await writeFile(file, 'x', 'utf8')
    const result = await validateRepository(file)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasonCode).toBe('PATH_UNREADABLE')
    }
  })

  it('rejects a missing path as PATH_UNREADABLE', async () => {
    const result = await validateRepository(join(tmpdir(), 'ca-missing-repo-xyz'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasonCode).toBe('PATH_UNREADABLE')
    }
  })
})
