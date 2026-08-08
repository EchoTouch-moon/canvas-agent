import { describe, expect, it } from 'vitest'
import {
  activateBaseline,
  createBaselineDraft,
  createNode,
  createProject,
  createTask,
  createDispatchedRun,
  closeDatabase,
  finalizeRun,
  freezeContextSnapshot,
  getRunAggregate,
  interruptRun,
  listRuns,
  mapDispatchToRunOutcome,
  NotFoundError,
  publishNodeVersion,
  publishTaskSpecVersion,
  upsertRepositoryRevision,
  ValidationError,
  type Persistence
} from '../src'
import { createTestPersistence } from './helpers'

interface Seeded {
  p: Persistence
  projectId: string
  taskId: string
  taskSpecVersionId: string
  contextSnapshotId: string
  revisionId: string
}

function createProjectFixture(p: Persistence, projectId: string): Omit<Seeded, 'p'> {
  createProject(p, { id: projectId, name: projectId })
  const node = createNode(p, { id: `node-${projectId}`, projectId, type: 'GOAL' })
  const version = publishNodeVersion(p, {
    id: `nv-${projectId}`,
    nodeId: node.id,
    title: 't',
    body: 'b'
  })
  const task = createTask(p, { id: `task-${projectId}`, projectId, type: 'IMPLEMENT_CHANGE', title: 'T' })
  const spec = publishTaskSpecVersion(p, {
    id: `spec-${projectId}`,
    taskId: task.id,
    description: 'd',
    scope: 's',
    criteria: [{ description: 'c', position: 0 }]
  })
  const baseline = createBaselineDraft(p, {
    id: `baseline-${projectId}`,
    projectId,
    name: '0.1',
    nodeVersionIds: [version.id]
  })
  activateBaseline(p, { baselineId: baseline.id })
  upsertRepositoryRevision(p, {
    id: `rev-${projectId}`,
    baseCommit: `${projectId}${'a'.repeat(40 - projectId.length)}`.slice(0, 40),
    treeHash: `${projectId}${'b'.repeat(40 - projectId.length)}`.slice(0, 40),
    workingTreePatchHash: null
  })
  const frozen = freezeContextSnapshot(p, {
    id: `snap-${projectId}`,
    projectId,
    taskId: task.id,
    taskSpecVersionId: spec.spec.id,
    baseBaselineId: baseline.id,
    expectedRepositoryRevisionId: `rev-${projectId}`,
    items: [
      {
        itemType: 'NODE_VERSION',
        sourceRef: `node://${version.id}`,
        resolvedContent: 't\n\nb',
        authority: 'PROJECT_FACT',
        priority: 'P1',
        tokenEstimate: 5,
        position: 0
      }
    ]
  })
  return {
    projectId,
    taskId: task.id,
    taskSpecVersionId: spec.spec.id,
    contextSnapshotId: frozen.snapshot.id,
    revisionId: `rev-${projectId}`
  }
}

function seed(): Seeded {
  const p = createTestPersistence('2026-08-08T10:00:00.000Z')
  return { p, ...createProjectFixture(p, 'proj_1') }
}

function dispatchRequest(executionRequestId = 'exec-1') {
  return {
    executionRequestId,
    workerAttemptNumber: 1,
    checkpointId: null,
    requestHash: 'c'.repeat(64),
    schemaVersion: 1,
    requestJson: '{"executionRequestId":"exec-1"}',
    dispatchedAt: '2026-08-08T10:00:01.000Z'
  }
}

