import {
  C1_E0_PAIR_COUNT,
  C1_E0_MIN_NON_ZERO_DISTINCT_TASKS,
  C1_E0_MIN_NON_ZERO_TREATMENT_PAIRS
} from './c1-e0-binding'
import { type C1E0DoseSummary, validateC1E0DoseObservation } from './c1-e0-dose'

export const C1_E0_READINESS_ID = 'C1_EFFECTIVENESS_E0_READINESS_V1'

export const C1_E0_RUNTIME_FORBIDDEN_INPUTS = Object.freeze([
  'changedPaths',
  'expectedWritablePaths',
  'taskManifestLabel',
  'removalGroundTruth',
  'objectiveOracle',
  'regressionOracle',
  'historicalStaleLabels',
  'v4PrevalenceResults',
  'taskAnswer',
  'referenceFixture',
  'reportArtifact'
] as const)

export const C1_E0_RUNTIME_ALLOWED_INPUTS = Object.freeze([
  'modelVisibleMessages',
  'toolRequests',
  'toolExecutionResults',
  'versionProbeFingerprints',
  'runtimeTransitionEvidence',
  'carriedRemovalEvidence'
] as const)

export interface C1E0RuntimePolicyInput {
  readonly modelVisibleMessages: unknown
  readonly toolRequests: unknown
  readonly toolExecutionResults: unknown
  readonly versionProbeFingerprints: unknown
  readonly runtimeTransitionEvidence: unknown
  readonly carriedRemovalEvidence: unknown
}

export type C1E0FailureSignal =
  'TASK_OUTCOME' | 'ISOLATED_HARNESS_FAILURE' | 'EXPERIMENT_INVALIDATOR'

export interface C1E0ResponseEvidenceStatus {
  readonly status: 'OBSERVED' | 'UNKNOWN'
  readonly usage: 'AVAILABLE' | 'UNKNOWN' | 'UNAVAILABLE'
  readonly zeroSubstitutionAllowed: false
}

export type C1E0UsageEvidenceStatus = 'AVAILABLE' | 'UNAVAILABLE'

export interface C1E0ResponseEvidenceInput {
  readonly responseRecorded: boolean
  readonly usageStatus: C1E0UsageEvidenceStatus
}

export function classifyC1E0ResponseEvidence(
  input: C1E0ResponseEvidenceInput
): C1E0ResponseEvidenceStatus {
  if (!input.responseRecorded) {
    return { status: 'UNKNOWN', usage: 'UNKNOWN', zeroSubstitutionAllowed: false }
  }
  return {
    status: 'OBSERVED',
    usage: input.usageStatus,
    zeroSubstitutionAllowed: false
  }
}

export function shouldRunC1E0Counterpart(signal: C1E0FailureSignal): boolean {
  return signal !== 'EXPERIMENT_INVALIDATOR'
}

export function assertC1E0RuntimePolicyInput(
  value: unknown
): asserts value is C1E0RuntimePolicyInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      'E0 runtime policy input allowlist violation: top-level value must be an object'
    )
  }
  const record = value as Record<string, unknown>
  const allowed = new Set<string>(C1_E0_RUNTIME_ALLOWED_INPUTS)
  const keys = Object.keys(record)
  const unknownTopLevel = keys.filter((key) => !allowed.has(key)).sort()
  const missingTopLevel = C1_E0_RUNTIME_ALLOWED_INPUTS.filter(
    (key) => !Object.prototype.hasOwnProperty.call(record, key)
  )
  if (unknownTopLevel.length > 0 || missingTopLevel.length > 0) {
    const details = [
      ...(unknownTopLevel.length > 0
        ? [`unknown top-level source(s): ${unknownTopLevel.join(', ')}`]
        : []),
      ...(missingTopLevel.length > 0
        ? [`missing top-level source(s): ${missingTopLevel.join(', ')}`]
        : [])
    ]
    throw new Error(`E0 runtime policy input allowlist violation: ${details.join('; ')}`)
  }

  const forbidden = new Set<string>()
  const visit = (candidate: unknown): void => {
    if (typeof candidate !== 'object' || candidate === null) return
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    for (const [key, child] of Object.entries(candidate)) {
      if ((C1_E0_RUNTIME_FORBIDDEN_INPUTS as readonly string[]).includes(key)) forbidden.add(key)
      visit(child)
    }
  }
  visit(record)
  if (forbidden.size > 0) {
    throw new Error(`E0 ground-truth leakage detected: ${[...forbidden].sort().join(', ')}`)
  }
}

