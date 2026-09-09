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

export type C1E0FailureSignal =
  'TASK_OUTCOME' | 'ISOLATED_HARNESS_FAILURE' | 'EXPERIMENT_INVALIDATOR'

export interface C1E0ResponseEvidenceStatus {
  readonly status: 'OBSERVED' | 'UNKNOWN'
  readonly usage: 'AVAILABLE' | 'UNKNOWN'
  readonly zeroSubstitutionAllowed: false
}

export function classifyC1E0ResponseEvidence(
  responseRecorded: boolean
): C1E0ResponseEvidenceStatus {
  return responseRecorded
    ? { status: 'OBSERVED', usage: 'AVAILABLE', zeroSubstitutionAllowed: false }
    : { status: 'UNKNOWN', usage: 'UNKNOWN', zeroSubstitutionAllowed: false }
}

export function shouldRunC1E0Counterpart(signal: C1E0FailureSignal): boolean {
  return signal !== 'EXPERIMENT_INVALIDATOR'
}

export function assertC1E0RuntimePolicyInput(value: Record<string, unknown>): void {
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
  visit(value)
  if (forbidden.size > 0) {
    throw new Error(`E0 ground-truth leakage detected: ${[...forbidden].sort().join(', ')}`)
  }
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
  if (input.runtimePolicyInput !== undefined) {
    try {
      assertC1E0RuntimePolicyInput(input.runtimePolicyInput)
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (input.dose.uniqueEligiblePairs.length === 0 || input.dose.uniqueRemovedPairs.length === 0) {
    reasons.push('no non-zero treatment dose')
  }
  if (input.dose.runtimeContextChangedCalls === 0) {
    reasons.push('provider-bound context did not change')
  }
  if (input.dose.treatmentExposureRatio === 'NOT_ESTIMABLE') {
    reasons.push('treatment exposure ratio is not estimable')
  }
  if (input.dose.rehydrateCount > 0) reasons.push('unexpected rehydrate')
  if (input.dose.protectedRemovalCount > 0 || input.protectedEvidenceRemoved) {
    reasons.push('protected evidence was removed')
  }
  if (input.dose.contractConflictCount > 0 || input.replayVerdict === 'CONTRACT_CONFLICT') {
    reasons.push('replay/policy contract conflict')
  }
  if (input.replayVerdict !== 'MATCH') reasons.push(`replay verdict=${input.replayVerdict}`)
  if (!input.envelopePreserved) reasons.push('provider envelope drifted')
  if (!input.noFallback) reasons.push('silent fallback or arm substitution')
  if (!input.checkpointComplete) reasons.push('evidence checkpoint join incomplete')
  if (reasons.length > 0) {
    return {
      verdict:
        input.dose.uniqueEligiblePairs.length === 0 || input.dose.uniqueRemovedPairs.length === 0
          ? 'INACTIVE'
          : 'FAIL',
      reasons: Object.freeze(reasons)
    }
  }
  return { verdict: 'PASS', reasons: Object.freeze([]) }
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
