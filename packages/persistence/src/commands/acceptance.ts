import { desc, eq } from 'drizzle-orm'
import type { Persistence } from '../db'
import { withTransaction } from '../db'
import { NotFoundError, ValidationError } from '../errors'
import {
  acceptanceEvaluationItemTable,
  acceptanceEvaluationTable,
  type AcceptanceEvaluationItemRow,
  type AcceptanceEvaluationRow,
  type CriterionVerdict,
  type TaskRow
} from '../schema'
import {
  listCriteria,
  listTaskSpecVersions,
  requireTask,
  requireTaskSpecVersion,
  transitionTask
} from './task'
import { requireRun } from './run'
import { appendAudit } from './audit'

export interface AcceptanceCriterionVerdictInput {
  criterionId: string
  verdict: CriterionVerdict
  note?: string | null
}

export interface CreateAcceptanceEvaluationInput {
  projectId: string
  taskId: string
  taskSpecVersionId: string
  runId: string
  criteria: readonly AcceptanceCriterionVerdictInput[]
}

export interface AcceptanceEvaluationAggregate {
  evaluation: AcceptanceEvaluationRow
  items: AcceptanceEvaluationItemRow[]
}

const USABLE_RUN_OUTCOMES = new Set(['SUCCEEDED', 'PARTIAL', 'TIMED_OUT'])

function requireEvaluation(p: Persistence, evaluationId: string): AcceptanceEvaluationRow {
  const row = p.drizzle
    .select()
    .from(acceptanceEvaluationTable)
    .where(eq(acceptanceEvaluationTable.id, evaluationId))
    .get()
  if (row === undefined) {
    throw new NotFoundError('AcceptanceEvaluation', evaluationId)
  }
  return row
}

function latestEvaluationForTask(p: Persistence, taskId: string): AcceptanceEvaluationRow | undefined {
  return p.drizzle
    .select()
    .from(acceptanceEvaluationTable)
    .where(eq(acceptanceEvaluationTable.taskId, taskId))
    .orderBy(desc(acceptanceEvaluationTable.sequence))
    .limit(1)
    .get()
}

function latestTaskSpecVersionForTask(p: Persistence, taskId: string): { id: string } | undefined {
  const versions = listTaskSpecVersions(p, taskId)
  return versions[versions.length - 1]
}

// A durable, immutable user judgment. Re-evaluation appends a new sequence row;
// history is never overwritten. The evaluation + items + the task transition to
// WAITING_REVIEW commit in one transaction.
export function createAcceptanceEvaluation(
  p: Persistence,
  input: CreateAcceptanceEvaluationInput
): AcceptanceEvaluationAggregate {
  return withTransaction(p, () => {
    const task = requireTask(p, input.taskId)
    if (task.projectId !== input.projectId) {
      throw new ValidationError(`Task ${task.id} does not belong to Project ${input.projectId}`)
    }
    const spec = requireTaskSpecVersion(p, input.taskSpecVersionId)
    if (spec.taskId !== input.taskId) {
      throw new ValidationError(
        `TaskSpecVersion ${spec.id} does not belong to Task ${input.taskId}`
      )
    }
    const run = requireRun(p, input.runId)
    if (run.taskId !== input.taskId) {
      throw new ValidationError(`Run ${run.id} does not belong to Task ${input.taskId}`)
    }
    if (run.taskSpecVersionId !== input.taskSpecVersionId) {
      throw new ValidationError(
        `Run ${run.id} does not match TaskSpecVersion ${input.taskSpecVersionId}`
      )
    }
    if (run.status !== 'FINISHED') {
      throw new ValidationError(`Run ${run.id} is not FINISHED and cannot be evaluated`)
    }

    const authoritative = listCriteria(p, input.taskSpecVersionId)
    const byId = new Map(authoritative.map((criterion) => [criterion.id, criterion]))
    if (authoritative.length !== input.criteria.length) {
      throw new ValidationError('acceptance criteria must exactly match the TaskSpecVersion')
    }
    const seen = new Set<string>()
    for (const submitted of input.criteria) {
      if (seen.has(submitted.criterionId)) {
        throw new ValidationError(`duplicate acceptance criterion ${submitted.criterionId}`)
      }
      seen.add(submitted.criterionId)
      if (!byId.has(submitted.criterionId)) {
        throw new ValidationError(
          `acceptance criterion ${submitted.criterionId} does not belong to TaskSpecVersion ${input.taskSpecVersionId}`
        )
      }
    }

    const allPassed = input.criteria.every((criterion) => criterion.verdict === 'PASSED')
    const usableOutcome = USABLE_RUN_OUTCOMES.has(run.outcome ?? '')
    const status: 'PASSED' | 'FAILED' = allPassed && usableOutcome ? 'PASSED' : 'FAILED'

    const now = p.services.now()
    const last = p.drizzle
      .select()
      .from(acceptanceEvaluationTable)
      .where(eq(acceptanceEvaluationTable.taskId, input.taskId))
      .orderBy(desc(acceptanceEvaluationTable.sequence))
      .limit(1)
      .get()
    const sequence = (last?.sequence ?? -1) + 1

    const inserted = p.drizzle
      .insert(acceptanceEvaluationTable)
      .values({
        id: p.services.nextId('acceptance_evaluation'),
        projectId: input.projectId,
        taskId: input.taskId,
        taskSpecVersionId: input.taskSpecVersionId,
        runId: input.runId,
        sequence,
        status,
        createdAt: now
      })
      .returning()
      .all()[0]
    if (inserted === undefined) {
      throw new Error('acceptance_evaluation insert returned no row')
    }

    const items: AcceptanceEvaluationItemRow[] = []
    for (const submitted of input.criteria) {
      const criterion = byId.get(submitted.criterionId)
      if (criterion === undefined) {
        throw new ValidationError(`missing authoritative criterion ${submitted.criterionId}`)
      }
      const item = p.drizzle
        .insert(acceptanceEvaluationItemTable)
        .values({
          id: p.services.nextId('acceptance_evaluation_item'),
          evaluationId: inserted.id,
          criterionId: criterion.id,
          verdict: submitted.verdict,
          note: submitted.note ?? null,
          position: criterion.position
        })
        .returning()
        .all()[0]
      if (item === undefined) {
        throw new Error('acceptance_evaluation_item insert returned no row')
      }
      items.push(item)
    }

    // Entering the review state is the same durable fact as the evaluation.
    transitionTask(p, input.taskId, 'WAITING_REVIEW', now)

    appendAudit(p, {
      projectId: input.projectId,
      entityType: 'AcceptanceEvaluation',
      entityId: inserted.id,
      action: 'ACCEPTANCE_EVALUATED',
      payload: {
        taskId: input.taskId,
        taskSpecVersionId: input.taskSpecVersionId,
        runId: input.runId,
        sequence,
        status,
        criterionCount: items.length
      }
    })

    return { evaluation: inserted, items }
  })
}

