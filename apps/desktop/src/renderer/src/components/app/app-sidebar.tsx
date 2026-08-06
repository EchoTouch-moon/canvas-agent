import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Boxes,
  Braces,
  ChevronDown,
  CircleGauge,
  Database,
  FileCheck2,
  Layers3,
  LayoutDashboard,
  ListChecks,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Workflow
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface SidebarItem {
  readonly label: string
  readonly icon: LucideIcon
  readonly badge?: string
}

const workspaceItems: readonly SidebarItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Outline', icon: Braces },
  { label: 'Nodes', icon: Network },
  { label: 'Tasks', icon: ListChecks, badge: '6' },
  { label: 'Context', icon: Boxes },
  { label: 'Runs', icon: Workflow },
  { label: 'Artifacts', icon: FileCheck2 },
  { label: 'Baselines', icon: Layers3 },
  { label: 'Canvas', icon: Archive }
]

interface AppSidebarProps {
  readonly collapsed: boolean
  readonly activeItem: string
  readonly onNavigate: (label: string) => void
  readonly onToggle: () => void
  readonly projectName?: string
}

export function AppSidebar({
  collapsed,
  activeItem,
  onNavigate,
  onToggle,
  projectName = 'MUSICDB'
}: AppSidebarProps): React.JSX.Element {
  return (
    <aside
      aria-label="Application navigation"
      className={cn(
        'flex h-screen min-h-0 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200',
        collapsed ? 'w-[72px]' : 'w-[var(--sidebar-width)]'
      )}
    >
      <div
        className={cn(
          'flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b border-border',
          collapsed ? 'justify-center px-2' : 'px-4'
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] bg-primary text-primary-foreground shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)]">
          <CircleGauge className="size-4" aria-hidden="true" />
        </span>
        <span
          className={cn(
            'truncate text-[15px] font-semibold tracking-[-0.02em]',
            collapsed && 'sr-only'
          )}
        >
          Canvas Agent
        </span>
        <Tooltip content={collapsed ? 'Expand navigation' : 'Collapse navigation'} side="right">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-pressed={collapsed}
            className={cn('ml-auto text-muted-foreground', collapsed && 'ml-0')}
            onClick={onToggle}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </Button>
        </Tooltip>
      </div>

      <div className={cn('shrink-0 py-3', collapsed ? 'px-2' : 'px-3')}>
        <Tooltip content={`Project: ${projectName}`} side="right">
          <Button
            variant="outline"
            aria-label={`Current project: ${projectName}`}
            className={cn(
              'w-full justify-start gap-2 bg-sidebar',
              collapsed && 'size-9 justify-center px-0'
            )}
          >
            <Database className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className={cn('truncate', collapsed && 'sr-only')}>{projectName}</span>
            <ChevronDown
              className={cn('ml-auto size-3.5', collapsed && 'hidden')}
              aria-hidden="true"
            />
          </Button>
        </Tooltip>
      </div>

      <nav
        aria-label="Project navigation"
        className={cn('min-h-0 flex-1 overflow-y-auto', collapsed ? 'px-2' : 'px-2')}
      >
        <p
          className={cn(
            'px-2 pb-2 pt-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase',
            collapsed && 'sr-only'
          )}
        >
          Workspace
        </p>
        <ul className="space-y-0.5">
          {workspaceItems.map((item) => (
            <li key={item.label}>
              <Tooltip content={item.label} side="right">
                <button
                  type="button"
                  aria-current={activeItem === item.label ? 'page' : undefined}
                  aria-label={item.label}
                  className={cn(
                    'flex h-9 w-full cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
                    activeItem === item.label
                      ? 'bg-sidebar-accent text-primary'
                      : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
                    collapsed && 'justify-center px-0'
                  )}
                  onClick={() => onNavigate(item.label)}
                >
                  <item.icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className={cn('min-w-0 flex-1 truncate', collapsed && 'sr-only')}>
                    {item.label}
                  </span>
                  {item.badge && !collapsed ? (
                    <Badge className="h-4 min-w-4 justify-center px-1 text-[9px]">
                      {item.badge}
                    </Badge>
                  ) : null}
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      </nav>

      <div className={cn('shrink-0 border-t border-border py-2', collapsed ? 'px-2' : 'px-2')}>
        <Tooltip content="Settings" side="right">
          <button
            type="button"
            aria-label="Settings"
            aria-current={activeItem === 'Settings' ? 'page' : undefined}
            className={cn(
              'flex h-9 w-full cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              activeItem === 'Settings' && 'bg-sidebar-accent text-primary',
              collapsed && 'justify-center px-0'
            )}
            onClick={() => onNavigate('Settings')}
          >
            <Settings2 className="size-4 shrink-0" aria-hidden="true" />
            <span className={cn(collapsed && 'sr-only')}>Settings</span>
          </button>
        </Tooltip>
        {!collapsed ? (
          <div className="mt-3 flex items-center gap-2 px-2 pb-1">
            <span className="grid size-7 place-items-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">
              JD
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium">Jane Developer</p>
              <p className="truncate text-[10px] text-muted-foreground">Local workspace</p>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
