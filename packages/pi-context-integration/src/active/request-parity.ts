import {
  sha256Hex,
  type CommittedWorkingSet
} from '@canvas-agent/context-runtime'
import type {
  BeforeProviderRequestEvent,
  ContextEvent,
  ExtensionFactory
} from '@earendil-works/pi-coding-agent'
import {
  materializedRepresentationContent,
  PiCommittedContextAdapter,
  PiContextTranslationError,
  type ContextRenderTrace,
  type PiContextRenderPlan
} from './pi-committed-context-adapter'

export const PARITY_FAILURE_CATEGORIES = [
  'TRANSLATION_FAILURE',
  'REQUEST_CAPTURE_FAILURE',
  'RECONSTRUCTION_FAILURE',
  'PARITY_FAILURE',
  'HARNESS_CONTRACT_FAILURE'
] as const
export type ParityFailureCategory = (typeof PARITY_FAILURE_CATEGORIES)[number]

export const PARITY_MISMATCH_KINDS = [
  'MISSING',
  'EXTRA',
  'VERSION_MISMATCH',
  'REPRESENTATION_MISMATCH',
  'ORDER_MISMATCH',
  'CONTENT_HASH_MISMATCH'
] as const
export type ParityMismatchKind = (typeof PARITY_MISMATCH_KINDS)[number]

export class ParityPipelineError extends Error {
  readonly category: ParityFailureCategory
  readonly code: string

  constructor(category: ParityFailureCategory, code: string, message: string) {
    super(message)
    this.name = 'ParityPipelineError'
    this.category = category
    this.code = code
  }
}

export interface CapturedModelRequest {
  readonly provider: string
  readonly model: string
  readonly api: string
  readonly payload: unknown
  readonly trace: readonly ContextRenderTrace[]
  readonly captureStage: 'before_provider_request'
  readonly payloadMessageCount: number
}

export class InMemoryModelRequestCapture {
  private readonly capturedRequests: CapturedModelRequest[] = []
  private readonly captureErrors: ParityPipelineError[] = []

  capture(request: CapturedModelRequest): void {
    this.capturedRequests.push(
      Object.freeze({
        ...request,
        trace: Object.freeze([...request.trace])
      })
    )
  }

  fail(error: unknown, category: ParityFailureCategory, code: string): void {
    if (error instanceof ParityPipelineError) {
      this.captureErrors.push(error)
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    this.captureErrors.push(new ParityPipelineError(category, code, message))
  }

  get requests(): readonly CapturedModelRequest[] {
    return [...this.capturedRequests]
  }

  get errors(): readonly ParityPipelineError[] {
    return [...this.captureErrors]
  }

  latest(): CapturedModelRequest | undefined {
    return this.capturedRequests.at(-1)
  }
}

interface OpenAIMessagePayload {
  readonly role: string
  readonly content: unknown
}

interface OpenAICompletionsPayload {
  readonly messages: readonly unknown[]
  readonly [key: string]: unknown
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function asOpenAICompletionsPayload(value: unknown): OpenAICompletionsPayload | undefined {
  const record = asRecord(value)
  if (record === undefined || !Array.isArray(record['messages'])) return undefined
  return record as OpenAICompletionsPayload
}

function asMessagePayload(value: unknown): OpenAIMessagePayload | undefined {
  const record = asRecord(value)
  if (record === undefined || typeof record['role'] !== 'string') return undefined
  return {
    role: record['role'],
    content: record['content']
  }
}

function extractTextContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) {
    throw new ParityPipelineError(
      'RECONSTRUCTION_FAILURE',
      'UNSUPPORTED_MESSAGE_CONTENT',
      'Captured message content is neither text nor a content block array'
    )
  }

  const textParts: string[] = []
  for (const block of value) {
    const record = asRecord(block)
    if (record === undefined || record['type'] !== 'text' || typeof record['text'] !== 'string') {
      throw new ParityPipelineError(
        'RECONSTRUCTION_FAILURE',
        'UNSUPPORTED_MESSAGE_CONTENT',
        'Captured parity message contains a non-text content block'
      )
    }
    textParts.push(record['text'])
  }
  return textParts.join('')
}

export interface ReconstructedContextEntry {
  readonly trace: ContextRenderTrace
  readonly role: string
  readonly content: string
}

