import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type TerminationStatus =
  | 'TERMINAL_COMPLETE'
  | 'TERMINAL_FAILED'
  | 'BUDGET_EXHAUSTED'
  | 'BLOCKED'
  | 'UNKNOWN'

export type OracleStatus = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE'
export type CompletenessStatus = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE'

export type SemanticFeasibility = 'PASS' | 'FAIL' | 'UNKNOWN'
export type TrajectoryRecoveryOutcome = 'RECOVERED' | 'UNRECOVERED' | 'NOT_APPLICABLE' | 'UNKNOWN'
export type LinkageCompleteness = 'COMPLETE' | 'INCOMPLETE' | 'NOT_APPLICABLE'
export type ObservabilityQuality = 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'UNKNOWN'
export type OverallExecutionFeasibility = 'PASS' | 'FAIL' | 'UNKNOWN'

export type ConstructRepairLabel =
  | 'FEASIBLE'
  | 'FEASIBLE_PLUS_OBSERVABILITY_DEFECT'
  | 'INFEASIBLE'
  | 'INFEASIBLE_PLUS_OBSERVABILITY_DEFECT'
  | 'FEASIBLE_NO_TOOL_FAILURE'
  | 'INFEASIBLE_NO_TOOL_FAILURE'
  | 'FEASIBILITY_UNKNOWN'

export type ConstructRepairFixture = {
  readonly terminationStatus: TerminationStatus
  readonly objectiveOracleStatus: OracleStatus
  readonly regressionOracleStatus: OracleStatus
  readonly evidenceStatus: CompletenessStatus
  readonly provenanceStatus: CompletenessStatus
  readonly toolFailureObserved: boolean
  readonly reachedTerminalComplete: boolean
  readonly strictPerToolRecoveryLinkageComplete: boolean
  readonly missingRecoveryOfToolCallId: boolean
  readonly recoveryAttemptOrdinalIntegrity: boolean
}

export type ConstructRepairAdjudication = {
  readonly contractId: 'C1_FEASIBILITY_CONSTRUCT_REPAIR_V1'
  readonly semanticFeasibility: SemanticFeasibility
  readonly trajectoryRecoveryOutcome: TrajectoryRecoveryOutcome
  readonly linkageCompleteness: LinkageCompleteness
  readonly observabilityQuality: ObservabilityQuality
  readonly overallExecutionFeasibility: OverallExecutionFeasibility
  readonly label: ConstructRepairLabel
  readonly legalStateTrajectoryRecoveredWithIncompleteLinkage: boolean
}

const CONTRACT_ID = 'C1_FEASIBILITY_CONSTRUCT_REPAIR_V1' as const

function adjudicateLayer1(fixture: ConstructRepairFixture): SemanticFeasibility {
  if (
    fixture.evidenceStatus !== 'COMPLETE' ||
    fixture.provenanceStatus !== 'COMPLETE' ||
    fixture.objectiveOracleStatus === 'UNKNOWN' ||
    fixture.terminationStatus === 'UNKNOWN'
  ) {
    return 'UNKNOWN'
  }

  if (
    fixture.terminationStatus === 'TERMINAL_COMPLETE' &&
    fixture.objectiveOracleStatus === 'PASS' &&
    (fixture.regressionOracleStatus === 'PASS' ||
      fixture.regressionOracleStatus === 'NOT_APPLICABLE') &&
    fixture.evidenceStatus === 'COMPLETE' &&
    fixture.provenanceStatus === 'COMPLETE'
  ) {
    return 'PASS'
  }

  return 'FAIL'
}

function adjudicateLayer2(
  fixture: ConstructRepairFixture,
  semanticFeasibility: SemanticFeasibility
): TrajectoryRecoveryOutcome {
  if (!fixture.toolFailureObserved) return 'NOT_APPLICABLE'
  if (semanticFeasibility === 'UNKNOWN') return 'UNKNOWN'
  if (fixture.reachedTerminalComplete && semanticFeasibility === 'PASS') return 'RECOVERED'
  return 'UNRECOVERED'
}

function adjudicateLayer3(fixture: ConstructRepairFixture): {
  linkageCompleteness: LinkageCompleteness
  observabilityQuality: ObservabilityQuality
} {
  if (!fixture.toolFailureObserved) {
    return { linkageCompleteness: 'NOT_APPLICABLE', observabilityQuality: 'NOT_APPLICABLE' }
  }

  const complete =
    fixture.strictPerToolRecoveryLinkageComplete &&
    !fixture.missingRecoveryOfToolCallId &&
    fixture.recoveryAttemptOrdinalIntegrity

  if (complete) {
    return { linkageCompleteness: 'COMPLETE', observabilityQuality: 'PASS' }
  }

  return { linkageCompleteness: 'INCOMPLETE', observabilityQuality: 'FAIL' }
}

