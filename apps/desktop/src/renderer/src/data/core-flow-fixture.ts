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
import type { Locale } from '@/lib/i18n'

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
  readonly locale: Locale
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

function pick(locale: Locale, en: string, zh: string): string {
  return locale === 'zh' ? zh : en
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

export function createInitialCoreFlowState(locale: Locale = 'en'): CoreFlowState {
  return {
    locale,
    route: 'dashboard',
    project: {
      name: 'MUSICDB',
      description: pick(
        locale,
        'Personal music library and recording-version workspace.',
        '个人音乐库与录音版本工作区。'
      ),
      branch: 'main',
      activeBaseline: pick(locale, 'Baseline 1.0', '基线 1.0')
    },
    nodes: [
      {
        id: CORE_FLOW_IDS.goalNode,
        type: 'GOAL',
        lifecycle: 'ACTIVE',
        title: pick(locale, 'Reliable recording-version notes', '可靠的录音版本笔记'),
        summary: pick(
          locale,
          'Keep song-wide facts separate from notes tied to one recording version.',
          '将歌曲级事实与绑定单个录音版本的笔记区分开。'
        ),
        version: 'v3',
        links: ['TASK-011', 'NODE-REQ-011']
      },
      {
        id: CORE_FLOW_IDS.requirementNode,
        type: 'REQUIREMENT',
        lifecycle: 'ACTIVE',
        title: pick(locale, 'Separate note ownership', '分离笔记归属'),
        summary: pick(
          locale,
          'A note must identify whether it belongs to a song or a recording version.',
          '一条笔记必须标明其属于歌曲还是某个录音版本。'
        ),
        version: 'v2',
        links: ['TASK-011', 'NODE-DESIGN-021']
      },
      {
        id: CORE_FLOW_IDS.constraintNode,
        type: 'CONSTRAINT',
        lifecycle: 'ACTIVE',
        title: pick(locale, 'Preserve existing song notes', '保留现有歌曲笔记'),
        summary: pick(
          locale,
          'The change cannot invalidate existing song-wide notes or their search results.',
          '该变更不得使现有歌曲级笔记或其搜索结果失效。'
        ),
        version: 'v1',
        links: ['TASK-011']
      },
      {
        id: CORE_FLOW_IDS.designNode,
        type: 'DESIGN',
        lifecycle: 'ACTIVE',
        title: pick(locale, 'RecordingVersionNote relation', 'RecordingVersionNote 关系'),
        summary: pick(
          locale,
          'Add a typed relation from a note to one recording version without duplicating text.',
          '在不重复文本的前提下，为笔记到单个录音版本添加类型化关系。'
        ),
        version: 'v4',
        links: ['NODE-REQ-011', 'TASK-011']
      }
    ],
    selectedNodeId: CORE_FLOW_IDS.requirementNode,
    task: {
      id: 'TASK-011',
      type: 'IMPLEMENT_CHANGE',
      title: pick(locale, 'Add recording-version notes', '新增录音版本笔记'),
      objective: pick(
        locale,
        'Separate song-wide notes from notes tied to a specific recording version.',
        '将歌曲级笔记与绑定特定录音版本的笔记分离。'
      ),
      nonGoals: [
        pick(locale, 'No bulk migration of historic notes', '不批量迁移历史笔记'),
        pick(locale, 'No redesign of the music library search', '不重设计音乐库搜索')
      ],
      targets: [
        pick(locale, 'Note model', '笔记模型'),
        pick(locale, 'Recording version detail view', '录音版本详情视图'),
        pick(locale, 'Acceptance test suite', '验收测试套件')
      ],
      status: 'IN_PROGRESS',
      criteria: [
        {
          id: 'criterion-1',
          label: pick(locale, 'Song-wide notes remain readable', '歌曲级笔记保持可读'),
          passed: true
        },
        {
          id: 'criterion-2',
          label: pick(locale, 'Recording-version notes are addressable', '录音版本笔记可寻址'),
          passed: true
        },
        {
          id: 'criterion-3',
          label: pick(locale, 'Existing note search remains compatible', '现有笔记搜索保持兼容'),
          passed: false
        },
        {
          id: 'criterion-4',
          label: pick(locale, 'The relation is visible in the detail view', '关系在详情视图中可见'),
          passed: false
        },
        {
          id: 'criterion-5',
          label: pick(locale, 'Invalid ownership is rejected', '无效归属被拒绝'),
          passed: false
        },
        {
          id: 'criterion-6',
          label: pick(locale, 'Migration is explicitly out of scope', '迁移明确不在范围内'),
          passed: true
        }
      ],
      acceptanceEvaluated: false
    },
    contextItems: [
      {
        id: CORE_FLOW_IDS.projectRule,
        label: pick(locale, 'Project rules', '项目规则'),
        description: pick(
          locale,
          'Local-first data handling and renderer boundary rules.',
          '本地优先的数据处理与渲染器边界规则。'
        ),
        type: 'PROJECT_RULE',
        authority: 'PROJECT_RULE',
        priority: 'P0',
        tokens: 1_200,
        required: true
      },
      {
        id: CORE_FLOW_IDS.taskInstruction,
        label: pick(locale, 'Task specification', '任务规格'),
        description: pick(
          locale,
          'Immutable TaskSpecVersion with objective, targets and acceptance criteria.',
          '包含目标、目标物与验收标准的不可变 TaskSpecVersion。'
        ),
        type: 'USER_INPUT',
        authority: 'TASK_INSTRUCTION',
        priority: 'P0',
        tokens: 1_800,
        required: true
      },
      {
        id: CORE_FLOW_IDS.recordingVersionNode,
        label: pick(locale, 'Recording version node', '录音版本节点'),
        description: pick(
          locale,
          'The selected requirement and its current node version.',
          '所选需求及其当前节点版本。'
        ),
        type: 'NODE_VERSION',
        authority: 'PROJECT_FACT',
        priority: 'P1',
        tokens: 2_200,
        required: false
      },
      {
        id: CORE_FLOW_IDS.schemaNode,
        label: pick(locale, 'Note schema and target files', '笔记模式与目标文件'),
        description: pick(
          locale,
          'Relevant code structure for the note model and detail view.',
          '笔记模型与详情视图的相关代码结构。'
        ),
        type: 'REPOSITORY_CONTENT',
        authority: 'PROJECT_FACT',
        priority: 'P1',
        tokens: 3_600,
        required: false
      },
      {
        id: CORE_FLOW_IDS.recordingExample,
        label: pick(locale, 'Reference recording example', '参考录音示例'),
        description: pick(
          locale,
          'One representative recording used to check the new relation.',
          '用于检查新关系的一个代表性录音。'
        ),
        type: 'ARTIFACT',
        authority: 'REFERENCE',
        priority: 'P2',
        tokens: 1_400,
        required: false
      },
      {
        id: CORE_FLOW_IDS.conflictingNote,
        label: pick(locale, 'Legacy note instruction', '旧版笔记指令'),
        description: pick(
          locale,
          'An older instruction that conflicts with the current TaskSpecVersion.',
          '与当前 TaskSpecVersion 冲突的一条旧指令。'
        ),
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
      label: pick(locale, 'Snapshot draft 04', '快照草稿 04'),
      status: 'DRAFT',
      freshness: 'CURRENT',
      revision: pick(locale, 'main / current working revision', 'main / 当前工作版本'),
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
          label: pick(locale, 'note ownership compatibility', '笔记归属兼容性'),
          status: 'PASSED',
          detail: pick(
            locale,
            'Song-wide notes and recording-version notes resolve independently.',
            '歌曲级笔记与录音版本笔记可独立解析。'
          )
        },
        {
          id: 'test-detail-view',
          label: pick(locale, 'recording version detail view', '录音版本详情视图'),
          status: 'PASSED',
          detail: pick(
            locale,
            'The new relation is rendered without duplicating note content.',
            '新关系在渲染时不重复笔记内容。'
          )
        }
      ],
      timeline: [
        {
          id: 'timeline-created',
          label: pick(locale, 'Run created', '运行已创建'),
          detail: pick(locale, 'Waiting for a frozen ContextSnapshot.', '等待冻结的上下文快照。'),
          state: 'pending'
        },
        {
          id: 'timeline-queued',
          label: pick(locale, 'Worker request', 'Worker 请求'),
          detail: pick(
            locale,
            'A typed ExecutionRequest will be created after Start run.',
            '启动运行后将创建类型化的 ExecutionRequest。'
          ),
          state: 'pending'
        },
        {
          id: 'timeline-finished',
          label: pick(locale, 'Acceptance evidence', '验收证据'),
          detail: pick(
            locale,
            'Human review is still required after the Run finishes.',
            '运行结束后仍需人工审核。'
          ),
          state: 'pending'
        }
      ]
    },
    priorRuns: [
      {
        id: 'RUN-008',
        status: 'FINISHED',
        outcome: 'PARTIAL',
        startedAt: pick(locale, 'Earlier local attempt', '此前的本地尝试'),
        tests: [
          {
            id: 'test-legacy-search',
            label: pick(locale, 'legacy search compatibility', '旧版搜索兼容性'),
            status: 'FAILED',
            detail: pick(
              locale,
              'The previous attempt mixed song-wide and recording-version ownership.',
              '此前的尝试混淆了歌曲级与录音版本归属。'
            )
          }
        ],
        timeline: [
          {
            id: 'prior-finished',
            label: pick(locale, 'Partial result', '部分结果'),
            detail: pick(
              locale,
              'Review the failed acceptance evidence before relying on this result.',
              '依赖此结果前，请先审核失败的验收证据。'
            ),
            state: 'warning'
          }
        ]
      }
    ],
    artifact: {
      id: 'ARTIFACT-009',
      title: pick(locale, 'Recording-version notes patch', '录音版本笔记补丁'),
      summary: pick(
        locale,
        'Adds the typed ownership relation and keeps existing song-wide note reads intact.',
        '新增类型化归属关系，并保持现有歌曲级笔记读取不变。'
      ),
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
      label: pick(locale, 'Baseline 1.1 draft', '基线 1.1 草稿'),
      sourceTaskId: 'TASK-011',
      revision: pick(locale, 'main / candidate after RUN-009', 'main / RUN-009 后的候选'),
      status: 'DRAFT'
    },
    notice: null
  }
}

export function createCoreFlowFixtureService(locale: Locale): CoreFlowFixtureService {
  return { load: () => createInitialCoreFlowState(locale) }
}
