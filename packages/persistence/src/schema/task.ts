import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import type { TaskStatus, TaskType } from '@canvas-agent/domain'
import { nodeTable, nodeVersionTable } from './graph'
import { projectTable } from './project'

export const taskTable = sqliteTable('task', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projectTable.id),
  type: text('type').$type<TaskType>().notNull(),
  status: text('status').$type<TaskStatus>().notNull().default('DRAFT'),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const taskDraftTable = sqliteTable('task_draft', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .unique()
    .references(() => taskTable.id),
  description: text('description').notNull().default(''),
  scope: text('scope').notNull().default(''),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull()
})

export const taskSpecVersionTable = sqliteTable(
  'task_spec_version',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => taskTable.id),
    sequence: integer('sequence').notNull(),
    description: text('description').notNull(),
    scope: text('scope').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [unique('task_spec_version_task_sequence').on(t.taskId, t.sequence)]
)

export const VERIFICATION_METHODS = [
  'AUTOMATED_TEST',
  'MANUAL_REVIEW',
  'ARTIFACT_CHECK',
  'STRUCTURED_ASSERTION'
] as const
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number]

export const acceptanceCriterionTable = sqliteTable(
  'acceptance_criterion',
  {
    id: text('id').primaryKey(),
    taskSpecVersionId: text('task_spec_version_id')
      .notNull()
      .references(() => taskSpecVersionTable.id),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    verificationMethod: text('verification_method')
      .$type<VerificationMethod>()
      .notNull()
      .default('MANUAL_REVIEW')
  },
  (t) => [unique('acceptance_criterion_position').on(t.taskSpecVersionId, t.position)]
)

export const taskTargetTable = sqliteTable(
  'task_target',
  {
    id: text('id').primaryKey(),
    taskSpecVersionId: text('task_spec_version_id')
      .notNull()
      .references(() => taskSpecVersionTable.id),
    nodeId: text('node_id').references(() => nodeTable.id),
    nodeVersionId: text('node_version_id').references(() => nodeVersionTable.id),
    position: integer('position').notNull()
  },
  (t) => [
    unique('task_target_position').on(t.taskSpecVersionId, t.position),
    check('task_target_has_reference', sql`(${t.nodeId} IS NOT NULL OR ${t.nodeVersionId} IS NOT NULL)`)
  ]
)

export const taskDependencyTable = sqliteTable(
  'task_dependency',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectTable.id),
    taskId: text('task_id')
      .notNull()
      .references(() => taskTable.id),
    dependsOnTaskId: text('depends_on_task_id')
      .notNull()
      .references(() => taskTable.id),
    type: text('type').$type<'HARD_BLOCK' | 'SOFT_ORDER'>().notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [
    unique('task_dependency_pair').on(t.taskId, t.dependsOnTaskId),
    check('task_dependency_no_self', sql`${t.taskId} <> ${t.dependsOnTaskId}`)
  ]
)

export type TaskRow = typeof taskTable.$inferSelect
export type TaskDraftRow = typeof taskDraftTable.$inferSelect
export type TaskSpecVersionRow = typeof taskSpecVersionTable.$inferSelect
export type AcceptanceCriterionRow = typeof acceptanceCriterionTable.$inferSelect
export type TaskTargetRow = typeof taskTargetTable.$inferSelect
export type TaskDependencyRow = typeof taskDependencyTable.$inferSelect
