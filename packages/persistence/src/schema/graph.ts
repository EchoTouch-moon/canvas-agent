import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import type { EdgeStatus, EdgeType, NodeLifecycle, NodeType } from '@canvas-agent/domain'
import { projectTable } from './project'

export const nodeTable = sqliteTable('node', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projectTable.id),
  type: text('type').$type<NodeType>().notNull(),
  lifecycle: text('lifecycle').$type<NodeLifecycle>().notNull().default('ACTIVE'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const nodeDraftTable = sqliteTable('node_draft', {
  id: text('id').primaryKey(),
  nodeId: text('node_id')
    .notNull()
    .unique()
    .references(() => nodeTable.id),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull()
})

export const nodeVersionTable = sqliteTable(
  'node_version',
  {
    id: text('id').primaryKey(),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodeTable.id),
    sequence: integer('sequence').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [unique('node_version_node_sequence').on(t.nodeId, t.sequence)]
)

export const edgeTable = sqliteTable(
  'edge',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectTable.id),
    sourceNodeId: text('source_node_id')
      .notNull()
      .references(() => nodeTable.id),
    targetNodeId: text('target_node_id')
      .notNull()
      .references(() => nodeTable.id),
    type: text('type').$type<EdgeType>().notNull(),
    status: text('status').$type<EdgeStatus>().notNull().default('PROPOSED'),
    anchoredNodeVersionId: text('anchored_node_version_id').references(() => nodeVersionTable.id),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [check('edge_no_self_link', sql`${t.sourceNodeId} <> ${t.targetNodeId}`)]
)

export type NodeRow = typeof nodeTable.$inferSelect
export type NodeDraftRow = typeof nodeDraftTable.$inferSelect
export type NodeVersionRow = typeof nodeVersionTable.$inferSelect
export type EdgeRow = typeof edgeTable.$inferSelect
