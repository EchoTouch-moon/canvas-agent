import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, FolderGit2, Loader2, Moon, RefreshCw, Sun, X } from 'lucide-react'
import type { RepositoryRevisionRecord } from '@/lib/workspace-types'
import {
  createWorkspaceClient,
  createWorkspaceLifecycleClient,
  type WorkspaceClient,
  type WorkspaceLifecycleClient
} from '@/lib/workspace-client'
import {
  activateInitialBaseline,
  advanceProjectSetup,
  advanceTaskSetup,
  deriveProductSetupState,
  type ProductSetupCurrent,
  type ProjectSetupInput,
  type TaskSetupInput
} from '@/lib/product-onboarding'
import { useWorkspace } from '@/hooks/use-workspace'
import { useWorkspaceRuntime, type UseWorkspaceRuntimeResult } from '@/hooks/use-workspace-runtime'
import { LiveWorkspaceContent } from './live-workspace-view'
import { ProjectSetupFlow } from './project-setup-flow'
import { TaskSetupFlow } from './task-setup-flow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const defaultWorkspaceClient = createWorkspaceClient()
const defaultLifecycleClient = createWorkspaceLifecycleClient(defaultWorkspaceClient)

type ProductTheme = 'light' | 'dark'

function initialProductTheme(): ProductTheme {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem('canvas-agent-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function phaseLabel(phase: UseWorkspaceRuntimeResult['state']['phase']): string {
  switch (phase) {
    case 'BOOTING':
      return 'Starting'
    case 'NO_WORKSPACE':
      return 'No repository'
    case 'CHOOSING':
      return 'Choosing repository'
    case 'OPENING':
      return 'Opening repository'
    case 'REOPENING':
      return 'Reopening repository'
    case 'READY':
      return 'Ready'
    case 'SWITCH_BLOCKED':
      return 'Switch paused'
    case 'INVALID':
      return 'Repository unavailable'
    case 'CLOSING':
      return 'Closing repository'
    case 'UNAVAILABLE':
      return 'Connection unavailable'
    case 'READ_ONLY':
      return 'Read-only'
  }
}

function agentLabel(runtime: UseWorkspaceRuntimeResult): string {
  switch (runtime.state.agentPhase) {
    case 'CHECKING':
      return 'Checking Agent'
    case 'READY':
      return 'Agent ready'
    case 'NOT_FOUND':
      return 'Agent not found'
    case 'AUTH_REQUIRED':
      return 'Sign-in required'
    case 'UNSUPPORTED_VERSION':
      return 'Agent update required'
    case 'INTERPRETER_MISSING':
      return 'Runtime missing'
    case 'ERROR':
      return 'Agent unavailable'
  }
}

export interface ProductOnboardingProps {
  readonly workspaceClient?: WorkspaceClient
  readonly lifecycleClient?: WorkspaceLifecycleClient
}

function RuntimeActions({
  runtime,
  theme,
  onToggleTheme
}: {
  readonly runtime: UseWorkspaceRuntimeResult
  readonly theme: ProductTheme
  readonly onToggleTheme: () => void
}): React.JSX.Element {
  const agent = runtime.state.agentStatus
  const phaseTone =
    runtime.state.phase === 'READY'
      ? 'success'
      : runtime.state.phase === 'READ_ONLY' || runtime.state.phase === 'SWITCH_BLOCKED'
        ? 'warning'
        : runtime.state.phase === 'INVALID' || runtime.state.phase === 'UNAVAILABLE'
          ? 'danger'
          : 'info'
  return (
    <header className="ca-topbar flex min-h-16 flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 lg:px-5">
      <div className="flex shrink-0 items-center gap-2.5 pr-2">
        <span className="grid size-8 place-items-center rounded-[var(--radius-control)] bg-primary text-primary-foreground shadow-sm">
          <span className="text-sm font-semibold">CA</span>
        </span>
        <div>
          <p className="text-[13px] font-semibold leading-none">Canvas Agent</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Local workbench</p>
        </div>
      </div>

      <div className="min-w-[180px] flex-1 border-l border-border pl-3">
        <div className="flex min-w-0 items-center gap-2" aria-live="polite">
          <FolderGit2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <h1 className="truncate text-[13px] font-semibold">
            {runtime.activeWorkspace?.repositoryName ?? 'No repository open'}
          </h1>
          <Badge tone={phaseTone}>{phaseLabel(runtime.state.phase)}</Badge>
        </div>
        {runtime.activeWorkspace ? (
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            {runtime.activeWorkspace.displayPath}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Badge tone={agent?.state === 'READY' ? 'success' : 'warning'}>
          <Bot className="size-3" aria-hidden="true" />
          {agentLabel(runtime)}
        </Badge>
        {agent?.state !== 'READY' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={runtime.agentBusy || runtime.workspaceBusy}
            onClick={() => void runtime.chooseAgentExecutable()}
          >
            Configure Agent
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={runtime.agentBusy || runtime.workspaceBusy}
            onClick={() => void runtime.chooseAgentExecutable()}
          >
            Agent settings
          </Button>
        )}
        {agent?.source === 'USER_SELECTED' ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={runtime.agentBusy || runtime.workspaceBusy}
            onClick={() => void runtime.clearAgentExecutable()}
          >
            Use detected Agent
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={runtime.workspaceActionsDisabled || runtime.agentBusy}
          onClick={() => void runtime.chooseRepository()}
        >
          Switch repository
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={
            runtime.workspaceActionsDisabled ||
            runtime.agentBusy ||
            runtime.activeWorkspace === null
          }
          onClick={() => void runtime.closeWorkspace()}
        >
          Close
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh workspace status"
          title="Refresh workspace status"
          disabled={runtime.workspaceBusy || runtime.agentBusy}
          onClick={() => void runtime.refresh()}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? (
            <Sun className="size-3.5" aria-hidden="true" />
          ) : (
            <Moon className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      </div>
    </header>
  )
}

function NoWorkspace({
  runtime,
  theme,
  onToggleTheme
}: {
  readonly runtime: UseWorkspaceRuntimeResult
  readonly theme: ProductTheme
  readonly onToggleTheme: () => void
}): React.JSX.Element {
  const transition =
    runtime.state.phase === 'CHOOSING' ||
    runtime.state.phase === 'OPENING' ||
    runtime.state.phase === 'REOPENING' ||
    runtime.state.phase === 'CLOSING'
  const failure = runtime.state.phase === 'INVALID' || runtime.state.phase === 'UNAVAILABLE'
  const booting = runtime.state.phase === 'BOOTING'
  return (
    <div className="ca-workspace-backdrop min-h-screen bg-workspace text-foreground">
      <header className="ca-topbar flex h-14 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-[var(--radius-control)] bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
            CA
          </span>
          <div>
            <p className="text-[13px] font-semibold leading-none">Canvas Agent</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Local-first project workbench</p>
          </div>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? (
            <Sun className="size-4" aria-hidden="true" />
          ) : (
            <Moon className="size-4" aria-hidden="true" />
          )}
        </Button>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-3.5rem)] w-full max-w-5xl place-items-center p-5 lg:p-8">
        <section className="grid w-full overflow-hidden rounded-[calc(var(--radius-panel)+2px)] border border-border bg-card shadow-[0_18px_60px_-36px_color-mix(in_oklab,var(--foreground)_35%,transparent)] lg:grid-cols-[1.05fr_0.95fr]">
          <div className="ca-subtle-grid flex min-h-[420px] flex-col justify-between border-b border-border p-7 lg:border-r lg:border-b-0 lg:p-9">
            <div>
              <span className="inline-flex size-10 items-center justify-center rounded-[var(--radius-panel)] border border-primary/20 bg-primary/10 text-primary">
                <FolderGit2 className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-8 text-[10px] font-semibold tracking-[0.16em] text-primary uppercase">
                Start locally
              </p>
              <h1 className="mt-2 max-w-md text-2xl font-semibold tracking-[-0.02em]">
                Open a repository to begin
              </h1>
              <p className="mt-3 max-w-md text-[13px] leading-6 text-muted-foreground">
                Each repository keeps its own project history, Baselines, Tasks and Run evidence on
                this Mac. Your source remains the authority for code.
              </p>
            </div>
            <dl className="mt-8 grid gap-3 text-[11px] sm:grid-cols-3 lg:grid-cols-1">
              <div>
                <dt className="font-semibold text-foreground">Repository-scoped</dt>
                <dd className="mt-0.5 text-muted-foreground">
                  One isolated workspace per Git repo
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">Explicit gates</dt>
                <dd className="mt-0.5 text-muted-foreground">Nothing runs or activates silently</dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">Local Agent</dt>
                <dd className="mt-0.5 text-muted-foreground">Runs in an isolated worktree</dd>
              </div>
            </dl>
          </div>

          <div className="flex min-h-[420px] flex-col justify-center p-7 lg:p-9">
            <div className="flex items-center gap-2" aria-live="polite" role="status">
              {booting || transition ? (
                <Loader2 className="size-4 animate-spin text-status-info" aria-hidden="true" />
              ) : failure ? (
                <AlertTriangle className="size-4 text-status-danger" aria-hidden="true" />
              ) : (
                <FolderGit2 className="size-4 text-primary" aria-hidden="true" />
              )}
              <Badge tone={failure ? 'danger' : booting || transition ? 'info' : 'neutral'}>
                {phaseLabel(runtime.state.phase)}
              </Badge>
            </div>
            <h2 className="mt-5 text-lg font-semibold">
              {failure
                ? 'This repository needs attention'
                : transition
                  ? 'Preparing your workspace…'
                  : booting
                    ? 'Checking local workspace…'
                    : 'Choose a Git repository'}
            </h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Select a readable Git worktree with a valid commit. Canvas Agent keeps its app data
              outside your source files.
            </p>

            {runtime.recoverableError ? (
              <div
                role="alert"
                className="mt-5 flex items-start gap-3 rounded-[var(--radius-control)] border border-status-danger/30 bg-status-danger/8 p-3 text-xs text-status-danger"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 leading-5">{runtime.recoverableError}</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Dismiss repository error"
                  onClick={runtime.dismissError}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            ) : null}

            <div className="mt-6 grid gap-2">
              <Button
                disabled={runtime.workspaceActionsDisabled || transition}
                onClick={() => void runtime.chooseRepository()}
              >
                <FolderGit2 className="size-4" aria-hidden="true" />
                {runtime.state.phase === 'CHOOSING'
                  ? 'Waiting for repository…'
                  : 'Choose repository'}
              </Button>
              <Button
                variant="outline"
                disabled={runtime.workspaceActionsDisabled || transition}
                onClick={() => void runtime.reopenLast()}
              >
                {runtime.state.phase === 'REOPENING' ? 'Reopening…' : 'Reopen last repository'}
              </Button>
              {failure ? (
                <Button
                  variant="ghost"
                  disabled={transition || runtime.agentBusy}
                  onClick={() => void runtime.refresh()}
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  Retry status
                </Button>
              ) : null}
            </div>

            <p className="mt-5 text-[10px] leading-4 text-muted-foreground">
              Canvas Agent never stashes, resets or commits your working tree automatically.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

interface ReadyWorkspaceProps {
  readonly runtime: UseWorkspaceRuntimeResult
  readonly client: WorkspaceClient
  readonly theme: ProductTheme
  readonly onToggleTheme: () => void
}

function ReadyWorkspace({
  runtime,
  client,
  theme,
  onToggleTheme
}: ReadyWorkspaceProps): React.JSX.Element {
  const workspace = useWorkspace(null, client)
  const [revision, setRevision] = useState<RepositoryRevisionRecord | null>(null)
  const [revisionError, setRevisionError] = useState<string | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [setupBusy, setSetupBusy] = useState(false)
  const repositoryDirty = revision !== null && revision.workingTreePatchHash !== null

  const refreshRevision = useCallback(async (): Promise<void> => {
    try {
      setRevision(await client.command('revision.current', {}))
      setRevisionError(null)
    } catch (error) {
      setRevision(null)
      setRevisionError(error instanceof Error ? error.message : 'Repository revision unavailable')
    }
  }, [client])

  useEffect(() => {
    let active = true
    void client
      .command('revision.current', {})
      .then((nextRevision) => {
        if (!active) return
        setRevision(nextRevision)
        setRevisionError(null)
      })
      .catch((error: unknown) => {
        if (!active) return
        setRevision(null)
        setRevisionError(error instanceof Error ? error.message : 'Repository revision unavailable')
      })
    return () => {
      active = false
    }
  }, [client])

  const setRepositoryReadOnly = runtime.setRepositoryReadOnly
  useEffect(() => {
    setRepositoryReadOnly(repositoryDirty)
  }, [repositoryDirty, setRepositoryReadOnly])

  const setupState = useMemo(
    () => deriveProductSetupState(workspace.workspace, revision),
    [revision, workspace.workspace]
  )
  const effectiveSetup =
    setupState.kind === 'REPOSITORY_DIRTY_BLOCKED' ? setupState.blockedState : setupState

  const refreshProductState = useCallback(async (): Promise<void> => {
    await Promise.all([workspace.refresh(), refreshRevision()])
  }, [refreshRevision, workspace])

  const current = useCallback(
    (): ProductSetupCurrent => ({ workspace: workspace.workspace, revision }),
    [revision, workspace.workspace]
  )

  const advanceProject = useCallback(
    async (input: ProjectSetupInput): Promise<void> => {
      if (runtime.projectCommandsDisabled || setupBusy) return
      setSetupBusy(true)
      setSetupError(null)
      const result = await advanceProjectSetup(client, current(), input)
      setSetupError(result.error?.message ?? null)
      await refreshProductState()
      setSetupBusy(false)
    },
    [client, current, refreshProductState, runtime.projectCommandsDisabled, setupBusy]
  )

  const activateBaseline = useCallback(
    async (baselineId: string): Promise<void> => {
      if (runtime.projectCommandsDisabled || setupBusy) return
      setSetupBusy(true)
      setSetupError(null)
      try {
        await activateInitialBaseline(client, baselineId)
      } catch (error) {
        setSetupError(error instanceof Error ? error.message : 'Baseline activation failed')
      }
      await refreshProductState()
      setSetupBusy(false)
    },
    [client, refreshProductState, runtime.projectCommandsDisabled, setupBusy]
  )

  const advanceTask = useCallback(
    async (input: TaskSetupInput): Promise<void> => {
      if (runtime.projectCommandsDisabled || setupBusy) return
      setSetupBusy(true)
      setSetupError(null)
      const result = await advanceTaskSetup(client, current(), input)
      setSetupError(result.error?.message ?? null)
      await refreshProductState()
      setSetupBusy(false)
    },
    [client, current, refreshProductState, runtime.projectCommandsDisabled, setupBusy]
  )

  const taskReady = effectiveSetup.kind === 'TASK_READY'
  const repositoryClean = revision?.workingTreePatchHash === null
  const executionAvailable =
    runtime.state.phase === 'READY' &&
    runtime.state.agentPhase === 'READY' &&
    repositoryClean &&
    workspace.workspace?.activeBaseline?.status === 'ACTIVE' &&
    taskReady
  const executionUnavailableReason = !repositoryClean
    ? 'Commit or stash repository changes externally before freezing or running.'
    : runtime.state.agentPhase !== 'READY'
      ? 'Select and validate a supported, authenticated Agent CLI before running.'
      : !taskReady
        ? 'Complete Project, Baseline, Task and TaskSpec setup before running.'
        : runtime.state.phase !== 'READY'
          ? 'Wait for the workspace transition to finish.'
          : null
  const runtimeNoticeIsWarning =
    runtime.state.phase === 'SWITCH_BLOCKED' || runtime.state.phase === 'READ_ONLY'

  return (
    <div className="ca-workspace-backdrop min-h-screen bg-workspace text-foreground">
      <RuntimeActions runtime={runtime} theme={theme} onToggleTheme={onToggleTheme} />
      {runtime.recoverableError ? (
        <div
          role="alert"
          className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-xs ${
            runtimeNoticeIsWarning
              ? 'border-status-warning/30 bg-status-warning/8 text-status-warning'
              : 'border-status-danger/30 bg-status-danger/8 text-status-danger'
          }`}
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            {runtime.recoverableError}
          </span>
          <Button size="xs" variant="ghost" onClick={runtime.dismissError}>
            Dismiss
          </Button>
        </div>
      ) : null}
      {revisionError ? (
        <div
          role="alert"
          className="border-b border-status-danger/30 bg-status-danger/8 px-4 py-2 text-xs text-status-danger"
        >
          {revisionError}
        </div>
      ) : null}
      {repositoryDirty ? (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-status-warning/30 bg-status-warning/8 px-4 py-2 text-xs text-status-warning"
        >
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Uncommitted repository changes detected. You can inspect saved work, but setup and Run
            actions stay read-only until you commit or stash them in your Git tool.
          </span>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-[1480px] p-4 lg:p-5">
        <section className="overflow-hidden rounded-[var(--radius-panel)] border border-border bg-card shadow-sm">
          <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold tracking-[0.14em] text-primary uppercase">
                Project setup
              </p>
              <h2 className="mt-0.5 text-sm font-semibold">Prepare a governed workspace</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Define intent first, activate a reviewed Baseline, then publish a verifiable Task.
              </p>
            </div>
            {workspace.projects.length > 0 ? (
              <label className="grid min-w-60 gap-1 text-[10px] font-medium text-muted-foreground">
                Current project
                <select
                  className="h-8 w-full rounded-[var(--radius-control)] border border-input bg-background px-2.5 text-xs text-foreground"
                  disabled={runtime.workspaceBusy || workspace.loading}
                  value={workspace.selectedProjectId ?? ''}
                  onChange={(event) => workspace.selectProject(event.target.value)}
                >
                  {workspace.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </header>

          <div className="p-4">
            {workspace.loading ? (
              <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                Loading saved project state…
              </div>
            ) : workspace.error ? (
              <div role="alert" className="space-y-3 py-4 text-xs text-status-danger">
                <p>{workspace.error.message}</p>
                <Button size="sm" variant="outline" onClick={() => void workspace.refresh()}>
                  Retry project state
                </Button>
              </div>
            ) : workspace.workspace === null && workspace.projects.length > 0 ? (
              <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                Opening the selected Project…
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                <ProjectSetupFlow
                  state={setupState}
                  suggestedProjectName={runtime.activeWorkspace?.repositoryName ?? 'New project'}
                  busy={setupBusy}
                  disabled={runtime.projectCommandsDisabled}
                  repositoryDirty={repositoryDirty}
                  error={setupError}
                  onAdvance={advanceProject}
                  onActivateBaseline={activateBaseline}
                />
                <TaskSetupFlow
                  state={setupState}
                  targets={workspace.workspace?.nodeVersions ?? []}
                  busy={setupBusy}
                  disabled={runtime.projectCommandsDisabled}
                  repositoryDirty={repositoryDirty}
                  error={setupError}
                  onAdvance={advanceTask}
                />
              </div>
            )}
          </div>
        </section>

        {runtime.workspaceBusy && workspace.workspace !== null ? (
          <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-control)] border border-status-info/30 bg-status-info/8 p-3 text-xs text-status-info">
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
            Your last ready Project stays visible while the repository transition completes. Setup
            and Run actions are paused.
          </div>
        ) : null}
      </main>

      {taskReady && workspace.workspace !== null ? (
        <>
          <Separator />
          <LiveWorkspaceContent
            workspace={workspace}
            executionAvailable={executionAvailable}
            executionUnavailableReason={executionUnavailableReason}
            mutationsAvailable={!runtime.projectCommandsDisabled}
          />
        </>
      ) : null}
    </div>
  )
}

export function ProductOnboarding({
  workspaceClient = defaultWorkspaceClient,
  lifecycleClient = defaultLifecycleClient
}: ProductOnboardingProps = {}): React.JSX.Element {
  const runtime = useWorkspaceRuntime(lifecycleClient)
  const [theme, setTheme] = useState<ProductTheme>(initialProductTheme)
  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem('canvas-agent-theme', theme)
  }, [theme])

  if (runtime.activeWorkspace === null) {
    return <NoWorkspace runtime={runtime} theme={theme} onToggleTheme={toggleTheme} />
  }
  return (
    <ReadyWorkspace
      key={runtime.activeWorkspace.identity}
      runtime={runtime}
      client={workspaceClient}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  )
}
