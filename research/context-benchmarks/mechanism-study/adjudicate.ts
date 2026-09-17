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

const PRIORITY_DISPLAY_ORDER: readonly SeedMechanismCode[] = [
  'PREMATURE_COMPLETION',
  'EDIT_THRASH',
  'INCORRECT_FILE_TARGETING',
  'INSUFFICIENT_CONVERGENCE',
  'OBJECTIVE_MISS'
]

/** Documentation/display order only — never used to break multi-seed ties. */
export function mechanismPriorityDisplayOrder(): readonly SeedMechanismCode[] {
  return PRIORITY_DISPLAY_ORDER
}

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
    readonly priorityTableRole?: string
  }
  readonly referee?: {
    readonly integration?: string
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
  // Frozen: any >=2 distinct supporting seed codes ⇒ MULTI_MECHANISM.
  // priorityTableSeed is documentation/display order only.
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
    const otherRationale = pair.coderA === 'OTHER' ? pair.otherRationaleA : pair.otherRationaleB
    return otherRationale?.trim() ? 'MULTI_MECHANISM' : 'UNKNOWN'
  }
  return 'UNKNOWN'
}

function isValidDualMultiEvidence(pair: DualCodingPair): boolean {
  if (isSeed(pair.coderA) && isSeed(pair.coderB)) {
    return pair.coderA !== pair.coderB
  }
  const mixedSeedOther =
    (isSeed(pair.coderA) && pair.coderB === 'OTHER') ||
    (pair.coderA === 'OTHER' && isSeed(pair.coderB))
  if (!mixedSeedOther) return false
  const otherRationale = pair.coderA === 'OTHER' ? pair.otherRationaleA : pair.otherRationaleB
  return Boolean(otherRationale?.trim())
}

function collectCompetingSeedCodes(
  coding: RunMechanismCoding,
  dual: DualCodingPair | undefined,
  violations: string[]
): Set<SeedMechanismCode> {
  const competing = new Set<SeedMechanismCode>()

  for (const event of coding.events ?? []) {
    if (event.supportsRunPrimary && isSeed(event.eventMechanismCode)) {
      competing.add(event.eventMechanismCode)
    }
  }

  for (const code of coding.competingSeedCodes ?? []) {
    if (!isSeed(code)) {
      violations.push(`invalid_competingSeedCode:${String(code)}`)
      continue
    }
    competing.add(code)
  }

  if (dual) {
    if (isSeed(dual.coderA)) competing.add(dual.coderA)
    if (isSeed(dual.coderB)) competing.add(dual.coderB)
  }

  return competing
}

function validateAxes(axes: RunMechanismCoding['confounderAxes'], violations: string[]): void {
  for (const axis of ALL_AXES) {
    if (axes[axis] === undefined) violations.push(`missing_confounder_axis:${axis}`)
  }
}

export function adjudicateMechanismCoding(
  coding: RunMechanismCoding,
  dual?: DualCodingPair
): MechanismAdjudication {
  const violations: string[] = []
  const notes: string[] = []

  if (coding.layer1SemanticFeasibility !== 'FAIL') {
    violations.push('codebook_applies_only_to_layer1_FAIL')
  }

  validateAxes(coding.confounderAxes, violations)

  let primary = coding.primaryMechanismCode
  let dualProvidesValidMultiEvidence = false

  if (coding.events && coding.events.length > 0) {
    const promoted = promoteEventsToRunPrimary(coding.events, coding.primaryMechanismCode)
    if (promoted !== coding.primaryMechanismCode) {
      notes.push(`event_promotion_override:${coding.primaryMechanismCode}->${promoted}`)
      primary = promoted
    }
  }

  if (dual) {
    if (dual.runId !== coding.runId) {
      violations.push('dual_runId_mismatch')
    } else {
      const refereed = refereeDualCoding(dual)
      if (refereed !== primary) {
        notes.push(`dual_referee_override:${primary}->${refereed}`)
        primary = refereed
      }
      if (refereed === 'MULTI_MECHANISM') {
        dualProvidesValidMultiEvidence = isValidDualMultiEvidence(dual)
        if (dualProvidesValidMultiEvidence && !coding.competingSeedCodes) {
          notes.push('dual_referee_inferred_competing_seeds')
        }
      }
    }
  }

  if (primary === 'OTHER') {
    if (!coding.otherRationale?.trim()) violations.push('OTHER_requires_freeTextRationale')
    if (!coding.rejectedSeedCodes || coding.rejectedSeedCodes.length === 0) {
      violations.push('OTHER_requires_rejectedSeedCodes')
    }
  }

  if (primary === 'MULTI_MECHANISM') {
    const evidenceDual = dual && dual.runId === coding.runId ? dual : undefined
    const competing = collectCompetingSeedCodes(coding, evidenceDual, violations)
    if (competing.size < 2 && !dualProvidesValidMultiEvidence) {
      violations.push(
        'MULTI_MECHANISM_requires_two_distinct_competing_seeds_or_valid_dual_disagreement'
      )
    }
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
