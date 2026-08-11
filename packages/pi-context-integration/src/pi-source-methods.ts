// Pi-specific attribution method identifiers and source descriptors. These live
// ONLY in the Pi integration package; the Runtime core never hardcodes them.
import type { AttributionMethodId } from '@canvas-agent/context-runtime'

export const PI_ATTRIBUTION_METHODS = {
  // Pi tool-call event id directly exposes the run event identity.
  TOOL_CALL_ID_EXACT: 'PI_TOOL_CALL_ID_EXACT',
  // Pi tool-result event id directly exposes the run result-event identity.
  TOOL_RESULT_ID_EXACT: 'PI_TOOL_RESULT_ID_EXACT',
  // A structured, known tool argument (e.g. read.path) yields a candidate
  // repository resource hint. Not canonical source identity on its own.
  TOOL_ARGUMENT_PATH_HINT: 'PI_TOOL_ARGUMENT_PATH_HINT'
} as const satisfies Record<string, AttributionMethodId>

// Experimental source descriptor vocabulary for run-event sources admitted from
// the Pi `context` seam.
export const PI_SOURCE_KINDS = {
  RUN_TOOL_CALL: 'RUN_TOOL_CALL',
  RUN_TOOL_RESULT: 'RUN_TOOL_RESULT'
} as const

export const PI_SOURCE_PROVENANCE = {
  CONTEXT_EVENT: 'PI_CONTEXT_EVENT'
} as const
