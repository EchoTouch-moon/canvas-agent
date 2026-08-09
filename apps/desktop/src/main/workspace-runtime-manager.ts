import { access, constants, mkdir } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'
import type {
  WorkspaceErrorReason,
  WorkspaceOperationError,
  WorkspaceRuntimeStatus,
  WorkspaceSummary
} from '@canvas-agent/contracts'
import { closeDatabase, type Persistence } from '@canvas-agent/persistence'
import { validateRepository, type AppConfig } from './config'
import { openWorkspaceDatabase } from './database'
import { WorkspaceService } from './workspace-service'
import { GitRevisionReader } from './git-revision-reader'
import { ExecutionCoordinator } from './execution-coordinator'
import { UtilityProcessWorkerHost } from './utility-process-worker-host'
import type { WorkerHost } from './worker-host'
import { WorkspaceUnavailableError } from './command-errors'
import { WorkspaceSettingsStore } from './workspace-settings'
import { repositoryName, workspaceIdentity, workspaceStorageRoots } from './workspace-storage'
import type { RepositoryPicker } from './repository-picker'

export interface ActiveWorkspaceRuntime {
  readonly identity: string
  readonly repositoryPath: string
  readonly persistence: Persistence
  readonly workspace: WorkspaceService
  readonly workerHost: WorkerHost
  readonly coordinator: ExecutionCoordinator
  readonly appConfig: AppConfig
}

export interface WorkspaceRuntimeManagerOptions {
  userData: string
  picker: RepositoryPicker
  migrationsFolder?: string
  bootstrapPath: string | null
  workerHostFactory?: (appConfig: AppConfig) => WorkerHost
}

type RuntimeState =
  | { kind: 'CLOSED' }
  | { kind: 'OPENING'; held: ActiveWorkspaceRuntime | null }
  | { kind: 'READY'; runtime: ActiveWorkspaceRuntime }
  | { kind: 'CLOSING'; runtime: ActiveWorkspaceRuntime }
  | { kind: 'ERROR' }

