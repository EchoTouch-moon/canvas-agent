import {
  sha256Hex,
  type CommittedWorkingSet
} from '@canvas-agent/context-runtime'
import {
  PARITY_MISMATCH_KINDS as SHARED_PARITY_MISMATCH_KINDS,
  canonicalizeIntendedContext as canonicalizeSharedIntendedContext,
  canonicalizeObservedContext as canonicalizeSharedObservedContext,
  compareContextParity as compareSharedContextParity,
  type CanonicalContext as SharedCanonicalContext,
  type CanonicalContextEntry as SharedCanonicalContextEntry,
  type ContextParityResult as SharedContextParityResult,
  type ParityMismatch as SharedParityMismatch,
  type ParityMismatchKind as SharedParityMismatchKind
} from '@canvas-agent/context-conformance'
import type {
  BeforeProviderRequestEvent,
  ContextEvent,
  ExtensionFactory
} from '@earendil-works/pi-coding-agent'
import {
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

export const PARITY_MISMATCH_KINDS = SHARED_PARITY_MISMATCH_KINDS
export type ParityMismatchKind = SharedParityMismatchKind

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

export type CanonicalContextEntry = SharedCanonicalContextEntry
export type CanonicalContext = SharedCanonicalContext
export type ParityMismatch = SharedParityMismatch
export type ContextParityResult = SharedContextParityResult

export function canonicalizeIntendedContext(
  committed: CommittedWorkingSet
): CanonicalContext {
  return canonicalizeSharedIntendedContext(committed)
}

export function canonicalizeObservedContext(
  reconstructed: ReconstructedModelVisibleContext
): CanonicalContext {
  return canonicalizeSharedObservedContext(
    reconstructed.entries.map((entry) => ({
      position: entry.trace.position,
      sourceId: entry.trace.sourceId,
      sourceVersionId: entry.trace.sourceVersionId,
      representationId: entry.trace.representationId,
      representationKind: entry.trace.representationKind,
      renderedHash: entry.trace.renderedHash,
      role: entry.role,
      content: entry.content
    })),
    {
      payloadMessageCount: reconstructed.payloadMessageCount,
      expectedPayloadMessageCount: reconstructed.expectedPayloadMessageCount
    }
  )
}

export function compareContextParity(
  intended: CanonicalContext,
  observed: CanonicalContext
): ContextParityResult {
  return compareSharedContextParity(intended, observed)
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
