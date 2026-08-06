import { cn } from '@/lib/utils'

type SkeletonProps = React.ComponentProps<'div'>

export function Skeleton({ className, ...props }: SkeletonProps): React.JSX.Element {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-[var(--radius-control)] bg-muted', className)}
      {...props}
    />
  )
}

export type { SkeletonProps }
