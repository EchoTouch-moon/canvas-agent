import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acceptanceCriterionTable,
  activateBaseline,
  applyMigrations,
  artifactApplicationTable,
  artifactTable,
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
  getArtifactApplicationAggregate,
  openDatabase,
  publishNodeVersion,
  publishTaskSpecVersion,
  sha256Hex,
  upsertRepositoryRevision,
  type Persistence,
  type SystemServices
} from '@canvas-agent/persistence'
import { WorkspaceService } from './workspace-service'
import { GitRevisionReader } from './git-revision-reader'
import { cleanupTempDirs, createTempGitRepo, git, gitOutput } from './testing/git-fixture'

function services(): SystemServices {
  let counter = 0
  return {
    now: () => '2026-08-08T10:00:00.000Z',
    nextId: (prefix: string) => `${prefix}${++counter}`
  }
}

const PATCH = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # main process test
+adopted change
`

interface Scenario {
  p: Persistence
  service: WorkspaceService
  repoDir: string
  projectId: string
  taskId: string
  taskSpecVersionId: string
  runId: string
  evaluationId: string
  artifactId: string
  baseRevisionId: string
  baseCommit: string
}

async function seed(): Promise<Scenario> {
  const repoDir = await createTempGitRepo()
  const baseCommit = await gitOutput(repoDir, ['rev-parse', 'HEAD'])
  const runtimeDir = (await mkdtemp(join(tmpdir(), 'ca-adoption-runtime-'))) as string
  const p = openDatabase({ path: ':memory:', services: services() })
  applyMigrations(p)
  const service = new WorkspaceService(
    p,
    new GitRevisionReader({ sourceRepositoryPath: repoDir, runtimeDirectory: runtimeDir })
  )

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
    criteria: [{ description: 'c', position: 0 }]
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
    baseCommit,
    treeHash: await gitOutput(repoDir, ['rev-parse', 'HEAD^{tree}']),
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
    request: {
      executionRequestId,
      workerAttemptNumber: 1,
      checkpointId: null,
      requestHash: 'c'.repeat(64),
      schemaVersion: 1,
      requestJson: '{}',
      dispatchedAt: '2026-08-08T10:00:01.000Z'
    }
  })
  finalizeRunWithPatch(p, runId, executionRequestId)

  const criterionId = p.drizzle
    .select({ id: acceptanceCriterionTable.id })
    .from(acceptanceCriterionTable)
    .all()[0]?.id
  const evaluation = createAcceptanceEvaluation(p, {
    projectId,
    taskId: task.id,
    taskSpecVersionId: spec.spec.id,
    runId,
    criteria: [{ criterionId: criterionId ?? 'x', verdict: 'PASSED' }]
  })
  completeTask(p, { taskId: task.id, evaluationId: evaluation.evaluation.id })

  const artifactId = p.drizzle.select().from(artifactTable).all()[0]?.id as string

  return {
    p,
    service,
    repoDir,
    projectId,
    taskId: task.id,
    taskSpecVersionId: spec.spec.id,
    runId,
    evaluationId: evaluation.evaluation.id,
    artifactId,
    baseRevisionId: 'rev_1',
    baseCommit
  }
}

function finalizeRunWithPatch(p: Persistence, runId: string, executionRequestId: string): void {
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
      patchHash: sha256Hex(PATCH),
      timedOut: false,
      recoveryJson: null
    },
    completedAt: '2026-08-08T10:00:05.000Z',
    now: '2026-08-08T10:00:05.000Z',
    artifacts: [
      {
        kind: 'PATCH',
        fileName: 'patch.diff',
        content: PATCH,
        contentHash: sha256Hex(PATCH),
        sizeBytes: Buffer.byteLength(PATCH, 'utf8')
      }
    ]
  })
}

describe('result adoption', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('applies the accepted patch and persists an APPLIED application + new revision', async () => {
    const s = await seed()
    const before = await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])

    const aggregate = await s.service.applyArtifact({
      taskId: s.taskId,
      evaluationId: s.evaluationId,
      artifactId: s.artifactId
    })

    expect(aggregate.effectiveStatus).toBe('APPLIED')
    const after = await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])
    expect(after).not.toBe(before)
    expect(after).toMatch(/^[a-f0-9]{40}$/)
    const head = await gitOutput(s.repoDir, ['log', '-1', '--format=%P'])
    expect(head.trim()).toBe(before)
    const clean = (await gitOutput(s.repoDir, ['status', '--porcelain'])).trim()
    expect(clean).toBe('')
    expect(aggregate.repositoryRevision?.baseCommit).toBe(after)
    closeDatabase(s.p)
  })

  it('is idempotent: a second apply returns APPLIED and does not create a second commit', async () => {
    const s = await seed()
    await s.service.applyArtifact({
      taskId: s.taskId,
      evaluationId: s.evaluationId,
      artifactId: s.artifactId
    })
    const afterFirst = await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])

    const again = await s.service.applyArtifact({
      taskId: s.taskId,
      evaluationId: s.evaluationId,
      artifactId: s.artifactId
    })
    expect(again.effectiveStatus).toBe('APPLIED')
    expect(await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])).toBe(afterFirst)
    expect((await gitOutput(s.repoDir, ['rev-list', '--count', 'HEAD'])).trim()).toBe('2')
    closeDatabase(s.p)
  })

  it('rejects a stale base: a manual commit after the run blocks adoption with no side effect', async () => {
    const s = await seed()
    await git(s.repoDir, ['commit', '--allow-empty', '-m', 'manual change'])
    const manualHead = await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])

    await expect(
      s.service.applyArtifact({
        taskId: s.taskId,
        evaluationId: s.evaluationId,
        artifactId: s.artifactId
      })
    ).rejects.toThrow(/does not match the Run revision/)

    expect(await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])).toBe(manualHead)
    const appCount = s.p.drizzle
      .select({ id: artifactApplicationTable.id })
      .from(artifactApplicationTable)
      .all().length
    expect(appCount).toBe(0)
    closeDatabase(s.p)
  })

  it('reconciles a crash gap: commit exists but DB finalize lost -> retry detects and finalizes without reapplying', async () => {
    const s = await seed()
    const aggregate = await s.service.applyArtifact({
      taskId: s.taskId,
      evaluationId: s.evaluationId,
      artifactId: s.artifactId
    })
    const appliedCommit = await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])

    // Simulate the crash window: the git commit survived but the DB APPLIED
    // event + resulting revision were lost.
    s.p.db.exec(
      `DELETE FROM artifact_application_event WHERE application_id = '${aggregate.application.id}' AND kind = 'APPLIED'`
    )
    if (aggregate.repositoryRevision !== null) {
      s.p.db.exec(`DELETE FROM repository_revision WHERE id = '${aggregate.repositoryRevision.id}'`)
    }
    const interrupted = getArtifactApplicationAggregate(s.p, aggregate.application.id)
    expect(interrupted.effectiveStatus).toBe('APPLYING')

    const retried = await s.service.applyArtifact({
      taskId: s.taskId,
      evaluationId: s.evaluationId,
      artifactId: s.artifactId
    })
    expect(retried.effectiveStatus).toBe('APPLIED')
    expect(await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])).toBe(appliedCommit)
    expect(retried.repositoryRevision?.baseCommit).toBe(appliedCommit)
    closeDatabase(s.p)
  })
})
