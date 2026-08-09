import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MigrationFolderNotFoundError, resolveMigrationFolder } from './migration-path'

async function makeTree(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'ca-migration-path-'))
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true })
    }
  }
}

describe('resolveMigrationFolder', () => {
  it('source mode resolves the workspace persistence drizzle directory when present', async () => {
    const { root, cleanup } = await makeTree()
    const workspaceDrizzle = join(root, 'packages', 'persistence', 'drizzle')
    await mkdir(workspaceDrizzle, { recursive: true })
    const appPath = join(root, 'apps', 'desktop')
    try {
      expect(
        resolveMigrationFolder({ mode: 'source', appPath, resourcesPath: join(root, 'Resources') })
      ).toBe(workspaceDrizzle)
    } finally {
      await cleanup()
    }
  })

  it('source mode falls back to the app-local drizzle directory', async () => {
    const { root, cleanup } = await makeTree()
    const appPath = join(root, 'apps', 'desktop')
    await mkdir(join(appPath, 'drizzle'), { recursive: true })
    try {
      expect(
        resolveMigrationFolder({ mode: 'source', appPath, resourcesPath: join(root, 'Resources') })
      ).toBe(join(appPath, 'drizzle'))
    } finally {
      await cleanup()
    }
  })

  it('packaged mode resolves process.resourcesPath/drizzle', async () => {
    const { root, cleanup } = await makeTree()
    const resourcesDrizzle = join(root, 'Resources', 'drizzle')
    await mkdir(resourcesDrizzle, { recursive: true })
    try {
      expect(
        resolveMigrationFolder({
          mode: 'packaged',
          appPath: join(root, 'app.asar'),
          resourcesPath: join(root, 'Resources')
        })
      ).toBe(resourcesDrizzle)
    } finally {
      await cleanup()
    }
  })

  it('packaged mode fails fast with a stable diagnostic listing the expected path', async () => {
    const { root, cleanup } = await makeTree()
    try {
      const resourcesPath = join(root, 'Resources')
      await mkdir(resourcesPath, { recursive: true })
      expect(() =>
        resolveMigrationFolder({
          mode: 'packaged',
          appPath: join(root, 'app.asar'),
          resourcesPath
        })
      ).toThrow(MigrationFolderNotFoundError)
      try {
        resolveMigrationFolder({
          mode: 'packaged',
          appPath: join(root, 'app.asar'),
          resourcesPath
        })
        throw new Error('unreachable')
      } catch (error) {
        expect(error).toBeInstanceOf(MigrationFolderNotFoundError)
        expect((error as MigrationFolderNotFoundError).expectedPaths).toEqual([
          join(resourcesPath, 'drizzle')
        ])
        expect((error as Error).message).toContain(join(resourcesPath, 'drizzle'))
      }
    } finally {
      await cleanup()
    }
  })

  it('source mode fails fast when no candidate exists', async () => {
    const { root, cleanup } = await makeTree()
    try {
      expect(() =>
        resolveMigrationFolder({
          mode: 'source',
          appPath: join(root, 'apps', 'desktop'),
          resourcesPath: join(root, 'Resources')
        })
      ).toThrow(MigrationFolderNotFoundError)
    } finally {
      await cleanup()
    }
  })
})
