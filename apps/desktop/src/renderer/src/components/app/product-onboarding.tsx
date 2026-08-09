import { useCallback, useEffect, useMemo, useState } from 'react'
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

export interface ProductOnboardingProps {
  readonly workspaceClient?: WorkspaceClient
  readonly lifecycleClient?: WorkspaceLifecycleClient
}

function RuntimeActions({
  runtime
}: {
  readonly runtime: UseWorkspaceRuntimeResult
}): React.JSX.Element {
  const agent = runtime.state.agentStatus
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge
            tone={
              runtime.state.phase === 'READY'
                ? 'success'
                : runtime.state.phase === 'READ_ONLY' || runtime.state.phase === 'SWITCH_BLOCKED'
                  ? 'warning'
                  : 'info'
            }
          >
            {runtime.state.phase.replaceAll('_', ' ')}
          </Badge>
          <h1 className="truncate text-sm font-semibold">
            {runtime.activeWorkspace?.repositoryName ?? 'Canvas Agent'}
          </h1>
        </div>
        {runtime.activeWorkspace ? (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {runtime.activeWorkspace.displayPath}
          </p>
        ) : null}
      </div>
      <Badge tone={agent?.state === 'READY' ? 'success' : 'warning'}>
        Agent {runtime.state.agentPhase.replaceAll('_', ' ')}
      </Badge>
      {agent?.state !== 'READY' ? (
        <Button
          size="sm"
          variant="outline"
          disabled={runtime.agentBusy || runtime.workspaceBusy}
          onClick={() => void runtime.chooseAgentExecutable()}
        >
          Choose Agent CLI
        </Button>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={runtime.agentBusy || runtime.workspaceBusy}
            onClick={() => void runtime.chooseAgentExecutable()}
          >
            Change Agent CLI
          </Button>
          {agent.source === 'USER_SELECTED' ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={runtime.agentBusy || runtime.workspaceBusy}
              onClick={() => void runtime.clearAgentExecutable()}
            >
              Use auto-detected CLI
            </Button>
          ) : null}
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={runtime.workspaceActionsDisabled || runtime.agentBusy}
        onClick={() => void runtime.chooseRepository()}
      >
        Choose another repository
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={
          runtime.workspaceActionsDisabled || runtime.agentBusy || runtime.activeWorkspace === null
        }
        onClick={() => void runtime.closeWorkspace()}
      >
        Close
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={runtime.workspaceBusy || runtime.agentBusy}
        onClick={() => void runtime.refresh()}
      >
        Refresh status
      </Button>
    </header>
  )
}

function NoWorkspace({
  runtime
}: {
  readonly runtime: UseWorkspaceRuntimeResult
}): React.JSX.Element {
  const transition =
    runtime.state.phase === 'CHOOSING' ||
    runtime.state.phase === 'OPENING' ||
    runtime.state.phase === 'REOPENING' ||
    runtime.state.phase === 'CLOSING'
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <section className="w-full max-w-xl space-y-4 rounded-[var(--radius-panel)] border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Badge tone={runtime.state.phase === 'INVALID' ? 'danger' : 'info'}>
            {runtime.state.phase.replaceAll('_', ' ')}
          </Badge>
          <h1 className="text-base font-semibold">Open a Git repository</h1>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Canvas Agent keeps application state isolated per repository. Choose a readable Git
          worktree with a valid HEAD, or reopen the most recent workspace.
        </p>
        {runtime.recoverableError ? (
          <div className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-status-danger/30 p-3 text-xs text-status-danger">
            <span>{runtime.recoverableError}</span>
            <Button size="xs" variant="ghost" onClick={runtime.dismissError}>
              Dismiss
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={runtime.workspaceActionsDisabled || transition}
            onClick={() => void runtime.chooseRepository()}
          >
            {runtime.state.phase === 'CHOOSING' ? 'Choosing…' : 'Choose repository'}
          </Button>
          <Button
            variant="outline"
            disabled={runtime.workspaceActionsDisabled || transition}
            onClick={() => void runtime.reopenLast()}
          >
            {runtime.state.phase === 'REOPENING' ? 'Reopening…' : 'Reopen last'}
          </Button>
          <Button
            variant="ghost"
            disabled={transition || runtime.agentBusy}
            onClick={() => void runtime.refresh()}
          >
            Retry status
          </Button>
        </div>
      </section>
    </main>
  )
}

interface ReadyWorkspaceProps {
  readonly runtime: UseWorkspaceRuntimeResult
  readonly client: WorkspaceClient
}

function ReadyWorkspace({ runtime, client }: ReadyWorkspaceProps): React.JSX.Element {
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

  return (
    <>
      <RuntimeActions runtime={runtime} />
      {runtime.recoverableError ? (
        <div className="flex items-center justify-between gap-3 border-b border-status-danger/30 bg-status-danger/8 px-4 py-2 text-xs text-status-danger">
          <span>{runtime.recoverableError}</span>
          <Button size="xs" variant="ghost" onClick={runtime.dismissError}>
            Dismiss
          </Button>
        </div>
      ) : null}
      {revisionError ? (
        <div className="border-b border-status-danger/30 px-4 py-2 text-xs text-status-danger">
          {revisionError}
        </div>
      ) : null}
      {repositoryDirty ? (
        <div className="border-b border-status-warning/30 bg-status-warning/8 px-4 py-2 text-xs text-status-warning">
          This repository has uncommitted changes. Inspection remains available, but initial
          Baseline creation and execution are read-only until you commit or stash externally.
        </div>
      ) : null}

      <div className="space-y-4 p-4">
        {workspace.projects.length > 0 ? (
          <label className="block max-w-sm space-y-1 text-xs font-medium">
            Project
            <select
              className="h-8 w-full rounded-[var(--radius-control)] border border-input bg-background px-2.5 text-xs"
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

        {workspace.loading ? (
          <p className="text-sm text-muted-foreground">Loading project state…</p>
        ) : workspace.error ? (
          <div className="space-y-2 text-sm text-status-danger">
            <p>{workspace.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => void workspace.refresh()}>
              Retry project state
            </Button>
          </div>
        ) : workspace.workspace === null && workspace.projects.length > 0 ? (
          <p className="text-sm text-muted-foreground">Opening the selected Project…</p>
        ) : (
          <>
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
          </>
        )}
      </div>

      {runtime.workspaceBusy && workspace.workspace !== null ? (
        <div className="mx-4 mb-4 rounded-[var(--radius-control)] border border-border p-3 text-xs text-muted-foreground">
          The last READY Project remains retained while the workspace transition completes. Project
          and Run commands are paused.
        </div>
      ) : null}

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
    </>
  )
}

export function ProductOnboarding({
  workspaceClient = defaultWorkspaceClient,
  lifecycleClient = defaultLifecycleClient
}: ProductOnboardingProps = {}): React.JSX.Element {
  const runtime = useWorkspaceRuntime(lifecycleClient)
  if (runtime.activeWorkspace === null) return <NoWorkspace runtime={runtime} />
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ReadyWorkspace
        key={runtime.activeWorkspace.identity}
        runtime={runtime}
        client={workspaceClient}
      />
    </div>
  )
}
