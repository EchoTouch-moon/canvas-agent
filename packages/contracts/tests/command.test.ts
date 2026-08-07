import { describe, expect, it } from 'vitest'
import {
  commandErrorSchema,
  commandRequestSchema,
  commandResponseSchemas,
  type CommandRequest,
  type CommandResponse
} from '../src'

const HASH = 'a'.repeat(64)
const COMMIT = 'b'.repeat(40)

function workerPayload() {
  return {
    executionRequestId: 'req_01',
    runId: 'run_01',
    workerAttemptNumber: 1,
    taskSpecVersionId: 'spec_01',
    contextSnapshotId: 'snap_01',
    expectedRepositoryRevision: {
      baseCommit: COMMIT,
      treeHash: COMMIT,
      workingTreePatchHash: null
    },
    checkpointId: null,
    requiredCapabilities: ['git', 'node'],
    agentConfiguration: { provider: 'local-cli', model: 'configured' },
    toolPolicy: {
      allowedTools: ['read_file', 'write_file'],
      deniedPaths: ['.env'],
      allowNetwork: false,
      allowShell: true
    },
    workspaceStrategy: 'ISOLATED_WORKTREE',
    resourceBudget: {
      maxDurationMs: 900_000,
      maxToolCalls: 120,
      maxDiskBytes: 2_000_000_000
    },
    schemaVersion: 1,
    requestHash: HASH,
    expiresAt: '2099-01-01T00:00:00.000Z'
  }
}

function request(command: string, payload: unknown): CommandRequest {
  return { requestId: 'req_t', schemaVersion: 1, command: command as never, payload: payload as never }
}

describe('command envelope', () => {
  it('parses a valid command request', () => {
    const parsed = commandRequestSchema.parse(
      request('project.create', { name: 'MUSICDB', description: 'personal library' })
    ) as CommandRequest<'project.create'>
    expect(parsed.command).toBe('project.create')
    expect(parsed.payload.name).toBe('MUSICDB')
  })

  it('rejects unknown commands and extra fields', () => {
    expect(() => commandRequestSchema.parse(request('unknown.command', {}))).toThrow()
    expect(() =>
      commandRequestSchema.parse(request('project.create', { name: 'X', extra: true }))
    ).toThrow()
  })

  it('requires requestId and the pinned schemaVersion', () => {
    const { requestId: _requestId, ...noId } = request('project.create', { name: 'X' })
    expect(() => commandRequestSchema.parse(noId)).toThrow()
    expect(() =>
      commandRequestSchema.parse({ ...request('project.create', { name: 'X' }), schemaVersion: 2 })
    ).toThrow()
  })

  it('correlates the payload schema with the command', () => {
    expect(() => commandRequestSchema.parse(request('nodeDraft.upsert', { name: 'X' }))).toThrow()
    const draft = commandRequestSchema.parse(
      request('nodeDraft.upsert', { nodeId: 'node_1', title: 'Goal', expectedRevision: 3 })
    ) as CommandRequest<'nodeDraft.upsert'>
    expect(draft.payload).toEqual({ nodeId: 'node_1', title: 'Goal', expectedRevision: 3 })

    expect(() =>
      commandRequestSchema.parse(
        request('snapshot.freeze', {
          projectId: 'p',
          taskId: 't',
          taskSpecVersionId: 's',
          baseBaselineId: 'b',
          expectedRepositoryRevisionId: 'r',
          items: [{ itemType: 'NODE_VERSION', authority: 'NOT_AUTHORITY', tokenEstimate: 1, position: 0 }]
        })
      )
    ).toThrow()
  })

  it('validates worker.dispatch and worker.cancel payloads', () => {
    const dispatch = commandRequestSchema.parse(
      request('worker.dispatch', workerPayload())
    ) as CommandRequest<'worker.dispatch'>
    expect(dispatch.command).toBe('worker.dispatch')

    expect(() =>
      commandRequestSchema.parse(request('worker.dispatch', { ...workerPayload(), requestHash: 'zz' }))
    ).toThrow()

    const cancel = commandRequestSchema.parse(
      request('worker.cancel', { executionRequestId: 'req_01' })
    ) as CommandRequest<'worker.cancel'>
    expect(cancel.payload).toEqual({ executionRequestId: 'req_01' })
  })

  it('exposes revision.current but not revision.upsert to the renderer', () => {
    const current = commandRequestSchema.parse(
      request('revision.current', {})
    ) as CommandRequest<'revision.current'>
    expect(current.payload).toEqual({})

    expect(() =>
      commandRequestSchema.parse(
        request('revision.upsert', { baseCommit: COMMIT, treeHash: COMMIT })
      )
    ).toThrow()
  })
})

describe('command response correlation', () => {
  it('treats a dispatch outcome as data (ok), not a command error', () => {
    const response = {
      requestId: 'req_t',
      schemaVersion: 1,
      ok: true,
      command: 'worker.dispatch',
      data: {
        outcome: 'REVISION_MISMATCH',
        claimGranted: true,
        revisionMismatch: { field: 'baseCommit', expected: COMMIT, actual: 'c'.repeat(40) }
      }
    }
    const parsed = commandResponseSchemas['worker.dispatch'].parse(
      response
    ) as Extract<CommandResponse<'worker.dispatch'>, { ok: true }>
    expect(parsed.ok).toBe(true)
    expect(parsed.data.outcome).toBe('REVISION_MISMATCH')
  })

  it('reports command failures separately as ok:false', () => {
    const response = {
      requestId: 'req_t',
      schemaVersion: 1,
      ok: false,
      command: 'nodeDraft.upsert',
      error: { name: 'ConcurrencyError', message: 'stale revision' }
    }
    const parsed = commandResponseSchemas['nodeDraft.upsert'].parse(
      response
    ) as Extract<CommandResponse<'nodeDraft.upsert'>, { ok: false }>
    expect(parsed.ok).toBe(false)
    expect(parsed.error.name).toBe('ConcurrencyError')
  })

  it('validates per-command response data shapes', () => {
    const response = {
      requestId: 'req_t',
      schemaVersion: 1,
      ok: true,
      command: 'project.create',
      data: {
        id: 'proj_1',
        name: 'MUSICDB',
        description: null,
        createdAt: '2026-08-07T00:00:00.000Z',
        updatedAt: '2026-08-07T00:00:00.000Z'
      }
    }
    const parsed = commandResponseSchemas['project.create'].parse(
      response
    ) as Extract<CommandResponse<'project.create'>, { ok: true }>
    expect(parsed.data.id).toBe('proj_1')
  })

  it('rejects response data that does not match the command', () => {
    expect(() =>
      commandResponseSchemas['project.create'].parse({
        requestId: 'req_t',
        schemaVersion: 1,
        ok: true,
        command: 'project.create',
        data: { id: 'proj_1', name: 'X' }
      })
    ).toThrow()
  })
})

describe('command error schema', () => {
  it('accepts only the command-failure names', () => {
    expect(() =>
      commandErrorSchema.parse({ name: 'HostUnavailableError', message: 'worker down' })
    ).not.toThrow()
    expect(() => commandErrorSchema.parse({ name: 'REVISION_MISMATCH', message: 'x' })).toThrow()
  })
})
