import type { ModelCallObservation, ModelMessageDescriptor } from './types'
import type { NormalizedMessageInput } from './normalize'
import { countCategories, countToolResults, normalizeMessage } from './normalize'
import { estimateTokens } from './token-estimate'
import { redactSensitive } from '../sink/redaction'

export interface ObserveRequest {
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly observedAt: string
  readonly harness: 'PI'
  readonly messages: readonly NormalizedMessageInput[]
}

// Per-run raw capture budget. Mutable: raw preview bytes are consumed across
// multiple observations within one Runtime Session, so the total limit is real.
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
// budget state always produces the same descriptors, hashes, counts and total.
export function buildObservation(
  request: ObserveRequest,
  budget: RawCaptureBudget = RawCaptureBudget.disabled()
): ModelCallObservation {
  const descriptors: ModelMessageDescriptor[] = []
  request.messages.forEach((message, index) => {
    let rawPreview: string | undefined
    if (budget.remainingBytes > 0) {
      const raw = redactSensitive(message.text)
      const bounded = raw.slice(0, budget.perMessageSizeLimit)
      budget.consume(bounded.length)
      if (bounded.length > 0) {
        rawPreview = bounded
      }
    }
    descriptors.push(normalizeMessage(message, index, rawPreview))
  })
  const nativeContextEstimate = descriptors.reduce(
    (sum, descriptor) => sum + descriptor.estimatedTokens,
    0
  )
  return {
    runtimeSessionId: request.runtimeSessionId,
    sequence: request.sequence,
    observedAt: request.observedAt,
    harness: request.harness,
    messageCount: request.messages.length,
    nativeContextEstimate,
    categoryCounts: countCategories(request.messages),
    toolResultCount: countToolResults(request.messages),
    messageDescriptors: descriptors
  }
}

export { estimateTokens }
