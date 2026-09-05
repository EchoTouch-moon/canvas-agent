export const C1_ANALYSIS_STRATA = Object.freeze([
  'localized_investigation_distractors',
  'multi_file_multi_source',
  'failure_diagnosis_recovery',
  'delayed_context_recovery'
] as const)

export type C1AnalysisStratum = (typeof C1_ANALYSIS_STRATA)[number]
export type C1AnalysisDecision = 'BETTER' | 'WORSE' | 'TRADE_OFF' | 'INCONCLUSIVE'
export type C1AnalysisEndpointStatus = 'ESTIMABLE' | 'NOT_ESTIMABLE' | 'NOT_APPLICABLE'
export type C1AnalysisArm = 'NATIVE' | 'RUNTIME'
export type C1AnalysisTaskOutcome = 'SUCCESS' | 'FAILURE' | 'NOT_OBSERVED'
export type C1AnalysisStudyStatus =
  'COMPLETED' | 'STOPPED' | 'HARNESS_CONTRACT_FAILURE' | 'INFRASTRUCTURE_FAILURE'

export type C1AnalysisLegStatus =
  'COMPLETED' | 'INFRASTRUCTURE_FAILURE' | 'HARNESS_CONTRACT_FAILURE' | 'ABORTED' | 'STOPPED'

export type C1AnalysisMetric =
  | {
      readonly status: 'REPORTED'
      readonly value: number
    }
  | {
      readonly status: 'UNAVAILABLE'
      readonly reason: 'NOT_REPORTED_BY_PROVIDER' | 'MISSING_EVIDENCE'
    }

export type C1AnalysisLifecycleMeasurement =
  | {
      readonly status: 'ESTIMABLE'
      readonly numerator: number
      readonly denominator: number
    }
  | {
      readonly status: 'NOT_ESTIMABLE'
      readonly reason: string
    }
  | {
      readonly status: 'NOT_APPLICABLE'
      readonly reason: string
    }

export interface C1AnalysisLifecycleEvidence {
  readonly removalPrecision: C1AnalysisLifecycleMeasurement
  readonly rehydrationRecoveryRate: C1AnalysisLifecycleMeasurement
  readonly coldContextPenalty: C1AnalysisColdContextPenaltyEvidence
}

export interface C1AnalysisColdContextInterval {
  /** Non-negative interval values; the derived penalty may be signed. */
  readonly inputTokens: number
  readonly toolCalls: number
  readonly wallClockMs: number
}

export type C1AnalysisColdContextPenaltyEvidence =
  | {
      readonly status: 'ESTIMABLE'
      readonly native: C1AnalysisColdContextInterval
      readonly runtime: C1AnalysisColdContextInterval
      readonly anchorA: string
      readonly anchorB: string
      readonly runtimeOriginatingRemoveTransitionId: string
      readonly runtimeRehydrateTransitionId: string
      readonly lineageValid: true
    }
  | {
      readonly status: 'NOT_ESTIMABLE'
      readonly reason: string
    }
  | {
      readonly status: 'NOT_APPLICABLE'
      readonly reason: string
    }

export type C1RuntimeTreatmentState = 'ACTIVE' | 'INACTIVE' | 'NO_OPPORTUNITY'

export interface C1AnalysisLeg {
  readonly arm: C1AnalysisArm
  readonly legStatus: C1AnalysisLegStatus
  readonly taskOutcome: C1AnalysisTaskOutcome
  readonly inputTokens: C1AnalysisMetric
  /** Required provider-reported core usage retained for evidence completeness. */
  readonly outputTokens: C1AnalysisMetric
  readonly totalTokens: C1AnalysisMetric
  readonly toolCalls: C1AnalysisMetric
  readonly wallClockMs: C1AnalysisMetric
  /** Required for Runtime legs; Native legs must omit it. */
  readonly runtimeTreatment?: C1RuntimeTreatmentState
}

export interface C1AnalysisPair {
  readonly pairId: string
  readonly stratum: C1AnalysisStratum
  readonly native: C1AnalysisLeg
  readonly runtime: C1AnalysisLeg
  readonly lifecycle: C1AnalysisLifecycleEvidence
  /** True only when a lifecycle event was observed without its required evidence. */
  readonly lifecycleEvidenceIssue?: boolean
}

export interface C1AnalysisStudy {
  readonly studyStatus: C1AnalysisStudyStatus
  readonly pairs: readonly C1AnalysisPair[]
  /** A shared external failure prevents attribution and therefore selects INCONCLUSIVE. */
  readonly sharedExternalFailure?: boolean
}

export interface C1PrimaryPairExclusion {
  readonly pairId: string
  readonly reason: 'LEG_NOT_COMPLETED' | 'INPUT_USAGE_UNAVAILABLE' | 'NATIVE_DENOMINATOR_ZERO'
}

export interface C1StratumPrimaryAnalysis {
  readonly stratum: C1AnalysisStratum
  readonly observedPairs: number
  readonly eligiblePairs: number
  readonly missingUsagePairs: number
  readonly medianDelta: number | null
  readonly medianReduction: number | null
  readonly signFlipPValue: number | null
  readonly exclusions: readonly C1PrimaryPairExclusion[]
  readonly minimumCoveragePass: boolean
  readonly betterCoveragePass: boolean
}

