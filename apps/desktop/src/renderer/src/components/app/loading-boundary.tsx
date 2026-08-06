import { LoaderCircle } from 'lucide-react'
import { ErrorState } from './error-state'

interface LoadingBoundaryProps {
  readonly isLoading?: boolean
  readonly error?: unknown
  readonly onRetry?: () => void
  readonly loadingLabel?: string
  readonly children: React.ReactNode
}

export function LoadingBoundary({
  isLoading = false,
  error,
  onRetry,
  loadingLabel = 'Loading workspace',
  children
}: LoadingBoundaryProps): React.JSX.Element {
  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-56 flex-col items-center justify-center gap-3 text-muted-foreground"
      >
        <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />
        <span className="text-[12px]">{loadingLabel}</span>
      </div>
    )
  }

  if (error) return <ErrorState onRetry={onRetry} />

  return <>{children}</>
}

export type { LoadingBoundaryProps }
