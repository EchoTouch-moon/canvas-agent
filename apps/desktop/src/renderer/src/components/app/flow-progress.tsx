import type { Dispatch } from 'react'
import { ArrowRight, Check, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import type { CoreFlowState } from '@/data/core-flow-fixture'
import type { CoreFlowCommand } from '@/state/core-flow-reducer'
import { getFlowStage, STAGE_ORDER, STAGE_ROUTES } from '@/state/flow-stage'
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
      <nav aria-label={t('progress.title')} className="mt-2 flex flex-wrap gap-1">
        {STAGE_ORDER.map((key, index) => {
          const isDone = index < stage.index - 1
          const isCurrent = index === stage.index - 1
          const stepRoute = STAGE_ROUTES[key]
          return (
            <button
              key={key}
              type="button"
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-[var(--radius-control)] border px-2 py-1 text-[10px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
                isCurrent
                  ? 'border-primary/40 bg-accent text-foreground'
                  : isDone
                    ? 'border-border bg-background text-foreground hover:bg-muted'
                    : 'border-border bg-muted/40 text-muted-foreground/70 hover:bg-muted'
              )}
              onClick={() => dispatch({ type: 'NAVIGATE', route: stepRoute })}
            >
              {isDone ? (
                <Check className="size-3 shrink-0 text-status-success" aria-hidden="true" />
              ) : (
                <span className="grid size-3 shrink-0 place-items-center text-[9px] font-semibold">
                  {index + 1}
                </span>
              )}
              <span className="truncate">{t(`progress.${key}`)}</span>
            </button>
          )
        })}
      </nav>
    </section>
  )
}

export type { FlowProgressProps }