export interface C1PrimaryAnalysis {
  readonly endpointId: 'provider_input_tokens'
  readonly status: 'ESTIMABLE' | 'NOT_ESTIMABLE'
  readonly strata: readonly C1StratumPrimaryAnalysis[]
  readonly pooledEligiblePairs: number
  readonly pooledMedianReduction: number | null
  readonly fisherCombinedPValue: number | null
  readonly minimumCoveragePass: boolean
  readonly betterCoveragePass: boolean
  readonly qualifies: boolean
}

export interface C1SecondaryMetricAnalysis {
  readonly endpointId: 'provider_total_tokens' | 'tool_calls' | 'wall_clock_ms'
  readonly status: 'ESTIMABLE' | 'NOT_ESTIMABLE'
  readonly eligiblePairs: number
  readonly minimumCoveragePass: boolean
  readonly nativeMedian: number | null
  readonly runtimeMedian: number | null
  /** Median of (Runtime - Native) computed within each matched pair. */
  readonly pairedMedianDifference: number | null
  /** Paired median difference divided by the frozen Native-median denominator. */
  readonly pairedMedianRelativeIncrease: number | null
  readonly materialRegression: boolean
}

export interface C1OutcomeAnalysis {
  readonly nativeTaskFailures: number
  readonly runtimeTaskFailures: number
  readonly additionalRuntimeFailures: number
  readonly perStratumNonInferiorityPass: boolean
  readonly pooledNonInferiorityPass: boolean
  readonly nonInferiorityPass: boolean
  readonly additionalRuntimeTaskFailure: boolean
}

export interface C1ReliabilityAnalysis {
  readonly nativeInvalidLegs: number
  readonly runtimeInvalidLegs: number
  /** Includes incomplete core provider-usage evidence, not only stopped legs. */
  readonly nativeEvidenceAttrition: number
  readonly runtimeEvidenceAttrition: number
  readonly runtimeOperationalSuccessMinimumPass: boolean
  readonly betterInvalidLegGatePass: boolean
}

export interface C1LifecycleRateEndpointAnalysis {
  readonly endpointId: 'removal_precision' | 'rehydration_recovery_rate'
  readonly status: C1AnalysisEndpointStatus
  readonly numerator: number | null
  readonly denominator: number | null
  readonly value: number | null
  readonly notEstimableCount: number
  readonly notApplicableCount: number
}

export interface C1ColdContextPenaltyAnalysis {
  readonly endpointId: 'cold_context_penalty'
  readonly status: C1AnalysisEndpointStatus
  readonly eligiblePairs: number
  /** Runtime interval minus Native interval, preserving the physical unit. */
  readonly medianInputTokenDelta: number | null
  readonly medianToolCallDelta: number | null
  readonly medianWallClockDeltaMs: number | null
  readonly notEstimableCount: number
  readonly notApplicableCount: number
}

export type C1LifecycleEndpointAnalysis =
  C1LifecycleRateEndpointAnalysis | C1ColdContextPenaltyAnalysis

export interface C1StratumAnalysis {
  readonly stratum: C1AnalysisStratum
  readonly observedPairs: number
  readonly primary: C1StratumPrimaryAnalysis
  readonly secondary: readonly C1SecondaryMetricAnalysis[]
  readonly lifecycle: readonly C1LifecycleEndpointAnalysis[]
  readonly nativeInvalidLegs: number
  readonly runtimeInvalidLegs: number
  readonly nativeTaskFailures: number
  readonly runtimeTaskFailures: number
}

export interface C1OfflineAnalysisResult {
  readonly analysisId: 'C1_OFFLINE_ADJUDICATOR_V1'
  readonly schemaVersion: 1
  readonly providerCalls: 0
  readonly networkRequests: 0
  readonly studyStatus: C1AnalysisStudyStatus
  readonly analysisStatus: 'COMPLETE' | 'INCONCLUSIVE'
  readonly failureClassification:
    | 'NONE'
    | 'HARNESS_CONTRACT_FAILURE'
    | 'INFRASTRUCTURE_FAILURE'
    | 'STUDY_STOPPED'
    | 'SHARED_EXTERNAL_FAILURE'
  readonly failureReasons: readonly string[]
  readonly overallDecision: C1AnalysisDecision
  readonly treatmentActive: boolean
  readonly primary: C1PrimaryAnalysis
  readonly secondary: readonly C1SecondaryMetricAnalysis[]
  readonly outcomes: C1OutcomeAnalysis
  readonly reliability: C1ReliabilityAnalysis
  readonly lifecycle: readonly C1LifecycleEndpointAnalysis[]
  readonly strata: readonly C1StratumAnalysis[]
  readonly decisionReasons: readonly string[]
}

export class C1OfflineAnalysisInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'C1OfflineAnalysisInputError'
  }
}

export function reportedC1AnalysisMetric(value: number): C1AnalysisMetric {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new C1OfflineAnalysisInputError('reported analysis metric must be a non-negative integer')
  }
  return { status: 'REPORTED', value }
}

