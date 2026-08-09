import { useState } from 'react'
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
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge tone="success">READY</Badge>
        Task specification published. Context can now be frozen explicitly.
      </div>
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
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <div className="flex items-center gap-2">
        <Badge tone="accent">task</Badge>
        <h2 className="text-sm font-semibold">
          {effective.kind === 'READY_FOR_TASK'
            ? 'Create the first task'
            : 'Publish its specification'}
        </h2>
      </div>
      {effective.kind === 'READY_FOR_TASK' ? (
        <label className="block space-y-1 text-xs font-medium">
          Task title
          <Input
            required
            disabled={disabled || busy}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      ) : (
        <>
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
        </>
      )}
      {state.ambiguity ? (
        <p role="alert" className="text-xs text-status-danger">
          {state.ambiguity.message}
        </p>
      ) : null}
      {repositoryDirty ? (
        <p role="alert" className="text-xs leading-5 text-status-warning">
          Commit or stash repository changes in your Git tool, then refresh. Canvas Agent will not
          clean or mutate them automatically.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-status-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={disabled || busy || state.ambiguity !== null}>
        {busy
          ? 'Saving…'
          : effective.kind === 'READY_FOR_TASK'
            ? 'Create task'
            : 'Publish task specification'}
      </Button>
    </form>
  )
}
