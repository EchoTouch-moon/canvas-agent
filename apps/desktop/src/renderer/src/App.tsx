import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileClock,
  GitBranch,
  Layers3,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import { AppShell } from '@/components/app/app-shell'
import { ComponentGallery } from '@/components/app/component-gallery'
import { PageToolbar } from '@/components/app/page-toolbar'
import {
  BaselineStatusBadge,
  RunOutcomeBadge,
  RunStatusBadge,
  SnapshotFreshnessBadge,
  TaskStatusBadge
} from '@/components/domain'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { musicdbDashboardFixture as fixture } from '@/data/musicdb-fixture'
import { useRuntimeInfo } from '@/hooks/use-runtime-info'

function Panel({
  title,
  icon: Icon,
  children,
  action
}: {
  title: string
  icon: LucideIcon
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-[var(--radius-panel)] border border-border bg-card">
      <header className="flex min-h-11 items-center gap-2 border-b border-border px-3.5">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold">{title}</h2>
        {action}
      </header>
      <div className="p-3.5">{children}</div>
    </section>
  )
}

function Metric({
  label,
  value,
  detail
}: {
  label: string
  value: string
  detail?: string
}): React.JSX.Element {
  return (
    <div className="min-w-0 border-l border-border pl-3 first:border-l-0 first:pl-0">
      <p className="text-[9px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 truncate text-[16px] font-semibold tabular-nums">{value}</p>
      {detail ? (
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  )
}

function InspectorContent(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <Panel title="Active baseline" icon={ShieldCheck}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium">{fixture.project.baselineLabel}</p>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              Branch {fixture.project.branch}
            </p>
          </div>
          <BaselineStatusBadge status={fixture.project.baselineStatus} />
        </div>
      </Panel>
      <Panel title="Snapshot health" icon={Layers3}>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[12px]">{fixture.snapshot.label}</p>
          <SnapshotFreshnessBadge freshness={fixture.snapshot.freshness} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-y-2 border-t border-border pt-3 text-[10px]">
          <dt className="text-muted-foreground">Selected items</dt>
          <dd className="text-right font-medium tabular-nums">{fixture.snapshot.selectedItems}</dd>
          <dt className="text-muted-foreground">Token estimate</dt>
          <dd className="text-right font-medium tabular-nums">
            {fixture.snapshot.tokenEstimate.toLocaleString()}
          </dd>
          <dt className="text-muted-foreground">Token budget</dt>
          <dd className="text-right font-medium tabular-nums">
            {fixture.snapshot.tokenBudget.toLocaleString()}
          </dd>
        </dl>
      </Panel>
      <Panel title="Invariant watch" icon={AlertTriangle}>
        <ul className="space-y-2 text-[10px] text-muted-foreground">
          <li className="flex gap-2">
            <CheckCircle2
              className="mt-0.5 size-3.5 shrink-0 text-status-success"
              aria-hidden="true"
            />
            One active baseline
          </li>
          <li className="flex gap-2">
            <CheckCircle2
              className="mt-0.5 size-3.5 shrink-0 text-status-success"
              aria-hidden="true"
            />
            Snapshot pins repository revision
          </li>
          <li className="flex gap-2">
            <AlertTriangle
              className="mt-0.5 size-3.5 shrink-0 text-status-warning"
              aria-hidden="true"
            />
            Run needs human acceptance
          </li>
        </ul>
      </Panel>
    </div>
  )
}

function App(): React.JSX.Element {
  const runtimeInfo = useRuntimeInfo()
  const progress = (fixture.activeTask.criteriaPassed / fixture.activeTask.criteriaTotal) * 100

  return (
    <AppShell
      runtimeInfo={runtimeInfo}
      inspector={<InspectorContent />}
      description="A typed component gallery and MUSICDB foundation preview."
    >
      <div className="space-y-5">
        <PageToolbar
          eyebrow="Project dashboard / Foundation preview"
          title="A calmer way to inspect project state"
          description="A compact workbench for navigating nodes, tasks, context, runs, artifacts, and baselines without losing the thread."
          meta={
            <>
              <Badge tone="accent">MUSICDB fixture</Badge>
              <Badge tone="neutral">UI foundation</Badge>
            </>
          }
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
              }
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              Open command palette
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
                <h2 className="text-[15px] font-semibold">{fixture.project.name}</h2>
                <BaselineStatusBadge status={fixture.project.baselineStatus} />
              </div>
              <p className="mt-1 max-w-xl text-[12px] leading-5 text-muted-foreground">
                {fixture.project.description}
              </p>
            </div>
            <div className="grid min-w-[300px] flex-1 grid-cols-3 gap-4 sm:max-w-[420px]">
              <Metric label="Task" value={fixture.activeTask.id} detail="Active" />
              <Metric
                label="Context"
                value={`${fixture.snapshot.selectedItems}`}
                detail="Selected items"
              />
              <Metric label="Branch" value={fixture.project.branch} detail="Repository" />
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel
            title="Current task"
            icon={FileClock}
            action={<TaskStatusBadge status={fixture.activeTask.status} />}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold">{fixture.activeTask.title}</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {fixture.activeTask.objective}
                </p>
              </div>
              <Button variant="outline" size="sm">
                Open task <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
            <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
              <div
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                aria-label={`${fixture.activeTask.criteriaPassed} of ${fixture.activeTask.criteriaTotal} criteria passed`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={fixture.activeTask.criteriaTotal}
                aria-valuenow={fixture.activeTask.criteriaPassed}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                {fixture.activeTask.criteriaPassed}/{fixture.activeTask.criteriaTotal} criteria
              </span>
            </div>
          </Panel>

          <Panel
            title="Latest run"
            icon={GitBranch}
            action={<RunOutcomeBadge outcome={fixture.latestRun.outcome} />}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[12px] font-medium">{fixture.latestRun.id}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <RunStatusBadge status={fixture.latestRun.status} />
                  <span>{fixture.latestRun.testsPassed} tests passed</span>
                  <span aria-hidden="true">/</span>
                  <span>{fixture.latestRun.changedFiles} files changed</span>
                </div>
              </div>
              <Button variant="outline" size="sm">
                Review evidence
              </Button>
            </div>
          </Panel>
        </div>

        <Panel title="Next suggested action" icon={Sparkles}>
          <div className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-status-warning/25 bg-status-warning/10 text-status-warning">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium">Resolve the partial run before completion</p>
              <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                Inspect the failed acceptance evidence, then create a new Run if task context
                changes.
              </p>
            </div>
            <Button size="sm">
              Review run <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </Panel>

        <ComponentGallery />
      </div>
    </AppShell>
  )
}

export default App
