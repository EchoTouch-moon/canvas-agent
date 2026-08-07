import type { RuntimeInfo } from '@canvas-agent/contracts'
import {
  Bell,
  Command,
  HelpCircle,
  Languages,
  Moon,
  PanelRight,
  PanelRightClose,
  Sun
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip } from '@/components/ui/tooltip'
import { useI18n, type Locale } from '@/lib/i18n'

interface WorkspaceHeaderProps {
  readonly runtimeInfo: RuntimeInfo | null
  readonly sectionLabel: string
  readonly title: string
  readonly description?: string
  readonly theme: 'light' | 'dark'
  readonly inspectorCollapsed: boolean
  readonly locale: Locale
  readonly onOpenCommandPalette: () => void
  readonly onToggleTheme: () => void
  readonly onToggleInspector: () => void
  readonly onToggleLanguage: () => void
  readonly onOpenGuide: () => void
}

export function WorkspaceHeader({
  runtimeInfo,
  sectionLabel,
  title,
  description,
  theme,
  inspectorCollapsed,
  locale,
  onOpenCommandPalette,
  onToggleTheme,
  onToggleInspector,
  onToggleLanguage,
  onOpenGuide
}: WorkspaceHeaderProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <header className="flex min-h-[var(--header-height)] shrink-0 items-center border-b border-border bg-background/95 px-5 backdrop-blur">
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {sectionLabel}
        </p>
        <h1 className="truncate text-[17px] font-semibold tracking-[-0.02em]">{title}</h1>
        {description ? <p className="sr-only">{description}</p> : null}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Badge tone={runtimeInfo?.connected ? 'success' : 'warning'}>
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {runtimeInfo?.connected ? t('header.connected') : t('header.connecting')}
        </Badge>
        {runtimeInfo ? (
          <Badge tone="neutral">v{runtimeInfo.appVersion}</Badge>
        ) : (
          <Badge tone="neutral">{t('header.local')}</Badge>
        )}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Tooltip content={t('header.commandPaletteHint')}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('header.openCommandPalette')}
            onClick={onOpenCommandPalette}
          >
            <Command className="size-4" aria-hidden="true" />
          </Button>
        </Tooltip>
        <Tooltip content={theme === 'dark' ? t('header.switchLight') : t('header.switchDark')}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={theme === 'dark' ? t('header.switchLight') : t('header.switchDark')}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? (
              <Sun className="size-4" aria-hidden="true" />
            ) : (
              <Moon className="size-4" aria-hidden="true" />
            )}
          </Button>
        </Tooltip>
        <Tooltip content={locale === 'zh' ? 'English' : '中文'}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={locale === 'zh' ? 'English' : '中文'}
            onClick={onToggleLanguage}
          >
            <Languages className="size-4" aria-hidden="true" />
          </Button>
        </Tooltip>
        <Tooltip content={t('header.guide')}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('header.openGuide')}
            onClick={onOpenGuide}
          >
            <HelpCircle className="size-4" aria-hidden="true" />
          </Button>
        </Tooltip>
        <Tooltip content={t('header.notifications')}>
          <Button variant="ghost" size="icon" aria-label={t('header.viewNotifications')}>
            <Bell className="size-4" aria-hidden="true" />
          </Button>
        </Tooltip>
        <Tooltip
          content={inspectorCollapsed ? t('header.openInspector') : t('header.collapseInspector')}
        >
          <Button
            variant="outline"
            size="icon"
            aria-label={
              inspectorCollapsed ? t('header.openInspector') : t('header.collapseInspector')
            }
            aria-pressed={!inspectorCollapsed}
            onClick={onToggleInspector}
          >
            {inspectorCollapsed ? (
              <PanelRight className="size-4" aria-hidden="true" />
            ) : (
              <PanelRightClose className="size-4" aria-hidden="true" />
            )}
          </Button>
        </Tooltip>
      </div>
    </header>
  )
}

export type { WorkspaceHeaderProps }
