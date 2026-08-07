import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RepositoryUnavailableError } from './command-errors'
import { GitRevisionReader } from './git-revision-reader'
import { cleanupTempDirs, createTempGitRepo, git, trackTempDir } from './testing/git-fixture'

describe('GitRevisionReader', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('resolves the revision of a committed repository', async () => {
    const repoDir = await createTempGitRepo()
    const reader = new GitRevisionReader({
      sourceRepositoryPath: repoDir,
      runtimeDirectory: trackTempDir(await mkdtemp(join(tmpdir(), 'ca-main-runtime-')))
    })

    const revision = await reader.current()
    expect(revision.baseCommit).toMatch(/^[a-f0-9]{40}$/)
    expect(revision.treeHash).toMatch(/^[a-f0-9]{40}$/)
    expect(revision.workingTreePatchHash).toBeNull()
  })

  it('rejects a repository without a HEAD as repository_has_no_head', async () => {
    const repoDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-main-empty-')))
    await git(repoDir, ['init', '-b', 'main'])
    const reader = new GitRevisionReader({
      sourceRepositoryPath: repoDir,
      runtimeDirectory: trackTempDir(await mkdtemp(join(tmpdir(), 'ca-main-runtime-')))
    })

    await expect(reader.current()).rejects.toThrow(RepositoryUnavailableError)
  })
})
