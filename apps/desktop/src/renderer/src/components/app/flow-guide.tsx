import { CheckCircle2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

const guideSteps = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'] as const

interface FlowGuideProps {
  readonly open: boolean
  readonly onClose: () => void
}

export function FlowGuide({ open, onClose }: FlowGuideProps): React.JSX.Element | null {
  const { t } = useI18n()

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="flow-guide-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-foreground/25 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="w-full max-w-[560px] overflow-hidden rounded-[var(--radius-panel)] border border-border bg-popover shadow-[0_18px_60px_rgb(15_23_42/0.28)]">
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-primary text-primary-foreground">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="flow-guide-title" className="text-[15px] font-semibold">
              {t('guide.title')}
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('guide.subtitle')}</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={t('palette.close')} onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </header>
        <div className="max-h-[min(520px,70vh)] overflow-y-auto px-5 py-4">
          <p className="rounded-[var(--radius-control)] border border-status-info/30 bg-status-info/8 px-3 py-2.5 text-[11px] leading-5 text-status-info">
            <span className="font-semibold">{t('guide.principleTitle')}：</span>
            {t('guide.principle')}
          </p>
          <h3 className="mt-4 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t('guide.stepsTitle')}
          </h3>
          <ol className="mt-2 space-y-1.5">
            {guideSteps.map((step, index) => (
              <li key={step} className="flex items-start gap-2 text-[12px]">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 leading-5">{t(`guide.${step}`)}</span>
              </li>
            ))}
          </ol>
        </div>
        <footer className="flex justify-end border-t border-border px-5 py-3">
          <Button size="sm" onClick={onClose}>
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            {t('guide.getStarted')}
          </Button>
        </footer>
      </section>
    </div>
  )
}

export type { FlowGuideProps }
