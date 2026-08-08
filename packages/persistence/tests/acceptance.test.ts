import { describe, expect, it } from 'vitest'
import {
  acceptanceCriterionTable,
  activateBaseline,
  closeDatabase,
  completeTask,
  createAcceptanceEvaluation,
  createBaselineDraft,
  createDispatchedRun,
  createNode,
  createProject,
  createTask,
  finalizeRun,
  freezeContextSnapshot,
  listAcceptanceEvaluations,
  publishNodeVersion,
  publishTaskSpecVersion,
  requireTask,
  taskSpecVersionTable,
  upsertRepositoryRevision,
  ValidationError,
  type Persistence
} from '../src'
import { eq } from 'drizzle-orm'
import { createTestPersistence } from './helpers'

interface Scenario {
  p: Persistence
  projectId: string
  taskId: string
  taskSpecVersionId: string
  criteriaIds: string[]
  runId: string
}

function dispatchRequest(executionRequestId = 'exec-1') {
  return {
    executionRequestId,
    workerAttemptNumber: 1,
    checkpointId: null,
    requestHash: 'c'.repeat(64),
    schemaVersion: 1,
    requestJson: '{}',
    dispatchedAt: '2026-08-08T10:00:01.000Z'
  }
}

function metadata(outcome: 'SUCCEEDED' | 'CANCELLED' | 'PARTIAL') {
  return {
    dispatchOutcome: outcome,
    claimGranted: true,
    rejectionReason: null,
    revisionMismatchField: null,
    revisionMismatchExpected: null,
    revisionMismatchActual: null,
    patchHash: null,
    timedOut: outcome === 'PARTIAL',
    recoveryJson: null
  }
}

function finalize(p: Persistence, runId: string, executionRequestId: string, outcome: 'SUCCEEDED' | 'CANCELLED' | 'PARTIAL'): void {
  finalizeRun(p, {
    runId,
    executionRequestId,
    metadata: metadata(outcome),
    completedAt: '2026-08-08T10:00:05.000Z',
    now: '2026-08-08T10:00:05.000Z',
    artifacts: []
  })
}

function seedScenario(criteria = 2): Scenario {
  const p = createTestPersistence('2026-08-08T10:00:00.000Z')
  const projectId = 'proj_1'
  createProject(p, { id: projectId, name: 'P' })
  const node = createNode(p, { id: 'node_1', projectId, type: 'GOAL' })
  const version = publishNodeVersion(p, { id: 'nv_1', nodeId: node.id, title: 't', body: 'b' })
  const task = createTask(p, { id: 'task_1', projectId, type: 'IMPLEMENT_CHANGE', title: 'T' })
  const spec = publishTaskSpecVersion(p, {
    id: 'spec_1',
    taskId: task.id,
    description: 'd',
    scope: 's',
    criteria: Array.from({ length: criteria }, (_, index) => ({
      description: `c${index}`,
      position: index
    }))
  })
  const baseline = createBaselineDraft(p, {
    id: 'baseline_1',
    projectId,
    name: '0.1',
    nodeVersionIds: [version.id]
  })
  activateBaseline(p, { baselineId: baseline.id })
  upsertRepositoryRevision(p, {
    id: 'rev_1',
    baseCommit: 'a'.repeat(40),
    treeHash: 'b'.repeat(40),
    workingTreePatchHash: null
  })
  freezeContextSnapshot(p, {
    id: 'snap_1',
    projectId,
    taskId: task.id,
    taskSpecVersionId: spec.spec.id,
    baseBaselineId: baseline.id,
    expectedRepositoryRevisionId: 'rev_1',
    items: []
  })
  const runId = 'run_1'
  createDispatchedRun(p, {
    runId,
    projectId,
    taskId: task.id,
    taskSpecVersionId: spec.spec.id,
    contextSnapshotId: 'snap_1',
    repositoryRevisionId: 'rev_1',
    startedAt: '2026-08-08T10:00:01.000Z',
    now: '2026-08-08T10:00:01.000Z',
    request: dispatchRequest()
  })
  finalize(p, runId, 'exec-1', 'SUCCEEDED')
  return {
    p,
    projectId,
    taskId: task.id,
    taskSpecVersionId: spec.spec.id,
    criteriaIds: [],
    runId
  }
}

function specCriteriaIds(p: Persistence, taskSpecVersionId: string): string[] {
  return p.drizzle
    .select({ id: acceptanceCriterionTable.id })
    .from(acceptanceCriterionTable)
    .where(eq(acceptanceCriterionTable.taskSpecVersionId, taskSpecVersionId))
    .all()
    .map((row) => row.id)
}

