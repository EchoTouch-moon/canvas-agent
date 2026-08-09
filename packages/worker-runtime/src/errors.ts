export class WorkerError extends Error {
  override readonly name: string = 'WorkerError'
}

export class RequestValidationError extends WorkerError {
  override readonly name: string = 'RequestValidationError'
  constructor(
    readonly issue: string,
    readonly detail: string
  ) {
    super(`ExecutionRequest rejected: ${issue}${detail ? ` (${detail})` : ''}`)
  }
}

export class ExpiredRequestError extends RequestValidationError {
  override readonly name: string = 'ExpiredRequestError'
  constructor(expiresAt: string) {
    super('request has expired', `expires_at ${expiresAt}`)
  }
}

export class MissingCapabilityError extends RequestValidationError {
  override readonly name: string = 'MissingCapabilityError'
  constructor(capability: string) {
    super('required capability is not available', capability)
  }
}

export class ClaimRejectedError extends WorkerError {
  override readonly name: string = 'ClaimRejectedError'
  constructor(executionRequestId: string) {
    super(`ExecutionRequest ${executionRequestId} has already been claimed`)
  }
}

export class RevisionMismatchError extends WorkerError {
  override readonly name: string = 'RevisionMismatchError'
  constructor(
    readonly executionRequestId: string,
    readonly field: string,
    readonly expected: string | null,
    readonly actual: string | null
  ) {
    super(
      `Repository revision mismatch for ${executionRequestId}: ${field} expected ${expected ?? 'null'} but repository has ${actual ?? 'null'}`
    )
  }
}

export class CommandDeniedError extends WorkerError {
  override readonly name: string = 'CommandDeniedError'
  constructor(command: string) {
    super(`Command "${command}" is not on the worker command allowlist`)
  }
}

export class PathDeniedError extends WorkerError {
  override readonly name: string = 'PathDeniedError'
  constructor(path: string) {
    super(`Path "${path}" is denied by the tool policy`)
  }
}

export class BudgetExceededError extends WorkerError {
  override readonly name: string = 'BudgetExceededError'
  constructor(resource: string, limit: number) {
    super(`Budget exceeded: ${resource} limit ${limit}`)
  }
}

export class CancelledError extends WorkerError {
  override readonly name: string = 'CancelledError'
}

// --- Local CLI adapter taxonomy (PROPOSAL-028) ------------------------------

export const AGENT_EXECUTABLE_NOT_FOUND = 'AGENT_EXECUTABLE_NOT_FOUND'
export const AGENT_VERSION_UNSUPPORTED = 'AGENT_VERSION_UNSUPPORTED'
export const AGENT_AUTH_REQUIRED = 'AGENT_AUTH_REQUIRED'
export const AGENT_POLICY_REJECTED = 'AGENT_POLICY_REJECTED'
export const AGENT_OUTPUT_INVALID = 'AGENT_OUTPUT_INVALID'
export const AGENT_OUTPUT_LIMIT_EXCEEDED = 'AGENT_OUTPUT_LIMIT_EXCEEDED'
export const AGENT_PROCESS_FAILED = 'AGENT_PROCESS_FAILED'
export const AGENT_REPOSITORY_STATE_VIOLATION = 'AGENT_REPOSITORY_STATE_VIOLATION'
export const AGENT_TIMED_OUT = 'AGENT_TIMED_OUT'
export const AGENT_CANCELLED = 'AGENT_CANCELLED'
export const AGENT_INTERPRETER_MISSING = 'AGENT_INTERPRETER_MISSING'
export const EXECUTION_CONTEXT_REQUIRED = 'EXECUTION_CONTEXT_REQUIRED'

export class LocalCliError extends WorkerError {
  override readonly name: string = 'LocalCliError'
  constructor(
    readonly code: string,
    message: string,
    readonly transport?: unknown
  ) {
    super(message)
  }
}

export class LocalCliSpawnError extends LocalCliError {
  override readonly name: string = 'LocalCliSpawnError'
  constructor(
    readonly errno: string,
    message: string,
    readonly originalError: unknown
  ) {
    super('SPAWN_ERROR', message)
  }
}

export class LocalCliOutputInvalidError extends LocalCliError {
  override readonly name: string = 'LocalCliOutputInvalidError'
  constructor(message: string) {
    super(AGENT_OUTPUT_INVALID, message)
  }
}
