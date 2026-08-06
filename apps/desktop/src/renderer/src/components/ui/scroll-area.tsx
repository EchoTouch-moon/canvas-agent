import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import { cn } from '@/lib/utils'

interface ScrollAreaProps extends React.ComponentProps<'div'> {
  readonly viewportClassName?: string
}

export function ScrollArea({
  className,
  viewportClassName,
  children,
  ...props
}: ScrollAreaProps): React.JSX.Element {
  return (
    <BaseScrollArea.Root
      data-slot="scroll-area"
      className={cn('relative min-h-0 overflow-hidden', className)}
      {...props}
    >
      <BaseScrollArea.Viewport className={cn('size-full overscroll-contain', viewportClassName)}>
        <BaseScrollArea.Content className="min-w-full">{children}</BaseScrollArea.Content>
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        orientation="vertical"
        className="m-0.5 flex w-1.5 touch-none select-none rounded-full bg-transparent p-px opacity-0 transition-opacity hover:opacity-100 data-[hovering]:opacity-100 data-[scrolling]:opacity-100"
      >
        <BaseScrollArea.Thumb className="relative flex-1 rounded-full bg-muted-foreground/40" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Scrollbar
        orientation="horizontal"
        className="m-0.5 flex h-1.5 touch-none select-none rounded-full bg-transparent p-px opacity-0 transition-opacity hover:opacity-100 data-[hovering]:opacity-100 data-[scrolling]:opacity-100"
      >
        <BaseScrollArea.Thumb className="relative flex-1 rounded-full bg-muted-foreground/40" />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  )
}

export type { ScrollAreaProps }
