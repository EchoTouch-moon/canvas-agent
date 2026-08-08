import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { projectTable } from './project'
import { acceptanceEvaluationTable } from './acceptance'
import { taskTable } from './task'
import { artifactTable, runTable } from './run'
import { projectBaselineTable } from './baseline'

export type ApplicationEventKind =
  | 'AUTHORIZED'
  | 'APPLYING'
  | 'APPLIED'
  | 'FAILED'
  | 'INTERRUPTED'

// A durable adoption authorization: "I authorize this accepted PATCH of this
// evaluated task to be applied to the real repository." Immutable binding; the
// lifecycle lives in artifact_application_event. One logical application per
// Task and per PATCH.

export const artifactApplicationTable = sqliteTable(
  'artifact_application',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectTable.id),
    taskId: text('task_id')
      .notNull()
      .references(() => taskTable.id),
    evaluationId: text('evaluation_id')
      .notNull()
      .references(() => acceptanceEvaluationTable.id),
    runId: text('run_id')
      .notNull()
      .references(() => runTable.id),
    executionRequestId: text('execution_request_id').notNull(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifactTable.id),
    baseBaselineId: text('base_baseline_id')
      .notNull()
      .references(() => projectBaselineTable.id),
    baseRepositoryRevisionId: text('base_repository_revision_id')
      .notNull(),
    patchHash: text('patch_hash').notNull(),
    authorizedAt: text('authorized_at').notNull()
  },
  (t) => [
    unique('artifact_application_task').on(t.taskId),
    unique('artifact_application_artifact').on(t.artifactId)
  ]
)

export const artifactApplicationEventTable = sqliteTable(
  'artifact_application_event',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => artifactApplicationTable.id),
    sequence: integer('sequence').notNull(),
    kind: text('kind').notNull(),
    repositoryRevisionId: text('repository_revision_id'),
    reasonCode: text('reason_code'),
    detail: text('detail'),
    createdAt: text('created_at').notNull()
  },
  (t) => [unique('artifact_application_event_sequence').on(t.applicationId, t.sequence)]
)

export const baselineCandidateSourceTable = sqliteTable(
  'baseline_candidate_source',
  {
    baselineId: text('baseline_id')
      .primaryKey()
      .references(() => projectBaselineTable.id),
    parentBaselineId: text('parent_baseline_id')
      .notNull()
      .references(() => projectBaselineTable.id),
    taskId: text('task_id')
      .notNull()
      .references(() => taskTable.id),
    artifactApplicationId: text('artifact_application_id')
      .notNull()
      .references(() => artifactApplicationTable.id)
  },
  (t) => [unique('baseline_candidate_source_application').on(t.artifactApplicationId)]
)

export type ArtifactApplicationRow = typeof artifactApplicationTable.$inferSelect
export type ArtifactApplicationEventRow = typeof artifactApplicationEventTable.$inferSelect
export type BaselineCandidateSourceRow = typeof baselineCandidateSourceTable.$inferSelect
