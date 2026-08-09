// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type {
  AgentRuntimeStatus,
  WorkspaceRuntimeStatus,
  WorkspaceSummary
} from '@canvas-agent/contracts'
import type { WorkspaceLifecycleClient } from '@/lib/workspace-client'
import { useWorkspaceRuntime } from './use-workspace-runtime'

const workspace: WorkspaceSummary = {
  identity: 'a'.repeat(64),
  repositoryName: 'canvas-agent',
  displayPath: '/repo/canvas-agent'
}

const closedStatus: WorkspaceRuntimeStatus = {
  state: 'CLOSED',
  activeWorkspace: null,
  lastError: null
}

const readyStatus: WorkspaceRuntimeStatus = {
  state: 'READY',
  activeWorkspace: workspace,
  lastError: null
}

const agentReady: AgentRuntimeStatus = {
  provider: 'codex-cli',
  state: 'READY',
  version: 'codex-cli 0.146.0',
  source: 'KNOWN_LOCATION',
  displayPath: '/opt/homebrew/bin/codex',
  lastError: null
}

function lifecycleClient(
  overrides: Partial<WorkspaceLifecycleClient> = {}
): WorkspaceLifecycleClient {
  return {
    getWorkspaceStatus: vi.fn(async () => closedStatus),
    chooseRepository: vi.fn(async () => ({ cancelled: true, status: closedStatus })),
    reopenLast: vi.fn(async () => closedStatus),
    closeWorkspace: vi.fn(async () => closedStatus),
    getAgentStatus: vi.fn(async () => agentReady),
    chooseAgentExecutable: vi.fn(async () => ({ cancelled: true, status: agentReady })),
    clearAgentExecutable: vi.fn(async () => agentReady),
    ...overrides
  }
}

