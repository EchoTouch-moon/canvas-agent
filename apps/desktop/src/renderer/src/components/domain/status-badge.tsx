import { createElement } from 'react'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/lib/i18n'
import { iconForStatus, toneForStatus, type StatusValue } from './status-tone'

interface StatusBadgeProps {
  readonly status: StatusValue
  readonly label?: string
}

export function StatusBadge({ status, label }: StatusBadgeProps): React.JSX.Element {
  const { t } = useI18n()
  const Icon = iconForStatus(status)

  return (
    <Badge tone={toneForStatus(status)}>
      {createElement(Icon, { className: 'size-3', 'aria-hidden': true })}
      {label ?? t(`status.${status}`)}
    </Badge>
  )
}

export type { StatusBadgeProps }
