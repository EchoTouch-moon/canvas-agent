import type {
  BaselineStatus,
  NodeType,
  RunOutcome,
  RunStatus,
  SnapshotFreshness,
  TaskStatus
} from '@canvas-agent/domain'
import {
  CheckCircle2,
  CircleAlert,
  FileBox,
  Keyboard,
  Layers3,
  Search,
  Sparkles
} from 'lucide-react'
import {
  BaselineStatusBadge,
  NodeTypeBadge,
  RunOutcomeBadge,
  RunStatusBadge,
  SnapshotFreshnessBadge,
  TaskStatusBadge
} from '@/components/domain'
import { EmptyState } from './empty-state'
import { ErrorState } from './error-state'
import { LoadingBoundary } from './loading-boundary'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'

const nodeTypes = [
  'IDEA',
  'GOAL',
  'REQUIREMENT',
  'CONSTRAINT',
  'DESIGN',
  'DECISION',
  'COMPONENT'
] satisfies readonly NodeType[]
const taskStatuses = [
  'DRAFT',
  'READY',
  'IN_PROGRESS',
  'WAITING_REVIEW',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED'
] satisfies readonly TaskStatus[]
const runStatuses = [
  'CREATED',
  'QUEUED',
  'PREPARING',
  'RUNNING',
  'WAITING_INPUT',
  'WAITING_APPROVAL',
  'PAUSED',
  'INTERRUPTED',
  'FINISHED'
] satisfies readonly RunStatus[]
const runOutcomes = [
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT'
] satisfies readonly RunOutcome[]
const baselineStatuses = ['DRAFT', 'ACTIVE', 'SUPERSEDED'] satisfies readonly BaselineStatus[]
const snapshotFreshness = [
  'CURRENT',
  'STALE',
  'DIVERGED',
  'ARCHIVED'
] satisfies readonly SnapshotFreshness[]

function GallerySection({
  title,
  eyebrow,
  children
}: {
  title: string
  eyebrow?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-[var(--radius-panel)] border border-border bg-card">
      <header className="flex min-h-11 items-center gap-3 border-b border-border px-3.5">
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="text-[9px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h3 className="truncate text-[12px] font-semibold">{title}</h3>
        </div>
      </header>
      <div className="p-3.5">{children}</div>
    </section>
  )
}

function StateRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>
}

export function ComponentGallery(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">
            Foundation / UI-001
          </p>
          <h2 className="mt-1 text-[16px] font-semibold tracking-[-0.025em]">
            Reusable workbench states
          </h2>
        </div>
        <div className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:flex">
          <Keyboard className="size-3.5" aria-hidden="true" />
          Keyboard-first
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <GallerySection title="Node vocabulary" eyebrow="Domain badges">
          <div className="flex flex-wrap gap-1.5">
            {nodeTypes.map((type) => (
              <NodeTypeBadge key={type} type={type} />
            ))}
          </div>
          <Separator className="my-3" />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <FileBox className="size-3.5 text-primary" aria-hidden="true" />
            <span>One typed component keeps node meaning consistent across pages.</span>
          </div>
        </GallerySection>

        <GallerySection title="Task and run vocabulary" eyebrow="Status semantics">
          <div className="space-y-2.5">
            <StateRow>
              {taskStatuses.map((status) => (
                <TaskStatusBadge key={status} status={status} />
              ))}
            </StateRow>
            <StateRow>
              {runStatuses.map((status) => (
                <RunStatusBadge key={status} status={status} />
              ))}
            </StateRow>
            <StateRow>
              {runOutcomes.map((outcome) => (
                <RunOutcomeBadge key={outcome} outcome={outcome} />
              ))}
            </StateRow>
            <StateRow>
              {baselineStatuses.map((status) => (
                <BaselineStatusBadge key={status} status={status} />
              ))}
            </StateRow>
            <StateRow>
              {snapshotFreshness.map((freshness) => (
                <SnapshotFreshnessBadge key={freshness} freshness={freshness} />
              ))}
            </StateRow>
          </div>
        </GallerySection>
      </div>

      <Tabs defaultValue="controls">
        <TabsList>
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="feedback">Feedback states</TabsTrigger>
        </TabsList>
        <TabsContent value="controls" className="pt-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <GallerySection title="Control rhythm" eyebrow="34px primary height">
              <div className="flex flex-wrap items-center gap-2">
                <Button>
                  <Sparkles className="size-3.5" aria-hidden="true" />
                  Primary action
                </Button>
                <Button variant="outline">Outline</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost" size="icon" aria-label="Example icon action">
                  <Search className="size-4" aria-hidden="true" />
                </Button>
                <Button variant="destructive" size="sm">
                  Destructive
                </Button>
                <Button disabled size="sm">
                  Disabled
                </Button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    aria-label="Search the component gallery"
                    placeholder="Search workspace..."
                    className="pl-8"
                  />
                </div>
                <Tooltip content="This action is available from the keyboard">
                  <Button variant="outline" size="icon" aria-label="Show keyboard hint">
                    <Keyboard className="size-4" aria-hidden="true" />
                  </Button>
                </Tooltip>
              </div>
            </GallerySection>

            <GallerySection title="Tokens in use" eyebrow="Surfaces and hierarchy">
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                {[
                  ['Canvas', 'bg-background'],
                  ['Workspace', 'bg-workspace'],
                  ['Raised', 'bg-card'],
                  ['Muted', 'bg-muted'],
                  ['Accent', 'bg-accent'],
                  ['Focus', 'ring-ring']
                ].map(([label, token]) => (
                  <div
                    key={label}
                    className="overflow-hidden rounded-[var(--radius-control)] border border-border"
                  >
                    <div
                      className={`h-7 ${token.includes('ring') ? 'bg-background ring-2 ring-inset ring-ring' : token}`}
                    />
                    <div className="border-t border-border px-2 py-1.5">
                      <p className="font-medium">{label}</p>
                      <p className="mt-0.5 truncate text-muted-foreground">{token}</p>
                    </div>
                  </div>
                ))}
              </div>
            </GallerySection>
          </div>
        </TabsContent>
        <TabsContent value="feedback" className="pt-4">
          <div className="grid gap-4 xl:grid-cols-3">
            <GallerySection title="Loading" eyebrow="Progressive state">
              <LoadingBoundary isLoading>
                <Skeleton className="h-2 w-28" />
              </LoadingBoundary>
            </GallerySection>
            <GallerySection title="Empty" eyebrow="No selection">
              <EmptyState
                compact
                icon={Layers3}
                title="Nothing selected"
                description="Pick an item to inspect details."
              />
            </GallerySection>
            <GallerySection title="Error" eyebrow="Recoverable state">
              <ErrorState
                compact
                title="Preview unavailable"
                description="Try loading the workspace again."
                onRetry={() => undefined}
              />
            </GallerySection>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex items-center gap-2 border-t border-border pt-3 text-[10px] text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-status-success" aria-hidden="true" />
        <span>Status meaning is always carried by icon, label, and semantic tone.</span>
        <CircleAlert className="ml-auto size-3.5 text-status-warning" aria-hidden="true" />
      </div>
    </div>
  )
}
