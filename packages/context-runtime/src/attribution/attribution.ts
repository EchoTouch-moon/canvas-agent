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

// Deterministic method identifiers describing HOW a source key was derived.
export const ATTRIBUTION_METHODS = [
  // Pi tool-call event id directly exposes the run event identity.
  'PI_TOOL_CALL_ID_EXACT',
  // Pi tool-result event id directly exposes the run result-event identity.
  'PI_TOOL_RESULT_ID_EXACT',
  // A structured, known tool argument (e.g. read.path) yields a candidate
  // repository resource hint. Not canonical source identity on its own.
  'PI_TOOL_ARGUMENT_PATH_HINT',
  // The element has no trustworthy structured identity at this seam.
  'NO_TRUSTWORTHY_IDENTITY',
  // The element's origin is intentionally unavailable/opaque to this seam.
  'ORIGIN_OPAQUE'
] as const
export type AttributionMethod = (typeof ATTRIBUTION_METHODS)[number]

// A resource hint is a secondary candidate identity derived from structured
// data (e.g. a repository path from read args). It is NOT canonical source
// identity; it stays a hint.
export interface ResourceHint {
  readonly sourceKey: string
  readonly method: AttributionMethod
  readonly evidenceRefs: readonly string[]
}

export interface SourceAttribution {
  readonly confidence: AttributionConfidence
  // Optional candidate source key. Only present when structured evidence
  // produced a specific identity.
  readonly sourceKey?: string
  readonly method?: AttributionMethod
  // Machine-readable evidence references (modelCall, messageIndex, toolCallId,
  // argumentField, block, etc.).
  readonly evidenceRefs: readonly string[]
  // Optional secondary derived resource hints attached to this element.
  readonly resourceHints?: readonly ResourceHint[]
}

export const EXACT_ATTRIBUTION = (evidence: readonly string[], sourceKey: string, method: AttributionMethod): SourceAttribution => ({
  confidence: 'EXACT',
  sourceKey,
  method,
  evidenceRefs: evidence
})

export const DERIVED_HINT_ATTRIBUTION = (
  evidence: readonly string[],
  sourceKey: string,
  method: AttributionMethod
): SourceAttribution => ({
  confidence: 'DERIVED_HINT',
  sourceKey,
  method,
  evidenceRefs: evidence
})

export const UNATTRIBUTED_ATTRIBUTION = (evidence: readonly string[]): SourceAttribution => ({
  confidence: 'UNATTRIBUTED',
  method: 'NO_TRUSTWORTHY_IDENTITY',
  evidenceRefs: evidence
})

export const OPAQUE_ATTRIBUTION = (evidence: readonly string[]): SourceAttribution => ({
  confidence: 'OPAQUE',
  method: 'ORIGIN_OPAQUE',
  evidenceRefs: evidence
})
