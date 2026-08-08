import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseSourceRef } from '@canvas-agent/contracts'
import {
  CheckCircle2,
  ChevronRight,
  FileCheck2,
  FolderOpen,
  Layers3,
  Loader2,
  LockKeyhole,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TestTube2,
  XCircle
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { RunOutcomeBadge } from '@/components/domain'
import { buildContextCandidates, type ContextCandidate } from '@/lib/context-candidates'
import { useWorkspace, type UseWorkspaceResult } from '@/hooks/use-workspace'
import type {
  AcceptanceEvaluationAggregate,
  DispatchResult,
  FrozenSnapshotView,
  ResolvedContextItem,
  RunAggregateView,
  RunSummary
} from '@/lib/workspace-types'

interface RunState {
  readonly executionRequestId: string
  readonly runId?: string
  readonly status: 'PENDING' | 'DONE'
  readonly result?: DispatchResult
  readonly error?: string
}

// Decode the canonical repo:// sourceRef back to the repository path (e.g.
// repo://docs/foo%20bar.md -> docs/foo bar.md). Never hand the encoded string
// to the resolver.
function repositoryPathOf(item: ResolvedContextItem): string {
  const ref = parseSourceRef(item.sourceRef)
  if (ref.kind === 'REPOSITORY_CONTENT') {
    return ref.path
  }
  return item.sourceRef
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

function RepositorySection({
  input,
  busy,
  preview,
  selectedPaths,
  onInputChange,
  onResolve,
  onAdd,
  onRemove
}: {
  readonly input: string
  readonly busy: boolean
  readonly preview: ResolvedContextItem | null
  readonly selectedPaths: readonly string[]
  readonly onInputChange: (value: string) => void
  readonly onResolve: () => void
  readonly onAdd: (path: string) => void
  readonly onRemove: (path: string) => void
}): React.JSX.Element {
  return (
    <Section
      eyebrow="context.resolve · pinned baseCommit only"
      title="Repository content"
      action={<Badge tone="accent">{selectedPaths.length} selected</Badge>}
    >
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Repository file path"
            placeholder="e.g. src/foo.ts"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            className="h-7 pl-7 text-[11px]"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || input.trim().length === 0}
          onClick={onResolve}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <FolderOpen className="size-3.5" aria-hidden="true" />
          )}
          Resolve
        </Button>
      </div>

      {preview ? (
        <div className="mt-3 rounded-[var(--radius-control)] border border-border bg-muted/50 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-[10px] font-semibold">{preview.sourceRef}</p>
            <Badge tone="neutral">{preview.tokenEstimate} tokens</Badge>
          </div>
          <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-4 text-muted-foreground">
            {preview.resolvedContent}
          </pre>
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              disabled={selectedPaths.includes(repositoryPathOf(preview))}
              onClick={() => onAdd(repositoryPathOf(preview))}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add to context
            </Button>
          </div>
        </div>
      ) : null}

      {selectedPaths.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {selectedPaths.map((path) => (
            <div
              key={path}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-muted/60 px-2.5 py-2 text-[10px]"
            >
              <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label={`Remove ${path}`}
                onClick={() => onRemove(path)}
              >
                <XCircle className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  )
}

function RunsHistorySection({
  workspace
}: {
  readonly workspace: UseWorkspaceResult
}): React.JSX.Element {
  const projectId = workspace.workspace?.project.id ?? null
  const [runs, setRuns] = useState<readonly RunSummary[] | null>(null)
  const [detail, setDetail] = useState<RunAggregateView | null>(null)

  const reloadRuns = useCallback(async (): Promise<void> => {
    if (projectId === null) return
    try {
      setRuns(await workspace.runList(projectId))
    } catch {
      setRuns([])
    }
  }, [projectId, workspace])

  useEffect(() => {
    if (projectId === null) return
    let active = true
    void workspace
      .runList(projectId)
      .then((list) => {
        if (active) setRuns(list)
      })
      .catch(() => {
        if (active) setRuns([])
      })
    return () => {
      active = false
    }
  }, [projectId, workspace])

  const openRun = useCallback(
    async (runId: string): Promise<void> => {
      try {
        setDetail(await workspace.runGet(runId))
      } catch {
        setDetail(null)
      }
    },
    [workspace]
  )

  return (
    <Section
      eyebrow="run.list · run.get · persisted history"
      title="Runs"
      action={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh runs"
          onClick={() => void reloadRuns()}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </Button>
      }
    >
      {runs === null ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Loading persisted runs…
        </div>
      ) : runs.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">No persisted runs yet.</div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <div key={run.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => void openRun(run.id)}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold">
                  {run.id}
                </span>
                <Badge
                  tone={
                    run.status === 'FINISHED'
                      ? 'success'
                      : run.status === 'INTERRUPTED'
                        ? 'danger'
                        : 'info'
                  }
                >
                  {run.status}
                </Badge>
                {run.outcome ? <RunOutcomeBadge outcome={run.outcome} /> : null}
                <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </button>
              {detail && detail.run.id === run.id ? (
                <div className="mt-2 space-y-3 rounded-[var(--radius-control)] border border-border bg-muted/40 p-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
                    <dt className="text-muted-foreground">Snapshot</dt>
                    <dd className="truncate text-right font-mono">
                      {detail.run.contextSnapshotId}
                    </dd>
                    <dt className="text-muted-foreground">Task</dt>
                    <dd className="truncate text-right font-mono">{detail.run.taskId}</dd>
                    <dt className="text-muted-foreground">Started</dt>
                    <dd className="truncate text-right">{detail.run.startedAt}</dd>
                    <dt className="text-muted-foreground">Completed</dt>
                    <dd className="truncate text-right">{detail.run.completedAt ?? '—'}</dd>
                  </dl>

                  <div>
                    <p className="mb-1 text-[9px] font-semibold text-muted-foreground uppercase">
                      Execution requests
                    </p>
                    <ul className="space-y-1">
                      {detail.executionRequests.map((request) => (
                        <li key={request.executionRequestId} className="text-[10px]">
                          <span className="font-mono">{request.executionRequestId}</span>
                          <Badge tone={request.dispatchOutcome ? 'neutral' : 'info'}>
                            {request.dispatchOutcome ?? 'in-flight'}
                          </Badge>
                          <span className="ml-1 text-muted-foreground">
                            attempt {request.workerAttemptNumber} · completed{' '}
                            {request.completedAt ?? 'no'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="mb-1 text-[9px] font-semibold text-muted-foreground uppercase">
                      Events
                    </p>
                    <ol className="space-y-0.5">
                      {detail.events.map((event) => (
                        <li key={event.id} className="flex gap-2 text-[10px]">
                          <span className="tabular-nums text-muted-foreground">
                            #{event.sequence}
                          </span>
                          <span className="font-semibold">{event.kind}</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {event.detail}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {detail.artifacts.length > 0 ? (
                    <div>
                      <p className="mb-1 text-[9px] font-semibold text-muted-foreground uppercase">
                        Artifacts
                      </p>
                      <ul className="space-y-1">
                        {detail.artifacts.map((artifact) => (
                          <li key={artifact.id} className="text-[10px]">
                            <Badge tone="neutral">{artifact.kind}</Badge>
                            <span className="ml-1 font-mono">{artifact.fileName}</span>
                            <span className="ml-1 text-muted-foreground">
                              {artifact.sizeBytes} B · {artifact.contentHash.slice(0, 12)}…
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function AcceptanceSection({
  workspace,
  runId,
  runOutcome
}: {
  readonly workspace: UseWorkspaceResult
  readonly runId: string | null
  readonly runOutcome: string | null
}): React.JSX.Element {
  const view = workspace.workspace
  const [runBinding, setRunBinding] = useState<{
    taskId: string
    taskSpecVersionId: string
  } | null>(null)
  const [verdicts, setVerdicts] = useState<Record<string, 'PASSED' | 'FAILED'>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [evaluations, setEvaluations] = useState<readonly AcceptanceEvaluationAggregate[]>([])
  const [busy, setBusy] = useState(false)
  const [completeBusy, setCompleteBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Bind the acceptance surface to the RUN being reviewed: the exact task and
  // TaskSpecVersion come from run.get(runId), never from taskSpecs[0].
  useEffect(() => {
    if (runId === null) {
      return
    }
    let active = true
    void workspace
      .runGet(runId)
      .then((aggregate) => {
        if (active) {
          setRunBinding({
            taskId: aggregate.run.taskId,
            taskSpecVersionId: aggregate.run.taskSpecVersionId
          })
          setVerdicts({})
          setNotes({})
        }
      })
      .catch(() => {
        if (active) setRunBinding(null)
      })
    return () => {
      active = false
    }
  }, [runId, workspace])

  const taskId = runBinding?.taskId ?? null
  const taskSpecVersionId = runBinding?.taskSpecVersionId ?? null
  const projectId = view?.project.id ?? null
  const spec = useMemo(
    () => view?.taskSpecs.find((aggregate) => aggregate.spec.id === taskSpecVersionId),
    [view, taskSpecVersionId]
  )
  const criteria = useMemo(() => spec?.criteria ?? [], [spec])

  useEffect(() => {
    if (taskId === null) {
      return
    }
    let active = true
    void workspace
      .listAcceptance(taskId)
      .then((list) => {
        if (active) setEvaluations(list)
      })
      .catch(() => {
        if (active) setEvaluations([])
      })
    return () => {
      active = false
    }
  }, [taskId, workspace])

  const latest = evaluations[evaluations.length - 1]
  const latestPassed = latest?.evaluation.status === 'PASSED'

  const handleSubmit = useCallback(async (): Promise<void> => {
    setError(null)
    if (projectId === null || taskId === null || taskSpecVersionId === null || runId === null)
      return
    if (criteria.length === 0) return
    if (criteria.some((criterion) => verdicts[criterion.id] === undefined)) {
      setError('Verdict every acceptance criterion before submitting.')
      return
    }
    setBusy(true)
    try {
      await workspace.evaluateAcceptance({
        projectId,
        taskId,
        taskSpecVersionId,
        runId,
        criteria: criteria.map((criterion) => ({
          criterionId: criterion.id,
          verdict: verdicts[criterion.id] ?? 'FAILED',
          note: notes[criterion.id]?.trim() || null
        }))
      })
      setEvaluations(await workspace.listAcceptance(taskId))
      await workspace.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Evaluation failed')
    } finally {
      setBusy(false)
    }
  }, [workspace, projectId, taskId, taskSpecVersionId, runId, criteria, verdicts, notes])

  const handleComplete = useCallback(async (): Promise<void> => {
    setError(null)
    if (taskId === null || latest === undefined) return
    setCompleteBusy(true)
    try {
      await workspace.completeTask({ taskId, evaluationId: latest.evaluation.id })
      await workspace.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Completion failed')
    } finally {
      setCompleteBusy(false)
    }
  }, [workspace, taskId, latest])

  return (
    <Section
      eyebrow="acceptance.evaluate · task.complete"
      title="Acceptance"
      action={
        latest ? (
          <Badge tone={latestPassed ? 'success' : 'danger'}>
            evaluation #{latest.evaluation.sequence} · {latest.evaluation.status}
          </Badge>
        ) : (
          <Badge tone="neutral">no evaluation</Badge>
        )
      }
    >
      {runId === null ? (
        <p className="text-[11px] text-muted-foreground">
          Dispatch a run to evaluate its evidence against the task criteria.
        </p>
      ) : criteria.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No task spec criteria available.</p>
      ) : (
        <div className="space-y-3">
          {runOutcome ? (
            <p className="text-[10px] text-muted-foreground">
              Evaluating run <span className="font-mono">{runId}</span> · outcome {runOutcome}
            </p>
          ) : null}
          <div className="space-y-2">
            {criteria.map((criterion, index) => {
              const verdict = verdicts[criterion.id]
              return (
                <div
                  key={criterion.id}
                  className="rounded-[var(--radius-control)] border border-border bg-muted/40 p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-[11px] leading-5">
                      <span className="text-muted-foreground">#{index + 1}</span>{' '}
                      {criterion.description}
                    </p>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setVerdicts((current) => ({ ...current, [criterion.id]: 'PASSED' }))
                        }
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                          verdict === 'PASSED'
                            ? 'bg-status-success/15 text-status-success'
                            : 'text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        PASSED
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setVerdicts((current) => ({ ...current, [criterion.id]: 'FAILED' }))
                        }
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                          verdict === 'FAILED'
                            ? 'bg-status-danger/15 text-status-danger'
                            : 'text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        FAILED
                      </button>
                    </div>
                  </div>
                  <input
                    aria-label={`Note for ${criterion.description}`}
                    placeholder="note (optional)"
                    value={notes[criterion.id] ?? ''}
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [criterion.id]: event.target.value }))
                    }
                    className="mt-2 h-6 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {error ? <span className="text-[10px] text-status-danger">{error}</span> : null}
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void handleSubmit()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              Submit evaluation
            </Button>
            <Button
              size="sm"
              disabled={!latestPassed || completeBusy}
              onClick={() => void handleComplete()}
            >
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Complete task
            </Button>
          </div>

          {evaluations.length > 0 ? (
            <div>
              <p className="mb-1 text-[9px] font-semibold text-muted-foreground uppercase">
                Evaluation history
              </p>
              <ol className="space-y-1">
                {evaluations.map((entry) => (
                  <li key={entry.evaluation.id} className="flex items-center gap-2 text-[10px]">
                    <Badge tone={entry.evaluation.status === 'PASSED' ? 'success' : 'danger'}>
                      #{entry.evaluation.sequence} · {entry.evaluation.status}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {entry.evaluation.runId}
                    </span>
                    <span className="text-muted-foreground">
                      {entry.items.map((item) => item.verdict).join(' / ')}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  )
}

function FreezeSection({
  workspace,
  selectedIds,
  selectedRepoPaths,
  frozen,
  onFreeze
}: {
  readonly workspace: UseWorkspaceResult
  readonly selectedIds: readonly string[]
  readonly selectedRepoPaths: readonly string[]
  readonly frozen: FrozenSnapshotView | null
  readonly onFreeze: () => void
}): React.JSX.Element {
  const canFreeze =
    workspace.workspace !== null &&
    (selectedIds.length > 0 || selectedRepoPaths.length > 0) &&
    frozen === null
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
  const [repoPathInput, setRepoPathInput] = useState('')
  const [repoPreview, setRepoPreview] = useState<ResolvedContextItem | null>(null)
  const [selectedRepoPaths, setSelectedRepoPaths] = useState<readonly string[]>([])
  const [repoBusy, setRepoBusy] = useState(false)
  const [frozen, setFrozen] = useState<FrozenSnapshotView | null>(null)
  const [run, setRun] = useState<RunState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const toggleCandidate = useCallback((id: string): void => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((candidateId) => candidateId !== id) : [...current, id]
    )
  }, [])

  const handleResolveRepo = useCallback(async (): Promise<void> => {
    setActionError(null)
    const path = repoPathInput.trim()
    if (path.length === 0 || view === null) return
    const spec = view.taskSpecs[0]
    const baseBaseline = view.activeBaseline ?? view.baselines[0]?.baseline ?? null
    if (!spec || baseBaseline === null) {
      setActionError('No task spec / baseline available to resolve against.')
      return
    }
    setRepoBusy(true)
    try {
      const result = await workspace.resolveContext({
        projectId: view.project.id,
        taskId: spec.spec.taskId,
        taskSpecVersionId: spec.spec.id,
        baseBaselineId: baseBaseline.id,
        selections: [{ kind: 'REPOSITORY_CONTENT', path }]
      })
      setRepoPreview(result.items[0] ?? null)
    } catch (error) {
      setRepoPreview(null)
      setActionError(error instanceof Error ? error.message : 'Resolve failed')
    } finally {
      setRepoBusy(false)
    }
  }, [view, repoPathInput, workspace])

  const addRepoSelection = useCallback((path: string): void => {
    setSelectedRepoPaths((current) => (current.includes(path) ? current : [...current, path]))
  }, [])

  const removeRepoSelection = useCallback((path: string): void => {
    setSelectedRepoPaths((current) => current.filter((item) => item !== path))
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
    const selections = [
      ...candidates.flatMap((candidate) =>
        !candidate.required &&
        selectedIds.includes(candidate.id) &&
        candidate.source.kind === 'NODE_VERSION'
          ? [{ source: candidate.source, selectionReason: null }]
          : []
      ),
      ...selectedRepoPaths.map((path) => ({
        source: { kind: 'REPOSITORY_CONTENT' as const, path },
        selectionReason: null
      }))
    ]
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
  }, [view, candidates, selectedIds, selectedRepoPaths, workspace])

  const handleDispatch = useCallback(async (): Promise<void> => {
    setActionError(null)
    if (frozen === null) return
    const executionRequestId = crypto.randomUUID()
    setRun({ executionRequestId, status: 'PENDING' })
    try {
      const response = await workspace.execute({
        executionRequestId,
        contextSnapshotId: frozen.id
      })
      setRun({
        executionRequestId,
        runId: response.runId,
        status: 'DONE',
        result: response.result
      })
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
        <div className="space-y-4">
          <ComposerSection
            candidates={candidates}
            selectedIds={selectedIds}
            onToggle={toggleCandidate}
          />
          <RepositorySection
            input={repoPathInput}
            busy={repoBusy}
            preview={repoPreview}
            selectedPaths={selectedRepoPaths}
            onInputChange={setRepoPathInput}
            onResolve={() => void handleResolveRepo()}
            onAdd={addRepoSelection}
            onRemove={removeRepoSelection}
          />
        </div>
        <div className="space-y-4">
          <FreezeSection
            workspace={workspace}
            selectedIds={selectedIds}
            selectedRepoPaths={selectedRepoPaths}
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

      <AcceptanceSection
        workspace={workspace}
        runId={run?.runId ?? null}
        runOutcome={run?.result?.outcome ?? null}
      />

      <RunsHistorySection workspace={workspace} />
    </div>
  )
}
