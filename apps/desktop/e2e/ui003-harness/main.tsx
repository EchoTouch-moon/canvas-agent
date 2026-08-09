import ReactDOM from 'react-dom/client'
import type { JSX, ReactNode } from 'react'
import type {
  AgentRuntimeStatus,
  WorkspaceRuntimeStatus,
  WorkspaceSummary
} from '@canvas-agent/contracts'
import { ProductOnboarding } from '@/components/app/product-onboarding'
import { ProjectSetupFlow } from '@/components/app/project-setup-flow'
import { TaskSetupFlow } from '@/components/app/task-setup-flow'
import { createFakeWorkspaceClient, createFakeWorkspaceState } from '@/data/fake-workspace'
import type { WorkspaceLifecycleClient } from '@/lib/workspace-client'
import '@/assets/main.css'

type VisualState =
  | 'booting'
  | 'no-workspace'
  | 'opening'
  | 'ready'
  | 'switch-blocked'
  | 'error'
  | 'closing'
  | 'agent-auth'
  | 'first-task'
  | 'keyboard-path'
  | 'first-project'
  | 'baseline-draft'
  | 'task-spec'
  | 'dirty'

const params = new URLSearchParams(window.location.search)
const visualState = (params.get('state') ?? 'no-workspace') as VisualState
const visualTheme = params.get('theme') === 'dark' ? 'dark' : 'light'
window.localStorage.setItem('canvas-agent-theme', visualTheme)
document.documentElement.classList.toggle('dark', visualTheme === 'dark')

const summary: WorkspaceSummary = {
  identity: 'a'.repeat(64),
  repositoryName: 'canvas-agent',
  displayPath: '/Users/demo/Projects/canvas-agent'
}

const closedStatus: WorkspaceRuntimeStatus = {
  state: 'CLOSED',
  activeWorkspace: null,
  lastError: null
}

const readyStatus: WorkspaceRuntimeStatus = {
  state: 'READY',
  activeWorkspace: summary,
  lastError: null
}

const readyAgent: AgentRuntimeStatus = {
  provider: 'codex-cli',
  state: 'READY',
  version: 'codex-cli 0.146.0',
  source: 'KNOWN_LOCATION',
  displayPath: '/opt/homebrew/bin/codex',
  lastError: null
}

const authAgent: AgentRuntimeStatus = {
  provider: 'codex-cli',
  state: 'AUTH_REQUIRED',
  version: 'codex-cli 0.146.0',
  source: 'KNOWN_LOCATION',
  displayPath: '/opt/homebrew/bin/codex',
  lastError: { reasonCode: 'AUTH_REQUIRED', recoverable: true }
}

function statusFor(state: VisualState): WorkspaceRuntimeStatus {
  switch (state) {
    case 'opening':
      return { state: 'OPENING', activeWorkspace: null, lastError: null }
    case 'ready':
    case 'agent-auth':
    case 'first-task':
    case 'first-project':
    case 'baseline-draft':
    case 'task-spec':
    case 'dirty':
      return readyStatus
    case 'switch-blocked':
      return {
        state: 'READY',
        activeWorkspace: summary,
        lastError: {
          reasonCode: 'ACTIVE_RUN_BLOCKS_SWITCH',
          message:
            'A Run is still active. Return to the current work and try switching again later.',
          recoverable: true
        }
      }
    case 'error':
      return {
        state: 'ERROR',
        activeWorkspace: null,
        lastError: {
          reasonCode: 'NOT_GIT_WORKTREE',
          message: 'The selected folder is not a readable Git worktree with a commit.',
          recoverable: true
        }
      }
    case 'closing':
      return { state: 'CLOSING', activeWorkspace: summary, lastError: null }
    case 'booting':
    case 'no-workspace':
    case 'keyboard-path':
      return closedStatus
  }
}

function deferred<T>(): Promise<T> {
  return new Promise<T>(() => undefined)
}

const status = statusFor(visualState)
const agentStatus = visualState === 'agent-auth' ? authAgent : readyAgent
const seededWorkspace = createFakeWorkspaceState()
const firstTaskWorkspace = {
  ...seededWorkspace,
  tasks: [],
  taskSpecs: []
}
const workspaceClient =
  visualState === 'first-task' || visualState === 'keyboard-path'
    ? createFakeWorkspaceClient({
        projects: [firstTaskWorkspace.project],
        states: [firstTaskWorkspace]
      })
    : createFakeWorkspaceClient()
const lifecycleClient: WorkspaceLifecycleClient = {
  getWorkspaceStatus: () =>
    visualState === 'booting' ? deferred<WorkspaceRuntimeStatus>() : Promise.resolve(status),
  chooseRepository: async () =>
    visualState === 'keyboard-path'
      ? { cancelled: false, status: readyStatus }
      : { cancelled: true, status },
  reopenLast: async () => status,
  closeWorkspace: async () => closedStatus,
  getAgentStatus: () =>
    visualState === 'booting' ? deferred<AgentRuntimeStatus>() : Promise.resolve(agentStatus),
  chooseAgentExecutable: async () => ({ cancelled: true, status: agentStatus }),
  clearAgentExecutable: async () => agentStatus
}

