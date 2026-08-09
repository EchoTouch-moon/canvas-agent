import { useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileText,
  FolderOpen,
  GitBranch,
  ShieldCheck
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ProductSetupState, ProjectSetupInput } from '@/lib/product-onboarding'

export interface ProjectSetupFlowProps {
  readonly state: ProductSetupState
  readonly suggestedProjectName: string
  readonly busy: boolean
  readonly disabled: boolean
  readonly repositoryDirty: boolean
  readonly error: string | null
  readonly onAdvance: (input: ProjectSetupInput) => Promise<void>
  readonly onActivateBaseline: (baselineId: string) => Promise<void>
}

const fieldClassName =
  'w-full rounded-[var(--radius-control)] border border-input bg-background px-2.5 py-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50'

const projectSteps = [
  { label: 'Project', detail: 'Identity', icon: FolderOpen },
  { label: 'Charter', detail: 'Goal', icon: FileText },
  { label: 'Baseline', detail: 'DRAFT review', icon: GitBranch }
] as const

function projectStepIndex(kind: ProductSetupState['kind']): number {
  switch (kind) {
    case 'NO_PROJECT':
      return 0
    case 'PROJECT_NEEDS_CHARTER':
      return 1
    case 'PROJECT_NEEDS_BASELINE_DRAFT':
    case 'BASELINE_DRAFT_REVIEW':
      return 2
    default:
      return projectSteps.length
  }
}