export function getAcceptanceEvaluationAggregate(
  p: Persistence,
  evaluationId: string
): AcceptanceEvaluationAggregate {
  const evaluation = requireEvaluation(p, evaluationId)
  const items = p.drizzle
    .select()
    .from(acceptanceEvaluationItemTable)
    .where(eq(acceptanceEvaluationItemTable.evaluationId, evaluationId))
    .orderBy(acceptanceEvaluationItemTable.position)
    .all()
  return { evaluation, items }
}

export function listAcceptanceEvaluations(
  p: Persistence,
  taskId: string
): AcceptanceEvaluationAggregate[] {
  const evaluations = p.drizzle
    .select()
    .from(acceptanceEvaluationTable)
    .where(eq(acceptanceEvaluationTable.taskId, taskId))
    .orderBy(acceptanceEvaluationTable.sequence)
    .all()
  return evaluations.map((evaluation) => ({
    evaluation,
    items: p.drizzle
      .select()
      .from(acceptanceEvaluationItemTable)
      .where(eq(acceptanceEvaluationItemTable.evaluationId, evaluation.id))
      .orderBy(acceptanceEvaluationItemTable.position)
      .all()
  }))
}

export interface CompleteTaskInput {
  taskId: string
  evaluationId: string
}

// Completion requires an explicit, latest, PASSED evaluation bound to the latest
// TaskSpecVersion and a FINISHED matching Run. No implicit "latest" guessing.
export function completeTask(p: Persistence, input: CompleteTaskInput): TaskRow {
  return withTransaction(p, () => {
    const evaluation = requireEvaluation(p, input.evaluationId)
    if (evaluation.taskId !== input.taskId) {
      throw new ValidationError(`AcceptanceEvaluation ${evaluation.id} does not belong to Task ${input.taskId}`)
    }
    const latest = latestEvaluationForTask(p, input.taskId)
    if (latest === undefined || latest.id !== evaluation.id) {
      throw new ValidationError('task completion requires the latest acceptance evaluation')
    }
    if (evaluation.status !== 'PASSED') {
      throw new ValidationError('task completion requires a PASSED acceptance evaluation')
    }
    const latestSpec = latestTaskSpecVersionForTask(p, input.taskId)
    if (latestSpec === undefined || latestSpec.id !== evaluation.taskSpecVersionId) {
      throw new ValidationError('acceptance evaluation must reference the latest TaskSpecVersion')
    }
    const run = requireRun(p, evaluation.runId)
    if (run.status !== 'FINISHED') {
      throw new ValidationError('acceptance evaluation must reference a FINISHED Run')
    }
    if (run.taskId !== input.taskId) {
      throw new ValidationError(`Run ${run.id} does not belong to Task ${input.taskId}`)
    }
    if (run.taskSpecVersionId !== evaluation.taskSpecVersionId) {
      throw new ValidationError(
        `Run ${run.id} does not match the evaluated TaskSpecVersion ${evaluation.taskSpecVersionId}`
      )
    }
    return transitionTask(p, input.taskId, 'COMPLETED')
  })
}
