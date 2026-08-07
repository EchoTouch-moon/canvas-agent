import { asc, eq } from 'drizzle-orm'
import type { Persistence } from '../db'
import { projectTable } from '../schema'
import type { ProjectRow } from '../schema'
import { appendAudit } from './audit'

export interface CreateProjectInput {
  id: string
  name: string
  description?: string | null
}

export function createProject(p: Persistence, input: CreateProjectInput): ProjectRow {
  const now = p.services.now()
  const created = p.drizzle
    .insert(projectTable)
    .values({
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .all()[0]

  if (created === undefined) {
    throw new Error(`project insert returned no row for ${input.id}`)
  }

  appendAudit(p, {
    projectId: input.id,
    entityType: 'Project',
    entityId: input.id,
    action: 'PROJECT_CREATED',
    payload: { name: input.name }
  })

  return created
}

export function getProject(p: Persistence, id: string): ProjectRow | undefined {
  return p.drizzle.select().from(projectTable).where(eq(projectTable.id, id)).get()
}

export function listProjects(p: Persistence): ProjectRow[] {
  return p.drizzle
    .select()
    .from(projectTable)
    .orderBy(asc(projectTable.createdAt), asc(projectTable.id))
    .all()
}
