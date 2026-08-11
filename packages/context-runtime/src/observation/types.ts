export type MessageCategory = 'USER' | 'ASSISTANT' | 'TOOL_RESULT' | 'OTHER'

export const MESSAGE_CATEGORIES: readonly MessageCategory[] = [
  'USER',
  'ASSISTANT',
  'TOOL_RESULT',
  'OTHER'
] as const

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
  readonly isError?: boolean
  readonly rawPreview?: string
}

// Experimental / internal research observation. Deliberately NOT frozen as a
// public contract and NOT persisted in the production SQLite schema.
export interface ModelCallObservation {
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly observedAt: string
  readonly harness: 'PI'

  readonly messageCount: number
  readonly nativeContextEstimate: number
  readonly categoryCounts: Record<MessageCategory, number>
  readonly toolResultCount: number
  readonly messageDescriptors: readonly ModelMessageDescriptor[]
}
