import { describe, expect, it } from 'vitest'
import { createEdge, createNode, createProject, type Persistence } from '../src'
import { CycleError, SelfEdgeError } from '../src'
import { createTestPersistence } from './helpers'

function seed(): { p: Persistence; projectId: string; nodes: string[] } {
  const p = createTestPersistence()
  createProject(p, { id: 'proj_1', name: 'Graph' })
  for (const [id, type] of [
    ['node_a', 'IDEA'],
    ['node_b', 'IDEA'],
    ['node_c', 'IDEA']
  ] as const) {
    createNode(p, { id, projectId: 'proj_1', type })
  }
  return { p, projectId: 'proj_1', nodes: ['node_a', 'node_b', 'node_c'] }
}

function edgeCount(p: Persistence): number {
  const row = p.db.prepare('SELECT count(*) AS c FROM edge').get() as { c: number }
  return row.c
}

describe('edge lifecycle validation', () => {
  it('rejects a self-link and commits no row', () => {
    const { p } = seed()
    expect(() =>
      createEdge(p, {
        id: 'e1',
        projectId: 'proj_1',
        sourceNodeId: 'node_a',
        targetNodeId: 'node_a',
        type: 'RELATED_TO'
      })
    ).toThrow(SelfEdgeError)
    expect(edgeCount(p)).toBe(0)
  })

  it('rejects a PARENT_OF cycle and commits no row', () => {
    const { p } = seed()
    createEdge(p, { id: 'e1', projectId: 'proj_1', sourceNodeId: 'node_a', targetNodeId: 'node_b', type: 'PARENT_OF' })
    createEdge(p, { id: 'e2', projectId: 'proj_1', sourceNodeId: 'node_b', targetNodeId: 'node_c', type: 'PARENT_OF' })
    expect(() =>
      createEdge(p, { id: 'e3', projectId: 'proj_1', sourceNodeId: 'node_c', targetNodeId: 'node_a', type: 'PARENT_OF' })
    ).toThrow(CycleError)
    expect(edgeCount(p)).toBe(2)
  })

  it('rejects a SUPERSEDES cycle and commits no row', () => {
    const { p } = seed()
    createEdge(p, { id: 'e1', projectId: 'proj_1', sourceNodeId: 'node_a', targetNodeId: 'node_b', type: 'SUPERSEDES' })
    expect(() =>
      createEdge(p, { id: 'e2', projectId: 'proj_1', sourceNodeId: 'node_b', targetNodeId: 'node_a', type: 'SUPERSEDES' })
    ).toThrow(CycleError)
    expect(edgeCount(p)).toBe(1)
  })

  it('stores a DEPENDS_ON cycle with an explicit warning', () => {
    const { p } = seed()
    createEdge(p, { id: 'e1', projectId: 'proj_1', sourceNodeId: 'node_a', targetNodeId: 'node_b', type: 'DEPENDS_ON' })
    const result = createEdge(p, {
      id: 'e2',
      projectId: 'proj_1',
      sourceNodeId: 'node_b',
      targetNodeId: 'node_a',
      type: 'DEPENDS_ON'
    })
    expect(result.warning).toContain('cycle')
    expect(result.edge.status).toBe('PROPOSED')
    expect(edgeCount(p)).toBe(2)
  })

  it('accepts non-cyclic edges and default lifecycle status', () => {
    const { p } = seed()
    const result = createEdge(p, {
      id: 'e1',
      projectId: 'proj_1',
      sourceNodeId: 'node_a',
      targetNodeId: 'node_b',
      type: 'IMPLEMENTS'
    })
    expect(result.warning).toBeUndefined()
    expect(result.edge.status).toBe('PROPOSED')
  })
})
