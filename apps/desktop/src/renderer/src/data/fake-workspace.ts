import type {
  CommandRequest,
  CommandResponse,
  WorkspaceClient,
  WorkspaceCommand
} from '@/lib/workspace-client'
import { createWorkspaceClient } from '@/lib/workspace-client'
import type {
  ContextSnapshotRecord,
  DispatchResult,
  NodeDraftRecord,
  ProjectRecord,
  ProjectStateView,
  RepositoryRevisionRecord
} from '@/lib/workspace-types'

interface FakeWorkspaceOptions {
  readonly projects?: readonly ProjectRecord[]
  readonly states?: readonly ProjectStateView[]
  readonly executionDelayMs?: number
}

const projectId = 'project-musicdb'
const taskId = 'task-recording-version-notes'
const baselineId = 'baseline-musicdb-1'

const projects: readonly ProjectRecord[] = [
  {
    id: projectId,
    name: 'MUSICDB',
    description: 'Personal music library and recording-version workspace.',
    branch: 'main'
  }
]

const nodes = [
  {
    id: 'node-goal-001',
    projectId,
    type: 'GOAL' as const,
    lifecycle: 'ACTIVE' as const
  },
  {
    id: 'node-requirement-011',
    projectId,
    type: 'REQUIREMENT' as const,
    lifecycle: 'ACTIVE' as const
  },
  {
    id: 'node-constraint-004',
    projectId,
    type: 'CONSTRAINT' as const,
    lifecycle: 'ACTIVE' as const
  },
  {
    id: 'node-design-021',
    projectId,
    type: 'DESIGN' as const,
    lifecycle: 'ACTIVE' as const
  }
]

const nodeVersions = [
  {
    id: 'node-version-goal-003',
    nodeId: 'node-goal-001',
    sequence: 3,
    title: 'Reliable recording-version notes',
    body: 'Keep song-wide facts separate from notes tied to one recording version.',
    contentHash: '1'.repeat(64),
    createdAt: '2026-08-06T09:00:00.000Z'
  },
  {
    id: 'node-version-requirement-002',
    nodeId: 'node-requirement-011',
    sequence: 2,
    title: 'Separate note ownership',
    body: 'A note must identify whether it belongs to a song or a recording version.',
    contentHash: '2'.repeat(64),
    createdAt: '2026-08-06T09:01:00.000Z'
  },
  {
    id: 'node-version-constraint-001',
    nodeId: 'node-constraint-004',
    sequence: 1,
    title: 'Preserve existing song notes',
    body: 'The change cannot invalidate existing song-wide notes or their search results.',
    contentHash: '3'.repeat(64),
    createdAt: '2026-08-06T09:02:00.000Z'
  },
  {
    id: 'node-version-design-004',
    nodeId: 'node-design-021',
    sequence: 4,
    title: 'RecordingVersionNote relation',
    body: 'Add a typed relation from a note to one recording version without duplicating text.',
    contentHash: '4'.repeat(64),
    createdAt: '2026-08-06T09:03:00.000Z'
  }
] as const

const initialDrafts: readonly NodeDraftRecord[] = nodes.map((node, index) => ({
  id: `draft-${node.id}`,
  nodeId: node.id,
  title: nodeVersions[index]?.title ?? node.id,
  body: nodeVersions[index]?.body ?? '',
  revision: 5,
  updatedAt: '2026-08-06T09:04:00.000Z'
}))

const repositoryRevision: RepositoryRevisionRecord = {
  id: 'revision-main-a',
  baseCommit: 'a'.repeat(40),
  treeHash: 'b'.repeat(40),
  workingTreePatchHash: null
}

