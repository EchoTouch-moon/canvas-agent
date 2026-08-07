import type { TaskStatus } from '@canvas-agent/domain'
import type { FlowNotice, WorkspaceUiState } from '@/state/workspace-ui-reducer'
import type {
  ContextSnapshotRecord,
  DispatchResult,
  FrozenSnapshotView,
  ProjectStateView,
  TaskRecord,
  TaskSpecAggregate
} from './workspace-types'
import type { FlowRoute } from '@/state/workspace-ui-reducer'

export const CONTEXT_TOKEN_BUDGET = 8_000

export interface CoreFlowNode {
  readonly id: string
  readonly type: ProjectStateView['nodes'][number]['type']
  readonly lifecycle: ProjectStateView['nodes'][number]['lifecycle']
  readonly title: string
  readonly summary: string
  readonly body: string
  readonly version: string
  readonly versionId: string | null
  readonly draft: ProjectStateView['nodeDrafts'][number] | null
  readonly edges: readonly {
    readonly id: string
    readonly nodeId: string
    readonly nodeTitle: string
    readonly direction: 'incoming' | 'outgoing'
    readonly type: ProjectStateView['edges'][number]['type']
    readonly status: ProjectStateView['edges'][number]['status']
  }[]
}

export interface TaskCriterion {
  readonly id: string
  readonly label: string
  readonly passed: boolean
}

export interface CoreFlowTask {
  readonly id: string
  readonly type: TaskRecord['type']
  readonly title: string
  readonly objective: string
  readonly nonGoals: readonly string[]
  readonly targets: readonly string[]
  readonly status: TaskStatus
  readonly criteria: readonly TaskCriterion[]
  readonly acceptanceEvaluated: false
  readonly taskSpecVersionId: string | null
}

export interface ContextCandidate {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly content: string
  readonly sourceRef: string
  readonly type: 'USER_INPUT' | 'NODE_VERSION'
  readonly authority: 'TASK_INSTRUCTION' | 'PROJECT_FACT'
  readonly priority: 'P0' | 'P1'
  readonly tokens: number
  readonly required: boolean
}

export interface CoreFlowSnapshot {
  readonly id: string
  readonly label: string
  readonly status: ContextSnapshotRecord['status'] | 'DRAFT'
  readonly freshness: ContextSnapshotRecord['freshness']
  readonly revision: string
  readonly tokenBudget: number
  readonly frozenAt: string | null
  readonly record: FrozenSnapshotView | null
}

export interface RunTestResult {
  readonly id: string
  readonly label: string
  readonly status: 'PASSED' | 'FAILED'
  readonly detail: string
}

export interface CoreFlowRun {
  readonly id: string
  readonly status: 'CREATED' | 'RUNNING' | 'FINISHED'
  readonly outcome: DispatchResult['outcome'] | null
  readonly startedAt: string | null
  readonly cancelRequested: boolean
  readonly tests: readonly RunTestResult[]
  readonly result: DispatchResult | null
}

export type ArtifactReviewStatus = 'READY' | 'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED'

export interface CoreFlowArtifact {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly changedFiles: readonly string[]
  readonly diffLines: readonly string[]
  readonly reviewStatus: ArtifactReviewStatus
  readonly applicationStatus: 'NOT_APPLIED'
  readonly activeTab: 'summary' | 'diff' | 'tests'
}

export interface CoreFlowBaseline {
  readonly id: string
  readonly label: string
  readonly sourceTaskId: string
  readonly revision: string
  readonly status: NonNullable<ProjectStateView['activeBaseline']>['status']
}

export interface WorkspaceRenderState {
  readonly route: FlowRoute
  readonly project: {
    readonly id: string
    readonly name: string
    readonly description: string
    readonly branch: string
    readonly activeBaseline: string
  }
  readonly nodes: readonly CoreFlowNode[]
  readonly selectedNodeId: string
  readonly selectedTaskId: string
  readonly task: CoreFlowTask
  readonly contextItems: readonly ContextCandidate[]
  readonly selectedContextItemIds: readonly string[]
  readonly snapshot: CoreFlowSnapshot
  readonly run: CoreFlowRun
  readonly priorRuns: readonly CoreFlowRun[]
  readonly artifact: CoreFlowArtifact
  readonly baseline: CoreFlowBaseline | null
  readonly notice: FlowNotice | null
}

