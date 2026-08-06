import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import type {
  ContextAuthority,
  ContextItemType,
  ContextPriority,
  SnapshotFreshness,
  SnapshotStatus
} from '@canvas-agent/domain'
import { projectBaselineTable } from './baseline'
import { projectTable } from './project'
import { repositoryRevisionTable } from './project'
import { taskSpecVersionTable, taskTable } from './task'

export const contentBlobTable = sqliteTable('content_blob', {
  id: text('id').primaryKey(),
  sizeBytes: integer('size_bytes').notNull(),
  contentType: text('content_type').notNull(),
  createdAt: text('created_at').notNull()
})

export const contextSnapshotTable = sqliteTable('context_snapshot', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projectTable.id),
  taskId: text('task_id')
    .notNull()
    .references(() => taskTable.id),
  taskSpecVersionId: text('task_spec_version_id')
    .notNull()
    .references(() => taskSpecVersionTable.id),
  baseBaselineId: text('base_baseline_id')
    .notNull()
    .references(() => projectBaselineTable.id),
  expectedRepositoryRevisionId: text('expected_repository_revision_id')
    .notNull()
    .references(() => repositoryRevisionTable.id),
  status: text('status').$type<SnapshotStatus>().notNull().default('DRAFT'),
  freshness: text('freshness').$type<SnapshotFreshness>().notNull().default('CURRENT'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const contextSnapshotItemTable = sqliteTable(
  'context_snapshot_item',
  {
    id: text('id').primaryKey(),
    contextSnapshotId: text('context_snapshot_id')
      .notNull()
      .references(() => contextSnapshotTable.id),
    position: integer('position').notNull(),
    itemType: text('item_type').$type<ContextItemType>().notNull(),
    sourceRef: text('source_ref').notNull(),
    resolvedContent: text('resolved_content').notNull(),
    contentHash: text('content_hash').notNull(),
    selectionReason: text('selection_reason'),
    authority: text('authority').$type<ContextAuthority>().notNull(),
    priority: text('priority').$type<ContextPriority>().notNull().default('P2'),
    tokenEstimate: integer('token_estimate').notNull(),
    blobId: text('blob_id').references(() => contentBlobTable.id)
  },
  (t) => [unique('context_snapshot_item_position').on(t.contextSnapshotId, t.position)]
)

export type ContentBlobRow = typeof contentBlobTable.$inferSelect
export type ContextSnapshotRow = typeof contextSnapshotTable.$inferSelect
export type ContextSnapshotItemRow = typeof contextSnapshotItemTable.$inferSelect
