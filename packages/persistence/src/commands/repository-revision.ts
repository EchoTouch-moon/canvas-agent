import { and, eq, isNull } from 'drizzle-orm'
import type { Persistence } from '../db'
import { NotFoundError } from '../errors'
import { repositoryRevisionTable } from '../schema'
import type { RepositoryRevisionRow } from '../schema'
import { appendAudit } from './audit'

export interface RepositoryRevisionInput {
  id: string
  baseCommit: string
  treeHash: string
  workingTreePatchHash?: string | null
}

export function upsertRepositoryRevision(p: Persistence, input: RepositoryRevisionInput): RepositoryRevisionRow {
  const existing = p.drizzle
    .select()
    .from(repositoryRevisionTable)
    .where(
      and(
        eq(repositoryRevisionTable.baseCommit, input.baseCommit),
        eq(repositoryRevisionTable.treeHash, input.treeHash),
        input.workingTreePatchHash === null || input.workingTreePatchHash === undefined
          ? isNull(repositoryRevisionTable.workingTreePatchHash)
          : eq(repositoryRevisionTable.workingTreePatchHash, input.workingTreePatchHash)
      )
    )
    .get()

  if (existing !== undefined) {
    return existing
  }

  const created = p.drizzle
    .insert(repositoryRevisionTable)
    .values({
      id: input.id,
      baseCommit: input.baseCommit,
      treeHash: input.treeHash,
      workingTreePatchHash: input.workingTreePatchHash ?? null,
      createdAt: p.services.now()
    })
    .returning()
    .all()[0]

  if (created === undefined) {
    throw new Error(`repository_revision insert returned no row for ${input.id}`)
  }

  appendAudit(p, {
    entityType: 'RepositoryRevision',
    entityId: created.id,
    action: 'REPOSITORY_REVISION_UPSERTED',
    payload: {
      baseCommit: created.baseCommit,
      treeHash: created.treeHash,
      workingTreePatchHash: created.workingTreePatchHash
    }
  })

  return created
}

export function requireRepositoryRevision(p: Persistence, id: string): RepositoryRevisionRow {
  const row = p.drizzle
    .select()
    .from(repositoryRevisionTable)
    .where(eq(repositoryRevisionTable.id, id))
    .get()
  if (row === undefined) {
    throw new NotFoundError('RepositoryRevision', id)
  }
  return row
}
