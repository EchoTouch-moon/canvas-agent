import { describe, expect, it } from 'vitest'
import {
  createProject,
  getProject,
  listAuditForEntity,
  upsertRepositoryRevision,
  requireRepositoryRevision
} from '../src'
import { NotFoundError } from '../src'
import { createTestPersistence } from './helpers'

describe('project and repository revision commands', () => {
  it('creates a project and records a PROJECT_CREATED audit entry', () => {
    const p = createTestPersistence()
    const project = createProject(p, { id: 'proj_1', name: 'Canvas Agent', description: 'MVP' })

    expect(project.name).toBe('Canvas Agent')
    expect(getProject(p, 'proj_1')?.description).toBe('MVP')

    const audit = listAuditForEntity(p, 'Project', 'proj_1')
    expect(audit).toHaveLength(1)
    expect(audit[0]?.action).toBe('PROJECT_CREATED')
  })

  it('deduplicates a repository revision by its content triple', () => {
    const p = createTestPersistence()
    const first = upsertRepositoryRevision(p, {
      id: 'rev_1',
      baseCommit: 'a'.repeat(40),
      treeHash: 'b'.repeat(40),
      workingTreePatchHash: null
    })
    const second = upsertRepositoryRevision(p, {
      id: 'rev_2',
      baseCommit: 'a'.repeat(40),
      treeHash: 'b'.repeat(40),
      workingTreePatchHash: null
    })

    expect(second.id).toBe(first.id)
    expect(requireRepositoryRevision(p, first.id).baseCommit).toBe('a'.repeat(40))
  })

  it('throws NotFoundError for a missing repository revision', () => {
    const p = createTestPersistence()
    expect(() => requireRepositoryRevision(p, 'rev_missing')).toThrow(NotFoundError)
  })
})
