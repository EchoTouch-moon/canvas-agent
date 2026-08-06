import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { projectTable } from './project'

export const auditLogTable = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: text('project_id').references(() => projectTable.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  payload: text('payload').notNull(),
  createdAt: text('created_at').notNull()
})

export type AuditLogRow = typeof auditLogTable.$inferSelect
