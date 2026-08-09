import { describe, expect, it } from 'vitest'
import type {
  AgentRuntimeState,
  AgentRuntimeStatus,
  WorkspaceErrorReason,
  WorkspaceRuntimeStatus
} from '@canvas-agent/contracts'
import {
  areExecutionCommandsDisabled,
  areProjectCommandsDisabled,
  areWorkspaceActionsDisabled,
  canStartWorkspaceOperation,
  createInitialWorkspaceRuntimeState,
  isWorkspaceBusy,
  shouldClearWorkspaceData,
  workspaceRuntimeReducer,
  type WorkspaceRuntimePhase,
  type WorkspaceRuntimeState
} from './workspace-runtime-reducer'

function workspaceStatus(
  state: WorkspaceRuntimeStatus['state'],
  identity: string | null = null,
  reasonCode: WorkspaceErrorReason | null = null
): WorkspaceRuntimeStatus {
  return {
    state,
    activeWorkspace:
      identity === null
        ? null
        : {
            identity,
            repositoryName: `repo-${identity}`,
            displayPath: `/repos/${identity}`
          },
    lastError:
      reasonCode === null
        ? null
        : { reasonCode, message: `Workspace ${reasonCode}`, recoverable: true }
  }
}

function agentStatus(state: AgentRuntimeState): AgentRuntimeStatus {
  const ready = state === 'READY'
  return {
    provider: 'codex-cli',
    state,
    version: ready ? '1.0.0' : null,
    source: ready ? 'KNOWN_LOCATION' : null,
    displayPath: ready ? '/usr/local/bin/codex' : null,
    lastError: ready ? null : { reasonCode: 'UNKNOWN', recoverable: true }
  }
}

function reduce(
  state: WorkspaceRuntimeState,
  action: Parameters<typeof workspaceRuntimeReducer>[1]
): WorkspaceRuntimeState {
  return workspaceRuntimeReducer(state, action)
}

