import { asc, desc, eq } from 'drizzle-orm'
import type { RunOutcome, RunStatus } from '@canvas-agent/domain'
import type { Persistence } from '../db'
import { withTransaction } from '../db'
import { NotFoundError, ValidationError } from '../errors'
import {
  artifactTable,
  executionRequestRecordTable,
  runEventTable,
  runTable,
  type ArtifactRow,
  type DispatchOutcome,
  type ExecutionRequestRecordRow,
  type RunEventKind,
  type RunEventRow,
  type RunRow
} from '../schema'
import { appendAudit } from './audit'

// DispatchResult.outcome -> Run.outcome. VALIDATION_REJECTED / CLAIM_REJECTED /
// REVISION_MISMATCH are legal terminal worker results that FAIL the run; they
// are never INTERRUPTED (INTERRUPTED means the system could not trust/complete
// the result).
export function mapDispatchToRunOutcome(
  dispatchOutcome: DispatchOutcome,
  timedOut: boolean
): RunOutcome {
  switch (dispatchOutcome) {
    case 'SUCCEEDED':
      return 'SUCCEEDED'
    case 'PARTIAL':
      return timedOut ? 'TIMED_OUT' : 'PARTIAL'
    case 'CANCELLED':
      return 'CANCELLED'
    case 'VALIDATION_REJECTED':
    case 'CLAIM_REJECTED':
    case 'REVISION_MISMATCH':
      return 'FAILED'
  }
}

export interface DispatchResultMetadata {
  dispatchOutcome: DispatchOutcome
  claimGranted: boolean
  rejectionReason: string | null
  revisionMismatchField: string | null
  revisionMismatchExpected: string | null
  revisionMismatchActual: string | null
  patchHash: string | null
  timedOut: boolean | null
  recoveryJson: string | null
}

export interface ArtifactInput {
  kind: ArtifactRow['kind']
  fileName: string
  content: string
  contentHash: string
  sizeBytes: number
}

export interface CreateDispatchedRunInput {
  runId: string
  projectId: string
  taskId: string
  taskSpecVersionId: string
  contextSnapshotId: string
  repositoryRevisionId: string
  startedAt: string
  now: string
  request: {
    executionRequestId: string
    workerAttemptNumber: number
    checkpointId: string | null
    requestHash: string
    schemaVersion: number
    requestJson: string
    dispatchedAt: string
  }
}

