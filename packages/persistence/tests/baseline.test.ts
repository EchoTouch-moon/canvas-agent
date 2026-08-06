import { describe, expect, it } from 'vitest'
import { DomainInvariantError } from '@canvas-agent/domain'
import {
  activateBaseline,
  createBaselineDraft,
  createNode,
  createProject,
  getActiveBaseline,
  listBaselineItems,
  publishNodeVersion,
  type Persistence
} from '../src'
import { createTestPersistence } from './helpers'

function seed(): { p: Persistence; projectId: string; nodeVersionId: string } {
  const p = createTestPersistence()
  createProject(p, { id: 'proj_1', name: 'Project A' })
  createNode(p, { id: 'node_1', projectId: 'proj_1', type: 'GOAL' })
  const version = publishNodeVersion(p, { id: 'nv_1', nodeId: 'node_1', title: 'Goal', body: 'ship v0.1' })
  return { p, projectId: 'proj_1', nodeVersionId: version.id }
}

describe('project baseline commands', () => {
  it('creates a draft baseline with items in order', () => {
    const { p, projectId, nodeVersionId } = seed()
    const draft = createBaselineDraft(p, {
      id: 'baseline_1',
      projectId,
      name: 'v0.1',
      nodeVersionIds: [nodeVersionId]
    })
    expect(draft.status).toBe('DRAFT')

    const items = listBaselineItems(p, draft.id)
    expect(items).toHaveLength(1)
    expect(items[0]?.nodeVersionId).toBe(nodeVersionId)
    expect(items[0]?.position).toBe(0)
  })

  it('atomically activates a draft while superseding the previous active baseline', () => {
    const { p, projectId, nodeVersionId } = seed()
    createBaselineDraft(p, { id: 'baseline_1', projectId, name: 'v0.1', nodeVersionIds: [nodeVersionId] })
    const first = activateBaseline(p, { baselineId: 'baseline_1' }).activated
    expect(first.status).toBe('ACTIVE')
    expect(getActiveBaseline(p, projectId)?.id).toBe('baseline_1')

    createBaselineDraft(p, { id: 'baseline_2', projectId, name: 'v0.2', nodeVersionIds: [nodeVersionId] })
    const result = activateBaseline(p, { baselineId: 'baseline_2' })
    expect(result.superseded?.id).toBe('baseline_1')
    expect(result.superseded?.status).toBe('SUPERSEDED')
    expect(result.superseded?.supersededAt).not.toBeNull()

    const activeCount = p.db
      .prepare("SELECT count(*) AS c FROM project_baseline WHERE project_id = ? AND status = 'ACTIVE'")
      .get(projectId) as { c: number }
    expect(activeCount.c).toBe(1)
  })

  it('rejects activating anything other than a DRAFT baseline', () => {
    const { p, projectId, nodeVersionId } = seed()
    createBaselineDraft(p, { id: 'baseline_1', projectId, name: 'v0.1', nodeVersionIds: [nodeVersionId] })
    activateBaseline(p, { baselineId: 'baseline_1' })
    expect(() => activateBaseline(p, { baselineId: 'baseline_1' })).toThrow(DomainInvariantError)
  })
})
