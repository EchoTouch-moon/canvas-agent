import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeRequestHash, readRepositoryRevision } from '@canvas-agent/worker-runtime'
import type { ExecutionRequestContract } from '@canvas-agent/contracts'
import { WorkerService, type WorkerTransport } from './worker-service'
import type { WorkerHostResponse } from './protocol'
import { cleanupTempDirs, createTempGitRepo, trackTempDir } from '../main/testing/git-fixture'

const FUTURE = '2099-01-01T00:00:00.000Z'

class CapturingTransport implements WorkerTransport {
  readonly sent: WorkerHostResponse[] = []
  private waiters: Array<{
    predicate: (response: WorkerHostResponse) => boolean
    resolve: (response: WorkerHostResponse) => void
  }> = []

  send(response: WorkerHostResponse): void {
    this.sent.push(response)
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(response)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        waiter.resolve(response)
      }
    }
  }

  waitFor<T extends WorkerHostResponse>(
    predicate: (response: WorkerHostResponse) => response is T
  ): Promise<T> {
    const existing = this.sent.find(predicate) as T | undefined
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve) => {
      this.waiters.push({
        predicate,
        resolve: (response) => resolve(response as T)
      })
    })
  }
}

function workerRequest(
  revision: {
    baseCommit: string
    treeHash: string
    workingTreePatchHash: string | null
  },
  executionRequestId = 'exec-1'
): ExecutionRequestContract {
  const request: Omit<ExecutionRequestContract, 'requestHash'> = {
    executionRequestId,
    runId: 'run-1',
    workerAttemptNumber: 1,
    taskSpecVersionId: 'spec-1',
    contextSnapshotId: 'snap-1',
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

async function initService(
  transport: CapturingTransport,
  repoDir: string,
  runtimeDir: string
): Promise<WorkerService> {
  const service = new WorkerService(transport)
  await service.onRequest({
    protocolVersion: 1,
    type: 'init',
    sourceRepositoryPath: repoDir,
    runtimeDirectory: runtimeDir
  })
  await transport.waitFor((response) => response.type === 'init:ack')
  return service
}

describe('WorkerService', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('dispatches a fixture execution and returns real patch evidence', async () => {
    const repoDir = await createTempGitRepo()
    const runtimeDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-worker-service-')))
    const transport = new CapturingTransport()
    const service = await initService(transport, repoDir, runtimeDir)

    const revision = await readRepositoryRevision(repoDir, {
      cwd: repoDir,
      timeoutMs: 30_000,
      maxOutputBytes: 2 * 1024 * 1024,
      commandAllowlist: ['git', 'node'],
      signal: undefined
    })
    if (revision.baseCommit === null || revision.treeHash === null) {
      throw new Error('expected committed repo')
    }

    await service.onRequest({
      protocolVersion: 1,
      type: 'dispatch',
      messageId: 'msg-1',
      executionRequestId: 'exec-1',
      request: workerRequest({
        baseCommit: revision.baseCommit,
        treeHash: revision.treeHash,
        workingTreePatchHash: revision.workingTreePatchHash
      })
    })

    const result = await transport.waitFor(
      (response): response is Extract<WorkerHostResponse, { type: 'dispatch:result' }> =>
        response.type === 'dispatch:result' && response.messageId === 'msg-1'
    )
    expect(result.result.outcome).toBe('SUCCEEDED')
    expect(result.result.patch).toContain('docs/phase2.md')
    expect(result.result.verificationResults?.[0]?.exitCode).toBe(0)
    expect(result.result.patchHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('delivers a cancel ack and a later CANCELLED dispatch result', async () => {
    const repoDir = await createTempGitRepo()
    const runtimeDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-worker-service-')))
    const transport = new CapturingTransport()
    const service = new WorkerService(transport, {
      verificationCommands: [['node', '-e', 'setTimeout(() => {}, 30_000)']]
    })
    await service.onRequest({
      protocolVersion: 1,
      type: 'init',
      sourceRepositoryPath: repoDir,
      runtimeDirectory: runtimeDir
    })
    await transport.waitFor((response) => response.type === 'init:ack')

    const revision = await readRepositoryRevision(repoDir, {
      cwd: repoDir,
      timeoutMs: 30_000,
      maxOutputBytes: 2 * 1024 * 1024,
      commandAllowlist: ['git', 'node'],
      signal: undefined
    })
    if (revision.baseCommit === null || revision.treeHash === null) {
      throw new Error('expected committed repo')
    }

    void service.onRequest({
      protocolVersion: 1,
      type: 'dispatch',
      messageId: 'msg-1',
      executionRequestId: 'exec-1',
      request: workerRequest({
        baseCommit: revision.baseCommit,
        treeHash: revision.treeHash,
        workingTreePatchHash: revision.workingTreePatchHash
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    await service.onRequest({
      protocolVersion: 1,
      type: 'cancel',
      messageId: 'msg-2',
      executionRequestId: 'exec-1'
    })

    const cancel = await transport.waitFor(
      (response): response is Extract<WorkerHostResponse, { type: 'cancel:result' }> =>
        response.type === 'cancel:result' && response.messageId === 'msg-2'
    )
    expect(cancel.cancelled).toBe(true)

    const result = await transport.waitFor(
      (response): response is Extract<WorkerHostResponse, { type: 'dispatch:result' }> =>
        response.type === 'dispatch:result' && response.messageId === 'msg-1'
    )
    expect(result.result.outcome).toBe('CANCELLED')
  })

  it('reports cancelled:false for an unknown execution and drains on dispose', async () => {
    const repoDir = await createTempGitRepo()
    const runtimeDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-worker-service-')))
    const transport = new CapturingTransport()
    const service = await initService(transport, repoDir, runtimeDir)

    await service.onRequest({
      protocolVersion: 1,
      type: 'cancel',
      messageId: 'msg-2',
      executionRequestId: 'unknown'
    })
    const cancel = await transport.waitFor(
      (response): response is Extract<WorkerHostResponse, { type: 'cancel:result' }> =>
        response.type === 'cancel:result'
    )
    expect(cancel.cancelled).toBe(false)

    await service.onRequest({ protocolVersion: 1, type: 'dispose' })
    const ack = await transport.waitFor((response) => response.type === 'dispose:ack')
    expect(ack.type).toBe('dispose:ack')
  })

  it('responds to a fully invalid frame with an unattributable INVALID_FRAME error', async () => {
    const transport = new CapturingTransport()
    const service = new WorkerService(transport)

    await service.onRequest({ protocolVersion: 1, type: 'nope' })
    const error = await transport.waitFor(
      (response): response is Extract<WorkerHostResponse, { type: 'error' }> =>
        response.type === 'error'
    )
    expect(error.code).toBe('INVALID_FRAME')
    expect(error.messageId).toBeNull()
  })
})