export interface ReconstructedModelVisibleContext {
  readonly entries: readonly ReconstructedContextEntry[]
  readonly logicalHash: string
  readonly payloadMessageCount: number
  readonly expectedPayloadMessageCount: number
}

function reconstructedLogicalHash(entries: readonly ReconstructedContextEntry[]): string {
  return sha256Hex(
    [
      'reconstructed-model-visible-context-v1',
      ...entries.map((entry) =>
        [
          String(entry.trace.position),
          entry.trace.sourceId,
          entry.trace.sourceVersionId,
          entry.trace.representationId,
          entry.trace.representationKind,
          entry.trace.renderedHash,
          entry.role,
          entry.content
        ].join('|')
      )
    ].join('\u241F')
  )
}

/**
 * Rebuilds model-visible entries from the captured outbound payload. The
 * Runtime object is intentionally not an argument to this function.
 */
export function reconstructModelVisibleContext(
  capturedRequest: CapturedModelRequest
): ReconstructedModelVisibleContext {
  if (capturedRequest.api !== 'openai-completions') {
    throw new ParityPipelineError(
      'HARNESS_CONTRACT_FAILURE',
      'UNSUPPORTED_API',
      `Cannot reconstruct unsupported Pi API ${capturedRequest.api}`
    )
  }
  const payload = asOpenAICompletionsPayload(capturedRequest.payload)
  if (payload === undefined) {
    throw new ParityPipelineError(
      'RECONSTRUCTION_FAILURE',
      'INVALID_PAYLOAD',
      'Captured openai-completions payload has no messages array'
    )
  }

  const start = payload.messages.length - capturedRequest.trace.length
  if (start < 0) {
    throw new ParityPipelineError(
      'RECONSTRUCTION_FAILURE',
      'MISSING_PARITY_MESSAGES',
      'Captured payload contains fewer messages than the parity trace'
    )
  }

  const entries: ReconstructedContextEntry[] = []
  for (let index = 0; index < capturedRequest.trace.length; index += 1) {
    const trace = capturedRequest.trace[index]
    const message = asMessagePayload(payload.messages[start + index])
    if (trace === undefined || message === undefined) {
      throw new ParityPipelineError(
        'RECONSTRUCTION_FAILURE',
        'MISSING_PARITY_MESSAGE',
        `Unable to reconstruct parity message at index ${String(index)}`
      )
    }
    entries.push({
      trace,
      role: message.role,
      content: extractTextContent(message.content)
    })
  }

  return {
    entries: Object.freeze(entries),
    logicalHash: reconstructedLogicalHash(entries),
    payloadMessageCount: payload.messages.length,
    expectedPayloadMessageCount: capturedRequest.payloadMessageCount
  }
}

export interface CanonicalContextEntry {
  readonly position: number
  readonly sourceId: string
  readonly sourceVersionId: string
  readonly representationId: string
  readonly representationKind: ContextRenderTrace['representationKind']
  readonly renderedHash: string
  readonly renderedContentHash: string
  readonly role: string
}

export interface CanonicalContext {
  readonly entries: readonly CanonicalContextEntry[]
  readonly logicalHash: string
  readonly payloadMessageCount?: number
  readonly expectedPayloadMessageCount?: number
}

function canonicalEntry(entry: CanonicalContextEntry): string {
  return [
    String(entry.position),
    entry.sourceId,
    entry.sourceVersionId,
    entry.representationId,
    entry.representationKind,
    entry.renderedHash,
    entry.renderedContentHash,
    entry.role
  ].join('|')
}

function canonicalContextHash(entries: readonly CanonicalContextEntry[]): string {
  return sha256Hex(
    ['canonical-model-visible-context-v1', ...entries.map(canonicalEntry)].join('\u241F')
  )
}

function sortCanonicalEntries(
  entries: readonly CanonicalContextEntry[]
): readonly CanonicalContextEntry[] {
  return [...entries].sort((left, right) => left.position - right.position)
}

export function canonicalizeIntendedContext(
  committed: CommittedWorkingSet
): CanonicalContext {
  const entries = committed.entries.map((entry) => {
    const content = materializedRepresentationContent(entry)
    return {
      position: entry.position,
      sourceId: entry.sourceId,
      sourceVersionId: entry.sourceVersionId,
      representationId: entry.representation.id,
      representationKind: entry.representation.kind,
      renderedHash: entry.renderedHash,
      renderedContentHash: sha256Hex(`rendered-content-v1|${content}`),
      role: 'user'
    }
  })
  const sorted = sortCanonicalEntries(entries)
  return {
    entries: Object.freeze(sorted),
    logicalHash: canonicalContextHash(sorted)
  }
}