export interface RunSummaryRow {
  id: string
  projectId: string
  taskId: string
  taskSpecVersionId: string
  contextSnapshotId: string
  repositoryRevisionId: string
  status: RunStatus
  outcome: RunOutcome | null
  startedAt: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RunAggregateView {
  run: RunSummaryRow
  executionRequests: ExecutionRequestRecordRow[]
  events: RunEventRow[]
  artifacts: ArtifactRow[]
}

function toRunSummary(run: RunRow): RunSummaryRow {
  return {
    id: run.id,
    projectId: run.projectId,
    taskId: run.taskId,
    taskSpecVersionId: run.taskSpecVersionId,
    contextSnapshotId: run.contextSnapshotId,
    repositoryRevisionId: run.repositoryRevisionId,
    status: run.status as RunStatus,
    outcome: (run.outcome as RunOutcome | null) ?? null,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  }
}

function nextRunEventSequence(p: Persistence, runId: string): number {
  const last = p.drizzle
    .select()
    .from(runEventTable)
    .where(eq(runEventTable.runId, runId))
    .orderBy(desc(runEventTable.sequence))
    .limit(1)
    .get()
  return (last?.sequence ?? -1) + 1
}

function appendRunEvent(
  p: Persistence,
  input: { runId: string; kind: RunEventKind; detail: string | null; createdAt: string }
): RunEventRow {
  const inserted = p.drizzle
    .insert(runEventTable)
    .values({
      id: p.services.nextId('run_event'),
      runId: input.runId,
      sequence: nextRunEventSequence(p, input.runId),
      kind: input.kind,
      detail: input.detail,
      createdAt: input.createdAt
    })
    .returning()
    .all()[0]
  if (inserted === undefined) {
    throw new Error(`run_event insert returned no row for ${input.runId}`)
  }
  return inserted
}

// Persist Run + ExecutionRequestRecord + DISPATCHED atomically BEFORE the
// worker starts. If this throws, the worker must not be dispatched.
export function createDispatchedRun(p: Persistence, input: CreateDispatchedRunInput): void {
  withTransaction(p, () => {
    p.drizzle
      .insert(runTable)
      .values({
        id: input.runId,
        projectId: input.projectId,
        taskId: input.taskId,
        taskSpecVersionId: input.taskSpecVersionId,
        contextSnapshotId: input.contextSnapshotId,
        repositoryRevisionId: input.repositoryRevisionId,
        status: 'RUNNING',
        outcome: null,
        startedAt: input.startedAt,
        completedAt: null,
        createdAt: input.now,
        updatedAt: input.now
      })
      .run()

    p.drizzle
      .insert(executionRequestRecordTable)
      .values({
        executionRequestId: input.request.executionRequestId,
        runId: input.runId,
        workerAttemptNumber: input.request.workerAttemptNumber,
        checkpointId: input.request.checkpointId,
        requestHash: input.request.requestHash,
        schemaVersion: input.request.schemaVersion,
        requestJson: input.request.requestJson,
        dispatchOutcome: null,
        claimGranted: null,
        rejectionReason: null,
        revisionMismatchField: null,
        revisionMismatchExpected: null,
        revisionMismatchActual: null,
        patchHash: null,
        timedOut: null,
        recoveryJson: null,
        dispatchedAt: input.request.dispatchedAt,
        completedAt: null
      })
      .run()

    appendRunEvent(p, {
      runId: input.runId,
      kind: 'DISPATCHED',
      detail: JSON.stringify({
        executionRequestId: input.request.executionRequestId,
        workerAttemptNumber: input.request.workerAttemptNumber,
        requestHash: input.request.requestHash
      }),
      createdAt: input.now
    })
  })
}

export function listRuns(p: Persistence, projectId: string): RunSummaryRow[] {
  return p.drizzle
    .select()
    .from(runTable)
    .where(eq(runTable.projectId, projectId))
    .orderBy(desc(runTable.createdAt))
    .all()
    .map(toRunSummary)
}

export function getRunAggregate(p: Persistence, runId: string): RunAggregateView {
  const run = p.drizzle.select().from(runTable).where(eq(runTable.id, runId)).get()
  if (run === undefined) {
    throw new NotFoundError('Run', runId)
  }
  const executionRequests = p.drizzle
    .select()
    .from(executionRequestRecordTable)
    .where(eq(executionRequestRecordTable.runId, runId))
    .orderBy(asc(executionRequestRecordTable.dispatchedAt))
    .all()
  const events = p.drizzle
    .select()
    .from(runEventTable)
    .where(eq(runEventTable.runId, runId))
    .orderBy(asc(runEventTable.sequence))
    .all()
  const artifacts = p.drizzle
    .select()
    .from(artifactTable)
    .where(eq(artifactTable.runId, runId))
    .orderBy(asc(artifactTable.executionRequestId), asc(artifactTable.position), asc(artifactTable.id))
    .all()
  return { run: toRunSummary(run), executionRequests, events, artifacts }
}

function finalizeRequestRecord(
  p: Persistence,
  executionRequestId: string,
  metadata: DispatchResultMetadata,
  completedAt: string
): void {
  p.drizzle
    .update(executionRequestRecordTable)
    .set({
      dispatchOutcome: metadata.dispatchOutcome,
      claimGranted: metadata.claimGranted,
      rejectionReason: metadata.rejectionReason,
      revisionMismatchField: metadata.revisionMismatchField,
      revisionMismatchExpected: metadata.revisionMismatchExpected,
      revisionMismatchActual: metadata.revisionMismatchActual,
      patchHash: metadata.patchHash,
      timedOut: metadata.timedOut,
      recoveryJson: metadata.recoveryJson,
      completedAt
    })
    .where(eq(executionRequestRecordTable.executionRequestId, executionRequestId))
    .run()
}

export interface FinalizeRunInput {
  runId: string
  executionRequestId: string
  metadata: DispatchResultMetadata
  completedAt: string
  now: string
  artifacts: readonly ArtifactInput[]
}

// Atomic completion: insert artifacts + finalize the request record + move the
// Run to FINISHED + append FINISHED. Never leaves "Run SUCCEEDED but evidence
// missing".
export function finalizeRun(p: Persistence, input: FinalizeRunInput): void {
  withTransaction(p, () => {
    requireRunningRun(p, input.runId)
    requireRequestForRun(p, input.runId, input.executionRequestId)
    for (const [position, artifact] of input.artifacts.entries()) {
      p.drizzle
        .insert(artifactTable)
        .values({
          id: p.services.nextId('artifact'),
          runId: input.runId,
          executionRequestId: input.executionRequestId,
          kind: artifact.kind,
          fileName: artifact.fileName,
          content: artifact.content,
          contentHash: artifact.contentHash,
          sizeBytes: artifact.sizeBytes,
          position,
          createdAt: input.now
        })
        .run()
    }
    finalizeRequestRecord(p, input.executionRequestId, input.metadata, input.completedAt)
    p.drizzle
      .update(runTable)
      .set({
        status: 'FINISHED',
        outcome: mapDispatchToRunOutcome(input.metadata.dispatchOutcome, input.metadata.timedOut === true),
        completedAt: input.completedAt,
        updatedAt: input.now
      })
      .where(eq(runTable.id, input.runId))
      .run()
    appendRunEvent(p, {
      runId: input.runId,
      kind: 'FINISHED',
      detail: JSON.stringify({
        executionRequestId: input.executionRequestId,
        dispatchOutcome: input.metadata.dispatchOutcome,
        runOutcome: mapDispatchToRunOutcome(input.metadata.dispatchOutcome, input.metadata.timedOut === true)
      }),
      createdAt: input.now
    })
    appendAudit(p, {
      projectId: getRunProjectId(p, input.runId),
      entityType: 'Run',
      entityId: input.runId,
      action: 'RUN_FINISHED',
      payload: {
        executionRequestId: input.executionRequestId,
        dispatchOutcome: input.metadata.dispatchOutcome,
        runOutcome: mapDispatchToRunOutcome(input.metadata.dispatchOutcome, input.metadata.timedOut === true),
        artifactCount: input.artifacts.length
      }
    })
  })
}

export interface InterruptRunInput {
  runId: string
  executionRequestId: string
  reasonCode: string
  now: string
  terminalMetadata: DispatchResultMetadata | null
  terminalCompletedAt: string | null
}

// Two interrupt cases:
// - terminalMetadata null      (worker threw / child crash): request stays
//   incomplete (completedAt null).
// - terminalMetadata present   (worker returned but ingest / durable finalize
//   failed): the terminal DispatchResult evidence is still persisted.
// The Run is INTERRUPTED with outcome null either way.
export function interruptRun(p: Persistence, input: InterruptRunInput): void {
  withTransaction(p, () => {
    requireRunningRun(p, input.runId)
    requireRequestForRun(p, input.runId, input.executionRequestId)
    if (input.terminalMetadata !== null) {
      finalizeRequestRecord(
        p,
        input.executionRequestId,
        input.terminalMetadata,
        input.terminalCompletedAt ?? input.now
      )
    }
    p.drizzle
      .update(runTable)
      .set({ status: 'INTERRUPTED', outcome: null, updatedAt: input.now })
      .where(eq(runTable.id, input.runId))
      .run()
    appendRunEvent(p, {
      runId: input.runId,
      kind: 'INTERRUPTED',
      detail: JSON.stringify({
        executionRequestId: input.executionRequestId,
        reasonCode: input.reasonCode
      }),
      createdAt: input.now
    })
  })
}

function getRunProjectId(p: Persistence, runId: string): string {
  const run = p.drizzle.select().from(runTable).where(eq(runTable.id, runId)).get()
  if (run === undefined) {
    throw new NotFoundError('Run', runId)
  }
  return run.projectId
}

function requireRunningRun(p: Persistence, runId: string): RunRow {
  const run = p.drizzle.select().from(runTable).where(eq(runTable.id, runId)).get()
  if (run === undefined) {
    throw new NotFoundError('Run', runId)
  }
  if (run.status !== 'RUNNING') {
    throw new ValidationError(`Run ${runId} is not RUNNING; cannot transition`)
  }
  return run
}

// The request being finalized/interrupted must belong to this Run: a Run owns
// exactly its own ExecutionRequestRecords (1:N), and crossing that boundary
// would silently corrupt the aggregate.
function requireRequestForRun(
  p: Persistence,
  runId: string,
  executionRequestId: string
): ExecutionRequestRecordRow {
  const request = p.drizzle
    .select()
    .from(executionRequestRecordTable)
    .where(eq(executionRequestRecordTable.executionRequestId, executionRequestId))
    .get()
  if (request === undefined) {
    throw new NotFoundError('ExecutionRequestRecord', executionRequestId)
  }
  if (request.runId !== runId) {
    throw new ValidationError(
      `ExecutionRequest ${executionRequestId} does not belong to Run ${runId}`
    )
  }
  return request
}