export function unavailableC1AnalysisMetric(
  reason: 'NOT_REPORTED_BY_PROVIDER' | 'MISSING_EVIDENCE' = 'MISSING_EVIDENCE'
): C1AnalysisMetric {
  return { status: 'UNAVAILABLE', reason }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted[middle - (sorted.length % 2 === 0 ? 1 : 0)]
  const upper = sorted[middle]
  if (lower === undefined || upper === undefined) {
    throw new C1OfflineAnalysisInputError('median received an invalid value set')
  }
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper
}

function validateMetric(metric: C1AnalysisMetric, label: string): void {
  if (metric.status === 'REPORTED') {
    if (!Number.isSafeInteger(metric.value) || metric.value < 0) {
      throw new C1OfflineAnalysisInputError(`${label} is not a non-negative integer`)
    }
    return
  }
  if (metric.reason !== 'NOT_REPORTED_BY_PROVIDER' && metric.reason !== 'MISSING_EVIDENCE') {
    throw new C1OfflineAnalysisInputError(`${label} has an unsupported unavailable reason`)
  }
}

function validateLifecycleMeasurement(
  measurement: C1AnalysisLifecycleMeasurement,
  label: string
): void {
  if (measurement.status !== 'ESTIMABLE') return
  if (
    !Number.isSafeInteger(measurement.numerator) ||
    !Number.isSafeInteger(measurement.denominator) ||
    measurement.numerator < 0 ||
    measurement.denominator <= 0 ||
    measurement.numerator > measurement.denominator
  ) {
    throw new C1OfflineAnalysisInputError(`${label} has an invalid numerator/denominator`)
  }
}

function validateColdContextInterval(interval: C1AnalysisColdContextInterval, label: string): void {
  for (const key of ['inputTokens', 'toolCalls', 'wallClockMs'] as const) {
    const value = interval[key]
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new C1OfflineAnalysisInputError(`${label}.${key} must be a non-negative integer`)
    }
  }
}

function validateColdContextEvidence(
  evidence: C1AnalysisColdContextPenaltyEvidence,
  label: string
): void {
  if (evidence.status !== 'ESTIMABLE') return
  validateColdContextInterval(evidence.native, `${label}.native`)
  validateColdContextInterval(evidence.runtime, `${label}.runtime`)
  for (const [key, value] of Object.entries({
    anchorA: evidence.anchorA,
    anchorB: evidence.anchorB,
    runtimeOriginatingRemoveTransitionId: evidence.runtimeOriginatingRemoveTransitionId,
    runtimeRehydrateTransitionId: evidence.runtimeRehydrateTransitionId
  })) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new C1OfflineAnalysisInputError(`${label}.${key} must be a non-empty string`)
    }
  }
  if (evidence.lineageValid !== true) {
    throw new C1OfflineAnalysisInputError(`${label} must carry valid REMOVE/REHYDRATE lineage`)
  }
}

function validateLeg(leg: C1AnalysisLeg, expectedArm: C1AnalysisArm, label: string): void {
  if (leg.arm !== expectedArm) throw new C1OfflineAnalysisInputError(`${label} arm mismatch`)
  const completed = leg.legStatus === 'COMPLETED'
  if (completed && leg.taskOutcome === 'NOT_OBSERVED') {
    throw new C1OfflineAnalysisInputError(`${label} completed leg has no task outcome`)
  }
  if (!completed && leg.taskOutcome !== 'NOT_OBSERVED') {
    throw new C1OfflineAnalysisInputError(`${label} invalid leg has an observed task outcome`)
  }
  if (expectedArm === 'NATIVE' && leg.runtimeTreatment !== undefined) {
    throw new C1OfflineAnalysisInputError(
      `${label} Native leg must not carry Runtime treatment state`
    )
  }
  if (expectedArm === 'RUNTIME' && leg.runtimeTreatment === undefined) {
    throw new C1OfflineAnalysisInputError(`${label} Runtime leg is missing treatment state`)
  }
  validateMetric(leg.inputTokens, `${label}.inputTokens`)
  validateMetric(leg.outputTokens, `${label}.outputTokens`)
  validateMetric(leg.totalTokens, `${label}.totalTokens`)
  validateMetric(leg.toolCalls, `${label}.toolCalls`)
  validateMetric(leg.wallClockMs, `${label}.wallClockMs`)
}

function validateStudyInput(study: C1AnalysisStudy): void {
  const pairIds = new Set<string>()
  for (const pair of study.pairs) {
    if (pairIds.has(pair.pairId)) {
      throw new C1OfflineAnalysisInputError(`duplicate pair ${pair.pairId}`)
    }
    pairIds.add(pair.pairId)
    if (!C1_ANALYSIS_STRATA.includes(pair.stratum)) {
      throw new C1OfflineAnalysisInputError(`unknown stratum ${pair.stratum}`)
    }
    validateLeg(pair.native, 'NATIVE', `${pair.pairId}.native`)
    validateLeg(pair.runtime, 'RUNTIME', `${pair.pairId}.runtime`)
    validateLifecycleMeasurement(pair.lifecycle.removalPrecision, `${pair.pairId}.removalPrecision`)
    validateLifecycleMeasurement(
      pair.lifecycle.rehydrationRecoveryRate,
      `${pair.pairId}.rehydrationRecoveryRate`
    )
    validateColdContextEvidence(
      pair.lifecycle.coldContextPenalty,
      `${pair.pairId}.coldContextPenalty`
    )
  }
}

