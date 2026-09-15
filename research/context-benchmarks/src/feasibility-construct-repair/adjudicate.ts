import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export type TerminationStatus =
  'TERMINAL_COMPLETE' | 'TERMINAL_FAILED' | 'BUDGET_EXHAUSTED' | 'BLOCKED' | 'UNKNOWN'

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

/**
 * Authoritative fixture inputs. `reachedTerminalComplete` is NOT an independent
 * field — it is derived from `terminationStatus === 'TERMINAL_COMPLETE'`.
 */
export type ConstructRepairFixture = {
  readonly terminationStatus: TerminationStatus
  readonly objectiveOracleStatus: OracleStatus
  readonly regressionOracleStatus: OracleStatus
  readonly evidenceStatus: CompletenessStatus
  readonly provenanceStatus: CompletenessStatus
  readonly toolFailureObserved: boolean
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
  readonly reachedTerminalCompleteDerived: boolean
}

export type ConstructRepairTruthTableRow = {
  readonly id: string
  readonly semanticFeasibility: SemanticFeasibility | 'UNKNOWN'
  readonly linkageCompleteness: LinkageCompleteness | 'ANY'
  readonly overallExecutionFeasibility: OverallExecutionFeasibility | 'UNKNOWN'
  readonly observabilityQuality: ObservabilityQuality | 'DERIVE_FROM_LINKAGE_OR_UNKNOWN'
  readonly label: ConstructRepairLabel
}

export type ConstructRepairFreezeContract = {
  readonly contractId: string
  readonly status: string
  readonly crossLayerTruthTable: readonly ConstructRepairTruthTableRow[]
  readonly layers: {
    readonly layer2RecoveryTrajectory: {
      readonly explicitLegalState: { readonly name: string }
    }
  }
  readonly composition: {
    readonly overallExecutionFeasibility: {
      readonly illegalState: string
    }
  }
}

export class ConstructRepairContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConstructRepairContractError'
  }
}

const CONTRACT_ID = 'C1_FEASIBILITY_CONSTRUCT_REPAIR_V1' as const

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(MODULE_DIR, '../..')
const DEFAULT_CORPUS_PATH = resolve(PACKAGE_ROOT, 'construct-repair/synthetic/corpus.v1.json')
const DEFAULT_CONTRACT_PATH = resolve(
  PACKAGE_ROOT,
  'construct-repair/c1-feasibility-construct-repair-v1.freeze-candidate.json'
)
const ALLOWED_CORPUS_ROOT = resolve(PACKAGE_ROOT, 'construct-repair')

function derivedReachedTerminalComplete(terminationStatus: TerminationStatus): boolean {
  return terminationStatus === 'TERMINAL_COMPLETE'
}

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
  semanticFeasibility: SemanticFeasibility,
  reachedTerminalComplete: boolean
): TrajectoryRecoveryOutcome {
  if (!fixture.toolFailureObserved) return 'NOT_APPLICABLE'
  if (semanticFeasibility === 'UNKNOWN') return 'UNKNOWN'
  if (reachedTerminalComplete && semanticFeasibility === 'PASS') return 'RECOVERED'
  return 'UNRECOVERED'
}

