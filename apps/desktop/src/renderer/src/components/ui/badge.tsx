import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-[var(--radius-badge)] border px-1.5 text-[10px] font-semibold tracking-[0.02em] uppercase leading-none',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        accent: 'border-primary/25 bg-primary/10 text-primary',
        success: 'border-status-success/25 bg-status-success/10 text-status-success',
        warning: 'border-status-warning/30 bg-status-warning/12 text-status-warning',
        danger: 'border-status-danger/25 bg-status-danger/10 text-status-danger',
        info: 'border-status-info/25 bg-status-info/10 text-status-info'
      }
    },
    defaultVariants: {
      tone: 'neutral'
    }
  }
)

type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>

function Badge({ className, tone, ...props }: BadgeProps): React.JSX.Element {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { Badge }
