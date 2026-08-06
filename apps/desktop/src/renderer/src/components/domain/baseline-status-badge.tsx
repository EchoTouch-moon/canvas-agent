import type { BaselineStatus } from '@canvas-agent/domain'
import { StatusBadge } from './status-badge'

interface BaselineStatusBadgeProps {
  readonly status: BaselineStatus
}

export function BaselineStatusBadge({ status }: BaselineStatusBadgeProps): React.JSX.Element {
  return <StatusBadge status={status} />
}

export type { BaselineStatusBadgeProps }
