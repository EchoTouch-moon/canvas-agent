import type {
  BaselineStatus,
  ContextAuthority,
  ContextItemType,
  ContextPriority,
  NodeLifecycle,
  NodeType,
  RunOutcome,
  RunStatus,
  SnapshotFreshness,
  SnapshotStatus,
  TaskStatus,
  TaskType
} from '@canvas-agent/domain'

export type FlowRoute =
  'dashboard' | 'outline' | 'node' | 'task' | 'context' | 'run' | 'artifact' | 'baseline'

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

export type TimelineState = 'complete' | 'active' | 'pending' | 'warning'

export interface FlowNotice {
  readonly tone: NoticeTone
  readonly title: string
  readonly message: string
}

export interface CoreFlowNode {
  readonly id: string
  readonly type: NodeType
  readonly lifecycle: NodeLifecycle
  readonly title: string
  readonly summary: string
  readonly version: string
  readonly links: readonly string[]
}

export interface TaskCriterion {
  readonly id: string
  readonly label: string
  readonly passed: boolean
}

export interface CoreFlowTask {
  readonly id: string
  readonly type: TaskType
  readonly title: string
  readonly objective: string
  readonly nonGoals: readonly string[]
  readonly targets: readonly string[]
  readonly status: TaskStatus
  readonly criteria: readonly TaskCriterion[]
  readonly acceptanceEvaluated: boolean
}

export interface ContextCandidate {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly type: ContextItemType
  readonly authority: ContextAuthority
  readonly priority: ContextPriority
  readonly tokens: number
  readonly required: boolean
  readonly conflictsWith?: string
}

export interface CoreFlowSnapshot {
  readonly id: string
  readonly label: string
  readonly status: SnapshotStatus
  readonly freshness: SnapshotFreshness
  readonly revision: string
  readonly tokenBudget: number
  readonly frozenAt: string | null
}

export interface RunTimelineEvent {
  readonly id: string
  readonly label: string
  readonly detail: string
  readonly state: TimelineState
}

export interface RunTestResult {
  readonly id: string
  readonly label: string
  readonly status: 'PASSED' | 'FAILED'
  readonly detail: string
}

export interface CoreFlowRun {
  readonly id: string
  readonly status: RunStatus
  readonly outcome: RunOutcome | null
  readonly startedAt: string | null
  readonly tests: readonly RunTestResult[]
  readonly timeline: readonly RunTimelineEvent[]
}

export type ArtifactReviewStatus = 'READY' | 'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED'
export type ArtifactApplicationStatus = 'NOT_APPLIED' | 'APPLIED'
export type ArtifactTab = 'summary' | 'diff' | 'tests'

export interface CoreFlowArtifact {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly changedFiles: readonly string[]
  readonly diffLines: readonly string[]
  readonly reviewStatus: ArtifactReviewStatus
  readonly applicationStatus: ArtifactApplicationStatus
  readonly activeTab: ArtifactTab
}

export interface CoreFlowBaseline {
  readonly id: string
  readonly label: string
  readonly sourceTaskId: string
  readonly revision: string
  readonly status: BaselineStatus
}

export interface CoreFlowState {
  readonly route: FlowRoute
  readonly project: {
    readonly name: string
    readonly description: string
    readonly branch: string
    readonly activeBaseline: string
  }
  readonly nodes: readonly CoreFlowNode[]
  readonly selectedNodeId: string
  readonly task: CoreFlowTask
  readonly contextItems: readonly ContextCandidate[]
  readonly selectedContextItemIds: readonly string[]
  readonly snapshot: CoreFlowSnapshot
  readonly run: CoreFlowRun
  readonly priorRuns: readonly CoreFlowRun[]
  readonly artifact: CoreFlowArtifact
  readonly baseline: CoreFlowBaseline
  readonly notice: FlowNotice | null
}

export interface CoreFlowFixtureService {
  readonly load: () => CoreFlowState
}

