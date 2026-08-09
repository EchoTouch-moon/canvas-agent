import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, realpath, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Persistence } from '@canvas-agent/persistence'
import type { WorkspaceRuntimeStatus } from '@canvas-agent/contracts'
import { WorkspaceRuntimeManager } from './workspace-runtime-manager'
import { workspaceIdentity, workspaceStorageRoots } from './workspace-storage'
import { InProcessWorkerHost } from './testing/in-process-worker-host'
import type { WorkerHost } from './worker-host'
import { cleanupTempDirs, createTempGitRepo, git, trackTempDir } from './testing/git-fixture'
import type { RepositoryPicker } from './repository-picker'

class RecordingWorkerHost implements WorkerHost {
  disposed = 0
  cancelled = 0
  private readonly inner: InProcessWorkerHost
  constructor(repo: string, runtimeDir: string) {
    this.inner = new InProcessWorkerHost({
      sourceRepositoryPath: repo,
      runtimeDirectory: runtimeDir
    })
  }
  dispatch(
    request: import('@canvas-agent/contracts').ExecutionRequestContract
  ): Promise<import('@canvas-agent/contracts').DispatchResult> {
    return this.inner.dispatch(request)
  }
  cancel(executionRequestId: string): Promise<boolean> {
    this.cancelled += 1
    return this.inner.cancel(executionRequestId)
  }
  async dispose(): Promise<void> {
    this.disposed += 1
    await this.inner.dispose()
  }
}

interface ManagerFixture {
  manager: WorkspaceRuntimeManager
  userData: string
  workerRef: { current: WorkerHost | null }
}

async function makeManager(options: {
  repo?: string
  picker?: RepositoryPicker
  userData?: string
  bootstrapPath?: string | null
  migrationsFolder?: string
  workerHost?: (repo: string, runtimeDir: string) => WorkerHost
}): Promise<ManagerFixture> {
  const userData = options.userData ?? trackTempDir(await mkdtemp(join(tmpdir(), 'ca-mgr-')))
  const workerRef: { current: WorkerHost | null } = { current: null }
  const manager = new WorkspaceRuntimeManager({
    userData,
    picker:
      options.picker ??
      ({
        pick: async () =>
          options.repo === undefined
            ? { cancelled: true, path: null }
            : { cancelled: false, path: options.repo }
      } as RepositoryPicker),
    bootstrapPath: options.bootstrapPath ?? null,
    migrationsFolder: options.migrationsFolder,
    workerHostFactory: (appConfig) => {
      const worker =
        options.workerHost === undefined
          ? new RecordingWorkerHost(appConfig.sourceRepositoryPath, appConfig.runtimeDirectory)
          : options.workerHost(appConfig.sourceRepositoryPath, appConfig.runtimeDirectory)
      workerRef.current = worker
      return worker
    }
  })
  return { manager, userData, workerRef }
}

function reason(status: WorkspaceRuntimeStatus): string | null {
  return status.lastError?.reasonCode ?? null
}