function toError(
  reasonCode: WorkspaceErrorReason,
  message: string,
  recoverable: boolean
): WorkspaceOperationError {
  return { reasonCode, message: message.length > 0 ? message : reasonCode, recoverable }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export class WorkspaceRuntimeManager {
  private state: RuntimeState = { kind: 'CLOSED' }
  private lastError: WorkspaceOperationError | null = null
  private transitioning = false
  private activeRuns = 0
  private leaseCount = 0
  private idleWaiter: (() => void) | null = null
  private readonly settings: WorkspaceSettingsStore

  constructor(private readonly options: WorkspaceRuntimeManagerOptions) {
    this.settings = new WorkspaceSettingsStore(options.userData)
  }

  status(): WorkspaceRuntimeStatus {
    return {
      state: this.publicState(),
      activeWorkspace: this.activeSummary(),
      lastError: this.lastError
    }
  }

  getReadyRuntime(): ActiveWorkspaceRuntime | null {
    return this.state.kind === 'READY' ? this.state.runtime : null
  }

  async withActiveRun<T>(run: (runtime: ActiveWorkspaceRuntime) => Promise<T>): Promise<T> {
    const runtime = this.acquireLease()
    this.activeRuns += 1
    try {
      return await run(runtime)
    } finally {
      this.activeRuns -= 1
      this.releaseLease()
    }
  }

  async withReadyRuntime<T>(run: (runtime: ActiveWorkspaceRuntime) => Promise<T>): Promise<T> {
    const runtime = this.acquireLease()
    try {
      return await run(runtime)
    } finally {
      this.releaseLease()
    }
  }

  private acquireLease(): ActiveWorkspaceRuntime {
    const runtime = this.getReadyRuntime()
    if (!runtime) {
      throw new WorkspaceUnavailableError('Workspace is not READY')
    }
    this.leaseCount += 1
    return runtime
  }

  private releaseLease(): void {
    this.leaseCount -= 1
    if (this.leaseCount === 0 && this.idleWaiter !== null) {
      const waiter = this.idleWaiter
      this.idleWaiter = null
      waiter()
    }
  }

  private async waitForIdle(): Promise<void> {
    if (this.leaseCount === 0) {
      return
    }
    await new Promise<void>((resolve) => {
      this.idleWaiter = resolve
    })
  }

  async startup(): Promise<WorkspaceRuntimeStatus> {
    if (this.options.bootstrapPath !== null) {
      return this.openPath(this.options.bootstrapPath)
    }
    return this.reopenLast()
  }

  async chooseRepository(
    window: BrowserWindow | undefined
  ): Promise<{ cancelled: boolean; status: WorkspaceRuntimeStatus }> {
    if (this.transitioning) {
      return { cancelled: false, status: this.operationInProgress() }
    }
    this.transitioning = true
    try {
      let picked: { cancelled: boolean; path: string | null }
      try {
        picked = await this.options.picker.pick(window)
      } catch (error) {
        return {
          cancelled: false,
          status: this.failOpen(
            this.currentRuntime(),
            'PICKER_FAILED',
            `repository picker failed: ${describe(error)}`
          )
        }
      }
      if (picked.cancelled || picked.path === null) {
        return { cancelled: true, status: this.status() }
      }
      const status = await this.doOpen(picked.path)
      return { cancelled: false, status }
    } finally {
      this.transitioning = false
    }
  }

  async openPath(rawPath: string): Promise<WorkspaceRuntimeStatus> {
    if (this.transitioning) {
      return this.operationInProgress()
    }
    this.transitioning = true
    try {
      return await this.doOpen(rawPath)
    } finally {
      this.transitioning = false
    }
  }

  async reopenLast(): Promise<WorkspaceRuntimeStatus> {
    if (this.transitioning) {
      return this.operationInProgress()
    }
    this.transitioning = true
    try {
      const read = await this.settings.read()
      if (!read.ok) {
        return this.failOpen(this.currentRuntime(), read.reasonCode, read.message)
      }
      if (read.settings.lastRepositoryPath === null) {
        return this.status()
      }
      return await this.doOpen(read.settings.lastRepositoryPath)
    } finally {
      this.transitioning = false
    }
  }

  async close(): Promise<WorkspaceRuntimeStatus> {
    if (this.transitioning) {
      return this.operationInProgress()
    }
    this.transitioning = true
    try {
      const runtime = this.currentRuntime()
      if (!runtime) {
        this.setState({ kind: 'CLOSED' })
        this.lastError = null
        return this.status()
      }
      if (this.activeRuns > 0) {
        this.setState({ kind: 'READY', runtime })
        this.lastError = toError(
          'ACTIVE_RUN_BLOCKS_SWITCH',
          'an execution is active; close is blocked until it finishes',
          true
        )
        return this.status()
      }
      this.setState({ kind: 'CLOSING', runtime })
      await this.waitForIdle()
      const disposeError = await this.disposeRuntime(runtime)
      this.setState({ kind: 'CLOSED' })
      this.lastError = disposeError
      return this.status()
    } finally {
      this.transitioning = false
    }
  }

  private async doOpen(rawPath: string): Promise<WorkspaceRuntimeStatus> {
    const held = this.currentRuntime()
    if (this.activeRuns > 0) {
      return this.failOpen(
        held,
        'ACTIVE_RUN_BLOCKS_SWITCH',
        'an execution is active; switching is blocked until it finishes'
      )
    }
    // Enter OPENING before the first await so no new command can acquire the
    // held runtime while we validate and assemble the candidate.
    this.setState({ kind: 'OPENING', held })
    await this.waitForIdle()

    const validation = await validateRepository(rawPath)
    if (!validation.ok) {
      return this.failOpen(held, validation.reasonCode, validation.message)
    }
    const canonical = validation.canonicalPath
    const identity = workspaceIdentity(canonical)
    const roots = workspaceStorageRoots(this.options.userData, identity)
    try {
      await mkdir(roots.runtimeDirectory, { recursive: true })
      await access(roots.runtimeDirectory, constants.W_OK)
    } catch {
      return this.failOpen(
        held,
        'RUNTIME_NOT_WRITABLE',
        `runtime directory is not writable: ${roots.runtimeDirectory}`
      )
    }

    let persistence: Persistence | null = null
    try {
      persistence = openWorkspaceDatabase(
        roots.databasePath,
        undefined,
        this.options.migrationsFolder
      )
    } catch (error) {
      return this.failOpen(held, 'DATABASE_OPEN_FAILED', `database open failed: ${describe(error)}`)
    }

    let workerHost: WorkerHost | null = null
    let reportedDisposeError: WorkspaceOperationError | null = null
    try {
      const appConfig: AppConfig = {
        sourceRepositoryPath: canonical,
        runtimeDirectory: roots.runtimeDirectory
      }
      const revisions = new GitRevisionReader(appConfig)
      const workspace = new WorkspaceService(persistence, revisions)
      workerHost =
        this.options.workerHostFactory !== undefined
          ? this.options.workerHostFactory(appConfig)
          : new UtilityProcessWorkerHost(appConfig)
      const coordinator = new ExecutionCoordinator(persistence, workerHost, roots.runtimeDirectory)
      const candidate: ActiveWorkspaceRuntime = {
        identity,
        repositoryPath: canonical,
        persistence,
        workspace,
        workerHost,
        coordinator,
        appConfig
      }
      // Settings persistence is part of the candidate commit: a write failure
      // must roll the open back (cleanup the candidate) and keep the prior
      // last-workspace preference authoritative across restart.
      await this.settings.writeLast(canonical)
      if (held !== null) {
        const disposeError = await this.disposeRuntime(held)
        if (disposeError !== null) {
          reportedDisposeError = disposeError
        }
      }
      this.setState({ kind: 'READY', runtime: candidate })
      this.lastError = reportedDisposeError
      console.error(`[workspace] ready at ${canonical}`)
      return this.status()
    } catch (error) {
      if (workerHost !== null) {
        try {
          await workerHost.dispose()
        } catch {
          // best-effort reverse-order cleanup
        }
      }
      closeDatabase(persistence)
      return this.failOpen(held, 'UNKNOWN', `workspace open failed: ${describe(error)}`)
    }
  }

  private async disposeRuntime(
    runtime: ActiveWorkspaceRuntime
  ): Promise<WorkspaceOperationError | null> {
    let workerError: unknown = null
    try {
      await runtime.workerHost.dispose()
    } catch (error) {
      workerError = error
    }
    try {
      closeDatabase(runtime.persistence)
    } catch (error) {
      console.error('[workspace] failed to close persistence during dispose', error)
    }
    if (workerError !== null) {
      return toError(
        'WORKER_DISPOSE_FAILED',
        `worker dispose failed: ${describe(workerError)}`,
        true
      )
    }
    return null
  }

  private failOpen(
    held: ActiveWorkspaceRuntime | null,
    reasonCode: WorkspaceErrorReason,
    message: string
  ): WorkspaceRuntimeStatus {
    if (held !== null) {
      this.setState({ kind: 'READY', runtime: held })
    } else {
      this.setState({ kind: 'ERROR' })
    }
    this.lastError = toError(reasonCode, message, true)
    return this.status()
  }

  private operationInProgress(): WorkspaceRuntimeStatus {
    return {
      state: this.publicState(),
      activeWorkspace: this.activeSummary(),
      lastError: toError(
        'OPERATION_IN_PROGRESS',
        'a workspace operation is already in progress',
        true
      )
    }
  }

  private setState(state: RuntimeState): void {
    this.state = state
  }

  private currentRuntime(): ActiveWorkspaceRuntime | null {
    switch (this.state.kind) {
      case 'READY':
        return this.state.runtime
      case 'CLOSING':
        return this.state.runtime
      case 'OPENING':
        return this.state.held
      default:
        return null
    }
  }

  private activeSummary(): WorkspaceSummary | null {
    const runtime = this.currentRuntime()
    if (runtime === null) {
      return null
    }
    return {
      identity: runtime.identity,
      repositoryName: repositoryName(runtime.repositoryPath),
      displayPath: runtime.repositoryPath
    }
  }

  private publicState(): WorkspaceRuntimeStatus['state'] {
    switch (this.state.kind) {
      case 'CLOSED':
        return 'CLOSED'
      case 'OPENING':
        return 'OPENING'
      case 'READY':
        return 'READY'
      case 'CLOSING':
        return 'CLOSING'
      case 'ERROR':
        return 'ERROR'
    }
  }
}