function adjudicateLayer3(fixture: ConstructRepairFixture): {
  linkageCompleteness: LinkageCompleteness
  observabilityQuality: ObservabilityQuality
} {
  if (!fixture.toolFailureObserved) {
    return {
      linkageCompleteness: 'NOT_APPLICABLE',
      observabilityQuality: 'NOT_APPLICABLE'
    }
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

function composeOverall(
  semanticFeasibility: SemanticFeasibility,
  trajectoryRecoveryOutcome: TrajectoryRecoveryOutcome
): OverallExecutionFeasibility {
  // Machine lock: L1 PASS + L2 UNRECOVERED is illegal (fail-closed).
  if (semanticFeasibility === 'PASS' && trajectoryRecoveryOutcome === 'UNRECOVERED') {
    throw new ConstructRepairContractError(
      'illegal_state:L1_PASS_AND_L2_UNRECOVERED (reachedTerminalComplete must derive from terminationStatus)'
    )
  }

  if (semanticFeasibility === 'UNKNOWN') return 'UNKNOWN'
  if (
    semanticFeasibility === 'PASS' &&
    (trajectoryRecoveryOutcome === 'RECOVERED' || trajectoryRecoveryOutcome === 'NOT_APPLICABLE')
  ) {
    return 'PASS'
  }
  if (semanticFeasibility === 'FAIL') return 'FAIL'

  throw new ConstructRepairContractError(
    `unhandled_composition:L1=${semanticFeasibility},L2=${trajectoryRecoveryOutcome}`
  )
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
  const reachedTerminalCompleteDerived = derivedReachedTerminalComplete(fixture.terminationStatus)
  const semanticFeasibility = adjudicateLayer1(fixture)
  const trajectoryRecoveryOutcome = adjudicateLayer2(
    fixture,
    semanticFeasibility,
    reachedTerminalCompleteDerived
  )
  const { linkageCompleteness, observabilityQuality } = adjudicateLayer3(fixture)

  const overallExecutionFeasibility = composeOverall(semanticFeasibility, trajectoryRecoveryOutcome)

  // Critical principle: Layer 3 alone never forces overall FAIL when Layer 1 PASS.
  if (
    semanticFeasibility === 'PASS' &&
    linkageCompleteness === 'INCOMPLETE' &&
    overallExecutionFeasibility !== 'PASS'
  ) {
    throw new ConstructRepairContractError(
      'construct_repair_v1_forbidden_mapping: L3 incomplete must not force infeasible'
    )
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
    legalStateTrajectoryRecoveredWithIncompleteLinkage,
    reachedTerminalCompleteDerived
  }
}

export type SyntheticCorpus = {
  readonly corpusId: string
  readonly cases: ReadonlyArray<{
    readonly caseId: string
    readonly quadrant?: string
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

function assertPathInsideAllowlist(candidatePath: string, allowRoot: string): string {
  const resolved = resolve(candidatePath)
  const rel = relative(allowRoot, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ConstructRepairContractError(
      `historical_non_interference_violated:path_outside_allowlist:${resolved}`
    )
  }
  const normalized = normalize(resolved)
  const forbiddenMarkers = [
    `${sep}.live-output${sep}`,
    `${sep}.audit${sep}`,
    'c1-f1-32-20260915-11df369c',
    'c1-f0-v2-20260913-341fbab9'
  ]
  for (const marker of forbiddenMarkers) {
    if (normalized.includes(marker)) {
      throw new ConstructRepairContractError(
        `historical_non_interference_violated:forbidden_marker:${marker}`
      )
    }
  }
  return resolved
}

/**
 * Fail-closed corpus loader. Only paths under `construct-repair/` are allowed.
 * Historical live-output / audit / consumed study paths are rejected.
 */
export function loadConstructRepairSyntheticCorpus(corpusPath?: string): SyntheticCorpus {
  const requested = corpusPath
    ? isAbsolute(corpusPath)
      ? corpusPath
      : resolve(PACKAGE_ROOT, corpusPath)
    : DEFAULT_CORPUS_PATH
  const path = assertPathInsideAllowlist(requested, ALLOWED_CORPUS_ROOT)
  if (!path.includes(`${sep}synthetic${sep}`)) {
    throw new ConstructRepairContractError(
      `historical_non_interference_violated:corpus_must_be_under_synthetic:${path}`
    )
  }
  return JSON.parse(readFileSync(path, 'utf8')) as SyntheticCorpus
}

export function loadConstructRepairFreezeContract(
  contractPath?: string
): ConstructRepairFreezeContract {
  const requested = contractPath
    ? isAbsolute(contractPath)
      ? contractPath
      : resolve(PACKAGE_ROOT, contractPath)
    : DEFAULT_CONTRACT_PATH
  const path = assertPathInsideAllowlist(requested, ALLOWED_CORPUS_ROOT)
  return JSON.parse(readFileSync(path, 'utf8')) as ConstructRepairFreezeContract
}

/** Build a minimal fixture that realizes a truth-table row under derived L2 rules. */
export function fixtureFromTruthTableRow(
  row: ConstructRepairTruthTableRow
): ConstructRepairFixture {
  const linkage = row.linkageCompleteness === 'ANY' ? 'COMPLETE' : row.linkageCompleteness
  const toolFailureObserved = linkage !== 'NOT_APPLICABLE'
  const linkageComplete = linkage === 'COMPLETE'

  if (row.semanticFeasibility === 'UNKNOWN') {
    return {
      terminationStatus: 'TERMINAL_COMPLETE',
      objectiveOracleStatus: 'PASS',
      regressionOracleStatus: 'PASS',
      evidenceStatus: 'PARTIAL',
      provenanceStatus: 'COMPLETE',
      toolFailureObserved,
      strictPerToolRecoveryLinkageComplete: linkageComplete,
      missingRecoveryOfToolCallId: !linkageComplete && toolFailureObserved,
      recoveryAttemptOrdinalIntegrity: true
    }
  }

  if (row.semanticFeasibility === 'PASS') {
    return {
      terminationStatus: 'TERMINAL_COMPLETE',
      objectiveOracleStatus: 'PASS',
      regressionOracleStatus: 'PASS',
      evidenceStatus: 'COMPLETE',
      provenanceStatus: 'COMPLETE',
      toolFailureObserved,
      strictPerToolRecoveryLinkageComplete: linkageComplete || !toolFailureObserved,
      missingRecoveryOfToolCallId: toolFailureObserved && !linkageComplete,
      recoveryAttemptOrdinalIntegrity: true
    }
  }

  // semantic FAIL
  return {
    terminationStatus: 'TERMINAL_FAILED',
    objectiveOracleStatus: 'FAIL',
    regressionOracleStatus: 'PASS',
    evidenceStatus: 'COMPLETE',
    provenanceStatus: 'COMPLETE',
    toolFailureObserved,
    strictPerToolRecoveryLinkageComplete: linkageComplete || !toolFailureObserved,
    missingRecoveryOfToolCallId: toolFailureObserved && !linkageComplete,
    recoveryAttemptOrdinalIntegrity: true
  }
}

export function assertHistoricalNonInterference(paths: readonly string[]): void {
  for (const p of paths) {
    const candidate = isAbsolute(p) ? p : resolve(PACKAGE_ROOT, p)
    assertPathInsideAllowlist(candidate, ALLOWED_CORPUS_ROOT)
  }
}
