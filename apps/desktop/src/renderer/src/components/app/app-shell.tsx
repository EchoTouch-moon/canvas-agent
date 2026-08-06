import {
  Bell,
  Boxes,
  Braces,
  ChevronDown,
  CircleGauge,
  Command,
  Database,
  FileCheck2,
  GitBranch,
  History,
  LayoutDashboard,
  ListChecks,
  Network,
  PanelLeftClose,
  Settings2
} from 'lucide-react'
import type { RuntimeInfo } from '@canvas-agent/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navigation = [
  { label: 'Dashboard', icon: LayoutDashboard, current: true },
  { label: 'Outline', icon: Braces, current: false },
  { label: 'Tasks', icon: ListChecks, current: false },
  { label: 'Context', icon: Boxes, current: false },
  { label: 'Runs', icon: History, current: false },
  { label: 'Artifacts', icon: FileCheck2, current: false },
  { label: 'Relations', icon: Network, current: false }
] as const

interface AppShellProps {
  readonly runtimeInfo: RuntimeInfo | null
  readonly inspector: React.ReactNode
  readonly children: React.ReactNode
}

export function AppShell({ runtimeInfo, inspector, children }: AppShellProps): React.JSX.Element {
  return (
    <div className="grid min-h-screen grid-cols-[240px_minmax(0,1fr)_280px] bg-background text-foreground max-[1180px]:grid-cols-[72px_minmax(0,1fr)]">
      <aside className="flex min-h-screen flex-col border-r border-border bg-sidebar max-[1180px]:items-center">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4 max-[1180px]:px-2">
          <span className="grid size-7 place-items-center rounded-[7px] bg-primary text-primary-foreground shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)]">
            <CircleGauge className="size-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.02em] max-[1180px]:hidden">
            Canvas Agent
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Collapse navigation"
            className="ml-auto max-[1180px]:hidden"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>

        <div className="p-3 max-[1180px]:px-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 bg-sidebar max-[1180px]:size-9 max-[1180px]:px-0"
          >
            <Database className="size-4 text-primary" />
            <span className="max-[1180px]:hidden">MUSICDB</span>
            <ChevronDown className="ml-auto size-3.5 max-[1180px]:hidden" />
          </Button>
        </div>

        <nav aria-label="Project navigation" className="flex-1 px-2 py-1">
          <p className="px-2 pb-2 pt-3 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase max-[1180px]:sr-only">
            Workspace
          </p>
          <ul className="space-y-0.5">
            {navigation.map(({ label, icon: Icon, current }) => (
              <li key={label}>
                <button
                  type="button"
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex h-8 w-full cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/45 max-[1180px]:size-9 max-[1180px]:justify-center max-[1180px]:px-0',
                    current
                      ? 'bg-sidebar-accent text-primary'
                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="max-[1180px]:sr-only">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-border p-2">
          <button
            type="button"
            className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 text-[13px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground max-[1180px]:justify-center"
          >
            <Settings2 className="size-4" />
            <span className="max-[1180px]:sr-only">Settings</span>
          </button>
          <a
            href="https://deerflow.tech"
            target="_blank"
            rel="noreferrer"
            className="mt-2 block px-2 text-[9px] tracking-[0.08em] text-muted-foreground/60 hover:text-muted-foreground max-[1180px]:sr-only"
          >
            Created by Deerflow
          </a>
        </div>
      </aside>

      <section className="min-w-0 bg-workspace">
        <header className="flex h-14 items-center border-b border-border bg-background/95 px-6 backdrop-blur">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              MUSICDB / Overview
            </p>
            <h1 className="text-[17px] font-semibold tracking-[-0.02em]">Project Dashboard</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge tone={runtimeInfo?.connected ? 'success' : 'neutral'}>
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {runtimeInfo?.connected ? 'Local runtime' : 'Connecting'}
            </Badge>
            {runtimeInfo ? <Badge>v{runtimeInfo.appVersion}</Badge> : null}
            <Button variant="outline" size="icon" aria-label="Open command palette">
              <Command className="size-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="View notifications">
              <Bell className="size-4" />
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-[1060px] p-6">{children}</main>
      </section>

      <aside className="min-h-screen border-l border-border bg-background max-[1180px]:hidden">
        <div className="flex h-14 items-center border-b border-border px-4">
          <GitBranch className="mr-2 size-4 text-muted-foreground" />
          <h2 className="text-[13px] font-semibold">Project inspector</h2>
        </div>
        <div className="p-3">{inspector}</div>
      </aside>
    </div>
  )
}
