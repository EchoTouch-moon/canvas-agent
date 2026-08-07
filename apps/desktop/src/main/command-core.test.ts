import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeRequestHash } from '@canvas-agent/worker-runtime'
import { openWorkspaceDatabase, closeWorkspaceDatabase } from './database'
import { GitRevisionReader } from './git-revision-reader'
import { WorkspaceService } from './workspace-service'
import { UnavailableWorkerHost } from './worker-host'
import { InProcessWorkerHost } from './testing/in-process-worker-host'
import { buildRoutes, handleCommand } from './command-core'
import { cleanupTempDirs, createTempGitRepo, trackTempDir } from './testing/git-fixture'
import type { CommandRequest, ExecutionRequestContract } from '@canvas-agent/contracts'

const FUTURE = '2099-01-01T00:00:00.000Z'

function request(command: string, payload: unknown): CommandRequest {
  return {
    requestId: 'req_t',
    schemaVersion: 1,
    command: command as never,
    payload: payload as never
  }
}

function workerRequest(revision: {
  baseCommit: string
  treeHash: string
  workingTreePatchHash: string | null
}): ExecutionRequestContract {
  const request: Omit<ExecutionRequestContract, 'requestHash'> = {
    executionRequestId: 'req_1',
    runId: 'run_1',
    workerAttemptNumber: 1,
    taskSpecVersionId: 'spec_1',
    contextSnapshotId: 'snap_1',
    expectedRepositoryRevision: revision,
    checkpointId: null,
    requiredCapabilities: ['git', 'node'],
    agentConfiguration: { provider: 'fixture', model: 'deterministic' },
    toolPolicy: {
      allowedTools: ['write_file', 'run_command'],
      deniedPaths: [],
      allowNetwork: false,
      allowShell: true
    },
    workspaceStrategy: 'ISOLATED_WORKTREE',
    resourceBudget: { maxDurationMs: 30_000, maxToolCalls: 20, maxDiskBytes: 1_000_000_000 },
    schemaVersion: 1,
    expiresAt: FUTURE
  }
  return { ...request, requestHash: computeRequestHash(request) }
}

describe('CommandRouter (command-core)', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('rejects malformed and unknown commands as RequestValidationError', async () => {
    const routes = buildRoutes({ workspace: null, worker: new UnavailableWorkerHost() })

    const malformed = await handleCommand(routes, { requestId: 'r', command: 'project.create' })
    expect(malformed.ok).toBe(false)
    if (!malformed.ok) expect(malformed.error.name).toBe('RequestValidationError')

    const unknown = await handleCommand(routes, request('nope.create', {}))
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error.name).toBe('RequestValidationError')
  })

  it('reports workspace commands as HostUnavailableError when unconfigured', async () => {
    const routes = buildRoutes({ workspace: null, worker: new UnavailableWorkerHost() })
    const result = await handleCommand(routes, request('project.create', { name: 'X' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.name).toBe('HostUnavailableError')
  })

  it('runs a full workspace flow through the router and dispatch outcome as ok data', async () => {
    const repoDir = await createTempGitRepo()
    const runtimeDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-main-runtime-')))
    const p = openWorkspaceDatabase(':memory:')
    const service = new WorkspaceService(
      p,
      new GitRevisionReader({ sourceRepositoryPath: repoDir, runtimeDirectory: runtimeDir })
    )
    const worker = new InProcessWorkerHost({
      sourceRepositoryPath: repoDir,
      runtimeDirectory: runtimeDir
    })
    const routes = buildRoutes({ workspace: service, worker })

    const created = await handleCommand(routes, request('project.create', { name: 'MUSICDB' }))
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected ok')
    const projectId = (created.data as { id: string }).id

    const node = await handleCommand(
      routes,
      request('node.create', { projectId, type: 'REQUIREMENT' })
    )
    if (!node.ok) throw new Error('expected ok')
    const nodeId = (node.data as { id: string }).id

    const version = await handleCommand(
      routes,
      request('nodeVersion.publish', { nodeId, title: 'Req', body: 'body' })
    )
    if (!version.ok) throw new Error('expected ok')
    const versionId = (version.data as { id: string }).id

    const task = await handleCommand(
      routes,
      request('task.create', { projectId, type: 'IMPLEMENT_CHANGE', title: 'T' })
    )
    if (!task.ok) throw new Error('expected ok')
    const taskId = (task.data as { id: string }).id

    const spec = await handleCommand(
      routes,
      request('taskSpec.publish', {
        taskId,
        description: 'd',
        scope: 's',
        criteria: [{ description: 'works', position: 0 }]
      })
    )
    if (!spec.ok) throw new Error('expected ok')
    const specId = (spec.data as { spec: { id: string } }).spec.id

    const baseline = await handleCommand(
      routes,
      request('baseline.createDraft', { projectId, name: '0.1', nodeVersionIds: [versionId] })
    )
    if (!baseline.ok) throw new Error('expected ok')
    const baselineId = (baseline.data as { id: string }).id
    await handleCommand(routes, request('baseline.activate', { baselineId }))

    const revision = await handleCommand(routes, request('revision.current', {}))
    if (!revision.ok) throw new Error('expected ok')
    const revisionRow = revision.data as {
      id: string
      baseCommit: string
      treeHash: string
      workingTreePatchHash: string | null
    }

    const frozen = await handleCommand(
      routes,
      request('snapshot.freeze', {
        projectId,
        taskId,
        taskSpecVersionId: specId,
        baseBaselineId: baselineId,
        expectedRepositoryRevisionId: revisionRow.id,
        items: [
          {
            itemType: 'NODE_VERSION',
            sourceRef: `node://${versionId}`,
            resolvedContent: 'body',
            authority: 'TASK_INSTRUCTION',
            priority: 'P0',
            tokenEstimate: 120,
            position: 0
          }
        ]
      })
    )
    expect(frozen.ok).toBe(true)
    if (!frozen.ok) throw new Error('expected ok')

    const dispatch = await handleCommand(
      routes,
      request(
        'worker.dispatch',
        workerRequest({
          baseCommit: revisionRow.baseCommit,
          treeHash: revisionRow.treeHash,
          workingTreePatchHash: revisionRow.workingTreePatchHash
        })
      )
    )
    if (!dispatch.ok) {
      throw new Error(`dispatch failed: ${dispatch.error.name}: ${dispatch.error.message}`)
    }
    expect(dispatch.ok).toBe(true)
    expect((dispatch.data as { outcome: string }).outcome).toBe('SUCCEEDED')

    const cancel = await handleCommand(
      routes,
      request('worker.cancel', { executionRequestId: 'req_1' })
    )
    expect(cancel.ok).toBe(true)
    if (!cancel.ok) throw new Error('expected ok')
    expect((cancel.data as { cancelled: boolean }).cancelled).toBe(false)

    await worker.dispose()
    closeWorkspaceDatabase(p)
  })

  it('reports worker.dispatch as HostUnavailableError with the unavailable host', async () => {
    const routes = buildRoutes({ workspace: null, worker: new UnavailableWorkerHost() })
    const result = await handleCommand(
      routes,
      request(
        'worker.dispatch',
        workerRequest({
          baseCommit: 'a'.repeat(40),
          treeHash: 'b'.repeat(40),
          workingTreePatchHash: null
        })
      )
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.name).toBe('HostUnavailableError')
  })
})
