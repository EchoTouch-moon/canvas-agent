import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// CR-004 hardening — EXPERIMENT PROFILE / CONTRACT BINDING.
//
// The runner used to accept ANY `cr004-m[1-9]-*` identity while hardcoding
// one contract path and one matrixDesign label, so the real M4 run recorded
// the M3 contract + design in its manifest (verified mislabel; the evidence
// itself was never rewritten). This registry closes that: every M-series is
// a READ-ONLY history entry binding the run-identity pattern to the exact
// contract file, the matrix design label, and the shape bounds (allowed
// tasks/arms, max repetitions, required arm-order mode) the series may run.
// A run identity must match exactly one profile; the profile's contract must
// EXIST on disk at startup (refuse otherwise); the env knobs are validated
// against the profile's bounds; and an unknown series (M7+) is REFUSED until
// a profile + contract are deliberately added here. The offline analyzer
// additionally cross-checks every manifest against its run-id series and
// emits `provenanceWarnings` without rewriting historical evidence.
//
// No provider, no network. The only fs use is the contract existence check +
// hashing at runner startup and inside --analyze.

export type MxSeriesId = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6'
export type MxTaskSlot = 'L1' | 'L2' | 'L3'
export type MxArm = 'NATIVE' | 'ACTIVE' | 'ACTIVE_V2' | 'ACTIVE_V3' | 'ACTIVE_V4'

/**
 * Within-block arm ordering mode (M5/M6 pre-registration). 'canonical' (default)
 * keeps the deterministic control-first order of every historical series;
 * 'randomized' shuffles the arm sequence inside every (task x rep) block with
 * a shuffle seeded from the run identity hash — the M4 exchangeability
 * confound fix. Defined here (not matrix-core) so the profile registry can
 * enforce it without an import cycle.
 */
export type MxArmOrderMode = 'canonical' | 'randomized'

/** One M-series experiment profile (registry entry; add deliberately). */
export interface MxExperimentProfile {
  readonly series: MxSeriesId
  /** Run identities of this series (single-use, contract section 2). */
  readonly runIdPattern: RegExp
  /** Repo-root-relative path of the series' authorized run contract. */
  readonly contractPath: string
  /** The manifest's matrixDesign label for runs of this series. */
  readonly matrixDesign: string
  /** Task slots a run of this series may include (env knob bound). */
  readonly allowedTasks: readonly MxTaskSlot[]
  /** Treatment arms a run of this series may include (env knob bound). */
  readonly allowedArms: readonly MxArm[]
  /** Maximum repetitions a run of this series may use. */
  readonly maxReps: number
  /** Optional matrix-wide provider-call ceiling for this series. */
  readonly maxProviderCallRecords?: number
  /** Optional matrix-wide wall-clock ceiling for this series. */
  readonly runWallClockMs?: number
  /**
   * Arm-order mode runs of this series MUST use (M5/M6: 'randomized' — the
   * pre-registered design refuses the canonical control-first order).
   * Undefined for the historical series (canonical, unchanged).
   */
  readonly armOrder?: MxArmOrderMode
}

const ALL_TASKS: readonly MxTaskSlot[] = ['L1', 'L2', 'L3']

/**
 * The registry (read-only history M1..M5 + the authorized M6 mechanism screen).
 * M1 evidence embedded its design object instead of a string label, so
 * `M1-active-baseline` is the registry's canonical name for that series
 * (historical manifests are never rewritten).
 */
