import type { RunOutcome } from '@canvas-agent/domain'
import type { DispatchOutcome } from '@/lib/workspace-types'
import { StatusBadge } from './status-badge'

interface RunOutcomeBadgeProps {
  readonly outcome: RunOutcome | DispatchOutcome
}

export function RunOutcomeBadge({ outcome }: RunOutcomeBadgeProps): React.JSX.Element {
  return <StatusBadge status={outcome} />
}

export type { RunOutcomeBadgeProps }
