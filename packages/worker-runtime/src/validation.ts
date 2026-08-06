import { createHash } from 'node:crypto'
import { executionRequestSchema, type ExecutionRequestContract } from '@canvas-agent/contracts'
import { ExpiredRequestError, MissingCapabilityError, RequestValidationError } from './errors'

export interface ValidateRequestOptions {
  capabilities: readonly string[]
  now?: number
}

export function validateExecutionRequest(
  input: unknown,
  options: ValidateRequestOptions
): ExecutionRequestContract {
  const parsed = executionRequestSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new RequestValidationError(
      'schema validation failed',
      first === undefined ? 'unknown' : `${first.path.join('.')}: ${first.message}`
    )
  }
  const request = parsed.data

  const computedHash = computeRequestHash(stripRequestHash(request))
  if (computedHash !== request.requestHash) {
    throw new RequestValidationError('request hash mismatch', 'content has been tampered with')
  }

  const nowMs = options.now ?? Date.now()
  if (new Date(request.expiresAt).getTime() <= nowMs) {
    throw new ExpiredRequestError(request.expiresAt)
  }

  for (const capability of request.requiredCapabilities) {
    if (!options.capabilities.includes(capability)) {
      throw new MissingCapabilityError(capability)
    }
  }

  return request
}

export function stripRequestHash(request: ExecutionRequestContract): Omit<ExecutionRequestContract, 'requestHash'> {
  const { requestHash: _requestHash, ...rest } = request
  return rest
}

export function computeRequestHash(request: unknown): string {
  return createHash('sha256').update(stableStringify(request), 'utf8').digest('hex')
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const body = keys
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')
    return `{${body}}`
  }
  return JSON.stringify(value)
}
