export type MessageCategory = 'USER' | 'ASSISTANT' | 'TOOL_RESULT' | 'OTHER'

export const MESSAGE_CATEGORIES: readonly MessageCategory[] = [
  'USER',
  'ASSISTANT',
  'TOOL_RESULT',
  'OTHER'
] as const

// Provider/Agent-neutral experimental harness identifier. `'PI'` is supplied by
// pi-context-integration; the core never hardcodes a specific harness.
export type HarnessId = string

// Explicit scope of the token estimate. The `context` hook observes
// AgentMessage[] BEFORE convertToLlm / system-prompt assembly / provider body
// construction, so the estimate is NOT the full model/provider request size.
export const ESTIMATE_SCOPE_AGENT_MESSAGES = 'agent-messages-pre-provider'
export type EstimateScope = string

// Bounded metadata for a binary/image block. The payload itself is never
// carried or persisted by the Runtime core; only type + byte length + hash.
export interface BinaryBlockMetadata {
  readonly type: string
  readonly mimeType?: string
  readonly byteLength: number
  readonly contentHash: string
}

// Provider-neutral bounded descriptor for one message. Raw message text is not
// stored here by default; only the deterministic hash and size metadata are.
// When a research opt-in enables raw capture, `rawPreview` carries a bounded,
// redacted preview (never the full raw payload, never credentials).
export interface ModelMessageDescriptor {
  readonly position: number
  readonly role: string
  readonly contentType: string
  readonly estimatedTokens: number
  readonly estimatedChars: number
  readonly contentHash: string
  readonly toolName?: string
  readonly toolCallId?: string
  readonly isError?: boolean
  readonly binaryBlocks?: readonly BinaryBlockMetadata[]
  readonly rawPreview?: string
}

// Experimental / internal research observation. Deliberately NOT frozen as a
// public contract and NOT persisted in the production SQLite schema.
export interface ModelCallObservation {
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly observedAt: string
  readonly harness: HarnessId

  // What this observation measured. Always `ESTIMATE_SCOPE_AGENT_MESSAGES` for
  // the Pi `context` seam: the AgentMessage[] array seen before provider
  // transformation. This is NOT the complete model/provider context size.
  readonly estimateScope: EstimateScope

  readonly messageCount: number
  readonly observedMessageTokenEstimate: number
  readonly observedMessageCharEstimate: number
  readonly categoryCounts: Record<MessageCategory, number>
  readonly toolResultCount: number
  readonly messageDescriptors: readonly ModelMessageDescriptor[]
}