describe('useWorkspaceRuntime', () => {
  it.each<[WorkspaceRuntimeStatus, 'OPENING' | 'CLOSING' | 'INVALID' | 'SWITCH_BLOCKED']>([
    [{ state: 'OPENING', activeWorkspace: null, lastError: null }, 'OPENING'],
    [{ state: 'CLOSING', activeWorkspace: workspace, lastError: null }, 'CLOSING'],
    [
      {
        state: 'ERROR',
        activeWorkspace: null,
        lastError: {
          reasonCode: 'NOT_GIT_WORKTREE',
          message: 'The selected folder is not a Git worktree.',
          recoverable: true
        }
      },
      'INVALID'
    ],
    [
      {
        state: 'READY',
        activeWorkspace: workspace,
        lastError: {
          reasonCode: 'ACTIVE_RUN_BLOCKS_SWITCH',
          message: 'An active Run blocks workspace switching.',
          recoverable: true
        }
      },
      'SWITCH_BLOCKED'
    ]
  ])('maps typed workspace status %s to the %s lifecycle phase', async (status, phase) => {
    const client = lifecycleClient({ getWorkspaceStatus: vi.fn(async () => status) })
    const { result } = renderHook(() => useWorkspaceRuntime(client))

    await waitFor(() => expect(result.current.state.phase).toBe(phase))
  })

  it('boots from typed workspace and Agent status without project commands', async () => {
    const agentNotFound: AgentRuntimeStatus = {
      provider: 'codex-cli',
      state: 'NOT_FOUND',
      version: null,
      source: null,
      displayPath: null,
      lastError: { reasonCode: 'EXECUTABLE_NOT_FOUND', recoverable: true }
    }
    const client = lifecycleClient({
      getWorkspaceStatus: vi.fn(async () => closedStatus),
      getAgentStatus: vi.fn(async () => agentNotFound)
    })
    const { result } = renderHook(() => useWorkspaceRuntime(client))

    await waitFor(() => expect(result.current.state.phase).toBe('NO_WORKSPACE'))
    expect(result.current.state.agentPhase).toBe('NOT_FOUND')
    expect(result.current.activeWorkspace).toBeNull()
    expect(result.current.projectCommandsDisabled).toBe(true)
  })

  it('blocks lifecycle actions until the initial status resolution completes', async () => {
    let resolveStatus: ((status: WorkspaceRuntimeStatus) => void) | null = null
    const chooseRepository = vi.fn(async () => ({ cancelled: true, status: closedStatus }))
    const client = lifecycleClient({
      getWorkspaceStatus: vi.fn(
        () =>
          new Promise<WorkspaceRuntimeStatus>((resolve) => {
            resolveStatus = resolve
          })
      ),
      chooseRepository
    })
    const { result } = renderHook(() => useWorkspaceRuntime(client))

    expect(result.current.state.phase).toBe('BOOTING')
    await act(async () => result.current.chooseRepository())
    expect(chooseRepository).not.toHaveBeenCalled()

    act(() => resolveStatus?.(closedStatus))
    await waitFor(() => expect(result.current.state.phase).toBe('NO_WORKSPACE'))
  })

  it('surfaces initial bridge failure as unavailable and supports status retry', async () => {
    const getWorkspaceStatus = vi
      .fn<WorkspaceLifecycleClient['getWorkspaceStatus']>()
      .mockRejectedValueOnce(new Error('bridge unavailable'))
      .mockResolvedValueOnce(closedStatus)
    const client = lifecycleClient({ getWorkspaceStatus })
    const { result } = renderHook(() => useWorkspaceRuntime(client))

    await waitFor(() => expect(result.current.state.phase).toBe('UNAVAILABLE'))
    expect(result.current.recoverableError).toBe('bridge unavailable')

    await act(async () => result.current.refresh())
    expect(result.current.state.phase).toBe('NO_WORKSPACE')
  })

  it('serializes picker actions and restores READY byte-for-byte after cancel', async () => {
    let resolveChoose:
      ((value: { cancelled: boolean; status: WorkspaceRuntimeStatus }) => void) | null = null
    const choose = vi.fn(
      () =>
        new Promise<{ cancelled: boolean; status: WorkspaceRuntimeStatus }>((resolve) => {
          resolveChoose = resolve
        })
    )
    const client = lifecycleClient({
      getWorkspaceStatus: vi.fn(async () => readyStatus),
      chooseRepository: choose
    })
    const { result } = renderHook(() => useWorkspaceRuntime(client))
    await waitFor(() => expect(result.current.state.phase).toBe('READY'))

    let first: Promise<void> | null = null
    act(() => {
      first = result.current.chooseRepository()
    })
    expect(result.current.state.phase).toBe('CHOOSING')

    await act(async () => {
      const repeated = result.current.chooseRepository()
      await repeated
      resolveChoose?.({ cancelled: true, status: readyStatus })
      await first
    })

    expect(choose).toHaveBeenCalledTimes(1)
    expect(result.current.state.phase).toBe('READY')
    expect(result.current.state.status).toEqual(readyStatus)
    expect(result.current.recoverableError).toBeNull()
  })

  it('preserves the prior READY identity and exposes a failed switch separately', async () => {
    const failedSwitch: WorkspaceRuntimeStatus = {
      state: 'READY',
      activeWorkspace: workspace,
      lastError: {
        reasonCode: 'NOT_GIT_WORKTREE',
        message: 'The selected folder is not a Git worktree.',
        recoverable: true
      }
    }
    const client = lifecycleClient({
      getWorkspaceStatus: vi.fn(async () => readyStatus),
      chooseRepository: vi.fn(async () => ({ cancelled: false, status: failedSwitch }))
    })
    const { result } = renderHook(() => useWorkspaceRuntime(client))
    await waitFor(() => expect(result.current.state.phase).toBe('READY'))

    await act(async () => result.current.chooseRepository())

    expect(result.current.activeWorkspace?.identity).toBe(workspace.identity)
    expect(result.current.state.lastReadyStatus).toEqual(readyStatus)
    expect(result.current.recoverableError).toBe('The selected folder is not a Git worktree.')

    act(() => result.current.dismissError())
    expect(result.current.recoverableError).toBeNull()
  })

  it('clears the active identity only after a successful close', async () => {
    let resolveClose: ((status: WorkspaceRuntimeStatus) => void) | null = null
    const client = lifecycleClient({
      getWorkspaceStatus: vi.fn(async () => readyStatus),
      closeWorkspace: vi.fn(
        () =>
          new Promise<WorkspaceRuntimeStatus>((resolve) => {
            resolveClose = resolve
          })
      )
    })
    const { result } = renderHook(() => useWorkspaceRuntime(client))
    await waitFor(() => expect(result.current.activeWorkspace).toEqual(workspace))

    let closing: Promise<void> | null = null
    act(() => {
      closing = result.current.closeWorkspace()
    })
    expect(result.current.state.phase).toBe('CLOSING')

    await act(async () => {
      resolveClose?.(closedStatus)
      await closing
    })

    expect(result.current.state.phase).toBe('NO_WORKSPACE')
    expect(result.current.activeWorkspace).toBeNull()
  })

  it('keeps the prior READY view when the lifecycle transport fails', async () => {
    const client = lifecycleClient({
      getWorkspaceStatus: vi.fn(async () => readyStatus),
      chooseRepository: vi.fn(async () => {
        throw new Error('bridge interrupted')
      })
    })
    const { result } = renderHook(() => useWorkspaceRuntime(client))
    await waitFor(() => expect(result.current.state.phase).toBe('READY'))

    await act(async () => result.current.chooseRepository())

    expect(result.current.state.phase).toBe('READY')
    expect(result.current.activeWorkspace).toEqual(workspace)
    expect(result.current.recoverableError).toBe('bridge interrupted')
  })

  it('enters read-only inspection while dirty and disables Project mutations and execution', async () => {
    const client = lifecycleClient({ getWorkspaceStatus: vi.fn(async () => readyStatus) })
    const { result } = renderHook(() => useWorkspaceRuntime(client))
    await waitFor(() => expect(result.current.state.phase).toBe('READY'))

    act(() => result.current.setRepositoryReadOnly(true))

    expect(result.current.state.phase).toBe('READ_ONLY')
    expect(result.current.activeWorkspace).toEqual(workspace)
    expect(result.current.projectCommandsDisabled).toBe(true)
    expect(result.current.executionCommandsDisabled).toBe(true)
  })

  it('serializes status refresh against workspace lifecycle actions', async () => {
    let resolveWorkspaceRefresh: ((status: WorkspaceRuntimeStatus) => void) | null = null
    let resolveAgentRefresh: ((status: AgentRuntimeStatus) => void) | null = null
    const getWorkspaceStatus = vi
      .fn<WorkspaceLifecycleClient['getWorkspaceStatus']>()
      .mockResolvedValueOnce(readyStatus)
      .mockImplementationOnce(
        () =>
          new Promise<WorkspaceRuntimeStatus>((resolve) => {
            resolveWorkspaceRefresh = resolve
          })
      )
    const getAgentStatus = vi
      .fn<WorkspaceLifecycleClient['getAgentStatus']>()
      .mockResolvedValueOnce(agentReady)
      .mockImplementationOnce(
        () =>
          new Promise<AgentRuntimeStatus>((resolve) => {
            resolveAgentRefresh = resolve
          })
      )
    const chooseRepository = vi.fn(async () => ({ cancelled: true, status: readyStatus }))
    const client = lifecycleClient({
      getWorkspaceStatus,
      getAgentStatus,
      chooseRepository
    })
    const { result } = renderHook(() => useWorkspaceRuntime(client))
    await waitFor(() => expect(result.current.state.phase).toBe('READY'))

    await act(async () => {
      const refreshing = result.current.refresh()
      await result.current.chooseRepository()
      resolveWorkspaceRefresh?.(readyStatus)
      resolveAgentRefresh?.(agentReady)
      await refreshing
    })

    expect(chooseRepository).not.toHaveBeenCalled()
    expect(result.current.state.phase).toBe('READY')
  })

  it('uses typed Agent chooser status and keeps callbacks blocked during workspace transitions', async () => {
    let resolveReopen: ((status: WorkspaceRuntimeStatus) => void) | null = null
    const chooseAgent = vi.fn(async () => ({ cancelled: false, status: agentReady }))
    const client = lifecycleClient({
      reopenLast: vi.fn(
        () =>
          new Promise<WorkspaceRuntimeStatus>((resolve) => {
            resolveReopen = resolve
          })
      ),
      chooseAgentExecutable: chooseAgent
    })
    const { result } = renderHook(() => useWorkspaceRuntime(client))
    await waitFor(() => expect(result.current.state.phase).toBe('NO_WORKSPACE'))

    let reopening: Promise<void> | null = null
    act(() => {
      reopening = result.current.reopenLast()
    })
    expect(result.current.state.phase).toBe('REOPENING')

    await act(async () => {
      await result.current.chooseAgentExecutable()
      resolveReopen?.(closedStatus)
      await reopening
    })

    expect(chooseAgent).not.toHaveBeenCalled()

    await act(async () => result.current.chooseAgentExecutable())
    expect(chooseAgent).toHaveBeenCalledTimes(1)
    expect(result.current.state.agentPhase).toBe('READY')
  })

  it('keeps workspace callbacks blocked while an Agent configuration change is pending', async () => {
    let resolveAgent: ((value: { cancelled: boolean; status: AgentRuntimeStatus }) => void) | null =
      null
    const chooseAgent = vi.fn(
      () =>
        new Promise<{ cancelled: boolean; status: AgentRuntimeStatus }>((resolve) => {
          resolveAgent = resolve
        })
    )
    const chooseRepository = vi.fn(async () => ({ cancelled: true, status: readyStatus }))
    const client = lifecycleClient({
      getWorkspaceStatus: vi.fn(async () => readyStatus),
      chooseAgentExecutable: chooseAgent,
      chooseRepository
    })
    const { result } = renderHook(() => useWorkspaceRuntime(client))
    await waitFor(() => expect(result.current.state.phase).toBe('READY'))

    await act(async () => {
      const configuring = result.current.chooseAgentExecutable()
      await result.current.chooseRepository()
      resolveAgent?.({ cancelled: false, status: agentReady })
      await configuring
    })

    expect(chooseAgent).toHaveBeenCalledTimes(1)
    expect(chooseRepository).not.toHaveBeenCalled()
    expect(result.current.state.phase).toBe('READY')
  })
})
