import type { RunStatus } from '@canvas-agent/domain'
import { StatusBadge } from './status-badge'

interface RunStatusBadgeProps {
  readonly status: RunStatus
}

export function RunStatusBadge({ status }: RunStatusBadgeProps): React.JSX.Element {
  return <StatusBadge status={status} />
}

export type { RunStatusBadgeProps }