function signFlipPValue(deltas: readonly number[]): number | null {
  if (deltas.length === 0) return null
  if (deltas.length > 8) {
    throw new C1OfflineAnalysisInputError('stratum sign-flip enumeration exceeds frozen n=8 bound')
  }
  const magnitudes = deltas.map((delta) => Math.abs(delta))
  const observed = deltas.reduce((sum, delta) => sum + delta, 0)
  const assignmentCount = 2 ** magnitudes.length
  let extremeCount = 0
  for (let assignment = 0; assignment < assignmentCount; assignment += 1) {
    let statistic = 0
    for (let index = 0; index < magnitudes.length; index += 1) {
      const magnitude = magnitudes[index]
      if (magnitude === undefined)
        throw new C1OfflineAnalysisInputError('missing sign-flip magnitude')
      statistic += (assignment & (1 << index)) === 0 ? -magnitude : magnitude
    }
    if (statistic >= observed) extremeCount += 1
  }
  return extremeCount / assignmentCount
}

function fisherCombinedPValue(pValues: readonly number[]): number | null {
  if (pValues.length === 0) return null
  const statistic = -2 * pValues.reduce((sum, value) => sum + Math.log(value), 0)
  const k = pValues.length
  const x = statistic / 2
  let series = 0
  let term = 1
  for (let index = 0; index < k; index += 1) {
    if (index > 0) term *= x / index
    series += term
  }
  return Math.min(1, Math.max(0, Math.exp(-x) * series))
}

function metricValue(metric: C1AnalysisMetric): number | null {
  return metric.status === 'REPORTED' ? metric.value : null
}

function legHasEvidenceAttrition(leg: C1AnalysisLeg): boolean {
  if (leg.legStatus !== 'COMPLETED') return true
  return [leg.inputTokens, leg.outputTokens, leg.totalTokens].some(
    (metric) => metric.status !== 'REPORTED'
  )
}

function primaryForStratum(
  stratum: C1AnalysisStratum,
  pairs: readonly C1AnalysisPair[]
): C1StratumPrimaryAnalysis {
  const exclusions: C1PrimaryPairExclusion[] = []
  const deltas: number[] = []
  const reductions: number[] = []
  for (const pair of pairs) {
    if (pair.native.legStatus !== 'COMPLETED' || pair.runtime.legStatus !== 'COMPLETED') {
      exclusions.push({ pairId: pair.pairId, reason: 'LEG_NOT_COMPLETED' })
      continue
    }
    const nativeInput = metricValue(pair.native.inputTokens)
    const runtimeInput = metricValue(pair.runtime.inputTokens)
    if (nativeInput === null || runtimeInput === null) {
      exclusions.push({
        pairId: pair.pairId,
        reason: 'INPUT_USAGE_UNAVAILABLE'
      })
      continue
    }
    if (nativeInput <= 0) {
      exclusions.push({
        pairId: pair.pairId,
        reason: 'NATIVE_DENOMINATOR_ZERO'
      })
      continue
    }
    const delta = nativeInput - runtimeInput
    deltas.push(delta)
    reductions.push(delta / nativeInput)
  }
  const medianDelta = median(deltas)
  const medianReduction = median(reductions)
  return {
    stratum,
    observedPairs: pairs.length,
    eligiblePairs: deltas.length,
    missingUsagePairs: exclusions.filter((item) => item.reason === 'INPUT_USAGE_UNAVAILABLE')
      .length,
    medianDelta,
    medianReduction,
    signFlipPValue: signFlipPValue(deltas),
    exclusions,
    minimumCoveragePass: deltas.length >= 6,
    betterCoveragePass: deltas.length >= 7
  }
}

function secondaryForMetric(
  endpointId: C1SecondaryMetricAnalysis['endpointId'],
  pairs: readonly C1AnalysisPair[]
): C1SecondaryMetricAnalysis {
  const nativeValues: number[] = []
  const runtimeValues: number[] = []
  const pairedDifferences: number[] = []
  for (const pair of pairs) {
    if (pair.native.legStatus !== 'COMPLETED' || pair.runtime.legStatus !== 'COMPLETED') continue
    const nativeMetric =
      endpointId === 'provider_total_tokens'
        ? pair.native.totalTokens
        : endpointId === 'tool_calls'
          ? pair.native.toolCalls
          : pair.native.wallClockMs
    const runtimeMetric =
      endpointId === 'provider_total_tokens'
        ? pair.runtime.totalTokens
        : endpointId === 'tool_calls'
          ? pair.runtime.toolCalls
          : pair.runtime.wallClockMs
    const nativeValue = metricValue(nativeMetric)
    const runtimeValue = metricValue(runtimeMetric)
    if (nativeValue === null || runtimeValue === null) continue
    if (endpointId === 'provider_total_tokens' && nativeValue <= 0) continue
    nativeValues.push(nativeValue)
    runtimeValues.push(runtimeValue)
    pairedDifferences.push(runtimeValue - nativeValue)
  }
  const nativeMedian = median(nativeValues)
  const runtimeMedian = median(runtimeValues)
  const pairedMedianDifference = median(pairedDifferences)
  const relativeDenominator =
    nativeMedian === null
      ? null
      : endpointId === 'provider_total_tokens'
        ? nativeMedian
        : Math.max(nativeMedian, 1)
  const pairedMedianRelativeIncrease =
    pairedMedianDifference === null || relativeDenominator === null || relativeDenominator <= 0
      ? null
      : pairedMedianDifference / relativeDenominator
  const materialRegression =
    endpointId === 'provider_total_tokens'
      ? pairedMedianRelativeIncrease !== null && pairedMedianRelativeIncrease >= 0.1
      : endpointId === 'tool_calls'
        ? pairedMedianDifference !== null &&
          pairedMedianRelativeIncrease !== null &&
          pairedMedianDifference >= 2 &&
          pairedMedianRelativeIncrease >= 0.2
        : pairedMedianDifference !== null &&
          pairedMedianRelativeIncrease !== null &&
          pairedMedianDifference >= 5000 &&
          pairedMedianRelativeIncrease >= 0.2
  return {
    endpointId,
    status: pairedDifferences.length >= 6 ? 'ESTIMABLE' : 'NOT_ESTIMABLE',
    eligiblePairs: pairedDifferences.length,
    minimumCoveragePass: pairedDifferences.length >= 6,
    nativeMedian,
    runtimeMedian,
    pairedMedianDifference,
    pairedMedianRelativeIncrease,
    materialRegression
  }
}