describe('WorkspaceRuntimeManager', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('starts CLOSED with no active workspace and no error', async () => {
    const { manager } = await makeManager({})
    expect(manager.status()).toEqual({ state: 'CLOSED', activeWorkspace: null, lastError: null })
    expect(manager.getReadyRuntime()).toBeNull()
  })

  it('startup opens the bootstrap repository when CANVAS_AGENT_REPO is set', async () => {
    const repo = await createTempGitRepo()
    const { manager, workerRef } = await makeManager({ repo, bootstrapPath: repo })
    const status = await manager.startup()
    expect(status.state).toBe('READY')
    expect(status.activeWorkspace?.repositoryName).toBe(repo.split(/[\\/]/).pop())
    expect(status.lastError).toBeNull()
    expect(manager.getReadyRuntime()).not.toBeNull()
    await manager.close()
    const worker = workerRef.current as RecordingWorkerHost
    expect(worker.disposed).toBe(1)
  })

  it('startup stays CLOSED when there is no bootstrap and no last-workspace history', async () => {
    const { manager } = await makeManager({})
    const status = await manager.startup()
    expect(status.state).toBe('CLOSED')
    expect(status.activeWorkspace).toBeNull()
    expect(status.lastError).toBeNull()
  })

  it('startup auto-reopens the last valid repository', async () => {
    const repo = await createTempGitRepo()
    const canonical = await realpath(repo)
    const { manager, userData } = await makeManager({ repo })
    await manager.openPath(repo)
    await manager.close()

    const restarted = await makeManager({ repo, userData, bootstrapPath: null })
    const status = await restarted.manager.startup()
    expect(status.state).toBe('READY')
    expect(status.activeWorkspace?.displayPath).toBe(canonical)
    await restarted.manager.close()
  })

  it('startup degrades to a recoverable ERROR when the last repository is removed', async () => {
    const userData = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-mgr-')))
    const gone = join(userData, 'gone-repo')
    await writeFile(
      join(userData, 'settings-v1.json'),
      JSON.stringify({ schemaVersion: 1, lastRepositoryPath: gone }),
      'utf8'
    )
    const { manager } = await makeManager({ repo: gone, userData, bootstrapPath: null })
    const status = await manager.startup()
    expect(status.state).toBe('ERROR')
    expect(status.activeWorkspace).toBeNull()
    expect(reason(status)).toBe('PATH_UNREADABLE')
    expect(status.lastError?.recoverable).toBe(true)
  })

  it('startup reports SETTINGS_INVALID for a corrupt settings file and does not open anything', async () => {
    const userData = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-mgr-')))
    await writeFile(join(userData, 'settings-v1.json'), '{ not json', 'utf8')
    const { manager } = await makeManager({ userData, bootstrapPath: null })
    const status = await manager.startup()
    expect(status.state).toBe('ERROR')
    expect(reason(status)).toBe('SETTINGS_INVALID')
    expect(status.activeWorkspace).toBeNull()
    const preserved = await readFile(join(userData, 'settings-v1.json'), 'utf8')
    expect(preserved).toBe('{ not json')
  })

  it('rejects unreadable, non-Git and missing-HEAD paths before creating a database', async () => {
    const userData = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-mgr-')))
    const { manager } = await makeManager({ userData })

    const unreadable = await manager.openPath(join(userData, 'does-not-exist'))
    expect(unreadable.state).toBe('ERROR')
    expect(reason(unreadable)).toBe('PATH_UNREADABLE')

    const plainDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-plain-')))
    const nonGit = await manager.openPath(plainDir)
    expect(nonGit.state).toBe('ERROR')
    expect(reason(nonGit)).toBe('NOT_GIT_WORKTREE')

    const noHead = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-nohead-')))
    await git(noHead, ['init', '-b', 'main'])
    const missingHead = await manager.openPath(noHead)
    expect(missingHead.state).toBe('ERROR')
    expect(reason(missingHead)).toBe('MISSING_HEAD')

    expect(existsSync(join(userData, 'workspaces'))).toBe(false)
    expect(manager.getReadyRuntime()).toBeNull()
  })

  it('two repositories produce distinct identities and storage roots', async () => {
    const repoA = await createTempGitRepo()
    const repoB = await createTempGitRepo()
    const canonicalA = await realpath(repoA)
    const canonicalB = await realpath(repoB)
    const { manager, userData } = await makeManager({})
    const a = await manager.openPath(repoA)
    const idA = a.activeWorkspace?.identity
    await manager.close()
    const b = await manager.openPath(repoB)
    const idB = b.activeWorkspace?.identity
    expect(idA).toBe(workspaceIdentity(canonicalA))
    expect(idB).toBe(workspaceIdentity(canonicalB))
    expect(idA).not.toBe(idB)
    const rootsA = workspaceStorageRoots(userData, idA as string)
    const rootsB = workspaceStorageRoots(userData, idB as string)
    expect(rootsA.databasePath).not.toBe(rootsB.databasePath)
    expect(existsSync(rootsA.databasePath)).toBe(true)
    expect(existsSync(rootsB.databasePath)).toBe(true)
    await manager.close()
  })

  it('a failed switch preserves the original READY runtime with a typed lastError', async () => {
    const repo = await createTempGitRepo()
    const canonical = await realpath(repo)
    const { manager } = await makeManager({ repo })
    const opened = await manager.openPath(repo)
    expect(opened.state).toBe('READY')

    const failed = await manager.openPath(join(repo, 'missing-child'))
    expect(failed.state).toBe('READY')
    expect(failed.activeWorkspace?.displayPath).toBe(canonical)
    expect(reason(failed)).toBe('PATH_UNREADABLE')

    const runtime = manager.getReadyRuntime()
    expect(runtime?.repositoryPath).toBe(canonical)
    await manager.close()
  })

  it('a DATABASE_OPEN_FAILED candidate is cleaned up without leaking a connection', async () => {
    const repo = await createTempGitRepo()
    const canonical = await realpath(repo)
    const userData = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-mgr-')))
    const emptyMigrations = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-empty-mig-')))
    const { manager } = await makeManager({ repo, userData, migrationsFolder: emptyMigrations })

    const status = await manager.openPath(repo)
    expect(status.state).toBe('ERROR')
    expect(reason(status)).toBe('DATABASE_OPEN_FAILED')

    const roots = workspaceStorageRoots(userData, workspaceIdentity(canonical))
    const reopened: Persistence = openDatabase({ path: roots.databasePath })
    reopened.db.close()
  })

  it('close blocks on an active run with ACTIVE_RUN_BLOCKS_SWITCH and never cancels it', async () => {
    const repo = await createTempGitRepo()
    const { manager, workerRef } = await makeManager({ repo })
    await manager.openPath(repo)
    const worker = workerRef.current as RecordingWorkerHost
    expect(worker).not.toBeNull()

    const blocked = await manager.withActiveRun(async () => manager.close())
    expect(blocked.state).toBe('READY')
    expect(reason(blocked)).toBe('ACTIVE_RUN_BLOCKS_SWITCH')
    expect(worker.cancelled).toBe(0)
    expect(worker.disposed).toBe(0)

    const closed = await manager.close()
    expect(closed.state).toBe('CLOSED')
    expect(worker.disposed).toBe(1)
  })

  it('switch is blocked during an active run and preserves the current runtime', async () => {
    const repoA = await createTempGitRepo()
    const repoB = await createTempGitRepo()
    const canonicalA = await realpath(repoA)
    const { manager, workerRef } = await makeManager({ repo: repoA })
    await manager.openPath(repoA)
    const worker = workerRef.current as RecordingWorkerHost

    const blocked = await manager.withActiveRun(async () => manager.openPath(repoB))
    expect(blocked.state).toBe('READY')
    expect(reason(blocked)).toBe('ACTIVE_RUN_BLOCKS_SWITCH')
    expect(manager.getReadyRuntime()?.repositoryPath).toBe(canonicalA)
    expect(worker.cancelled).toBe(0)
    await manager.close()
  })

  it('concurrent lifecycle operations return OPERATION_IN_PROGRESS without interleaving', async () => {
    const repoA = await createTempGitRepo()
    const repoB = await createTempGitRepo()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const picker: RepositoryPicker = {
      pick: async () => {
        await gate
        return { cancelled: false, path: repoB }
      }
    }
    const { manager } = await makeManager({ picker })

    const choosing = manager.chooseRepository(undefined)
    const concurrent = await manager.openPath(repoA)
    expect(concurrent.lastError?.reasonCode).toBe('OPERATION_IN_PROGRESS')

    release()
    const chosen = await choosing
    expect(chosen.cancelled).toBe(false)
    expect(chosen.status.state).toBe('READY')
    await manager.close()
  })

  it('picker cancellation returns the prior status with no new lastError', async () => {
    const repo = await createTempGitRepo()
    let mode: 'repo' | 'cancel' = 'repo'
    const picker: RepositoryPicker = {
      pick: async () =>
        mode === 'repo' ? { cancelled: false, path: repo } : { cancelled: true, path: null }
    }
    const { manager } = await makeManager({ picker })
    const chosen = await manager.chooseRepository(undefined)
    expect(chosen.status.state).toBe('READY')

    const before = manager.status()
    mode = 'cancel'
    const cancelled = await manager.chooseRepository(undefined)
    expect(cancelled.cancelled).toBe(true)
    expect(cancelled.status).toEqual(before)
    await manager.close()
  })

  it('reports a failing worker dispose on close as WORKER_DISPOSE_FAILED but still reaches CLOSED', async () => {
    const repo = await createTempGitRepo()
    const { manager } = await makeManager({
      repo,
      workerHost: () => ({
        dispatch: async () => {
          throw new Error('unused')
        },
        cancel: async () => false,
        dispose: async () => {
          throw new Error('worker stuck')
        }
      })
    })
    await manager.openPath(repo)
    const closed = await manager.close()
    expect(closed.state).toBe('CLOSED')
    expect(reason(closed)).toBe('WORKER_DISPOSE_FAILED')
  })

  it('closes cleanly and the same repository can be reopened afterwards', async () => {
    const repo = await createTempGitRepo()
    const { manager, userData, workerRef } = await makeManager({ repo })
    await manager.openPath(repo)
    const closed = await manager.close()
    expect(closed.state).toBe('CLOSED')
    const worker = workerRef.current as RecordingWorkerHost
    expect(worker.disposed).toBe(1)
    expect(manager.getReadyRuntime()).toBeNull()

    const again = await makeManager({ repo, userData })
    const status = await again.manager.openPath(repo)
    expect(status.state).toBe('READY')
    await again.manager.close()
  })
})
