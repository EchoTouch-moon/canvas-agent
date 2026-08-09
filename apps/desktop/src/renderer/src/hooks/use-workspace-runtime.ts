import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { AgentRuntimeStatus, WorkspaceRuntimeStatus } from '@canvas-agent/contracts'
import {
  createWorkspaceLifecycleClient,
  type WorkspaceLifecycleClient
} from '@/lib/workspace-client'
import {
  areExecutionCommandsDisabled,
  areProjectCommandsDisabled,
  areWorkspaceActionsDisabled,
  canStartWorkspaceOperation,
  createInitialWorkspaceRuntimeState,
  isWorkspaceBusy,
  workspaceRuntimeReducer,
  type WorkspaceRuntimeAction,
  type WorkspaceRuntimeState
} from '@/state/workspace-runtime-reducer'

const defaultLifecycleClient = createWorkspaceLifecycleClient()

const unavailableAgentStatus: AgentRuntimeStatus = {
  provider: 'codex-cli',
  state: 'ERROR',
  version: null,
  source: null,
  displayPath: null,
  lastError: { reasonCode: 'UNKNOWN', recoverable: true }
}

type WorkspaceOperation = 'CHOOSE' | 'REOPEN' | 'CLOSE'

export interface UseWorkspaceRuntimeResult {
  readonly state: WorkspaceRuntimeState
  readonly activeWorkspace: NonNullable<WorkspaceRuntimeStatus['activeWorkspace']> | null
  readonly recoverableError: string | null
  readonly workspaceBusy: boolean
  readonly agentBusy: boolean
  readonly workspaceActionsDisabled: boolean
  readonly projectCommandsDisabled: boolean
  readonly executionCommandsDisabled: boolean
  readonly refresh: () => Promise<void>
  readonly chooseRepository: () => Promise<void>
  readonly reopenLast: () => Promise<void>
  readonly closeWorkspace: () => Promise<void>
  readonly chooseAgentExecutable: () => Promise<void>
  readonly clearAgentExecutable: () => Promise<void>
  readonly dismissError: () => void
  readonly setRepositoryReadOnly: (readOnly: boolean) => void
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'The desktop command bridge is unavailable.'
}

