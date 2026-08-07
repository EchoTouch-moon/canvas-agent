import { History, Link2, PanelRightClose, Rows3, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/app/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'
import { useI18n } from '@/lib/i18n'

interface InspectorPanelProps {
  readonly children: React.ReactNode
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly title?: string
}

export function InspectorPanel({
  children,
  collapsed,
  onToggle,
  title
}: InspectorPanelProps): React.JSX.Element {
  const { t } = useI18n()
  const resolvedTitle = title ?? t('inspector.title')

  if (collapsed) return <div className="sr-only" aria-hidden="true" />

  return (
    <aside
      aria-label={resolvedTitle}
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
    >
      <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t('inspector.workspace')}
          </p>
          <h2 className="truncate text-[13px] font-semibold">{resolvedTitle}</h2>
        </div>
        <Tooltip content={t('inspector.collapse')} side="left">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('inspector.collapse')}
            onClick={onToggle}
          >
            <PanelRightClose className="size-4" aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>
      <Tabs defaultValue="details" className="min-h-0 flex-1">
        <TabsList className="w-full justify-start px-2">
          <TabsTrigger value="details">{t('inspector.details')}</TabsTrigger>
          <TabsTrigger value="relations">{t('inspector.relations')}</TabsTrigger>
          <TabsTrigger value="context">{t('inspector.context')}</TabsTrigger>
          <TabsTrigger value="history">{t('inspector.history')}</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TabsContent value="details" className="space-y-3">
            {children}
          </TabsContent>
          <TabsContent value="relations">
            <EmptyState
              icon={Link2}
              title={t('inspector.noRelations')}
              description={t('inspector.noRelationsDesc')}
              compact
            />
          </TabsContent>
          <TabsContent value="context">
            <EmptyState
              icon={Rows3}
              title={t('inspector.contextReady')}
              description={t('inspector.contextReadyDesc')}
              compact
            />
          </TabsContent>
          <TabsContent value="history">
            <EmptyState
              icon={History}
              title={t('inspector.noHistory')}
              description={t('inspector.noHistoryDesc')}
              compact
            />
          </TabsContent>
        </div>
      </Tabs>
      <div className="border-t border-border px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <ShieldCheck className="size-3.5 text-status-success" aria-hidden="true" />
          <span>{t('inspector.readOnly')}</span>
        </div>
      </div>
    </aside>
  )
}

export type { InspectorPanelProps }
