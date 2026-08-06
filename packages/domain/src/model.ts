export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name
}

export type ProjectId = Brand<string, 'ProjectId'>
export type NodeId = Brand<string, 'NodeId'>
export type NodeVersionId = Brand<string, 'NodeVersionId'>
export type EdgeId = Brand<string, 'EdgeId'>
export type BaselineId = Brand<string, 'BaselineId'>
export type TaskId = Brand<string, 'TaskId'>
export type TaskSpecVersionId = Brand<string, 'TaskSpecVersionId'>
export type ContextSnapshotId = Brand<string, 'ContextSnapshotId'>
export type RunId = Brand<string, 'RunId'>
export type ExecutionRequestId = Brand<string, 'ExecutionRequestId'>

export const NODE_TYPES = [
  'IDEA',
  'GOAL',
  'REQUIREMENT',
  'CONSTRAINT',
  'DESIGN',
  'DECISION',
  'COMPONENT'
] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const NODE_LIFECYCLES = ['ACTIVE', 'DEPRECATED', 'ARCHIVED'] as const
export type NodeLifecycle = (typeof NODE_LIFECYCLES)[number]

export const EDGE_TYPES = [
  'PARENT_OF',
  'DEPENDS_ON',
  'IMPLEMENTS',
  'CONSTRAINS',
  'SUPERSEDES',
  'DERIVED_FROM',
  'RELATED_TO'
] as const
export type EdgeType = (typeof EDGE_TYPES)[number]

export const EDGE_STATUSES = [
  'PROPOSED',
  'ACTIVE',
  'NEEDS_REVIEW',
  'SUPERSEDED',
  'ARCHIVED'
] as const
export type EdgeStatus = (typeof EDGE_STATUSES)[number]

export const BASELINE_STATUSES = ['DRAFT', 'ACTIVE', 'SUPERSEDED'] as const
export type BaselineStatus = (typeof BASELINE_STATUSES)[number]

export const TASK_TYPES = ['BOOTSTRAP_PROJECT', 'IMPLEMENT_CHANGE'] as const
export type TaskType = (typeof TASK_TYPES)[number]

export const TASK_STATUSES = [
  'DRAFT',
  'READY',
  'IN_PROGRESS',
  'WAITING_REVIEW',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED'
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const RUN_STATUSES = [
  'CREATED',
  'QUEUED',
  'PREPARING',
  'RUNNING',
  'WAITING_INPUT',
  'WAITING_APPROVAL',
  'PAUSED',
  'INTERRUPTED',
  'FINISHED'
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_OUTCOMES = ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'TIMED_OUT'] as const
export type RunOutcome = (typeof RUN_OUTCOMES)[number]

export const APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'CONSUMED'
] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

export const SNAPSHOT_STATUSES = ['DRAFT', 'FROZEN', 'ARCHIVED'] as const
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number]

export const SNAPSHOT_FRESHNESS = ['CURRENT', 'STALE', 'DIVERGED', 'ARCHIVED'] as const
export type SnapshotFreshness = (typeof SNAPSHOT_FRESHNESS)[number]

export const CONTEXT_ITEM_TYPES = [
  'NODE_VERSION',
  'EDGE',
  'REPOSITORY_CONTENT',
  'ARTIFACT',
  'USER_INPUT',
  'PROJECT_RULE'
] as const
export type ContextItemType = (typeof CONTEXT_ITEM_TYPES)[number]

export const CONTEXT_AUTHORITIES = [
  'PROJECT_RULE',
  'TASK_INSTRUCTION',
  'PROJECT_FACT',
  'EVIDENCE',
  'REFERENCE',
  'UNTRUSTED_CONTENT'
] as const
export type ContextAuthority = (typeof CONTEXT_AUTHORITIES)[number]

export type ContextPriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface RunState {
  readonly status: RunStatus
  readonly outcome: RunOutcome | null
}
