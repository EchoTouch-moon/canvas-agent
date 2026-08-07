import type {
  BaselineStatus,
  ContextAuthority,
  ContextItemType,
  ContextPriority,
  EdgeStatus,
  EdgeType,
  NodeLifecycle,
  NodeType,
  SnapshotFreshness,
  SnapshotStatus,
  TaskStatus,
  TaskType
} from '@canvas-agent/domain'

export interface ProjectRecord {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly branch?: string
}

export interface NodeRecord {
  readonly id: string
  readonly projectId: string
  readonly type: NodeType
  readonly lifecycle: NodeLifecycle
}

export interface NodeDraftRecord {
  readonly id: string
  readonly nodeId: string
  readonly title: string
  readonly body: string
  readonly revision: number
  readonly updatedAt: string
}

export interface NodeVersionRecord {
  readonly id: string
  readonly nodeId: string
  readonly sequence: number
  readonly title: string
  readonly body: string
  readonly contentHash: string
  readonly createdAt: string
}

export interface EdgeRecord {
  readonly id: string
  readonly projectId: string
  readonly sourceNodeId: string
  readonly targetNodeId: string
  readonly type: EdgeType
  readonly status: EdgeStatus
  readonly anchoredNodeVersionId: string | null
  readonly note: string | null
}

export interface TaskRecord {
  readonly id: string
  readonly projectId: string
  readonly type: TaskType
  readonly status: TaskStatus
  readonly title: string
}

export interface TaskSpecVersionRecord {
  readonly id: string
  readonly taskId: string
  readonly sequence: number
  readonly description: string
  readonly scope: string
  readonly contentHash: string
  readonly createdAt: string
}

export interface AcceptanceCriterionRecord {
  readonly id: string
  readonly taskSpecVersionId: string
  readonly position: number
  readonly description: string
  readonly verificationMethod: string
}

export interface TaskTargetRecord {
  readonly id: string
  readonly taskSpecVersionId: string
  readonly nodeId: string | null
  readonly nodeVersionId: string | null
  readonly position: number
}

export interface TaskSpecAggregate {
  readonly version: TaskSpecVersionRecord
  readonly criteria: readonly AcceptanceCriterionRecord[]
  readonly targets: readonly TaskTargetRecord[]
}

export interface TaskAggregate {
  readonly task: TaskRecord
  readonly draft?: {
    readonly id: string
    readonly description: string
    readonly scope: string
    readonly revision: number
  }
  readonly specs: readonly TaskSpecAggregate[]
}

export interface ProjectBaselineRecord {
  readonly id: string
  readonly projectId: string
  readonly status: BaselineStatus
  readonly name: string
  readonly description: string | null
  readonly repositoryRevisionId: string | null
}

export interface BaselineItemRecord {
  readonly id: string
  readonly baselineId: string
  readonly nodeVersionId: string
  readonly position: number
}

export interface BaselineAggregate {
  readonly baseline: ProjectBaselineRecord
  readonly items: readonly BaselineItemRecord[]
}

export interface RepositoryRevisionRecord {
  readonly id: string
  readonly baseCommit: string
  readonly treeHash: string
  readonly workingTreePatchHash: string | null
}

export interface ContextSnapshotItemRecord {
  readonly id: string
  readonly contextSnapshotId: string
  readonly position: number
  readonly itemType: ContextItemType
  readonly sourceRef: string
  readonly resolvedContent: string
  readonly contentHash: string
  readonly selectionReason: string | null
  readonly authority: ContextAuthority
  readonly priority: ContextPriority
  readonly tokenEstimate: number
}

export interface ContextSnapshotRecord {
  readonly id: string
  readonly projectId: string
  readonly taskId: string
  readonly taskSpecVersionId: string
  readonly baseBaselineId: string
  readonly expectedRepositoryRevisionId: string
  readonly status: SnapshotStatus
  readonly freshness: SnapshotFreshness
  readonly createdAt: string
  readonly updatedAt: string
  readonly items: readonly ContextSnapshotItemRecord[]
}

export interface ProjectStateView {
  readonly project: ProjectRecord
  readonly nodes: readonly NodeRecord[]
  readonly nodeDrafts: readonly NodeDraftRecord[]
  readonly nodeVersions: readonly NodeVersionRecord[]
  readonly edges: readonly EdgeRecord[]
  readonly tasks: readonly TaskAggregate[]
  readonly baselines: readonly BaselineAggregate[]
  readonly repositoryRevision: RepositoryRevisionRecord | null
  readonly contextSnapshots: readonly ContextSnapshotRecord[]
}

export interface VerificationCommandResult {
  readonly argv: readonly string[]
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly cancelled: boolean
  readonly outputTruncated: boolean
  readonly durationMs: number
}

export interface ArtifactDescriptor {
  readonly kind: 'PATCH' | 'TEST_RESULT' | 'AGENT_SUMMARY' | 'AGENT_PARTIAL'
  readonly fileName: string
  readonly contentHash: string
  readonly sizeBytes: number
}

export type DispatchOutcome =
  | 'VALIDATION_REJECTED'
  | 'CLAIM_REJECTED'
  | 'REVISION_MISMATCH'
  | 'SUCCEEDED'
  | 'PARTIAL'
  | 'CANCELLED'

export interface RevisionMismatchDetail {
  readonly field: string
  readonly expected: string | null
  readonly actual: string | null
}

export interface RecoveryMetadata {
  readonly executionRequestId: string
  readonly worktreePath: string
  readonly state: 'running' | 'interrupted'
  readonly startedAt: string
  readonly interruptedAt?: string
  readonly cleanupSucceeded: boolean
}

export interface DispatchResult {
  readonly outcome: DispatchOutcome
  readonly claimGranted: boolean
  readonly rejectionReason?: string
  readonly revisionMismatch?: RevisionMismatchDetail
  readonly patch?: string
  readonly patchHash?: string
  readonly verificationResults?: readonly VerificationCommandResult[]
  readonly artifacts?: readonly ArtifactDescriptor[]
  readonly agentSummary?: string
  readonly recovery?: RecoveryMetadata
  readonly timedOut?: boolean
}

export interface CancellationResult {
  readonly cancelled: boolean
}
