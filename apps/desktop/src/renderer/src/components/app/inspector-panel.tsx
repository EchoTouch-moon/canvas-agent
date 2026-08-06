import { History, Link2, PanelRightClose, Rows3, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/app/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'

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
  title = 'Inspector'
}: InspectorPanelProps): React.JSX.Element {
  if (collapsed) return <div className="sr-only" aria-hidden="true" />

  return (
    <aside aria-label={title} className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Workspace
          </p>
          <h2 className="truncate text-[13px] font-semibold">{title}</h2>
        </div>
        <Tooltip content="Collapse inspector" side="left">
          <Button variant="ghost" size="icon-sm" aria-label="Collapse inspector" onClick={onToggle}>
            <PanelRightClose className="size-4" aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>
      <Tabs defaultValue="details" className="min-h-0 flex-1">
        <TabsList className="w-full justify-start px-2">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="relations">Relations</TabsTrigger>
          <TabsTrigger value="context">Context</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TabsContent value="details" className="space-y-3">
            {children}
          </TabsContent>
          <TabsContent value="relations">
            <EmptyState
              icon={Link2}
              title="No relations selected"
              description="Select a node or task to inspect its connected work."
              compact
            />
          </TabsContent>
          <TabsContent value="context">
            <EmptyState
              icon={Rows3}
              title="Context is ready to compose"
              description="Choose an item in the workspace to see its context snapshot."
              compact
            />
          </TabsContent>
          <TabsContent value="history">
            <EmptyState
              icon={History}
              title="No history yet"
              description="Changes and decisions will appear here as the workspace evolves."
              compact
            />
          </TabsContent>
        </div>
      </Tabs>
      <div className="border-t border-border px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <ShieldCheck className="size-3.5 text-status-success" aria-hidden="true" />
          <span>Read-only inspector</span>
        </div>
      </div>
    </aside>
  )
}

export type { InspectorPanelProps }
