import { describe, expect, it } from 'vitest'
import {
  ConcurrencyError,
  createNode,
  createProject,
  upsertNodeDraft
} from '../src'
import { createTestPersistence } from './helpers'

describe('optimistic concurrency on mutable drafts', () => {
  it('lets one writer commit while the stale writer receives a typed concurrency error', () => {
    const p = createTestPersistence()
    createProject(p, { id: 'proj_1', name: 'A' })
    createNode(p, { id: 'node_1', projectId: 'proj_1', type: 'DESIGN' })

    const draft = upsertNodeDraft(p, { nodeId: 'node_1', title: 'Design', body: 'shared base' })
    const sharedRevision = draft.revision

    const writerA = upsertNodeDraft(p, {
      nodeId: 'node_1',
      title: 'Design A',
      expectedRevision: sharedRevision
    })
    expect(writerA.revision).toBe(sharedRevision + 1)

    expect(() =>
      upsertNodeDraft(p, {
        nodeId: 'node_1',
        title: 'Design B',
        expectedRevision: sharedRevision
      })
    ).toThrow(ConcurrencyError)
  })

  it('does not modify the row when the stale write is rejected', () => {
    const p = createTestPersistence()
    createProject(p, { id: 'proj_1', name: 'A' })
    createNode(p, { id: 'node_1', projectId: 'proj_1', type: 'DESIGN' })
    upsertNodeDraft(p, { nodeId: 'node_1', title: 'v1', body: '' })
    expect(() => upsertNodeDraft(p, { nodeId: 'node_1', title: 'v2', expectedRevision: 0 })).toThrow(
      ConcurrencyError
    )
    const row = p.db.prepare('SELECT title FROM node_draft WHERE node_id = ?').get('node_1') as {
      title: string
    }
    expect(row.title).toBe('v1')
  })
})
