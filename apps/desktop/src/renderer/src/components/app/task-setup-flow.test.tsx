// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskSetupFlow } from './task-setup-flow'
import type { ProductSetupState } from '@/lib/product-onboarding'

afterEach(cleanup)

describe('TaskSetupFlow', () => {
  it('creates a Task without silently publishing its TaskSpec', async () => {
    const onAdvance = vi.fn(async () => undefined)
    const state: ProductSetupState = {
      kind: 'READY_FOR_TASK',
      projectId: 'project-1',
      activeBaselineId: 'baseline-1',
      ambiguity: null
    }
    render(
      <TaskSetupFlow
        state={state}
        targets={[]}
        busy={false}
        disabled={false}
        repositoryDirty={false}
        error={null}
        onAdvance={onAdvance}
      />
    )

    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Implement onboarding' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() =>
      expect(onAdvance).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Implement onboarding', criteria: [] })
      )
    )
  })

  it('publishes an explicit objective, scope and visible acceptance method', async () => {
    const onAdvance = vi.fn(async () => undefined)
    const state: ProductSetupState = {
      kind: 'TASK_DRAFT_NEEDS_SPEC',
      projectId: 'project-1',
      taskId: 'task-1',
      ambiguity: null
    }
    render(
      <TaskSetupFlow
        state={state}
        targets={[]}
        busy={false}
        disabled={false}
        repositoryDirty={false}
        error={null}
        onAdvance={onAdvance}
      />
    )

    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Ship safely' } })
    fireEvent.change(screen.getByLabelText('Scope and non-goals'), {
      target: { value: 'Renderer only' }
    })
    fireEvent.change(screen.getByLabelText('Acceptance criterion'), {
      target: { value: 'All lifecycle states are tested' }
    })
    fireEvent.change(screen.getByLabelText('Verification method'), {
      target: { value: 'AUTOMATED_TEST' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publish task specification' }))

    await waitFor(() =>
      expect(onAdvance).toHaveBeenCalledWith({
        title: '',
        description: 'Ship safely',
        scope: 'Renderer only',
        criteria: [
          {
            description: 'All lifecycle states are tested',
            verificationMethod: 'AUTOMATED_TEST'
          }
        ]
      })
    )
  })

  it('explains the dirty recovery path while TaskSpec publication is disabled', () => {
    const onAdvance = vi.fn(async () => undefined)
    const state: ProductSetupState = {
      kind: 'TASK_DRAFT_NEEDS_SPEC',
      projectId: 'project-1',
      taskId: 'task-1',
      ambiguity: null
    }
    render(
      <TaskSetupFlow
        state={state}
        targets={[]}
        busy={false}
        disabled
        repositoryDirty
        error={null}
        onAdvance={onAdvance}
      />
    )

    expect(screen.getByText(/Commit or stash repository changes/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish task specification' }))
    expect(onAdvance).not.toHaveBeenCalled()
  })
})
