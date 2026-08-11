import type { ModelCallObservation, ModelMessageDescriptor } from './types'
import { ESTIMATE_SCOPE_AGENT_MESSAGES } from './types'
import type { NormalizedMessageInput } from './normalize'
import { countBinaryBlocks, countCategories, countToolResults, normalizeMessage } from './normalize'
import { estimateChars, estimateTokens } from './token-estimate'
import { truncateToUtf8Bytes } from '../util/utf8'
import { redactSensitive } from '../sink/redaction'

export interface ObserveRequest {
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly observedAt: string
  // Provider/Agent-neutral experimental harness identifier.
  readonly harness: string
  readonly messages: readonly NormalizedMessageInput[]
}

// Per-run raw capture budget in UTF-8 BYTES. Mutable: raw preview bytes are
// consumed across multiple observations within one Runtime Session, so the
// total limit is real and byte-accurate.
export class RawCaptureBudget {
  constructor(
    readonly perMessageSizeLimit: number,
    readonly perRunTotalLimit: number,
    private remaining: number = perRunTotalLimit
  ) {}

  static disabled(): RawCaptureBudget {
    return new RawCaptureBudget(0, 0, 0)
  }

  get remainingBytes(): number {
    return this.remaining
  }

  consume(bytes: number): void {
    this.remaining = Math.max(0, this.remaining - bytes)
  }
}

// Raw capture stays off by default: pass `RawCaptureBudget.disabled()`.
export function rawCaptureBudget(
  options: { perMessageSizeLimit?: number; perRunTotalLimit?: number } = {}
): RawCaptureBudget {
  return new RawCaptureBudget(
    options.perMessageSizeLimit ?? 500,
    options.perRunTotalLimit ?? 20_000
  )
}

// Deterministic observation builder: the same normalized input set + the same
// budget state always produces the same descriptors, hashes, counts and totals.
export function buildObservation(
  request: ObserveRequest,
  budget: RawCaptureBudget = RawCaptureBudget.disabled()
): ModelCallObservation {
  const descriptors: ModelMessageDescriptor[] = []
  request.messages.forEach((message, index) => {
    let rawPreview: string | undefined
    if (budget.remainingBytes > 0) {
      const redacted = redactSensitive(message.fingerprintText)
      const bounded = truncateToUtf8Bytes(redacted, budget.perMessageSizeLimit)
      budget.consume(Buffer.byteLength(bounded, 'utf8'))
      if (bounded.length > 0) {
        rawPreview = bounded
      }
    }
    descriptors.push(normalizeMessage(message, index, rawPreview))
  })
  const observedMessageTokenEstimate = descriptors.reduce(
    (sum, descriptor) => sum + descriptor.estimatedTokens,
    0
  )
  const observedMessageCharEstimate = descriptors.reduce(
    (sum, descriptor) => sum + descriptor.estimatedChars,
    0
  )
  return {
    runtimeSessionId: request.runtimeSessionId,
    sequence: request.sequence,
    observedAt: request.observedAt,
    harness: request.harness,
    estimateScope: ESTIMATE_SCOPE_AGENT_MESSAGES,
    messageCount: request.messages.length,
    observedMessageTokenEstimate,
    observedMessageCharEstimate,
    categoryCounts: countCategories(request.messages),
    toolResultCount: countToolResults(request.messages),
    messageDescriptors: descriptors
  }
}

export { estimateChars, estimateTokens }
export { countBinaryBlocks }