const noopProjectAdvance = async (): Promise<void> => undefined
const noopBaselineActivate = async (): Promise<void> => undefined
const noopTaskAdvance = async (): Promise<void> => undefined

function SetupFixture({
  label,
  title,
  children
}: {
  readonly label: string
  readonly title: string
  readonly children: ReactNode
}): JSX.Element {
  return (
    <div className="ca-workspace-backdrop min-h-screen bg-workspace text-foreground">
      <header className="ca-topbar flex h-14 items-center gap-2.5 border-b border-border px-5">
        <span className="grid size-8 place-items-center rounded-[var(--radius-control)] bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
          CA
        </span>
        <div>
          <p className="text-[13px] font-semibold leading-none">Canvas Agent</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Visual setup review</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1180px] p-6">
        <div className="mb-4" role="status" aria-live="polite">
          <p className="text-[9px] font-semibold tracking-[0.14em] text-primary uppercase">
            {label}
          </p>
          <h1 className="mt-1 text-lg font-semibold">{title}</h1>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">{children}</div>
      </main>
    </div>
  )
}

function setupFixtureFor(state: VisualState): JSX.Element | null {
  if (state === 'first-project') {
    return (
      <SetupFixture label="First project" title="Define the project before work begins">
        <ProjectSetupFlow
          state={{ kind: 'NO_PROJECT', ambiguity: null }}
          suggestedProjectName="canvas-agent"
          busy={false}
          disabled={false}
          repositoryDirty={false}
          error={null}
          onAdvance={noopProjectAdvance}
          onActivateBaseline={noopBaselineActivate}
        />
      </SetupFixture>
    )
  }
  if (state === 'baseline-draft') {
    return (
      <SetupFixture label="Initial baseline" title="Review the saved project context">
        <ProjectSetupFlow
          state={{
            kind: 'BASELINE_DRAFT_REVIEW',
            projectId: seededWorkspace.project.id,
            baselineId: 'baseline-draft',
            ambiguity: null
          }}
          suggestedProjectName={seededWorkspace.project.name}
          busy={false}
          disabled={false}
          repositoryDirty={false}
          error={null}
          onAdvance={noopProjectAdvance}
          onActivateBaseline={noopBaselineActivate}
        />
      </SetupFixture>
    )
  }
  if (state === 'task-spec') {
    return (
      <SetupFixture label="First task" title="Publish a verifiable Task specification">
        <TaskSetupFlow
          state={{
            kind: 'TASK_DRAFT_NEEDS_SPEC',
            projectId: seededWorkspace.project.id,
            taskId: seededWorkspace.tasks[0]?.id ?? 'task-draft',
            ambiguity: null
          }}
          targets={seededWorkspace.nodeVersions}
          busy={false}
          disabled={false}
          repositoryDirty={false}
          error={null}
          onAdvance={noopTaskAdvance}
        />
      </SetupFixture>
    )
  }
  if (state === 'dirty') {
    const dirtyState = {
      kind: 'REPOSITORY_DIRTY_BLOCKED' as const,
      workingTreePatchHash: 'd'.repeat(64),
      ambiguity: null,
      blockedState: {
        kind: 'BASELINE_DRAFT_REVIEW' as const,
        projectId: seededWorkspace.project.id,
        baselineId: 'baseline-draft',
        ambiguity: null
      }
    }
    return (
      <SetupFixture label="Read-only repository" title="Uncommitted changes detected">
        <ProjectSetupFlow
          state={dirtyState}
          suggestedProjectName={seededWorkspace.project.name}
          busy={false}
          disabled
          repositoryDirty
          error={null}
          onAdvance={noopProjectAdvance}
          onActivateBaseline={noopBaselineActivate}
        />
        <TaskSetupFlow
          state={{
            kind: 'TASK_DRAFT_NEEDS_SPEC',
            projectId: seededWorkspace.project.id,
            taskId: seededWorkspace.tasks[0]?.id ?? 'task-draft',
            ambiguity: null
          }}
          targets={seededWorkspace.nodeVersions}
          busy={false}
          disabled
          repositoryDirty
          error={null}
          onAdvance={noopTaskAdvance}
        />
      </SetupFixture>
    )
  }
  return null
}

const setupFixture = setupFixtureFor(visualState)
ReactDOM.createRoot(document.getElementById('root')!).render(
  setupFixture ?? (
    <ProductOnboarding workspaceClient={workspaceClient} lifecycleClient={lifecycleClient} />
  )
)
