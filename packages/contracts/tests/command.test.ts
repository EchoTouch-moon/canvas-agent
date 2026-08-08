import { describe, expect, it } from 'vitest'
import {
  commandErrorSchema,
  commandRequestSchema,
  commandResponseSchemas,
  type CommandRequest,
  type CommandResponse
} from '../src'

const COMMIT = 'b'.repeat(40)

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
          items: [{ itemType: 'NODE_VERSION' }]
        })
      )
    ).toThrow()
    expect(() =>
      commandRequestSchema.parse(
        request('snapshot.freeze', {
          projectId: 'p',
          taskId: 't',
          taskSpecVersionId: 's',
          baseBaselineId: 'b',
          expectedRepositoryRevisionId: 'r',
          selections: [{ source: { kind: 'NODE_VERSION', nodeVersionId: 'nv_1' } }]
        })
      )
    ).not.toThrow()
    expect(() =>
      commandRequestSchema.parse(
        request('snapshot.freeze', {
          projectId: 'p',
          taskId: 't',
          taskSpecVersionId: 's',
          baseBaselineId: 'b',
          expectedRepositoryRevisionId: 'r',
          selections: [{ source: { kind: 'TASK_SPEC_VERSION', taskSpecVersionId: 's' } }]
        })
      )
    ).toThrow()
  })

  it('validates context.resolve payloads with a full SourceReference union', () => {
    const resolve = commandRequestSchema.parse(
      request('context.resolve', {
        projectId: 'p',
        taskId: 't',
        taskSpecVersionId: 's',
        baseBaselineId: 'b',
        expectedRepositoryRevisionId: 'r',
        selections: [
          { kind: 'TASK_SPEC_VERSION', taskSpecVersionId: 's' },
          { kind: 'NODE_VERSION', nodeVersionId: 'nv_1' },
          { kind: 'REPOSITORY_CONTENT', path: 'README.md' }
        ]
      })
    ) as CommandRequest<'context.resolve'>
    expect(resolve.payload.selections).toHaveLength(3)
    expect(() =>
      commandRequestSchema.parse(
        request('context.resolve', {
          projectId: 'p',
          taskId: 't',
          taskSpecVersionId: 's',
          baseBaselineId: 'b',
          expectedRepositoryRevisionId: 'r',
          selections: [{ kind: 'REPOSITORY_CONTENT', path: '../secret' }]
        })
      )
    ).toThrow()
  })

  it('validates execution.dispatch and execution.cancel payloads', () => {
    const dispatch = commandRequestSchema.parse(
      request('execution.dispatch', {
        executionRequestId: 'req_01',
        contextSnapshotId: 'snap_01'
      })
    ) as CommandRequest<'execution.dispatch'>
    expect(dispatch.command).toBe('execution.dispatch')
    expect(dispatch.payload).toEqual({
      executionRequestId: 'req_01',
      contextSnapshotId: 'snap_01'
    })

    expect(() =>
      commandRequestSchema.parse(
        request('execution.dispatch', { executionRequestId: 'req_01' })
      )
    ).toThrow()

    const cancel = commandRequestSchema.parse(
      request('execution.cancel', { executionRequestId: 'req_01' })
    ) as CommandRequest<'execution.cancel'>
    expect(cancel.payload).toEqual({ executionRequestId: 'req_01' })
  })

  it('validates project.list and project.state payloads', () => {
    const list = commandRequestSchema.parse(request('project.list', {})) as CommandRequest<
      'project.list'
    >
    expect(list.payload).toEqual({})

    const state = commandRequestSchema.parse(
      request('project.state', { projectId: 'proj_1' })
    ) as CommandRequest<'project.state'>
    expect(state.payload).toEqual({ projectId: 'proj_1' })
  })

  it('rejects worker.dispatch / worker.cancel as renderer commands', () => {
    expect(() => commandRequestSchema.parse(request('worker.dispatch', {}))).toThrow()
    expect(() =>
      commandRequestSchema.parse(request('worker.cancel', { executionRequestId: 'x' }))
    ).toThrow()
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
      command: 'execution.dispatch',
      data: {
        runId: 'run_1',
        executionRequestId: 'exec-1',
        result: {
          outcome: 'REVISION_MISMATCH',
          claimGranted: true,
          revisionMismatch: { field: 'baseCommit', expected: COMMIT, actual: 'c'.repeat(40) }
        }
      }
    }
    const parsed = commandResponseSchemas['execution.dispatch'].parse(
      response
    ) as Extract<CommandResponse<'execution.dispatch'>, { ok: true }>
    expect(parsed.ok).toBe(true)
    expect(parsed.data.runId).toBe('run_1')
    expect(parsed.data.result.outcome).toBe('REVISION_MISMATCH')
  })

  it('reports command failures separately as ok:false', () => {
    const response = {
      requestId: 'req_t',
      schemaVersion: 1,
      ok: false,
      command: 'nodeDraft.upsert',      error: { name: 'ConcurrencyError', message: 'stale revision' }
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

  it('validates a full project.state projection', () => {
    const now = '2026-08-07T00:00:00.000Z'
    const project = {
      id: 'proj_1',
      name: 'MUSICDB',
      description: null,
      createdAt: now,
      updatedAt: now
    }
    const response = {
      requestId: 'req_t',
      schemaVersion: 1,
      ok: true,
      command: 'project.state',
      data: {
        project,
        nodes: [],
        nodeDrafts: [],
        nodeVersions: [],
        edges: [],
        tasks: [],
        taskSpecs: [],
        baselines: [],
        activeBaseline: null
      }
    }
    const parsed = commandResponseSchemas['project.state'].parse(
      response
    ) as Extract<CommandResponse<'project.state'>, { ok: true }>
    expect(parsed.data.project.id).toBe('proj_1')
    expect(parsed.data.activeBaseline).toBeNull()

    const bad = { ...response, data: { ...response.data, project: null } }
    expect(() => commandResponseSchemas['project.state'].parse(bad)).toThrow()
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

describe('executionRequestId and run commands', () => {
  it('rejects path-unsafe execution request ids at the schema boundary', () => {
    for (const id of ['', '.', '..', 'a/b', 'a\\b', 'a b', 'a%20b', 'a'.repeat(129)]) {
      expect(() =>
        commandRequestSchema.parse(
          request('execution.dispatch', { executionRequestId: id, contextSnapshotId: 'snap_1' })
        )
      ).toThrow()
    }
    expect(() =>
      commandRequestSchema.parse(
        request('execution.dispatch', { executionRequestId: 'exec_1', contextSnapshotId: 'snap_1' })
      )
    ).not.toThrow()
  })

  it('validates run.list and run.get payloads', () => {
    const list = commandRequestSchema.parse(
      request('run.list', { projectId: 'proj_1' })
    ) as CommandRequest<'run.list'>
    expect(list.command).toBe('run.list')

    const get = commandRequestSchema.parse(
      request('run.get', { runId: 'run_1' })
    ) as CommandRequest<'run.get'>
    expect(get.command).toBe('run.get')
  })
})