function ProjectProgress({ activeStep }: { readonly activeStep: number }): React.JSX.Element {
  return (
    <ol
      aria-label="Project setup progress"
      className="grid grid-cols-3 gap-1 rounded-[var(--radius-control)] border border-border bg-muted/45 p-1"
    >
      {projectSteps.map((step, index) => {
        const Icon = step.icon
        const complete = index < activeStep
        const active = index === activeStep
        return (
          <li
            key={step.label}
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
              <span className="block truncate font-semibold">{step.label}</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {step.detail}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function ProjectSetupFlow({
  state,
  suggestedProjectName,
  busy,
  disabled,
  repositoryDirty,
  error,
  onAdvance,
  onActivateBaseline
}: ProjectSetupFlowProps): React.JSX.Element {
  const [projectName, setProjectName] = useState(suggestedProjectName)
  const [projectDescription, setProjectDescription] = useState('')
  const [charterTitle, setCharterTitle] = useState('Project goal')
  const [charterBody, setCharterBody] = useState('')
  const [baselineName, setBaselineName] = useState('Initial baseline')
  const [baselineDescription, setBaselineDescription] = useState('')

  const effective = state.kind === 'REPOSITORY_DIRTY_BLOCKED' ? state.blockedState : state
  const ambiguity = state.ambiguity
  const actionLabel =
    effective.kind === 'NO_PROJECT'
      ? 'Create project'
      : effective.kind === 'PROJECT_NEEDS_CHARTER'
        ? effective.charterNodeId === null
          ? 'Create charter fact'
          : 'Publish charter'
        : effective.kind === 'PROJECT_NEEDS_BASELINE_DRAFT'
          ? 'Create draft baseline'
          : null

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    await onAdvance({
      projectName,
      projectDescription,
      charterTitle,
      charterBody,
      baselineName,
      baselineDescription
    })
  }

  if (effective.kind === 'BASELINE_DRAFT_REVIEW') {
    const activationBlockedByDirty = repositoryDirty || state.kind === 'REPOSITORY_DIRTY_BLOCKED'
    return (
      <section
        className="space-y-4 rounded-[var(--radius-panel)] border border-border bg-card p-4 shadow-[0_10px_30px_-24px_color-mix(in_oklab,var(--foreground)_45%,transparent)]"
        aria-labelledby="baseline-review-title"
      >
        <header className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-status-warning/30 bg-status-warning/10 text-status-warning">
            <GitBranch className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warning">
                <GitBranch className="size-3" aria-hidden="true" />
                DRAFT
              </Badge>
              <span className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Step 3 of 3
              </span>
            </div>
            <h2 id="baseline-review-title" className="mt-1 text-sm font-semibold">
              Review the initial baseline
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Your charter and repository revision are saved. Activation is a separate decision;
              this DRAFT will not become active automatically.
            </p>
          </div>
        </header>
        <ProjectProgress activeStep={projectSteps.length} />
        <div className="rounded-[var(--radius-control)] border border-status-warning/25 bg-status-warning/8 p-3">
          <div className="flex items-start gap-2">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-status-warning"
              aria-hidden="true"
            />
            <p className="text-xs leading-5 text-foreground">
              Confirm this immutable project context before you continue to Task setup.
            </p>
          </div>
        </div>
        {activationBlockedByDirty ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-control)] border border-status-warning/30 bg-status-warning/8 p-3 text-xs leading-5 text-status-warning"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Commit or stash repository changes in your Git tool before activating this Baseline.
              Canvas Agent will not clean or mutate them automatically.
            </span>
          </div>
        ) : null}
        {ambiguity ? (
          <div
            role="alert"
            className="rounded-[var(--radius-control)] border border-status-danger/30 bg-status-danger/8 p-3 text-xs text-status-danger"
          >
            {ambiguity.message}
          </div>
        ) : (
          <Button
            type="button"
            disabled={disabled || busy || activationBlockedByDirty}
            onClick={() => void onActivateBaseline(effective.baselineId)}
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
            Activate this baseline
          </Button>
        )}
        {error ? (
          <div
            role="alert"
            className="rounded-[var(--radius-control)] border border-status-danger/30 bg-status-danger/8 p-3 text-xs text-status-danger"
          >
            {error}
          </div>
        ) : null}
      </section>
    )
  }

  if (
    effective.kind === 'READY_FOR_TASK' ||
    effective.kind === 'TASK_DRAFT_NEEDS_SPEC' ||
    effective.kind === 'TASK_READY'
  ) {
    return <></>
  }

  return (
    <form
      className="space-y-4 rounded-[var(--radius-panel)] border border-border bg-card p-4 shadow-[0_10px_30px_-24px_color-mix(in_oklab,var(--foreground)_45%,transparent)]"
      onSubmit={(event) => void submit(event)}
    >
      <header className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-primary/25 bg-primary/10 text-primary">
          <FolderOpen className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={state.kind === 'REPOSITORY_DIRTY_BLOCKED' ? 'warning' : 'accent'}>
              <FolderOpen className="size-3" aria-hidden="true" />
              Project setup
            </Badge>
            <span className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Step {projectStepIndex(effective.kind) + 1} of 3
            </span>
          </div>
          <h2 className="mt-1 text-sm font-semibold">Prepare this project</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Establish the project identity, goal and first executable context in three explicit
            steps.
          </p>
        </div>
      </header>

      <ProjectProgress activeStep={projectStepIndex(effective.kind)} />

      {effective.kind === 'NO_PROJECT' ? (
        <fieldset className="space-y-3 rounded-[var(--radius-control)] border border-border bg-background/45 p-3">
          <legend className="px-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Project identity
          </legend>
          <label className="block space-y-1 text-xs font-medium">
            Project name
            <Input
              required
              disabled={disabled || busy}
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Description (optional)
            <textarea
              className={fieldClassName}
              disabled={disabled || busy}
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
            />
          </label>
        </fieldset>
      ) : null}

      {effective.kind === 'PROJECT_NEEDS_CHARTER' ? (
        <fieldset className="space-y-3 rounded-[var(--radius-control)] border border-border bg-background/45 p-3">
          <legend className="px-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Project charter
          </legend>
          <label className="block space-y-1 text-xs font-medium">
            Charter title
            <Input
              required
              disabled={disabled || busy}
              value={charterTitle}
              onChange={(event) => setCharterTitle(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Project goal
            <textarea
              required
              rows={5}
              className={fieldClassName}
              disabled={disabled || busy}
              value={charterBody}
              onChange={(event) => setCharterBody(event.target.value)}
            />
          </label>
        </fieldset>
      ) : null}

      {effective.kind === 'PROJECT_NEEDS_BASELINE_DRAFT' ? (
        <fieldset className="space-y-3 rounded-[var(--radius-control)] border border-border bg-background/45 p-3">
          <legend className="px-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Initial baseline · DRAFT
          </legend>
          <label className="block space-y-1 text-xs font-medium">
            Baseline name
            <Input
              required
              disabled={disabled || busy}
              value={baselineName}
              onChange={(event) => setBaselineName(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Baseline description (optional)
            <textarea
              className={fieldClassName}
              disabled={disabled || busy}
              value={baselineDescription}
              onChange={(event) => setBaselineDescription(event.target.value)}
            />
          </label>
        </fieldset>
      ) : null}

      {repositoryDirty || state.kind === 'REPOSITORY_DIRTY_BLOCKED' ? (
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
      {ambiguity ? (
        <div
          role="alert"
          className="rounded-[var(--radius-control)] border border-status-danger/30 bg-status-danger/8 p-3 text-xs text-status-danger"
        >
          {ambiguity.message}
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
      {actionLabel ? (
        <Button
          type="submit"
          disabled={
            disabled || busy || ambiguity !== null || state.kind === 'REPOSITORY_DIRTY_BLOCKED'
          }
        >
          {busy ? 'Saving…' : actionLabel}
          {!busy ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
        </Button>
      ) : null}
    </form>
  )
}
