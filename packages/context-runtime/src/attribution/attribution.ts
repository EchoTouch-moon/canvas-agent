// Provider-neutral source attribution vocabulary. An observed element links to
// zero or more source/event/resource identities with explicit, auditable
// evidence. Attribution is deterministic and structured; never LLM-based.

export const ATTRIBUTION_CONFIDENCE = [
  'EXACT',
  'DERIVED_HINT',
  'UNATTRIBUTED',
  'OPAQUE'
] as const
export type AttributionConfidence = (typeof ATTRIBUTION_CONFIDENCE)[number]

// Agent-neutral attribution method identifier. Integration packages (Pi,
// OpenCode, Codex) define their own method constants; the Runtime core never
// hardcodes a provider-specific method, so a new adapter does not require a
// core change.
export type AttributionMethodId = string

// Generic attribution methods that are meaningful across all agents.
export const GENERIC_ATTRIBUTION_METHODS = {
  // The element has no trustworthy structured identity at this seam.
  NO_TRUSTWORTHY_IDENTITY: 'NO_TRUSTWORTHY_IDENTITY',
  // The element's origin is intentionally unavailable/opaque to this seam.
  ORIGIN_OPAQUE: 'ORIGIN_OPAQUE'
} as const

// A resource hint is a secondary candidate identity derived from structured
// data (e.g. a repository path from read args). It is NOT canonical source
// identity; it stays a hint.
export interface ResourceHint {
  readonly sourceKey: string
  readonly method: AttributionMethodId
  readonly evidenceRefs: readonly string[]
}

export interface SourceAttribution {
  readonly confidence: AttributionConfidence
  // Optional candidate source key. Only present when structured evidence
  // produced a specific identity.
  readonly sourceKey?: string
  readonly method?: AttributionMethodId
  // Machine-readable evidence references (modelCall, messageIndex, toolCallId,
  // argumentField, block, etc.).
  readonly evidenceRefs: readonly string[]
  // Optional secondary derived resource hints attached to this element.
  readonly resourceHints?: readonly ResourceHint[]
}

export const EXACT_ATTRIBUTION = (
  evidence: readonly string[],
  sourceKey: string,
  method: AttributionMethodId
): SourceAttribution => ({
  confidence: 'EXACT',
  sourceKey,
  method,
  evidenceRefs: evidence
})

export const DERIVED_HINT_ATTRIBUTION = (
  evidence: readonly string[],
  sourceKey: string,
  method: AttributionMethodId
): SourceAttribution => ({
  confidence: 'DERIVED_HINT',
  sourceKey,
  method,
  evidenceRefs: evidence
})

export const UNATTRIBUTED_ATTRIBUTION = (evidence: readonly string[]): SourceAttribution => ({
  confidence: 'UNATTRIBUTED',
  method: GENERIC_ATTRIBUTION_METHODS.NO_TRUSTWORTHY_IDENTITY,
  evidenceRefs: evidence
})

export const OPAQUE_ATTRIBUTION = (evidence: readonly string[]): SourceAttribution => ({
  confidence: 'OPAQUE',
  method: GENERIC_ATTRIBUTION_METHODS.ORIGIN_OPAQUE,
  evidenceRefs: evidence
})
