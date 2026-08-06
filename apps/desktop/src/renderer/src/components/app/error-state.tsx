import { CircleAlert, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from './empty-state'

interface ErrorStateProps {
  readonly title?: string
  readonly description?: string
  readonly onRetry?: () => void
  readonly compact?: boolean
}

export function ErrorState({
  title = 'Something needs attention',
  description = 'This view could not load the latest workspace state.',
  onRetry,
  compact = false
}: ErrorStateProps): React.JSX.Element {
  return (
    <EmptyState
      icon={CircleAlert}
      title={title}
      description={description}
      compact={compact}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Retry
          </Button>
        ) : undefined
      }
    />
  )
}

export type { ErrorStateProps }
