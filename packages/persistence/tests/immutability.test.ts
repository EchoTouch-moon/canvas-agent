import { describe, expect, it } from 'vitest'
import {
  createNode,
  createProject,
  createTask,
  publishNodeVersion,
  publishTaskSpecVersion,
  type Persistence
} from '../src'
import { createTestPersistence } from './helpers'

function seedProject(p: Persistence): void {
  createProject(p, { id: 'proj_1', name: 'A' })
  createNode(p, { id: 'node_1', projectId: 'proj_1', type: 'REQUIREMENT' })
}

describe('immutability guarantees', () => {
  it('rejects UPDATE and DELETE on published node versions via database trigger', () => {
    const p = createTestPersistence()
    seedProject(p)
    const version = publishNodeVersion(p, { id: 'nv_1', nodeId: 'node_1', title: 't', body: 'b' })

    expect(() => p.db.exec(`UPDATE node_version SET title = 'hacked' WHERE id = '${version.id}'`)).toThrow()
    expect(() => p.db.exec(`DELETE FROM node_version WHERE id = '${version.id}'`)).toThrow()

    const row = p.db.prepare('SELECT title, content_hash FROM node_version WHERE id = ?').get(version.id) as {
      title: string
      content_hash: string
    }
    expect(row.title).toBe('t')
    expect(row.content_hash).toBe(version.contentHash)
  })

  it('rejects UPDATE and DELETE on published task spec versions', () => {
    const p = createTestPersistence()
    seedProject(p)
    createTask(p, { id: 'task_1', projectId: 'proj_1', type: 'IMPLEMENT_CHANGE', title: 'T' })
    publishTaskSpecVersion(p, {
      id: 'spec_1',
      taskId: 'task_1',
      description: 'd',
      scope: 's',
      criteria: [{ description: 'a', position: 0 }]
    })

    expect(() => p.db.exec("UPDATE task_spec_version SET scope = 'hacked' WHERE id = 'spec_1'")).toThrow()
    expect(() => p.db.exec("DELETE FROM task_spec_version WHERE id = 'spec_1'")).toThrow()
  })

  it('keeps audit_log append-only', () => {
    const p = createTestPersistence()
    seedProject(p)
    expect(() => p.db.exec("UPDATE audit_log SET action = 'FAKE'")).toThrow()
    expect(() => p.db.exec('DELETE FROM audit_log')).toThrow()
  })
})