describe('workspace runtime reducer', () => {
  it.each<[WorkspaceRuntimePhase, WorkspaceRuntimeState]>([
    ['BOOTING', createInitialWorkspaceRuntimeState()],
    [
      'NO_WORKSPACE',
      reduce(createInitialWorkspaceRuntimeState(), {
        type: 'WORKSPACE_STATUS_RECEIVED',
        status: workspaceStatus('CLOSED')
      })
    ],
    [
      'CHOOSING',
      reduce(
        reduce(createInitialWorkspaceRuntimeState(), {
          type: 'WORKSPACE_STATUS_RECEIVED',
          status: workspaceStatus('CLOSED')
        }),
        { type: 'PICKER_STARTED' }
      )
    ],
    [
      'OPENING',
      reduce(
        reduce(createInitialWorkspaceRuntimeState(), {
          type: 'WORKSPACE_STATUS_RECEIVED',
          status: workspaceStatus('CLOSED')
        }),
        { type: 'OPEN_STARTED' }
      )
    ],
    [
      'REOPENING',
      reduce(
        reduce(createInitialWorkspaceRuntimeState(), {
          type: 'WORKSPACE_STATUS_RECEIVED',
          status: workspaceStatus('CLOSED')
        }),
        { type: 'REOPEN_STARTED' }
      )
    ],
    [
      'READY',
      reduce(createInitialWorkspaceRuntimeState(), {
        type: 'WORKSPACE_STATUS_RECEIVED',
        status: workspaceStatus('READY', 'workspace-a')
      })
    ],
    [
      'SWITCH_BLOCKED',
      reduce(createInitialWorkspaceRuntimeState(), {
        type: 'WORKSPACE_STATUS_RECEIVED',
        status: workspaceStatus('READY', 'workspace-a', 'ACTIVE_RUN_BLOCKS_SWITCH')
      })
    ],
    [
      'INVALID',
      reduce(createInitialWorkspaceRuntimeState(), {
        type: 'WORKSPACE_STATUS_RECEIVED',
        status: workspaceStatus('ERROR', null, 'NOT_GIT_WORKTREE')
      })
    ],
    [
      'CLOSING',
      reduce(
        reduce(createInitialWorkspaceRuntimeState(), {
          type: 'WORKSPACE_STATUS_RECEIVED',
          status: workspaceStatus('READY', 'workspace-a')
        }),
        { type: 'CLOSE_STARTED' }
      )
    ],
    [
      'UNAVAILABLE',
      reduce(createInitialWorkspaceRuntimeState(), {
        type: 'WORKSPACE_UNAVAILABLE',
        message: 'Bridge unavailable'
      })
    ],
    [
      'READ_ONLY',
      reduce(
        reduce(createInitialWorkspaceRuntimeState(), {
          type: 'WORKSPACE_STATUS_RECEIVED',
          status: workspaceStatus('READY', 'workspace-a')
        }),
        { type: 'WORKSPACE_READ_ONLY' }
      )
    ]
  ])('models the %s workspace phase', (phase, state) => {
    expect(state.phase).toBe(phase)
  })

  it.each<AgentRuntimeState>([
    'READY',
    'NOT_FOUND',
    'UNSUPPORTED_VERSION',
    'AUTH_REQUIRED',
    'INTERPRETER_MISSING',
    'ERROR'
  ])('models frozen agent runtime phase %s after checking', (phase) => {
    const checking = reduce(createInitialWorkspaceRuntimeState(), { type: 'AGENT_CHECK_STARTED' })
    expect(checking.agentPhase).toBe('CHECKING')

    const state = reduce(checking, { type: 'AGENT_STATUS_RECEIVED', status: agentStatus(phase) })
    expect(state.agentPhase).toBe(phase)
    expect(state.agentStatus?.state).toBe(phase)
  })

  it('retains the last successful READY view while a candidate switch fails', () => {
    const ready = workspaceStatus('READY', 'workspace-a')
    const initial = reduce(createInitialWorkspaceRuntimeState(), {
      type: 'WORKSPACE_STATUS_RECEIVED',
      status: ready
    })
    const failedSwitch = workspaceStatus('READY', 'workspace-a', 'NOT_GIT_WORKTREE')
    const state = reduce(initial, { type: 'WORKSPACE_STATUS_RECEIVED', status: failedSwitch })

    expect(state.phase).toBe('READY')
    expect(state.status).toEqual(failedSwitch)
    expect(state.lastReadyStatus).toEqual(ready)
    expect(shouldClearWorkspaceData(initial.status, failedSwitch)).toBe(false)
  })

  it('restores the prior stable state with no error when the repository picker is cancelled', () => {
    const ready = workspaceStatus('READY', 'workspace-a')
    const initial = reduce(createInitialWorkspaceRuntimeState(), {
      type: 'WORKSPACE_STATUS_RECEIVED',
      status: ready
    })
    const choosing = reduce(initial, { type: 'PICKER_STARTED' })
    const cancelled = reduce(choosing, { type: 'PICKER_CANCELLED' })

    expect(cancelled.phase).toBe('READY')
    expect(cancelled.status).toEqual(ready)
    expect(cancelled.status?.lastError).toBeNull()
    expect(cancelled.pickerReturn).toBeNull()
  })

  it('returns a cancelled first-open picker to no-workspace without an error', () => {
    const closed = reduce(createInitialWorkspaceRuntimeState(), {
      type: 'WORKSPACE_STATUS_RECEIVED',
      status: workspaceStatus('CLOSED')
    })
    const choosing = reduce(closed, { type: 'PICKER_STARTED' })
    const cancelled = reduce(choosing, { type: 'PICKER_CANCELLED' })

    expect(cancelled.phase).toBe('NO_WORKSPACE')
    expect(cancelled.status).toBeNull()
  })

  it('exposes busy and disabled selectors and ignores repeat lifecycle starts', () => {
    const booting = createInitialWorkspaceRuntimeState()
    const closed = reduce(booting, {
      type: 'WORKSPACE_STATUS_RECEIVED',
      status: workspaceStatus('CLOSED')
    })
    const opening = reduce(closed, { type: 'OPEN_STARTED' })

    expect(canStartWorkspaceOperation(booting)).toBe(false)
    expect(reduce(booting, { type: 'PICKER_STARTED' })).toBe(booting)
    expect(isWorkspaceBusy(opening)).toBe(true)
    expect(canStartWorkspaceOperation(opening)).toBe(false)
    expect(areWorkspaceActionsDisabled(opening)).toBe(true)
    expect(reduce(opening, { type: 'CLOSE_STARTED' })).toBe(opening)
    expect(areProjectCommandsDisabled(opening)).toBe(true)
    expect(areExecutionCommandsDisabled(opening)).toBe(true)
  })

  it('clears project data only after successful close or a switch to another identity', () => {
    const workspaceA = workspaceStatus('READY', 'workspace-a')
    const workspaceB = workspaceStatus('READY', 'workspace-b')
    const closed = workspaceStatus('CLOSED')
    const candidateFailure = workspaceStatus('READY', 'workspace-a', 'PATH_UNREADABLE')

    expect(shouldClearWorkspaceData(workspaceA, candidateFailure)).toBe(false)
    expect(shouldClearWorkspaceData(workspaceA, workspaceB)).toBe(true)
    expect(shouldClearWorkspaceData(workspaceA, closed)).toBe(true)
    expect(shouldClearWorkspaceData(null, workspaceB)).toBe(false)
  })

  it('requires both READY workspace and agent before enabling execution commands', () => {
    const workspaceReady = reduce(createInitialWorkspaceRuntimeState(), {
      type: 'WORKSPACE_STATUS_RECEIVED',
      status: workspaceStatus('READY', 'workspace-a')
    })
    expect(areProjectCommandsDisabled(workspaceReady)).toBe(false)
    expect(areExecutionCommandsDisabled(workspaceReady)).toBe(true)

    const ready = reduce(workspaceReady, {
      type: 'AGENT_STATUS_RECEIVED',
      status: agentStatus('READY')
    })
    expect(areExecutionCommandsDisabled(ready)).toBe(false)
  })

  it('keeps inspection and lifecycle actions available for read-only or blocked workspaces', () => {
    const ready = reduce(createInitialWorkspaceRuntimeState(), {
      type: 'WORKSPACE_STATUS_RECEIVED',
      status: workspaceStatus('READY', 'workspace-a')
    })
    const readOnly = reduce(ready, { type: 'WORKSPACE_READ_ONLY' })
    const blocked = reduce(createInitialWorkspaceRuntimeState(), {
      type: 'WORKSPACE_STATUS_RECEIVED',
      status: workspaceStatus('READY', 'workspace-a', 'ACTIVE_RUN_BLOCKS_SWITCH')
    })

    expect(canStartWorkspaceOperation(readOnly)).toBe(true)
    expect(areProjectCommandsDisabled(readOnly)).toBe(true)
    expect(areExecutionCommandsDisabled(readOnly)).toBe(true)
    expect(canStartWorkspaceOperation(blocked)).toBe(true)
    expect(areProjectCommandsDisabled(blocked)).toBe(true)
    expect(areExecutionCommandsDisabled(blocked)).toBe(true)
  })
})
