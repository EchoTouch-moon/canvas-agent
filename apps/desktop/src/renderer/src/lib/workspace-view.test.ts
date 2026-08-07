import { describe, expect, it } from 'vitest'
import { createFakeWorkspaceState } from '@/data/fake-workspace'
import {
  createInitialExecutionSession,
  createWorkspaceRenderState,
  getSelectedContextTokens
} from './workspace-view'
import { createInitialWorkspaceUiState } from '@/state/workspace-ui-reducer'

describe('ProjectStateView renderer projection', () => {
  it('creates only TaskSpec and NodeVersion context candidates', () => {
    const view = createWorkspaceRenderState(
      createFakeWorkspaceState(),
      createInitialWorkspaceUiState(),
      createInitialExecutionSession()
    )

    expect(view.contextItems.map((item) => item.type)).toEqual(['USER_INPUT', 'NODE_VERSION'])
    expect(view.contextItems.map((item) => item.authority)).toEqual([
      'TASK_INSTRUCTION',
      'PROJECT_FACT'
    ])
    const candidateTypes: readonly string[] = view.contextItems.map((item) => item.type)
    expect(candidateTypes).not.toContain('REPOSITORY_CONTENT')
    expect(candidateTypes).not.toContain('ARTIFACT')
    expect(getSelectedContextTokens(view)).toBeGreaterThan(0)
  })

  it('derives Node relationships from real Edge records', () => {
    const workspace = createFakeWorkspaceState()
    const view = createWorkspaceRenderState(
      workspace,
      createInitialWorkspaceUiState(),
      createInitialExecutionSession()
    )
    const requirementId = workspace.nodes.find((node) => node.type === 'REQUIREMENT')?.id
    const requirement = view.nodes.find((node) => node.id === requirementId)
    const expectedNeighborIds = workspace.edges
      .filter((edge) => edge.sourceNodeId === requirementId || edge.targetNodeId === requirementId)
      .map((edge) => (edge.sourceNodeId === requirementId ? edge.targetNodeId : edge.sourceNodeId))

    expect(requirement?.edges.map((edge) => edge.nodeId)).toEqual(expectedNeighborIds)
    expect('links' in (requirement ?? {})).toBe(false)
  })

  it.each(['REVISION_MISMATCH', 'CANCELLED', 'SUCCEEDED'] as const)(
    'keeps %s as a normal DispatchResult outcome',
    (outcome) => {
      const session = {
        ...createInitialExecutionSession(),
        executionRequestId: 'execution-1',
        snapshotId: 'snapshot-1',
        status: 'finished' as const,
        result: { outcome, claimGranted: true }
      }
      const view = createWorkspaceRenderState(
        createFakeWorkspaceState(),
        createInitialWorkspaceUiState(),
        session
      )

      expect(view.run.status).toBe('FINISHED')
      expect(view.run.outcome).toBe(outcome)
    }
  )
})
