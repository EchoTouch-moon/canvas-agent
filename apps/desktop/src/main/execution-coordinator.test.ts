import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  activateBaseline,
  applyMigrations,
  closeDatabase,
  createBaselineDraft,
  createNode,
  createProject,
  createTask,
  freezeContextSnapshot,
  getRunAggregate,
  openDatabase,
  publishNodeVersion,
  publishTaskSpecVersion,
  upsertRepositoryRevision,
  NotFoundError,
  ValidationError,
  type Persistence,
  type SystemServices
} from '@canvas-agent/persistence'
import type { DispatchResult, ExecutionRequestContract } from '@canvas-agent/contracts'
import { computeRequestHash } from '@canvas-agent/worker-runtime'
import { ExecutionCoordinator } from './execution-coordinator'
import { InProcessWorkerHost } from './testing/in-process-worker-host'
import type { WorkerHost } from './worker-host'
import {
  cleanupTempDirs,
  createTempGitRepo,
  git,
  gitOutput,
  trackTempDir
} from './testing/git-fixture'

const UNUSED_RUNTIME = join(tmpdir(), 'ca-unused-runtime')

function services(): SystemServices {
  let counter = 0
  return {
    now: () => '2026-08-08T00:00:00.000Z',
    nextId: (prefix: string) => `${prefix}${++counter}`
  }
}

class FakeWorkerHost implements WorkerHost {
  readonly captured: ExecutionRequestContract[] = []
  result: DispatchResult = { outcome: 'SUCCEEDED', claimGranted: true }

  async dispatch(request: ExecutionRequestContract): Promise<DispatchResult> {
    this.captured.push(request)
    return this.result
  }

  async cancel(executionRequestId: string): Promise<boolean> {
    return executionRequestId === 'active-1'
  }

  async dispose(): Promise<void> {
    return
  }
}

async function frozenSetup(
  p: Persistence,
  repoDir?: string
): Promise<{ snapshotId: string; revisionId: string }> {
  createProject(p, { id: 'proj_1', name: 'P' })
  createNode(p, { id: 'node_1', projectId: 'proj_1', type: 'GOAL' })
  const version = publishNodeVersion(p, { id: 'nv_1', nodeId: 'node_1', title: 'T', body: 'body' })
  createTask(p, { id: 'task_1', projectId: 'proj_1', type: 'IMPLEMENT_CHANGE', title: 'T' })
  publishTaskSpecVersion(p, {
    id: 'spec_1',
    taskId: 'task_1',
    description: 'd',
    scope: 's',
    criteria: [{ description: 'c', position: 0 }]
  })
  const baseline = createBaselineDraft(p, {
    id: 'baseline_1',
    projectId: 'proj_1',
    name: '0.1',
    nodeVersionIds: [version.id]
  })
  activateBaseline(p, { baselineId: baseline.id })

  const baseCommit = repoDir ? await gitOutput(repoDir, ['rev-parse', 'HEAD']) : 'a'.repeat(40)
  const treeHash = repoDir ? await gitOutput(repoDir, ['rev-parse', 'HEAD^{tree}']) : 'b'.repeat(40)
  const revision = upsertRepositoryRevision(p, {
    id: 'rev_1',
    baseCommit,
    treeHash,
    workingTreePatchHash: null
  })

  const frozen = freezeContextSnapshot(p, {
    id: 'snap_1',
    projectId: 'proj_1',
    taskId: 'task_1',
    taskSpecVersionId: 'spec_1',
    baseBaselineId: baseline.id,
    expectedRepositoryRevisionId: revision.id,
    items: [
      {
        itemType: 'USER_INPUT',
        sourceRef: 'task://spec_1',
        resolvedContent: 'Implement X',
        authority: 'TASK_INSTRUCTION',
        priority: 'P0',
        tokenEstimate: 5,
        position: 0
      }
    ]
  })

  return { snapshotId: frozen.snapshot.id, revisionId: revision.id }
}

