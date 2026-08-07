import { useCallback, useMemo, useState } from 'react'
import {
  FileCheck2,
  Layers3,
  Loader2,
  LockKeyhole,
  Play,
  RefreshCw,
  ShieldCheck,
  TestTube2,
  XCircle
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { RunOutcomeBadge } from '@/components/domain'
import { buildContextCandidates, type ContextCandidate } from '@/lib/context-candidates'
import { useWorkspace, type UseWorkspaceResult } from '@/hooks/use-workspace'
import type { DispatchResult, FrozenSnapshotView } from '@/lib/workspace-types'

interface RunState {
  readonly executionRequestId: string
  readonly status: 'PENDING' | 'DONE'
  readonly result?: DispatchResult
  readonly error?: string
}

function CandidateRow({
  candidate,
  selected,
  readOnly,
  onToggle
}: {
  readonly candidate: ContextCandidate
  readonly selected: boolean
  readonly readOnly: boolean
  readonly onToggle: () => void
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border px-3 py-2.5">
      <input
        type="checkbox"
        checked={selected}
        disabled={readOnly}
        aria-label={`Include ${candidate.label}`}
        className="mt-0.5 size-3.5 accent-[var(--primary)]"
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold">{candidate.label}</span>
          {candidate.required ? (
            <Badge tone="success">required</Badge>
          ) : (
            <Badge tone="neutral">optional</Badge>
          )}
          <Badge tone={candidate.priority === 'P0' ? 'warning' : 'neutral'}>
            {candidate.priority}
          </Badge>
        </span>
        <span className="mt-1 block truncate text-[10px] text-muted-foreground">
          {candidate.description}
        </span>
        <span className="mt-1.5 block text-[9px] font-medium text-muted-foreground uppercase">
          {candidate.itemType.replaceAll('_', ' ')} · {candidate.authority.replaceAll('_', ' ')} ·{' '}
          {candidate.tokenEstimate} tokens
        </span>
      </span>
    </label>
  )
}

function Section({
  eyebrow,
  title,
  action,
  children
}: {
  readonly eyebrow?: string
  readonly title: string
  readonly action?: React.ReactNode
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-[var(--radius-panel)] border border-border bg-card">
      <header className="flex min-h-11 items-center gap-2 border-b border-border px-3.5">
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

function HydrationSection({
  workspace
}: {
  readonly workspace: UseWorkspaceResult
}): React.JSX.Element {
  const view = workspace.workspace
  return (
    <Section
      eyebrow="real IPC · project.list + project.state"
      title="Project hydration"
      action={
        <>
          <Badge tone={workspace.error ? 'danger' : workspace.loading ? 'info' : 'success'}>
            {workspace.loading ? 'hydrating' : workspace.error ? 'error' : 'ready'}
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh workspace"
            onClick={() => void workspace.refresh()}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </Button>
        </>
      }
    >
      {workspace.loading ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Hydrating from the real backend…
        </div>
      ) : workspace.error ? (
        <div className="rounded-[var(--radius-control)] border border-status-danger/30 bg-status-danger/8 p-3 text-[11px] text-status-danger">
          {workspace.error.message}
        </div>
      ) : view ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
          <dt className="text-muted-foreground">Project</dt>
          <dd className="truncate text-right font-medium">{view.project.name}</dd>
          <dt className="text-muted-foreground">Project id</dt>
          <dd className="truncate text-right font-mono">{view.project.id}</dd>
          <dt className="text-muted-foreground">Active baseline</dt>
          <dd className="truncate text-right">{view.activeBaseline?.name ?? 'none'}</dd>
          <dt className="text-muted-foreground">Nodes</dt>
          <dd className="text-right tabular-nums">{view.nodes.length}</dd>
          <dt className="text-muted-foreground">Node versions</dt>
          <dd className="text-right tabular-nums">{view.nodeVersions.length}</dd>
          <dt className="text-muted-foreground">Tasks</dt>
          <dd className="text-right tabular-nums">{view.tasks.length}</dd>
          <dt className="text-muted-foreground">Task specs</dt>
          <dd className="text-right tabular-nums">{view.taskSpecs.length}</dd>
        </dl>
      ) : (
        <div className="text-[11px] text-muted-foreground">
          No project hydrated. Check the bridge and the seeded repository.
        </div>
      )}
    </Section>
  )
}

function ComposerSection({
  candidates,
  selectedIds,
  onToggle
}: {
  readonly candidates: readonly ContextCandidate[]
  readonly selectedIds: readonly string[]
  readonly onToggle: (id: string) => void
}): React.JSX.Element {
  const totalTokens = candidates
    .filter((candidate) => selectedIds.includes(candidate.id))
    .reduce((sum, candidate) => sum + candidate.tokenEstimate, 0)
  return (
    <Section
      eyebrow="real candidates · taskSpecs + nodeVersions only"
      title="Context composer"
      action={
        <Badge tone="accent">
          {selectedIds.length} / {totalTokens} t
        </Badge>
      }
    >
      <div className="space-y-2">
        {candidates.map((candidate) => (
          <CandidateRow
            key={candidate.id}
            candidate={candidate}
            selected={candidate.required || selectedIds.includes(candidate.id)}
            readOnly={candidate.required}
            onToggle={() => onToggle(candidate.id)}
          />
        ))}
      </div>
      {candidates.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">
          No task specs or node versions to compose from.
        </div>
      ) : null}
    </Section>
  )
}

