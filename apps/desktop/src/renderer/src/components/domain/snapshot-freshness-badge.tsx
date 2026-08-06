import type { SnapshotFreshness } from '@canvas-agent/domain'
import { StatusBadge } from './status-badge'

interface SnapshotFreshnessBadgeProps {
  readonly freshness: SnapshotFreshness
}

export function SnapshotFreshnessBadge({
  freshness
}: SnapshotFreshnessBadgeProps): React.JSX.Element {
  return <StatusBadge status={freshness} />
}

export type { SnapshotFreshnessBadgeProps }
