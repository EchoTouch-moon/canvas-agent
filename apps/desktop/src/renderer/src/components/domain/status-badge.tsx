import { Badge } from '@/components/ui/badge'
import { toneForStatus, type StatusValue } from './status-tone'

function readableStatus(status: StatusValue): string {
  return status.toLowerCase().replaceAll('_', ' ')
}

export function StatusBadge({ status }: { status: StatusValue }): React.JSX.Element {
  return (
    <Badge tone={toneForStatus(status)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {readableStatus(status)}
    </Badge>
  )
}
