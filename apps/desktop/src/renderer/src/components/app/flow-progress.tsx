import type { Dispatch } from 'react'
import { ArrowRight, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import type { CoreFlowState } from '@/data/core-flow-fixture'
import type { CoreFlowCommand } from '@/state/core-flow-reducer'
import { getFlowStage } from '@/state/flow-stage'
import { cn } from '@/lib/utils'

interface FlowProgressProps {
  readonly state: CoreFlowState
  readonly dispatch: Dispatch<CoreFlowCommand>
}

export function FlowProgress({ state, dispatch }: FlowProgressProps): React.JSX.Element {
  const { t } = useI18n()
  const stage = getFlowStage(state, t)
  const route = stage.route

  return (
    <section className="rounded-[var(--radius-panel)] border border-border bg-card px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1.5">
          <Flag className="size-3.5 text-primary" aria-hidden="true" />
          <span className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            {t('progress.title')}
          </span>
        </div>
        <span className="text-[11px] font-medium">
          {t('progress.stepOf', { current: stage.index, total: stage.total })} · {stage.label}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {stage.next ? (
            <>
              <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                {t('progress.nextStep')}：
                <span className="font-medium text-foreground">{stage.next}</span>
              </span>
              {route ? (
                <Button size="sm" onClick={() => dispatch({ type: 'NAVIGATE', route })}>
                  {t('progress.go')} <ArrowRight className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </>
          ) : (
            <span className="text-[10px] font-semibold text-status-success">
              {t('progress.done')}
            </span>
          )}
        </div>
      </div>
      <div
        className="mt-2 flex gap-1"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={stage.total}
        aria-valuenow={stage.index}
        aria-label={t('progress.title')}
      >
        {Array.from({ length: stage.total }, (_, index) => {
          const isDone = index < stage.index - 1
          const isCurrent = index === stage.index - 1
          return (
            <span
              key={index}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                isDone ? 'bg-status-success' : isCurrent ? 'bg-primary' : 'bg-muted'
              )}
            />
          )
        })}
      </div>
    </section>
  )
}

export type { FlowProgressProps }
