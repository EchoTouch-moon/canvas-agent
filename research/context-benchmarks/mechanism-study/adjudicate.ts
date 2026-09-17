import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export type MechanismCode =
  | 'EDIT_THRASH'
  | 'INCORRECT_FILE_TARGETING'
  | 'INSUFFICIENT_CONVERGENCE'
  | 'PREMATURE_COMPLETION'
  | 'OBJECTIVE_MISS'
  | 'OTHER'
  | 'UNKNOWN'
  | 'MULTI_MECHANISM'

export type SeedMechanismCode = Exclude<MechanismCode, 'OTHER' | 'UNKNOWN' | 'MULTI_MECHANISM'>

export type ConfounderAxis =
  | 'MODEL_LIMITATION'
  | 'TASK_AMBIGUITY'
  | 'TOOL_FAILURE'
  | 'BUDGET_EXPOSURE'
  | 'CONTEXT_STATE_FAILURE'

export type AxisPresence = 'PRESENT' | 'ABSENT' | 'UNKNOWN'

export type AttributionEvidenceClass =
  'RUNTIME_VISIBLE' | 'RUNTIME_DERIVABLE' | 'SEALED_OFFLINE_ONLY' | 'POST_HOC_NARRATIVE'

export type EventMechanismEvidence = {
  readonly eventId: string
  readonly eventMechanismCode: MechanismCode
  readonly evidencePointers: readonly string[]
  readonly supportsRunPrimary: boolean
}

export type RuntimeActionableClaim = {
  readonly observableStateId?: string
  readonly interventionId?: string
  readonly decisionPointId?: string
  readonly irreversibilityNotYetReached?: boolean
  readonly attributionEvidenceClass?: AttributionEvidenceClass
}

export type RunMechanismCoding = {
  readonly runId: string
  readonly layer1SemanticFeasibility: 'FAIL' | 'PASS' | 'UNKNOWN'
  readonly primaryMechanismCode: MechanismCode
  readonly secondaryMechanismCodes?: readonly MechanismCode[]
  readonly confidence?: 'HIGH' | 'MEDIUM' | 'LOW'
  readonly confounderAxes: Readonly<Record<ConfounderAxis, AxisPresence>>
  readonly events?: readonly EventMechanismEvidence[]
  readonly otherRationale?: string
  readonly rejectedSeedCodes?: readonly SeedMechanismCode[]
  readonly competingSeedCodes?: readonly SeedMechanismCode[]
  readonly runtimeActionableClaim?: RuntimeActionableClaim
  /** Explicit claim; adjudicator recomputes and may override to false fail-closed. */
  readonly claimedRuntimeActionable?: boolean
}

export type DualCodingPair = {
  readonly runId: string
  readonly coderA: MechanismCode
  readonly coderB: MechanismCode
  readonly otherRationaleA?: string
  readonly otherRationaleB?: string
}

export type MechanismAdjudication = {
  readonly contractId: 'C1_NATIVE_EXECUTION_MECHANISM_CODEBOOK_V1'
  readonly runId: string
  readonly accepted: boolean
  readonly primaryMechanismCode: MechanismCode
  readonly runtimeActionable: boolean
  readonly runtimeActionableClauseFailures: readonly string[]
  readonly violations: readonly string[]
  readonly notes: readonly string[]
}

export class MechanismCodebookError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MechanismCodebookError'
  }
}

const CONTRACT_ID = 'C1_NATIVE_EXECUTION_MECHANISM_CODEBOOK_V1' as const
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(MODULE_DIR, '..')
const ALLOWED_ROOT = MODULE_DIR
const DEFAULT_CODEBOOK_PATH = resolve(MODULE_DIR, 'codebook.v1.json')
const DEFAULT_CALIBRATION_PATH = resolve(MODULE_DIR, 'synthetic/calibration.v1.json')

const SEED_CODES: readonly SeedMechanismCode[] = [
  'EDIT_THRASH',
  'INCORRECT_FILE_TARGETING',
  'INSUFFICIENT_CONVERGENCE',
  'PREMATURE_COMPLETION',
  'OBJECTIVE_MISS'
]

const ALL_AXES: readonly ConfounderAxis[] = [
  'MODEL_LIMITATION',
  'TASK_AMBIGUITY',
  'TOOL_FAILURE',
  'BUDGET_EXPOSURE',
  'CONTEXT_STATE_FAILURE'
]

const PRIORITY: readonly SeedMechanismCode[] = [
  'PREMATURE_COMPLETION',
  'EDIT_THRASH',
  'INCORRECT_FILE_TARGETING',
  'INSUFFICIENT_CONVERGENCE',
  'OBJECTIVE_MISS'
]

