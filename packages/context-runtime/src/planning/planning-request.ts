import { sha256Hex } from '../util/hash'

// EXPERIMENTAL / NOT PUBLIC CONTRACT / NOT PERSISTED SCHEMA.

export const TASK_PHASES = [
  'INVESTIGATE',
  'PLAN',
  'IMPLEMENT',
  'DEBUG',
  'VERIFY',
  'GENERAL'
] as const
export type TaskPhase = (typeof TASK_PHASES)[number]

export interface ContextBudget {
  readonly maxSemanticTokens: number
}

// Provider-neutral normalized representation need for one source. The adapter /
// integration layer interprets file/task semantics and produces this normalized
// input; the Runtime core never inspects path suffixes, source-key text
// patterns, Pi tool names, provider payloads or source-kind literals.
export interface ContextRepresentationNeed {
  readonly sourceKey: string
  readonly preferredKind: 'FULL' | 'LINE_RANGE' | 'REFERENCE'
  readonly lineRange?: {
    readonly startLine: number
    readonly endLine: number
  }
  readonly reasonCode: 'DETAIL_REQUIRED' | 'REPRESENTATION_NARROWED' | string
}

export const SOURCE_LIFECYCLE_SIGNAL_KINDS = [
  'RULED_OUT',
  'SUPERSEDED',
  'NEW_FAILURE_EVIDENCE',
  'PHASE_IRRELEVANT',
  'DETAIL_REQUIRED'
] as const
export type SourceLifecycleSignalKind =
  (typeof SOURCE_LIFECYCLE_SIGNAL_KINDS)[number]

// Provider-neutral semantic evidence supplied by an adapter. The policy must
// not infer a lifecycle reason from a generic excludedSourceKeys entry.
export interface SourceLifecycleSignal {
  readonly sourceKey: string
  readonly kind: SourceLifecycleSignalKind
  readonly evidenceRef?: string
}

// Normalized inputs for one planning boundary. No provider-specific message
// payloads; missing task semantics default conservatively (GENERAL, empty
// target lists).
//
// `recentEvidenceSourceKeys` is a provider-neutral semantic signal supplied by
// the integration/adapter layer. It answers "which admitted sources are recent
// trustworthy evidence at this boundary" WITHOUT the Runtime core comparing any
// Pi/OpenCode/Codex literal. The adapter decides provenance/source-kind; the
// core only consumes the normalized key list.
export interface ContextPlanningRequest {
  readonly runtimeSessionId: string
  readonly recompositionSequence: number
  readonly taskPhase?: TaskPhase
  readonly budget: ContextBudget
  readonly pinnedSourceKeys: readonly string[]
  readonly excludedSourceKeys: readonly string[]
  readonly currentTargetSourceKeys: readonly string[]
  readonly latestVerificationSourceKeys: readonly string[]
  // Provider-neutral "recent trustworthy run evidence" keys supplied by the
  // adapter. Core never inspects provenance/source-kind literals.
  readonly recentEvidenceSourceKeys: readonly string[]
  // Structured lifecycle evidence. This preserves why a source changed state;
  // excludedSourceKeys alone is intentionally insufficient to infer RULED_OUT.
  readonly sourceLifecycleSignals?: readonly SourceLifecycleSignal[]
  // Bounded removal/cold history for REHYDRATE correctness. A source is only
  // eligible for REHYDRATE when it was previously active and then removed/cold;
  // a first-time pin/current-target is a plain ADD.
  readonly removalHistory?: readonly RemovalRecord[]
  // Bounded normalized representation needs. Deterministic selection of
  // FULL / LINE_RANGE / REFERENCE for active sources.
  readonly representationNeeds?: readonly ContextRepresentationNeed[]
  readonly previousWorkingSetId: string | null
}

// Provider-neutral record of a prior REMOVE / cold transition. Retains the
// original removal reason and evidence for future false-removal metrics.
export interface RemovalRecord {
  readonly sourceKey: string
  readonly originalRemovalReasonCodes: readonly ReasonCode[]
  readonly removedAtSequence: number
  readonly removedFromWorkingSetId: string | null
}

