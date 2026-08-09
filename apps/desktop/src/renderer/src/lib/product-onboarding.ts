import type {
  AgentRuntimeStatus,
  CommandOutput,
  WorkspaceRuntimeStatus
} from '@canvas-agent/contracts'
import type {
  BaselineAggregate,
  ContextSnapshotRecord,
  ProjectBaselineRecord,
  ProjectStateView,
  RepositoryRevisionRecord,
  TaskSpecAggregate
} from './workspace-types'
import { WorkspaceError, type WorkspaceClient } from './workspace-client'

export type ProductSetupStateKind =
  | 'NO_PROJECT'
  | 'PROJECT_NEEDS_CHARTER'
  | 'PROJECT_NEEDS_BASELINE_DRAFT'
  | 'BASELINE_DRAFT_REVIEW'
  | 'READY_FOR_TASK'
  | 'TASK_DRAFT_NEEDS_SPEC'
  | 'TASK_READY'
  | 'REPOSITORY_DIRTY_BLOCKED'

export interface ProductSetupAmbiguity {
  readonly kind: 'CHARTER' | 'TASK' | 'BASELINE'
  readonly ids: readonly string[]
  readonly message: string
}

interface ProductSetupStateBase {
  readonly ambiguity: ProductSetupAmbiguity | null
}

export interface NoProjectSetupState extends ProductSetupStateBase {
  readonly kind: 'NO_PROJECT'
}

export interface ProjectNeedsCharterState extends ProductSetupStateBase {
  readonly kind: 'PROJECT_NEEDS_CHARTER'
  readonly projectId: string
  readonly charterNodeId: string | null
}

export interface ProjectNeedsBaselineDraftState extends ProductSetupStateBase {
  readonly kind: 'PROJECT_NEEDS_BASELINE_DRAFT'
  readonly projectId: string
  readonly charterVersionId: string
}

export interface BaselineDraftReviewState extends ProductSetupStateBase {
  readonly kind: 'BASELINE_DRAFT_REVIEW'
  readonly projectId: string
  readonly baselineId: string
}

export interface ReadyForTaskState extends ProductSetupStateBase {
  readonly kind: 'READY_FOR_TASK'
  readonly projectId: string
  readonly activeBaselineId: string
}

export interface TaskDraftNeedsSpecState extends ProductSetupStateBase {
  readonly kind: 'TASK_DRAFT_NEEDS_SPEC'
  readonly projectId: string
  readonly taskId: string | null
}

export interface TaskReadyState extends ProductSetupStateBase {
  readonly kind: 'TASK_READY'
  readonly projectId: string
  readonly taskId: string
  readonly taskSpecVersionId: string
}

export interface RepositoryDirtyBlockedState extends ProductSetupStateBase {
  readonly kind: 'REPOSITORY_DIRTY_BLOCKED'
  readonly blockedState: Exclude<
    ProductSetupState,
    RepositoryDirtyBlockedState | NoProjectSetupState
  >
  readonly workingTreePatchHash: string
}

export type ProductSetupState =
  | NoProjectSetupState
  | ProjectNeedsCharterState
  | ProjectNeedsBaselineDraftState
  | BaselineDraftReviewState
  | ReadyForTaskState
  | TaskDraftNeedsSpecState
  | TaskReadyState
  | RepositoryDirtyBlockedState

export interface ProductSetupCurrent {
  readonly workspace: ProjectStateView | null
  readonly revision: RepositoryRevisionRecord | null
}

export interface ProjectSetupInput {
  readonly projectId?: string
  readonly projectName: string
  readonly projectDescription?: string
  readonly charterTitle: string
  readonly charterBody: string
  readonly baselineName: string
  readonly baselineDescription?: string
}

export interface TaskSetupInput {
  readonly title: string
  readonly description: string
  readonly scope: string
  readonly targetNodeVersionId?: string
  readonly criteria: readonly {
    readonly description: string
    readonly verificationMethod?:
      'AUTOMATED_TEST' | 'MANUAL_REVIEW' | 'ARTIFACT_CHECK' | 'STRUCTURED_ASSERTION'
  }[]
}

export interface ProductSetupAdvanceResult {
  readonly current: ProductSetupCurrent
  readonly state: ProductSetupState
  readonly error: Error | null
}

export class ProductSetupAmbiguityError extends Error {
  readonly ambiguity: ProductSetupAmbiguity

  constructor(ambiguity: ProductSetupAmbiguity) {
    super(ambiguity.message)
    this.name = 'ProductSetupAmbiguityError'
    this.ambiguity = ambiguity
  }
}

