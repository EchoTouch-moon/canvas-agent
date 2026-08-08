import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  acceptanceCriterionTable,
  activateBaseline,
  artifactTable,
  closeDatabase,
  completeTask,
  createAcceptanceEvaluation,
  createArtifactApplication,
  createBaselineCandidate,
  createBaselineDraft,
  createDispatchedRun,
  createNode,
  createProject,
  createTask,
  finalizeApplicationApplied,
  finalizeRun,
  freezeContextSnapshot,
  interruptApplication,
  listArtifactApplicationAggregates,
  publishNodeVersion,
  publishTaskSpecVersion,
  upsertRepositoryRevision,
  ValidationError,
  type Persistence
} from '../src'
import { createTestPersistence } from './helpers'

interface Scenario {
  p: Persistence
  projectId: string
  taskId: string
  taskSpecVersionId: string
  runId: string
  executionRequestId: string
  evaluationId: string
  artifactId: string
  baseBaselineId: string
  baseRevisionId: string
  criteriaIds: string[]
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

function seed(): Scenario {
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
    criteria: [
      { description: 'c0', position: 0 },
      { description: 'c1', position: 1 }
    ]
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
  const executionRequestId = 'exec-1'
  createDispatchedRun(p, {
    runId,
    projectId,
    taskId: task.id,
    taskSpecVersionId: spec.spec.id,
    contextSnapshotId: 'snap_1',
    repositoryRevisionId: 'rev_1',
    startedAt: '2026-08-08T10:00:01.000Z',
    now: '2026-08-08T10:00:01.000Z',
    request: dispatchRequest(executionRequestId)
  })
  finalizeRun(p, {
    runId,
    executionRequestId,
    metadata: {
      dispatchOutcome: 'SUCCEEDED',
      claimGranted: true,
      rejectionReason: null,
      revisionMismatchField: null,
      revisionMismatchExpected: null,
      revisionMismatchActual: null,
      patchHash: 'd'.repeat(64),
      timedOut: false,
      recoveryJson: null
    },
    completedAt: '2026-08-08T10:00:05.000Z',
    now: '2026-08-08T10:00:05.000Z',
    artifacts: [
      {
        kind: 'PATCH',
        fileName: 'patch.diff',
        content: 'diff --git a/src/foo.ts b/src/foo.ts\n+change\n',
        contentHash: 'e'.repeat(64),
        sizeBytes: 40
      }
    ]
  })

  const criteriaIds = p.drizzle
    .select({ id: acceptanceCriterionTable.id })
    .from(acceptanceCriterionTable)
    .where(eq(acceptanceCriterionTable.taskSpecVersionId, spec.spec.id))
    .all()
    .map((row) => row.id)

  const evaluation = createAcceptanceEvaluation(p, {
    projectId,
    taskId: task.id,
    taskSpecVersionId: spec.spec.id,
    runId,
    criteria: criteriaIds.map((id) => ({ criterionId: id, verdict: 'PASSED' }))
  })
  completeTask(p, { taskId: task.id, evaluationId: evaluation.evaluation.id })

  const artifactRow = p.drizzle
    .select()
    .from(artifactTable)
    .where(eq(artifactTable.runId, runId))
    .all()[0]

  return {
    p,
    projectId,
    taskId: task.id,
    taskSpecVersionId: spec.spec.id,
    runId,
    executionRequestId,
    evaluationId: evaluation.evaluation.id,
    artifactId: artifactRow?.id ?? 'missing',
    baseBaselineId: baseline.id,
    baseRevisionId: 'rev_1',
    criteriaIds
  }
}

function appInput(s: Scenario, id = 'app_1') {
  return {
    id,
    projectId: s.projectId,
    taskId: s.taskId,
    evaluationId: s.evaluationId,
    runId: s.runId,
    executionRequestId: s.executionRequestId,
    artifactId: s.artifactId,
    baseBaselineId: s.baseBaselineId,
    baseRepositoryRevisionId: s.baseRevisionId,
    patchHash: 'e'.repeat(64),
    authorizedAt: '2026-08-08T10:00:06.000Z'
  }
}

describe('artifact application', () => {
  it('creates an immutable binding with an AUTHORIZED event', () => {
    const s = seed()
    const aggregate = createArtifactApplication(s.p, appInput(s))
    expect(aggregate.effectiveStatus).toBe('AUTHORIZED')
    expect(aggregate.events.map((event) => event.kind)).toEqual(['AUTHORIZED'])
    expect(aggregate.repositoryRevision).toBeNull()
    closeDatabase(s.p)
  })

  it('enforces one application per task', () => {
    const s = seed()
    createArtifactApplication(s.p, appInput(s, 'app_1'))
    expect(() =>
      createArtifactApplication(s.p, {
        ...appInput(s, 'app_2'),
        artifactId: 'another-artifact'
      })
    ).toThrow()
    closeDatabase(s.p)
  })

  it('finalizes with the resulting repository revision and an APPLIED event', () => {
    const s = seed()
    createArtifactApplication(s.p, appInput(s))
    const aggregate = finalizeApplicationApplied(s.p, {
      applicationId: 'app_1',
      baseCommit: 'f'.repeat(40),
      treeHash: 'g'.repeat(40),
      workingTreePatchHash: null,
      now: '2026-08-08T10:00:07.000Z'
    })
    expect(aggregate.effectiveStatus).toBe('APPLIED')
    expect(aggregate.events.map((event) => event.kind)).toEqual(['AUTHORIZED', 'APPLIED'])
    expect(aggregate.repositoryRevision?.baseCommit).toBe('f'.repeat(40))
    closeDatabase(s.p)
  })

  it('records FAILED and INTERRUPTED events', () => {
    const s = seed()
    createArtifactApplication(s.p, appInput(s))
    interruptApplication(s.p, {
      applicationId: 'app_1',
      reasonCode: 'recovery_conflict',
      now: '2026-08-08T10:00:08.000Z'
    })
    const aggregate = listArtifactApplicationAggregates(s.p, s.taskId)[0]
    expect(aggregate?.effectiveStatus).toBe('INTERRUPTED')
    expect(aggregate?.events.map((event) => event.kind)).toEqual(['AUTHORIZED', 'INTERRUPTED'])
    closeDatabase(s.p)
  })
})

describe('baseline candidate', () => {
  it('creates one candidate per APPLIED application, copying the parent NodeVersion set', () => {
    const s = seed()
    createArtifactApplication(s.p, appInput(s))
    finalizeApplicationApplied(s.p, {
      applicationId: 'app_1',
      baseCommit: 'f'.repeat(40),
      treeHash: 'g'.repeat(40),
      workingTreePatchHash: null,
      now: '2026-08-08T10:00:07.000Z'
    })
    const candidate = createBaselineCandidate(s.p, {
      applicationId: 'app_1',
      name: '1.0'
    })
    expect(candidate.source.parentBaselineId).toBe(s.baseBaselineId)
    expect(candidate.source.taskId).toBe(s.taskId)
    expect(candidate.source.artifactApplicationId).toBe('app_1')
    expect(candidate.baseline.status).toBe('DRAFT')
    expect(candidate.baseline.repositoryRevisionId).toBeTruthy()
    expect(candidate.items.map((item) => item.nodeVersionId)).toEqual(['nv_1'])

    // idempotent: same name returns the same candidate
    const again = createBaselineCandidate(s.p, { applicationId: 'app_1', name: '1.0' })
    expect(again.baseline.id).toBe(candidate.baseline.id)
    // different name -> rejected
    expect(() =>
      createBaselineCandidate(s.p, { applicationId: 'app_1', name: '1.0-copy' })
    ).toThrow(ValidationError)
    closeDatabase(s.p)
  })

  it('rejects a candidate for a non-APPLIED application', () => {
    const s = seed()
    createArtifactApplication(s.p, appInput(s))
    expect(() =>
      createBaselineCandidate(s.p, { applicationId: 'app_1', name: '1.0' })
    ).toThrow(/APPLIED artifact application/)
    closeDatabase(s.p)
  })
})
