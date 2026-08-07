import { describe, expect, it } from 'vitest'
import {
  activateBaseline,
  applyMigrations,
  closeDatabase,
  createBaselineDraft,
  createEdge,
  createNode,
  createProject,
  createTask,
  getActiveBaseline,
  listBaselineItems,
  listBaselines,
  listCriteria,
  listEdges,
  listNodeDrafts,
  listNodes,
  listNodeVersions,
  listProjects,
  listTaskSpecVersions,
  listTasks,
  listTaskTargets,
  openDatabase,
  publishNodeVersion,
  publishTaskSpecVersion,
  upsertNodeDraft,
  type Persistence
} from '../src'
import { createTestPersistence } from './helpers'

function seedTwoProjects(): Persistence {
  const p = createTestPersistence()
  createProject(p, { id: 'proj_a', name: 'A' })
  createProject(p, { id: 'proj_b', name: 'B' })

  createNode(p, { id: 'node_a', projectId: 'proj_a', type: 'REQUIREMENT' })
  createNode(p, { id: 'node_b', projectId: 'proj_a', type: 'DESIGN' })
  createNode(p, { id: 'node_foreign', projectId: 'proj_b', type: 'GOAL' })

  upsertNodeDraft(p, { nodeId: 'node_a', title: 'Draft A' })
  upsertNodeDraft(p, { nodeId: 'node_b', title: 'Draft B' })
  upsertNodeDraft(p, { nodeId: 'node_foreign', title: 'Draft Foreign' })

  const nvA = publishNodeVersion(p, { id: 'nv_a1', nodeId: 'node_a', title: 'Req', body: 'x' })
  const nvB = publishNodeVersion(p, { id: 'nv_b1', nodeId: 'node_b', title: 'Design', body: 'y' })
  publishNodeVersion(p, { id: 'nv_foreign', nodeId: 'node_foreign', title: 'Goal', body: 'z' })

  createEdge(p, {
    id: 'edge_a',
    projectId: 'proj_a',
    sourceNodeId: 'node_a',
    targetNodeId: 'node_b',
    type: 'DEPENDS_ON'
  })

  createTask(p, { id: 'task_a', projectId: 'proj_a', type: 'IMPLEMENT_CHANGE', title: 'T' })
  publishTaskSpecVersion(p, {
    id: 'spec_a1',
    taskId: 'task_a',
    description: 'd',
    scope: 's',
    targets: [{ nodeId: 'node_a', position: 0 }],
    criteria: [
      { description: 'c0', position: 0 },
      { description: 'c1', position: 1 }
    ]
  })
  publishTaskSpecVersion(p, {
    id: 'spec_a2',
    taskId: 'task_a',
    description: 'd2',
    scope: 's',
    criteria: [{ description: 'c', position: 0 }]
  })

  createBaselineDraft(p, {
    id: 'baseline_a',
    projectId: 'proj_a',
    name: '0.1',
    nodeVersionIds: [nvA.id, nvB.id]
  })
  activateBaseline(p, { baselineId: 'baseline_a' })

  return p
}

describe('project-scoped read helpers', () => {
  it('lists projects deterministically', () => {
    const p = seedTwoProjects()
    const projects = listProjects(p)
    expect(projects.map((project) => project.id)).toEqual(['proj_a', 'proj_b'])
    closeDatabase(p)
  })

  it('scopes every read to the requested project', () => {
    const p = seedTwoProjects()

    expect(listNodes(p, 'proj_a').map((node) => node.id)).toEqual(['node_a', 'node_b'])
    expect(listNodes(p, 'proj_b').map((node) => node.id)).toEqual(['node_foreign'])

    expect(listNodeDrafts(p, 'proj_a').map((draft) => draft.nodeId)).toEqual(['node_a', 'node_b'])
    expect(listNodeDrafts(p, 'proj_b').map((draft) => draft.nodeId)).toEqual(['node_foreign'])

    expect(listNodeVersions(p, 'proj_a').map((version) => version.id)).toEqual(['nv_a1', 'nv_b1'])
    expect(listNodeVersions(p, 'proj_b').map((version) => version.id)).toEqual(['nv_foreign'])

    expect(listEdges(p, 'proj_a').map((edge) => edge.id)).toEqual(['edge_a'])
    expect(listEdges(p, 'proj_b')).toEqual([])

    expect(listTasks(p, 'proj_a').map((task) => task.id)).toEqual(['task_a'])
    closeDatabase(p)
  })

  it('orders spec versions, targets, criteria and baseline items', () => {
    const p = seedTwoProjects()

    expect(listTaskSpecVersions(p, 'task_a').map((spec) => spec.sequence)).toEqual([1, 2])
    expect(listTaskTargets(p, 'spec_a1').map((target) => target.nodeId)).toEqual(['node_a'])
    expect(listCriteria(p, 'spec_a1').map((criterion) => criterion.description)).toEqual([
      'c0',
      'c1'
    ])

    expect(listBaselines(p, 'proj_a').map((baseline) => baseline.id)).toEqual(['baseline_a'])
    expect(listBaselineItems(p, 'baseline_a').map((item) => item.nodeVersionId)).toEqual([
      'nv_a1',
      'nv_b1'
    ])
    expect(getActiveBaseline(p, 'proj_a')?.id).toBe('baseline_a')
    expect(getActiveBaseline(p, 'proj_b')).toBeUndefined()
    closeDatabase(p)
  })

  it('returns empty arrays for projects with no rows', () => {
    const p = createTestPersistence()
    createProject(p, { id: 'proj_empty', name: 'Empty' })

    expect(listNodes(p, 'proj_empty')).toEqual([])
    expect(listNodeDrafts(p, 'proj_empty')).toEqual([])
    expect(listNodeVersions(p, 'proj_empty')).toEqual([])
    expect(listEdges(p, 'proj_empty')).toEqual([])
    expect(listTasks(p, 'proj_empty')).toEqual([])
    expect(listBaselines(p, 'proj_empty')).toEqual([])
    closeDatabase(p)
  })
})
