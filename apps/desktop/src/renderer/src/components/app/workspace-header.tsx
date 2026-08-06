import type { RuntimeInfo } from '@canvas-agent/contracts'
import { Bell, Command, Moon, PanelRight, PanelRightClose, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip } from '@/components/ui/tooltip'

interface WorkspaceHeaderProps {
  readonly runtimeInfo: RuntimeInfo | null
  readonly sectionLabel: string
  readonly title: string
  readonly description?: string
  readonly theme: 'light' | 'dark'
  readonly inspectorCollapsed: boolean
  readonly onOpenCommandPalette: () => void
  readonly onToggleTheme: () => void
  readonly onToggleInspector: () => void
}

export function WorkspaceHeader({
  runtimeInfo,
  sectionLabel,
  title,
  description,
  theme,
  inspectorCollapsed,
  onOpenCommandPalette,
  onToggleTheme,
  onToggleInspector
}: WorkspaceHeaderProps): React.JSX.Element {
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
          {runtimeInfo?.connected ? 'Connected' : 'Connecting'}
        </Badge>
        {runtimeInfo ? (
          <Badge tone="neutral">v{runtimeInfo.appVersion}</Badge>
        ) : (
          <Badge tone="neutral">Local</Badge>
        )}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Tooltip content="Command palette (Ctrl/Cmd K)">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open command palette"
            onClick={onOpenCommandPalette}
          >
            <Command className="size-4" aria-hidden="true" />
          </Button>
        </Tooltip>
        <Tooltip content={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? (
              <Sun className="size-4" aria-hidden="true" />
            ) : (
              <Moon className="size-4" aria-hidden="true" />
            )}
          </Button>
        </Tooltip>
        <Tooltip content="Notifications">
          <Button variant="ghost" size="icon" aria-label="View notifications">
            <Bell className="size-4" aria-hidden="true" />
          </Button>
        </Tooltip>
        <Tooltip content={inspectorCollapsed ? 'Open inspector' : 'Collapse inspector'}>
          <Button
            variant="outline"
            size="icon"
            aria-label={inspectorCollapsed ? 'Open inspector' : 'Collapse inspector'}
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