export function normalizePlanningRequest(
  request: ContextPlanningRequest
): ContextPlanningRequest {
  return {
    runtimeSessionId: request.runtimeSessionId,
    recompositionSequence: request.recompositionSequence,
    ...(request.taskPhase !== undefined ? { taskPhase: request.taskPhase } : {}),
    budget: request.budget,
    pinnedSourceKeys: [...request.pinnedSourceKeys].sort(),
    excludedSourceKeys: [...request.excludedSourceKeys].sort(),
    currentTargetSourceKeys: [...request.currentTargetSourceKeys].sort(),
    latestVerificationSourceKeys: [...request.latestVerificationSourceKeys].sort(),
    recentEvidenceSourceKeys: [...request.recentEvidenceSourceKeys].sort(),
    ...(request.sourceLifecycleSignals !== undefined
      ? {
          sourceLifecycleSignals: [...request.sourceLifecycleSignals].sort(
            (a, b) => {
              const sourceDelta = a.sourceKey.localeCompare(b.sourceKey)
              if (sourceDelta !== 0) return sourceDelta
              const kindDelta = a.kind.localeCompare(b.kind)
              if (kindDelta !== 0) return kindDelta
              return (a.evidenceRef ?? '').localeCompare(b.evidenceRef ?? '')
            }
          )
        }
      : {}),
    ...(request.removalHistory !== undefined
      ? {
          removalHistory: [...request.removalHistory].sort((a, b) =>
            a.sourceKey.localeCompare(b.sourceKey)
          )
        }
      : {}),
    ...(request.representationNeeds !== undefined
      ? {
          representationNeeds: [...request.representationNeeds].sort((a, b) =>
            a.sourceKey.localeCompare(b.sourceKey)
          )
        }
      : {}),
    previousWorkingSetId: request.previousWorkingSetId
  }
}

// Canonical hash of the normalized planning request. policyVersion is supplied
// separately by the planner and participates in plan identity.
export function planningRequestHash(request: ContextPlanningRequest): string {
  const normalized = normalizePlanningRequest(request)
  return sha256Hex(
    [
      'planning-request-v1',
      normalized.runtimeSessionId,
      String(normalized.recompositionSequence),
      normalized.taskPhase ?? 'GENERAL',
      String(normalized.budget.maxSemanticTokens),
      normalized.pinnedSourceKeys.join('|'),
      normalized.excludedSourceKeys.join('|'),
      normalized.currentTargetSourceKeys.join('|'),
      normalized.latestVerificationSourceKeys.join('|'),
      normalized.recentEvidenceSourceKeys.join('|'),
      (normalized.sourceLifecycleSignals ?? [])
        .map(
          (signal) =>
            `${signal.sourceKey}:${signal.kind}:${signal.evidenceRef ?? '-'}`
        )
        .join(';'),
      (normalized.removalHistory ?? [])
        .map(
          (record) =>
            `${record.sourceKey}:${record.originalRemovalReasonCodes.join(',')}:${record.removedAtSequence}`
        )
        .join(';'),
      (normalized.representationNeeds ?? [])
        .map(
          (need) =>
            `${need.sourceKey}:${need.preferredKind}:${need.lineRange !== undefined ? `${need.lineRange.startLine}-${need.lineRange.endLine}` : '-'}:${need.reasonCode}`
        )
        .join(';'),
      normalized.previousWorkingSetId ?? '-'
    ].join('\u241F')
  )
}

// Machine-readable decision reason codes. Lifecycle reason codes are recorded
// as CSPV-B1 research evidence; this remains an experimental input vocabulary,
// not a public persistence schema.
export const REASON_CODES = [
  'MANDATORY_INSTRUCTION',
  'USER_PINNED',
  'CURRENT_TARGET',
  'LATEST_FAILURE',
  'PREVIOUSLY_ACTIVE',
  'PREVIOUSLY_REMOVED',
  'RECENT_RUN_EVIDENCE',
  'SOURCE_ABSENT',
  'SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP',
  'BUDGET_PRESSURE',
  'REHYDRATION_TRIGGERED',
  'EXPLICIT_EXCLUDE',
  'RULED_OUT',
  'SUPERSEDED',
  'NEW_FAILURE_EVIDENCE',
  'PHASE_IRRELEVANT',
  'REPRESENTATION_NARROWED',
  'DETAIL_REQUIRED',
  'SOURCE_VERSION_ADVANCED'
] as const
export type ReasonCode = (typeof REASON_CODES)[number]