function lifecycleRateEndpoint(
  endpointId: C1LifecycleRateEndpointAnalysis['endpointId'],
  pairs: readonly C1AnalysisPair[]
): C1LifecycleRateEndpointAnalysis {
  const measurements = pairs.map((pair) =>
    endpointId === 'removal_precision'
      ? pair.lifecycle.removalPrecision
      : pair.lifecycle.rehydrationRecoveryRate
  )
  const estimable = measurements.filter(
    (
      measurement
    ): measurement is Extract<C1AnalysisLifecycleMeasurement, { status: 'ESTIMABLE' }> =>
      measurement.status === 'ESTIMABLE'
  )
  const notEstimableCount = measurements.filter(
    (measurement) => measurement.status === 'NOT_ESTIMABLE'
  ).length
  const notApplicableCount = measurements.filter(
    (measurement) => measurement.status === 'NOT_APPLICABLE'
  ).length
  if (estimable.length === 0) {
    return {
      endpointId,
      status: notApplicableCount === measurements.length ? 'NOT_APPLICABLE' : 'NOT_ESTIMABLE',
      numerator: null,
      denominator: null,
      value: null,
      notEstimableCount,
      notApplicableCount
    }
  }
  const numerator = estimable.reduce((sum, measurement) => sum + measurement.numerator, 0)
  const denominator = estimable.reduce((sum, measurement) => sum + measurement.denominator, 0)
  return {
    endpointId,
    status: 'ESTIMABLE',
    numerator,
    denominator,
    value: numerator / denominator,
    notEstimableCount,
    notApplicableCount
  }
}

function coldContextPenaltyEndpoint(
  pairs: readonly C1AnalysisPair[]
): C1ColdContextPenaltyAnalysis {
  const measurements = pairs.map((pair) => pair.lifecycle.coldContextPenalty)
  const estimable = measurements.filter(
    (
      measurement
    ): measurement is Extract<C1AnalysisColdContextPenaltyEvidence, { status: 'ESTIMABLE' }> =>
      measurement.status === 'ESTIMABLE'
  )
  const notEstimableCount = measurements.filter(
    (measurement) => measurement.status === 'NOT_ESTIMABLE'
  ).length
  const notApplicableCount = measurements.filter(
    (measurement) => measurement.status === 'NOT_APPLICABLE'
  ).length
  if (estimable.length === 0) {
    return {
      endpointId: 'cold_context_penalty',
      status: notApplicableCount === measurements.length ? 'NOT_APPLICABLE' : 'NOT_ESTIMABLE',
      eligiblePairs: 0,
      medianInputTokenDelta: null,
      medianToolCallDelta: null,
      medianWallClockDeltaMs: null,
      notEstimableCount,
      notApplicableCount
    }
  }
  const inputTokenDeltas = estimable.map(
    (measurement) => measurement.runtime.inputTokens - measurement.native.inputTokens
  )
  const toolCallDeltas = estimable.map(
    (measurement) => measurement.runtime.toolCalls - measurement.native.toolCalls
  )
  const wallClockDeltas = estimable.map(
    (measurement) => measurement.runtime.wallClockMs - measurement.native.wallClockMs
  )
  return {
    endpointId: 'cold_context_penalty',
    status: 'ESTIMABLE',
    eligiblePairs: estimable.length,
    medianInputTokenDelta: median(inputTokenDeltas),
    medianToolCallDelta: median(toolCallDeltas),
    medianWallClockDeltaMs: median(wallClockDeltas),
    notEstimableCount,
    notApplicableCount
  }
}

function lifecycleEndpoint(
  endpointId: C1LifecycleEndpointAnalysis['endpointId'],
  pairs: readonly C1AnalysisPair[]
): C1LifecycleEndpointAnalysis {
  if (endpointId === 'cold_context_penalty') return coldContextPenaltyEndpoint(pairs)
  return lifecycleRateEndpoint(endpointId, pairs)
}

function lifecycleEvidenceIssue(pairs: readonly C1AnalysisPair[]): boolean {
  return pairs.some((pair) => pair.lifecycleEvidenceIssue === true)
}

