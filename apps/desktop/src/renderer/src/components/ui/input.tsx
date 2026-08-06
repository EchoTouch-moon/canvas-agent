import { Input as BaseInput } from '@base-ui/react/input'
import { cn } from '@/lib/utils'

type InputProps = Omit<React.ComponentProps<typeof BaseInput>, 'className'> & {
  className?: string
}

export function Input({ className, ...props }: InputProps): React.JSX.Element {
  return (
    <BaseInput
      data-slot="input"
      className={cn(
        'h-[var(--control-height)] w-full rounded-[var(--radius-control)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/75 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export type { InputProps }