export const MX_EXPERIMENT_PROFILES: readonly MxExperimentProfile[] = [
  {
    series: 'M1',
    runIdPattern: /^cr004-m1-\d{8}-[0-9a-f]{8}$/,
    contractPath: 'docs/plan/cr004-matrix-run-contract-2026-08-27.md',
    matrixDesign: 'M1-active-baseline',
    allowedTasks: ALL_TASKS,
    allowedArms: ['NATIVE', 'ACTIVE'],
    maxReps: 3
  },
  {
    series: 'M2',
    runIdPattern: /^cr004-m2-\d{8}-[0-9a-f]{8}$/,
    contractPath: 'docs/plan/cr004-m2-matrix-run-contract-2026-08-27.md',
    matrixDesign: 'M2-three-arm',
    allowedTasks: ALL_TASKS,
    allowedArms: ['NATIVE', 'ACTIVE', 'ACTIVE_V2'],
    maxReps: 3
  },
  {
    series: 'M3',
    runIdPattern: /^cr004-m3-\d{8}-[0-9a-f]{8}$/,
    contractPath: 'docs/plan/cr004-m3-matrix-run-contract-2026-08-27.md',
    matrixDesign: 'M3-verify-window-dedup',
    allowedTasks: ALL_TASKS,
    allowedArms: ['NATIVE', 'ACTIVE_V2', 'ACTIVE_V3'],
    maxReps: 3
  },
  {
    series: 'M4',
    runIdPattern: /^cr004-m4-\d{8}-[0-9a-f]{8}$/,
    contractPath: 'docs/plan/cr004-m4-confirmatory-run-contract-2026-08-27.md',
    matrixDesign: 'M4-confirmatory',
    allowedTasks: ['L1', 'L2'],
    allowedArms: ['NATIVE', 'ACTIVE_V2'],
    maxReps: 8
  },
  {
    // The pre-registered replication (Lead review prescription 2026-08-27):
    // same two-arm design as M4, but with SEEDED within-block arm-order
    // randomization replacing the deterministic control-first order, and a
    // pre-registered analysis (exact sign-flip permutation primary endpoint,
    // Holm secondary, non-inferiority reliability gate). The contract file
    // keeps its original -DRAFT filename (references exist; the Status line
    // inside it carries the authorization).
    series: 'M5',
    runIdPattern: /^cr004-m5-\d{8}-[0-9a-f]{8}$/,
    contractPath: 'docs/plan/cr004-m5-replication-run-contract-DRAFT-2026-08-28.md',
    matrixDesign: 'M5-preregistered-replication',
    allowedTasks: ['L1', 'L2'],
    allowedArms: ['NATIVE', 'ACTIVE_V2'],
    maxReps: 8,
    armOrder: 'randomized'
  },
  {
    // M6 is an exploratory mechanism screen, not a replacement for the
    // pre-registered M5 replication. It adds one fixed, pre-registered batch
    // threshold arm and keeps within-block arm randomization.
    series: 'M6',
    runIdPattern: /^cr004-m6-\d{8}-[0-9a-f]{8}$/,
    contractPath: 'docs/plan/cr004-m6-mechanism-screen-run-contract-2026-08-30.md',
    matrixDesign: 'M6-mechanism-screen',
    allowedTasks: ALL_TASKS,
    allowedArms: ['NATIVE', 'ACTIVE_V2', 'ACTIVE_V3', 'ACTIVE_V4'],
    maxReps: 4,
    maxProviderCallRecords: 1400,
    runWallClockMs: 300 * 60 * 1000,
    armOrder: 'randomized'
  }
]

/** The newest registered series; new identity suggestions come from it. */
export const MX_LATEST_PROFILE: MxExperimentProfile =
  MX_EXPERIMENT_PROFILES[MX_EXPERIMENT_PROFILES.length - 1]!

/** Configuration/binding error in the experiment-profile machinery; REFUSE. */
export class MxProfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MxProfileError'
  }
}

/** The M-series of a run id (`cr004-m4-...` -> `M4`), registered or not. */
export function mxRunIdSeriesOf(runId: string): string | null {
  const match = /^cr004-(m\d+)-/.exec(runId)
  return match === null ? null : match[1]!.toUpperCase()
}

/** The single registered profile whose run-id pattern matches, if any. */
export function mxProfileForRunId(runId: string | undefined): MxExperimentProfile | undefined {
  if (runId === undefined) return undefined
  return MX_EXPERIMENT_PROFILES.find((profile) => profile.runIdPattern.test(runId))
}

/** True when the identity matches exactly one REGISTERED series. */
export function isValidMxProfileRunId(runId: string | undefined): runId is string {
  return mxProfileForRunId(runId) !== undefined
}

/**
 * Resolve the profile a run identity binds to and REFUSE when the binding is
 * unsound: an unknown/unregistered series (M7+ must add a profile + contract
 * first — a deliberate act), an ambiguous multi-match (registry defect), or a
 * contract file missing on disk (checked at startup, both runner modes).
 */
