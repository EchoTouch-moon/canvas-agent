import { createElement } from 'react'
import { Badge } from '@/components/ui/badge'
import { iconForStatus, readableStatus, toneForStatus, type StatusValue } from './status-tone'

interface StatusBadgeProps {
  readonly status: StatusValue
  readonly label?: string
}

export function StatusBadge({ status, label }: StatusBadgeProps): React.JSX.Element {
  const Icon = iconForStatus(status)

  return (
    <Badge tone={toneForStatus(status)}>
      {createElement(Icon, { className: 'size-3', 'aria-hidden': true })}
      {label ?? readableStatus(status)}
    </Badge>
  )
}

export type { StatusBadgeProps }
