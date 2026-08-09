import type {
  AgentRuntimeState,
  AgentRuntimeStatus,
  WorkspaceRuntimeStatus
} from '@canvas-agent/contracts'

export type WorkspaceRuntimePhase =
  | 'BOOTING'
  | 'NO_WORKSPACE'
  | 'CHOOSING'
  | 'OPENING'
  | 'REOPENING'
  | 'READY'
  | 'SWITCH_BLOCKED'
  | 'INVALID'
  | 'CLOSING'
  | 'UNAVAILABLE'
  | 'READ_ONLY'

export type AgentRuntimePhase = 'CHECKING' | AgentRuntimeState

interface PickerReturnState {
  readonly phase: 'NO_WORKSPACE' | 'READY'
  readonly status: WorkspaceRuntimeStatus | null
}

export interface WorkspaceRuntimeState {
  readonly phase: WorkspaceRuntimePhase
  readonly status: WorkspaceRuntimeStatus | null
  /** The last READY status that completed without a workspace operation error. */
  readonly lastReadyStatus: WorkspaceRuntimeStatus | null
  readonly agentPhase: AgentRuntimePhase
  readonly agentStatus: AgentRuntimeStatus | null
  readonly unavailableMessage: string | null
  readonly pickerReturn: PickerReturnState | null
}

export type WorkspaceRuntimeAction =
  | { readonly type: 'BOOTSTRAP_STARTED' }
  | { readonly type: 'WORKSPACE_STATUS_RECEIVED'; readonly status: WorkspaceRuntimeStatus }
  | { readonly type: 'PICKER_STARTED' }
  | { readonly type: 'PICKER_CANCELLED' }
  | { readonly type: 'OPEN_STARTED' }
  | { readonly type: 'REOPEN_STARTED' }
  | { readonly type: 'CLOSE_STARTED' }
  | { readonly type: 'WORKSPACE_UNAVAILABLE'; readonly message: string }
  | { readonly type: 'WORKSPACE_READ_ONLY' }
  | { readonly type: 'AGENT_CHECK_STARTED' }
  | { readonly type: 'AGENT_STATUS_RECEIVED'; readonly status: AgentRuntimeStatus }

export function createInitialWorkspaceRuntimeState(): WorkspaceRuntimeState {
  return {
    phase: 'BOOTING',
    status: null,
    lastReadyStatus: null,
    agentPhase: 'CHECKING',
    agentStatus: null,
    unavailableMessage: null,
    pickerReturn: null
  }
}

export function isWorkspaceBusy(state: WorkspaceRuntimeState): boolean {
  return (
    state.phase === 'CHOOSING' ||
    state.phase === 'OPENING' ||
    state.phase === 'REOPENING' ||
    state.phase === 'CLOSING'
  )
}

/** Whether a lifecycle action may start; callers use this to guard duplicate open/close requests. */
export function canStartWorkspaceOperation(state: WorkspaceRuntimeState): boolean {
  return (
    state.phase === 'NO_WORKSPACE' ||
    state.phase === 'READY' ||
    state.phase === 'SWITCH_BLOCKED' ||
    state.phase === 'INVALID' ||
    state.phase === 'READ_ONLY'
  )
}

export function areWorkspaceActionsDisabled(state: WorkspaceRuntimeState): boolean {
  return !canStartWorkspaceOperation(state)
}

export function areProjectCommandsDisabled(state: WorkspaceRuntimeState): boolean {
  return state.phase !== 'READY' || state.status?.activeWorkspace === null
}

export function areExecutionCommandsDisabled(state: WorkspaceRuntimeState): boolean {
  return (
    areProjectCommandsDisabled(state) || state.phase !== 'READY' || state.agentPhase !== 'READY'
  )
}

/**
 * Project data must be discarded only when the authoritative runtime no longer
 * identifies the same workspace. A failed candidate switch remains READY on
 * the prior identity and therefore returns false.
 */