export function assertMxProfileBindable(
  runId: string,
  options: {
    readonly repoRoot: string
    readonly existsCheck?: (absolutePath: string) => boolean
  }
): MxExperimentProfile {
  const matches = MX_EXPERIMENT_PROFILES.filter((profile) => profile.runIdPattern.test(runId))
  if (matches.length === 0) {
    const series = mxRunIdSeriesOf(runId)
    if (series !== null) {
      throw new MxProfileError(
        `run identity series ${series} has no experiment profile registered (registered: ${MX_EXPERIMENT_PROFILES.map((profile) => profile.series).join(', ')}); adding one requires a profile entry AND an authorized contract file — a deliberate act, not an env knob`
      )
    }
    throw new MxProfileError(`run identity '${runId}' matches no experiment profile`)
  }
  if (matches.length > 1) {
    throw new MxProfileError(
      `run identity '${runId}' matches multiple experiment profiles (${matches.map((profile) => profile.series).join(', ')}) — registry defect`
    )
  }
  const profile = matches[0]!
  const exists = options.existsCheck ?? ((path: string) => existsSync(path))
  const contractAbsolute = join(options.repoRoot, profile.contractPath)
  if (!exists(contractAbsolute)) {
    throw new MxProfileError(
      `experiment profile ${profile.series} contract missing on disk: ${contractAbsolute} (expected at repo root ${options.repoRoot}) — refusing to run`
    )
  }
  return profile
}

/** Structural matrix shape the profile bounds apply to. */
export interface MxShapeLike {
  readonly tasks: readonly string[]
  readonly strategies: readonly string[]
  readonly repetitions: number
  /** Arm-order mode (optional; the canonical default applies when absent). */
  readonly armOrder?: unknown
}

/**
 * Validate the resolved matrix shape (env knobs) against the profile's
 * bounds: every task and arm must be allowed for the series, the
 * repetition count must not exceed the series' maximum, and — for series
 * with a REQUIRED arm-order mode (M5/M6: randomized) — the shape must carry
 * exactly that mode. Throws MxProfileError on the first violation.
 */
export function validateMxShapeAgainstProfile(shape: MxShapeLike, profile: MxExperimentProfile): void {
  for (const task of shape.tasks) {
    if (!(profile.allowedTasks as readonly string[]).includes(task)) {
      throw new MxProfileError(
        `task slot '${task}' is outside experiment profile ${profile.series} bounds (allowed: ${profile.allowedTasks.join(',')})`
      )
    }
  }
  for (const arm of shape.strategies) {
    if (!(profile.allowedArms as readonly string[]).includes(arm)) {
      throw new MxProfileError(
        `arm '${arm}' is outside experiment profile ${profile.series} bounds (allowed: ${profile.allowedArms.join(',')})`
      )
    }
  }
  if (shape.repetitions > profile.maxReps) {
    throw new MxProfileError(
      `repetitions ${shape.repetitions} exceed experiment profile ${profile.series} max ${profile.maxReps}`
    )
  }
  if (profile.armOrder !== undefined) {
    const mode = typeof shape.armOrder === 'string' ? shape.armOrder : '(none)'
    if (shape.armOrder !== profile.armOrder) {
      throw new MxProfileError(
        `experiment profile ${profile.series} requires armOrder '${profile.armOrder}' (the pre-registered design); refusing '${mode}'`
      )
    }
  }
}

/**
 * Resolve the effective arm-order mode for a run: a profile with a REQUIRED
 * mode forces it (an explicit conflicting request is REFUSED — an M5/M6 run
 * cannot opt into the canonical control-first order); otherwise the requested
 * mode applies, defaulting to 'canonical' (all historical behavior).
 */
export function resolveMxArmOrder(
  requested: MxArmOrderMode | undefined,
  profile: MxExperimentProfile
): MxArmOrderMode {
  if (profile.armOrder !== undefined) {
    if (requested !== undefined && requested !== profile.armOrder) {
      throw new MxProfileError(
        `experiment profile ${profile.series} requires armOrder '${profile.armOrder}' (the pre-registered design); refusing requested '${requested}'`
      )
    }
    return profile.armOrder
  }
  return requested ?? 'canonical'
}

