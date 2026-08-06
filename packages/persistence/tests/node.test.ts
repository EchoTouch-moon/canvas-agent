import { describe, expect, it } from 'vitest'
import {
  ConcurrencyError,
  createNode,
  createProject,
  publishNodeVersion,
  upsertNodeDraft,
  requireNodeVersion
} from '../src'
import { canonical, createTestPersistence, sha256 } from './helpers'

function seed() {
  const p = createTestPersistence()
  createProject(p, { id: 'proj_1', name: 'Project A' })
  createNode(p, { id: 'node_1', projectId: 'proj_1', type: 'REQUIREMENT' })
  return p
}

describe('node draft and node version commands', () => {
  it('upserts a mutable draft and increments its revision', () => {
    const p = seed()
    const draft = upsertNodeDraft(p, { nodeId: 'node_1', title: 'Requirement', body: 'v1' })
    expect(draft.revision).toBe(1)

    const updated = upsertNodeDraft(p, {
      nodeId: 'node_1',
      title: 'Requirement (revised)',
      expectedRevision: 1
    })
    expect(updated.revision).toBe(2)
    expect(updated.title).toBe('Requirement (revised)')
  })

  it('rejects a stale writer with a typed concurrency error', () => {
    const p = seed()
    upsertNodeDraft(p, { nodeId: 'node_1', title: 'Requirement', body: 'v1' })

    expect(() =>
      upsertNodeDraft(p, {
        nodeId: 'node_1',
        title: 'Stale edit',
        body: 'from writer B',
        expectedRevision: 0
      })
    ).toThrow(ConcurrencyError)
  })

  it('publishes insert-only node versions with monotonic sequence and content hash', () => {
    const p = seed()
    const v1 = publishNodeVersion(p, { id: 'nv_1', nodeId: 'node_1', title: 'Req v1', body: 'body' })
    const v2 = publishNodeVersion(p, { id: 'nv_2', nodeId: 'node_1', title: 'Req v2', body: 'body' })

    expect(v1.sequence).toBe(1)
    expect(v2.sequence).toBe(2)
    expect(v1.contentHash).toBe(sha256(canonical('Req v1', 'body')))
    expect(requireNodeVersion(p, 'nv_1').title).toBe('Req v1')
  })
})