export function useWorkspaceRuntime(
  client: WorkspaceLifecycleClient = defaultLifecycleClient
): UseWorkspaceRuntimeResult {
  const [state, dispatch] = useReducer(
    workspaceRuntimeReducer,
    undefined,
    createInitialWorkspaceRuntimeState
  )
  const [operationError, setOperationError] = useState<string | null>(null)
  const [errorDismissed, setErrorDismissed] = useState(false)
  const [agentBusy, setAgentBusy] = useState(true)
  const stateRef = useRef(state)
  const refreshOperationRef = useRef(false)
  const workspaceOperationRef = useRef<WorkspaceOperation | null>(null)
  const agentOperationRef = useRef(false)

  const applyAction = useCallback((action: WorkspaceRuntimeAction): void => {
    stateRef.current = workspaceRuntimeReducer(stateRef.current, action)
    dispatch(action)
  }, [])

  const acceptWorkspaceStatus = useCallback(
    (status: WorkspaceRuntimeStatus): void => {
      applyAction({ type: 'WORKSPACE_STATUS_RECEIVED', status })
      setOperationError(null)
      setErrorDismissed(false)
    },
    [applyAction]
  )

  const acceptAgentStatus = useCallback(
    (status: AgentRuntimeStatus): void => {
      applyAction({ type: 'AGENT_STATUS_RECEIVED', status })
      setErrorDismissed(false)
    },
    [applyAction]
  )

  const refresh = useCallback(async (): Promise<void> => {
    if (
      refreshOperationRef.current ||
      workspaceOperationRef.current !== null ||
      agentOperationRef.current
    ) {
      return
    }
    refreshOperationRef.current = true
    applyAction({ type: 'AGENT_CHECK_STARTED' })
    setAgentBusy(true)
    try {
      const [workspaceResult, agentResult] = await Promise.allSettled([
        client.getWorkspaceStatus(),
        client.getAgentStatus()
      ])
      if (workspaceResult.status === 'fulfilled') {
        acceptWorkspaceStatus(workspaceResult.value)
      } else {
        setOperationError(describeError(workspaceResult.reason))
        applyAction({
          type: 'WORKSPACE_UNAVAILABLE',
          message: describeError(workspaceResult.reason)
        })
      }
      if (agentResult.status === 'fulfilled') {
        acceptAgentStatus(agentResult.value)
      } else {
        setOperationError((current) => current ?? describeError(agentResult.reason))
        acceptAgentStatus(unavailableAgentStatus)
      }
    } finally {
      refreshOperationRef.current = false
      setAgentBusy(false)
    }
  }, [acceptAgentStatus, acceptWorkspaceStatus, applyAction, client])

  useEffect(() => {
    let active = true
    applyAction({ type: 'BOOTSTRAP_STARTED' })
    void Promise.allSettled([client.getWorkspaceStatus(), client.getAgentStatus()]).then(
      ([workspaceResult, agentResult]) => {
        if (!active) return
        if (workspaceResult.status === 'fulfilled') {
          acceptWorkspaceStatus(workspaceResult.value)
        } else {
          const message = describeError(workspaceResult.reason)
          setOperationError(message)
          applyAction({ type: 'WORKSPACE_UNAVAILABLE', message })
        }
        if (agentResult.status === 'fulfilled') {
          acceptAgentStatus(agentResult.value)
        } else {
          setOperationError((current) => current ?? describeError(agentResult.reason))
          acceptAgentStatus(unavailableAgentStatus)
        }
        setAgentBusy(false)
      }
    )
    return () => {
      active = false
    }
  }, [acceptAgentStatus, acceptWorkspaceStatus, applyAction, client])

  const runWorkspaceOperation = useCallback(
    async (operation: WorkspaceOperation): Promise<void> => {
      if (
        refreshOperationRef.current ||
        workspaceOperationRef.current !== null ||
        agentOperationRef.current ||
        !canStartWorkspaceOperation(stateRef.current)
      ) {
        return
      }
      workspaceOperationRef.current = operation
      setOperationError(null)
      setErrorDismissed(false)
      if (operation === 'CHOOSE') applyAction({ type: 'PICKER_STARTED' })
      if (operation === 'REOPEN') applyAction({ type: 'REOPEN_STARTED' })
      if (operation === 'CLOSE') applyAction({ type: 'CLOSE_STARTED' })

      try {
        if (operation === 'CHOOSE') {
          const result = await client.chooseRepository()
          if (result.cancelled) {
            applyAction({ type: 'PICKER_CANCELLED' })
            return
          }
          acceptWorkspaceStatus(result.status)
          return
        }
        const status =
          operation === 'REOPEN' ? await client.reopenLast() : await client.closeWorkspace()
        acceptWorkspaceStatus(status)
      } catch (error) {
        const message = describeError(error)
        const stable = stateRef.current.lastReadyStatus
        setOperationError(message)
        if (stable !== null) {
          applyAction({ type: 'WORKSPACE_STATUS_RECEIVED', status: stable })
        } else {
          applyAction({ type: 'WORKSPACE_UNAVAILABLE', message })
        }
      } finally {
        workspaceOperationRef.current = null
      }
    },
    [acceptWorkspaceStatus, applyAction, client]
  )

  const runAgentOperation = useCallback(
    async (operation: 'CHOOSE' | 'CLEAR'): Promise<void> => {
      if (
        refreshOperationRef.current ||
        agentOperationRef.current ||
        workspaceOperationRef.current !== null ||
        isWorkspaceBusy(stateRef.current)
      ) {
        return
      }
      agentOperationRef.current = true
      const previousStatus = stateRef.current.agentStatus
      setAgentBusy(true)
      setOperationError(null)
      setErrorDismissed(false)
      applyAction({ type: 'AGENT_CHECK_STARTED' })
      try {
        const status =
          operation === 'CHOOSE'
            ? (await client.chooseAgentExecutable()).status
            : await client.clearAgentExecutable()
        acceptAgentStatus(status)
      } catch (error) {
        setOperationError(describeError(error))
        acceptAgentStatus(previousStatus ?? unavailableAgentStatus)
      } finally {
        agentOperationRef.current = false
        setAgentBusy(false)
      }
    },
    [acceptAgentStatus, applyAction, client]
  )

  const setRepositoryReadOnly = useCallback(
    (readOnly: boolean): void => {
      const current = stateRef.current
      if (readOnly) {
        if (current.phase !== 'READ_ONLY') applyAction({ type: 'WORKSPACE_READ_ONLY' })
        return
      }
      if (current.phase === 'READ_ONLY' && current.status !== null) {
        applyAction({ type: 'WORKSPACE_STATUS_RECEIVED', status: current.status })
      }
    },
    [applyAction]
  )

  const chooseRepository = useCallback(
    (): Promise<void> => runWorkspaceOperation('CHOOSE'),
    [runWorkspaceOperation]
  )
  const reopenLast = useCallback(
    (): Promise<void> => runWorkspaceOperation('REOPEN'),
    [runWorkspaceOperation]
  )
  const closeWorkspace = useCallback(
    (): Promise<void> => runWorkspaceOperation('CLOSE'),
    [runWorkspaceOperation]
  )
  const chooseAgentExecutable = useCallback(
    (): Promise<void> => runAgentOperation('CHOOSE'),
    [runAgentOperation]
  )
  const clearAgentExecutable = useCallback(
    (): Promise<void> => runAgentOperation('CLEAR'),
    [runAgentOperation]
  )
  const dismissError = useCallback((): void => setErrorDismissed(true), [])

  const statusError = state.status?.lastError?.message ?? state.unavailableMessage
  const recoverableError = errorDismissed ? null : (operationError ?? statusError)

  return {
    state,
    activeWorkspace:
      state.status?.activeWorkspace ?? state.lastReadyStatus?.activeWorkspace ?? null,
    recoverableError,
    workspaceBusy: isWorkspaceBusy(state),
    agentBusy,
    workspaceActionsDisabled: areWorkspaceActionsDisabled(state),
    projectCommandsDisabled: areProjectCommandsDisabled(state),
    executionCommandsDisabled: areExecutionCommandsDisabled(state),
    refresh,
    chooseRepository,
    reopenLast,
    closeWorkspace,
    chooseAgentExecutable,
    clearAgentExecutable,
    dismissError,
    setRepositoryReadOnly
  }
}
