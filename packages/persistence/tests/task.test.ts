import { describe, expect, it } from 'vitest'
import {
  ConcurrencyError,
  CycleError,
  ValidationError,
  createNode,
  createProject,
  createTask,
  createTaskDependency,
  listCriteria,
  publishTaskSpecVersion,
  requireTaskSpecVersion,
  upsertTaskDraft,
  type Persistence
} from '../src'
import { createTestPersistence, sha256 } from './helpers'

function seed(): { p: Persistence; projectId: string } {
  const p = createTestPersistence()
  createProject(p, { id: 'proj_1', name: 'Project A' })
  createNode(p, { id: 'node_1', projectId: 'proj_1', type: 'REQUIREMENT' })
  return { p, projectId: 'proj_1' }
}

describe('task draft and task spec commands', () => {
  it('upserts a mutable task draft with optimistic concurrency', () => {
    const { p } = seed()
    createTask(p, { id: 'task_1', projectId: 'proj_1', type: 'IMPLEMENT_CHANGE', title: 'Add persistence' })
    const draft = upsertTaskDraft(p, { taskId: 'task_1', description: 'plan', scope: 'packages/persistence' })
    expect(draft.revision).toBe(1)

    const writerA = upsertTaskDraft(p, { taskId: 'task_1', description: 'from A', expectedRevision: 1 })
    expect(writerA.revision).toBe(2)

    expect(() =>
      upsertTaskDraft(p, { taskId: 'task_1', description: 'from stale B', expectedRevision: 1 })
    ).toThrow(ConcurrencyError)
  })

  it('publishes an immutable task spec version with criteria and targets', () => {
    const { p } = seed()
    createTask(p, { id: 'task_1', projectId: 'proj_1', type: 'IMPLEMENT_CHANGE', title: 'Add persistence' })

    const result = publishTaskSpecVersion(p, {
      id: 'spec_1',
      taskId: 'task_1',
      description: 'Ship SQLite foundation',
      scope: 'packages/persistence',
      targets: [{ nodeId: 'node_1', position: 0 }],
      criteria: [
        { description: 'typecheck passes', verificationMethod: 'AUTOMATED_TEST', position: 0 },
        { description: 'tests are green', verificationMethod: 'AUTOMATED_TEST', position: 1 }
      ]
    })

    expect(result.spec.sequence).toBe(1)
    expect(result.criteria).toHaveLength(2)
    expect(requireTaskSpecVersion(p, 'spec_1').contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(requireTaskSpecVersion(p, 'spec_1').contentHash).not.toBe(sha256('wrong'))
    expect(listCriteria(p, 'spec_1').map((c) => c.description)).toEqual(['typecheck passes', 'tests are green'])
  })

  it('rejects a task spec without acceptance criteria', () => {
    const { p } = seed()
    createTask(p, { id: 'task_1', projectId: 'proj_1', type: 'IMPLEMENT_CHANGE', title: 'Empty' })
    expect(() =>
      publishTaskSpecVersion(p, { id: 'spec_1', taskId: 'task_1', description: 'x', scope: 'y', criteria: [] })
    ).toThrow(ValidationError)
  })

  it('assigns increasing sequences across spec versions', () => {
    const { p } = seed()
    createTask(p, { id: 'task_1', projectId: 'proj_1', type: 'IMPLEMENT_CHANGE', title: 'Iterate' })
    publishTaskSpecVersion(p, {
      id: 'spec_1',
      taskId: 'task_1',
      description: 'v1',
      scope: 'x',
      criteria: [{ description: 'a', position: 0 }]
    })
    const second = publishTaskSpecVersion(p, {
      id: 'spec_2',
      taskId: 'task_1',
      description: 'v2',
      scope: 'x',
      criteria: [{ description: 'a', position: 0 }]
    })
    expect(second.spec.sequence).toBe(2)
  })

  it('rejects any task dependency cycle', () => {
    const { p } = seed()
    createTask(p, { id: 'task_a', projectId: 'proj_1', type: 'BOOTSTRAP_PROJECT', title: 'A' })
    createTask(p, { id: 'task_b', projectId: 'proj_1', type: 'IMPLEMENT_CHANGE', title: 'B' })
    createTaskDependency(p, {
      id: 'dep_1',
      projectId: 'proj_1',
      taskId: 'task_a',
      dependsOnTaskId: 'task_b',
      type: 'HARD_BLOCK'
    })
    expect(() =>
      createTaskDependency(p, {
        id: 'dep_2',
        projectId: 'proj_1',
        taskId: 'task_b',
        dependsOnTaskId: 'task_a',
        type: 'SOFT_ORDER'
      })
    ).toThrow(CycleError)
  })

  it('rejects a task dependency across projects', () => {
    const { p } = seed()
    createProject(p, { id: 'proj_2', name: 'Project B' })
    createTask(p, { id: 'task_1', projectId: 'proj_1', type: 'IMPLEMENT_CHANGE', title: 'In A' })
    createTask(p, { id: 'task_2', projectId: 'proj_2', type: 'IMPLEMENT_CHANGE', title: 'In B' })
    expect(() =>
      createTaskDependency(p, {
        id: 'dep_cross',
        projectId: 'proj_1',
        taskId: 'task_1',
        dependsOnTaskId: 'task_2',
        type: 'HARD_BLOCK'
      })
    ).toThrow(ValidationError)
  })
})
