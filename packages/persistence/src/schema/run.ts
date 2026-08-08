import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { projectTable, repositoryRevisionTable } from './project'
import { taskSpecVersionTable, taskTable } from './task'
import { contextSnapshotTable } from './context'

// The drizzle-kit version used here does not support `.$type().nullable()`, so
// enum-ish columns are plain text and cast at the command layer.

export type DispatchOutcome =
  | 'VALIDATION_REJECTED'
  | 'CLAIM_REJECTED'
  | 'REVISION_MISMATCH'
  | 'SUCCEEDED'
  | 'PARTIAL'
  | 'CANCELLED'

export type RunEventKind = 'DISPATCHED' | 'FINISHED' | 'INTERRUPTED'

export type ArtifactKind = 'PATCH' | 'TEST_RESULT' | 'AGENT_SUMMARY' | 'AGENT_PARTIAL'

// A Run is a logical execution attempt. It is NOT 1:1 with an ExecutionRequest:
// future resume / approval / worker swap can attach multiple requests to the
// same Run.id. Run holds only stable properties; every dispatch result belongs
// to execution_request_record.

export const runTable = sqliteTable('run', {
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
  contextSnapshotId: text('context_snapshot_id')
    .notNull()
    .references(() => contextSnapshotTable.id),
  repositoryRevisionId: text('repository_revision_id')
    .notNull()
    .references(() => repositoryRevisionTable.id),
  status: text('status').notNull(),
  outcome: text('outcome'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const executionRequestRecordTable = sqliteTable('execution_request_record', {
  executionRequestId: text('execution_request_id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runTable.id),
  workerAttemptNumber: integer('worker_attempt_number').notNull(),
  checkpointId: text('checkpoint_id'),
  requestHash: text('request_hash').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  requestJson: text('request_json').notNull(),
  dispatchOutcome: text('dispatch_outcome'),
  claimGranted: integer('claim_granted', { mode: 'boolean' }),
  rejectionReason: text('rejection_reason'),
  revisionMismatchField: text('revision_mismatch_field'),
  revisionMismatchExpected: text('revision_mismatch_expected'),
  revisionMismatchActual: text('revision_mismatch_actual'),
  patchHash: text('patch_hash'),
  timedOut: integer('timed_out', { mode: 'boolean' }),
  recoveryJson: text('recovery_json'),
  dispatchedAt: text('dispatched_at').notNull(),
  completedAt: text('completed_at')
})

// RunEvent.sequence orders the whole Run timeline (a Run may span several
// ExecutionRequests); artifact positions are per-executionRequest.
export const runEventTable = sqliteTable(
  'run_event',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runTable.id),
    sequence: integer('sequence').notNull(),
    kind: text('kind').notNull(),
    detail: text('detail'),
    createdAt: text('created_at').notNull()
  },
  (t) => [unique('run_event_run_sequence').on(t.runId, t.sequence)]
)

export const artifactTable = sqliteTable(
  'artifact',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runTable.id),
    executionRequestId: text('execution_request_id')
      .notNull()
      .references(() => executionRequestRecordTable.executionRequestId),
    kind: text('kind').notNull(),
    fileName: text('file_name').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    position: integer('position').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [unique('artifact_request_position').on(t.executionRequestId, t.position)]
)

export type RunRow = typeof runTable.$inferSelect
export type ExecutionRequestRecordRow = typeof executionRequestRecordTable.$inferSelect
export type RunEventRow = typeof runEventTable.$inferSelect
export type ArtifactRow = typeof artifactTable.$inferSelect
