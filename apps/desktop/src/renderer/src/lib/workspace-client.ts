import type {
  CancellationResult,
  ContextSnapshotItemRecord,
  ContextSnapshotRecord,
  DispatchResult,
  NodeDraftRecord,
  ProjectRecord,
  ProjectStateView,
  RepositoryRevisionRecord
} from './workspace-types'

export interface SnapshotFreezeItemInput {
  readonly itemType: ContextSnapshotItemRecord['itemType']
  readonly sourceRef: string
  readonly resolvedContent: string
  readonly authority: ContextSnapshotItemRecord['authority']
  readonly priority: ContextSnapshotItemRecord['priority']
  readonly tokenEstimate: number
  readonly selectionReason?: string
}

export interface SnapshotFreezeInput {
  readonly projectId: string
  readonly taskId: string
  readonly taskSpecVersionId: string
  readonly baseBaselineId: string
  readonly expectedRepositoryRevisionId: string
  readonly items: readonly SnapshotFreezeItemInput[]
}

export interface NodeDraftUpsertInput {
  readonly nodeId: string
  readonly title: string
  readonly body: string
  readonly expectedRevision?: number
}

export interface WorkspaceCommandMap {
  readonly 'project.list': {
    readonly input: Record<string, never>
    readonly output: readonly ProjectRecord[]
  }
  readonly 'project.state': {
    readonly input: { readonly projectId: string }
    readonly output: ProjectStateView
  }
  readonly 'revision.current': {
    readonly input: Record<string, never>
    readonly output: RepositoryRevisionRecord
  }
  readonly 'snapshot.freeze': {
    readonly input: SnapshotFreezeInput
    readonly output: ContextSnapshotRecord
  }
  readonly 'nodeDraft.upsert': {
    readonly input: NodeDraftUpsertInput
    readonly output: NodeDraftRecord
  }
  readonly 'execution.dispatch': {
    readonly input: {
      readonly executionRequestId: string
      readonly contextSnapshotId: string
    }
    readonly output: DispatchResult
  }
  readonly 'execution.cancel': {
    readonly input: { readonly executionRequestId: string }
    readonly output: CancellationResult
  }
}

export type WorkspaceCommand = keyof WorkspaceCommandMap
export type CommandInput<C extends WorkspaceCommand> = WorkspaceCommandMap[C]['input']
export type CommandOutput<C extends WorkspaceCommand> = WorkspaceCommandMap[C]['output']

export interface CommandRequest<C extends WorkspaceCommand = WorkspaceCommand> {
  readonly requestId: string
  readonly command: C
  readonly payload: CommandInput<C>
}

export interface CommandSuccessResponse<C extends WorkspaceCommand = WorkspaceCommand> {
  readonly requestId: string
  readonly command: C
  readonly ok: true
  readonly data: unknown
}

export interface CommandFailureResponse<C extends WorkspaceCommand = WorkspaceCommand> {
  readonly requestId: string
  readonly command: C
  readonly ok: false
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details?: unknown
  }
}

export type CommandResponse<C extends WorkspaceCommand = WorkspaceCommand> =
  CommandSuccessResponse<C> | CommandFailureResponse<C>

export interface CommandTransport {
  command(request: CommandRequest): Promise<unknown>
}

export type WorkspaceErrorCode =
  | 'ConcurrencyError'
  | 'ValidationError'
  | 'NotFoundError'
  | 'HostUnavailableError'
  | 'InternalError'

export class WorkspaceError extends Error {
  override readonly name: WorkspaceErrorCode
  readonly code: WorkspaceErrorCode
  readonly details: unknown

  constructor(code: WorkspaceErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = code
    this.code = code
    this.details = details
  }
}

export class ConcurrencyError extends WorkspaceError {
  constructor(message: string, details?: unknown) {
    super('ConcurrencyError', message, details)
  }
}

export class ValidationError extends WorkspaceError {
  constructor(message: string, details?: unknown) {
    super('ValidationError', message, details)
  }
}

export class NotFoundError extends WorkspaceError {
  constructor(message: string, details?: unknown) {
    super('NotFoundError', message, details)
  }
}