function FreezeSection({
  workspace,
  selectedIds,
  frozen,
  onFreeze
}: {
  readonly workspace: UseWorkspaceResult
  readonly selectedIds: readonly string[]
  readonly frozen: FrozenSnapshotView | null
  readonly onFreeze: () => void
}): React.JSX.Element {
  const canFreeze = workspace.workspace !== null && selectedIds.length > 0 && frozen === null
  return (
    <Section
      eyebrow="snapshot.freeze · real freeze"
      title="Freeze context snapshot"
      action={frozen ? <Badge tone="success">FROZEN</Badge> : <Badge tone="warning">DRAFT</Badge>}
    >
      {frozen ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
          <dt className="text-muted-foreground">Snapshot id</dt>
          <dd className="truncate text-right font-mono">{frozen.id}</dd>
          <dt className="text-muted-foreground">Task spec version</dt>
          <dd className="truncate text-right font-mono">{frozen.taskSpecVersionId}</dd>
          <dt className="text-muted-foreground">Items</dt>
          <dd className="text-right tabular-nums">{frozen.items.length}</dd>
          <dt className="text-muted-foreground">Freshness</dt>
          <dd className="text-right">{frozen.freshness}</dd>
        </dl>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] leading-5 text-muted-foreground">
            Freeze the selected authoritative context against the current repository revision.
          </p>
          <Button size="sm" disabled={!canFreeze} onClick={onFreeze}>
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            Freeze snapshot
          </Button>
        </div>
      )}
    </Section>
  )
}

