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
  baselineCandidateSourceTable,
  closeDatabase,
  executionRequestRecordTable,
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
import { GitRepositoryWriter } from './git-repository-writer'
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

  it('recovers an AUTHORIZED application whose git side effect never started (P0-3)', async () => {
    const s = await seed()
    const aggregate = await s.service.applyArtifact({
      taskId: s.taskId,
      evaluationId: s.evaluationId,
      artifactId: s.artifactId
    })
    // Simulate crash right after AUTHORIZED: APPLYING/APPLIED lost, git rolled
    // back to the base, revision row removed.
    s.p.db.exec(
      `DELETE FROM artifact_application_event WHERE application_id = '${aggregate.application.id}' AND kind IN ('APPLYING','APPLIED')`
    )
    if (aggregate.repositoryRevision !== null) {
      s.p.db.exec(`DELETE FROM repository_revision WHERE id = '${aggregate.repositoryRevision.id}'`)
    }
    await git(s.repoDir, ['reset', '--hard', s.baseCommit])
    const authorized = getArtifactApplicationAggregate(s.p, aggregate.application.id)
    expect(authorized.effectiveStatus).toBe('AUTHORIZED')

    const retried = await s.service.applyArtifact({
      taskId: s.taskId,
      evaluationId: s.evaluationId,
      artifactId: s.artifactId
    })
    expect(retried.effectiveStatus).toBe('APPLIED')
    expect(await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])).not.toBe(s.baseCommit)
    closeDatabase(s.p)
  })

  it('rejects a conflicting idempotent retry without touching git (P0-2)', async () => {
    const s = await seed()
    await s.service.applyArtifact({
      taskId: s.taskId,
      evaluationId: s.evaluationId,
      artifactId: s.artifactId
    })
    const afterFirst = await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])

    await expect(
      s.service.applyArtifact({
        taskId: s.taskId,
        evaluationId: 'evaluation_other',
        artifactId: s.artifactId
      })
    ).rejects.toThrow(/artifact_application_binding_conflict/)

    expect(await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])).toBe(afterFirst)
    expect((await gitOutput(s.repoDir, ['rev-list', '--count', 'HEAD'])).trim()).toBe('2')
    closeDatabase(s.p)
  })

  it('supports a PATCH artifact owned by the second ExecutionRequest of a Run (P0-1)', async () => {
    const s = await seed()
    // Add a second ExecutionRequestRecord + its PATCH to the same run.
    s.p.drizzle
      .insert(executionRequestRecordTable)
      .values({
        executionRequestId: 'exec-2',
        runId: s.runId,
        workerAttemptNumber: 2,
        checkpointId: null,
        requestHash: 'f'.repeat(64),
        schemaVersion: 1,
        requestJson: '{}',
        dispatchOutcome: 'SUCCEEDED',
        claimGranted: true,
        rejectionReason: null,
        revisionMismatchField: null,
        revisionMismatchExpected: null,
        revisionMismatchActual: null,
        patchHash: null,
        timedOut: false,
        recoveryJson: null,
        dispatchedAt: '2026-08-08T10:00:09.000Z',
        completedAt: '2026-08-08T10:00:10.000Z'
      })
      .run()
    const secondPatch = PATCH + '+second request change\n'
    s.p.drizzle
      .insert(artifactTable)
      .values({
        id: 'artifact_2',
        runId: s.runId,
        executionRequestId: 'exec-2',
        kind: 'PATCH',
        fileName: 'patch.diff',
        content: secondPatch,
        contentHash: sha256Hex(secondPatch),
        sizeBytes: Buffer.byteLength(secondPatch, 'utf8'),
        position: 1,
        createdAt: '2026-08-08T10:00:10.000Z'
      })
      .run()

    // The latest PASSED evaluation still references run_1 and the first patch;
    // to adopt the second artifact we need the evaluation to point at it, so
    // apply must find the request by artifact.executionRequestId (never [0]).
    // Guard 17 requires request.patchHash match; exec-2 has null patchHash so
    // it is skipped.
    const aggregate = await s.service.applyArtifact({
      taskId: s.taskId,
      evaluationId: s.evaluationId,
      artifactId: 'artifact_2'
    })
    expect(aggregate.effectiveStatus).toBe('APPLIED')
    expect(aggregate.application.artifactId).toBe('artifact_2')
    expect(aggregate.application.executionRequestId).toBe('exec-2')
    closeDatabase(s.p)
  })

  it('compensates an apply --index + commit failure back to a clean base (P0-5)', async () => {
    const s = await seed()
    // The writer applies --index then commit fails (invalid author date), so it
    // must safely reset to the expected base and stay clean.
    const writer = new GitRepositoryWriter(
      s.repoDir,
      (await mkdtemp(join(tmpdir(), 'ca-writer-'))) as string
    )
    await expect(
      writer.applyAcceptedPatch({
        applicationId: 'app_comp',
        baseCommit: s.baseCommit,
        patchContent: PATCH,
        patchHash: sha256Hex(PATCH),
        taskId: s.taskId,
        runId: s.runId,
        artifactId: 'artifact_comp',
        authorizedAt: 'not-a-valid-date'
      })
    ).rejects.toThrow()
    expect(await gitOutput(s.repoDir, ['rev-parse', 'HEAD'])).toBe(s.baseCommit)
    expect((await gitOutput(s.repoDir, ['status', '--porcelain'])).trim()).toBe('')
    closeDatabase(s.p)
  })

  it('rejects a stale baseline candidate when the repo moved past the applied revision (P0-6)', async () => {
    const s = await seed()
    const applied = await s.service.applyArtifact({
      taskId: s.taskId,
      evaluationId: s.evaluationId,
      artifactId: s.artifactId
    })
    await git(s.repoDir, ['commit', '--allow-empty', '-m', 'manual after adoption'])

    await expect(
      s.service.createBaselineCandidate({
        applicationId: applied.application.id,
        name: 'Baseline 1.1'
      })
    ).rejects.toThrow(/does not match the real repository/)
    const candidateRows = s.p.drizzle.select().from(baselineCandidateSourceTable).all().length
    expect(candidateRows).toBe(0)
    closeDatabase(s.p)
  })
})
