import { describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceClient,
  createWorkspaceLifecycleClient,
  WorkspaceError,
  type CommandRequest,
  type CommandTransport,
  type WorkspaceClient
} from './workspace-client'

describe('WorkspaceClient', () => {
  it('returns data for a correlated ok response', async () => {
    const transport = {
      command: vi.fn(async (request: CommandRequest) => ({
        requestId: request.requestId,
        schemaVersion: 1 as const,
        command: request.command,
        ok: true as const,
        data: []
      }))
    }
    const client = createWorkspaceClient(transport)

    await expect(client.command('project.list', {})).resolves.toEqual([])
    const request = transport.command.mock.calls[0]?.[0]
    expect(request?.requestId).toEqual(expect.any(String))
    expect(request?.schemaVersion).toBe(1)
    expect(request?.command).toBe('project.list')
  })

  it('maps ok:false to WorkspaceError without exposing transport details', async () => {
    const transport = {
      command: vi.fn(async (request: CommandRequest) => ({
        requestId: request.requestId,
        schemaVersion: 1 as const,
        command: request.command,
        ok: false as const,
        error: {
          name: 'ConcurrencyError' as const,
          message: 'NodeDraft changed',
          details: { serverRevision: 6 }
        }
      }))
    }
    const client = createWorkspaceClient(transport)

    await expect(
      client.command('nodeDraft.upsert', { nodeId: 'node-1', title: 'A', body: 'B' })
    ).rejects.toMatchObject({
      name: 'ConcurrencyError',
      details: { serverRevision: 6 }
    })
  })

  it('rejects request and command correlation mismatches', async () => {
    const requestMismatch = createWorkspaceClient({
      command: vi.fn(async (request: CommandRequest) => ({
        requestId: `${request.requestId}-other`,
        schemaVersion: 1 as const,
        command: request.command,
        ok: true as const,
        data: []
      }))
    })
    await expect(requestMismatch.command('project.list', {})).rejects.toMatchObject({
      name: 'InternalError'
    })

    const commandMismatch = createWorkspaceClient({
      command: vi.fn(async (request: CommandRequest) => ({
        requestId: request.requestId,
        schemaVersion: 1 as const,
        command: 'project.state' as const,
        ok: true as const,
        data: []
      }))
    })
    await expect(commandMismatch.command('project.list', {})).rejects.toMatchObject({
      name: 'InternalError'
    })
  })

  it('preserves WorkspaceError instances from a transport', async () => {
    const transportError = new WorkspaceError('HostUnavailableError', 'bridge unavailable')
    const client = createWorkspaceClient({
      command: vi.fn(async () => {
        throw transportError
      })
    })

    await expect(client.command('project.list', {})).rejects.toBe(transportError)
  })

  it('fails closed when the production bridge is unavailable', async () => {
    const client = createWorkspaceClient()

    await expect(client.command('project.list', {})).rejects.toMatchObject({
      name: 'HostUnavailableError'
    })
  })

  it('keeps execution.dispatch payload opaque and minimal', async () => {
    const transport = {
      command: vi.fn(async (request: CommandRequest) => ({
        requestId: request.requestId,
        schemaVersion: 1 as const,
        command: request.command,
        ok: true as const,
        data: {
          runId: 'run_1',
          executionRequestId: 'execution-1',
          result: { outcome: 'SUCCEEDED' as const, claimGranted: true }
        }
      }))
    }
    const client = createWorkspaceClient(transport as unknown as CommandTransport)

    await client.command('execution.dispatch', {
      executionRequestId: 'execution-1',
      contextSnapshotId: 'snapshot-1'
    })

    expect(transport.command.mock.calls[0]?.[0].payload).toEqual({
      executionRequestId: 'execution-1',
      contextSnapshotId: 'snapshot-1'
    })
  })

  it('keeps workspace and Agent lifecycle commands path-free', async () => {
    const commands: Array<{ readonly command: string; readonly payload: unknown }> = []
    const recordingClient: WorkspaceClient = {
      async command(command, payload) {
        commands.push({ command, payload })
        throw new Error('recorded')
      }
    }
    const lifecycle = createWorkspaceLifecycleClient(recordingClient)

    await Promise.allSettled([
      lifecycle.getWorkspaceStatus(),
      lifecycle.chooseRepository(),
      lifecycle.reopenLast(),
      lifecycle.closeWorkspace(),
      lifecycle.getAgentStatus(),
      lifecycle.chooseAgentExecutable(),
      lifecycle.clearAgentExecutable()
    ])

    expect(commands).toEqual([
      { command: 'workspace.status', payload: {} },
      { command: 'workspace.chooseRepository', payload: {} },
      { command: 'workspace.reopenLast', payload: {} },
      { command: 'workspace.close', payload: {} },
      { command: 'agent.status', payload: {} },
      { command: 'agent.chooseExecutable', payload: {} },
      { command: 'agent.clearExecutable', payload: {} }
    ])
  })
})