export const CORE_FLOW_IDS = {
  goalNode: 'NODE-GOAL-001',
  requirementNode: 'NODE-REQ-011',
  constraintNode: 'NODE-CONSTRAINT-004',
  designNode: 'NODE-DESIGN-021',
  projectRule: 'context-project-rule',
  taskInstruction: 'context-task-instruction',
  recordingVersionNode: 'context-recording-version',
  schemaNode: 'context-schema',
  recordingExample: 'context-recording-example',
  conflictingNote: 'context-conflicting-note'
} as const

export function createInitialCoreFlowState(): CoreFlowState {
  return {
    route: 'dashboard',
    project: {
      name: 'MUSICDB',
      description: 'Personal music library and recording-version workspace.',
      branch: 'main',
      activeBaseline: 'Baseline 1.0'
    },
    nodes: [
      {
        id: CORE_FLOW_IDS.goalNode,
        type: 'GOAL',
        lifecycle: 'ACTIVE',
        title: 'Reliable recording-version notes',
        summary: 'Keep song-wide facts separate from notes tied to one recording version.',
        version: 'v3',
        links: ['TASK-011', 'NODE-REQ-011']
      },
      {
        id: CORE_FLOW_IDS.requirementNode,
        type: 'REQUIREMENT',
        lifecycle: 'ACTIVE',
        title: 'Separate note ownership',
        summary: 'A note must identify whether it belongs to a song or a recording version.',
        version: 'v2',
        links: ['TASK-011', 'NODE-DESIGN-021']
      },
      {
        id: CORE_FLOW_IDS.constraintNode,
        type: 'CONSTRAINT',
        lifecycle: 'ACTIVE',
        title: 'Preserve existing song notes',
        summary: 'The change cannot invalidate existing song-wide notes or their search results.',
        version: 'v1',
        links: ['TASK-011']
      },
      {
        id: CORE_FLOW_IDS.designNode,
        type: 'DESIGN',
        lifecycle: 'ACTIVE',
        title: 'RecordingVersionNote relation',
        summary:
          'Add a typed relation from a note to one recording version without duplicating text.',
        version: 'v4',
        links: ['NODE-REQ-011', 'TASK-011']
      }
    ],
    selectedNodeId: CORE_FLOW_IDS.requirementNode,
    task: {
      id: 'TASK-011',
      type: 'IMPLEMENT_CHANGE',
      title: 'Add recording-version notes',
      objective: 'Separate song-wide notes from notes tied to a specific recording version.',
      nonGoals: ['No bulk migration of historic notes', 'No redesign of the music library search'],
      targets: ['Note model', 'Recording version detail view', 'Acceptance test suite'],
      status: 'IN_PROGRESS',
      criteria: [
        { id: 'criterion-1', label: 'Song-wide notes remain readable', passed: true },
        { id: 'criterion-2', label: 'Recording-version notes are addressable', passed: true },
        { id: 'criterion-3', label: 'Existing note search remains compatible', passed: false },
        { id: 'criterion-4', label: 'The relation is visible in the detail view', passed: false },
        { id: 'criterion-5', label: 'Invalid ownership is rejected', passed: false },
        { id: 'criterion-6', label: 'Migration is explicitly out of scope', passed: true }
      ],
      acceptanceEvaluated: false
    },
    contextItems: [
      {
        id: CORE_FLOW_IDS.projectRule,
        label: 'Project rules',
        description: 'Local-first data handling and renderer boundary rules.',
        type: 'PROJECT_RULE',
        authority: 'PROJECT_RULE',
        priority: 'P0',
        tokens: 1_200,
        required: true
      },
      {
        id: CORE_FLOW_IDS.taskInstruction,
        label: 'Task specification',
        description: 'Immutable TaskSpecVersion with objective, targets and acceptance criteria.',
        type: 'USER_INPUT',
        authority: 'TASK_INSTRUCTION',
        priority: 'P0',
        tokens: 1_800,
        required: true
      },
      {
        id: CORE_FLOW_IDS.recordingVersionNode,
        label: 'Recording version node',
        description: 'The selected requirement and its current node version.',
        type: 'NODE_VERSION',
        authority: 'PROJECT_FACT',
        priority: 'P1',
        tokens: 2_200,
        required: false
      },
      {
        id: CORE_FLOW_IDS.schemaNode,
        label: 'Note schema and target files',
        description: 'Relevant code structure for the note model and detail view.',
        type: 'REPOSITORY_CONTENT',
        authority: 'PROJECT_FACT',
        priority: 'P1',
        tokens: 3_600,
        required: false
      },
      {
        id: CORE_FLOW_IDS.recordingExample,
        label: 'Reference recording example',
        description: 'One representative recording used to check the new relation.',
        type: 'ARTIFACT',
        authority: 'REFERENCE',
        priority: 'P2',
        tokens: 1_400,
        required: false
      },
      {
        id: CORE_FLOW_IDS.conflictingNote,
        label: 'Legacy note instruction',
        description: 'An older instruction that conflicts with the current TaskSpecVersion.',
        type: 'USER_INPUT',
        authority: 'UNTRUSTED_CONTENT',
        priority: 'P0',
        tokens: 800,
        required: false,
        conflictsWith: CORE_FLOW_IDS.taskInstruction
      }
    ],
    selectedContextItemIds: [CORE_FLOW_IDS.projectRule, CORE_FLOW_IDS.taskInstruction],
    snapshot: {
      id: 'SNAPSHOT-004',
      label: 'Snapshot draft 04',
      status: 'DRAFT',
      freshness: 'CURRENT',
      revision: 'main / current working revision',
      tokenBudget: 8_000,
      frozenAt: null
    },
    run: {
      id: 'RUN-009',
      status: 'CREATED',
      outcome: null,
      startedAt: null,
      tests: [
        {
          id: 'test-note-ownership',
          label: 'note ownership compatibility',
          status: 'PASSED',
          detail: 'Song-wide notes and recording-version notes resolve independently.'
        },
        {
          id: 'test-detail-view',
          label: 'recording version detail view',
          status: 'PASSED',
          detail: 'The new relation is rendered without duplicating note content.'
        }
      ],
      timeline: [
        {
          id: 'timeline-created',
          label: 'Run created',
          detail: 'Waiting for a frozen ContextSnapshot.',
          state: 'pending'
        },
        {
          id: 'timeline-queued',
          label: 'Worker request',
          detail: 'A typed ExecutionRequest will be created after Start run.',
          state: 'pending'
        },
        {
          id: 'timeline-finished',
          label: 'Acceptance evidence',
          detail: 'Human review is still required after the Run finishes.',
          state: 'pending'
        }
      ]
    },
    priorRuns: [
      {
        id: 'RUN-008',
        status: 'FINISHED',
        outcome: 'PARTIAL',
        startedAt: 'Earlier local attempt',
        tests: [
          {
            id: 'test-legacy-search',
            label: 'legacy search compatibility',
            status: 'FAILED',
            detail: 'The previous attempt mixed song-wide and recording-version ownership.'
          }
        ],
        timeline: [
          {
            id: 'prior-finished',
            label: 'Partial result',
            detail: 'Review the failed acceptance evidence before relying on this result.',
            state: 'warning'
          }
        ]
      }
    ],
    artifact: {
      id: 'ARTIFACT-009',
      title: 'Recording-version notes patch',
      summary: 'Adds the typed ownership relation and keeps existing song-wide note reads intact.',
      changedFiles: ['src/domain/note.ts', 'src/recordings/detail-view.tsx', 'tests/note.test.ts'],
      diffLines: [
        '+ type NoteOwner = Song | RecordingVersion',
        '+ recordingVersionId?: string',
        '+ renderOwnerLabel(note.owner)',
        '  preserveSongWideSearch(note.content)',
        '+ expect(note.owner).toEqual(recordingVersion.id)'
      ],
      reviewStatus: 'READY',
      applicationStatus: 'NOT_APPLIED',
      activeTab: 'summary'
    },
    baseline: {
      id: 'BASELINE-011',
      label: 'Baseline 1.1 draft',
      sourceTaskId: 'TASK-011',
      revision: 'main / candidate after RUN-009',
      status: 'DRAFT'
    },
    notice: null
  }
}

export function createCoreFlowFixtureService(): CoreFlowFixtureService {
  return { load: createInitialCoreFlowState }
}
