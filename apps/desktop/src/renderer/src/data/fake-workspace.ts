import type {
  CommandErrorName,
  CommandOutput,
  CommandRequest,
  CommandResponse,
  WorkspaceCommand
} from '@canvas-agent/contracts'
import {
  createWorkspaceClient,
  type CommandTransport,
  type WorkspaceClient
} from '@/lib/workspace-client'
import type {
  AcceptanceEvaluationAggregate,
  ArtifactApplicationAggregate,
  BaselineCandidateAggregate,
  ContextSnapshotItemRecord,
  DispatchResult,
  NodeDraftRecord,
  ProjectRecord,
  ProjectStateView,
  RepositoryRevisionRecord,
  ResolvedContextItem,
  RunAggregateView,
  RunSummary,
  SnapshotFreezeResult
} from '@/lib/workspace-types'

interface FakeWorkspaceOptions {
  readonly projects?: readonly ProjectRecord[]
  readonly states?: readonly ProjectStateView[]
  readonly executionDelayMs?: number
  readonly repositoryFiles?: Record<string, string>
}

const defaultRepositoryFiles: Record<string, string> = {
  'README.md': '# MUSICDB Demo\n\nA fake pinned repository file used by the fake transport.\n'
}

const defaultProject: ProjectRecord = {
  id: 'project-musicdb',
  name: 'MUSICDB',
  description: 'Personal music library and recording-version workspace.',
  createdAt: '2026-08-06T08:00:00.000Z',
  updatedAt: '2026-08-06T09:10:00.000Z'
}