export type MechanismCodebookDocument = {
  readonly codebookId: string
  readonly status: string
  readonly hardSeparations: {
    readonly mechanismAttributionIsNotCausalAttribution: boolean
    readonly mechanismAttributionIsNotRuntimeActionability: boolean
    readonly layer3LinkageIncompleteIsNotLayer1Mechanism: boolean
  }
  readonly promotionRules: {
    readonly priorityTableSeed: readonly SeedMechanismCode[]
  }
  readonly runtimeActionable: {
    readonly ruleId: string
    readonly evidenceClasses: Record<string, { readonly maySupportActionability: boolean }>
  }
}

export type CalibrationCorpus = {
  readonly corpusId: string
  readonly cases: ReadonlyArray<{
    readonly caseId: string
    readonly coding: RunMechanismCoding
    readonly dual?: DualCodingPair
    readonly expected: {
      readonly accepted: boolean
      readonly primaryMechanismCode: MechanismCode
      readonly runtimeActionable: boolean
      readonly refereePrimary?: MechanismCode
    }
  }>
}

function assertPathInsideAllowlist(candidatePath: string, allowRoot: string): string {
  const resolvedPath = resolve(candidatePath)
  const rel = relative(allowRoot, resolvedPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new MechanismCodebookError(
      `historical_non_interference_violated:path_outside_allowlist:${resolvedPath}`
    )
  }
  const normalized = normalize(resolvedPath)
  const forbidden = [`${sep}.live-output${sep}`, `${sep}.audit${sep}`, `${sep}src${sep}`]
  for (const marker of forbidden) {
    if (normalized.includes(marker)) {
      throw new MechanismCodebookError(
        `historical_non_interference_violated:forbidden_marker:${marker}`
      )
    }
  }
  return resolvedPath
}

export function loadMechanismCodebook(path?: string): MechanismCodebookDocument {
  const requested = path
    ? isAbsolute(path)
      ? path
      : resolve(PACKAGE_ROOT, path)
    : DEFAULT_CODEBOOK_PATH
  const file = assertPathInsideAllowlist(requested, ALLOWED_ROOT)
  return JSON.parse(readFileSync(file, 'utf8')) as MechanismCodebookDocument
}

export function loadMechanismCalibrationCorpus(path?: string): CalibrationCorpus {
  const requested = path
    ? isAbsolute(path)
      ? path
      : resolve(PACKAGE_ROOT, path)
    : DEFAULT_CALIBRATION_PATH
  const file = assertPathInsideAllowlist(requested, ALLOWED_ROOT)
  if (!file.includes(`${sep}synthetic${sep}`)) {
    throw new MechanismCodebookError(
      `historical_non_interference_violated:calibration_must_be_under_synthetic:${file}`
    )
  }
  return JSON.parse(readFileSync(file, 'utf8')) as CalibrationCorpus
}

function isSeed(code: MechanismCode): code is SeedMechanismCode {
  return (SEED_CODES as readonly string[]).includes(code)
}

export function adjudicateRuntimeActionableV1(claim?: RuntimeActionableClaim): {
  readonly runtimeActionable: boolean
  readonly clauseFailures: readonly string[]
} {
  if (!claim) {
    return { runtimeActionable: false, clauseFailures: ['MISSING_CLAIM'] }
  }
  const failures: string[] = []
  if (!claim.observableStateId) failures.push('C1_OBSERVABLE_RUNTIME_STATE')
  if (!claim.interventionId) failures.push('C2_RUNTIME_CAN_INTERVENE')
  if (!claim.decisionPointId || claim.irreversibilityNotYetReached !== true) {
    failures.push('C3_BEFORE_IRREVERSIBILITY')
  }
  const evidenceClass = claim.attributionEvidenceClass
  if (evidenceClass !== 'RUNTIME_VISIBLE' && evidenceClass !== 'RUNTIME_DERIVABLE') {
    failures.push('C4_NO_UNAVAILABLE_GROUND_TRUTH')
  }
  return { runtimeActionable: failures.length === 0, clauseFailures: failures }
}

export function promoteEventsToRunPrimary(
  events: readonly EventMechanismEvidence[] | undefined,
  fallbackPrimary: MechanismCode
): MechanismCode {
  if (!events || events.length === 0) return fallbackPrimary
  const votes = events
    .filter((e) => e.supportsRunPrimary)
    .map((e) => e.eventMechanismCode)
    .filter(isSeed)
  if (votes.length === 0) {
    return fallbackPrimary === 'OTHER' ? 'OTHER' : 'UNKNOWN'
  }
  const unique = [...new Set(votes)]
  if (unique.length === 1) return unique[0]!
  for (const code of PRIORITY) {
    if (unique.includes(code) && unique.filter((c) => c === code).length === unique.length) {
      return code
    }
  }
  // Distinct seeds compete → MULTI unless priority uniquely ranks one present seed alone.
  const presentByPriority = PRIORITY.filter((c) => unique.includes(c))
  if (presentByPriority.length === 1) return presentByPriority[0]!
  // If multiple seeds present, priority picks the earliest only when policy says unique winner.
  // Freeze rule: competing seeds ⇒ MULTI_MECHANISM (priority is for documentation / future use
  // when inclusion ties within one cluster; calibration locks MULTI for split votes).
  return 'MULTI_MECHANISM'
}