function buildStratumAnalysis(
  stratum: C1AnalysisStratum,
  pairs: readonly C1AnalysisPair[]
): C1StratumAnalysis {
  const primary = primaryForStratum(stratum, pairs)
  const secondary = [
    secondaryForMetric('provider_total_tokens', pairs),
    secondaryForMetric('tool_calls', pairs),
    secondaryForMetric('wall_clock_ms', pairs)
  ]
  const lifecycle = [
    lifecycleEndpoint('removal_precision', pairs),
    lifecycleEndpoint('rehydration_recovery_rate', pairs),
    lifecycleEndpoint('cold_context_penalty', pairs)
  ]
  return {
    stratum,
    observedPairs: pairs.length,
    primary,
    secondary,
    lifecycle,
    nativeInvalidLegs: pairs.filter((pair) => legHasEvidenceAttrition(pair.native)).length,
    runtimeInvalidLegs: pairs.filter((pair) => legHasEvidenceAttrition(pair.runtime)).length,
    nativeTaskFailures: pairs.filter(
      (pair) => pair.native.legStatus === 'COMPLETED' && pair.native.taskOutcome === 'FAILURE'
    ).length,
    runtimeTaskFailures: pairs.filter(
      (pair) => pair.runtime.legStatus === 'COMPLETED' && pair.runtime.taskOutcome === 'FAILURE'
    ).length
  }
}

function failureClassification(study: C1AnalysisStudy): {
  readonly classification: C1OfflineAnalysisResult['failureClassification']
  readonly reasons: readonly string[]
} {
  if (study.sharedExternalFailure === true) {
    return {
      classification: 'SHARED_EXTERNAL_FAILURE',
      reasons: ['shared external failure prevents Native/Runtime attribution']
    }
  }
  if (study.studyStatus === 'HARNESS_CONTRACT_FAILURE') {
    return {
      classification: 'HARNESS_CONTRACT_FAILURE',
      reasons: ['harness contract failure excludes the affected analysis']
    }
  }
  if (study.studyStatus === 'INFRASTRUCTURE_FAILURE') {
    return {
      classification: 'INFRASTRUCTURE_FAILURE',
      reasons: ['infrastructure failure stops the study and prevents attribution']
    }
  }
  if (study.studyStatus === 'STOPPED') {
    return {
      classification: 'STUDY_STOPPED',
      reasons: ['study stopped before the frozen evidence set completed']
    }
  }
  if (
    study.pairs.some((pair) =>
      [pair.native.legStatus, pair.runtime.legStatus].includes('HARNESS_CONTRACT_FAILURE')
    )
  ) {
    return {
      classification: 'HARNESS_CONTRACT_FAILURE',
      reasons: ['a leg has a harness contract failure']
    }
  }
  if (
    study.pairs.some((pair) =>
      [pair.native.legStatus, pair.runtime.legStatus].some(
        (status) => status === 'INFRASTRUCTURE_FAILURE' || status === 'ABORTED'
      )
    )
  ) {
    return {
      classification: 'INFRASTRUCTURE_FAILURE',
      reasons: ['one or more legs have infrastructure or aborted evidence']
    }
  }
  if (
    study.pairs.some((pair) => [pair.native.legStatus, pair.runtime.legStatus].includes('STOPPED'))
  ) {
    return {
      classification: 'STUDY_STOPPED',
      reasons: ['one or more legs stopped before completion']
    }
  }
  return { classification: 'NONE', reasons: [] }
}

function treatmentIsActive(pairs: readonly C1AnalysisPair[]): boolean {
  return !pairs.some(
    (pair) => pair.runtime.runtimeTreatment === 'INACTIVE' && pair.runtime.legStatus === 'COMPLETED'
  )
}

function pooledPrimary(
  strata: readonly C1StratumPrimaryAnalysis[]
): Omit<
  C1PrimaryAnalysis,
  'endpointId' | 'status' | 'strata' | 'pooledMedianReduction' | 'qualifies'
> {
  const pValues = strata.flatMap((stratum) =>
    stratum.signFlipPValue === null ? [] : [stratum.signFlipPValue]
  )
  const pooledEligiblePairs = strata.reduce((sum, stratum) => sum + stratum.eligiblePairs, 0)
  const fisherCombinedPValue =
    pValues.length === strata.length ? fisherCombinedPValueFor(pValues) : null
  const minimumCoveragePass =
    strata.every((stratum) => stratum.minimumCoveragePass) && pooledEligiblePairs >= 24
  const betterCoveragePass =
    strata.every((stratum) => stratum.betterCoveragePass) && pooledEligiblePairs >= 30
  return {
    pooledEligiblePairs,
    fisherCombinedPValue,
    minimumCoveragePass,
    betterCoveragePass
  }
}

function fisherCombinedPValueFor(pValues: readonly number[]): number | null {
  return fisherCombinedPValue(pValues)
}

function pairPrimaryReductions(pairs: readonly C1AnalysisPair[]): number[] {
  const reductions: number[] = []
  for (const pair of pairs) {
    if (pair.native.legStatus !== 'COMPLETED' || pair.runtime.legStatus !== 'COMPLETED') continue
    const nativeInput = metricValue(pair.native.inputTokens)
    const runtimeInput = metricValue(pair.runtime.inputTokens)
    if (nativeInput === null || runtimeInput === null || nativeInput <= 0) continue
    reductions.push((nativeInput - runtimeInput) / nativeInput)
  }
  return reductions
}

