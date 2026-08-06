import { cn } from '@/lib/utils'

interface PageToolbarProps {
  readonly eyebrow?: string
  readonly title: string
  readonly description?: string
  readonly leading?: React.ReactNode
  readonly meta?: React.ReactNode
  readonly actions?: React.ReactNode
  readonly className?: string
}

export function PageToolbar({
  eyebrow,
  title,
  description,
  leading,
  meta,
  actions,
  className
}: PageToolbarProps): React.JSX.Element {
  return (
    <div className={cn('flex min-h-12 items-start gap-3 border-b border-border pb-4', className)}>
      {leading ? <div className="mt-0.5 shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p className="mb-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-[22px] font-semibold tracking-[-0.035em]">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}

export type { PageToolbarProps }
