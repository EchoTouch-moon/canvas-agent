import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  ListChecks,
  Target
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ProductSetupState, TaskSetupInput } from '@/lib/product-onboarding'
import type { NodeVersionRecord } from '@/lib/workspace-types'

export interface TaskSetupFlowProps {
  readonly state: ProductSetupState
  readonly targets: readonly NodeVersionRecord[]
  readonly busy: boolean
  readonly disabled: boolean
  readonly repositoryDirty: boolean
  readonly error: string | null
  readonly onAdvance: (input: TaskSetupInput) => Promise<void>
}

const fieldClassName =
  'w-full rounded-[var(--radius-control)] border border-input bg-background px-2.5 py-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50'

const taskStages = [
  { label: 'Task', detail: 'Intent', icon: ClipboardList },
  { label: 'TaskSpec', detail: 'Acceptance', icon: FileCheck2 }
] as const

function taskStageIndex(kind: ProductSetupState['kind']): number {
  switch (kind) {
    case 'READY_FOR_TASK':
      return 0
    case 'TASK_DRAFT_NEEDS_SPEC':
      return 1
    case 'TASK_READY':
      return taskStages.length
    default:
      return 0
  }
}

function TaskProgress({ activeStage }: { readonly activeStage: number }): React.JSX.Element {
  return (
    <ol
      aria-label="Task setup progress"
      className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] border border-border bg-muted/45 p-1"
    >
      {taskStages.map((stage, index) => {
        const Icon = stage.icon
        const complete = index < activeStage
        const active = index === activeStage
        return (
          <li
            key={stage.label}
            className={`flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-[11px] ${
              active
                ? 'bg-background text-foreground shadow-sm'
                : complete
                  ? 'text-status-success'
                  : 'text-muted-foreground'
            }`}
          >
            <span
              className={`grid size-5 shrink-0 place-items-center rounded-full border ${
                active
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : complete
                    ? 'border-status-success/35 bg-status-success/10 text-status-success'
                    : 'border-border bg-background/70'
              }`}
            >
              {complete ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                <Icon className="size-3" aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0 truncate">
              <span className="block truncate font-semibold">{stage.label}</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {stage.detail}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function verificationMethodFrom(
  value: string
): NonNullable<TaskSetupInput['criteria'][number]['verificationMethod']> {
  switch (value) {
    case 'AUTOMATED_TEST':
    case 'ARTIFACT_CHECK':
    case 'STRUCTURED_ASSERTION':
      return value
    case 'MANUAL_REVIEW':
    default:
      return 'MANUAL_REVIEW'
  }
}

export function TaskSetupFlow({
  state,
  targets,
  busy,
  disabled,
  repositoryDirty,
  error,
  onAdvance
}: TaskSetupFlowProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState('')
  const [targetNodeVersionId, setTargetNodeVersionId] = useState('')
  const [criterion, setCriterion] = useState('')
  const [verificationMethod, setVerificationMethod] =
    useState<TaskSetupInput['criteria'][number]['verificationMethod']>('MANUAL_REVIEW')

  const effective = state.kind === 'REPOSITORY_DIRTY_BLOCKED' ? state.blockedState : state
  if (effective.kind === 'TASK_READY') {
    return (
      <section
        className="space-y-4 rounded-[var(--radius-panel)] border border-status-success/25 bg-card p-4 shadow-[0_10px_30px_-24px_color-mix(in_oklab,var(--foreground)_45%,transparent)]"
        aria-labelledby="task-ready-title"
      >
        <header className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-status-success/30 bg-status-success/10 text-status-success">
            <CheckCircle2 className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">
                <CheckCircle2 className="size-3" aria-hidden="true" />
                READY
              </Badge>
              <span className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Task + TaskSpec
              </span>
            </div>
            <h2 id="task-ready-title" className="mt-1 text-sm font-semibold">
              Task context is ready
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              The TaskSpec is published. Context can now be frozen explicitly before a Run.
            </p>
          </div>
        </header>
        <TaskProgress activeStage={taskStages.length} />
      </section>
    )
  }
  if (effective.kind !== 'READY_FOR_TASK' && effective.kind !== 'TASK_DRAFT_NEEDS_SPEC') {
    return <></>
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    await onAdvance({
      title,
      description,
      scope,
      ...(targetNodeVersionId ? { targetNodeVersionId } : {}),
      criteria: criterion.trim()
        ? [{ description: criterion, verificationMethod: verificationMethod ?? 'MANUAL_REVIEW' }]
        : []
    })
  }

  return (
    <form
      className="space-y-4 rounded-[var(--radius-panel)] border border-border bg-card p-4 shadow-[0_10px_30px_-24px_color-mix(in_oklab,var(--foreground)_45%,transparent)]"
      onSubmit={(event) => void submit(event)}
    >
      <header className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-primary/25 bg-primary/10 text-primary">
          {effective.kind === 'READY_FOR_TASK' ? (
            <ClipboardList className="size-4" aria-hidden="true" />
          ) : (
            <FileCheck2 className="size-4" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">
              {effective.kind === 'READY_FOR_TASK' ? (
                <ClipboardList className="size-3" aria-hidden="true" />
              ) : (
                <FileCheck2 className="size-3" aria-hidden="true" />
              )}
              {effective.kind === 'READY_FOR_TASK' ? 'Task' : 'TaskSpec'}
            </Badge>
            <span className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Stage {taskStageIndex(effective.kind) + 1} of 2
            </span>
          </div>
          <h2 className="mt-1 text-sm font-semibold">
            {effective.kind === 'READY_FOR_TASK'
              ? 'Create the first task'
              : 'Publish its specification'}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {effective.kind === 'READY_FOR_TASK'
              ? 'Capture the work intent first. Publishing acceptance details is a separate next stage.'
              : 'Define objective, boundaries and a verifiable acceptance signal for this Task.'}
          </p>
        </div>
      </header>

      <TaskProgress activeStage={taskStageIndex(effective.kind)} />

      {effective.kind === 'READY_FOR_TASK' ? (
        <fieldset className="space-y-3 rounded-[var(--radius-control)] border border-border bg-background/45 p-3">
          <legend className="px-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Task intent
          </legend>
          <label className="block space-y-1 text-xs font-medium">
            Task title
            <Input
              required
              disabled={disabled || busy}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        </fieldset>
      ) : (
        <fieldset className="space-y-3 rounded-[var(--radius-control)] border border-border bg-background/45 p-3">
          <legend className="px-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            TaskSpec · acceptance contract
          </legend>
          <label className="block space-y-1 text-xs font-medium">
            Objective
            <textarea
              required
              rows={4}
              className={fieldClassName}
              disabled={disabled || busy}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Scope and non-goals
            <textarea
              required
              rows={4}
              className={fieldClassName}
              disabled={disabled || busy}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Target (optional)
            <select
              className={fieldClassName}
              disabled={disabled || busy}
              value={targetNodeVersionId}
              onChange={(event) => setTargetNodeVersionId(event.target.value)}
            >
              <option value="">No specific target</option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Acceptance criterion
            <Input
              required
              disabled={disabled || busy}
              value={criterion}
              onChange={(event) => setCriterion(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Verification method
            <select
              className={fieldClassName}
              disabled={disabled || busy}
              value={verificationMethod}
              onChange={(event) =>
                setVerificationMethod(verificationMethodFrom(event.target.value))
              }
            >
              <option value="MANUAL_REVIEW">Manual review</option>
              <option value="AUTOMATED_TEST">Automated test</option>
              <option value="ARTIFACT_CHECK">Artifact check</option>
              <option value="STRUCTURED_ASSERTION">Structured assertion</option>
            </select>
          </label>
        </fieldset>
      )}
      {state.ambiguity ? (
        <div
          role="alert"
          className="rounded-[var(--radius-control)] border border-status-danger/30 bg-status-danger/8 p-3 text-xs text-status-danger"
        >
          {state.ambiguity.message}
        </div>
      ) : null}
      {repositoryDirty ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-control)] border border-status-warning/30 bg-status-warning/8 p-3 text-xs leading-5 text-status-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Commit or stash repository changes in your Git tool, then refresh. Canvas Agent will not
            clean or mutate them automatically.
          </span>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded-[var(--radius-control)] border border-status-danger/30 bg-status-danger/8 p-3 text-xs text-status-danger"
        >
          {error}
        </div>
      ) : null}
      <Button type="submit" disabled={disabled || busy || state.ambiguity !== null}>
        {busy
          ? 'Saving…'
          : effective.kind === 'READY_FOR_TASK'
            ? 'Create task'
            : 'Publish task specification'}
        {!busy && effective.kind === 'READY_FOR_TASK' ? (
          <Target className="size-4" aria-hidden="true" />
        ) : null}
        {!busy && effective.kind === 'TASK_DRAFT_NEEDS_SPEC' ? (
          <ListChecks className="size-4" aria-hidden="true" />
        ) : null}
      </Button>
    </form>
  )
}