export function canonicalizeObservedContext(
  reconstructed: ReconstructedModelVisibleContext
): CanonicalContext {
  const entries = reconstructed.entries.map((entry) => ({
    position: entry.trace.position,
    sourceId: entry.trace.sourceId,
    sourceVersionId: entry.trace.sourceVersionId,
    representationId: entry.trace.representationId,
    representationKind: entry.trace.representationKind,
    renderedHash: entry.trace.renderedHash,
    renderedContentHash: sha256Hex(`rendered-content-v1|${entry.content}`),
    role: entry.role
  }))
  const sorted = sortCanonicalEntries(entries)
  return {
    entries: Object.freeze(sorted),
    logicalHash: canonicalContextHash(sorted),
    payloadMessageCount: reconstructed.payloadMessageCount,
    expectedPayloadMessageCount: reconstructed.expectedPayloadMessageCount
  }
}

export interface ParityMismatch {
  readonly kind: ParityMismatchKind
  readonly position: number | null
  readonly expected?: string
  readonly observed?: string
}

export interface ContextParityResult {
  readonly status: 'PASS' | 'FAIL'
  readonly mismatches: readonly ParityMismatch[]
  readonly errorCategory: 'PARITY_FAILURE' | null
}

function identity(entry: CanonicalContextEntry): string {
  return [
    entry.sourceId,
    entry.sourceVersionId,
    entry.representationId,
    entry.representationKind
  ].join('|')
}

function mismatch(
  kind: ParityMismatchKind,
  position: number | null,
  expected?: string,
  observed?: string
): ParityMismatch {
  return {
    kind,
    position,
    ...(expected !== undefined ? { expected } : {}),
    ...(observed !== undefined ? { observed } : {})
  }
}

export function compareContextParity(
  intended: CanonicalContext,
  observed: CanonicalContext
): ContextParityResult {
  const mismatches: ParityMismatch[] = []

  if (
    observed.expectedPayloadMessageCount !== undefined &&
    observed.payloadMessageCount !== undefined &&
    observed.payloadMessageCount !== observed.expectedPayloadMessageCount
  ) {
    mismatches.push(
      mismatch(
        observed.payloadMessageCount > observed.expectedPayloadMessageCount ? 'EXTRA' : 'MISSING',
        null,
        String(observed.expectedPayloadMessageCount),
        String(observed.payloadMessageCount)
      )
    )
  }

  if (observed.entries.length < intended.entries.length) {
    mismatches.push(
      mismatch('MISSING', null, String(intended.entries.length), String(observed.entries.length))
    )
  } else if (observed.entries.length > intended.entries.length) {
    mismatches.push(
      mismatch('EXTRA', null, String(intended.entries.length), String(observed.entries.length))
    )
  }

  const intendedIdentities = intended.entries.map(identity)
  const observedIdentities = observed.entries.map(identity)
  if (
    intendedIdentities.length === observedIdentities.length &&
    [...intendedIdentities].sort().join('\u241F') === [...observedIdentities].sort().join('\u241F') &&
    intendedIdentities.join('\u241F') !== observedIdentities.join('\u241F')
  ) {
    mismatches.push(mismatch('ORDER_MISMATCH', null, intendedIdentities.join(','), observedIdentities.join(',')))
  }

  const comparableLength = Math.min(intended.entries.length, observed.entries.length)
  for (let index = 0; index < comparableLength; index += 1) {
    const expected = intended.entries[index]
    const actual = observed.entries[index]
    if (expected === undefined || actual === undefined) continue
    if (
      expected.sourceId !== actual.sourceId ||
      expected.sourceVersionId !== actual.sourceVersionId
    ) {
      mismatches.push(
        mismatch(
          'VERSION_MISMATCH',
          expected.position,
          `${expected.sourceId}@${expected.sourceVersionId}`,
          `${actual.sourceId}@${actual.sourceVersionId}`
        )
      )
      continue
    }
    if (
      expected.representationId !== actual.representationId ||
      expected.representationKind !== actual.representationKind
    ) {
      mismatches.push(
        mismatch(
          'REPRESENTATION_MISMATCH',
          expected.position,
          `${expected.representationId}:${expected.representationKind}`,
          `${actual.representationId}:${actual.representationKind}`
        )
      )
    }
    if (
      expected.position !== actual.position ||
      expected.renderedHash !== actual.renderedHash ||
      expected.renderedContentHash !== actual.renderedContentHash ||
      expected.role !== actual.role
    ) {
      mismatches.push(
        mismatch(
          expected.position !== actual.position ? 'ORDER_MISMATCH' : 'CONTENT_HASH_MISMATCH',
          expected.position,
          canonicalEntry(expected),
          canonicalEntry(actual)
        )
      )
    }
  }

  return {
    status: mismatches.length === 0 ? 'PASS' : 'FAIL',
    mismatches: Object.freeze(mismatches),
    errorCategory: mismatches.length === 0 ? null : 'PARITY_FAILURE'
  }
}

