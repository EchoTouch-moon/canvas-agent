import type { TaskStatus } from '@canvas-agent/domain'
import { StatusBadge } from './status-badge'

interface TaskStatusBadgeProps {
  readonly status: TaskStatus
}

export function TaskStatusBadge({ status }: TaskStatusBadgeProps): React.JSX.Element {
  return <StatusBadge status={status} />
}

export type { TaskStatusBadgeProps }
