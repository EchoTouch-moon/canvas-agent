import type { CommandError } from '@canvas-agent/contracts'
import {
  ConcurrencyError,
  CycleError,
  ImmutableWriteError,
  NotFoundError,
  PersistenceError,
  SelfEdgeError,
  ValidationError
} from '@canvas-agent/persistence'

export class HostUnavailableError extends Error {
  override readonly name = 'HostUnavailableError'
}

export class RepositoryUnavailableError extends Error {
  override readonly name = 'RepositoryUnavailableError'
}

export class WorkspaceUnavailableError extends Error {
  override readonly name = 'WorkspaceUnavailableError'
}

export function mapCommandError(error: unknown): CommandError {
  if (error instanceof ConcurrencyError) {
    return { name: 'ConcurrencyError', message: error.message }
  }
  if (error instanceof ImmutableWriteError) {
    return { name: 'ImmutableWriteError', message: error.message }
  }
  if (error instanceof NotFoundError) {
    return { name: 'NotFoundError', message: error.message }
  }
  if (error instanceof SelfEdgeError) {
    return { name: 'ValidationError', message: error.message, details: { reason: 'SELF_EDGE' } }
  }
  if (error instanceof CycleError) {
    return {
      name: 'ValidationError',
      message: error.message,
      details: {
        reason: 'CYCLE',
        relation: error.relation,
        startNodeId: error.startNodeId,
        endNodeId: error.endNodeId
      }
    }
  }
  if (error instanceof ValidationError) {
    return { name: 'ValidationError', message: error.message }
  }
  if (error instanceof PersistenceError) {
    return { name: 'PersistenceError', message: error.message }
  }
  if (error instanceof HostUnavailableError) {
    return { name: 'HostUnavailableError', message: error.message }
  }
  if (error instanceof RepositoryUnavailableError) {
    return {
      name: 'ValidationError',
      message: error.message,
      details: { reason: 'repository_has_no_head' }
    }
  }
  if (error instanceof WorkspaceUnavailableError) {
    return { name: 'HostUnavailableError', message: error.message }
  }
  if (error instanceof Error) {
    return { name: 'InternalError', message: error.message }
  }
  return { name: 'InternalError', message: String(error) }
}
