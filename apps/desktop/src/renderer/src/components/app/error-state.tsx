import { CircleAlert, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from './empty-state'
import { useI18n } from '@/lib/i18n'

interface ErrorStateProps {
  readonly title?: string
  readonly description?: string
  readonly onRetry?: () => void
  readonly compact?: boolean
}

export function ErrorState({
  title,
  description,
  onRetry,
  compact = false
}: ErrorStateProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <EmptyState
      icon={CircleAlert}
      title={title ?? t('states.errorTitle')}
      description={description ?? t('states.errorDesc')}
      compact={compact}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            {t('states.retry')}
          </Button>
        ) : undefined
      }
    />
  )
}

export type { ErrorStateProps }
