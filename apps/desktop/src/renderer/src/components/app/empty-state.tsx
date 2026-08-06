import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  readonly icon?: LucideIcon
  readonly title: string
  readonly description?: string
  readonly action?: React.ReactNode
  readonly compact?: boolean
  readonly className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'min-h-28 px-3 py-5' : 'min-h-56 px-6 py-10',
        className
      )}
    >
      {Icon ? (
        <span
          className={cn(
            'grid place-items-center rounded-full border border-border bg-muted text-muted-foreground',
            compact ? 'size-8' : 'size-11'
          )}
        >
          <Icon className={compact ? 'size-4' : 'size-5'} aria-hidden="true" />
        </span>
      ) : null}
      <h3 className={cn('font-semibold', compact ? 'mt-2 text-[12px]' : 'mt-3 text-[15px]')}>
        {title}
      </h3>
      {description ? (
        <p
          className={cn(
            'max-w-sm text-muted-foreground',
            compact ? 'mt-1 text-[11px] leading-4' : 'mt-1.5 text-[12px] leading-5'
          )}
        >
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export type { EmptyStateProps }
