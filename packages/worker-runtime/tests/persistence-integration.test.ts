import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import {
  activateBaseline,
  applyMigrations,
  closeDatabase,
  createBaselineDraft,
  createNode,
  createProject,
  createTask,
  freezeContextSnapshot,
  getSnapshot,
  listSnapshotItems,
  openDatabase,
  publishNodeVersion,
  publishTaskSpecVersion,
  upsertRepositoryRevision,
  type Persistence
} from '@canvas-agent/persistence'
import type { ExecutionRequestContract } from '@canvas-agent/contracts'
import {
  FixtureAgentAdapter,
  createInMemoryClaimStore,
  createWorker,
  readRepositoryRevision,
  sha256Hex
} from '../src'
import {
  TEST_ALLOWLIST,
  buildRequest,
  cleanupTempDirs,
  createTempGitRepo,
  git,
  trackTempDir
} from './helpers'

const GIT_OPTIONS = {
  timeoutMs: 30_000,
  maxOutputBytes: 2 * 1024 * 1024,
  commandAllowlist: TEST_ALLOWLIST,
  signal: undefined
} as const

describe('persistence + worker-runtime core-loop smoke', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('freezes a contract in SQLite and executes it in an isolated worktree', async () => {
    const repo = await createTempGitRepo()
    const runtimeDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-smoke-runtime-')))

    const p: Persistence = openDatabase({ path: ':memory:' })
    applyMigrations(p)

    const projectId = 'proj_smoke'
    const nodeId = 'node_smoke'
    const taskId = 'task_smoke'
    const specId = 'spec_smoke'
    const revisionId = 'rev_smoke'
    const baselineId = 'baseline_smoke'
    const snapshotId = 'snap_smoke'

    createProject(p, { id: projectId, name: 'Smoke Project' })
    createNode(p, { id: nodeId, projectId, type: 'REQUIREMENT' })
    const version = publishNodeVersion(p, {
      id: 'nv_smoke',
      nodeId,
      title: 'Smoke requirement',
      body: 'Enable one worker run from a frozen snapshot.'
    })
    createTask(p, { id: taskId, projectId, type: 'IMPLEMENT_CHANGE', title: 'Smoke task' })
    const spec = publishTaskSpecVersion(p, {
      id: specId,
      taskId,
      description: 'Run the worker against the smoke repository.',
      scope: 'packages/worker-runtime',
      criteria: [{ description: 'worker returns a patch', position: 0 }]
    })
    expect(spec.spec.id).toBe(specId)

    const actual = await readRepositoryRevision(repo.dir, {
      cwd: repo.dir,
      ...GIT_OPTIONS
    })
    expect(actual.baseCommit).toBe(repo.baseCommit)
    expect(actual.workingTreePatchHash).toBeNull()
    if (actual.baseCommit === null || actual.treeHash === null) {
      throw new Error('expected a committed repository revision')
    }

    const revision = upsertRepositoryRevision(p, {
      id: revisionId,
      baseCommit: actual.baseCommit,
      treeHash: actual.treeHash,
      workingTreePatchHash: actual.workingTreePatchHash
    })
    expect(revision.id).toBe(revisionId)

    createBaselineDraft(p, {
      id: baselineId,
      projectId,
      name: 'Smoke 0.1',
      nodeVersionIds: [version.id]
    })
    activateBaseline(p, { baselineId })

    const frozen = freezeContextSnapshot(p, {
      id: snapshotId,
      projectId,
      taskId,
      taskSpecVersionId: specId,
      baseBaselineId: baselineId,
      expectedRepositoryRevisionId: revisionId,
      items: [
        {
          itemType: 'NODE_VERSION',
          sourceRef: 'node://nv_smoke',
          resolvedContent: version.body,
          authority: 'TASK_INSTRUCTION',
          priority: 'P0',
          tokenEstimate: 120,
          position: 0
        },
        {
          itemType: 'REPOSITORY_CONTENT',
          sourceRef: 'file://README.md',
          resolvedContent: '# test repository\n',
          authority: 'PROJECT_FACT',
          priority: 'P1',
          tokenEstimate: 40,
          position: 1
        }
      ]
    })
    expect(frozen.snapshot.status).toBe('FROZEN')
    expect(frozen.snapshot.expectedRepositoryRevisionId).toBe(revisionId)

    const items = listSnapshotItems(p, snapshotId)
    expect(items).toHaveLength(2)
    expect(items[0]?.contentHash).toBe(sha256Hex(version.body))
    expect(items[1]?.contentHash).toBe(sha256Hex('# test repository\n'))

    const request: ExecutionRequestContract = buildRequest({
      executionRequestId: 'req_smoke_001',
      runId: 'run_smoke_001',
      taskSpecVersionId: specId,
      contextSnapshotId: snapshotId,
      expectedRepositoryRevision: {
        baseCommit: revision.baseCommit,
        treeHash: revision.treeHash,
        workingTreePatchHash: revision.workingTreePatchHash
      }
    })

    const worker = createWorker({
      runtimeDirectory: runtimeDir,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      claimStore: createInMemoryClaimStore(),
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [
        ['node', '-e', 'process.exit(require("fs").existsSync("docs/smoke.md") ? 0 : 1)']
      ],
      agent: new FixtureAgentAdapter({
        steps: [
          { kind: 'appendFile', file: 'docs/smoke.md', lines: ['# smoke', 'written by fixture'] }
        ],
        summary: 'smoke: wrote docs/smoke.md'
      })
    })

    const result = await worker.dispatch({ request })

    expect(result.outcome).toBe('SUCCEEDED')
    expect(result.claimGranted).toBe(true)
    expect(result.patch).toContain('docs/smoke.md')
    expect(result.patchHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.verificationResults?.[0]?.exitCode).toBe(0)
    expect(result.artifacts?.some((artifact) => artifact.kind === 'PATCH')).toBe(true)
    expect(result.artifacts?.some((artifact) => artifact.kind === 'TEST_RESULT')).toBe(true)

    expect(existsSync(join(runtimeDir, 'worktrees', request.executionRequestId))).toBe(false)
    expect(existsSync(join(repo.dir, 'docs'))).toBe(false)

    expect(getSnapshot(p, snapshotId).taskSpecVersionId).toBe(specId)
    expect(getSnapshot(p, snapshotId).status).toBe('FROZEN')

    closeDatabase(p)
  })

  it('rejects a request whose pinned revision no longer matches the repository', async () => {
    const repo = await createTempGitRepo()
    const runtimeDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-smoke-runtime-')))
    const p: Persistence = openDatabase({ path: ':memory:' })
    applyMigrations(p)

    createProject(p, { id: 'proj_smoke', name: 'Smoke Project' })
    const revision = upsertRepositoryRevision(p, {
      id: 'rev_stale',
      baseCommit: repo.baseCommit,
      treeHash: repo.treeHash,
      workingTreePatchHash: null
    })

    const request = buildRequest({
      executionRequestId: 'req_stale_001',
      taskSpecVersionId: 'spec_missing',
      contextSnapshotId: 'snap_missing',
      expectedRepositoryRevision: {
        baseCommit: revision.baseCommit,
        treeHash: revision.treeHash,
        workingTreePatchHash: revision.workingTreePatchHash
      }
    })

    await writeFile(join(repo.dir, 'README.md'), '# test repository\nchanged\n')
    await git(repo.dir, ['commit', '-am', 'external change'])

    const worker = createWorker({
      runtimeDirectory: runtimeDir,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
    })

    const result = await worker.dispatch({ request })
    expect(result.outcome).toBe('REVISION_MISMATCH')
    expect(result.revisionMismatch?.field).toBe('baseCommit')
    closeDatabase(p)
  })
})