export class HostUnavailableError extends WorkspaceError {
  constructor(message: string, details?: unknown) {
    super('HostUnavailableError', message, details)
  }
}

export class InternalError extends WorkspaceError {
  constructor(message: string, details?: unknown) {
    super('InternalError', message, details)
  }
}

export function isWorkspaceError(error: unknown): error is WorkspaceError {
  return error instanceof WorkspaceError
}

export function isWorkspaceErrorCode(
  error: unknown,
  code: WorkspaceErrorCode
): error is WorkspaceError {
  return isWorkspaceError(error) && error.code === code
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isResponse(value: unknown): value is CommandResponse {
  if (
    !isRecord(value) ||
    typeof value.requestId !== 'string' ||
    typeof value.command !== 'string'
  ) {
    return false
  }
  if (value.ok === true) return true
  return (
    value.ok === false &&
    isRecord(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string'
  )
}

function normalizeErrorCode(value: string): WorkspaceErrorCode {
  if (
    value === 'ConcurrencyError' ||
    value === 'ValidationError' ||
    value === 'NotFoundError' ||
    value === 'HostUnavailableError' ||
    value === 'InternalError'
  ) {
    return value
  }
  return 'InternalError'
}

function createWorkspaceError(
  code: WorkspaceErrorCode,
  message: string,
  details?: unknown
): WorkspaceError {
  switch (code) {
    case 'ConcurrencyError':
      return new ConcurrencyError(message, details)
    case 'ValidationError':
      return new ValidationError(message, details)
    case 'NotFoundError':
      return new NotFoundError(message, details)
    case 'HostUnavailableError':
      return new HostUnavailableError(message, details)
    case 'InternalError':
      return new InternalError(message, details)
  }
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `renderer-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function validateOutput<C extends WorkspaceCommand>(command: C, data: unknown): CommandOutput<C> {
  if (data === null || data === undefined) {
    throw new InternalError(`Workspace command ${command} returned no data`)
  }
  return data as CommandOutput<C>
}

function windowTransport(): CommandTransport {
  return {
    command(request) {
      const api: unknown = typeof window === 'undefined' ? undefined : window.canvasAgent
      if (!isRecord(api) || typeof api.command !== 'function') {
        return Promise.reject(
          new HostUnavailableError('The Canvas Agent command bridge is unavailable')
        )
      }
      return api.command(request)
    }
  }
}

export interface WorkspaceClient {
  command<C extends WorkspaceCommand>(
    command: C,
    payload: CommandInput<C>
  ): Promise<CommandOutput<C>>
}

export function createWorkspaceClient(
  transport: CommandTransport = windowTransport()
): WorkspaceClient {
  return {
    async command<C extends WorkspaceCommand>(
      command: C,
      payload: CommandInput<C>
    ): Promise<CommandOutput<C>> {
      const request: CommandRequest<C> = {
        requestId: createRequestId(),
        command,
        payload
      }

      let rawResponse: unknown
      try {
        rawResponse = await transport.command(request)
      } catch (error) {
        if (isWorkspaceError(error)) throw error
        throw new HostUnavailableError(
          error instanceof Error ? error.message : 'The Canvas Agent command bridge failed',
          error
        )
      }

      if (!isResponse(rawResponse)) {
        throw new InternalError(`Workspace command ${command} returned an invalid response`)
      }
      if (rawResponse.requestId !== request.requestId) {
        throw new InternalError(`Workspace response correlation mismatch for ${command}`, {
          expectedRequestId: request.requestId,
          actualRequestId: rawResponse.requestId
        })
      }
      if (rawResponse.command !== command) {
        throw new InternalError(`Workspace response command mismatch for ${command}`, {
          expectedCommand: command,
          actualCommand: rawResponse.command
        })
      }
      if (!rawResponse.ok) {
        throw createWorkspaceError(
          normalizeErrorCode(rawResponse.error.code),
          rawResponse.error.message,
          rawResponse.error.details
        )
      }
      return validateOutput(command, rawResponse.data)
    }
  }
}
