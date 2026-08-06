import type { RunOutcome } from '@canvas-agent/domain'
import { StatusBadge } from './status-badge'

interface RunOutcomeBadgeProps {
  readonly outcome: RunOutcome
}

export function RunOutcomeBadge({ outcome }: RunOutcomeBadgeProps): React.JSX.Element {
  return <StatusBadge status={outcome} />
}

export type { RunOutcomeBadgeProps }
