import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RuntimeInfo } from '@canvas-agent/contracts'
import {
  Boxes,
  History,
  LayoutDashboard,
  Layers3,
  ListChecks,
  Moon,
  Settings2,
  Sun
} from 'lucide-react'
import { AppSidebar } from './app-sidebar'
import { CommandPalette, type CommandItem } from './command-palette'
import { InspectorPanel } from './inspector-panel'
import { WorkspaceHeader } from './workspace-header'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Resizable, ResizableHandle, ResizablePanel } from '@/components/ui/resizable'

type Theme = 'light' | 'dark'

interface AppShellProps {
  readonly runtimeInfo: RuntimeInfo | null
  readonly inspector: React.ReactNode
  readonly children: React.ReactNode
  readonly sectionLabel?: string
  readonly title?: string
  readonly description?: string
  readonly projectName?: string
}

const commandItems: readonly CommandItem[] = [
  {
    id: 'dashboard',
    label: 'Go to dashboard',
    hint: 'Project health and next actions',
    shortcut: 'G D',
    icon: LayoutDashboard
  },
  {
    id: 'tasks',
    label: 'Open tasks',
    hint: 'Review active work and acceptance criteria',
    shortcut: 'G T',
    icon: ListChecks
  },
  {
    id: 'context',
    label: 'Open context composer',
    hint: 'Prepare a snapshot for a task',
    shortcut: 'G C',
    icon: Boxes
  },
  {
    id: 'runs',
    label: 'Open run timeline',
    hint: 'Inspect execution evidence',
    shortcut: 'G R',
    icon: History
  },
  {
    id: 'baselines',
    label: 'Review baselines',
    hint: 'See immutable project anchors',
    shortcut: 'G B',
    icon: Layers3
  },
  {
    id: 'settings',
    label: 'Open settings',
    hint: 'Configure this local workspace',
    shortcut: 'G S',
    icon: Settings2
  },
  { id: 'theme', label: 'Toggle theme', hint: 'Switch between light and dark surfaces', icon: Moon }
]

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem('canvas-agent-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function isCompactViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches
}

export function AppShell({
  runtimeInfo,
  inspector,
  children,
  sectionLabel = 'MUSICDB / Overview',
  title = 'Project Dashboard',
  description,
  projectName = 'MUSICDB'
}: AppShellProps): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [activeItem, setActiveItem] = useState('Dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isCompactViewport)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(isCompactViewport)
  const [inspectorWidth, setInspectorWidth] = useState(312)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1180px)')
    const handleCompactChange = (event: MediaQueryListEvent): void => {
      if (!event.matches) return
      setSidebarCollapsed(true)
      setInspectorCollapsed(true)
    }
    media.addEventListener('change', handleCompactChange)
    return () => media.removeEventListener('change', handleCompactChange)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem('canvas-agent-theme', theme)
  }, [theme])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandPaletteOpen(true)
      }
      if (event.key === 'Escape') setCommandPaletteOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleResize = useCallback((delta: number): void => {
    setInspectorWidth((current) => Math.min(420, Math.max(260, current - delta)))
  }, [])

  const handleCommandSelect = useCallback((command: CommandItem): void => {
    const navigation: Record<string, string> = {
      dashboard: 'Dashboard',
      tasks: 'Tasks',
      context: 'Context',
      runs: 'Runs',
      baselines: 'Baselines',
      settings: 'Settings'
    }
    if (command.id === 'theme') {
      setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
    } else if (navigation[command.id]) {
      setActiveItem(navigation[command.id])
    }
    setCommandPaletteOpen(false)
  }, [])

  const commandItemsWithTheme = useMemo(
    () =>
      commandItems.map((command) =>
        command.id === 'theme' ? { ...command, icon: theme === 'dark' ? Sun : Moon } : command
      ),
    [theme]
  )

  return (
    <>
      <Resizable className="h-screen w-screen overflow-hidden bg-background text-foreground">
        <AppSidebar
          collapsed={sidebarCollapsed}
          activeItem={activeItem}
          onNavigate={setActiveItem}
          onToggle={() => setSidebarCollapsed((current) => !current)}
          projectName={projectName}
        />
        <section className="flex min-w-0 flex-1 flex-col bg-workspace">
          <WorkspaceHeader
            runtimeInfo={runtimeInfo}
            sectionLabel={sectionLabel}
            title={title}
            description={description}
            theme={theme}
            inspectorCollapsed={inspectorCollapsed}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            onToggleInspector={() => setInspectorCollapsed((current) => !current)}
          />
          <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
            <main className="mx-auto w-full max-w-[1240px] p-5 lg:p-6">{children}</main>
          </ScrollArea>
        </section>
        {!inspectorCollapsed ? (
          <ResizableHandle
            value={inspectorWidth}
            min={260}
            max={420}
            label="Resize inspector"
            onResize={handleResize}
          />
        ) : null}
        <ResizablePanel
          basis={inspectorCollapsed ? 0 : inspectorWidth}
          minSize={inspectorCollapsed ? 0 : 260}
          className={
            inspectorCollapsed
              ? 'w-0 overflow-hidden'
              : 'overflow-hidden border-l border-border bg-background'
          }
        >
          <InspectorPanel
            collapsed={inspectorCollapsed}
            onToggle={() => setInspectorCollapsed(true)}
            title="Project inspector"
          >
            {inspector}
          </InspectorPanel>
        </ResizablePanel>
      </Resizable>
      <CommandPalette
        open={commandPaletteOpen}
        commands={commandItemsWithTheme}
        onOpenChange={setCommandPaletteOpen}
        onSelect={handleCommandSelect}
      />
    </>
  )
}

export type { AppShellProps, Theme }