const projects = [defaultProject] satisfies CommandOutput<'project.list'>

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function createFakeWorkspaceState(
  project: ProjectRecord = defaultProject
): CommandOutput<'project.state'> {
  const prefix = slug(project.id)
  const projectId = project.id
  const taskId = `${prefix}-task-recording-version-notes`
  const baselineId = `${prefix}-baseline-1`
  const nodeIds = {
    goal: `${prefix}-node-goal-001`,
    requirement: `${prefix}-node-requirement-011`,
    constraint: `${prefix}-node-constraint-004`,
    design: `${prefix}-node-design-021`
  } as const
  const nodeVersions: ProjectStateView['nodeVersions'] = [
    {
      id: `${prefix}-node-version-goal-003`,
      nodeId: nodeIds.goal,
      sequence: 3,
      title: 'Reliable recording-version notes',
      body: 'Keep song-wide facts separate from notes tied to one recording version.',
      contentHash: '1'.repeat(64),
      createdAt: '2026-08-06T09:00:00.000Z'
    },
    {
      id: `${prefix}-node-version-requirement-002`,
      nodeId: nodeIds.requirement,
      sequence: 2,
      title: 'Separate note ownership',
      body: 'A note must identify whether it belongs to a song or a recording version.',
      contentHash: '2'.repeat(64),
      createdAt: '2026-08-06T09:01:00.000Z'
    },
    {
      id: `${prefix}-node-version-constraint-001`,
      nodeId: nodeIds.constraint,
      sequence: 1,
      title: 'Preserve existing song notes',
      body: 'The change cannot invalidate existing song-wide notes or their search results.',
      contentHash: '3'.repeat(64),
      createdAt: '2026-08-06T09:02:00.000Z'
    },
    {
      id: `${prefix}-node-version-design-004`,
      nodeId: nodeIds.design,
      sequence: 4,
      title: 'RecordingVersionNote relation',
      body: 'Add a typed relation from a note to one recording version without duplicating text.',
      contentHash: '4'.repeat(64),
      createdAt: '2026-08-06T09:03:00.000Z'
    }
  ]
  const nodes: ProjectStateView['nodes'] = [
    {
      id: nodeIds.goal,
      projectId,
      type: 'GOAL' as const,
      lifecycle: 'ACTIVE' as const,
      createdAt: '2026-08-06T08:10:00.000Z',
      updatedAt: '2026-08-06T09:00:00.000Z'
    },
    {
      id: nodeIds.requirement,
      projectId,
      type: 'REQUIREMENT' as const,
      lifecycle: 'ACTIVE' as const,
      createdAt: '2026-08-06T08:11:00.000Z',
      updatedAt: '2026-08-06T09:01:00.000Z'
    },
    {
      id: nodeIds.constraint,
      projectId,
      type: 'CONSTRAINT' as const,
      lifecycle: 'ACTIVE' as const,
      createdAt: '2026-08-06T08:12:00.000Z',
      updatedAt: '2026-08-06T09:02:00.000Z'
    },
    {
      id: nodeIds.design,
      projectId,
      type: 'DESIGN' as const,
      lifecycle: 'ACTIVE' as const,
      createdAt: '2026-08-06T08:13:00.000Z',
      updatedAt: '2026-08-06T09:03:00.000Z'
    }
  ]
  const nodeDrafts: ProjectStateView['nodeDrafts'] = nodes.map((node, index) => ({
    id: `${prefix}-draft-${index + 1}`,
    nodeId: node.id,
    title: nodeVersions[index]?.title ?? node.id,
    body: nodeVersions[index]?.body ?? '',
    revision: 5,
    updatedAt: '2026-08-06T09:04:00.000Z'
  }))
  const repositoryRevision: RepositoryRevisionRecord = {
    id: `${prefix}-revision-main-a`,
    baseCommit: 'a'.repeat(40),
    treeHash: 'b'.repeat(40),
    workingTreePatchHash: null,
    createdAt: '2026-08-06T09:04:30.000Z'
  }
  const taskSpec = {
    id: `${prefix}-task-spec-recording-version-notes-1`,
    taskId,
    sequence: 1,
    description: 'Separate song-wide notes from notes tied to a specific recording version.',
    scope:
      'Non-goals: No bulk migration of historic notes. No redesign of the music library search.',
    contentHash: '5'.repeat(64),
    createdAt: '2026-08-06T09:05:00.000Z'
  } satisfies ProjectStateView['taskSpecs'][number]['spec']
  const criteria = [
    'Song-wide notes remain readable',
    'Recording-version notes are addressable',
    'Existing note search remains compatible',
    'The relation is visible in the detail view',
    'Invalid ownership is rejected',
    'Migration is explicitly out of scope'
  ].map((description, position) => ({
    id: `${prefix}-criterion-${position + 1}`,
    taskSpecVersionId: taskSpec.id,
    position,
    description,
    verificationMethod: 'MANUAL_REVIEW' as const
  }))
  const targets = [nodeIds.requirement, nodeIds.design, nodeIds.requirement].map(
    (nodeId, position) => ({
      id: `${prefix}-target-${position + 1}`,
      taskSpecVersionId: taskSpec.id,
      nodeId,
      nodeVersionId: null,
      position
    })
  )
  const baseline = {
    id: baselineId,
    projectId,
    status: 'ACTIVE' as const,
    name: 'Baseline 1.0',
    description: 'Current MUSICDB project anchor.',
    repositoryRevisionId: repositoryRevision.id,
    activatedAt: '2026-08-06T09:06:00.000Z',
    supersededAt: null,
    createdAt: '2026-08-06T09:06:00.000Z',
    updatedAt: '2026-08-06T09:06:00.000Z'
  } satisfies ProjectStateView['activeBaseline'] & object
  const state = {
    project,
    nodes,
    nodeDrafts,
    nodeVersions,
    edges: [
      {
        id: `${prefix}-edge-goal-requirement`,
        projectId,
        sourceNodeId: nodeIds.goal,
        targetNodeId: nodeIds.requirement,
        type: 'PARENT_OF' as const,
        status: 'ACTIVE' as const,
        anchoredNodeVersionId: nodeVersions[1].id,
        note: null,
        createdAt: '2026-08-06T08:20:00.000Z',
        updatedAt: '2026-08-06T09:00:00.000Z'
      },
      {
        id: `${prefix}-edge-requirement-constraint`,
        projectId,
        sourceNodeId: nodeIds.requirement,
        targetNodeId: nodeIds.constraint,
        type: 'CONSTRAINS' as const,
        status: 'ACTIVE' as const,
        anchoredNodeVersionId: nodeVersions[2].id,
        note: null,
        createdAt: '2026-08-06T08:21:00.000Z',
        updatedAt: '2026-08-06T09:01:00.000Z'
      },
      {
        id: `${prefix}-edge-requirement-design`,
        projectId,
        sourceNodeId: nodeIds.requirement,
        targetNodeId: nodeIds.design,
        type: 'IMPLEMENTS' as const,
        status: 'ACTIVE' as const,
        anchoredNodeVersionId: nodeVersions[3].id,
        note: null,
        createdAt: '2026-08-06T08:22:00.000Z',
        updatedAt: '2026-08-06T09:02:00.000Z'
      }
    ],
    tasks: [
      {
        id: taskId,
        projectId,
        type: 'IMPLEMENT_CHANGE' as const,
        status: 'IN_PROGRESS' as const,
        title: 'Add recording-version notes',
        createdAt: '2026-08-06T09:05:30.000Z',
        updatedAt: '2026-08-06T09:05:30.000Z'
      }
    ],
    taskSpecs: [
      {
        spec: taskSpec,
        criteria,
        targets
      }
    ],
    baselines: [
      {
        baseline,
        items: nodeVersions.map((version, position) => ({
          id: `${prefix}-baseline-item-${position + 1}`,
          baselineId,
          nodeVersionId: version.id,
          position
        }))
      }
    ],
    activeBaseline: baseline
  } satisfies CommandOutput<'project.state'>

  return state
}

