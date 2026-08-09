// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProjectSetupFlow } from './project-setup-flow'
import type { ProductSetupState } from '@/lib/product-onboarding'

afterEach(cleanup)

describe('ProjectSetupFlow', () => {
  it('keeps DRAFT Baseline activation as a separate explicit action', async () => {
    const onAdvance = vi.fn(async () => undefined)
    const onActivate = vi.fn(async () => undefined)
    const state: ProductSetupState = {
      kind: 'BASELINE_DRAFT_REVIEW',
      projectId: 'project-1',
      baselineId: 'baseline-draft',
      ambiguity: null
    }

    render(
      <ProjectSetupFlow
        state={state}
        suggestedProjectName="Canvas"
        busy={false}
        disabled={false}
        repositoryDirty={false}
        error={null}
        onAdvance={onAdvance}
        onActivateBaseline={onActivate}
      />
    )

    expect(onActivate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Activate this baseline' }))
    await waitFor(() => expect(onActivate).toHaveBeenCalledWith('baseline-draft'))
    expect(onAdvance).not.toHaveBeenCalled()
  })

  it('explains dirty repository recovery and offers no cleanup mutation', () => {
    const state: ProductSetupState = {
      kind: 'REPOSITORY_DIRTY_BLOCKED',
      workingTreePatchHash: 'a'.repeat(64),
      ambiguity: null,
      blockedState: {
        kind: 'PROJECT_NEEDS_BASELINE_DRAFT',
        projectId: 'project-1',
        charterVersionId: 'charter-1',
        ambiguity: null
      }
    }

    render(
      <ProjectSetupFlow
        state={state}
        suggestedProjectName="Canvas"
        busy={false}
        disabled={false}
        repositoryDirty
        error={null}
        onAdvance={vi.fn(async () => undefined)}
        onActivateBaseline={vi.fn(async () => undefined)}
      />
    )

    expect(screen.getByText(/Commit or stash repository changes/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create draft baseline' })).toHaveProperty(
      'disabled',
      true
    )
    expect(screen.queryByRole('button', { name: /clean|stash|commit/i })).toBeNull()
  })

  it('keeps a DRAFT Baseline inspectable but blocks activation after the repository becomes dirty', () => {
    const onActivate = vi.fn(async () => undefined)
    const state: ProductSetupState = {
      kind: 'REPOSITORY_DIRTY_BLOCKED',
      workingTreePatchHash: 'b'.repeat(64),
      ambiguity: null,
      blockedState: {
        kind: 'BASELINE_DRAFT_REVIEW',
        projectId: 'project-1',
        baselineId: 'baseline-draft',
        ambiguity: null
      }
    }

    render(
      <ProjectSetupFlow
        state={state}
        suggestedProjectName="Canvas"
        busy={false}
        disabled={false}
        repositoryDirty
        error={null}
        onAdvance={vi.fn(async () => undefined)}
        onActivateBaseline={onActivate}
      />
    )

    expect(screen.getByText(/before activating this Baseline/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Activate this baseline' })).toHaveProperty(
      'disabled',
      true
    )
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('submits only user-authored first Project fields', async () => {
    const onAdvance = vi.fn(async () => undefined)
    const state: ProductSetupState = { kind: 'NO_PROJECT', ambiguity: null }
    render(
      <ProjectSetupFlow
        state={state}
        suggestedProjectName="canvas-agent"
        busy={false}
        disabled={false}
        repositoryDirty={false}
        error={null}
        onAdvance={onAdvance}
        onActivateBaseline={vi.fn(async () => undefined)}
      />
    )

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'My Project' } })
    fireEvent.change(screen.getByLabelText('Description (optional)'), {
      target: { value: 'A local project' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() =>
      expect(onAdvance).toHaveBeenCalledWith(
        expect.objectContaining({
          projectName: 'My Project',
          projectDescription: 'A local project'
        })
      )
    )
  })
})