export function refereeDualCoding(pair: DualCodingPair): MechanismCode {
  if (pair.coderA === 'UNKNOWN' || pair.coderB === 'UNKNOWN') return 'UNKNOWN'
  if (pair.coderA === pair.coderB) {
    if (pair.coderA === 'OTHER') {
      const ok = Boolean(pair.otherRationaleA?.trim()) && Boolean(pair.otherRationaleB?.trim())
      return ok ? 'OTHER' : 'UNKNOWN'
    }
    return pair.coderA
  }
  if (isSeed(pair.coderA) && isSeed(pair.coderB)) return 'MULTI_MECHANISM'
  if (
    (pair.coderA === 'OTHER' && isSeed(pair.coderB)) ||
    (pair.coderB === 'OTHER' && isSeed(pair.coderA))
  ) {
    return 'MULTI_MECHANISM'
  }
  return 'UNKNOWN'
}

function validateAxes(axes: RunMechanismCoding['confounderAxes'], violations: string[]): void {
  for (const axis of ALL_AXES) {
    if (axes[axis] === undefined) violations.push(`missing_confounder_axis:${axis}`)
  }
}

export function adjudicateMechanismCoding(coding: RunMechanismCoding): MechanismAdjudication {
  const violations: string[] = []
  const notes: string[] = []

  if (coding.layer1SemanticFeasibility !== 'FAIL') {
    violations.push('codebook_applies_only_to_layer1_FAIL')
  }

  validateAxes(coding.confounderAxes, violations)

  let primary = coding.primaryMechanismCode

  if (coding.events && coding.events.length > 0) {
    const promoted = promoteEventsToRunPrimary(coding.events, coding.primaryMechanismCode)
    if (promoted !== coding.primaryMechanismCode) {
      notes.push(`event_promotion_override:${coding.primaryMechanismCode}->${promoted}`)
      primary = promoted
    }
  }

  if (primary === 'OTHER') {
    if (!coding.otherRationale?.trim()) violations.push('OTHER_requires_freeTextRationale')
    if (!coding.rejectedSeedCodes || coding.rejectedSeedCodes.length === 0) {
      violations.push('OTHER_requires_rejectedSeedCodes')
    }
  }

  if (primary === 'MULTI_MECHANISM') {
    const competing = coding.competingSeedCodes ?? []
    if (competing.length < 2) violations.push('MULTI_MECHANISM_requires_competingSeedCodes>=2')
  }

  // Hard separation: mechanism code never implies actionability.
  const actionable = adjudicateRuntimeActionableV1(coding.runtimeActionableClaim)
  if (coding.claimedRuntimeActionable === true && !actionable.runtimeActionable) {
    violations.push('claimed_runtime_actionable_without_four_clauses')
  }
  if (
    coding.claimedRuntimeActionable === true &&
    coding.primaryMechanismCode !== 'UNKNOWN' &&
    !coding.runtimeActionableClaim
  ) {
    violations.push('mechanism_code_must_not_imply_runtime_actionable')
  }

  const accepted = violations.length === 0
  const failClosedPrimary = accepted ? primary : 'UNKNOWN'

  return {
    contractId: CONTRACT_ID,
    runId: coding.runId,
    accepted,
    primaryMechanismCode: failClosedPrimary,
    runtimeActionable: accepted ? actionable.runtimeActionable : false,
    runtimeActionableClauseFailures: actionable.clauseFailures,
    violations,
    notes
  }
}

export function assertHardSeparations(codebook: MechanismCodebookDocument): void {
  if (!codebook.hardSeparations.mechanismAttributionIsNotCausalAttribution) {
    throw new MechanismCodebookError('hard_separation_missing:not_causal')
  }
  if (!codebook.hardSeparations.mechanismAttributionIsNotRuntimeActionability) {
    throw new MechanismCodebookError('hard_separation_missing:not_actionability')
  }
  if (!codebook.hardSeparations.layer3LinkageIncompleteIsNotLayer1Mechanism) {
    throw new MechanismCodebookError('hard_separation_missing:not_layer3')
  }
}