function composeLabel(
  semanticFeasibility: SemanticFeasibility,
  linkageCompleteness: LinkageCompleteness,
  overall: OverallExecutionFeasibility
): ConstructRepairLabel {
  if (semanticFeasibility === 'UNKNOWN' || overall === 'UNKNOWN') return 'FEASIBILITY_UNKNOWN'

  if (semanticFeasibility === 'PASS' && linkageCompleteness === 'COMPLETE') return 'FEASIBLE'
  if (semanticFeasibility === 'PASS' && linkageCompleteness === 'INCOMPLETE') {
    return 'FEASIBLE_PLUS_OBSERVABILITY_DEFECT'
  }
  if (semanticFeasibility === 'PASS' && linkageCompleteness === 'NOT_APPLICABLE') {
    return 'FEASIBLE_NO_TOOL_FAILURE'
  }
  if (semanticFeasibility === 'FAIL' && linkageCompleteness === 'COMPLETE') return 'INFEASIBLE'
  if (semanticFeasibility === 'FAIL' && linkageCompleteness === 'INCOMPLETE') {
    return 'INFEASIBLE_PLUS_OBSERVABILITY_DEFECT'
  }
  return 'INFEASIBLE_NO_TOOL_FAILURE'
}

/**
 * Machine adjudicator for C1_FEASIBILITY_CONSTRUCT_REPAIR_V1.
 * Zero Provider: pure function over fixture fields. Must not read live-output.
 */
export function adjudicateConstructRepairV1(
  fixture: ConstructRepairFixture
): ConstructRepairAdjudication {
  const semanticFeasibility = adjudicateLayer1(fixture)
  const trajectoryRecoveryOutcome = adjudicateLayer2(fixture, semanticFeasibility)
  const { linkageCompleteness, observabilityQuality } = adjudicateLayer3(fixture)

  // Critical principle: Layer 3 alone never forces overall FAIL when Layer 1 PASS.
  let overallExecutionFeasibility: OverallExecutionFeasibility
  if (semanticFeasibility === 'UNKNOWN') overallExecutionFeasibility = 'UNKNOWN'
  else if (semanticFeasibility === 'PASS') overallExecutionFeasibility = 'PASS'
  else overallExecutionFeasibility = 'FAIL'

  if (
    semanticFeasibility === 'PASS' &&
    linkageCompleteness === 'INCOMPLETE' &&
    overallExecutionFeasibility !== 'PASS'
  ) {
    throw new Error('construct_repair_v1_forbidden_mapping: L3 incomplete must not force infeasible')
  }

  const legalStateTrajectoryRecoveredWithIncompleteLinkage =
    trajectoryRecoveryOutcome === 'RECOVERED' && linkageCompleteness === 'INCOMPLETE'

  return {
    contractId: CONTRACT_ID,
    semanticFeasibility,
    trajectoryRecoveryOutcome,
    linkageCompleteness,
    observabilityQuality,
    overallExecutionFeasibility,
    label: composeLabel(semanticFeasibility, linkageCompleteness, overallExecutionFeasibility),
    legalStateTrajectoryRecoveredWithIncompleteLinkage
  }
}

export type SyntheticCorpus = {
  readonly corpusId: string
  readonly cases: ReadonlyArray<{
    readonly caseId: string
    readonly expectedLabel: ConstructRepairLabel
    readonly expectedLayers?: {
      readonly semanticFeasibility: SemanticFeasibility
      readonly trajectoryRecoveryOutcome: TrajectoryRecoveryOutcome
      readonly linkageCompleteness: LinkageCompleteness
      readonly overallExecutionFeasibility: OverallExecutionFeasibility
      readonly observabilityQuality: ObservabilityQuality
    }
    readonly fixture: ConstructRepairFixture
  }>
}

export function loadConstructRepairSyntheticCorpus(corpusPath?: string): SyntheticCorpus {
  const here = dirname(fileURLToPath(import.meta.url))
  const path =
    corpusPath ??
    join(here, '../../construct-repair/synthetic/corpus.v1.json')
  return JSON.parse(readFileSync(path, 'utf8')) as SyntheticCorpus
}

export function assertHistoricalNonInterference(cwdFilesTouched: readonly string[]): void {
  const forbidden = cwdFilesTouched.filter(
    (p) =>
      p.includes('.live-output/c1-f1-32') ||
      p.includes('.live-output/c1-f0') ||
      /c1-f1-32-20260915-11df369c/.test(p) ||
      /c1-f0-v2-20260913-341fbab9/.test(p)
  )
  if (forbidden.length > 0) {
    throw new Error(`historical_non_interference_violated:${forbidden.join(',')}`)
  }
}
