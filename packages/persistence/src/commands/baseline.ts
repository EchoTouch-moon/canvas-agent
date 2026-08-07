import { and, asc, eq } from 'drizzle-orm'
import { assertBaselineTransition } from '@canvas-agent/domain'
import type { Persistence } from '../db'
import { withTransaction } from '../db'
import { NotFoundError, ValidationError } from '../errors'
import { baselineItemTable, projectBaselineTable, projectTable } from '../schema'
import type { BaselineItemRow, ProjectBaselineRow } from '../schema'
import { appendAudit } from './audit'
import { requireNodeVersion } from './node'

export interface CreateBaselineDraftInput {
  id: string
  projectId: string
  name: string
  description?: string | null
  repositoryRevisionId?: string | null
  nodeVersionIds: string[]
}

export function createBaselineDraft(p: Persistence, input: CreateBaselineDraftInput): ProjectBaselineRow {
  const project = p.drizzle.select().from(projectTable).where(eq(projectTable.id, input.projectId)).get()
  if (project === undefined) {
    throw new NotFoundError('Project', input.projectId)
  }

  for (const nodeVersionId of input.nodeVersionIds) {
    requireNodeVersion(p, nodeVersionId)
  }

  return withTransaction(p, () => {
    const now = p.services.now()
    const created = p.drizzle
      .insert(projectBaselineTable)
      .values({
        id: input.id,
        projectId: input.projectId,
        status: 'DRAFT',
        name: input.name,
        description: input.description ?? null,
        repositoryRevisionId: input.repositoryRevisionId ?? null,
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .all()[0]

    if (created === undefined) {
      throw new Error(`project_baseline insert returned no row for ${input.id}`)
    }

    input.nodeVersionIds.forEach((nodeVersionId, position) => {
      const item = p.drizzle
        .insert(baselineItemTable)
        .values({
          id: p.services.nextId('baseline_item'),
          baselineId: created.id,
          nodeVersionId,
          position
        })
        .returning()
        .all()[0]
      if (item === undefined) {
        throw new Error(`baseline_item insert returned no row for ${created.id}`)
      }
    })

    appendAudit(p, {
      projectId: input.projectId,
      entityType: 'ProjectBaseline',
      entityId: created.id,
      action: 'BASELINE_DRAFT_CREATED',
      payload: { name: input.name, nodeVersionCount: input.nodeVersionIds.length }
    })

    return created
  })
}

export interface ActivateBaselineInput {
  baselineId: string
}

export interface ActivateBaselineResult {
  activated: ProjectBaselineRow
  superseded: ProjectBaselineRow | null
}

export function activateBaseline(p: Persistence, input: ActivateBaselineInput): ActivateBaselineResult {
  const baseline = getBaseline(p, input.baselineId)
  assertBaselineTransition(baseline.status, 'ACTIVE')

  return withTransaction(p, () => {
    const now = p.services.now()
    const activeBaselines = p.drizzle
      .select()
      .from(projectBaselineTable)
      .where(and(eq(projectBaselineTable.projectId, baseline.projectId), eq(projectBaselineTable.status, 'ACTIVE')))
      .all()

    let superseded: ProjectBaselineRow | null = null
    for (const active of activeBaselines) {
      const updated = p.drizzle
        .update(projectBaselineTable)
        .set({ status: 'SUPERSEDED', supersededAt: now, updatedAt: now })
        .where(eq(projectBaselineTable.id, active.id))
        .returning()
        .all()[0]
      if (updated === undefined) {
        throw new Error(`project_baseline supersede returned no row for ${active.id}`)
      }
      appendAudit(p, {
        projectId: baseline.projectId,
        entityType: 'ProjectBaseline',
        entityId: updated.id,
        action: 'BASELINE_SUPERSEDED',
        payload: { supersededAt: now }
      })
      superseded = updated
    }

    const activated = p.drizzle
      .update(projectBaselineTable)
      .set({ status: 'ACTIVE', activatedAt: now, updatedAt: now })
      .where(eq(projectBaselineTable.id, baseline.id))
      .returning()
      .all()[0]

    if (activated === undefined) {
      throw new Error(`project_baseline activation returned no row for ${baseline.id}`)
    }

    appendAudit(p, {
      projectId: baseline.projectId,
      entityType: 'ProjectBaseline',
      entityId: activated.id,
      action: 'BASELINE_ACTIVATED',
      payload: { activatedAt: now }
    })

    return { activated, superseded }
  })
}

export function getBaseline(p: Persistence, id: string): ProjectBaselineRow {
  const row = p.drizzle.select().from(projectBaselineTable).where(eq(projectBaselineTable.id, id)).get()
  if (row === undefined) {
    throw new NotFoundError('ProjectBaseline', id)
  }
  return row
}

export function getActiveBaseline(p: Persistence, projectId: string): ProjectBaselineRow | undefined {
  return p.drizzle
    .select()
    .from(projectBaselineTable)
    .where(and(eq(projectBaselineTable.projectId, projectId), eq(projectBaselineTable.status, 'ACTIVE')))
    .get()
}

export function listBaselines(p: Persistence, projectId: string): ProjectBaselineRow[] {
  return p.drizzle
    .select()
    .from(projectBaselineTable)
    .where(eq(projectBaselineTable.projectId, projectId))
    .orderBy(asc(projectBaselineTable.createdAt), asc(projectBaselineTable.id))
    .all()
}

export function listBaselineItems(p: Persistence, baselineId: string): BaselineItemRow[] {
  return p.drizzle
    .select()
    .from(baselineItemTable)
    .where(eq(baselineItemTable.baselineId, baselineId))
    .orderBy(asc(baselineItemTable.position), asc(baselineItemTable.id))
    .all()
}

export function requireActiveBaseline(p: Persistence, projectId: string): ProjectBaselineRow {
  const active = getActiveBaseline(p, projectId)
  if (active === undefined) {
    throw new ValidationError(`Project ${projectId} has no ACTIVE baseline`)
  }
  return active
}
