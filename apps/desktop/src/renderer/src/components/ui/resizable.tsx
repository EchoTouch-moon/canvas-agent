import { useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'

interface ResizableProps extends React.ComponentProps<'div'> {
  readonly direction?: 'horizontal' | 'vertical'
}

interface ResizablePanelProps extends React.ComponentProps<'div'> {
  readonly basis?: string | number
  readonly minSize?: string | number
}

interface ResizableHandleProps {
  readonly orientation?: 'vertical' | 'horizontal'
  readonly value?: number
  readonly min?: number
  readonly max?: number
  readonly label?: string
  readonly onResize?: (delta: number) => void
  readonly className?: string
}

export function Resizable({
  direction = 'horizontal',
  className,
  ...props
}: ResizableProps): React.JSX.Element {
  return (
    <div
      data-slot="resizable"
      data-direction={direction}
      className={cn(
        'flex min-h-0 min-w-0',
        direction === 'horizontal' ? 'flex-row' : 'flex-col',
        className
      )}
      {...props}
    />
  )
}

export function ResizablePanel({
  basis,
  minSize,
  className,
  style,
  ...props
}: ResizablePanelProps): React.JSX.Element {
  return (
    <div
      data-slot="resizable-panel"
      className={cn('min-h-0 min-w-0', className)}
      style={{
        flex:
          basis !== undefined
            ? `0 1 ${typeof basis === 'number' ? `${basis}px` : basis}`
            : '1 1 0%',
        minWidth: minSize,
        ...style
      }}
      {...props}
    />
  )
}

export function ResizableHandle({
  orientation = 'vertical',
  value,
  min = 0,
  max = 100,
  label = 'Resize panel',
  onResize,
  className
}: ResizableHandleProps): React.JSX.Element {
  const pointerStart = useRef<number | null>(null)

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!onResize) return
      pointerStart.current = orientation === 'vertical' ? event.clientX : event.clientY
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [onResize, orientation]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!onResize || pointerStart.current === null) return
      const current = orientation === 'vertical' ? event.clientX : event.clientY
      const delta = current - pointerStart.current
      pointerStart.current = current
      onResize(delta)
    },
    [onResize, orientation]
  )

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    pointerStart.current = null
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onResize) return
      const positive =
        orientation === 'vertical' ? event.key === 'ArrowRight' : event.key === 'ArrowDown'
      const negative =
        orientation === 'vertical' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp'
      if (positive || negative) {
        event.preventDefault()
        onResize(positive ? 16 : -16)
      }
      if (event.key === 'Home') {
        event.preventDefault()
        onResize(min - (value ?? min))
      }
      if (event.key === 'End') {
        event.preventDefault()
        onResize(max - (value ?? max))
      }
    },
    [max, min, onResize, orientation, value]
  )

  return (
    <div
      data-slot="resizable-handle"
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={onResize ? 0 : undefined}
      className={cn(
        'group relative shrink-0 outline-none',
        orientation === 'vertical' ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize',
        'focus-visible:after:absolute focus-visible:after:inset-0 focus-visible:after:bg-ring/20',
        className
      )}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute rounded-full bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary',
          orientation === 'vertical'
            ? 'inset-y-0.5 left-1/2 w-px -translate-x-1/2'
            : 'inset-x-0.5 top-1/2 h-px -translate-y-1/2'
        )}
      />
    </div>
  )
}

export type { ResizableHandleProps, ResizablePanelProps, ResizableProps }
