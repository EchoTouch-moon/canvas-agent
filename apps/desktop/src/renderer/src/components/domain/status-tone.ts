import type {
  BaselineStatus,
  RunOutcome,
  RunStatus,
  SnapshotFreshness,
  TaskStatus
} from '@canvas-agent/domain'

export type StatusValue = TaskStatus | RunStatus | RunOutcome | BaselineStatus | SnapshotFreshness
export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

const statusTones: Record<StatusValue, StatusTone> = {
  DRAFT: 'neutral',
  READY: 'accent',
  IN_PROGRESS: 'info',
  WAITING_REVIEW: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  ARCHIVED: 'neutral',
  CREATED: 'neutral',
  QUEUED: 'neutral',
  PREPARING: 'info',
  RUNNING: 'info',
  WAITING_INPUT: 'warning',
  WAITING_APPROVAL: 'warning',
  PAUSED: 'warning',
  INTERRUPTED: 'danger',
  FINISHED: 'neutral',
  SUCCEEDED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
  TIMED_OUT: 'danger',
  ACTIVE: 'success',
  SUPERSEDED: 'neutral',
  CURRENT: 'success',
  STALE: 'warning',
  DIVERGED: 'danger'
}

export function toneForStatus(status: StatusValue): StatusTone {
  return statusTones[status]
}