describe('task lifecycle', () => {
  it('publish transitions DRAFT -> READY', () => {
    const p = createTestPersistence()
    createProject(p, { id: 'proj', name: 'P' })
    const task = createTask(p, { id: 'task', projectId: 'proj', type: 'IMPLEMENT_CHANGE', title: 'T' })
    expect(task.status).toBe('DRAFT')
    publishTaskSpecVersion(p, {
      id: 'spec',
      taskId: 'task',
      description: 'd',
      scope: 's',
      criteria: [{ description: 'c', position: 0 }]
    })
    expect(requireTask(p, 'task').status).toBe('READY')
    closeDatabase(p)
  })

  it('dispatch transitions READY -> IN_PROGRESS and keeps IN_PROGRESS', () => {
    const { p, projectId, taskId, taskSpecVersionId, runId } = seedScenario()
    expect(requireTask(p, taskId).status).toBe('IN_PROGRESS')
    createDispatchedRun(p, {
      runId: 'run_2',
      projectId,
      taskId,
      taskSpecVersionId,
      contextSnapshotId: 'snap_1',
      repositoryRevisionId: 'rev_1',
      startedAt: '2026-08-08T10:00:06.000Z',
      now: '2026-08-08T10:00:06.000Z',
      request: dispatchRequest('exec-2')
    })
    expect(requireTask(p, taskId).status).toBe('IN_PROGRESS')
    closeDatabase(p)
  })

  it('backfills legacy DRAFT tasks that already have a published spec', () => {
    const p = createTestPersistence()
    createProject(p, { id: 'proj', name: 'P' })
    createTask(p, { id: 'task_draft', projectId: 'proj', type: 'IMPLEMENT_CHANGE', title: 'T' })
    p.drizzle
      .insert(taskSpecVersionTable)
      .values({
        id: 'spec_legacy',
        taskId: 'task_draft',
        sequence: 1,
        description: 'd',
        scope: 's',
        contentHash: 'c'.repeat(64),
        createdAt: '2026-08-08T00:00:00.000Z'
      })
      .run()
    p.db.exec(
      "UPDATE task SET status='READY' WHERE status='DRAFT' AND EXISTS (SELECT 1 FROM task_spec_version WHERE task_spec_version.task_id = task.id)"
    )
    expect(requireTask(p, 'task_draft').status).toBe('READY')
    closeDatabase(p)
  })
})

describe('acceptance evaluation', () => {
  it('is append-only: re-evaluation appends a sequence and never overwrites', () => {
    const { p, projectId, taskId, taskSpecVersionId, runId } = seedScenario()
    const criteriaIds = specCriteriaIds(p, taskSpecVersionId)
    const first = createAcceptanceEvaluation(p, {
      projectId,
      taskId,
      taskSpecVersionId,
      runId,
      criteria: criteriaIds.map((id) => ({ criterionId: id, verdict: 'FAILED', note: 'no' }))
    })
    const second = createAcceptanceEvaluation(p, {
      projectId,
      taskId,
      taskSpecVersionId,
      runId,
      criteria: criteriaIds.map((id) => ({ criterionId: id, verdict: 'PASSED' }))
    })
    expect(first.evaluation.sequence).toBe(0)
    expect(second.evaluation.sequence).toBe(1)
    expect(first.evaluation.status).toBe('FAILED')
    expect(second.evaluation.status).toBe('PASSED')

    const history = listAcceptanceEvaluations(p, taskId)
    expect(history).toHaveLength(2)
    expect(history.map((entry) => entry.evaluation.sequence)).toEqual([0, 1])
    expect(history[1]?.items.map((item) => item.verdict)).toEqual(['PASSED', 'PASSED'])
    closeDatabase(p)
  })

  it('evaluate transitions IN_PROGRESS -> WAITING_REVIEW', () => {
    const { p, projectId, taskId, taskSpecVersionId, runId } = seedScenario()
    const criteriaIds = specCriteriaIds(p, taskSpecVersionId)
    createAcceptanceEvaluation(p, {
      projectId,
      taskId,
      taskSpecVersionId,
      runId,
      criteria: criteriaIds.map((id) => ({ criterionId: id, verdict: 'PASSED' }))
    })
    expect(requireTask(p, taskId).status).toBe('WAITING_REVIEW')
    closeDatabase(p)
  })

  it('rejects a criterion set that is not the exact authoritative set', () => {
    const { p, projectId, taskId, taskSpecVersionId, runId } = seedScenario(3)
    const criteriaIds = specCriteriaIds(p, taskSpecVersionId)
    const partial = criteriaIds.slice(0, 2)
    expect(() =>
      createAcceptanceEvaluation(p, {
        projectId,
        taskId,
        taskSpecVersionId,
        runId,
        criteria: partial.map((id) => ({ criterionId: id, verdict: 'PASSED' }))
      })
    ).toThrow(ValidationError)
    expect(() =>
      createAcceptanceEvaluation(p, {
        projectId,
        taskId,
        taskSpecVersionId,
        runId,
        criteria: [
          { criterionId: criteriaIds[0] ?? 'x', verdict: 'PASSED' },
          { criterionId: criteriaIds[0] ?? 'x', verdict: 'PASSED' },
          { criterionId: criteriaIds[1] ?? 'x', verdict: 'PASSED' }
        ]
      })
    ).toThrow(ValidationError)
    closeDatabase(p)
  })

  it('a FAILED / CANCELLED run can be evaluated but never PASSED', () => {
    const { p, projectId, taskId, taskSpecVersionId } = seedScenario()
    // cancel a second run for the same task
    const cancelledRunId = 'run_c'
    createDispatchedRun(p, {
      runId: cancelledRunId,
      projectId,
      taskId,
      taskSpecVersionId,
      contextSnapshotId: 'snap_1',
      repositoryRevisionId: 'rev_1',
      startedAt: '2026-08-08T10:00:06.000Z',
      now: '2026-08-08T10:00:06.000Z',
      request: dispatchRequest('exec-c')
    })
    finalize(p, cancelledRunId, 'exec-c', 'CANCELLED')
    const criteriaIds = specCriteriaIds(p, taskSpecVersionId)
    const evaluation = createAcceptanceEvaluation(p, {
      projectId,
      taskId,
      taskSpecVersionId,
      runId: cancelledRunId,
      criteria: criteriaIds.map((id) => ({ criterionId: id, verdict: 'PASSED' }))
    })
    expect(evaluation.evaluation.status).toBe('FAILED')
    closeDatabase(p)
  })
})