function byCreation(
  left: { readonly createdAt: string; readonly id: string },
  right: { readonly createdAt: string; readonly id: string }
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

function latestVersionForNode(
  workspace: ProjectStateView,
  nodeId: string
): ProjectStateView['nodeVersions'][number] | null {
  return (
    workspace.nodeVersions
      .filter((version) => version.nodeId === nodeId)
      .sort(
        (left, right) => right.sequence - left.sequence || right.id.localeCompare(left.id)
      )[0] ?? null
  )
}

function firstBaselineByStatus(
  workspace: ProjectStateView,
  status: 'DRAFT' | 'ACTIVE'
): BaselineAggregate | null {
  return (
    workspace.baselines
      .filter((aggregate) => aggregate.baseline.status === status)
      .slice()
      .sort((left, right) => byCreation(left.baseline, right.baseline))[0] ?? null
  )
}

function stateWithoutDirtyOverlay(
  workspace: ProjectStateView | null
): Exclude<ProductSetupState, RepositoryDirtyBlockedState> {
  if (workspace === null) return { kind: 'NO_PROJECT', ambiguity: null }

  const goals = workspace.nodes.filter((node) => node.type === 'GOAL')
  const completedGoals = goals
    .map((node) => ({ node, version: latestVersionForNode(workspace, node.id) }))
    .filter(
      (
        item
      ): item is {
        readonly node: ProjectStateView['nodes'][number]
        readonly version: ProjectStateView['nodeVersions'][number]
      } => item.version !== null
    )
  const incompleteGoals = goals.filter((node) => latestVersionForNode(workspace, node.id) === null)

  if (completedGoals.length === 0) {
    const ambiguity =
      incompleteGoals.length > 1
        ? {
            kind: 'CHARTER' as const,
            ids: incompleteGoals.map((node) => node.id),
            message: 'More than one unpublished GOAL could be the project charter.'
          }
        : null
    return {
      kind: 'PROJECT_NEEDS_CHARTER',
      projectId: workspace.project.id,
      charterNodeId: incompleteGoals[0]?.id ?? null,
      ambiguity
    }
  }

  if (completedGoals.length > 1 || incompleteGoals.length > 0) {
    return {
      kind: 'PROJECT_NEEDS_CHARTER',
      projectId: workspace.project.id,
      charterNodeId: null,
      ambiguity: {
        kind: 'CHARTER',
        ids: goals.map((node) => node.id),
        message: 'Multiple GOAL facts make the initial project charter ambiguous.'
      }
    }
  }

  const charterVersion = completedGoals[0]!.version
  const drafts = workspace.baselines.filter((aggregate) => aggregate.baseline.status === 'DRAFT')
  if (drafts.length > 1) {
    return {
      kind: 'BASELINE_DRAFT_REVIEW',
      projectId: workspace.project.id,
      baselineId: drafts[0]!.baseline.id,
      ambiguity: {
        kind: 'BASELINE',
        ids: drafts.map((aggregate) => aggregate.baseline.id),
        message: 'More than one DRAFT Baseline requires an explicit user choice.'
      }
    }
  }
  const draft = firstBaselineByStatus(workspace, 'DRAFT')
  if (draft !== null) {
    return {
      kind: 'BASELINE_DRAFT_REVIEW',
      projectId: workspace.project.id,
      baselineId: draft.baseline.id,
      ambiguity: null
    }
  }

  const activeBaseline =
    workspace.activeBaseline ?? firstBaselineByStatus(workspace, 'ACTIVE')?.baseline ?? null
  if (activeBaseline === null) {
    return {
      kind: 'PROJECT_NEEDS_BASELINE_DRAFT',
      projectId: workspace.project.id,
      charterVersionId: charterVersion.id,
      ambiguity: null
    }
  }

  const taskSpecTaskIds = new Set(workspace.taskSpecs.map((aggregate) => aggregate.spec.taskId))
  const incompleteTasks = workspace.tasks.filter((task) => !taskSpecTaskIds.has(task.id))
  if (incompleteTasks.length > 1) {
    return {
      kind: 'TASK_DRAFT_NEEDS_SPEC',
      projectId: workspace.project.id,
      taskId: null,
      ambiguity: {
        kind: 'TASK',
        ids: incompleteTasks.map((task) => task.id),
        message: 'More than one Task has no published TaskSpec.'
      }
    }
  }
  if (incompleteTasks.length === 1) {
    return {
      kind: 'TASK_DRAFT_NEEDS_SPEC',
      projectId: workspace.project.id,
      taskId: incompleteTasks[0]!.id,
      ambiguity: null
    }
  }
  if (workspace.taskSpecs.length === 0) {
    return {
      kind: 'READY_FOR_TASK',
      projectId: workspace.project.id,
      activeBaselineId: activeBaseline.id,
      ambiguity: null
    }
  }
  const latestSpec = workspace.taskSpecs
    .slice()
    .sort((left, right) => byCreation(right.spec, left.spec))[0]!
  return {
    kind: 'TASK_READY',
    projectId: workspace.project.id,
    taskId: latestSpec.spec.taskId,
    taskSpecVersionId: latestSpec.spec.id,
    ambiguity: null
  }
}

/** Derives Renderer-only onboarding state from durable workspace facts. */
export function deriveProductSetupState(
  workspace: ProjectStateView | null,
  revision: RepositoryRevisionRecord | null
): ProductSetupState {
  const state = stateWithoutDirtyOverlay(workspace)
  if (
    revision?.workingTreePatchHash !== null &&
    revision !== null &&
    (state.kind === 'PROJECT_NEEDS_BASELINE_DRAFT' ||
      state.kind === 'BASELINE_DRAFT_REVIEW' ||
      state.kind === 'TASK_READY')
  ) {
    return {
      kind: 'REPOSITORY_DIRTY_BLOCKED',
      blockedState: state,
      workingTreePatchHash: revision.workingTreePatchHash,
      ambiguity: state.ambiguity
    }
  }
  return state
}

function requireText(value: string, label: string): void {
  if (value.trim().length === 0) throw new WorkspaceError('ValidationError', `${label} is required`)
}

function requireUnambiguous(state: ProductSetupState): void {
  if (state.ambiguity !== null) throw new ProductSetupAmbiguityError(state.ambiguity)
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Product setup command failed')
}

async function readProjectCurrent(
  client: WorkspaceClient,
  current: ProductSetupCurrent,
  requestedProjectId?: string
): Promise<ProductSetupCurrent> {
  const projects = await client.command('project.list', {})
  const projectId = requestedProjectId ?? current.workspace?.project.id
  if (projectId === undefined) {
    if (projects.length === 0) return { workspace: null, revision: null }
    if (projects.length > 1) {
      throw new ProductSetupAmbiguityError({
        kind: 'CHARTER',
        ids: projects.map((project) => project.id),
        message: 'Choose a Project before continuing setup.'
      })
    }
  }
  const selected =
    projectId === undefined ? projects[0] : projects.find((project) => project.id === projectId)
  if (selected === undefined)
    throw new WorkspaceError('NotFoundError', 'The selected Project no longer exists')
  const [workspace, revision] = await Promise.all([
    client.command('project.state', { projectId: selected.id }),
    client.command('revision.current', {})
  ])
  return { workspace, revision }
}

async function rehydrateAfterFailure(
  client: WorkspaceClient,
  current: ProductSetupCurrent,
  requestedProjectId?: string
): Promise<ProductSetupCurrent> {
  try {
    return await readProjectCurrent(client, current, requestedProjectId)
  } catch {
    return current
  }
}

function result(current: ProductSetupCurrent, error: Error | null): ProductSetupAdvanceResult {
  return { current, state: deriveProductSetupState(current.workspace, current.revision), error }
}

/**
 * Executes exactly the next missing durable Project/charter/Baseline fact.
 * Every unsuccessful command is followed by a best-effort rehydration so a retry
 * resumes from durable facts instead of creating compensating or duplicate records.
 */
export async function advanceProjectSetup(
  client: WorkspaceClient,
  current: ProductSetupCurrent,
  input: ProjectSetupInput
): Promise<ProductSetupAdvanceResult> {
  let hydrated = current
  try {
    hydrated = await readProjectCurrent(client, current, input.projectId)
    const state = deriveProductSetupState(hydrated.workspace, hydrated.revision)
    requireUnambiguous(state)
    if (state.kind === 'NO_PROJECT') {
      requireText(input.projectName, 'Project name')
      await client.command('project.create', {
        name: input.projectName.trim(),
        ...(input.projectDescription?.trim()
          ? { description: input.projectDescription.trim() }
          : {})
      })
    } else if (state.kind === 'PROJECT_NEEDS_CHARTER') {
      requireText(input.charterTitle, 'Charter title')
      requireText(input.charterBody, 'Charter body')
      if (state.charterNodeId === null) {
        await client.command('node.create', { projectId: state.projectId, type: 'GOAL' })
      } else {
        await client.command('nodeVersion.publish', {
          nodeId: state.charterNodeId,
          title: input.charterTitle.trim(),
          body: input.charterBody.trim()
        })
      }
    } else {
      const draftState = state.kind === 'REPOSITORY_DIRTY_BLOCKED' ? state.blockedState : state
      if (draftState.kind === 'PROJECT_NEEDS_BASELINE_DRAFT') {
        if (state.kind === 'REPOSITORY_DIRTY_BLOCKED') {
          throw new WorkspaceError(
            'ValidationError',
            'Commit or stash external changes before creating the initial Baseline draft.'
          )
        }
        requireText(input.baselineName, 'Baseline name')
        if (hydrated.revision === null)
          throw new WorkspaceError('NotFoundError', 'Repository revision is unavailable')
        await client.command('baseline.createDraft', {
          projectId: draftState.projectId,
          name: input.baselineName.trim(),
          nodeVersionIds: [draftState.charterVersionId],
          ...(input.baselineDescription?.trim()
            ? { description: input.baselineDescription.trim() }
            : {}),
          repositoryRevisionId: hydrated.revision.id
        })
      }
    }
    hydrated = await readProjectCurrent(client, hydrated, input.projectId)
    return result(hydrated, null)
  } catch (error) {
    hydrated = await rehydrateAfterFailure(client, hydrated, input.projectId)
    return result(hydrated, asError(error))
  }
}

/** Explicit user action: setup never activates a Baseline automatically. */
export function activateInitialBaseline(
  client: WorkspaceClient,
  baselineId: string
): Promise<CommandOutput<'baseline.activate'>> {
  return client.command('baseline.activate', { baselineId })
}

/** Executes exactly the next missing durable Task or TaskSpec fact. */
export async function advanceTaskSetup(
  client: WorkspaceClient,
  current: ProductSetupCurrent,
  input: TaskSetupInput
): Promise<ProductSetupAdvanceResult> {
  let hydrated = current
  try {
    hydrated = await readProjectCurrent(client, current)
    const state = deriveProductSetupState(hydrated.workspace, hydrated.revision)
    requireUnambiguous(state)
    const setupState = state.kind === 'REPOSITORY_DIRTY_BLOCKED' ? state.blockedState : state
    if (setupState.kind === 'READY_FOR_TASK') {
      requireText(input.title, 'Task title')
      await client.command('task.create', {
        projectId: setupState.projectId,
        type: 'IMPLEMENT_CHANGE',
        title: input.title.trim()
      })
    } else if (setupState.kind === 'TASK_DRAFT_NEEDS_SPEC') {
      if (setupState.taskId === null)
        throw new WorkspaceError('ValidationError', 'Task selection is required')
      requireText(input.description, 'Task description')
      requireText(input.scope, 'Task scope')
      if (input.criteria.length === 0) {
        throw new WorkspaceError('ValidationError', 'At least one acceptance criterion is required')
      }
      input.criteria.forEach((criterion) =>
        requireText(criterion.description, 'Acceptance criterion')
      )
      await client.command('taskSpec.publish', {
        taskId: setupState.taskId,
        description: input.description.trim(),
        scope: input.scope.trim(),
        ...(input.targetNodeVersionId === undefined
          ? {}
          : { targets: [{ nodeVersionId: input.targetNodeVersionId, position: 0 }] }),
        criteria: input.criteria.map((criterion, position) => ({
          description: criterion.description.trim(),
          ...(criterion.verificationMethod === undefined
            ? { verificationMethod: 'MANUAL_REVIEW' as const }
            : { verificationMethod: criterion.verificationMethod }),
          position
        }))
      })
    }
    hydrated = await readProjectCurrent(client, hydrated)
    return result(hydrated, null)
  } catch (error) {
    hydrated = await rehydrateAfterFailure(client, hydrated)
    return result(hydrated, asError(error))
  }
}

export interface ProductRunDispatchPrerequisites {
  readonly workspace: Pick<WorkspaceRuntimeStatus, 'state'> | null
  readonly agent: Pick<AgentRuntimeStatus, 'state'> | null
  readonly revision: RepositoryRevisionRecord | null
  readonly activeBaseline: ProjectBaselineRecord | null
  readonly taskSpec: TaskSpecAggregate | null
  readonly snapshot: Pick<ContextSnapshotRecord, 'status'> | null
}

/** Dispatch requires every independently durable readiness fact. */
export function canDispatchProductRun(input: ProductRunDispatchPrerequisites): boolean {
  return (
    input.workspace?.state === 'READY' &&
    input.agent?.state === 'READY' &&
    input.revision?.workingTreePatchHash === null &&
    input.activeBaseline?.status === 'ACTIVE' &&
    input.taskSpec !== null &&
    input.snapshot?.status === 'FROZEN'
  )
}