export function createFakeWorkspaceState(): ProjectStateView {
  const taskSpecVersion = {
    id: 'task-spec-recording-version-notes-1',
    taskId,
    sequence: 1,
    description: 'Separate song-wide notes from notes tied to a specific recording version.',
    scope:
      'Non-goals: No bulk migration of historic notes. No redesign of the music library search.',
    contentHash: '5'.repeat(64),
    createdAt: '2026-08-06T09:05:00.000Z'
  }

  return {
    project: projects[0],
    nodes,
    nodeDrafts: [...initialDrafts],
    nodeVersions,
    edges: [
      {
        id: 'edge-goal-requirement',
        projectId,
        sourceNodeId: 'node-goal-001',
        targetNodeId: 'node-requirement-011',
        type: 'PARENT_OF',
        status: 'ACTIVE',
        anchoredNodeVersionId: 'node-version-requirement-002',
        note: null
      },
      {
        id: 'edge-requirement-constraint',
        projectId,
        sourceNodeId: 'node-requirement-011',
        targetNodeId: 'node-constraint-004',
        type: 'CONSTRAINS',
        status: 'ACTIVE',
        anchoredNodeVersionId: 'node-version-constraint-001',
        note: null
      },
      {
        id: 'edge-requirement-design',
        projectId,
        sourceNodeId: 'node-requirement-011',
        targetNodeId: 'node-design-021',
        type: 'IMPLEMENTS',
        status: 'ACTIVE',
        anchoredNodeVersionId: 'node-version-design-004',
        note: null
      }
    ],
    tasks: [
      {
        task: {
          id: taskId,
          projectId,
          type: 'IMPLEMENT_CHANGE',
          status: 'IN_PROGRESS',
          title: 'Add recording-version notes'
        },
        specs: [
          {
            version: taskSpecVersion,
            criteria: [
              'Song-wide notes remain readable',
              'Recording-version notes are addressable',
              'Existing note search remains compatible',
              'The relation is visible in the detail view',
              'Invalid ownership is rejected',
              'Migration is explicitly out of scope'
            ].map((description, position) => ({
              id: `criterion-${position + 1}`,
              taskSpecVersionId: taskSpecVersion.id,
              position,
              description,
              verificationMethod: 'MANUAL_REVIEW'
            })),
            targets: ['Note model', 'Recording version detail view', 'Acceptance test suite'].map(
              (_, position) => ({
                id: `target-${position + 1}`,
                taskSpecVersionId: taskSpecVersion.id,
                nodeId:
                  ['node-requirement-011', 'node-design-021', 'node-requirement-011'][position] ??
                  null,
                nodeVersionId: null,
                position
              })
            )
          }
        ]
      }
    ],
    baselines: [
      {
        baseline: {
          id: baselineId,
          projectId,
          status: 'ACTIVE',
          name: 'Baseline 1.0',
          description: 'Current MUSICDB project anchor.',
          repositoryRevisionId: repositoryRevision.id
        },
        items: nodeVersions.map((version, position) => ({
          id: `baseline-item-${position + 1}`,
          baselineId,
          nodeVersionId: version.id,
          position
        }))
      }
    ],
    repositoryRevision,
    contextSnapshots: []
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function response<C extends WorkspaceCommand>(
  request: CommandRequest<C>,
  data: unknown
): CommandResponse<C> {
  return { requestId: request.requestId, command: request.command, ok: true, data }
}

function failure<C extends WorkspaceCommand>(
  request: CommandRequest<C>,
  code: string,
  message: string,
  details?: unknown
): CommandResponse<C> {
  return {
    requestId: request.requestId,
    command: request.command,
    ok: false,
    error: { code, message, details }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function createFakeWorkspaceClient(options: FakeWorkspaceOptions = {}): WorkspaceClient {
  const availableProjects = [...(options.projects ?? projects)]
  const stateByProject = new Map(
    (options.states ?? availableProjects.map(() => createFakeWorkspaceState())).map((state) => [
      state.project.id,
      clone(state)
    ])
  )
  const cancelledRequests = new Set<string>()
  const executionDelayMs = options.executionDelayMs ?? 250

  const transport = {
    async command(request: CommandRequest): Promise<unknown> {
      switch (request.command) {
        case 'project.list':
          return response(request, clone(availableProjects))
        case 'project.state': {
          const projectId = (request.payload as { readonly projectId: string }).projectId
          const state = stateByProject.get(projectId)
          return state
            ? response(request, clone(state))
            : failure(request, 'NotFoundError', `Cannot find Project ${projectId}`)
        }
        case 'revision.current': {
          const state = stateByProject.values().next().value as ProjectStateView | undefined
          return response(request, clone(state?.repositoryRevision ?? repositoryRevision))
        }
        case 'nodeDraft.upsert': {
          const input = request.payload as {
            readonly nodeId: string
            readonly title: string
            readonly body: string
            readonly expectedRevision?: number
          }
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
            body: input.body,
            revision: (existing?.revision ?? 0) + 1,
            updatedAt: new Date().toISOString()
          }
          const nextState: ProjectStateView = {
            ...state,
            nodeDrafts: existing
              ? state.nodeDrafts.map((draft) => (draft.nodeId === input.nodeId ? updated : draft))
              : [...state.nodeDrafts, updated]
          }
          stateByProject.set(state.project.id, nextState)
          return response(request, clone(updated))
        }
        case 'snapshot.freeze': {
          const input = request.payload as {
            readonly projectId: string
            readonly taskId: string
            readonly taskSpecVersionId: string
            readonly baseBaselineId: string
            readonly expectedRepositoryRevisionId: string
            readonly items: readonly {
              readonly itemType: ContextSnapshotRecord['items'][number]['itemType']
              readonly sourceRef: string
              readonly resolvedContent: string
              readonly authority: ContextSnapshotRecord['items'][number]['authority']
              readonly priority: ContextSnapshotRecord['items'][number]['priority']
              readonly tokenEstimate: number
              readonly selectionReason?: string
            }[]
          }
          const state = stateByProject.get(input.projectId)
          if (!state)
            return failure(request, 'NotFoundError', `Cannot find Project ${input.projectId}`)
          const id = `snapshot-${state.contextSnapshots.length + 1}`
          const now = new Date().toISOString()
          const snapshot: ContextSnapshotRecord = {
            id,
            projectId: input.projectId,
            taskId: input.taskId,
            taskSpecVersionId: input.taskSpecVersionId,
            baseBaselineId: input.baseBaselineId,
            expectedRepositoryRevisionId: input.expectedRepositoryRevisionId,
            status: 'FROZEN',
            freshness: 'CURRENT',
            createdAt: now,
            updatedAt: now,
            items: input.items.map((item, position) => ({
              id: `${id}-item-${position + 1}`,
              contextSnapshotId: id,
              position,
              itemType: item.itemType,
              sourceRef: item.sourceRef,
              resolvedContent: item.resolvedContent,
              contentHash: '6'.repeat(64),
              selectionReason: item.selectionReason ?? null,
              authority: item.authority,
              priority: item.priority,
              tokenEstimate: item.tokenEstimate
            }))
          }
          stateByProject.set(state.project.id, {
            ...state,
            contextSnapshots: [...state.contextSnapshots, snapshot]
          })
          return response(request, clone(snapshot))
        }
        case 'execution.cancel': {
          const input = request.payload as { readonly executionRequestId: string }
          cancelledRequests.add(input.executionRequestId)
          return response(request, { cancelled: true })
        }
        case 'execution.dispatch': {
          const input = request.payload as {
            readonly executionRequestId: string
            readonly contextSnapshotId: string
          }
          await delay(executionDelayMs)
          if (cancelledRequests.has(input.executionRequestId)) {
            return response(request, {
              outcome: 'CANCELLED',
              claimGranted: true,
              artifacts: []
            } satisfies DispatchResult)
          }
          return response(request, {
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
          } satisfies DispatchResult)
        }
      }
    }
  }

  return createWorkspaceClient(transport)
}

export function createDefaultRendererWorkspaceClient(): WorkspaceClient {
  const api: unknown = typeof window === 'undefined' ? undefined : window.canvasAgent
  if (
    typeof api === 'object' &&
    api !== null &&
    'command' in api &&
    typeof api.command === 'function'
  ) {
    return createWorkspaceClient()
  }
  return createFakeWorkspaceClient()
}