function EvidenceSection({ run }: { readonly run: RunState }): React.JSX.Element {
  const result = run.result
  return (
    <Section
      eyebrow="execution.dispatch · DispatchResult"
      title="Run evidence"
      action={
        run.status === 'PENDING' ? (
          <Badge tone="info">running</Badge>
        ) : result ? (
          <RunOutcomeBadge outcome={result.outcome} />
        ) : (
          <Badge tone="neutral">pending</Badge>
        )
      }
    >
      {run.status === 'PENDING' ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Executing in the utility process…
        </div>
      ) : result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">Claim granted</span>
            <Badge tone={result.claimGranted ? 'success' : 'warning'}>
              {String(result.claimGranted)}
            </Badge>
            {result.rejectionReason ? (
              <span className="text-status-danger">{result.rejectionReason}</span>
            ) : null}
          </div>
          {result.patch !== undefined ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold text-muted-foreground uppercase">
                Patch
              </p>
              <pre className="max-h-48 overflow-auto rounded-[var(--radius-control)] border border-border bg-muted/50 p-2.5 text-[10px] leading-4">
                {result.patch}
              </pre>
            </div>
          ) : null}
          {result.verificationResults && result.verificationResults.length > 0 ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold text-muted-foreground uppercase">
                Verification
              </p>
              <ul className="space-y-1">
                {result.verificationResults.map((check, index) => (
                  <li key={index} className="flex items-center gap-2 text-[10px]">
                    <Badge tone={check.exitCode === 0 ? 'success' : 'danger'}>
                      exit {check.exitCode}
                    </Badge>
                    <code className="truncate">{check.argv.join(' ')}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.agentSummary !== undefined ? (
            <p className="text-[11px] leading-5 text-muted-foreground">{result.agentSummary}</p>
          ) : null}
          {result.artifacts && result.artifacts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {result.artifacts.map((artifact, index) => (
                <Badge key={index} tone="neutral">
                  {artifact.kind} · {artifact.fileName}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : run.error ? (
        <div className="rounded-[var(--radius-control)] border border-status-danger/30 bg-status-danger/8 p-3 text-[11px] text-status-danger">
          {run.error}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">
          Dispatch after freezing a snapshot to see real execution evidence.
        </div>
      )}
    </Section>
  )
}

export function LiveWorkspaceView(): React.JSX.Element {
  const workspace = useWorkspace()
  const view = workspace.workspace
  const candidates = useMemo(() => (view ? buildContextCandidates(view) : []), [view])
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [frozen, setFrozen] = useState<FrozenSnapshotView | null>(null)
  const [run, setRun] = useState<RunState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const toggleCandidate = useCallback((id: string): void => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((candidateId) => candidateId !== id) : [...current, id]
    )
  }, [])

  const handleFreeze = useCallback(async (): Promise<void> => {
    setActionError(null)
    if (view === null) return
    const spec = view.taskSpecs[0]
    if (!spec) {
      setActionError('No task spec version available to freeze against.')
      return
    }
    const baseBaseline = view.activeBaseline ?? view.baselines[0]?.baseline ?? null
    if (baseBaseline === null) {
      setActionError('No baseline available to freeze against.')
      return
    }
    const selections = candidates
      .filter((candidate) => !candidate.required && selectedIds.includes(candidate.id))
      .map((candidate) => ({ source: candidate.source, selectionReason: null }))
    try {
      const frozenSnapshot = await workspace.freeze({
        projectId: view.project.id,
        taskId: spec.spec.taskId,
        taskSpecVersionId: spec.spec.id,
        baseBaselineId: baseBaseline.id,
        selections
      })
      setFrozen(frozenSnapshot)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Freeze failed')
    }
  }, [view, candidates, selectedIds, workspace])

  const handleDispatch = useCallback(async (): Promise<void> => {
    setActionError(null)
    if (frozen === null) return
    const executionRequestId = crypto.randomUUID()
    setRun({ executionRequestId, status: 'PENDING' })
    try {
      const result = await workspace.execute({
        executionRequestId,
        contextSnapshotId: frozen.id
      })
      setRun({ executionRequestId, status: 'DONE', result })
    } catch (error) {
      setRun({
        executionRequestId,
        status: 'DONE',
        error: error instanceof Error ? error.message : 'Dispatch failed'
      })
    }
  }, [frozen, workspace])

  const handleCancel = useCallback(async (): Promise<void> => {
    if (run === null || run.status !== 'PENDING') return
    await workspace.cancel(run.executionRequestId)
  }, [run, workspace])

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="accent">LIVE</Badge>
          <p className="text-[11px] text-muted-foreground">
            Real workspace loop: SQLite → Git → Utility Process → evidence
          </p>
        </div>
        {actionError ? (
          <div className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-status-danger/30 bg-status-danger/8 px-2.5 py-1.5 text-[11px] text-status-danger">
            <XCircle className="size-3.5" aria-hidden="true" />
            {actionError}
          </div>
        ) : null}
      </div>

      <HydrationSection workspace={workspace} />

      <div className="grid gap-4 xl:grid-cols-2">
        <ComposerSection
          candidates={candidates}
          selectedIds={selectedIds}
          onToggle={toggleCandidate}
        />
        <div className="space-y-4">
          <FreezeSection
            workspace={workspace}
            selectedIds={selectedIds}
            frozen={frozen}
            onFreeze={() => void handleFreeze()}
          />
          <Section
            eyebrow="execution.dispatch"
            title="Run"
            action={
              frozen ? (
                <Badge tone="success">
                  <FileCheck2 className="size-3" aria-hidden="true" /> snapshot ready
                </Badge>
              ) : (
                <Badge tone="neutral">awaiting freeze</Badge>
              )
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] leading-5 text-muted-foreground">
                Dispatch the frozen snapshot through the isolated worktree worker.
              </p>
              <div className="flex gap-2">
                {run?.status === 'PENDING' ? (
                  <Button size="sm" variant="outline" onClick={() => void handleCancel()}>
                    Cancel
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  disabled={frozen === null || run?.status === 'PENDING'}
                  onClick={() => void handleDispatch()}
                >
                  {run?.status === 'PENDING' ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="size-3.5" aria-hidden="true" />
                  )}
                  Dispatch execution
                </Button>
              </div>
            </div>
            <Separator className="my-3" />
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              The worker runs from a frozen snapshot pinned to its repository revision.
              <TestTube2 className="ml-2 size-3.5" aria-hidden="true" />
              <Layers3 className="ml-2 size-3.5" aria-hidden="true" />
            </div>
          </Section>
          {run ? <EvidenceSection run={run} /> : null}
        </div>
      </div>
    </div>
  )
}
