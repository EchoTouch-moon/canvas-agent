import { describe, expect, it } from 'vitest'
import { createFakeWorkspaceClient, createFakeWorkspaceState } from './fake-workspace'

describe('fake WorkspaceClient transport', () => {
  it('hydrates, freezes, dispatches and waits for terminal cancellation', async () => {
    const client = createFakeWorkspaceClient({ executionDelayMs: 0 })
    const projects = await client.command('project.list', {})
    const workspace = await client.command('project.state', { projectId: projects[0]!.id })
    const revision = await client.command('revision.current', {})
    const task = workspace.tasks[0]!
    const taskSpec = workspace.taskSpecs[0]!
    const baseline = workspace.baselines[0]!

    const snapshot = await client.command('snapshot.freeze', {
      projectId: workspace.project.id,
      taskId: task.id,
      taskSpecVersionId: taskSpec.spec.id,
      baseBaselineId: baseline.baseline.id,
      expectedRepositoryRevisionId: revision.id,
      selections: [
        {
          source: { kind: 'NODE_VERSION', nodeVersionId: workspace.nodeVersions[0]!.id },
          selectionReason: 'test'
        }
      ]
    })

    const executionRequestId = 'execution-cancel-test'
    const dispatch = client.command('execution.dispatch', {
      executionRequestId,
      contextSnapshotId: snapshot.snapshot.id
    })
    const cancel = await client.command('execution.cancel', { executionRequestId })
    const result = await dispatch

    expect(snapshot.snapshot.status).toBe('FROZEN')
    expect(snapshot.items.map((item) => item.itemType)).toContain('USER_INPUT')
    expect(snapshot.items.map((item) => item.itemType)).toContain('NODE_VERSION')
    expect(snapshot.items[1]?.selectionReason).toBe('test')
    expect(cancel.cancelled).toBe(true)
    expect(result.result.outcome).toBe('CANCELLED')
  })

  it('previews pinned repository content via context.resolve (preview is separate from freeze)', async () => {
    const client = createFakeWorkspaceClient()
    const projects = await client.command('project.list', {})
    const workspace = await client.command('project.state', { projectId: projects[0]!.id })
    const revision = await client.command('revision.current', {})
    const task = workspace.tasks[0]!
    const taskSpec = workspace.taskSpecs[0]!
    const baseline = workspace.baselines[0]!

    const resolved = await client.command('context.resolve', {
      projectId: workspace.project.id,
      taskId: task.id,
      taskSpecVersionId: taskSpec.spec.id,
      baseBaselineId: baseline.baseline.id,
      expectedRepositoryRevisionId: revision.id,
      selections: [{ kind: 'REPOSITORY_CONTENT', path: 'README.md' }]
    })
    expect(resolved.items).toHaveLength(1)
    expect(resolved.items[0]).toMatchObject({
      itemType: 'REPOSITORY_CONTENT',
      sourceRef: 'repo://README.md',
      authority: 'REFERENCE',
      priority: 'P2'
    })
    expect(resolved.items[0].resolvedContent).toContain('MUSICDB Demo')

    const frozen = await client.command('snapshot.freeze', {
      projectId: workspace.project.id,
      taskId: task.id,
      taskSpecVersionId: taskSpec.spec.id,
      baseBaselineId: baseline.baseline.id,
      expectedRepositoryRevisionId: revision.id,
      selections: [{ source: { kind: 'REPOSITORY_CONTENT', path: 'README.md' } }]
    })
    expect(frozen.items.map((item) => item.itemType)).toContain('REPOSITORY_CONTENT')
  })

  it('records dispatched runs and exposes them via run.list / run.get', async () => {
    const client = createFakeWorkspaceClient({ executionDelayMs: 0 })
    const projects = await client.command('project.list', {})
    const workspace = await client.command('project.state', { projectId: projects[0]!.id })
    const revision = await client.command('revision.current', {})
    const task = workspace.tasks[0]!
    const taskSpec = workspace.taskSpecs[0]!
    const baseline = workspace.baselines[0]!

    const snapshot = await client.command('snapshot.freeze', {
      projectId: workspace.project.id,
      taskId: task.id,
      taskSpecVersionId: taskSpec.spec.id,
      baseBaselineId: baseline.baseline.id,
      expectedRepositoryRevisionId: revision.id,
      selections: [
        { source: { kind: 'NODE_VERSION', nodeVersionId: workspace.nodeVersions[0]!.id } }
      ]
    })

    const dispatch = await client.command('execution.dispatch', {
      executionRequestId: 'exec-1',
      contextSnapshotId: snapshot.snapshot.id
    })
    expect(dispatch.runId).toBeTruthy()
    expect(dispatch.result.outcome).toBe('SUCCEEDED')

    const runs = await client.command('run.list', { projectId: workspace.project.id })
    expect(runs).toHaveLength(1)
    expect(runs[0]?.id).toBe(dispatch.runId)
    expect(runs[0]?.status).toBe('FINISHED')

    const detail = await client.command('run.get', { runId: dispatch.runId })
    expect(detail.run.outcome).toBe('SUCCEEDED')
    expect(detail.events.map((event) => event.kind)).toEqual(['DISPATCHED', 'FINISHED'])
    expect(detail.executionRequests[0]?.executionRequestId).toBe('exec-1')
    expect(detail.artifacts[0]?.kind).toBe('PATCH')
  })

  it('uses authoritative entity-shaped state rather than a core-flow fixture', async () => {
    const state = createFakeWorkspaceState()

    expect(state.nodes[0]).toHaveProperty('projectId', state.project.id)
    expect(state.edges[0]).toHaveProperty('sourceNodeId')
    expect(state.taskSpecs[0]?.spec).toHaveProperty('taskId')
    expect(state.baselines[0]?.baseline).toHaveProperty('repositoryRevisionId')
    expect(state.activeBaseline?.id).toBe(state.baselines[0]?.baseline.id)
  })
})
