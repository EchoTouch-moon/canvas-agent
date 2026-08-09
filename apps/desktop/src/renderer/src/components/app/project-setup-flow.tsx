import { useState } from 'react'
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
      <section className="space-y-3" aria-labelledby="baseline-review-title">
        <div className="flex items-center gap-2">
          <Badge tone="warning">DRAFT</Badge>
          <h2 id="baseline-review-title" className="text-sm font-semibold">
            Review the initial baseline
          </h2>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          The charter and repository revision are saved. Activation is a separate decision and is
          never automatic.
        </p>
        {activationBlockedByDirty ? (
          <p role="alert" className="text-xs leading-5 text-status-warning">
            Commit or stash repository changes in your Git tool before activating this Baseline.
            Canvas Agent will not clean or mutate them automatically.
          </p>
        ) : null}
        {ambiguity ? (
          <p role="alert" className="text-xs text-status-danger">
            {ambiguity.message}
          </p>
        ) : (
          <Button
            type="button"
            disabled={disabled || busy || activationBlockedByDirty}
            onClick={() => void onActivateBaseline(effective.baselineId)}
          >
            Activate this baseline
          </Button>
        )}
        {error ? (
          <p role="alert" className="text-xs text-status-danger">
            {error}
          </p>
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
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <div className="flex items-center gap-2">
        <Badge tone={state.kind === 'REPOSITORY_DIRTY_BLOCKED' ? 'warning' : 'accent'}>setup</Badge>
        <h2 className="text-sm font-semibold">Prepare this project</h2>
      </div>

      {effective.kind === 'NO_PROJECT' ? (
        <>
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
        </>
      ) : null}

      {effective.kind === 'PROJECT_NEEDS_CHARTER' ? (
        <>
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
        </>
      ) : null}

      {effective.kind === 'PROJECT_NEEDS_BASELINE_DRAFT' ? (
        <>
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
        </>
      ) : null}

      {repositoryDirty || state.kind === 'REPOSITORY_DIRTY_BLOCKED' ? (
        <p role="alert" className="text-xs leading-5 text-status-warning">
          Commit or stash repository changes in your Git tool, then refresh. Canvas Agent will not
          clean or mutate them automatically.
        </p>
      ) : null}
      {ambiguity ? (
        <p role="alert" className="text-xs text-status-danger">
          {ambiguity.message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-status-danger">
          {error}
        </p>
      ) : null}
      {actionLabel ? (
        <Button
          type="submit"
          disabled={
            disabled || busy || ambiguity !== null || state.kind === 'REPOSITORY_DIRTY_BLOCKED'
          }
        >
          {busy ? 'Saving…' : actionLabel}
        </Button>
      ) : null}
    </form>
  )
}