export function validateC1E0RuntimePolicyInput(value: unknown): C1E0RuntimePolicyInput {
  assertC1E0RuntimePolicyInput(value)
  return value
}

export interface C1E0TreatmentIntegrityInput {
  readonly dose: C1E0DoseSummary
  readonly replayVerdict: 'MATCH' | 'CONTRACT_CONFLICT' | 'UNKNOWN'
  readonly envelopePreserved: boolean
  readonly protectedEvidenceRemoved: boolean
  readonly noFallback: boolean
  readonly checkpointComplete: boolean
  readonly runtimePolicyInput?: Record<string, unknown>
}

export interface C1E0TreatmentIntegrityResult {
  readonly verdict: 'PASS' | 'FAIL' | 'INACTIVE'
  readonly reasons: readonly string[]
}

/** Evaluate Layer 1 without consulting task or oracle outcomes. */
export function evaluateC1E0TreatmentIntegrity(
  input: C1E0TreatmentIntegrityInput
): C1E0TreatmentIntegrityResult {
  const reasons: string[] = []
  const inactiveDose =
    input.dose.uniqueEligiblePairs.length === 0 || input.dose.uniqueRemovedPairs.length === 0
  if (input.runtimePolicyInput !== undefined) {
    try {
      assertC1E0RuntimePolicyInput(input.runtimePolicyInput)
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (!inactiveDose && input.dose.runtimeContextChangedCalls === 0) {
    reasons.push('provider-bound context did not change')
  }
  if (!inactiveDose && input.dose.treatmentExposureRatio === 'NOT_ESTIMABLE') {
    reasons.push('treatment exposure ratio is not estimable')
  }
  if (input.dose.rehydrateCount > 0) reasons.push('unexpected rehydrate')
  if (input.dose.protectedRemovalCount > 0 || input.protectedEvidenceRemoved) {
    reasons.push('protected evidence was removed')
  }
  if (input.dose.contractConflictCount > 0 || input.replayVerdict === 'CONTRACT_CONFLICT') {
    reasons.push('replay/policy contract conflict')
  }
  if (input.replayVerdict === 'CONTRACT_CONFLICT') {
    reasons.push(`replay verdict=${input.replayVerdict}`)
  } else if (!inactiveDose && input.replayVerdict !== 'MATCH') {
    reasons.push(`replay verdict=${input.replayVerdict}`)
  }
  if (!input.envelopePreserved) reasons.push('provider envelope drifted')
  if (!input.noFallback) reasons.push('silent fallback or arm substitution')
  if (!input.checkpointComplete) reasons.push('evidence checkpoint join incomplete')
  if (reasons.length > 0) {
    return {
      verdict: 'FAIL',
      reasons: Object.freeze(reasons)
    }
  }
  if (inactiveDose) {
    return { verdict: 'INACTIVE', reasons: Object.freeze(['no non-zero treatment dose']) }
  }
  return { verdict: 'PASS', reasons: Object.freeze([]) }
}

export interface C1E0BatchQualificationInput {
  readonly pairCount: number
  readonly completedPairCount: number
  readonly nonZeroTreatmentPairTaskIds: readonly string[]
  readonly experimentInvalidator?: boolean
}

export interface C1E0BatchQualificationResult {
  readonly verdict: 'PASS' | 'INCONCLUSIVE' | 'NO_GO'
  readonly reasons: readonly string[]
  readonly nonZeroTreatmentPairs: number
  readonly nonZeroDistinctTasks: number
}

export function evaluateC1E0BatchQualification(
  input: C1E0BatchQualificationInput
): C1E0BatchQualificationResult {
  const nonZeroDistinctTasks = new Set(input.nonZeroTreatmentPairTaskIds).size
  const result = {
    nonZeroTreatmentPairs: input.nonZeroTreatmentPairTaskIds.length,
    nonZeroDistinctTasks
  }
  if (input.experimentInvalidator === true) {
    return {
      ...result,
      verdict: 'NO_GO',
      reasons: Object.freeze(['experiment invalidator prevents E0 qualification'])
    }
  }
  const reasons: string[] = []
  if (input.pairCount !== C1_E0_PAIR_COUNT) {
    reasons.push(`pair count=${input.pairCount}; expected ${C1_E0_PAIR_COUNT}`)
  }
  if (input.completedPairCount !== input.pairCount) {
    reasons.push('not all frozen pairs have complete pair-level status')
  }
  if (result.nonZeroTreatmentPairs < C1_E0_MIN_NON_ZERO_TREATMENT_PAIRS) {
    reasons.push(`nonZeroTreatmentPairs<${C1_E0_MIN_NON_ZERO_TREATMENT_PAIRS}`)
  }
  if (result.nonZeroDistinctTasks < C1_E0_MIN_NON_ZERO_DISTINCT_TASKS) {
    reasons.push(`nonZeroDistinctTasks<${C1_E0_MIN_NON_ZERO_DISTINCT_TASKS}`)
  }
  if (reasons.length > 0) {
    return { ...result, verdict: 'INCONCLUSIVE', reasons: Object.freeze(reasons) }
  }
  return { ...result, verdict: 'PASS', reasons: Object.freeze([]) }
}

export interface C1E0ReadinessScenarioResult {
  readonly scenarioId: string
  readonly verdict: 'PASS' | 'FAIL'
  readonly counterpartRuns: boolean
  readonly expected: string
}

/**
 * Small, provider-free decision helpers used by the E0 readiness matrix.
 * The actual task runner remains separate; these helpers make the frozen
 * counterpart and integrity semantics executable and testable.
 */
export function evaluateC1E0ReadinessScenario(input: {
  readonly scenarioId: string
  readonly failureSignal?: C1E0FailureSignal
  readonly integrity?: C1E0TreatmentIntegrityInput
  readonly expected: string
}): C1E0ReadinessScenarioResult {
  const counterpartRuns =
    input.failureSignal === undefined || shouldRunC1E0Counterpart(input.failureSignal)
  const verdict =
    input.integrity === undefined
      ? 'PASS'
      : evaluateC1E0TreatmentIntegrity(input.integrity).verdict === 'PASS'
        ? 'PASS'
        : 'FAIL'
  return { scenarioId: input.scenarioId, verdict, counterpartRuns, expected: input.expected }
}

export function validateC1E0ReadinessDose(value: unknown): C1E0DoseSummary {
  const observation = validateC1E0DoseObservation(value)
  return {
    schemaId: 'C1_EFFECTIVENESS_DOSE_V1',
    schemaVersion: 1,
    runtimeOutboundCalls: 1,
    runtimeContextChangedCalls: observation.runtimeContextChanged ? 1 : 0,
    uniqueEligiblePairs: observation.uniqueEligiblePairIds,
    uniqueSelectedPairs: observation.uniqueSelectedPairIds,
    uniqueRemovedPairs: observation.uniqueRemovedPairIds,
    uniqueRemovedSourceElements: observation.uniqueRemovedSourceElementKeys,
    newRemovalPairCalls: observation.newRemovalPairIds.length,
    carriedRemovalPairCalls: observation.carriedRemovalPairIds.length,
    suppressedStalePairCallExposures: observation.suppressedStalePairCallExposures,
    suppressedSourceElementCallExposures: observation.suppressedSourceElementCallExposures,
    treatmentExposureRatio: observation.runtimeContextChanged ? 1 : 0,
    tokensBeforeComposition: observation.tokensBeforeComposition,
    tokensAfterComposition: observation.tokensAfterComposition,
    removedBytes: observation.removedBytes,
    removedTokens: observation.removedTokens,
    removedTokenRatio:
      typeof observation.removedTokens === 'number' &&
      typeof observation.tokensBeforeComposition === 'number' &&
      observation.tokensBeforeComposition > 0
        ? observation.removedTokens / observation.tokensBeforeComposition
        : 'NOT_ESTIMABLE',
    activeStaleElementsPeak: observation.activeStaleElements,
    rehydrateCount: observation.rehydrateCount,
    lifecycleUnknownCountByReason: observation.lifecycleUnknownCountByReason,
    protectedRemovalCount: observation.protectedRemovalCount,
    contractConflictCount: observation.contractConflictCount
  }
}