function outcomeAnalysis(strata: readonly C1StratumAnalysis[]): C1OutcomeAnalysis {
  const nativeTaskFailures = strata.reduce((sum, stratum) => sum + stratum.nativeTaskFailures, 0)
  const runtimeTaskFailures = strata.reduce((sum, stratum) => sum + stratum.runtimeTaskFailures, 0)
  const additionalByStratum = strata.map((stratum) =>
    Math.max(0, stratum.runtimeTaskFailures - stratum.nativeTaskFailures)
  )
  const additionalRuntimeFailures = Math.max(0, runtimeTaskFailures - nativeTaskFailures)
  const perStratumNonInferiorityPass = additionalByStratum.every((value) => value < 2)
  const pooledNonInferiorityPass = additionalRuntimeFailures < 3
  return {
    nativeTaskFailures,
    runtimeTaskFailures,
    additionalRuntimeFailures,
    perStratumNonInferiorityPass,
    pooledNonInferiorityPass,
    nonInferiorityPass: perStratumNonInferiorityPass && pooledNonInferiorityPass,
    additionalRuntimeTaskFailure: additionalRuntimeFailures > 0
  }
}

function reliabilityAnalysis(strata: readonly C1StratumAnalysis[]): C1ReliabilityAnalysis {
  const nativeInvalidLegs = strata.reduce((sum, stratum) => sum + stratum.nativeInvalidLegs, 0)
  const runtimeInvalidLegs = strata.reduce((sum, stratum) => sum + stratum.runtimeInvalidLegs, 0)
  return {
    nativeInvalidLegs,
    runtimeInvalidLegs,
    nativeEvidenceAttrition: nativeInvalidLegs,
    runtimeEvidenceAttrition: runtimeInvalidLegs,
    runtimeOperationalSuccessMinimumPass: runtimeInvalidLegs <= 1,
    betterInvalidLegGatePass: nativeInvalidLegs <= 1 && runtimeInvalidLegs <= 1
  }
}

function keySecondaryCoveragePass(strata: readonly C1StratumAnalysis[]): boolean {
  return strata.every((stratum) =>
    stratum.secondary
      .filter(
        (endpoint) =>
          endpoint.endpointId === 'provider_total_tokens' ||
          endpoint.endpointId === 'tool_calls' ||
          endpoint.endpointId === 'wall_clock_ms'
      )
      .every((endpoint) => endpoint.minimumCoveragePass)
  )
}

function hasProtectedSecondaryRegression(secondary: readonly C1SecondaryMetricAnalysis[]): boolean {
  return secondary.some((endpoint) => endpoint.materialRegression)
}

function chooseDecision(input: {
  readonly study: C1AnalysisStudy
  readonly strata: readonly C1StratumAnalysis[]
  readonly primary: C1PrimaryAnalysis
  readonly secondary: readonly C1SecondaryMetricAnalysis[]
  readonly outcomes: C1OutcomeAnalysis
  readonly reliability: C1ReliabilityAnalysis
  readonly treatmentActive: boolean
}): {
  readonly decision: C1AnalysisDecision
  readonly reasons: readonly string[]
} {
  const reasons: string[] = []
  if (input.study.sharedExternalFailure === true) {
    return {
      decision: 'INCONCLUSIVE',
      reasons: ['shared external failure prevents attribution']
    }
  }
  if (input.study.studyStatus !== 'COMPLETED') {
    return {
      decision: 'INCONCLUSIVE',
      reasons: ['study did not complete under the frozen identity']
    }
  }
  if (input.strata.some((stratum) => stratum.observedPairs !== 8)) {
    return {
      decision: 'INCONCLUSIVE',
      reasons: ['the completed study does not contain the frozen 8 pairs per stratum']
    }
  }
  if (!input.treatmentActive) {
    return {
      decision: 'INCONCLUSIVE',
      reasons: ['Runtime treatment was inactive']
    }
  }
  if (input.reliability.runtimeInvalidLegs >= 3) {
    return {
      decision: 'WORSE',
      reasons: ['treatment-specific Runtime invalid-leg attrition reached the WORSE threshold']
    }
  }
  if (input.reliability.runtimeInvalidLegs === 2) {
    return {
      decision: 'INCONCLUSIVE',
      reasons: ['Runtime invalid-leg attrition reached the INCONCLUSIVE threshold']
    }
  }
  if (!input.primary.minimumCoveragePass || !keySecondaryCoveragePass(input.strata)) {
    return {
      decision: 'INCONCLUSIVE',
      reasons: ['primary or protected-secondary coverage is below the frozen minimum']
    }
  }
  if (!input.outcomes.nonInferiorityPass) {
    return {
      decision: 'WORSE',
      reasons: ['task-outcome non-inferiority failed']
    }
  }

  const protectedRegression = hasProtectedSecondaryRegression(input.secondary)
  if (!input.primary.qualifies) {
    if (protectedRegression) {
      return {
        decision: 'WORSE',
        reasons: ['protected secondary regression occurred without a qualifying primary gain']
      }
    }
    return {
      decision: 'INCONCLUSIVE',
      reasons: ['the frozen primary decision region was not selected']
    }
  }

  const betterEligibility =
    input.primary.betterCoveragePass &&
    input.reliability.betterInvalidLegGatePass &&
    !input.outcomes.additionalRuntimeTaskFailure
  if (betterEligibility && !protectedRegression) {
    return {
      decision: 'BETTER',
      reasons: ['all frozen BETTER gates passed']
    }
  }
  if (protectedRegression) reasons.push('a protected secondary regression forbids BETTER')
  if (input.outcomes.additionalRuntimeTaskFailure) {
    reasons.push('an additional Runtime task failure forbids BETTER')
  }
  if (!input.primary.betterCoveragePass) {
    reasons.push('BETTER primary coverage requires at least 7/8 per stratum and 30/32 pooled')
  }
  if (!input.reliability.betterInvalidLegGatePass) {
    reasons.push('BETTER requires at most one invalid leg in either arm')
  }
  if (!protectedRegression && !input.outcomes.additionalRuntimeTaskFailure) {
    return {
      decision: 'INCONCLUSIVE',
      reasons
    }
  }
  return {
    decision: 'TRADE_OFF',
    reasons
  }
}