function response<C extends WorkspaceCommand>(
  request: CommandRequest<C>,
  data: CommandOutput<C>
): CommandResponse<C> {
  return {
    requestId: request.requestId,
    schemaVersion: 1,
    command: request.command as C,
    ok: true,
    data
  }
}

function failure<C extends WorkspaceCommand>(
  request: CommandRequest<C>,
  name: CommandErrorName,
  message: string,
  details?: Record<string, unknown>
): CommandResponse<C> {
  return {
    requestId: request.requestId,
    schemaVersion: 1,
    command: request.command as C,
    ok: false,
    error: { name, message, details }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function createFakeWorkspaceClient(options: FakeWorkspaceOptions = {}): WorkspaceClient {
  const availableProjects = [...(options.projects ?? projects)]
  const stateByProject = new Map(
    (options.states ?? availableProjects.map((project) => createFakeWorkspaceState(project))).map(
      (state) => [state.project.id, clone(state)] as const
    )
  )
  const revisionByProject = new Map<string, RepositoryRevisionRecord>()
  for (const state of stateByProject.values()) {
    revisionByProject.set(state.project.id, {
      id: `${slug(state.project.id)}-revision-main-a`,
      baseCommit: 'a'.repeat(40),
      treeHash: 'b'.repeat(40),
      workingTreePatchHash: null,
      createdAt: '2026-08-06T09:04:30.000Z'
    })
  }
  const snapshotsByProject = new Map<string, SnapshotFreezeResult[]>()
  for (const state of stateByProject.values()) snapshotsByProject.set(state.project.id, [])
  const cancelledRequests = new Set<string>()
  const executionDelayMs = options.executionDelayMs ?? 250
  const repositoryFiles = { ...defaultRepositoryFiles, ...(options.repositoryFiles ?? {}) }
  const runsByProject = new Map<string, RunSummary[]>()
  const runAggregates = new Map<string, RunAggregateView>()
  const acceptanceByTask = new Map<string, AcceptanceEvaluationAggregate[]>()
  const taskStatus = new Map<string, string>()
  const applicationsByTask = new Map<string, ArtifactApplicationAggregate[]>()
  const candidatesByApplication = new Map<string, BaselineCandidateAggregate>()
  let runCounter = 0

  function recordRun(
    projectId: string,
    contextSnapshotId: string,
    executionRequestId: string,
    result: DispatchResult
  ): RunSummary {
    runCounter += 1
    const runId = `run-${runCounter}`
    const now = new Date().toISOString()
    const outcome =
      result.outcome === 'SUCCEEDED'
        ? 'SUCCEEDED'
        : result.outcome === 'CANCELLED'
          ? 'CANCELLED'
          : result.outcome === 'PARTIAL'
            ? 'PARTIAL'
            : 'FAILED'
    const summary: RunSummary = {
      id: runId,
      projectId,
      taskId: 'task-1',
      taskSpecVersionId: 'spec-1',
      contextSnapshotId,
      repositoryRevisionId: 'rev-1',
      status: 'FINISHED',
      outcome,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now
    }
    const aggregate: RunAggregateView = {
      run: summary,
      executionRequests: [
        {
          executionRequestId,
          runId,
          workerAttemptNumber: 1,
          checkpointId: null,
          requestHash: 'f'.repeat(64),
          schemaVersion: 1,
          requestJson: '{"executionRequestId":"' + executionRequestId + '"}',
          dispatchOutcome: result.outcome,
          claimGranted: result.claimGranted,
          rejectionReason: result.rejectionReason ?? null,
          revisionMismatchField: null,
          revisionMismatchExpected: null,
          revisionMismatchActual: null,
          patchHash: result.patchHash ?? null,
          timedOut: null,
          recoveryJson: null,
          dispatchedAt: now,
          completedAt: now
        }
      ],
      events: [
        {
          id: `event-${runCounter}-0`,
          runId,
          sequence: 0,
          kind: 'DISPATCHED',
          detail: JSON.stringify({ executionRequestId }),
          createdAt: now
        },
        {
          id: `event-${runCounter}-1`,
          runId,
          sequence: 1,
          kind: 'FINISHED',
          detail: JSON.stringify({ dispatchOutcome: result.outcome, runOutcome: outcome }),
          createdAt: now
        }
      ],
      artifacts: (result.artifacts ?? []).map((artifact, position) => ({
        id: `artifact-${runCounter}-${position}`,
        runId,
        executionRequestId,
        kind: artifact.kind,
        fileName: artifact.fileName,
        contentHash: artifact.contentHash,
        sizeBytes: artifact.sizeBytes,
        content: result.patch ?? '',
        position,
        createdAt: now
      }))
    }
    runsByProject.set(projectId, [summary, ...(runsByProject.get(projectId) ?? [])])
    runAggregates.set(runId, aggregate)
    return summary
  }

  const transport: CommandTransport = {
    async command(request) {
      switch (request.command) {
        case 'project.list':
          return response(request, clone(availableProjects))
        case 'project.state': {
          const state = stateByProject.get(request.payload.projectId)
          return state
            ? response(request, clone(state))
            : failure(request, 'NotFoundError', `Cannot find Project ${request.payload.projectId}`)
        }
        case 'revision.current': {
          const revision = revisionByProject.values().next().value
          return revision
            ? response(request, clone(revision))
            : failure(request, 'NotFoundError', 'Cannot resolve a repository revision')
        }
        case 'nodeDraft.upsert': {
          const input = request.payload
          const state = [...stateByProject.values()].find((candidate) =>
            candidate.nodes.some((node) => node.id === input.nodeId)
          )
          const existing = state?.nodeDrafts.find((draft) => draft.nodeId === input.nodeId)
          if (!state) {
            return failure(request, 'NotFoundError', `Cannot find NodeDraft ${input.nodeId}`)
          }
          if (
            existing &&
            input.expectedRevision !== undefined &&
            input.expectedRevision !== existing.revision
          ) {
            return failure(
              request,
              'ConcurrencyError',
              `Concurrent modification of NodeDraft ${existing.id}`,
              {
                serverRevision: existing.revision,
                serverValue: { title: existing.title, body: existing.body }
              }
            )
          }
          const updated: NodeDraftRecord = {
            id: existing?.id ?? `draft-${input.nodeId}`,
            nodeId: input.nodeId,
            title: input.title,
            body: input.body ?? existing?.body ?? '',
            revision: (existing?.revision ?? 0) + 1,
            updatedAt: new Date().toISOString()
          }
          stateByProject.set(state.project.id, {
            ...state,
            nodeDrafts: existing
              ? state.nodeDrafts.map((draft) => (draft.nodeId === input.nodeId ? updated : draft))
              : [...state.nodeDrafts, updated]
          })
          return response(request, clone(updated))
        }
        case 'snapshot.freeze': {
          const input = request.payload
          const state = stateByProject.get(input.projectId)
          if (!state) {
            return failure(request, 'NotFoundError', `Cannot find Project ${input.projectId}`)
          }
          const taskSpecAggregate = state.taskSpecs.find(
            (aggregate) => aggregate.spec.id === input.taskSpecVersionId
          )
          if (!taskSpecAggregate) {
            return failure(
              request,
              'NotFoundError',
              `Cannot find TaskSpecVersion ${input.taskSpecVersionId}`
            )
          }
          const spec = taskSpecAggregate.spec
          const taskSpecContent = [
            spec.description,
            spec.scope,
            ...taskSpecAggregate.criteria.map((criterion) => criterion.description)
          ].join('\n')
          const materialized: Array<{
            itemType: 'USER_INPUT' | 'NODE_VERSION' | 'REPOSITORY_CONTENT'
            sourceRef: string
            resolvedContent: string
            authority: 'TASK_INSTRUCTION' | 'PROJECT_FACT' | 'REFERENCE'
            priority: 'P0' | 'P1' | 'P2'
            tokenEstimate: number
            selectionReason: string | null
          }> = [
            {
              itemType: 'USER_INPUT' as const,
              sourceRef: `task-spec://${spec.id}`,
              resolvedContent: taskSpecContent,
              authority: 'TASK_INSTRUCTION' as const,
              priority: 'P0' as const,
              tokenEstimate: Math.max(1, Math.ceil(taskSpecContent.length / 4)),
              selectionReason: null
            }
          ]
          for (const selection of input.selections) {
            const ref = selection.source
            if (ref.kind === 'REPOSITORY_CONTENT') {
              const content = repositoryFiles[ref.path]
              if (content === undefined) {
                return failure(request, 'NotFoundError', `Cannot find repository file ${ref.path}`)
              }
              materialized.push({
                itemType: 'REPOSITORY_CONTENT' as const,
                sourceRef: `repo://${ref.path}`,
                resolvedContent: content,
                authority: 'REFERENCE' as const,
                priority: 'P2' as const,
                tokenEstimate: Math.max(1, Math.ceil(content.length / 4)),
                selectionReason: selection.selectionReason ?? null
              })
              continue
            }
            const version = state.nodeVersions.find(
              (candidate) => candidate.id === ref.nodeVersionId
            )
            if (version === undefined) {
              return failure(
                request,
                'NotFoundError',
                `Cannot find NodeVersion ${ref.nodeVersionId}`
              )
            }
            const content = `${version.title}\n\n${version.body}`
            materialized.push({
              itemType: 'NODE_VERSION' as const,
              sourceRef: `node://${version.id}`,
              resolvedContent: content,
              authority: 'PROJECT_FACT' as const,
              priority: 'P1' as const,
              tokenEstimate: Math.max(1, Math.ceil(content.length / 4)),
              selectionReason: selection.selectionReason ?? null
            })
          }
          const snapshots = snapshotsByProject.get(input.projectId) ?? []
          const id = `snapshot-${snapshots.length + 1}`
          const now = new Date().toISOString()
          const items: ContextSnapshotItemRecord[] = materialized.map((item, position) => ({
            id: `${id}-item-${position + 1}`,
            contextSnapshotId: id,
            position,
            itemType: item.itemType,
            sourceRef: item.sourceRef,
            resolvedContent: item.resolvedContent,
            contentHash: '6'.repeat(64),
            selectionReason: item.selectionReason,
            authority: item.authority,
            priority: item.priority,
            tokenEstimate: item.tokenEstimate,
            blobId: null
          }))
          const result: SnapshotFreezeResult = {
            snapshot: {
              id,
              projectId: input.projectId,
              taskId: input.taskId,
              taskSpecVersionId: input.taskSpecVersionId,
              baseBaselineId: input.baseBaselineId,
              expectedRepositoryRevisionId: input.expectedRepositoryRevisionId,
              status: 'FROZEN',
              freshness: 'CURRENT',
              createdAt: now,
              updatedAt: now
            },
            items
          }
          snapshots.push(result)
          snapshotsByProject.set(input.projectId, snapshots)
          return response(request, clone(result))
        }
        case 'execution.cancel': {
          cancelledRequests.add(request.payload.executionRequestId)
          return response(request, { cancelled: true })
        }
        case 'execution.dispatch': {
          const input = request.payload
          await delay(executionDelayMs)
          const result: DispatchResult = cancelledRequests.has(input.executionRequestId)
            ? { outcome: 'CANCELLED', claimGranted: true, artifacts: [] }
            : {
                outcome: 'SUCCEEDED',
                claimGranted: true,
                patch: `diff --git a/src/notes.ts b/src/notes.ts\n+recordingVersionId: string`,
                patchHash: '7'.repeat(64),
                verificationResults: [
                  {
                    argv: ['pnpm', 'test'],
                    exitCode: 0,
                    signal: null,
                    stdout: '6 tests passed',
                    stderr: '',
                    timedOut: false,
                    cancelled: false,
                    outputTruncated: false,
                    durationMs: 42
                  }
                ],
                artifacts: [
                  {
                    kind: 'PATCH',
                    fileName: 'patch.diff',
                    contentHash: '7'.repeat(64),
                    sizeBytes: 76
                  }
                ],
                agentSummary: `Execution completed for ContextSnapshot ${input.contextSnapshotId}.`
              }
          const run = recordRun(
            [...snapshotsByProject.entries()].find(([, snaps]) =>
              snaps.some((snapshot) => snapshot.snapshot.id === input.contextSnapshotId)
            )?.[0] ??
              availableProjects[0]?.id ??
              'project-musicdb',
            input.contextSnapshotId,
            input.executionRequestId,
            result
          )
          return response(request, {
            runId: run.id,
            executionRequestId: input.executionRequestId,
            result
          })
        }
        case 'run.list': {
          const input = request.payload
          return response(request, clone(runsByProject.get(input.projectId) ?? []))
        }
        case 'run.get': {
          const input = request.payload
          const aggregate = runAggregates.get(input.runId)
          if (!aggregate) {
            return failure(request, 'NotFoundError', `Cannot find Run ${input.runId}`)
          }
          return response(request, clone(aggregate))
        }
        case 'acceptance.evaluate': {
          const input = request.payload
          const state = stateByProject.get(input.projectId)
          if (!state) {
            return failure(request, 'NotFoundError', `Cannot find Project ${input.projectId}`)
          }
          const specAggregate = state.taskSpecs.find(
            (aggregate) => aggregate.spec.id === input.taskSpecVersionId
          )
          if (!specAggregate) {
            return failure(
              request,
              'NotFoundError',
              `Cannot find TaskSpecVersion ${input.taskSpecVersionId}`
            )
          }
          const authoritativeIds = specAggregate.criteria.map((criterion) => criterion.id)
          const submittedIds = input.criteria.map((criterion) => criterion.criterionId)
          const uniqueSubmitted = new Set(submittedIds)
          if (
            uniqueSubmitted.size !== authoritativeIds.length ||
            !authoritativeIds.every((id) => uniqueSubmitted.has(id))
          ) {
            return failure(
              request,
              'ValidationError',
              'acceptance criteria must exactly match the TaskSpecVersion'
            )
          }
          const run = runAggregates.get(input.runId)
          if (!run || run.run.status !== 'FINISHED') {
            return failure(request, 'ValidationError', 'Run is not FINISHED')
          }
          const allPassed = input.criteria.every((criterion) => criterion.verdict === 'PASSED')
          const usable = ['SUCCEEDED', 'PARTIAL', 'TIMED_OUT'].includes(run.run.outcome ?? '')
          const status = allPassed && usable ? 'PASSED' : 'FAILED'
          const evaluations = acceptanceByTask.get(input.taskId) ?? []
          const sequence = evaluations.length
          const id = `evaluation-${sequence + 1}`
          const createdAt = new Date().toISOString()
          const evaluation: AcceptanceEvaluationAggregate['evaluation'] = {
            id,
            projectId: input.projectId,
            taskId: input.taskId,
            taskSpecVersionId: input.taskSpecVersionId,
            runId: input.runId,
            sequence,
            status,
            createdAt
          }
          const items: AcceptanceEvaluationAggregate['items'] = input.criteria.map(
            (criterion, index) => {
              const authoritative = specAggregate.criteria.find(
                (candidate) => candidate.id === criterion.criterionId
              )
              return {
                id: `item-${id}-${index}`,
                evaluationId: id,
                criterionId: criterion.criterionId,
                verdict: criterion.verdict,
                note: criterion.note ?? null,
                position: authoritative?.position ?? index
              }
            }
          )
          const aggregate: AcceptanceEvaluationAggregate = { evaluation, items }
          acceptanceByTask.set(input.taskId, [...evaluations, aggregate])
          taskStatus.set(input.taskId, 'WAITING_REVIEW')
          return response(request, clone(aggregate))
        }
        case 'acceptance.list': {
          const input = request.payload
          return response(request, clone(acceptanceByTask.get(input.taskId) ?? []))
        }
        case 'task.complete': {
          const input = request.payload
          const evaluations = acceptanceByTask.get(input.taskId) ?? []
          const latest = evaluations[evaluations.length - 1]
          if (!latest || latest.evaluation.id !== input.evaluationId) {
            return failure(
              request,
              'ValidationError',
              'task completion requires the latest evaluation'
            )
          }
          if (latest.evaluation.status !== 'PASSED') {
            return failure(
              request,
              'ValidationError',
              'task completion requires a PASSED evaluation'
            )
          }
          taskStatus.set(input.taskId, 'COMPLETED')
          return response(request, {
            id: input.taskId,
            projectId: 'project-musicdb',
            type: 'IMPLEMENT_CHANGE',
            status: 'COMPLETED',
            title: 'Task',
            createdAt: latest.evaluation.createdAt,
            updatedAt: new Date().toISOString()
          })
        }
        case 'artifact.apply': {
          const input = request.payload
          const state = stateByProject.get('project-musicdb')
          const evaluations = acceptanceByTask.get(input.taskId) ?? []
          const latest = evaluations[evaluations.length - 1]
          if (!latest || latest.evaluation.id !== input.evaluationId) {
            return failure(
              request,
              'ValidationError',
              'adoption requires the latest PASSED evaluation'
            )
          }
          if (latest.evaluation.status !== 'PASSED') {
            return failure(request, 'ValidationError', 'adoption requires a PASSED evaluation')
          }
          const run = runAggregates.get(latest.evaluation.runId)
          const artifact = run?.artifacts.find((item) => item.id === input.artifactId)
          if (!run || !artifact || artifact.kind !== 'PATCH') {
            return failure(request, 'NotFoundError', 'Cannot find the PATCH artifact')
          }
          const applications = applicationsByTask.get(input.taskId) ?? []
          if (applications.length > 0) {
            return response(request, clone(applications[0]))
          }
          const id = `application-${applications.length + 1}`
          const now = new Date().toISOString()
          const aggregate: ArtifactApplicationAggregate = {
            application: {
              id,
              projectId: state?.project.id ?? 'project-musicdb',
              taskId: input.taskId,
              evaluationId: latest.evaluation.id,
              runId: latest.evaluation.runId,
              executionRequestId: 'exec-1',
              artifactId: artifact.id,
              baseBaselineId: 'baseline-1',
              baseRepositoryRevisionId: 'rev-1',
              patchHash: artifact.contentHash,
              authorizedAt: now
            },
            events: [
              {
                id: `${id}-evt-0`,
                applicationId: id,
                sequence: 0,
                kind: 'AUTHORIZED',
                repositoryRevisionId: null,
                reasonCode: null,
                detail: null,
                createdAt: now
              },
              {
                id: `${id}-evt-1`,
                applicationId: id,
                sequence: 1,
                kind: 'APPLYING',
                repositoryRevisionId: null,
                reasonCode: null,
                detail: null,
                createdAt: now
              },
              {
                id: `${id}-evt-2`,
                applicationId: id,
                sequence: 2,
                kind: 'APPLIED',
                repositoryRevisionId: 'rev-2',
                reasonCode: null,
                detail: null,
                createdAt: now
              }
            ],
            effectiveStatus: 'APPLIED',
            repositoryRevision: {
              id: 'rev-2',
              baseCommit: 'c'.repeat(40),
              treeHash: 'd'.repeat(40),
              workingTreePatchHash: null,
              createdAt: now
            }
          }
          applicationsByTask.set(input.taskId, [...applications, aggregate])
          return response(request, clone(aggregate))
        }
        case 'artifactApplication.list': {
          const input = request.payload
          return response(request, clone(applicationsByTask.get(input.taskId) ?? []))
        }
        case 'baseline.createCandidateFromTask': {
          const input = request.payload
          const existing = candidatesByApplication.get(input.applicationId)
          if (existing) {
            return response(request, clone(existing))
          }
          const application = (applicationsByTask.get('task-1') ??
            applicationsByTask.get('task_demo_1') ??
            [])[0]
          if (!application || application.effectiveStatus !== 'APPLIED') {
            return failure(
              request,
              'ValidationError',
              'baseline candidate requires an APPLIED application'
            )
          }
          const baseline = {
            id: 'baseline-2',
            projectId: application.application.projectId,
            status: 'DRAFT' as const,
            name: input.name,
            description: input.description ?? null,
            repositoryRevisionId: 'rev-2',
            activatedAt: null,
            supersededAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
          const aggregate: BaselineCandidateAggregate = {
            baseline,
            source: {
              baselineId: baseline.id,
              parentBaselineId: application.application.baseBaselineId,
              taskId: application.application.taskId,
              artifactApplicationId: application.application.id
            },
            items: []
          }
          candidatesByApplication.set(input.applicationId, aggregate)
          return response(request, clone(aggregate))
        }
        case 'context.resolve': {
          const input = request.payload
          const state = stateByProject.get(input.projectId)
          if (!state) {
            return failure(request, 'NotFoundError', `Cannot find Project ${input.projectId}`)
          }
          const items: ResolvedContextItem[] = []
          for (const ref of input.selections) {
            if (ref.kind === 'TASK_SPEC_VERSION') {
              if (ref.taskSpecVersionId !== input.taskSpecVersionId) {
                return failure(request, 'ValidationError', 'task_spec_binding_mismatch')
              }
              const aggregate = state.taskSpecs.find(
                (candidate) => candidate.spec.id === ref.taskSpecVersionId
              )
              if (!aggregate) {
                return failure(
                  request,
                  'NotFoundError',
                  `Cannot find TaskSpecVersion ${ref.taskSpecVersionId}`
                )
              }
              const content = [
                aggregate.spec.description,
                aggregate.spec.scope,
                ...aggregate.criteria.map((criterion) => criterion.description)
              ].join('\n')
              items.push({
                itemType: 'USER_INPUT',
                sourceRef: `task-spec://${aggregate.spec.id}`,
                resolvedContent: content,
                contentHash: '8'.repeat(64),
                authority: 'TASK_INSTRUCTION',
                priority: 'P0',
                tokenEstimate: Math.max(1, Math.ceil(content.length / 4))
              })
              continue
            }
            if (ref.kind === 'REPOSITORY_CONTENT') {
              const content = repositoryFiles[ref.path]
              if (content === undefined) {
                return failure(request, 'NotFoundError', `Cannot find repository file ${ref.path}`)
              }
              items.push({
                itemType: 'REPOSITORY_CONTENT',
                sourceRef: `repo://${ref.path}`,
                resolvedContent: content,
                contentHash: '9'.repeat(64),
                authority: 'REFERENCE',
                priority: 'P2',
                tokenEstimate: Math.max(1, Math.ceil(content.length / 4))
              })
              continue
            }
            const version = state.nodeVersions.find(
              (candidate) => candidate.id === ref.nodeVersionId
            )
            if (version === undefined) {
              return failure(
                request,
                'NotFoundError',
                `Cannot find NodeVersion ${ref.nodeVersionId}`
              )
            }
            const content = `${version.title}\n\n${version.body}`
            items.push({
              itemType: 'NODE_VERSION',
              sourceRef: `node://${version.id}`,
              resolvedContent: content,
              contentHash: 'a'.repeat(64),
              authority: 'PROJECT_FACT',
              priority: 'P1',
              tokenEstimate: Math.max(1, Math.ceil(content.length / 4))
            })
          }
          return response(request, { items })
        }
        default:
          return failure(
            request,
            'InternalError',
            `Fake transport does not implement ${request.command}`
          )
      }
    }
  }

  return createWorkspaceClient(transport)
}
