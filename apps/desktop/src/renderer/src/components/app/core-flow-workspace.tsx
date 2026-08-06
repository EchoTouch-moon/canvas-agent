import { useMemo, useReducer, useState } from 'react'
import type { Dispatch, ReactNode } from 'react'
import type { RuntimeInfo } from '@canvas-agent/contracts'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Code2,
  FileCheck2,
  FileClock,
  FileText,
  Filter,
  GitBranch,
  Info,
  Layers3,
  LockKeyhole,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TestTube2,
  TriangleAlert,
  XCircle
} from 'lucide-react'
import { AppShell } from './app-shell'
import { EmptyState } from './empty-state'
import { PageToolbar } from './page-toolbar'
import {
  BaselineStatusBadge,
  NodeTypeBadge,
  RunOutcomeBadge,
  RunStatusBadge,
  SnapshotFreshnessBadge,
  StatusBadge,
  TaskStatusBadge,
  type StatusTone
} from '@/components/domain'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  createCoreFlowFixtureService,
  type ArtifactReviewStatus,
  type ArtifactTab,
  type ContextCandidate,
  type CoreFlowNode,
  type CoreFlowState,
  type FlowRoute,
  type NoticeTone
} from '@/data/core-flow-fixture'
import {
  coreFlowReducer,
  getFreezeBlockers,
  getSelectedContextItems,
  getSelectedContextTokens,
  type CoreFlowCommand
} from '@/state/core-flow-reducer'
import { cn } from '@/lib/utils'

interface FlowScreenProps {
  readonly state: CoreFlowState
  readonly dispatch: Dispatch<CoreFlowCommand>
}

interface SectionProps {
  readonly title: string
  readonly icon: LucideIcon
  readonly eyebrow?: string
  readonly action?: ReactNode
  readonly className?: string
  readonly children: ReactNode
}

const routeMeta: Record<FlowRoute, { label: string; title: string; description: string }> = {
  dashboard: {
    label: 'Dashboard',
    title: 'Project dashboard',
    description: 'Exceptions and next actions for the MUSICDB core flow.'
  },
  outline: {
    label: 'Outline',
    title: 'Project outline',
    description: 'Typed nodes make the task intent and constraints inspectable.'
  },
  node: {
    label: 'Nodes',
    title: 'Node workspace',
    description: 'Review one versioned node before composing task context.'
  },
  task: {
    label: 'Tasks',
    title: 'Task workspace',
    description: 'TaskSpecVersion, acceptance criteria, snapshot and Run evidence stay distinct.'
  },
  context: {
    label: 'Context',
    title: 'Context composer',
    description: 'Order selected evidence, resolve conflicts and freeze a read-only snapshot.'
  },
  run: {
    label: 'Runs',
    title: 'Run result / timeline',
    description: 'Run status and outcome are visible separately from Task review state.'
  },
  artifact: {
    label: 'Artifacts',
    title: 'Artifact review',
    description: 'Apply, accept, reject and request changes are independent review actions.'
  },
  baseline: {
    label: 'Baselines',
    title: 'Baseline draft review',
    description: 'A completed Task still requires a separate Baseline activation confirmation.'
  }
}

const sidebarRoutes: Readonly<Record<string, FlowRoute>> = {
  Dashboard: 'dashboard',
  Outline: 'outline',
  Nodes: 'node',
  Tasks: 'task',
  Context: 'context',
  Runs: 'run',
  Artifacts: 'artifact',
  Baselines: 'baseline'
}

const routeOrder: readonly FlowRoute[] = [
  'dashboard',
  'outline',
  'node',
  'task',
  'context',
  'run',
  'artifact',
  'baseline'
]

const artifactTone: Record<ArtifactReviewStatus, StatusTone> = {
  READY: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  CHANGES_REQUESTED: 'warning'
}

const artifactLabel: Record<ArtifactReviewStatus, string> = {
  READY: 'Ready for review',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  CHANGES_REQUESTED: 'Changes requested'
}

const noticeIcon: Record<NoticeTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: XCircle
}

function Section({
  title,
  icon: Icon,
  eyebrow,
  action,
  className,
  children
}: SectionProps): React.JSX.Element {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-[var(--radius-panel)] border border-border bg-card',
        className
      )}
    >
      <header className="flex min-h-11 items-center gap-2 border-b border-border px-3.5">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="truncate text-[12px] font-semibold">{title}</h2>
        </div>
        {action}
      </header>
      <div className="p-3.5">{children}</div>
    </section>
  )
}

