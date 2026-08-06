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
import { StatusBadge } from '@/components/domain/status-badge'
import { Button } from '@/components/ui/button'
import { musicdbDashboardFixture as fixture } from '@/data/musicdb-fixture'
import { useRuntimeInfo } from '@/hooks/use-runtime-info'

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="border-l border-border pl-4 first:border-l-0 first:pl-0">
      <p className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function Panel({
  title,
  icon: Icon,
  children
}: {
  title: string
  icon: typeof Layers3
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-[var(--radius-panel)] border border-border bg-card">
      <header className="flex h-10 items-center border-b border-border px-3">
        <Icon className="mr-2 size-3.5 text-muted-foreground" />
        <h2 className="text-[12px] font-semibold">{title}</h2>
      </header>
      <div className="p-3">{children}</div>
    </section>
  )
}

function App(): React.JSX.Element {
  const runtimeInfo = useRuntimeInfo()

  const inspector = (
    <div className="space-y-3">
      <Panel title="Active baseline" icon={ShieldCheck}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium">{fixture.project.baselineLabel}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Branch {fixture.project.branch}
            </p>
          </div>
          <StatusBadge status={fixture.project.baselineStatus} />
        </div>
      </Panel>
      <Panel title="Snapshot health" icon={Layers3}>
        <div className="flex items-center justify-between">
          <p className="text-[12px]">{fixture.snapshot.label}</p>
          <StatusBadge status={fixture.snapshot.freshness} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-y-2 border-t border-border pt-3 text-[11px]">
          <dt className="text-muted-foreground">Selected items</dt>
          <dd className="text-right font-medium tabular-nums">{fixture.snapshot.selectedItems}</dd>
          <dt className="text-muted-foreground">Token estimate</dt>
          <dd className="text-right font-medium tabular-nums">
            {fixture.snapshot.tokenEstimate.toLocaleString()}
          </dd>
        </dl>
      </Panel>
      <Panel title="Invariant watch" icon={AlertTriangle}>
        <ul className="space-y-2 text-[11px] text-muted-foreground">
          <li className="flex gap-2">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-status-success" />
            One active baseline
          </li>
          <li className="flex gap-2">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-status-success" />
            Snapshot pins repository revision
          </li>
          <li className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-status-warning" />
            Run needs human acceptance
          </li>
        </ul>
      </Panel>
    </div>
  )

  return (
    <AppShell runtimeInfo={runtimeInfo} inspector={inspector}>
      <div className="space-y-4">
        <section className="rounded-[var(--radius-panel)] border border-border bg-card p-4">
          <div className="flex items-start gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-foreground text-base font-semibold text-background">
              M
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold">{fixture.project.name}</h2>
                <StatusBadge status={fixture.project.baselineStatus} />
              </div>
              <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">
                {fixture.project.description}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-5">
              <Metric label="Task" value={fixture.activeTask.id} />
              <Metric label="Context" value={`${fixture.snapshot.selectedItems} items`} />
              <Metric label="Branch" value={fixture.project.branch} />
            </div>
          </div>
        </section>

        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] gap-4">
          <Panel title="Current task" icon={FileClock}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold">{fixture.activeTask.title}</p>
                  <StatusBadge status={fixture.activeTask.status} />
                </div>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  {fixture.activeTask.objective}
                </p>
              </div>
              <Button variant="outline" size="sm">
                Open task <ArrowRight className="size-3.5" />
              </Button>
            </div>
            <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${(fixture.activeTask.criteriaPassed / fixture.activeTask.criteriaTotal) * 100}%`
                  }}
                />
              </div>
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                {fixture.activeTask.criteriaPassed}/{fixture.activeTask.criteriaTotal} criteria
              </span>
            </div>
          </Panel>

          <Panel title="Latest run" icon={GitBranch}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[12px] font-medium">{fixture.latestRun.id}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {fixture.latestRun.testsPassed} tests passed · {fixture.latestRun.changedFiles}{' '}
                  files changed
                </p>
              </div>
              <StatusBadge status={fixture.latestRun.outcome} />
            </div>
            <Button variant="outline" size="sm" className="mt-4 w-full">
              Review evidence
            </Button>
          </Panel>
        </div>

        <Panel title="Next suggested action" icon={Sparkles}>
          <div className="flex items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-status-warning/10 text-status-warning">
              <AlertTriangle className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">Resolve the partial run before completion</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Inspect the failed acceptance evidence, then create a new Run if task context
                changes.
              </p>
            </div>
            <Button size="sm">
              Review run <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </Panel>
      </div>
    </AppShell>
  )
}

export default App