/**
 * Run the frozen C1 analysis contract over metadata-only synthetic or live
 * evidence. This function never estimates missing values and never calls a
 * provider; it is deliberately independent from the live runner.
 */
export function adjudicateC1Study(study: C1AnalysisStudy): C1OfflineAnalysisResult {
  validateStudyInput(study)
  const byStratum = new Map<C1AnalysisStratum, C1AnalysisPair[]>()
  for (const stratum of C1_ANALYSIS_STRATA) byStratum.set(stratum, [])
  for (const pair of study.pairs) byStratum.get(pair.stratum)!.push(pair)

  const strata = C1_ANALYSIS_STRATA.map((stratum) =>
    buildStratumAnalysis(stratum, byStratum.get(stratum) ?? [])
  )
  const primaryStrata = strata.map((stratum) => stratum.primary)
  const pooledPairReductions = pairPrimaryReductions(study.pairs)
  const pooled = pooledPrimary(primaryStrata)
  const pooledMedianReduction = median(pooledPairReductions)
  const primaryQualifies =
    pooled.minimumCoveragePass &&
    primaryStrata.every(
      (stratum) =>
        stratum.medianDelta !== null && stratum.medianDelta >= 0 && stratum.signFlipPValue !== null
    ) &&
    pooledMedianReduction !== null &&
    pooledMedianReduction >= 0.1 &&
    pooled.fisherCombinedPValue !== null &&
    pooled.fisherCombinedPValue <= 0.05
  const primary: C1PrimaryAnalysis = {
    endpointId: 'provider_input_tokens',
    status: pooled.minimumCoveragePass ? 'ESTIMABLE' : 'NOT_ESTIMABLE',
    strata: primaryStrata,
    pooledEligiblePairs: pooled.pooledEligiblePairs,
    pooledMedianReduction,
    fisherCombinedPValue: pooled.fisherCombinedPValue,
    minimumCoveragePass: pooled.minimumCoveragePass,
    betterCoveragePass: pooled.betterCoveragePass,
    qualifies: primaryQualifies
  }
  const secondary = [
    secondaryForMetric('provider_total_tokens', study.pairs),
    secondaryForMetric('tool_calls', study.pairs),
    secondaryForMetric('wall_clock_ms', study.pairs)
  ]
  const outcomes = outcomeAnalysis(strata)
  const reliability = reliabilityAnalysis(strata)
  const lifecycle = [
    lifecycleEndpoint('removal_precision', study.pairs),
    lifecycleEndpoint('rehydration_recovery_rate', study.pairs),
    lifecycleEndpoint('cold_context_penalty', study.pairs)
  ]
  const treatmentActive = treatmentIsActive(study.pairs)
  const decision = chooseDecision({
    study,
    strata,
    primary,
    secondary,
    outcomes,
    reliability,
    treatmentActive
  })
  const failure = failureClassification(study)
  const evidenceIssue = lifecycleEvidenceIssue(study.pairs)
  const evidenceFailureReason = 'observed lifecycle evidence is missing a required anchor or join'
  const failureReasons = evidenceIssue
    ? [...failure.reasons, evidenceFailureReason]
    : failure.reasons
  const finalFailureClassification =
    evidenceIssue && failure.classification === 'NONE'
      ? 'HARNESS_CONTRACT_FAILURE'
      : failure.classification
  const adjustedDecision = evidenceIssue ? 'INCONCLUSIVE' : decision.decision
  const adjustedReasons = evidenceIssue
    ? [...decision.reasons, 'lifecycle evidence issue prevents a definitive adjudication']
    : decision.reasons

  return {
    analysisId: 'C1_OFFLINE_ADJUDICATOR_V1',
    schemaVersion: 1,
    providerCalls: 0,
    networkRequests: 0,
    studyStatus: study.studyStatus,
    analysisStatus: adjustedDecision === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'COMPLETE',
    failureClassification: finalFailureClassification,
    failureReasons,
    overallDecision: adjustedDecision,
    treatmentActive,
    primary,
    secondary,
    outcomes,
    reliability,
    lifecycle,
    strata,
    decisionReasons: adjustedReasons
  }
}
