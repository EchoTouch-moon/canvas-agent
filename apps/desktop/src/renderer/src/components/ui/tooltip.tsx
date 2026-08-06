import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { cn } from '@/lib/utils'

interface TooltipProps {
  readonly children: React.ReactElement
  readonly content: React.ReactNode
  readonly side?: 'top' | 'right' | 'bottom' | 'left'
  readonly delay?: number
}

export function Tooltip({
  children,
  content,
  side = 'top',
  delay = 450
}: TooltipProps): React.JSX.Element {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger delay={delay} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} className="z-[var(--z-tooltip)]">
          <BaseTooltip.Popup
            className={cn(
              'max-w-64 rounded-[var(--radius-control)] border border-border bg-popover px-2 py-1.5 text-[11px] font-medium text-popover-foreground shadow-[0_8px_24px_rgb(15_23_42/0.18)] outline-none'
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}

export type { TooltipProps }
