import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { BaselineStatus } from '@canvas-agent/domain'
import { nodeVersionTable } from './graph'
import { projectTable, repositoryRevisionTable } from './project'

export const projectBaselineTable = sqliteTable(
  'project_baseline',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectTable.id),
    status: text('status').$type<BaselineStatus>().notNull().default('DRAFT'),
    name: text('name').notNull(),
    description: text('description'),
    repositoryRevisionId: text('repository_revision_id').references(() => repositoryRevisionTable.id),
    activatedAt: text('activated_at'),
    supersededAt: text('superseded_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [
    uniqueIndex('project_baseline_one_active').on(t.projectId).where(sql`${t.status} = 'ACTIVE'`)
  ]
)

export const baselineItemTable = sqliteTable(
  'baseline_item',
  {
    id: text('id').primaryKey(),
    baselineId: text('baseline_id')
      .notNull()
      .references(() => projectBaselineTable.id),
    nodeVersionId: text('node_version_id')
      .notNull()
      .references(() => nodeVersionTable.id),
    position: integer('position').notNull()
  },
  (t) => [
    unique('baseline_item_position').on(t.baselineId, t.position),
    unique('baseline_item_node_version').on(t.baselineId, t.nodeVersionId)
  ]
)

export type ProjectBaselineRow = typeof projectBaselineTable.$inferSelect
export type BaselineItemRow = typeof baselineItemTable.$inferSelect