describe('task completion', () => {
  it('completes with an explicit latest PASSED evaluation', () => {
    const { p, taskId, projectId, taskSpecVersionId, runId } = seedScenario()
    const criteriaIds = specCriteriaIds(p, taskSpecVersionId)
    const evaluation = createAcceptanceEvaluation(p, {
      projectId,
      taskId,
      taskSpecVersionId,
      runId,
      criteria: criteriaIds.map((id) => ({ criterionId: id, verdict: 'PASSED' }))
    })
    expect(requireTask(p, taskId).status).toBe('WAITING_REVIEW')
    const completed = completeTask(p, { taskId, evaluationId: evaluation.evaluation.id })
    expect(completed.status).toBe('COMPLETED')
    closeDatabase(p)
  })

  it('rejects an evaluation that is not the latest', () => {
    const { p, taskId, projectId, taskSpecVersionId, runId } = seedScenario()
    const criteriaIds = specCriteriaIds(p, taskSpecVersionId)
    const first = createAcceptanceEvaluation(p, {
      projectId,
      taskId,
      taskSpecVersionId,
      runId,
      criteria: criteriaIds.map((id) => ({ criterionId: id, verdict: 'PASSED' }))
    })
    const second = createAcceptanceEvaluation(p, {
      projectId,
      taskId,
      taskSpecVersionId,
      runId,
      criteria: criteriaIds.map((id) => ({ criterionId: id, verdict: 'FAILED', note: 'regression' }))
    })
    expect(second.evaluation.status).toBe('FAILED')
    expect(() => completeTask(p, { taskId, evaluationId: first.evaluation.id })).toThrow(
      /latest acceptance evaluation/
    )
    expect(() => completeTask(p, { taskId, evaluationId: second.evaluation.id })).toThrow(
      /PASSED acceptance evaluation/
    )
    closeDatabase(p)
  })

  it('rejects a PASSED evaluation that does not reference the latest TaskSpecVersion', () => {
    const { p, taskId, projectId, taskSpecVersionId, runId } = seedScenario()
    const criteriaIds = specCriteriaIds(p, taskSpecVersionId)
    const evaluation = createAcceptanceEvaluation(p, {
      projectId,
      taskId,
      taskSpecVersionId,
      runId,
      criteria: criteriaIds.map((id) => ({ criterionId: id, verdict: 'PASSED' }))
    })
    // publish a new spec v2 -> the old evaluation no longer matches the latest spec
    publishTaskSpecVersion(p, {
      id: 'spec_2',
      taskId,
      description: 'new',
      scope: 's',
      criteria: [{ description: 'newc', position: 0 }]
    })
    expect(() => completeTask(p, { taskId, evaluationId: evaluation.evaluation.id })).toThrow(
      /latest TaskSpecVersion/
    )
    closeDatabase(p)
  })
})