export interface ExecutionSession {
  readonly executionRequestId: string | null
  readonly snapshotId: string | null
  readonly status: 'idle' | 'pending' | 'finished'
  readonly startedAt: string | null
  readonly result: DispatchResult | null
  readonly cancelRequested: boolean
  readonly reviewStatus: ArtifactReviewStatus
  readonly frozenSnapshot: FrozenSnapshotView | null
}

export function createInitialExecutionSession(): ExecutionSession {
  return {
    executionRequestId: null,
    snapshotId: null,
    status: 'idle',
    startedAt: null,
    result: null,
    cancelRequested: false,
    reviewStatus: 'READY',
    frozenSnapshot: null
  }
}

function tokenEstimate(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4))
}

function latestNodeVersion(
  workspace: ProjectStateView,
  nodeId: string
): ProjectStateView['nodeVersions'][number] | undefined {
  return workspace.nodeVersions
    .filter((version) => version.nodeId === nodeId)
    .sort((left, right) => right.sequence - left.sequence)[0]
}

function latestTaskSpec(
  workspace: ProjectStateView,
  task: TaskRecord
): TaskSpecAggregate | undefined {
  return workspace.taskSpecs
    .filter((aggregate) => aggregate.spec.taskId === task.id)
    .sort((left, right) => right.spec.sequence - left.spec.sequence)[0]
}