/** Read the profile's contract file and hash it (manifest binding evidence). */
export async function readMxProfileContract(
  profile: MxExperimentProfile,
  options: {
    readonly repoRoot: string
    readonly readFileImpl?: (path: string) => Promise<string>
  }
): Promise<{ readonly absolutePath: string; readonly contractSha256: string }> {
  const absolutePath = join(options.repoRoot, profile.contractPath)
  const content = await (options.readFileImpl ?? ((path: string) => readFile(path, 'utf8')))(absolutePath)
  return {
    absolutePath,
    contractSha256: createHash('sha256').update(content, 'utf8').digest('hex')
  }
}

/** Loose manifest view for provenance cross-checks (historical shapes vary). */
export interface MxManifestLike {
  readonly runId?: unknown
  readonly contract?: unknown
  readonly matrixDesign?: unknown
  readonly design?: unknown
}

/**
 * Cross-check a recorded manifest against its run-id series and emit warnings
 * (never rewrites evidence). Covers the verified M4 mislabel: contract says
 * M3, run id says M4. Unknown series, contract mismatch, matrixDesign
 * mismatch, and out-of-bounds recorded shapes each warn once.
 */
export function mxProvenanceWarnings(
  manifest: MxManifestLike,
  options: { readonly runIdFallback?: string } = {}
): readonly string[] {
  const warnings: string[] = []
  const runId =
    typeof manifest.runId === 'string' && manifest.runId !== ''
      ? manifest.runId
      : options.runIdFallback
  if (runId === undefined) {
    return ['manifest records no runId and no fallback was provided: series cannot be cross-checked']
  }
  const profile = mxProfileForRunId(runId)
  if (profile === undefined) {
    const series = mxRunIdSeriesOf(runId)
    warnings.push(
      series === null
        ? `runId '${runId}' matches no experiment profile`
        : `runId series ${series} has no experiment profile registered`
    )
    return warnings
  }
  if (typeof manifest.contract === 'string') {
    if (manifest.contract !== profile.contractPath) {
      warnings.push(
        `contract mismatch: manifest records '${manifest.contract}' but run-id series ${profile.series} is bound to '${profile.contractPath}'`
      )
    }
  } else {
    warnings.push(`manifest records no contract path; series ${profile.series} expects '${profile.contractPath}'`)
  }
  if (typeof manifest.matrixDesign === 'string') {
    if (manifest.matrixDesign !== profile.matrixDesign) {
      warnings.push(
        `matrixDesign mismatch: manifest records '${manifest.matrixDesign}' but run-id series ${profile.series} is '${profile.matrixDesign}'`
      )
    }
  }
  // M1 embedded the design object under matrixDesign; only cross-check the
  // recorded design shape when it is a structured design block.
  const design = manifest.design
  if (design !== null && typeof design === 'object' && !Array.isArray(design)) {
    const record = design as { tasks?: unknown; strategies?: unknown; repetitions?: unknown }
    const tasks = Array.isArray(record.tasks) ? record.tasks.filter((t): t is string => typeof t === 'string') : []
    const strategies = Array.isArray(record.strategies) ? record.strategies.filter((s): s is string => typeof s === 'string') : []
    const repetitions = typeof record.repetitions === 'number' ? record.repetitions : 0
    for (const task of tasks) {
      if (!(profile.allowedTasks as readonly string[]).includes(task)) {
        warnings.push(
          `recorded design task '${task}' is outside series ${profile.series} bounds (${profile.allowedTasks.join(',')})`
        )
      }
    }
    for (const arm of strategies) {
      if (!(profile.allowedArms as readonly string[]).includes(arm)) {
        warnings.push(
          `recorded design arm '${arm}' is outside series ${profile.series} bounds (${profile.allowedArms.join(',')})`
        )
      }
    }
    if (repetitions > profile.maxReps) {
      warnings.push(
        `recorded design repetitions ${repetitions} exceed series ${profile.series} max ${profile.maxReps}`
      )
    }
    // M5/M6: a required arm-order mode is cross-checked when the manifest
    // records one (absent => the canonical default, warned below).
    const armOrder = (design as { armOrder?: unknown }).armOrder
    if (profile.armOrder !== undefined && armOrder !== profile.armOrder) {
      warnings.push(
        `recorded design armOrder '${typeof armOrder === 'string' ? armOrder : '(none)'}' violates series ${profile.series} required '${profile.armOrder}'`
      )
    }
  }
  return warnings
}
