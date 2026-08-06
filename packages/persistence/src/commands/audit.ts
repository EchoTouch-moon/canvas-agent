import { and, eq } from 'drizzle-orm'
import type { Persistence } from '../db'
import { PersistenceError } from '../errors'
import { auditLogTable } from '../schema'
import type { AuditLogRow } from '../schema'

export interface AuditEntryInput {
  projectId?: string | null
  entityType: string
  entityId: string
  action: string
  payload: Record<string, unknown>
}

export function appendAudit(p: Persistence, input: AuditEntryInput): AuditLogRow {
  const inserted = p.drizzle
    .insert(auditLogTable)
    .values({
      projectId: input.projectId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      payload: JSON.stringify(input.payload),
      createdAt: p.services.now()
    })
    .returning()
    .all()[0]

  if (inserted === undefined) {
    throw new PersistenceError(`audit_log insert returned no row for ${input.entityId}`)
  }
  return inserted
}

export function listAuditForEntity(p: Persistence, entityType: string, entityId: string): AuditLogRow[] {
  return p.drizzle
    .select()
    .from(auditLogTable)
    .where(and(eq(auditLogTable.entityType, entityType), eq(auditLogTable.entityId, entityId)))
    .orderBy(auditLogTable.id)
    .all()
}
