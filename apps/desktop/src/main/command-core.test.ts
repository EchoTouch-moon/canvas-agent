import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openWorkspaceDatabase, closeWorkspaceDatabase } from './database'
import { GitRevisionReader } from './git-revision-reader'
import { WorkspaceService } from './workspace-service'
import { ExecutionCoordinator } from './execution-coordinator'
import { InProcessWorkerHost } from './testing/in-process-worker-host'
import { buildRoutes, handleCommand } from './command-core'
import { cleanupTempDirs, createTempGitRepo, trackTempDir } from './testing/git-fixture'
import type { CommandRequest } from '@canvas-agent/contracts'

function request(command: string, payload: unknown): CommandRequest {
  return {
    requestId: 'req_t',
    schemaVersion: 1,
    command: command as never,
    payload: payload as never
  }
}

describe('CommandRouter (command-core)', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('rejects malformed and unknown commands at the transport boundary', async () => {
    const routes = buildRoutes({ workspace: null, coordinator: null })

    await expect(
      handleCommand(routes, { requestId: 'r', command: 'project.create' })
    ).rejects.toThrow()
    await expect(handleCommand(routes, request('nope.create', {}))).rejects.toThrow()
    await expect(handleCommand(routes, request('worker.dispatch', {}))).rejects.toThrow()
  })

  it('rejects handler output that fails the command response schema', async () => {
    const badRoutes = {
      'project.create': { execute: async () => ({ bad: true }) }
    }
    const result = await handleCommand(badRoutes, request('project.create', { name: 'X' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.name).toBe('InternalError')
  })

  it('reports workspace commands as HostUnavailableError when unconfigured', async () => {
    const routes = buildRoutes({ workspace: null, coordinator: null })
    const result = await handleCommand(routes, request('project.create', { name: 'X' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.name).toBe('HostUnavailableError')

    const dispatch = await handleCommand(
      routes,
      request('execution.dispatch', { executionRequestId: 'e', contextSnapshotId: 's' })
    )
    expect(dispatch.ok).toBe(false)
    if (!dispatch.ok) expect(dispatch.error.name).toBe('HostUnavailableError')
  })

  it('runs a full workspace flow including project.state and execution.dispatch', async () => {
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
    const coordinator = new ExecutionCoordinator(p, worker)
    const routes = buildRoutes({ workspace: service, coordinator })

    const created = await handleCommand(routes, request('project.create', { name: 'MUSICDB' }))
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected ok')
    const projectId = (created.data as { id: string }).id

    const listed = await handleCommand(routes, request('project.list', {}))
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error('expected ok')

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
        selections: [{ source: { kind: 'NODE_VERSION', nodeVersionId: versionId } }]
      })
    )
    expect(frozen.ok).toBe(true)
    if (!frozen.ok) throw new Error('expected ok')
    const snapshotId = (frozen.data as { snapshot: { id: string } }).snapshot.id

    const state = await handleCommand(routes, request('project.state', { projectId }))
    expect(state.ok).toBe(true)
    if (!state.ok) throw new Error('expected ok')
    const view = state.data as { nodes: unknown[]; taskSpecs: unknown[]; activeBaseline: unknown }
    expect(view.nodes).toHaveLength(1)
    expect(view.taskSpecs).toHaveLength(1)
    expect(view.activeBaseline).not.toBeNull()

    const dispatch = await handleCommand(
      routes,
      request('execution.dispatch', {
        executionRequestId: 'exec-1',
        contextSnapshotId: snapshotId
      })
    )
    if (!dispatch.ok) {
      throw new Error(`dispatch failed: ${dispatch.error.name}: ${dispatch.error.message}`)
    }
    expect(dispatch.ok).toBe(true)
    if (!dispatch.ok) throw new Error('expected ok')
    expect((dispatch.data as { outcome: string }).outcome).toBe('SUCCEEDED')

    const cancel = await handleCommand(
      routes,
      request('execution.cancel', { executionRequestId: 'exec-1' })
    )
    expect(cancel.ok).toBe(true)
    if (!cancel.ok) throw new Error('expected ok')
    expect((cancel.data as { cancelled: boolean }).cancelled).toBe(false)

    await worker.dispose()
    closeWorkspaceDatabase(p)
  })
})