function toParityPipelineError(error: unknown): ParityPipelineError {
  if (error instanceof ParityPipelineError) return error
  if (error instanceof PiContextTranslationError) {
    return new ParityPipelineError('TRANSLATION_FAILURE', error.code, error.message)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new ParityPipelineError('REQUEST_CAPTURE_FAILURE', 'UNKNOWN', message)
}

export interface PiRequestParityExtensionOptions {
  readonly committed: CommittedWorkingSet
  readonly capture: InMemoryModelRequestCapture
  readonly adapter?: PiCommittedContextAdapter
  readonly timestamp?: () => number
  readonly replaceContext?: boolean
}

/**
 * Pi extension that translates committed entries at the context seam and
 * captures the final provider payload at before_provider_request. It never
 * changes the captured payload and never performs a provider call itself.
 */
export function createPiRequestParityExtension(
  options: PiRequestParityExtensionOptions
): ExtensionFactory {
  const adapter = options.adapter ?? new PiCommittedContextAdapter()
  return (pi) => {
    let currentPlan: PiContextRenderPlan | undefined

    pi.on('context', (event: ContextEvent) => {
      try {
        currentPlan = adapter.render(options.committed, {
          timestamp: options.timestamp?.() ?? Date.now()
        })
        const injected = currentPlan.messages as unknown as ContextEvent['messages']
        const messages = options.replaceContext
          ? injected
          : [...event.messages, ...injected]
        return { messages }
      } catch (error) {
        currentPlan = undefined
        const normalized = toParityPipelineError(error)
        options.capture.fail(error, normalized.category, normalized.code)
        return { messages: event.messages }
      }
    })

    pi.on('before_provider_request', (event: BeforeProviderRequestEvent, ctx) => {
      const model = ctx.model
      if (model === undefined) {
        options.capture.fail(
          new ParityPipelineError(
            'REQUEST_CAPTURE_FAILURE',
            'MODEL_UNAVAILABLE',
            'Pi did not provide a model at before_provider_request'
          ),
          'REQUEST_CAPTURE_FAILURE',
          'MODEL_UNAVAILABLE'
        )
        return
      }
      if (model.api !== 'openai-completions') {
        options.capture.fail(
          new ParityPipelineError(
            'HARNESS_CONTRACT_FAILURE',
            'UNSUPPORTED_API',
            `CR-010 currently supports openai-completions, received ${model.api}`
          ),
          'HARNESS_CONTRACT_FAILURE',
          'UNSUPPORTED_API'
        )
        return
      }
      const payload = asOpenAICompletionsPayload(event.payload)
      if (payload === undefined) {
        options.capture.fail(
          new ParityPipelineError(
            'REQUEST_CAPTURE_FAILURE',
            'INVALID_PAYLOAD',
            'Pi before_provider_request payload has no messages array'
          ),
          'REQUEST_CAPTURE_FAILURE',
          'INVALID_PAYLOAD'
        )
        return
      }
      if (currentPlan === undefined) {
        options.capture.fail(
          new ParityPipelineError(
            'REQUEST_CAPTURE_FAILURE',
            'MISSING_CONTEXT_TRACE',
            'No committed context trace was produced before provider request'
          ),
          'REQUEST_CAPTURE_FAILURE',
          'MISSING_CONTEXT_TRACE'
        )
        return
      }
      options.capture.capture({
        provider: model.provider,
        model: model.id,
        api: model.api,
        payload: event.payload,
        trace: currentPlan.traces,
        captureStage: 'before_provider_request',
        payloadMessageCount: payload.messages.length
      })
    })
  }
}