describe('ExecutionCoordinator', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('builds an ExecutionRequest from a frozen snapshot with Main-owned fields', async () => {
    const p = openDatabase({ path: ':memory:', services: services() })
    applyMigrations(p)
    await frozenSetup(p)
    const worker = new FakeWorkerHost()
    const coordinator = new ExecutionCoordinator(p, worker, UNUSED_RUNTIME, services())

    const response = await coordinator.dispatch({
      executionRequestId: 'exec-1',
      contextSnapshotId: 'snap_1'
    })

    expect(worker.captured).toHaveLength(1)
    const request = worker.captured[0] as unknown as ExecutionRequestContract
    expect(request.executionRequestId).toBe('exec-1')
    expect(request.workerAttemptNumber).toBe(1)
    expect(request.runId).toBe('run_1')
    expect(request.contextSnapshotId).toBe('snap_1')
    expect(request.taskSpecVersionId).toBe('spec_1')
    expect(request.schemaVersion).toBe(2)
    if (request.schemaVersion === 2) {
      expect(request.contextBundle.items).toHaveLength(1)
      expect(request.contextBundle.items[0]?.authority).toBe('TASK_INSTRUCTION')
      expect(request.contextBundle.items[0]?.priority).toBe('P0')
    }
    expect(request.expectedRepositoryRevision.baseCommit).toBe('a'.repeat(40))
    expect(request.requiredCapabilities).toEqual(['git', 'node'])
    expect(request.toolPolicy.allowNetwork).toBe(false)
    expect(request.resourceBudget.maxDurationMs).toBe(30_000)
    expect(request.workspaceStrategy).toBe('ISOLATED_WORKTREE')
    const { requestHash: _hash, ...rest } = request
    void _hash
    expect(request.requestHash).toBe(computeRequestHash(rest))

    expect(response.runId).toBe('run_1')
    expect(response.executionRequestId).toBe('exec-1')
    expect(response.result.outcome).toBe('SUCCEEDED')
    const run = getRunAggregate(p, 'run_1')
    expect(run.run.status).toBe('FINISHED')
    expect(run.run.outcome).toBe('SUCCEEDED')
    expect(run.executionRequests[0]?.requestJson).toContain('"executionRequestId":"exec-1"')
    expect(run.events.map((event) => event.kind)).toEqual(['DISPATCHED', 'FINISHED'])

    closeDatabase(p)
  })

  it('rejects a non-frozen snapshot', async () => {
    const p = openDatabase({ path: ':memory:', services: services() })
    applyMigrations(p)
    const { snapshotId: frozenId } = await frozenSetup(p)
    p.db.exec(
      "INSERT INTO context_snapshot (id, project_id, task_id, task_spec_version_id, base_baseline_id, expected_repository_revision_id, status, freshness, created_at, updated_at) VALUES ('snap_draft','proj_1','task_1','spec_1','baseline_1','rev_1','DRAFT','CURRENT','2026-08-08T00:00:00.000Z','2026-08-08T00:00:00.000Z')"
    )
    const coordinator = new ExecutionCoordinator(
      p,
      new FakeWorkerHost(),
      UNUSED_RUNTIME,
      services()
    )

    await expect(
      coordinator.dispatch({ executionRequestId: 'exec-1', contextSnapshotId: 'snap_draft' })
    ).rejects.toThrow(ValidationError)
    void frozenId
    closeDatabase(p)
  })

  it('rejects a snapshot that does not exist', async () => {
    const p = openDatabase({ path: ':memory:', services: services() })
    applyMigrations(p)
    const coordinator = new ExecutionCoordinator(
      p,
      new FakeWorkerHost(),
      UNUSED_RUNTIME,
      services()
    )

    await expect(
      coordinator.dispatch({ executionRequestId: 'exec-1', contextSnapshotId: 'missing' })
    ).rejects.toThrow(NotFoundError)
    closeDatabase(p)
  })

  it('rejects a dirty expected revision before any Run side effect', async () => {
    const p = openDatabase({ path: ':memory:', services: services() })
    applyMigrations(p)
    createProject(p, { id: 'proj_dirty', name: 'P' })
    createNode(p, { id: 'node_dirty', projectId: 'proj_dirty', type: 'GOAL' })
    const version = publishNodeVersion(p, {
      id: 'nv_dirty',
      nodeId: 'node_dirty',
      title: 'T',
      body: 'body'
    })
    createTask(p, {
      id: 'task_dirty',
      projectId: 'proj_dirty',
      type: 'IMPLEMENT_CHANGE',
      title: 'T'
    })
    publishTaskSpecVersion(p, {
      id: 'spec_dirty',
      taskId: 'task_dirty',
      description: 'd',
      scope: 's',
      criteria: [{ description: 'c', position: 0 }]
    })
    const baseline = createBaselineDraft(p, {
      id: 'baseline_dirty',
      projectId: 'proj_dirty',
      name: '0.1',
      nodeVersionIds: [version.id]
    })
    activateBaseline(p, { baselineId: baseline.id })
    const dirtyRevision = upsertRepositoryRevision(p, {
      id: 'rev_dirty',
      baseCommit: 'a'.repeat(40),
      treeHash: 'b'.repeat(40),
      workingTreePatchHash: 'c'.repeat(64)
    })
    freezeContextSnapshot(p, {
      id: 'snap_dirty',
      projectId: 'proj_dirty',
      taskId: 'task_dirty',
      taskSpecVersionId: 'spec_dirty',
      baseBaselineId: baseline.id,
      expectedRepositoryRevisionId: dirtyRevision.id,
      items: [
        {
          itemType: 'USER_INPUT',
          sourceRef: 'task://spec_dirty',
          resolvedContent: 'Implement X',
          authority: 'TASK_INSTRUCTION',
          priority: 'P0',
          tokenEstimate: 5,
          position: 0
        }
      ]
    })

    const worker = new FakeWorkerHost()
    const coordinator = new ExecutionCoordinator(p, worker, UNUSED_RUNTIME, services())
    await expect(
      coordinator.dispatch({ executionRequestId: 'exec-1', contextSnapshotId: 'snap_dirty' })
    ).rejects.toThrow(/DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED/)
    expect(worker.captured).toHaveLength(0)
    expect(() => getRunAggregate(p, 'run_1')).toThrow()
    closeDatabase(p)
  })

  it('does not chase the current revision: repo changed after freeze -> REVISION_MISMATCH', async () => {
    const repoDir = await createTempGitRepo()
    const runtimeDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-coord-runtime-')))
    const p = openDatabase({ path: ':memory:', services: services() })
    applyMigrations(p)
    const { snapshotId } = await frozenSetup(p, repoDir)

    await writeFile(join(repoDir, 'README.md'), '# test repository\nchanged after freeze\n')
    await git(repoDir, ['commit', '-am', 'post-freeze change'])

    const svc = services()
    const worker = new InProcessWorkerHost(
      {
        sourceRepositoryPath: repoDir,
        runtimeDirectory: runtimeDir
      },
      svc.now
    )
    const coordinator = new ExecutionCoordinator(p, worker, runtimeDir, svc)

    const result = await coordinator.dispatch({
      executionRequestId: 'exec-1',
      contextSnapshotId: snapshotId
    })
    expect(result.result.outcome).toBe('REVISION_MISMATCH')
    await worker.dispose()
    closeDatabase(p)
  })

  it('dispatches successfully against an unchanged repository', async () => {
    const repoDir = await createTempGitRepo()
    const runtimeDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-coord-runtime-')))
    const p = openDatabase({ path: ':memory:', services: services() })
    applyMigrations(p)
    const { snapshotId } = await frozenSetup(p, repoDir)

    const svc = services()
    const worker = new InProcessWorkerHost(
      {
        sourceRepositoryPath: repoDir,
        runtimeDirectory: runtimeDir
      },
      svc.now
    )
    const coordinator = new ExecutionCoordinator(p, worker, runtimeDir, svc)

    const result = await coordinator.dispatch({
      executionRequestId: 'exec-1',
      contextSnapshotId: snapshotId
    })
    expect(result.result.outcome).toBe('SUCCEEDED')
    await worker.dispose()
    closeDatabase(p)
  })

  it('cancel forwards to the worker and reports unknown ids as false', async () => {
    const p = openDatabase({ path: ':memory:', services: services() })
    applyMigrations(p)
    const worker = new FakeWorkerHost()
    const coordinator = new ExecutionCoordinator(p, worker, UNUSED_RUNTIME, services())

    await expect(coordinator.cancel({ executionRequestId: 'active-1' })).resolves.toEqual({
      cancelled: true
    })
    await expect(coordinator.cancel({ executionRequestId: 'unknown' })).resolves.toEqual({
      cancelled: false
    })
    closeDatabase(p)
  })

  it('interrupts the run on artifact integrity failure but keeps the terminal evidence', async () => {
    const runtimeDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-coord-runtime-')))
    const p = openDatabase({ path: ':memory:', services: services() })
    applyMigrations(p)
    await frozenSetup(p)
    const worker = new FakeWorkerHost()
    worker.result = {
      outcome: 'SUCCEEDED',
      claimGranted: true,
      artifacts: [
        { kind: 'PATCH', fileName: 'patch.diff', contentHash: '0'.repeat(64), sizeBytes: 1 }
      ]
    }
    const coordinator = new ExecutionCoordinator(p, worker, runtimeDir, services())

    await expect(
      coordinator.dispatch({ executionRequestId: 'exec-1', contextSnapshotId: 'snap_1' })
    ).rejects.toThrow()

    const run = getRunAggregate(p, 'run_1')
    expect(run.run.status).toBe('INTERRUPTED')
    expect(run.run.outcome).toBeNull()
    expect(run.executionRequests[0]).toMatchObject({ dispatchOutcome: 'SUCCEEDED' })
    expect(run.executionRequests[0]?.completedAt).not.toBeNull()
    expect(run.events.map((event) => event.kind)).toEqual(['DISPATCHED', 'INTERRUPTED'])
    closeDatabase(p)
  })
})