function Notice({ notice }: Pick<CoreFlowState, 'notice'>): React.JSX.Element | null {
  if (!notice) return null
  const Icon = noticeIcon[notice.tone]
  const toneClass = {
    info: 'border-status-info/30 bg-status-info/8 text-status-info',
    success: 'border-status-success/30 bg-status-success/8 text-status-success',
    warning: 'border-status-warning/30 bg-status-warning/8 text-status-warning',
    danger: 'border-status-danger/30 bg-status-danger/8 text-status-danger'
  }[notice.tone]

  return (
    <div
      role={notice.tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2.5',
        toneClass
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[12px] font-semibold">{notice.title}</p>
        <p className="mt-0.5 text-[11px] leading-5 text-foreground/75">{notice.message}</p>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  detail
}: {
  readonly label: string
  readonly value: string
  readonly detail: string
}): React.JSX.Element {
  return (
    <div className="min-w-0 border-l border-border pl-3 first:border-l-0 first:pl-0">
      <p className="text-[9px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 truncate text-[16px] font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{detail}</p>
    </div>
  )
}

function RouteBreadcrumb({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  return (
    <nav
      aria-label="Core flow screens"
      className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1"
    >
      {routeOrder.map((route, index) => (
        <div key={route} className="flex shrink-0 items-center gap-1">
          {index > 0 ? (
            <ChevronRight className="size-3 text-muted-foreground/60" aria-hidden="true" />
          ) : null}
          <button
            type="button"
            aria-current={state.route === route ? 'page' : undefined}
            className={cn(
              'rounded-[var(--radius-control)] px-2 py-1 text-[10px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
              state.route === route
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
            onClick={() => dispatch({ type: 'NAVIGATE', route })}
          >
            {routeMeta[route].label}
          </button>
        </div>
      ))}
    </nav>
  )
}

function FlowInspector({ state }: { readonly state: CoreFlowState }): React.JSX.Element {
  const selectedTokens = getSelectedContextTokens(state)
  const selectedCount = state.selectedContextItemIds.length

  return (
    <div className="space-y-3">
      <Section title="Formal gates" icon={ShieldCheck} eyebrow="Explicit transitions">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Snapshot</span>
            <StatusBadge status={state.snapshot.status} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Run status</span>
            <RunStatusBadge status={state.run.status} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Run outcome</span>
            {state.run.outcome ? (
              <RunOutcomeBadge outcome={state.run.outcome} />
            ) : (
              <Badge>Pending</Badge>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Task</span>
            <TaskStatusBadge status={state.task.status} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Artifact</span>
            <Badge tone={artifactTone[state.artifact.reviewStatus]}>
              {artifactLabel[state.artifact.reviewStatus]}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Baseline</span>
            <BaselineStatusBadge status={state.baseline.status} />
          </div>
        </div>
      </Section>

      <Section title="Context snapshot" icon={Layers3}>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Selected" value={`${selectedCount}`} detail="items" />
          <Stat
            label="Tokens"
            value={selectedTokens.toLocaleString()}
            detail={`of ${state.snapshot.tokenBudget.toLocaleString()}`}
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <SnapshotFreshnessBadge freshness={state.snapshot.freshness} />
          <span className="truncate text-[10px] text-muted-foreground">
            {state.snapshot.revision}
          </span>
        </div>
      </Section>

      <Section title="Read-only reminder" icon={LockKeyhole}>
        <p className="text-[11px] leading-5 text-muted-foreground">
          Freeze, accept, complete and activate are separate commands. A successful Run never skips
          a review gate.
        </p>
      </Section>
    </div>
  )
}

function DashboardScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const passedCriteria = state.task.criteria.filter((criterion) => criterion.passed).length
  const previousRun = state.priorRuns[0]

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow="Project dashboard / core flow"
        title="A clear path through review"
        description="MUSICDB stays focused on the next exception while preserving each formal gate."
        meta={
          <>
            <Badge tone="accent">Typed fixture</Badge>
            <Badge tone="neutral">Mock service</Badge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'outline' })}
          >
            Open outline <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        }
      />

      <section className="rounded-[var(--radius-panel)] border border-border bg-card p-4">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-foreground text-base font-semibold text-background">
            M
          </span>
          <div className="min-w-[220px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold">{state.project.name}</h2>
              <Badge tone="success">Workspace ready</Badge>
            </div>
            <p className="mt-1 max-w-xl text-[12px] leading-5 text-muted-foreground">
              {state.project.description}
            </p>
          </div>
          <div className="grid min-w-[300px] flex-1 grid-cols-3 gap-4 sm:max-w-[420px]">
            <Stat label="Task" value={state.task.id} detail={routeMeta.task.label} />
            <Stat
              label="Snapshot"
              value={`${state.selectedContextItemIds.length}`}
              detail="selected items"
            />
            <Stat label="Baseline" value={state.project.activeBaseline} detail="active anchor" />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Active task"
          icon={FileClock}
          action={<TaskStatusBadge status={state.task.status} />}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">{state.task.title}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {state.task.objective}
              </p>
            </div>
            <Button size="sm" onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}>
              Open task <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
            <div
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`${passedCriteria} of ${state.task.criteria.length} criteria passed`}
              aria-valuemin={0}
              aria-valuemax={state.task.criteria.length}
              aria-valuenow={passedCriteria}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${(passedCriteria / state.task.criteria.length) * 100}%` }}
              />
            </div>
            <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
              {passedCriteria}/{state.task.criteria.length} criteria
            </span>
          </div>
        </Section>

        <Section
          title="Latest exception"
          icon={TriangleAlert}
          action={
            previousRun ? (
              <RunOutcomeBadge outcome={previousRun.outcome ?? 'PARTIAL'} />
            ) : (
              <Badge>None</Badge>
            )
          }
        >
          {previousRun ? (
            <div className="flex items-start gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-status-warning/25 bg-status-warning/10 text-status-warning">
                <AlertTriangle className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[12px] font-medium">{previousRun.id}</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Previous evidence is partial. Review the failed compatibility test after producing
                  a new result.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => dispatch({ type: 'NAVIGATE', route: 'run' })}
              >
                Review run
              </Button>
            </div>
          ) : (
            <EmptyState
              title="No previous exception"
              description="The fixture has no earlier Run evidence."
              compact
            />
          )}
        </Section>
      </div>

      <Section title="Next suggested action" icon={Sparkles} eyebrow="No hidden automation">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium">
              Inspect the task, then compose a snapshot deliberately.
            </p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Each screen exposes the next command without silently freezing context, accepting
              evidence or changing the Baseline.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
          >
            Continue task flow
          </Button>
        </div>
      </Section>
    </div>
  )
}

function NodeRow({
  node,
  selected,
  onSelect
}: {
  readonly node: CoreFlowNode
  readonly selected: boolean
  readonly onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
        selected ? 'border-primary/35 bg-accent' : 'border-border bg-background hover:bg-muted'
      )}
      onClick={onSelect}
    >
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] bg-muted text-muted-foreground">
        <CircleDot className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold">{node.title}</span>
          <NodeTypeBadge type={node.type} />
        </span>
        <span className="mt-1 block truncate text-[10px] text-muted-foreground">
          {node.summary}
        </span>
      </span>
      <span className="shrink-0 text-[10px] font-medium text-muted-foreground">{node.version}</span>
    </button>
  )
}

function OutlineScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const selectedNode =
    state.nodes.find((node) => node.id === state.selectedNodeId) ?? state.nodes[0]

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow="Project outline / typed graph"
        title="Project outline"
        description="Start from project meaning, then inspect the representative node that anchors TASK-011."
        actions={
          <Button onClick={() => dispatch({ type: 'NAVIGATE', route: 'node' })}>
            Open node workspace <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Section title="MUSICDB node outline" icon={GitBranch} eyebrow="4 active versions">
          <div className="space-y-2">
            {state.nodes.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                selected={node.id === selectedNode.id}
                onSelect={() => dispatch({ type: 'SELECT_NODE', nodeId: node.id })}
              />
            ))}
          </div>
        </Section>
        <Section
          title="Selected node"
          icon={CircleDot}
          action={<NodeTypeBadge type={selectedNode.type} />}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-[16px] font-semibold">{selectedNode.title}</h3>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {selectedNode.summary}
              </p>
            </div>
            <Badge tone="success">{selectedNode.lifecycle}</Badge>
          </div>
          <Separator className="my-3" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
            <dt className="text-muted-foreground">Node ID</dt>
            <dd className="truncate text-right font-mono">{selectedNode.id}</dd>
            <dt className="text-muted-foreground">Current version</dt>
            <dd className="text-right font-medium">{selectedNode.version}</dd>
            <dt className="text-muted-foreground">Linked records</dt>
            <dd className="text-right font-medium tabular-nums">{selectedNode.links.length}</dd>
          </dl>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {selectedNode.links.map((link) => (
              <Badge key={link} tone="neutral">
                {link}
              </Badge>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
            >
              View linked task
            </Button>
            <Button size="sm" onClick={() => dispatch({ type: 'NAVIGATE', route: 'context' })}>
              Compose context
            </Button>
          </div>
        </Section>
      </div>
    </div>
  )
}

function TaskScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const passedCriteria = state.task.criteria.filter((criterion) => criterion.passed).length
  const canComplete =
    state.task.status === 'WAITING_REVIEW' &&
    state.artifact.reviewStatus === 'ACCEPTED' &&
    state.task.acceptanceEvaluated

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow="Task workspace / immutable TaskSpecVersion"
        title={state.task.title}
        description="The Task objective, non-goals, targets, criteria, Snapshot and Runs remain separate records."
        meta={
          <>
            <TaskStatusBadge status={state.task.status} />
            <Badge tone="neutral">{state.task.type}</Badge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'context' })}
          >
            Open context composer <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Section title="TaskSpecVersion" icon={ClipboardCheck} eyebrow={state.task.id}>
          <p className="text-[13px] font-semibold">Objective</p>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{state.task.objective}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-[11px] font-semibold">Non-goals</h3>
              <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                {state.task.nonGoals.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span
                      className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
                      aria-hidden="true"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-[11px] font-semibold">Targets</h3>
              <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                {state.task.targets.map((item) => (
                  <li key={item} className="flex gap-2">
                    <Check
                      className="mt-0.5 size-3.5 shrink-0 text-status-success"
                      aria-hidden="true"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        <Section
          title="Acceptance criteria"
          icon={ClipboardCheck}
          action={
            <Badge tone={passedCriteria === state.task.criteria.length ? 'success' : 'warning'}>
              {passedCriteria}/{state.task.criteria.length}
            </Badge>
          }
        >
          <ol className="space-y-2">
            {state.task.criteria.map((criterion) => (
              <li key={criterion.id} className="flex items-start gap-2 text-[11px]">
                {criterion.passed ? (
                  <CheckCircle2
                    className="mt-0.5 size-3.5 shrink-0 text-status-success"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleDot
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    'leading-5',
                    criterion.passed ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {criterion.label}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t border-border pt-3 text-[10px] leading-4 text-muted-foreground">
            Criteria are evaluated explicitly after Artifact acceptance. Passing a Run does not
            complete this Task.
          </p>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Current Snapshot"
          icon={Layers3}
          action={<StatusBadge status={state.snapshot.status} />}
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium">{state.snapshot.label}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{state.snapshot.revision}</p>
            </div>
            <SnapshotFreshnessBadge freshness={state.snapshot.freshness} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3">
            <Stat
              label="Selected"
              value={`${state.selectedContextItemIds.length}`}
              detail="items"
            />
            <Stat
              label="Tokens"
              value={getSelectedContextTokens(state).toLocaleString()}
              detail={`of ${state.snapshot.tokenBudget.toLocaleString()}`}
            />
            <Stat
              label="Frozen"
              value={state.snapshot.frozenAt ?? 'Draft'}
              detail="snapshot state"
            />
          </div>
        </Section>

        <Section
          title="Run evidence"
          icon={TestTube2}
          action={
            state.run.outcome ? (
              <RunOutcomeBadge outcome={state.run.outcome} />
            ) : (
              <RunStatusBadge status={state.run.status} />
            )
          }
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[12px] font-medium">{state.run.id}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                A Run result is evidence for review, not a Task completion command.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: 'NAVIGATE', route: 'run' })}
            >
              Open timeline
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <TaskStatusBadge status={state.task.status} />
            {state.task.acceptanceEvaluated ? (
              <Badge tone="success">
                <Check className="size-3" aria-hidden="true" />
                Acceptance evaluated
              </Badge>
            ) : (
              <Badge tone="warning">
                <TriangleAlert className="size-3" aria-hidden="true" />
                Evaluation pending
              </Badge>
            )}
          </div>
        </Section>
      </div>

      <Section title="Review gates" icon={ShieldCheck} eyebrow="Separate commands">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'artifact' })}
            disabled={state.run.outcome !== 'SUCCEEDED'}
          >
            Review artifact
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => dispatch({ type: 'EVALUATE_ACCEPTANCE' })}
            disabled={
              state.artifact.reviewStatus !== 'ACCEPTED' || state.task.status !== 'WAITING_REVIEW'
            }
          >
            Evaluate acceptance
          </Button>
          <Button
            size="sm"
            onClick={() => dispatch({ type: 'COMPLETE_TASK' })}
            disabled={!canComplete}
          >
            Complete task
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'baseline' })}
          >
            Review baseline draft <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
          {canComplete
            ? 'All completion prerequisites are recorded.'
            : 'Complete becomes available only after the Artifact is accepted and acceptance criteria are evaluated.'}
        </p>
      </Section>
    </div>
  )
}

function ContextCandidateRow({
  item,
  selected,
  readOnly,
  order,
  onToggle
}: {
  readonly item: ContextCandidate
  readonly selected: boolean
  readonly readOnly: boolean
  readonly order: number | null
  readonly onToggle: () => void
}): React.JSX.Element {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 transition-colors',
        selected ? 'border-primary/30 bg-accent/60' : 'border-border bg-background hover:bg-muted',
        readOnly && 'cursor-default opacity-80'
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={readOnly || (item.required && selected)}
        aria-label={`Include ${item.label}`}
        className="mt-0.5 size-3.5 accent-[var(--primary)]"
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold">{item.label}</span>
          {item.required ? (
            <Badge tone="success">Required</Badge>
          ) : (
            <Badge tone="neutral">Optional</Badge>
          )}
          <Badge tone={item.priority === 'P0' ? 'warning' : 'neutral'}>{item.priority}</Badge>
        </span>
        <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
          {item.description}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[9px] font-medium text-muted-foreground uppercase">
          <span>{item.type.replaceAll('_', ' ')}</span>
          <span aria-hidden="true">·</span>
          <span>{item.authority.replaceAll('_', ' ')}</span>
          {item.conflictsWith ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-status-danger">Conflicts</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {order !== null ? (
          <span className="block text-[10px] font-semibold text-primary">#{order}</span>
        ) : null}
        <span className="mt-1 block text-[10px] tabular-nums text-muted-foreground">
          {item.tokens.toLocaleString()} t
        </span>
      </span>
    </label>
  )
}

function ContextScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const selectedItems = getSelectedContextItems(state)
  const blockers = getFreezeBlockers(state)
  const selectedTokens = getSelectedContextTokens(state)
  const readOnly = state.snapshot.status !== 'DRAFT'
  const selectedOrder = new Map(selectedItems.map((item, index) => [item.id, index + 1]))
  const filteredItems = state.contextItems.filter((item) =>
    `${item.label} ${item.description} ${item.type}`.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow="Context composer / Snapshot draft 04"
        title="Compose the evidence deliberately"
        description="Required items stay pinned. Optional items change count, order and token budget until Freeze makes the Snapshot immutable."
        meta={
          <>
            <StatusBadge status={state.snapshot.status} />
            <SnapshotFreshnessBadge freshness={state.snapshot.freshness} />
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to task
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Section
          title="Candidates"
          icon={Search}
          eyebrow={`${filteredItems.length} available`}
          action={
            <div className="relative w-44">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label="Filter context candidates"
                placeholder="Filter candidates"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-7 pl-7 text-[11px]"
              />
            </div>
          }
        >
          <div className="space-y-2">
            {filteredItems.map((item) => (
              <ContextCandidateRow
                key={item.id}
                item={item}
                selected={state.selectedContextItemIds.includes(item.id)}
                readOnly={readOnly}
                order={selectedOrder.get(item.id) ?? null}
                onToggle={() => dispatch({ type: 'TOGGLE_CONTEXT_ITEM', itemId: item.id })}
              />
            ))}
          </div>
          {filteredItems.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No candidates match"
              description="Try another filter term."
              compact
            />
          ) : null}
        </Section>

        <div className="space-y-4">
          <Section
            title="Selection preview"
            icon={Filter}
            action={
              <Badge tone={selectedTokens > state.snapshot.tokenBudget ? 'danger' : 'accent'}>
                {selectedTokens.toLocaleString()} / {state.snapshot.tokenBudget.toLocaleString()} t
              </Badge>
            }
          >
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-muted-foreground">Selected context</span>
              <span className="font-semibold tabular-nums">{selectedItems.length} items</span>
            </div>
            <div className="mt-3 space-y-1.5">
              {selectedItems.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-[var(--radius-control)] bg-muted/60 px-2.5 py-2 text-[10px]"
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-background font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                  {item.required ? (
                    <LockKeyhole
                      className="size-3.5 shrink-0 text-status-success"
                      aria-label="Required item"
                    />
                  ) : (
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      aria-label={`Remove ${item.label}`}
                      disabled={readOnly}
                      onClick={() => dispatch({ type: 'TOGGLE_CONTEXT_ITEM', itemId: item.id })}
                    >
                      <XCircle className="size-3.5" aria-hidden="true" />
                    </button>
                  )}
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {item.tokens.toLocaleString()} t
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Freeze confirmation" icon={LockKeyhole}>
            {blockers.length > 0 && !readOnly ? (
              <div
                className="rounded-[var(--radius-control)] border border-status-danger/30 bg-status-danger/8 p-3"
                role="alert"
              >
                <p className="flex items-center gap-2 text-[11px] font-semibold text-status-danger">
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                  Freeze blocked
                </p>
                <ul className="mt-2 space-y-1 text-[10px] leading-4 text-foreground/75">
                  {blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-[11px] leading-5 text-muted-foreground">
              {readOnly
                ? 'Selected items are read-only. Starting a Run is intentionally separate.'
                : 'Freeze pins this exact selection to the Snapshot. It will not start a Run.'}
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
              >
                Keep editing
              </Button>
              {readOnly ? (
                <Button
                  size="sm"
                  onClick={() => dispatch({ type: 'START_RUN' })}
                  disabled={state.run.status !== 'CREATED'}
                >
                  <Play className="size-3.5" aria-hidden="true" />
                  Start run
                </Button>
              ) : (
                <Button size="sm" onClick={() => dispatch({ type: 'FREEZE_SNAPSHOT' })}>
                  <LockKeyhole className="size-3.5" aria-hidden="true" />
                  Freeze snapshot
                </Button>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

function runStepLabel(status: CoreFlowState['run']['status']): string {
  if (status === 'CREATED') return 'Start run'
  if (status === 'QUEUED') return 'Prepare worker'
  if (status === 'PREPARING') return 'Start execution'
  if (status === 'RUNNING') return 'Finish succeeded run'
  return 'Run finished'
}

function RunTimeline({
  events
}: {
  readonly events: CoreFlowState['run']['timeline']
}): React.JSX.Element {
  return (
    <ol className="space-y-3">
      {events.map((event) => {
        const Icon =
          event.state === 'complete'
            ? CheckCircle2
            : event.state === 'warning'
              ? TriangleAlert
              : event.state === 'active'
                ? RefreshCw
                : CircleDot
        const iconClass =
          event.state === 'complete'
            ? 'text-status-success'
            : event.state === 'warning'
              ? 'text-status-warning'
              : event.state === 'active'
                ? 'text-status-info'
                : 'text-muted-foreground'
        return (
          <li key={event.id} className="flex gap-3">
            <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-border bg-background">
              <Icon
                className={cn('size-3.5', iconClass, event.state === 'active' && 'animate-spin')}
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold">{event.label}</p>
              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{event.detail}</p>
            </div>
            <Badge
              tone={
                event.state === 'complete'
                  ? 'success'
                  : event.state === 'warning'
                    ? 'warning'
                    : event.state === 'active'
                      ? 'info'
                      : 'neutral'
              }
            >
              {event.state}
            </Badge>
          </li>
        )
      })}
    </ol>
  )
}

function RunScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const previousRun = state.priorRuns[0]
  const canStart = state.snapshot.status === 'FROZEN' && state.run.status === 'CREATED'
  const canAdvance = state.run.status === 'QUEUED' || state.run.status === 'PREPARING'
  const canFinish = state.run.status === 'RUNNING'

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow="Run result / timeline"
        title={`${state.run.id} execution evidence`}
        description="This mock timeline makes worker progress, Run outcome and human review visible without collapsing them into Task state."
        meta={
          <>
            <RunStatusBadge status={state.run.status} />
            {state.run.outcome ? (
              <RunOutcomeBadge outcome={state.run.outcome} />
            ) : (
              <Badge tone="neutral">Outcome pending</Badge>
            )}
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'context' })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Context snapshot
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Section title="Run state" icon={Play} eyebrow="Status and outcome are separate">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={state.run.status} />
            {state.run.outcome ? (
              <RunOutcomeBadge outcome={state.run.outcome} />
            ) : (
              <Badge tone="neutral">No outcome yet</Badge>
            )}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-[11px]">
            <dt className="text-muted-foreground">ContextSnapshot</dt>
            <dd className="truncate text-right font-mono">{state.snapshot.id}</dd>
            <dt className="text-muted-foreground">Started</dt>
            <dd className="text-right">{state.run.startedAt ?? 'Not started'}</dd>
            <dt className="text-muted-foreground">Task status</dt>
            <dd className="flex justify-end">
              <TaskStatusBadge status={state.task.status} />
            </dd>
            <dt className="text-muted-foreground">Artifact review</dt>
            <dd className="flex justify-end">
              <Badge tone={artifactTone[state.artifact.reviewStatus]}>
                {artifactLabel[state.artifact.reviewStatus]}
              </Badge>
            </dd>
          </dl>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {state.run.status === 'FINISHED' ? (
              <Button onClick={() => dispatch({ type: 'NAVIGATE', route: 'artifact' })}>
                Review artifact <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                onClick={() =>
                  state.run.status === 'CREATED'
                    ? dispatch({ type: 'START_RUN' })
                    : state.run.status === 'RUNNING'
                      ? dispatch({ type: 'FINISH_RUN' })
                      : dispatch({ type: 'ADVANCE_RUN' })
                }
                disabled={
                  (state.run.status === 'CREATED' && !canStart) ||
                  (canAdvance === false && !canFinish && state.run.status !== 'CREATED')
                }
              >
                {state.run.status === 'CREATED' ? (
                  <Play className="size-3.5" aria-hidden="true" />
                ) : canFinish ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                )}
                {runStepLabel(state.run.status)}
              </Button>
            )}
          </div>
          {state.run.status === 'CREATED' && !canStart ? (
            <p className="mt-2 text-right text-[10px] text-status-warning">
              Freeze the Snapshot before starting this Run.
            </p>
          ) : null}
        </Section>

        <Section title="Execution timeline" icon={RefreshCw}>
          <RunTimeline events={state.run.timeline} />
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Test evidence"
          icon={TestTube2}
          action={
            <Badge tone="success">
              {state.run.tests.filter((test) => test.status === 'PASSED').length} passed
            </Badge>
          }
        >
          <ul className="space-y-2">
            {state.run.tests.map((test) => (
              <li key={test.id} className="flex items-start gap-2 text-[11px]">
                <CheckCircle2
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0',
                    test.status === 'PASSED' ? 'text-status-success' : 'text-status-danger'
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{test.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                    {test.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {state.run.outcome === 'SUCCEEDED' ? (
            <p className="mt-3 border-t border-border pt-3 text-[10px] leading-4 text-muted-foreground">
              Run success is evidence only. The Task is still{' '}
              {state.task.status === 'WAITING_REVIEW' ? 'Waiting review' : state.task.status}.
            </p>
          ) : null}
        </Section>

        <Section
          title="Previous partial evidence"
          icon={TriangleAlert}
          action={<RunOutcomeBadge outcome={previousRun?.outcome ?? 'PARTIAL'} />}
        >
          {previousRun ? (
            <details className="group rounded-[var(--radius-control)] border border-border bg-background p-3">
              <summary className="cursor-pointer list-none text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                Expand failed acceptance evidence
                <span className="float-right text-muted-foreground group-open:rotate-90">
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </span>
              </summary>
              <div className="mt-3 border-t border-border pt-3">
                {previousRun.tests.map((test) => (
                  <div key={test.id} className="flex items-start gap-2 text-[10px]">
                    <XCircle
                      className="mt-0.5 size-3.5 shrink-0 text-status-danger"
                      aria-hidden="true"
                    />
                    <span>
                      <span className="font-medium">{test.label}</span>
                      <span className="mt-0.5 block leading-4 text-muted-foreground">
                        {test.detail}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : (
            <EmptyState
              title="No previous run"
              description="Earlier evidence will appear here."
              compact
            />
          )}
        </Section>
      </div>
    </div>
  )
}

function isArtifactTab(value: string): value is ArtifactTab {
  return value === 'summary' || value === 'diff' || value === 'tests'
}

function ArtifactScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const canReview = state.run.outcome === 'SUCCEEDED'
  const canAccept =
    canReview &&
    state.artifact.applicationStatus === 'APPLIED' &&
    state.artifact.reviewStatus !== 'ACCEPTED'

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow="Artifact review / explicit actions"
        title={state.artifact.title}
        description="Diff, tests and summary are review surfaces. Apply, accept, reject and request changes remain distinct commands."
        meta={
          <>
            <Badge tone={artifactTone[state.artifact.reviewStatus]}>
              {artifactLabel[state.artifact.reviewStatus]}
            </Badge>
            <Badge tone={state.artifact.applicationStatus === 'APPLIED' ? 'success' : 'neutral'}>
              {state.artifact.applicationStatus === 'APPLIED' ? 'Applied' : 'Not applied'}
            </Badge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'run' })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Run timeline
          </Button>
        }
      />
      <Section
        title="Review evidence"
        icon={FileCheck2}
        action={<Badge tone="neutral">{state.artifact.changedFiles.length} files</Badge>}
      >
        <Tabs
          value={state.artifact.activeTab}
          onValueChange={(value) => {
            if (isArtifactTab(value)) dispatch({ type: 'SET_ARTIFACT_TAB', tab: value })
          }}
        >
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="diff">Diff</TabsTrigger>
            <TabsTrigger value="tests">Tests</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="pt-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
              <div>
                <h3 className="text-[13px] font-semibold">What changed</h3>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {state.artifact.summary}
                </p>
                <ul className="mt-3 space-y-1.5 text-[11px]">
                  {state.artifact.changedFiles.map((file) => (
                    <li key={file} className="flex items-center gap-2">
                      <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      <span className="font-mono">{file}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-[var(--radius-control)] border border-border bg-muted/40 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Review distinction
                </p>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  Applying this patch changes the mock workspace. Accepting it records human review.
                  Neither action completes TASK-011.
                </p>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="diff" className="pt-4">
            <pre className="overflow-x-auto rounded-[var(--radius-control)] border border-border bg-background p-3 font-mono text-[11px] leading-6 text-muted-foreground">
              {state.artifact.diffLines.map((line) => (
                <code
                  key={line}
                  className={cn('block', line.startsWith('+') && 'text-status-success')}
                >
                  {line}
                </code>
              ))}
            </pre>
          </TabsContent>
          <TabsContent value="tests" className="pt-4">
            <div className="space-y-2">
              {state.run.tests.map((test) => (
                <div
                  key={test.id}
                  className="flex items-start gap-2 rounded-[var(--radius-control)] border border-border bg-background p-3 text-[11px]"
                >
                  <TestTube2
                    className="mt-0.5 size-3.5 shrink-0 text-status-success"
                    aria-hidden="true"
                  />
                  <span>
                    <span className="font-medium">{test.label}</span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                      {test.detail}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Review commands" icon={ShieldCheck} eyebrow="No automatic chain">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => dispatch({ type: 'APPLY_ARTIFACT' })}
            disabled={!canReview || state.artifact.applicationStatus === 'APPLIED'}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Apply artifact
          </Button>
          <Button
            size="sm"
            onClick={() => dispatch({ type: 'ACCEPT_ARTIFACT' })}
            disabled={!canAccept}
          >
            <Check className="size-3.5" aria-hidden="true" />
            Accept artifact
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'REQUEST_CHANGES' })}
            disabled={!canReview}
          >
            Request changes
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => dispatch({ type: 'REJECT_ARTIFACT' })}
            disabled={!canReview}
          >
            Reject artifact
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[10px] text-muted-foreground">
          <span>Current state:</span>
          <Badge tone={artifactTone[state.artifact.reviewStatus]}>
            {artifactLabel[state.artifact.reviewStatus]}
          </Badge>
          <span aria-hidden="true">·</span>
          <span>
            {state.artifact.applicationStatus === 'APPLIED' ? 'Patch applied' : 'Patch not applied'}
          </span>
        </div>
      </Section>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
        >
          Continue to task review <ArrowRight className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

function BaselineScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const canActivate = state.task.status === 'COMPLETED' && state.baseline.status === 'DRAFT'

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow="Baseline review / explicit activation"
        title={state.baseline.label}
        description="The draft summarizes a completed Task but does not become the active project anchor until confirmed."
        meta={<BaselineStatusBadge status={state.baseline.status} />}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Task workspace
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Current project anchor" icon={Layers3}>
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-[var(--radius-control)] bg-muted">
              <ShieldCheck className="size-4 text-status-success" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold">{state.project.activeBaseline}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Active on {state.project.branch}
              </p>
            </div>
            <BaselineStatusBadge status="ACTIVE" />
          </div>
          <p className="mt-4 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
            This existing anchor remains unchanged while Baseline 1.1 is Draft.
          </p>
        </Section>
        <Section
          title="Candidate baseline"
          icon={ShieldCheck}
          action={<BaselineStatusBadge status={state.baseline.status} />}
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
            <dt className="text-muted-foreground">Source Task</dt>
            <dd className="text-right font-mono">{state.baseline.sourceTaskId}</dd>
            <dt className="text-muted-foreground">Revision</dt>
            <dd className="truncate text-right font-mono">{state.baseline.revision}</dd>
            <dt className="text-muted-foreground">Artifact</dt>
            <dd className="text-right">
              <Badge tone={artifactTone[state.artifact.reviewStatus]}>
                {artifactLabel[state.artifact.reviewStatus]}
              </Badge>
            </dd>
            <dt className="text-muted-foreground">Task</dt>
            <dd className="flex justify-end">
              <TaskStatusBadge status={state.task.status} />
            </dd>
          </dl>
        </Section>
      </div>
      <Section
        title="Activation confirmation"
        icon={LockKeyhole}
        eyebrow="Separate from Task completion"
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium">
              {canActivate ? 'Ready to activate Baseline 1.1' : 'Activation is gated'}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {canActivate
                ? 'This action changes the active project anchor and is intentionally explicit.'
                : 'Complete TASK-011 before activating this Draft Baseline. Accepting an Artifact alone is not enough.'}
            </p>
          </div>
          <Button onClick={() => dispatch({ type: 'ACTIVATE_BASELINE' })} disabled={!canActivate}>
            {state.baseline.status === 'ACTIVE' ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-3.5" aria-hidden="true" />
            )}
            {state.baseline.status === 'ACTIVE' ? 'Baseline active' : 'Activate baseline'}
          </Button>
        </div>
      </Section>
    </div>
  )
}

function FlowScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  switch (state.route) {
    case 'dashboard':
      return <DashboardScreen state={state} dispatch={dispatch} />
    case 'outline':
      return <OutlineScreen state={state} dispatch={dispatch} />
    case 'node':
      return <NodeWorkspaceScreen state={state} dispatch={dispatch} />
    case 'task':
      return <TaskScreen state={state} dispatch={dispatch} />
    case 'context':
      return <ContextScreen state={state} dispatch={dispatch} />
    case 'run':
      return <RunScreen state={state} dispatch={dispatch} />
    case 'artifact':
      return <ArtifactScreen state={state} dispatch={dispatch} />
    case 'baseline':
      return <BaselineScreen state={state} dispatch={dispatch} />
  }
}

function NodeWorkspaceScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const node =
    state.nodes.find((candidate) => candidate.id === state.selectedNodeId) ?? state.nodes[0]
  if (!node)
    return (
      <EmptyState
        icon={Search}
        title="No node selected"
        description="Return to the Project Outline and select a node."
      />
    )

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow="Node workspace / versioned evidence"
        title={node.title}
        description="A representative node workspace keeps node meaning, version and linked Task context visible."
        meta={
          <>
            <NodeTypeBadge type={node.type} />
            <Badge tone="success">{node.lifecycle}</Badge>
            <Badge tone="neutral">{node.version}</Badge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'outline' })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Project outline
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Section title="Node content" icon={Code2} eyebrow={node.id}>
          <p className="text-[16px] font-semibold">{node.summary}</p>
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
            This version is the selected project fact for the next context composition. It is not
            silently added to the Snapshot.
          </p>
          <Separator className="my-4" />
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">Active version</Badge>
            <Badge tone="neutral">Immutable fixture record</Badge>
          </div>
        </Section>
        <Section title="Linked work" icon={GitBranch}>
          <div className="space-y-2">
            {node.links.map((link) => (
              <button
                key={link}
                type="button"
                className="flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-left text-[11px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() =>
                  dispatch({
                    type: 'NAVIGATE',
                    route: link.startsWith('TASK') ? 'task' : 'outline'
                  })
                }
              >
                <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 font-mono">{link}</span>
                <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => dispatch({ type: 'NAVIGATE', route: 'context' })}>
              Compose context <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </Section>
      </div>
    </div>
  )
}

export function CoreFlowWorkspace({
  runtimeInfo
}: {
  readonly runtimeInfo: RuntimeInfo | null
}): React.JSX.Element {
  const service = useMemo(() => createCoreFlowFixtureService(), [])
  const [state, dispatch] = useReducer(coreFlowReducer, undefined, service.load)
  const meta = routeMeta[state.route]

  const handleSidebarNavigate = (label: string): void => {
    const route = sidebarRoutes[label]
    if (route) dispatch({ type: 'NAVIGATE', route })
  }

  return (
    <AppShell
      runtimeInfo={runtimeInfo}
      inspector={<FlowInspector state={state} />}
      sectionLabel={`MUSICDB / ${meta.label}`}
      title={meta.title}
      description={meta.description}
      activeItem={meta.label}
      onNavigate={handleSidebarNavigate}
    >
      <div className="space-y-3">
        <RouteBreadcrumb state={state} dispatch={dispatch} />
        <Notice notice={state.notice} />
        <FlowScreen state={state} dispatch={dispatch} />
      </div>
    </AppShell>
  )
}
