import { describe, expect, it } from 'vitest'
import { createFakeWorkspaceClient, createFakeWorkspaceState } from './fake-workspace'

describe('fake WorkspaceClient transport', () => {
  it('hydrates, freezes, dispatches and waits for terminal cancellation', async () => {
    const client = createFakeWorkspaceClient({ executionDelayMs: 0 })
    const projects = await client.command('project.list', {})
    const workspace = await client.command('project.state', { projectId: projects[0]!.id })
    const revision = await client.command('revision.current', {})
    const task = workspace.tasks[0]!
    const taskSpec = task.specs[0]!
    const baseline = workspace.baselines[0]!

    const snapshot = await client.command('snapshot.freeze', {
      projectId: workspace.project.id,
      taskId: task.task.id,
      taskSpecVersionId: taskSpec.version.id,
      baseBaselineId: baseline.baseline.id,
      expectedRepositoryRevisionId: revision.id,
      items: [
        {
          itemType: 'USER_INPUT',
          sourceRef: taskSpec.version.id,
          resolvedContent: taskSpec.version.description,
          authority: 'TASK_INSTRUCTION',
          priority: 'P0',
          tokenEstimate: 12,
          selectionReason: 'test'
        }
      ]
    })

    const executionRequestId = 'execution-cancel-test'
    const dispatch = client.command('execution.dispatch', {
      executionRequestId,
      contextSnapshotId: snapshot.id
    })
    const cancel = await client.command('execution.cancel', { executionRequestId })
    const result = await dispatch

    expect(snapshot.status).toBe('FROZEN')
    expect(cancel.cancelled).toBe(true)
    expect(result.outcome).toBe('CANCELLED')
  })

  it('uses authoritative entity-shaped state rather than a core-flow fixture', async () => {
    const state = createFakeWorkspaceState()

    expect(state.nodes[0]).toHaveProperty('projectId', state.project.id)
    expect(state.edges[0]).toHaveProperty('sourceNodeId')
    expect(state.tasks[0]?.specs[0]?.version).toHaveProperty('taskId')
    expect(state.baselines[0]?.baseline).toHaveProperty('repositoryRevisionId')
  })
})
