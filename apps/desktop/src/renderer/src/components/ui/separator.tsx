import { Separator as BaseSeparator } from '@base-ui/react/separator'
import { cn } from '@/lib/utils'

type SeparatorProps = Omit<React.ComponentProps<typeof BaseSeparator>, 'className'> & {
  className?: string
}

export function Separator({
  orientation = 'horizontal',
  className,
  ...props
}: SeparatorProps): React.JSX.Element {
  return (
    <BaseSeparator
      data-slot="separator"
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
      {...props}
    />
  )
}

export type { SeparatorProps }
