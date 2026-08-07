import type {
  BaselineStatus,
  RunOutcome,
  RunStatus,
  SnapshotFreshness,
  SnapshotStatus,
  TaskStatus
} from '@canvas-agent/domain'
import type { DispatchOutcome } from '@/lib/workspace-types'
import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CircleStop,
  Clock3,
  FileClock,
  GitBranch,
  LoaderCircle,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  XCircle
} from 'lucide-react'

export type StatusValue =
  | TaskStatus
  | RunStatus
  | RunOutcome
  | DispatchOutcome
  | BaselineStatus
  | SnapshotFreshness
  | SnapshotStatus
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
  VALIDATION_REJECTED: 'danger',
  CLAIM_REJECTED: 'warning',
  REVISION_MISMATCH: 'warning',
  ACTIVE: 'success',
  SUPERSEDED: 'neutral',
  CURRENT: 'success',
  STALE: 'warning',
  DIVERGED: 'danger',
  FROZEN: 'accent'
}

const statusIcons: Record<StatusValue, LucideIcon> = {
  DRAFT: CircleDashed,
  READY: Sparkles,
  IN_PROGRESS: LoaderCircle,
  WAITING_REVIEW: TriangleAlert,
  COMPLETED: CheckCircle2,
  CANCELLED: Ban,
  ARCHIVED: Archive,
  CREATED: CircleDot,
  QUEUED: Clock3,
  PREPARING: RefreshCw,
  RUNNING: PlayCircle,
  WAITING_INPUT: TriangleAlert,
  WAITING_APPROVAL: ShieldCheck,
  PAUSED: PauseCircle,
  INTERRUPTED: CircleStop,
  FINISHED: FileClock,
  SUCCEEDED: CheckCircle2,
  PARTIAL: TriangleAlert,
  FAILED: XCircle,
  TIMED_OUT: Clock3,
  VALIDATION_REJECTED: XCircle,
  CLAIM_REJECTED: TriangleAlert,
  REVISION_MISMATCH: TriangleAlert,
  ACTIVE: CheckCircle2,
  SUPERSEDED: GitBranch,
  CURRENT: CheckCircle2,
  STALE: TriangleAlert,
  DIVERGED: XCircle,
  FROZEN: ShieldCheck
}

export function toneForStatus(status: StatusValue): StatusTone {
  return statusTones[status]
}

export function iconForStatus(status: StatusValue): LucideIcon {
  return statusIcons[status]
}

export function readableStatus(status: StatusValue): string {
  return status.toLowerCase().replaceAll('_', ' ')
}