describe('run persistence', () => {
  it('maps dispatch outcomes to run outcomes', () => {
    expect(mapDispatchToRunOutcome('SUCCEEDED', false)).toBe('SUCCEEDED')
    expect(mapDispatchToRunOutcome('PARTIAL', false)).toBe('PARTIAL')
    expect(mapDispatchToRunOutcome('PARTIAL', true)).toBe('TIMED_OUT')
    expect(mapDispatchToRunOutcome('CANCELLED', false)).toBe('CANCELLED')
    expect(mapDispatchToRunOutcome('VALIDATION_REJECTED', false)).toBe('FAILED')
    expect(mapDispatchToRunOutcome('CLAIM_REJECTED', false)).toBe('FAILED')
    expect(mapDispatchToRunOutcome('REVISION_MISMATCH', false)).toBe('FAILED')
  })

  it('persists Run + request record + DISPATCHED atomically before the worker', () => {
    const { p, projectId, taskId, taskSpecVersionId, contextSnapshotId, revisionId } = seed()
    createDispatchedRun(p, {
      runId: 'run_1',
      projectId,
      taskId,
      taskSpecVersionId,
      contextSnapshotId,
      repositoryRevisionId: revisionId,
      startedAt: '2026-08-08T10:00:01.000Z',
      now: '2026-08-08T10:00:01.000Z',
      request: dispatchRequest()
    })

    const view = getRunAggregate(p, 'run_1')
    expect(view.run.status).toBe('RUNNING')
    expect(view.run.outcome).toBeNull()
    expect(view.run.completedAt).toBeNull()
    expect(view.executionRequests).toHaveLength(1)
    expect(view.executionRequests[0]).toMatchObject({
      executionRequestId: 'exec-1',
      requestHash: 'c'.repeat(64),
      dispatchOutcome: null,
      completedAt: null
    })
    expect(view.events.map((event) => event.kind)).toEqual(['DISPATCHED'])
    closeDatabase(p)
  })

  it('finalizes a run with artifacts, outcome, completedAt and a FINISHED event', () => {
    const { p, projectId, taskId, taskSpecVersionId, contextSnapshotId, revisionId } = seed()
    createDispatchedRun(p, {
      runId: 'run_1',
      projectId,
      taskId,
      taskSpecVersionId,
      contextSnapshotId,
      repositoryRevisionId: revisionId,
      startedAt: '2026-08-08T10:00:01.000Z',
      now: '2026-08-08T10:00:01.000Z',
      request: dispatchRequest()
    })

    finalizeRun(p, {
      runId: 'run_1',
      executionRequestId: 'exec-1',
      metadata: {
        dispatchOutcome: 'SUCCEEDED',
        claimGranted: true,
        rejectionReason: null,
        revisionMismatchField: null,
        revisionMismatchExpected: null,
        revisionMismatchActual: null,
        patchHash: 'd'.repeat(64),
        timedOut: false
      },
      completedAt: '2026-08-08T10:00:05.000Z',
      now: '2026-08-08T10:00:05.000Z',
      artifacts: [
        { kind: 'PATCH', fileName: 'patch.diff', content: 'diff', contentHash: 'e'.repeat(64), sizeBytes: 4 },
        { kind: 'TEST_RESULT', fileName: 'verification.json', content: '[]', contentHash: 'f'.repeat(64), sizeBytes: 2 }
      ]
    })

    const view = getRunAggregate(p, 'run_1')
    expect(view.run.status).toBe('FINISHED')
    expect(view.run.outcome).toBe('SUCCEEDED')
    expect(view.run.completedAt).toBe('2026-08-08T10:00:05.000Z')
    expect(view.executionRequests[0]).toMatchObject({
      dispatchOutcome: 'SUCCEEDED',
      claimGranted: true,
      patchHash: 'd'.repeat(64),
      completedAt: '2026-08-08T10:00:05.000Z'
    })
    expect(view.events.map((event) => event.kind)).toEqual(['DISPATCHED', 'FINISHED'])
    expect(view.artifacts).toHaveLength(2)
    expect(view.artifacts.map((artifact) => artifact.position)).toEqual([0, 1])
    closeDatabase(p)
  })

  it('interrupts with terminal evidence when the worker returned but finalize failed', () => {
    const { p, projectId, taskId, taskSpecVersionId, contextSnapshotId, revisionId } = seed()
    createDispatchedRun(p, {
      runId: 'run_1',
      projectId,
      taskId,
      taskSpecVersionId,
      contextSnapshotId,
      repositoryRevisionId: revisionId,
      startedAt: '2026-08-08T10:00:01.000Z',
      now: '2026-08-08T10:00:01.000Z',
      request: dispatchRequest()
    })

    interruptRun(p, {
      runId: 'run_1',
      executionRequestId: 'exec-1',
      reasonCode: 'artifact_integrity_failure',
      now: '2026-08-08T10:00:06.000Z',
      terminalMetadata: {
        dispatchOutcome: 'SUCCEEDED',
        claimGranted: true,
        rejectionReason: null,
        revisionMismatchField: null,
        revisionMismatchExpected: null,
        revisionMismatchActual: null,
        patchHash: null,
        timedOut: false
      },
      terminalCompletedAt: '2026-08-08T10:00:05.000Z'
    })

    const view = getRunAggregate(p, 'run_1')
    expect(view.run.status).toBe('INTERRUPTED')
    expect(view.run.outcome).toBeNull()
    expect(view.executionRequests[0]).toMatchObject({
      dispatchOutcome: 'SUCCEEDED',
      completedAt: '2026-08-08T10:00:05.000Z'
    })
    expect(view.events.map((event) => event.kind)).toEqual(['DISPATCHED', 'INTERRUPTED'])
    closeDatabase(p)
  })

  it('interrupts without terminal evidence when the worker crashed', () => {
    const { p, projectId, taskId, taskSpecVersionId, contextSnapshotId, revisionId } = seed()
    createDispatchedRun(p, {
      runId: 'run_1',
      projectId,
      taskId,
      taskSpecVersionId,
      contextSnapshotId,
      repositoryRevisionId: revisionId,
      startedAt: '2026-08-08T10:00:01.000Z',
      now: '2026-08-08T10:00:01.000Z',
      request: dispatchRequest()
    })

    interruptRun(p, {
      runId: 'run_1',
      executionRequestId: 'exec-1',
      reasonCode: 'worker_host_failure',
      now: '2026-08-08T10:00:03.000Z',
      terminalMetadata: null,
      terminalCompletedAt: null
    })

    const view = getRunAggregate(p, 'run_1')
    expect(view.run.status).toBe('INTERRUPTED')
    expect(view.run.outcome).toBeNull()
    expect(view.executionRequests[0]?.completedAt).toBeNull()
    closeDatabase(p)
  })

  it('lists runs project-scoped newest first and rejects re-transitions', () => {
    const { p, projectId, taskId, taskSpecVersionId, contextSnapshotId, revisionId } = seed()
    const other = createProjectFixture(p, 'proj_other')
    createDispatchedRun(p, {
      runId: 'run_1',
      projectId,
      taskId,
      taskSpecVersionId,
      contextSnapshotId,
      repositoryRevisionId: revisionId,
      startedAt: '2026-08-08T10:00:01.000Z',
      now: '2026-08-08T10:00:01.000Z',
      request: dispatchRequest('exec-1')
    })
    createDispatchedRun(p, {
      runId: 'run_2',
      projectId,
      taskId,
      taskSpecVersionId,
      contextSnapshotId,
      repositoryRevisionId: revisionId,
      startedAt: '2026-08-08T10:00:02.000Z',
      now: '2026-08-08T10:00:02.000Z',
      request: dispatchRequest('exec-2')
    })
    createDispatchedRun(p, {
      runId: 'run_other',
      projectId: other.projectId,
      taskId: other.taskId,
      taskSpecVersionId: other.taskSpecVersionId,
      contextSnapshotId: other.contextSnapshotId,
      repositoryRevisionId: other.revisionId,
      startedAt: '2026-08-08T10:00:03.000Z',
      now: '2026-08-08T10:00:03.000Z',
      request: dispatchRequest('exec-3')
    })

    const runs = listRuns(p, projectId)
    expect(runs.map((run) => run.id)).toEqual(['run_2', 'run_1'])

    finalizeRun(p, {
      runId: 'run_1',
      executionRequestId: 'exec-1',
      metadata: {
        dispatchOutcome: 'SUCCEEDED',
        claimGranted: true,
        rejectionReason: null,
        revisionMismatchField: null,
        revisionMismatchExpected: null,
        revisionMismatchActual: null,
        patchHash: null,
        timedOut: false
      },
      completedAt: '2026-08-08T10:00:05.000Z',
      now: '2026-08-08T10:00:05.000Z',
      artifacts: []
    })
    expect(() =>
      finalizeRun(p, {
        runId: 'run_1',
        executionRequestId: 'exec-1',
        metadata: {
          dispatchOutcome: 'SUCCEEDED',
          claimGranted: true,
          rejectionReason: null,
          revisionMismatchField: null,
          revisionMismatchExpected: null,
          revisionMismatchActual: null,
          patchHash: null,
          timedOut: false
        },
        completedAt: '2026-08-08T10:00:06.000Z',
        now: '2026-08-08T10:00:06.000Z',
        artifacts: []
      })
    ).toThrow(ValidationError)

    expect(() => getRunAggregate(p, 'missing')).toThrow(NotFoundError)
    closeDatabase(p)
  })
})