export function shouldClearWorkspaceData(
  previous: WorkspaceRuntimeStatus | null,
  next: WorkspaceRuntimeStatus
): boolean {
  const previousIdentity = previous?.activeWorkspace?.identity ?? null
  const nextIdentity = next.activeWorkspace?.identity ?? null
  return previousIdentity !== null && previousIdentity !== nextIdentity
}

function phaseForStatus(
  status: WorkspaceRuntimeStatus,
  previousPhase: WorkspaceRuntimePhase
): WorkspaceRuntimePhase {
  switch (status.state) {
    case 'CLOSED':
      return 'NO_WORKSPACE'
    case 'OPENING':
      return previousPhase === 'REOPENING' ? 'REOPENING' : 'OPENING'
    case 'READY':
      return status.lastError?.reasonCode === 'ACTIVE_RUN_BLOCKS_SWITCH'
        ? 'SWITCH_BLOCKED'
        : 'READY'
    case 'CLOSING':
      return 'CLOSING'
    case 'ERROR':
      return 'INVALID'
  }
}

function pickerReturnState(state: WorkspaceRuntimeState): PickerReturnState {
  if (state.lastReadyStatus !== null) {
    return { phase: 'READY', status: state.lastReadyStatus }
  }
  return { phase: 'NO_WORKSPACE', status: null }
}

function startOperation(
  state: WorkspaceRuntimeState,
  phase: 'OPENING' | 'REOPENING' | 'CLOSING'
): WorkspaceRuntimeState {
  return canStartWorkspaceOperation(state)
    ? { ...state, phase, unavailableMessage: null, pickerReturn: null }
    : state
}

export function workspaceRuntimeReducer(
  state: WorkspaceRuntimeState,
  action: WorkspaceRuntimeAction
): WorkspaceRuntimeState {
  switch (action.type) {
    case 'BOOTSTRAP_STARTED':
      return { ...createInitialWorkspaceRuntimeState(), phase: 'BOOTING' }
    case 'WORKSPACE_STATUS_RECEIVED': {
      const nextPhase = phaseForStatus(action.status, state.phase)
      const isSuccessfulReady =
        action.status.state === 'READY' &&
        action.status.activeWorkspace !== null &&
        action.status.lastError === null
      return {
        ...state,
        phase: nextPhase,
        status: action.status,
        lastReadyStatus:
          action.status.state === 'CLOSED'
            ? null
            : isSuccessfulReady
              ? action.status
              : state.lastReadyStatus,
        unavailableMessage: null,
        pickerReturn: null
      }
    }
    case 'PICKER_STARTED':
      return canStartWorkspaceOperation(state)
        ? { ...state, phase: 'CHOOSING', pickerReturn: pickerReturnState(state) }
        : state
    case 'PICKER_CANCELLED':
      return state.phase === 'CHOOSING' && state.pickerReturn !== null
        ? {
            ...state,
            phase: state.pickerReturn.phase,
            status: state.pickerReturn.status,
            unavailableMessage: null,
            pickerReturn: null
          }
        : state
    case 'OPEN_STARTED':
      return startOperation(state, 'OPENING')
    case 'REOPEN_STARTED':
      return startOperation(state, 'REOPENING')
    case 'CLOSE_STARTED':
      return startOperation(state, 'CLOSING')
    case 'WORKSPACE_UNAVAILABLE':
      return {
        ...state,
        phase: 'UNAVAILABLE',
        unavailableMessage: action.message,
        pickerReturn: null
      }
    case 'WORKSPACE_READ_ONLY':
      return state.status?.activeWorkspace !== null
        ? { ...state, phase: 'READ_ONLY', pickerReturn: null }
        : state
    case 'AGENT_CHECK_STARTED':
      return { ...state, agentPhase: 'CHECKING', agentStatus: null }
    case 'AGENT_STATUS_RECEIVED':
      return { ...state, agentPhase: action.status.state, agentStatus: action.status }
  }
}
