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

// Normalized inputs for one planning boundary. No provider-specific message
// payloads; missing task semantics default conservatively (GENERAL, empty
// target lists).
export interface ContextPlanningRequest {
  readonly runtimeSessionId: string
  readonly recompositionSequence: number
  readonly taskPhase?: TaskPhase
  readonly budget: ContextBudget
  readonly pinnedSourceKeys: readonly string[]
  readonly excludedSourceKeys: readonly string[]
  readonly currentTargetSourceKeys: readonly string[]
  readonly latestVerificationSourceKeys: readonly string[]
  readonly previousWorkingSetId: string | null
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
      normalized.previousWorkingSetId ?? '-'
    ].join('\u241F')
  )
}

// Machine-readable decision reason codes. New experimental codes are recorded as
// provisional CR-003 evidence; PROPOSAL-031 is not treated as frozen.
export const REASON_CODES = [
  'MANDATORY_INSTRUCTION',
  'USER_PINNED',
  'CURRENT_TARGET',
  'LATEST_FAILURE',
  'PREVIOUSLY_ACTIVE',
  'RECENT_RUN_EVIDENCE',
  'SOURCE_ABSENT',
  'SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP',
  'BUDGET_PRESSURE',
  'REHYDRATION_TRIGGERED',
  'EXPLICIT_EXCLUDE'
] as const
export type ReasonCode = (typeof REASON_CODES)[number]
