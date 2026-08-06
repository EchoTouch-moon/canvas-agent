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
