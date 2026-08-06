import { describe, expect, it } from 'vitest'
import {
  applyMigrations,
  openDatabase,
  closeDatabase,
  createProject,
  type Persistence
} from '../src'
import { createTestPersistence } from './helpers'

const EXPECTED_TABLES = [
  'project',
  'repository_revision',
  'node',
  'node_draft',
  'node_version',
  'edge',
  'project_baseline',
  'baseline_item',
  'task',
  'task_draft',
  'task_spec_version',
  'acceptance_criterion',
  'task_target',
  'task_dependency',
  'content_blob',
  'context_snapshot',
  'context_snapshot_item',
  'audit_log'
]

function tableNames(p: Persistence): string[] {
  const rows = p.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'")
    .all() as Array<{ name: string }>
  return rows.map((row) => row.name).sort()
}

describe('database factory', () => {
  it('applies a clean schema with all normalized tables', () => {
    const p = createTestPersistence()
    const names = tableNames(p)
    for (const expected of EXPECTED_TABLES) {
      expect(names).toContain(expected)
    }
    closeDatabase(p)
  })

  it('keeps setup deterministic when migrations are applied twice', () => {
    const p = openDatabase({ path: ':memory:' })
    applyMigrations(p)
    applyMigrations(p)
    const names = tableNames(p)
    for (const expected of EXPECTED_TABLES) {
      expect(names).toContain(expected)
    }
    closeDatabase(p)
  })

  it('enables foreign keys so orphan rows are rejected', () => {
    const p = createTestPersistence()
    expect(() =>
      p.db.exec(
        "INSERT INTO edge (id, project_id, source_node_id, target_node_id, type, status, created_at, updated_at) VALUES ('e1','missing','n1','n2','RELATED_TO','PROPOSED','2026-08-06T00:00:00.000Z','2026-08-06T00:00:00.000Z')"
      )
    ).toThrow()
    closeDatabase(p)
  })

  it('starts from a clean schema on a fresh in-memory database', () => {
    const p1 = createTestPersistence()
    createProject(p1, { id: 'p1', name: 'Seed' })
    closeDatabase(p1)

    const p2 = createTestPersistence()
    const projects = p2.db.prepare('SELECT count(*) AS c FROM project').get() as { c: number }
    expect(projects.c).toBe(0)
    closeDatabase(p2)
  })
})