function splitNonGoals(scope: string): readonly string[] {
  const prefix = 'Non-goals:'
  if (!scope.startsWith(prefix)) return scope.length > 0 ? [scope] : []
  return scope
    .slice(prefix.length)
    .split('.')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function buildTask(workspace: ProjectStateView, task: TaskRecord): CoreFlowTask {
  const spec = latestTaskSpec(workspace, task)
  const nodeTitle = new Map(
    workspace.nodes.map((node) => {
      const version = latestNodeVersion(workspace, node.id)
      return [node.id, version?.title ?? node.id] as const
    })
  )
  const targets =
    spec?.targets
      .slice()
      .sort((left, right) => left.position - right.position)
      .map((target) => {
        if (target.nodeId !== null) return nodeTitle.get(target.nodeId) ?? target.nodeId
        return target.nodeVersionId ?? 'Unresolved target'
      }) ?? []

  return {
    id: task.id,
    type: task.type,
    title: task.title,
    objective: spec?.spec.description ?? '',
    nonGoals: splitNonGoals(spec?.spec.scope ?? ''),
    targets,
    status: task.status,
    criteria:
      spec?.criteria
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((criterion) => ({
          id: criterion.id,
          label: criterion.description,
          passed: false
        })) ?? [],
    acceptanceEvaluated: false,
    taskSpecVersionId: spec?.spec.id ?? null
  }
}

function buildCandidates(
  workspace: ProjectStateView,
  task: TaskRecord,
  selectedNodeId: string
): readonly ContextCandidate[] {
  const spec = latestTaskSpec(workspace, task)
  const candidates: ContextCandidate[] = []
  if (spec) {
    const criteria = spec.criteria
      .slice()
      .sort((left, right) => left.position - right.position)
      .map((criterion) => criterion.description)
      .join('\n')
    const content = [spec.spec.description, spec.spec.scope, criteria]
      .filter((part) => part.length > 0)
      .join('\n')
    candidates.push({
      id: `task-spec:${spec.spec.id}`,
      label: 'Task specification',
      description: `${spec.spec.description} ${spec.spec.scope}`.trim(),
      content,
      sourceRef: spec.spec.id,
      type: 'USER_INPUT',
      authority: 'TASK_INSTRUCTION',
      priority: 'P0',
      tokens: tokenEstimate(content),
      required: true
    })
  }

  const versions = workspace.nodeVersions.filter((version) => version.nodeId === selectedNodeId)
  for (const version of versions) {
    const content = `${version.title}\n${version.body}`
    candidates.push({
      id: `node-version:${version.id}`,
      label: version.title,
      description: version.body,
      content,
      sourceRef: version.id,
      type: 'NODE_VERSION',
      authority: 'PROJECT_FACT',
      priority: 'P1',
      tokens: tokenEstimate(content),
      required: false
    })
  }
  return candidates
}

function buildNodeViews(workspace: ProjectStateView): readonly CoreFlowNode[] {
  const nodeTitle = new Map(
    workspace.nodes.map((node) => {
      const version = latestNodeVersion(workspace, node.id)
      return [node.id, version?.title ?? node.id] as const
    })
  )
  return workspace.nodes.map((node) => {
    const version = latestNodeVersion(workspace, node.id)
    const draft = workspace.nodeDrafts.find((item) => item.nodeId === node.id) ?? null
    const edges = workspace.edges
      .filter((edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id)
      .map((edge) => {
        const outgoing = edge.sourceNodeId === node.id
        const nodeId = outgoing ? edge.targetNodeId : edge.sourceNodeId
        return {
          id: edge.id,
          nodeId,
          nodeTitle: nodeTitle.get(nodeId) ?? nodeId,
          direction: outgoing ? ('outgoing' as const) : ('incoming' as const),
          type: edge.type,
          status: edge.status
        }
      })
    return {
      id: node.id,
      type: node.type,
      lifecycle: node.lifecycle,
      title: draft?.title ?? version?.title ?? node.id,
      summary: draft?.body ?? version?.body ?? '',
      body: draft?.body ?? version?.body ?? '',
      version: version ? `v${version.sequence}` : 'No version',
      versionId: version?.id ?? null,
      draft,
      edges
    }
  })
}

function buildRun(session: ExecutionSession): CoreFlowRun {
  const result = session.result
  return {
    id: session.executionRequestId ?? 'Not started',
    status: session.status === 'pending' ? 'RUNNING' : result ? 'FINISHED' : 'CREATED',
    outcome: result?.outcome ?? null,
    startedAt: session.startedAt,
    cancelRequested: session.cancelRequested,
    tests:
      result?.verificationResults?.map((test, index) => ({
        id: `verification-${index + 1}`,
        label: test.argv.join(' '),
        status: test.exitCode === 0 && !test.timedOut && !test.cancelled ? 'PASSED' : 'FAILED',
        detail:
          test.exitCode === 0
            ? test.stdout || 'Verification completed.'
            : test.stderr || 'Verification did not pass.'
      })) ?? [],
    result
  }
}

function buildArtifact(session: ExecutionSession, state: WorkspaceUiState): CoreFlowArtifact {
  const result = session.result
  return {
    id: session.executionRequestId
      ? `artifacts:${session.executionRequestId}`
      : 'No execution result',
    title: 'Execution artifacts',
    summary:
      result?.agentSummary ??
      result?.rejectionReason ??
      'Artifacts will appear after a completed execution dispatch.',
    changedFiles: result?.artifacts?.map((artifact) => artifact.fileName) ?? [],
    diffLines: result?.patch?.split('\n') ?? [],
    reviewStatus: session.reviewStatus,
    applicationStatus: 'NOT_APPLIED',
    activeTab: state.artifactTab
  }
}

export function createWorkspaceRenderState(
  workspace: ProjectStateView,
  ui: WorkspaceUiState,
  session: ExecutionSession
): WorkspaceRenderState {
  const nodes = buildNodeViews(workspace)
  const selectedNodeId =
    ui.selectedNodeId && nodes.some((node) => node.id === ui.selectedNodeId)
      ? ui.selectedNodeId
      : (nodes[0]?.id ?? '')
  const taskRecord =
    workspace.tasks.find((item) => item.id === ui.selectedTaskId) ?? workspace.tasks[0]
  const task = taskRecord
    ? buildTask(workspace, taskRecord)
    : {
        id: '',
        type: 'IMPLEMENT_CHANGE' as const,
        title: 'No task available',
        objective: '',
        nonGoals: [],
        targets: [],
        status: 'DRAFT' as const,
        criteria: [],
        acceptanceEvaluated: false as const,
        taskSpecVersionId: null
      }
  const contextItems = taskRecord ? buildCandidates(workspace, taskRecord, selectedNodeId) : []
  const requiredIds = contextItems.filter((item) => item.required).map((item) => item.id)
  const snapshotRecord = ui.contextSnapshotMode === 'draft' ? null : session.frozenSnapshot
  const selectedFromUi = ui.selectedContextItemIds.filter((id) =>
    contextItems.some((item) => item.id === id)
  )
  const selectedFromSnapshot = snapshotRecord
    ? snapshotRecord.items.flatMap((snapshotItem) => {
        const candidate = contextItems.find((item) => item.sourceRef === snapshotItem.sourceRef)
        return candidate ? [candidate.id] : []
      })
    : []
  const selectedBase =
    selectedFromUi.length > 0
      ? selectedFromUi
      : selectedFromSnapshot.length > 0
        ? selectedFromSnapshot
        : requiredIds
  const requiredIdSet = new Set(requiredIds)
  const selectedContextItemIds = [
    ...requiredIds,
    ...selectedBase.filter((id) => !requiredIdSet.has(id))
  ]
  const activeBaseline = workspace.activeBaseline
  const baseline = activeBaseline
    ? {
        id: activeBaseline.id,
        label: activeBaseline.name,
        sourceTaskId: task.id,
        revision: activeBaseline.repositoryRevisionId ?? 'No repository revision',
        status: activeBaseline.status
      }
    : null
  const snapshot: CoreFlowSnapshot = {
    id: snapshotRecord?.id ?? 'Draft snapshot',
    label: snapshotRecord ? `Frozen ${snapshotRecord.id}` : `Draft for ${task.title}`,
    status: snapshotRecord?.status ?? 'DRAFT',
    freshness: snapshotRecord?.freshness ?? 'CURRENT',
    revision: snapshotRecord?.expectedRepositoryRevisionId ?? 'Not resolved',
    tokenBudget: CONTEXT_TOKEN_BUDGET,
    frozenAt: snapshotRecord?.status === 'FROZEN' ? snapshotRecord.updatedAt : null,
    record: snapshotRecord
  }
  return {
    route: ui.route,
    project: {
      id: workspace.project.id,
      name: workspace.project.name,
      description: workspace.project.description ?? '',
      branch: 'main',
      activeBaseline: baseline?.label ?? 'No active baseline'
    },
    nodes,
    selectedNodeId,
    selectedTaskId: task.id,
    task,
    contextItems,
    selectedContextItemIds,
    snapshot,
    run: buildRun(session),
    priorRuns: [],
    artifact: buildArtifact(session, ui),
    baseline,
    notice: ui.notice
  }
}

export function getSelectedContextItems(
  state: Pick<WorkspaceRenderState, 'contextItems' | 'selectedContextItemIds'>
): readonly ContextCandidate[] {
  const byId = new Map(state.contextItems.map((item) => [item.id, item]))
  return state.selectedContextItemIds.flatMap((id) => {
    const item = byId.get(id)
    return item ? [item] : []
  })
}

export function getSelectedContextTokens(
  state: Pick<WorkspaceRenderState, 'contextItems' | 'selectedContextItemIds'>
): number {
  return getSelectedContextItems(state).reduce((total, item) => total + item.tokens, 0)
}

export function getFreezeBlockers(
  state: Pick<WorkspaceRenderState, 'contextItems' | 'selectedContextItemIds' | 'snapshot'>
): readonly string[] {
  const selectedTokens = getSelectedContextTokens(state)
  return selectedTokens > state.snapshot.tokenBudget
    ? [
        `Selected context uses ${selectedTokens.toLocaleString()} tokens, over the ${state.snapshot.tokenBudget.toLocaleString()} token budget.`
      ]
    : []
}
