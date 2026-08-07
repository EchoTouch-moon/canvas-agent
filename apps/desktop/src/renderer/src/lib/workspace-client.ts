import type {
  CanvasAgentDesktopApi,
  CommandErrorName,
  CommandInput,
  CommandOutput,
  CommandRequest,
  CommandResponse,
  WorkspaceCommand
} from '@canvas-agent/contracts'

export type SnapshotFreezeInput = CommandInput<'snapshot.freeze'>
export type NodeDraftUpsertInput = CommandInput<'nodeDraft.upsert'>
export type CommandTransport = Pick<CanvasAgentDesktopApi, 'command'>

export type {
  CanvasAgentDesktopApi,
  CommandErrorName,
  CommandInput,
  CommandOutput,
  CommandRequest,
  CommandResponse,
  WorkspaceCommand
} from '@canvas-agent/contracts'

export class WorkspaceError extends Error {
  override readonly name: CommandErrorName
  readonly details?: unknown

  constructor(name: CommandErrorName, message: string, details?: unknown) {
    super(message)
    this.name = name
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
  name: CommandErrorName
): error is WorkspaceError {
  return isWorkspaceError(error) && error.name === name
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isResponse(value: unknown): value is CommandResponse {
  if (
    !isRecord(value) ||
    typeof value.requestId !== 'string' ||
    value.schemaVersion !== 1 ||
    typeof value.command !== 'string'
  ) {
    return false
  }
  if (value.ok === true) return 'data' in value
  return (
    value.ok === false &&
    isRecord(value.error) &&
    typeof value.error.name === 'string' &&
    typeof value.error.message === 'string'
  )
}

const commandErrorNames = new Set<CommandErrorName>([
  'RequestValidationError',
  'NotFoundError',
  'ValidationError',
  'ConcurrencyError',
  'ImmutableWriteError',
  'PersistenceError',
  'HostUnavailableError',
  'InternalError'
])

function normalizeErrorName(value: string): CommandErrorName {
  return commandErrorNames.has(value as CommandErrorName)
    ? (value as CommandErrorName)
    : 'InternalError'
}

function createWorkspaceError(
  name: CommandErrorName,
  message: string,
  details?: unknown
): WorkspaceError {
  switch (name) {
    case 'ConcurrencyError':
      return new ConcurrencyError(message, details)
    case 'ValidationError':
    case 'RequestValidationError':
      return new ValidationError(message, details)
    case 'NotFoundError':
      return new NotFoundError(message, details)
    case 'HostUnavailableError':
      return new HostUnavailableError(message, details)
    case 'InternalError':
      return new InternalError(message, details)
    case 'ImmutableWriteError':
    case 'PersistenceError':
      return new WorkspaceError(name, message, details)
  }
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `renderer-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
      return api.command(request as CommandRequest)
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
      const request = {
        requestId: createRequestId(),
        schemaVersion: 1,
        command,
        payload
      } as CommandRequest<C>

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
          normalizeErrorName(rawResponse.error.name),
          rawResponse.error.message,
          rawResponse.error.details
        )
      }
      if (rawResponse.data === null || rawResponse.data === undefined) {
        throw new InternalError(`Workspace command ${command} returned no data`)
      }
      return rawResponse.data as CommandOutput<C>
    }
  }
}
