import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { projectTable } from './project'
import { acceptanceCriterionTable, taskSpecVersionTable, taskTable } from './task'
import { runTable } from './run'

export type AcceptanceStatus = 'PASSED' | 'FAILED'
export type CriterionVerdict = 'PASSED' | 'FAILED'

// A durable, immutable user judgment of one TaskSpecVersion's criteria against
// a Run's evidence. Re-evaluation appends a new sequence row; history is never
// overwritten.

export const acceptanceEvaluationTable = sqliteTable(
  'acceptance_evaluation',
  {
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
    runId: text('run_id')
      .notNull()
      .references(() => runTable.id),
    sequence: integer('sequence').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [unique('acceptance_evaluation_task_sequence').on(t.taskId, t.sequence)]
)

export const acceptanceEvaluationItemTable = sqliteTable(
  'acceptance_evaluation_item',
  {
    id: text('id').primaryKey(),
    evaluationId: text('evaluation_id')
      .notNull()
      .references(() => acceptanceEvaluationTable.id),
    criterionId: text('criterion_id')
      .notNull()
      .references(() => acceptanceCriterionTable.id),
    verdict: text('verdict').notNull(),
    note: text('note'),
    position: integer('position').notNull()
  },
  (t) => [
    unique('acceptance_item_evaluation_criterion').on(t.evaluationId, t.criterionId),
    unique('acceptance_item_evaluation_position').on(t.evaluationId, t.position)
  ]
)

export type AcceptanceEvaluationRow = typeof acceptanceEvaluationTable.$inferSelect
export type AcceptanceEvaluationItemRow = typeof acceptanceEvaluationItemTable.$inferSelect
