import { Button as BaseButton } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex h-[var(--control-height)] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-control)] border text-[13px] font-medium outline-none transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border-primary bg-primary px-3 text-primary-foreground shadow-[0_1px_0_rgb(0_0_0/0.08)] hover:bg-primary/92',
        secondary:
          'border-border bg-secondary px-3 text-secondary-foreground hover:border-primary/35 hover:bg-accent hover:text-accent-foreground',
        outline:
          'border-border bg-background px-3 text-foreground hover:border-primary/35 hover:bg-accent',
        ghost:
          'border-transparent bg-transparent px-2 text-muted-foreground hover:bg-accent hover:text-foreground',
        destructive:
          'border-destructive bg-destructive px-3 text-destructive-foreground hover:bg-destructive/92',
        link: 'h-auto border-transparent bg-transparent px-0 text-primary underline-offset-4 hover:underline'
      },
      size: {
        xs: 'h-7 px-2 text-[11px]',
        sm: 'h-8 px-2.5 text-xs',
        default: 'h-[var(--control-height)]',
        icon: 'size-[var(--control-height)] p-0',
        'icon-sm': 'size-7 p-0'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

type ButtonProps = React.ComponentProps<typeof BaseButton> & VariantProps<typeof buttonVariants>

function Button({ className, variant, size, ...props }: ButtonProps): React.JSX.Element {
  return (
    <BaseButton
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button }
