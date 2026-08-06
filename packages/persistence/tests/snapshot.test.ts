import { describe, expect, it } from 'vitest'
import {
  ValidationError,
  activateBaseline,
  createBaselineDraft,
  createNode,
  createProject,
  createTask,
  freezeContextSnapshot,
  getSnapshot,
  listSnapshotItems,
  publishNodeVersion,
  publishTaskSpecVersion,
  upsertRepositoryRevision,
  type Persistence
} from '../src'
import { createTestPersistence, sha256 } from './helpers'

function seed(): Persistence {
  const p = createTestPersistence()
  createProject(p, { id: 'proj_1', name: 'Project A' })
  createNode(p, { id: 'node_1', projectId: 'proj_1', type: 'REQUIREMENT' })
  createNode(p, { id: 'node_2', projectId: 'proj_1', type: 'COMPONENT' })
  const nv1 = publishNodeVersion(p, { id: 'nv_1', nodeId: 'node_1', title: 'Req', body: 'must ship' })
  const nv2 = publishNodeVersion(p, { id: 'nv_2', nodeId: 'node_2', title: 'Component', body: 'module x' })

  createBaselineDraft(p, {
    id: 'baseline_1',
    projectId: 'proj_1',
    name: 'v0.1',
    nodeVersionIds: [nv1.id, nv2.id]
  })
  activateBaseline(p, { baselineId: 'baseline_1' })

  upsertRepositoryRevision(p, {
    id: 'rev_1',
    baseCommit: 'a'.repeat(40),
    treeHash: 'b'.repeat(40),
    workingTreePatchHash: null
  })

  createTask(p, { id: 'task_1', projectId: 'proj_1', type: 'IMPLEMENT_CHANGE', title: 'Ship' })
  publishTaskSpecVersion(p, {
    id: 'spec_1',
    taskId: 'task_1',
    description: 'Ship foundation',
    scope: 'packages',
    criteria: [{ description: 'green', verificationMethod: 'AUTOMATED_TEST', position: 0 }]
  })

  return p
}

function freezeSample(p: Persistence) {
  return freezeContextSnapshot(p, {
    id: 'snap_1',
    projectId: 'proj_1',
    taskId: 'task_1',
    taskSpecVersionId: 'spec_1',
    baseBaselineId: 'baseline_1',
    expectedRepositoryRevisionId: 'rev_1',
    items: [
      {
        itemType: 'NODE_VERSION',
        sourceRef: 'node://nv_1',
        resolvedContent: 'Req: must ship',
        selectionReason: 'task target',
        authority: 'TASK_INSTRUCTION',
        priority: 'P0',
        tokenEstimate: 120,
        position: 0
      },
      {
        itemType: 'REPOSITORY_CONTENT',
        sourceRef: 'file://packages/persistence/README.md',
        resolvedContent: '# persistence',
        authority: 'PROJECT_FACT',
        priority: 'P1',
        tokenEstimate: 40,
        position: 1
      }
    ]
  })
}

describe('context snapshot freeze', () => {
  it('freezes atomically and pins the task spec, baseline and repository revision', () => {
    const p = seed()
    const { snapshot, items } = freezeSample(p)

    expect(snapshot.status).toBe('FROZEN')
    expect(snapshot.freshness).toBe('CURRENT')
    expect(getSnapshot(p, 'snap_1').taskSpecVersionId).toBe('spec_1')
    expect(getSnapshot(p, 'snap_1').baseBaselineId).toBe('baseline_1')
    expect(getSnapshot(p, 'snap_1').expectedRepositoryRevisionId).toBe('rev_1')
    expect(items).toHaveLength(2)
  })

  it('stores item order, content hashes and token estimates unchanged', () => {
    const p = seed()
    freezeSample(p)
    const items = listSnapshotItems(p, 'snap_1')

    expect(items.map((item) => item.position)).toEqual([0, 1])
    expect(items[0]?.contentHash).toBe(sha256('Req: must ship'))
    expect(items[1]?.contentHash).toBe(sha256('# persistence'))
    expect(items[0]?.tokenEstimate).toBe(120)
    expect(items[1]?.tokenEstimate).toBe(40)
    expect(items[0]?.priority).toBe('P0')
    expect(items[0]?.authority).toBe('TASK_INSTRUCTION')
  })

  it('rejects a freeze that pins a non-active baseline', () => {
    const p = seed()
    createBaselineDraft(p, { id: 'baseline_draft', projectId: 'proj_1', name: 'draft', nodeVersionIds: ['nv_1'] })
    expect(() =>
      freezeContextSnapshot(p, {
        id: 'snap_bad',
        projectId: 'proj_1',
        taskId: 'task_1',
        taskSpecVersionId: 'spec_1',
        baseBaselineId: 'baseline_draft',
        expectedRepositoryRevisionId: 'rev_1',
        items: []
      })
    ).toThrow(ValidationError)
  })

  it('rejects a freeze whose spec belongs to a different task', () => {
    const p = seed()
    createTask(p, { id: 'task_2', projectId: 'proj_1', type: 'IMPLEMENT_CHANGE', title: 'Other' })
    expect(() =>
      freezeContextSnapshot(p, {
        id: 'snap_bad',
        projectId: 'proj_1',
        taskId: 'task_2',
        taskSpecVersionId: 'spec_1',
        baseBaselineId: 'baseline_1',
        expectedRepositoryRevisionId: 'rev_1',
        items: []
      })
    ).toThrow(ValidationError)
  })

  it('locks the frozen snapshot and its items against modification', () => {
    const p = seed()
    freezeSample(p)

    expect(() => p.db.exec("UPDATE context_snapshot SET freshness = 'STALE' WHERE id = 'snap_1'")).toThrow()
    expect(() =>
      p.db.exec("INSERT INTO context_snapshot_item (id, context_snapshot_id, position, item_type, source_ref, resolved_content, content_hash, authority, priority, token_estimate) VALUES ('item_x','snap_1',9,'EDGE','x','y','z','REFERENCE','P2',1)")
    ).toThrow()
    expect(() => p.db.exec("DELETE FROM context_snapshot WHERE id = 'snap_1'")).toThrow()
  })
})
