import { createHash } from 'node:crypto'
import {
  executionRequestSchema,
  MAX_EXECUTION_CONTEXT_BYTES,
  MAX_EXECUTION_CONTEXT_ITEMS,
  type ExecutionContextItemV2,
  type ExecutionContextBundleV2,
  type ExecutionRequestContract
} from '@canvas-agent/contracts'
import { ExpiredRequestError, MissingCapabilityError, RequestValidationError } from './errors'

export const DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED = 'DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED'

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

  if (request.schemaVersion === 2) {
    assertValidExecutionContextBundle(request.contextBundle)
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

export interface ComputedExecutionContextBundle {
  readonly canonicalItems: string
  readonly totalBytes: number
  readonly contentHash: string
}

export function computeExecutionContextBundle(
  items: readonly ExecutionContextItemV2[]
): ComputedExecutionContextBundle {
  const canonicalItems = stableStringify(items)
  const totalBytes = Buffer.byteLength(canonicalItems, 'utf8')
  const contentHash = sha256Hex(canonicalItems)
  return { canonicalItems, totalBytes, contentHash }
}

/**
 * Semantic bundle validation shared by Main materialization and Worker
 * pre-claim validation. Checks contiguous positions, per-item content hashes,
 * canonical byte/hash recomputation, the byte/item limits and the P0
 * TASK_INSTRUCTION requirement beyond the Zod shape.
 */
export function assertValidExecutionContextBundle(bundle: ExecutionContextBundleV2): void {
  const { items } = bundle
  if (items.length < 1 || items.length > MAX_EXECUTION_CONTEXT_ITEMS) {
    throw new RequestValidationError(
      'context bundle item count out of range',
      `expected 1..${MAX_EXECUTION_CONTEXT_ITEMS} items, got ${items.length}`
    )
  }
  if (!items.every((item, index) => item.position === index)) {
    throw new RequestValidationError(
      'context bundle positions must be contiguous',
      'positions are not 0..items.length-1 in array order'
    )
  }
  for (const item of items) {
    if (sha256Hex(item.resolvedContent) !== item.contentHash) {
      throw new RequestValidationError('context item hash mismatch', `item position ${item.position}`)
    }
  }
  const computed = computeExecutionContextBundle(items)
  if (computed.totalBytes !== bundle.totalBytes) {
    throw new RequestValidationError(
      'context bundle totalBytes mismatch',
      `expected ${bundle.totalBytes} got ${computed.totalBytes}`
    )
  }
  if (computed.totalBytes > MAX_EXECUTION_CONTEXT_BYTES) {
    throw new RequestValidationError(
      'context bundle exceeds byte limit',
      `totalBytes ${computed.totalBytes}`
    )
  }
  if (computed.contentHash !== bundle.contentHash) {
    throw new RequestValidationError('context bundle hash mismatch', 'content has been tampered with')
  }
  if (
    !items.some(
      (item) => item.authority === 'TASK_INSTRUCTION' && item.priority === 'P0'
    )
  ) {
    throw new RequestValidationError(
      'missing P0 task instruction',
      'no context item has authority TASK_INSTRUCTION and priority P0'
    )
  }
}
