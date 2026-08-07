import { describe, expect, it } from 'vitest'
import {
  ValidationError,
  activateBaseline,
  createBaselineDraft,
  createEdge,
  createNode,
  createProject,
  createTask,
  freezeContextSnapshot,
  publishNodeVersion,
  publishTaskSpecVersion,
  upsertRepositoryRevision,
  type Persistence
} from '../src'
import { createTestPersistence } from './helpers'

function seed(): Persistence {
  const p = createTestPersistence()
  createProject(p, { id: 'proj_a', name: 'A' })
  createProject(p, { id: 'proj_b', name: 'B' })

  createNode(p, { id: 'node_a', projectId: 'proj_a', type: 'GOAL' })
  createNode(p, { id: 'node_a2', projectId: 'proj_a', type: 'DESIGN' })
  createNode(p, { id: 'node_b', projectId: 'proj_b', type: 'GOAL' })
  const nvA = publishNodeVersion(p, { id: 'nv_a', nodeId: 'node_a', title: 'A', body: 'a' })
  publishNodeVersion(p, { id: 'nv_b', nodeId: 'node_b', title: 'B', body: 'b' })

  createTask(p, { id: 'task_a', projectId: 'proj_a', type: 'IMPLEMENT_CHANGE', title: 'TA' })
  createTask(p, { id: 'task_b', projectId: 'proj_b', type: 'IMPLEMENT_CHANGE', title: 'TB' })
  publishTaskSpecVersion(p, {
    id: 'spec_a1',
    taskId: 'task_a',
    description: 'd',
    scope: 's',
    criteria: [{ description: 'c', position: 0 }]
  })

  const baselineA = createBaselineDraft(p, {
    id: 'baseline_a',
    projectId: 'proj_a',
    name: '0.1',
    nodeVersionIds: [nvA.id]
  })
  activateBaseline(p, { baselineId: baselineA.id })

  upsertRepositoryRevision(p, {
    id: 'rev_a',
    baseCommit: 'a'.repeat(40),
    treeHash: 'b'.repeat(40),
    workingTreePatchHash: null
  })

  return p
}

describe('cross-project reference invariants', () => {
  it('rejects an Edge that crosses projects', () => {
    const p = seed()
    expect(() =>
      createEdge(p, {
        id: 'edge_x',
        projectId: 'proj_a',
        sourceNodeId: 'node_a',
        targetNodeId: 'node_b',
        type: 'DEPENDS_ON'
      })
    ).toThrow(ValidationError)
  })

  it('rejects a TaskSpecVersion target that crosses projects', () => {
    const p = seed()
    expect(() =>
      publishTaskSpecVersion(p, {
        id: 'spec_x',
        taskId: 'task_a',
        description: 'd',
        scope: 's',
        targets: [{ nodeId: 'node_b', position: 0 }],
        criteria: [{ description: 'c', position: 0 }]
      })
    ).toThrow(ValidationError)
  })

  it('rejects a Baseline whose NodeVersions cross projects', () => {
    const p = seed()
    expect(() =>
      createBaselineDraft(p, {
        id: 'baseline_x',
        projectId: 'proj_a',
        name: 'x',
        nodeVersionIds: ['nv_b']
      })
    ).toThrow(ValidationError)
  })

  it('rejects a Snapshot whose Task crosses projects', () => {
    const p = seed()
    expect(() =>
      freezeContextSnapshot(p, {
        id: 'snap_x',
        projectId: 'proj_a',
        taskId: 'task_b',
        taskSpecVersionId: 'spec_a1',
        baseBaselineId: 'baseline_a',
        expectedRepositoryRevisionId: 'rev_a',
        items: []
      })
    ).toThrow(ValidationError)
  })

  it('still accepts same-project references', () => {
    const p = seed()
    const edge = createEdge(p, {
      id: 'edge_ok',
      projectId: 'proj_a',
      sourceNodeId: 'node_a',
      targetNodeId: 'node_a2',
      type: 'RELATED_TO'
    })
    expect(edge.edge.status).toBe('PROPOSED')
  })
})
