import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ESTIMATE_SCOPE_AGENT_MESSAGES,
  JsonlObservationSink,
  type ModelCallObservation
} from '@canvas-agent/context-runtime'
import type {
  ActiveRewriteEventEvidence,
  ActiveRewriteInterventionSummary
} from '../extension/active-rewrite-extension'
import {
  loadC1TaskDefinition,
  type C1TaskDefinition,
  type S1OracleResult,
  type S1StopConditionId
} from './s1-pair-core'

// CR-004 Stage 1 MATRIX core (M3: docs/plan/cr004-m3-matrix-run-contract-2026-08-27.md;
// M2 sibling: docs/plan/cr004-m2-matrix-run-contract-2026-08-27.md; M1:
// docs/plan/cr004-matrix-run-contract-2026-08-27.md).
//
// Everything the matrix runner, its offline analyzer, and its unit tests share:
//   - the run-identity vocabulary (M3: cr004-m3-<ISO-date>-<8-hex>, single-use;
//     validation still accepts consumed M1/M2 identities so M1/M2 evidence
//     dirs keep analyzing correctly);
//   - the matrix definition — M3 default: 3 L-tasks x NATIVE/ACTIVE_V2/
//     ACTIVE_V3 x 3 repetitions = 27 legs, deterministic interleaved order
//     (rep-major, per task NATIVE, ACTIVE_V2, ACTIVE_V3) — now CONFIGURABLE
//     via the validated env knobs CANVAS_MX_TASKS (subset of L1/L2/L3) and
//     CANVAS_MX_REPS (1..8) so a targeted run (e.g. L2-only x 4 reps = 12
//     legs) is possible; the matrix totals stay 600 provider-call records /
//     180 minutes;
//   - the matrix state machine: leg-level failures mark ONE leg FAILED and the
//     matrix CONTINUES; only matrix-level S-1 (binding) or S-7 (totals) stop
//     everything, checked between legs, evidence always preserved;
//   - incremental evidence writers (leg.json + observations.jsonl per leg,
//     manifest.json + matrix.json rewritten after EVERY leg — never buffered
//     to the end);
//   - the offline aggregator/analyzer (per-cell stats for every arm PRESENT —
//     M1/M2-era dirs with the v1 ACTIVE arm still analyze correctly — context
//     trajectories from observations, per-ACTIVE-arm intervention telemetry
//     incl. removal policy A/B metrics, v3 dedupRemovals/deferredSweeps, and
//     re-read detection, exact pairwise permutation p-values across present
//     arms with an explicit low-power caveat);
//   - the DRY_RUN scripted legs (stand-in records for the configured shape —
//     27 by default, 12 for the targeted L2 x 4 shape — through the FULL
//     state machine + aggregator; provider calls exactly 0).
//
// No provider, no network, no ModelRuntime in this module.

// ---------------------------------------------------------------------------
// Run identity (contract section 2)
// ---------------------------------------------------------------------------

/**
 * Accepts M1/M2 (consumed) and M3 identities: `cr004-m[123]-<ISO-date
 * undashed>-<8-hex>`, e.g. cr004-m1-20260826-d23a992c /
 * cr004-m2-20260827-4d7e9a1b / cr004-m3-20260827-9c1d2e3f.
 */
export const MX_RUN_ID_PATTERN = /^cr004-m[123]-\d{8}-[0-9a-f]{8}$/
/** Tonight's M3 run identities: cr004-m3-<ISO-date-undashed>-<8-hex>. */
export const MX_M3_RUN_ID_PATTERN = /^cr004-m3-\d{8}-[0-9a-f]{8}$/

export function isValidMxRunId(runId: string | undefined): runId is string {
  return runId !== undefined && MX_RUN_ID_PATTERN.test(runId)
}

/** True for an M3-pattern identity (the contract in force for new runs). */
export function isM3MxRunId(runId: string | undefined): runId is string {
  return runId !== undefined && MX_M3_RUN_ID_PATTERN.test(runId)
}

/**
 * Fresh single-use run identity suggestion; the Lead must export it. New runs
 * are M3 (`cr004-m3-*`); M1/M2 identities are consumed history.
 */
export function suggestMxRunId(now: Date = new Date()): string {
  const isoDate = now.toISOString().slice(0, 10).replace(/-/g, '')
  return `cr004-m3-${isoDate}-${randomBytes(4).toString('hex')}`
}

// ---------------------------------------------------------------------------
// Matrix definition (contract section 5)
// ---------------------------------------------------------------------------

export const MX_TASK_IDS = ['L1', 'L2', 'L3'] as const
export type MxTaskId = (typeof MX_TASK_IDS)[number]

/**
 * M3 three-arm strategy dimension: NATIVE and ACTIVE_V2 keep their exact M1/
 * M2 semantics; ACTIVE_V3 runs the same Active extension with removalPolicy
 * 'v3-verify-window-dedup' (v2 retain-latest coarse sweeps + duplicate-read
 * dedup + the verification-window deferral) and the raised per-leg bounds
 * (8 sends / 12 attempts). The v1 ACTIVE arm is M1/M2 history (replicated
 * twice) and is not part of the M3 design.
 */
export const MX_STRATEGIES = ['NATIVE', 'ACTIVE_V2', 'ACTIVE_V3'] as const

/**
 * Every strategy the analyzer understands, in canonical order — including the
 * historical v1 ACTIVE arm so M1/M2 evidence dirs still analyze correctly.
 */
export const MX_ALL_STRATEGIES = ['NATIVE', 'ACTIVE', 'ACTIVE_V2', 'ACTIVE_V3'] as const
export type MxStrategy = (typeof MX_ALL_STRATEGIES)[number]

/** Strategies that run the Active rewrite extension (treatment arms). */
export const MX_ACTIVE_STRATEGIES = ['ACTIVE', 'ACTIVE_V2', 'ACTIVE_V3'] as const
export type MxActiveStrategy = (typeof MX_ACTIVE_STRATEGIES)[number]

export const MX_REPETITIONS = 3
export const MX_TOTAL_LEGS = MX_TASK_IDS.length * MX_STRATEGIES.length * MX_REPETITIONS

/** Configurable repetitions bounds (CANVAS_MX_REPS; contract section 5). */
export const MX_MIN_REPETITIONS = 1
export const MX_MAX_REPETITIONS = 8

/** The validated matrix shape: which task cells and how many repetitions. */
export interface MxMatrixShape {
  /** Task slots to run, in canonical order (CANVAS_MX_TASKS). */
  readonly tasks: readonly MxTaskId[]
  /** Treatment arms to run, control first (fixed M3 arm set by default). */
  readonly strategies: readonly MxStrategy[]
  /** 1-based repetition count (CANVAS_MX_REPS, 1..8). */
  readonly repetitions: number
}

/** The M3 default design: L1,L2,L3 x NATIVE,ACTIVE_V2,ACTIVE_V3 x 3 = 27 legs. */
export const MX_DEFAULT_SHAPE: MxMatrixShape = {
  tasks: [...MX_TASK_IDS],
  strategies: [...MX_STRATEGIES],
  repetitions: MX_REPETITIONS
}

/** Configuration error in the matrix env knobs; the runner REFUSES on it. */
export class MxConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MxConfigError'
  }
}

/**
 * Parse CANVAS_MX_TASKS: a comma list from {L1,L2,L3}; default all three.
 * Refuses empty tokens, duplicates, and unknown slot names.
 */
export function parseMxTasksEnv(raw: string | undefined): readonly MxTaskId[] {
  if (raw === undefined) return [...MX_TASK_IDS]
  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '')
  if (tokens.length === 0) {
    throw new MxConfigError('CANVAS_MX_TASKS must be a comma list from {L1,L2,L3} (got an empty list)')
  }
  const tasks: MxTaskId[] = []
  for (const token of tokens) {
    if (!(MX_TASK_IDS as readonly string[]).includes(token)) {
      throw new MxConfigError(`CANVAS_MX_TASKS: unknown task slot '${token}' (allowed: L1,L2,L3)`)
    }
    if (tasks.includes(token as MxTaskId)) {
      throw new MxConfigError(`CANVAS_MX_TASKS: duplicate task slot '${token}'`)
    }
    tasks.push(token as MxTaskId)
  }
  // Canonical order regardless of the env listing.
  return MX_TASK_IDS.filter((task) => tasks.includes(task))
}

/**
 * Parse CANVAS_MX_REPS: an integer in [1, 8]; default 3.
 */
export function parseMxRepetitionsEnv(raw: string | undefined): number {
  if (raw === undefined) return MX_REPETITIONS
  if (!/^\d+$/.test(raw.trim())) {
    throw new MxConfigError(`CANVAS_MX_REPS must be an integer in [${MX_MIN_REPETITIONS}, ${MX_MAX_REPETITIONS}] (got '${raw}')`)
  }
  const parsed = Number.parseInt(raw.trim()!, 10)
  if (parsed < MX_MIN_REPETITIONS || parsed > MX_MAX_REPETITIONS) {
    throw new MxConfigError(`CANVAS_MX_REPS out of range: ${parsed} (allowed ${MX_MIN_REPETITIONS}..${MX_MAX_REPETITIONS})`)
  }
  return parsed
}

/** Resolve and validate the full matrix shape from the env knobs. */
export function mxShapeFromEnv(env: {
  readonly tasks?: string | undefined
  readonly reps?: string | undefined
}): MxMatrixShape {
  return {
    tasks: parseMxTasksEnv(env.tasks),
    strategies: [...MX_STRATEGIES],
    repetitions: parseMxRepetitionsEnv(env.reps)
  }
}

/** Total leg count of a shape. */
export function mxTotalLegsOf(shape: MxMatrixShape): number {
  return shape.tasks.length * shape.strategies.length * shape.repetitions
}

export interface MxLegPlan {
  /** 0-based position in the deterministic leg order. */
  readonly legIndex: number
  readonly task: MxTaskId
  readonly strategy: MxStrategy
  /** 1-based repetition number. */
  readonly rep: number
}

/**
 * Deterministic interleaved leg order for a shape: for rep 1..repetitions {
 * for task (shape order) { for strategy (shape order) } }. Default (M3):
 * 27 legs — control always precedes the treatment arms inside every
 * task x repetition cell, and the v2 treatment precedes the v3 treatment
 * (established policy first, new policy second).
 */
export function mxLegOrder(shape: MxMatrixShape = MX_DEFAULT_SHAPE): readonly MxLegPlan[] {
  const plans: MxLegPlan[] = []
  let legIndex = 0
  for (let rep = 1; rep <= shape.repetitions; rep += 1) {
    for (const task of shape.tasks) {
      for (const strategy of shape.strategies) {
        plans.push({ legIndex, task, strategy, rep })
        legIndex += 1
      }
    }
  }
  return plans
}

/** Directory segment per strategy: ACTIVE_V2 -> ACTIVE2, ACTIVE_V3 -> ACTIVE3. */
const MX_STRATEGY_DIR_SEGMENT: Readonly<Record<MxStrategy, string>> = {
  NATIVE: 'NATIVE',
  ACTIVE: 'ACTIVE',
  ACTIVE_V2: 'ACTIVE2',
  ACTIVE_V3: 'ACTIVE3'
}

export function mxLegDirName(plan: MxLegPlan): string {
  return `${plan.task}-${MX_STRATEGY_DIR_SEGMENT[plan.strategy]}-rep${plan.rep}`
}

// ---------------------------------------------------------------------------
// Budgets and stop conditions (contract sections 9-10)
// ---------------------------------------------------------------------------

export const MX_BUDGETS = {
  /** Default design: 3 tasks x 3 strategies x 3 repetitions (M3 three-arm); a configured shape scales this (state machine option). */
  maxLegs: MX_TOTAL_LEGS,
  /** Matrix total across all legs (C0 counting semantics). M1 was 400. */
  maxProviderCallRecords: 600,
  /** Matrix watchdog, measured from strict preparation to evidence-close. */
  runWallClockMs: 180 * 60 * 1000,
  /** Multi-intervention bound per ACTIVE (v1) leg (sends). M1 semantics. */
  maxInterventionsPerLeg: 5,
  /** Multi-intervention bound per ACTIVE (v1) leg (composition attempts). */
  maxAttemptsPerLeg: 8,
  /** Raised multi-intervention bound per ACTIVE_V2 leg (sends, policy v2). */
  maxInterventionsPerLegV2: 8,
  /** Raised multi-intervention bound per ACTIVE_V2 leg (attempts, policy v2). */
  maxAttemptsPerLegV2: 12,
  /** Policy-v2 cap on read pairs removed by ONE intervention (oldest-first). */
  maxBlocksPerInterventionV2: 12,
  /** Raised multi-intervention bound per ACTIVE_V3 leg (sends, policy v3). */
  maxInterventionsPerLegV3: 8,
  /** Raised multi-intervention bound per ACTIVE_V3 leg (attempts, policy v3). */
  maxAttemptsPerLegV3: 12,
  /** Policy-v3 cap on read pairs removed by ONE intervention (oldest-first). */
  maxBlocksPerInterventionV3: 12,
  /** Policy-v3 verification-window width in trailing tool events. */
  verifyWindowEventsV3: 2
} as const

/** Per-leg budget measures checked post-hoc at leg end. */
export interface MxLegBudgetMeasures {
  readonly providerCallRecords: number
  readonly toolCalls: number
  readonly wallClockMs: number
}

export interface MxLegStop {
  readonly condition: S1StopConditionId
  readonly reason: string
  readonly atIso: string
}

export interface MxMatrixStop {
  readonly condition: 'S-1' | 'S-7' | 'S-8'
  readonly reason: string
  readonly atIso: string
}

/**
 * Per-leg manifest budgets (leg-level, not matrix-level): a breach marks THIS
 * leg FAILED with S-7 and the matrix continues (contract section 10).
 */
export function evaluateMxLegBudgetStop(
  measures: MxLegBudgetMeasures,
  budget: { readonly maxSemanticCalls: number; readonly maxToolCalls: number; readonly wallClockMs: number }
): { readonly stop: false } | { readonly stop: true; readonly reason: string } {
  if (measures.providerCallRecords > budget.maxSemanticCalls) {
    return {
      stop: true,
      reason: `leg provider-call records ${measures.providerCallRecords} > manifest maxSemanticCalls ${budget.maxSemanticCalls}`
    }
  }
  if (measures.toolCalls > budget.maxToolCalls) {
    return {
      stop: true,
      reason: `leg tool calls ${measures.toolCalls} > manifest maxToolCalls ${budget.maxToolCalls}`
    }
  }
  if (measures.wallClockMs > budget.wallClockMs) {
    return {
      stop: true,
      reason: `leg wall clock ${measures.wallClockMs}ms > manifest wallClockMs ${budget.wallClockMs}ms`
    }
  }
  return { stop: false }
}

export type MxLegStatus = 'COMPLETED' | 'FAILED' | 'SKIPPED'

export interface MxLegLedger {
  readonly legIndex: number
  readonly task: MxTaskId
  readonly strategy: MxStrategy
  readonly rep: number
  readonly status: MxLegStatus
  readonly providerCallRecords: number
  readonly toolCalls: number
  readonly wallClockMs: number
  readonly oraclePass: boolean | null
  readonly stopCondition: { readonly condition: S1StopConditionId; readonly reason: string } | null
}

export interface MxMatrixLedgers {
  readonly legsAttempted: number
  readonly legsCompleted: number
  readonly legsFailed: number
  readonly providerCallRecordsTotal: number
  readonly toolCallsTotal: number
  readonly wallClockMsTotal: number
  readonly oraclePassNative: number
  readonly oraclePassActive: number
  /** M2 third arm (policy v2); 0 for M1-era evidence. */
  readonly oraclePassActiveV2: number
  /** M3 third arm (policy v3); 0 for M1/M2-era evidence. */
  readonly oraclePassActiveV3: number
  readonly runElapsedMs: number
}

/**
 * Matrix state machine. Leg-level failures NEVER stop the matrix; only the
 * matrix-level totals (S-7: 600 provider-call records / 180 minutes, checked
 * between legs) or a strict binding failure (S-1) are terminal. The leg-count
 * bound defaults to the 27-leg M3 design and scales with a configured shape
 * (passed by the runner). Deterministic under an injected clock; no I/O.
 */
export class MatrixStateMachine {
  private readonly ledgersByLeg: MxLegLedger[] = []
  private readonly firedStops: MxMatrixStop[] = []
  private matrixTerminal = false
  private readonly startedAtMs: number
  private readonly now: () => number
  private readonly nowIso: () => string
  private readonly maxLegs: number

  constructor(
    options: {
      readonly now?: () => number
      readonly nowIso?: () => string
      /** Leg-count bound for the configured shape. Default: MX_TOTAL_LEGS. */
      readonly maxLegs?: number
    } = {}
  ) {
    this.now = options.now ?? Date.now
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.startedAtMs = this.now()
    this.maxLegs = options.maxLegs ?? MX_BUDGETS.maxLegs
  }

  get isTerminal(): boolean {
    return this.matrixTerminal
  }

  get stopsFired(): readonly MxMatrixStop[] {
    return [...this.firedStops]
  }

  get legs(): readonly MxLegLedger[] {
    return [...this.ledgersByLeg]
  }

  ledgers(): MxMatrixLedgers {
    let providerCallRecordsTotal = 0
    let toolCallsTotal = 0
    let wallClockMsTotal = 0
    let legsCompleted = 0
    let legsFailed = 0
    let oraclePassNative = 0
    let oraclePassActive = 0
    let oraclePassActiveV2 = 0
    let oraclePassActiveV3 = 0
    for (const leg of this.ledgersByLeg) {
      providerCallRecordsTotal += leg.providerCallRecords
      toolCallsTotal += leg.toolCalls
      wallClockMsTotal += leg.wallClockMs
      if (leg.status === 'COMPLETED') legsCompleted += 1
      if (leg.status === 'FAILED') legsFailed += 1
      if (leg.oraclePass === true) {
        if (leg.strategy === 'NATIVE') oraclePassNative += 1
        else if (leg.strategy === 'ACTIVE') oraclePassActive += 1
        else if (leg.strategy === 'ACTIVE_V2') oraclePassActiveV2 += 1
        else oraclePassActiveV3 += 1
      }
    }
    return {
      legsAttempted: this.ledgersByLeg.length,
      legsCompleted,
      legsFailed,
      providerCallRecordsTotal,
      toolCallsTotal,
      wallClockMsTotal,
      oraclePassNative,
      oraclePassActive,
      oraclePassActiveV2,
      oraclePassActiveV3,
      runElapsedMs: this.now() - this.startedAtMs
    }
  }

  /** Fire a matrix-terminal stop (S-1 binding failure / S-7 totals). */
  fireMatrixStop(condition: 'S-1' | 'S-7' | 'S-8', reason: string): MxMatrixStop {
    this.matrixTerminal = true
    const stop: MxMatrixStop = { condition, reason, atIso: this.nowIso() }
    const duplicate = this.firedStops.some(
      (fired) => fired.condition === condition && fired.reason === reason
    )
    if (!duplicate) this.firedStops.push(stop)
    return stop
  }

  private evaluateTotalsStop(): { readonly stop: false } | { readonly stop: true; readonly reason: string } {
    const ledgers = this.ledgers()
    if (ledgers.providerCallRecordsTotal > MX_BUDGETS.maxProviderCallRecords) {
      return {
        stop: true,
        reason: `matrix provider-call budget breached: ${ledgers.providerCallRecordsTotal} > ${MX_BUDGETS.maxProviderCallRecords}`
      }
    }
    if (ledgers.runElapsedMs > MX_BUDGETS.runWallClockMs) {
      return {
        stop: true,
        reason: `matrix wall-clock budget breached: ${ledgers.runElapsedMs}ms > ${MX_BUDGETS.runWallClockMs}ms`
      }
    }
    return { stop: false }
  }

  /**
   * Begin one leg. Called BETWEEN legs, so the matrix totals are re-checked
   * here: over budget => stop launching new legs (S-7), evidence preserved.
   */
  beginLeg(plan: MxLegPlan):
    | { readonly ok: true; readonly leg: MxLegPlan }
    | { readonly ok: false; readonly stop: MxMatrixStop } {
    if (this.matrixTerminal) {
      return {
        ok: false,
        stop: this.fireMatrixStop('S-7', 'leg start refused: the matrix is already terminal')
      }
    }
    if (this.ledgersByLeg.length >= this.maxLegs) {
      return {
        ok: false,
        stop: this.fireMatrixStop('S-7', `matrix leg budget exhausted: ${this.ledgersByLeg.length} legs attempted`)
      }
    }
    const totals = this.evaluateTotalsStop()
    if (totals.stop) {
      return { ok: false, stop: this.fireMatrixStop('S-7', totals.reason) }
    }
    return { ok: true, leg: plan }
  }

  /**
   * Evidence-close one leg. A FAILED status (leg-level provider/safety error
   * or per-leg budget breach) is recorded on the leg only — the matrix
   * CONTINUES. Only a matrix-totals breach at this point becomes S-7.
   */
  endLeg(ledger: MxLegLedger): { readonly stop: false } | { readonly stop: true; readonly reason: string } {
    this.ledgersByLeg.push(ledger)
    const totals = this.evaluateTotalsStop()
    if (totals.stop) {
      this.fireMatrixStop('S-7', totals.reason)
      return totals
    }
    return { stop: false }
  }
}

// ---------------------------------------------------------------------------
// Task manifest resolution (L1/L2/L3; schema-identical to the frozen C1)
// ---------------------------------------------------------------------------

export interface MxTaskDefinition extends C1TaskDefinition {
  /** Matrix slot (L1/L2/L3) this manifest was resolved for. */
  readonly slot: MxTaskId
  /** Absolute path of the resolved manifest file. */
  readonly manifestPath: string
  readonly manifestSha256: string
  /** Absolute fixture directory (from the manifest fixturePath field). */
  readonly fixturePath: string | null
  /** The manifest's declared relative fixturePath, verbatim. */
  readonly fixtureRelPath: string | null
}

/**
 * Resolve the L-task manifests from a manifest directory. Each requested task
 * id (default: all three) must match exactly one `<task>-*.json` file; a
 * missing or ambiguous match refuses with a clear error. Fixtures are
 * existence-checked only when `requireFixtures` (LIVE mode; DRY_RUN never
 * touches fixtures). A targeted run (CANVAS_MX_TASKS=L2) resolves ONLY the
 * slots it will execute.
 */
export async function resolveMxTasks(options: {
  readonly manifestDir: string
  /** Root the manifest fixturePath is relative to (the benchmark root). */
  readonly benchmarkRoot: string
  readonly requireFixtures: boolean
  /** Task slots to resolve (default all; subset for targeted runs). */
  readonly taskIds?: readonly MxTaskId[]
}): Promise<readonly MxTaskDefinition[]> {
  const entries = await readdir(options.manifestDir, { withFileTypes: true })
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
  const tasks: MxTaskDefinition[] = []
  for (const taskId of options.taskIds ?? MX_TASK_IDS) {
    const matches = jsonFiles.filter((name) => new RegExp(`^${taskId}-.+\\.json$`).test(name))
    if (matches.length === 0) {
      throw new Error(
        `matrix task ${taskId}: no manifest matches ${join(options.manifestDir, `${taskId}-*.json`)} — the L-task fixture manifests are required before the matrix can run`
      )
    }
    if (matches.length > 1) {
      throw new Error(
        `matrix task ${taskId}: ambiguous manifest matches (${matches.join(', ')}) in ${options.manifestDir}`
      )
    }
    const manifestPath = join(options.manifestDir, matches[0]!)
    const rawContent = await readFile(manifestPath, 'utf8')
    const raw: unknown = JSON.parse(rawContent)
    const task = loadC1TaskDefinition(raw)
    const fixtureRel =
      typeof (raw as { fixturePath?: unknown }).fixturePath === 'string'
        ? (raw as { fixturePath: string }).fixturePath
        : null
    const fixturePath = fixtureRel !== null ? join(options.benchmarkRoot, fixtureRel) : null
    if (options.requireFixtures && fixturePath === null) {
      throw new Error(`matrix task ${taskId}: manifest ${manifestPath} declares no fixturePath`)
    }
    if (options.requireFixtures && fixturePath !== null) {
      const fixtureStat = await stat(fixturePath).catch(() => null)
      if (fixtureStat === null || !fixtureStat.isDirectory()) {
        throw new Error(
          `matrix task ${taskId}: fixture directory missing: ${fixturePath} (manifest ${manifestPath})`
        )
      }
    }
    tasks.push({
      ...task,
      slot: taskId,
      manifestPath,
      manifestSha256: createHash('sha256').update(rawContent, 'utf8').digest('hex'),
      fixturePath,
      fixtureRelPath: fixtureRel
    })
  }
  return tasks
}

// ---------------------------------------------------------------------------
// Leg evidence shapes (legs/<task>-<strategy>-rep<N>/leg.json)
// ---------------------------------------------------------------------------

export interface MxTrajectorySummary {
  /** Per-model-call observedMessageTokenEstimate sequence, in call order. */
  readonly series: readonly number[]
  readonly peak: number
  readonly final: number
  readonly sum: number
}

export function trajectorySummaryOf(series: readonly number[]): MxTrajectorySummary {
  return {
    series: [...series],
    peak: series.length === 0 ? 0 : Math.max(...series),
    final: series.length === 0 ? 0 : series[series.length - 1]!,
    sum: series.reduce((total, value) => total + value, 0)
  }
}

/**
 * Drop-at-boundary rate over a leg's trajectory: the fraction of SENT
 * interventions whose event shows a NET context drop against the previous
 * model call — series[seq-1] < series[seq-2] (1-based observer sequence, one
 * observation per model call). The M1 analysis found only 8/31 such drops;
 * this is the per-arm mechanism metric for the policy A/B.
 */
export function dropAtBoundaryOf(
  series: readonly number[],
  sentBoundarySequences: readonly (number | null)[]
): { readonly sent: number; readonly drops: number; readonly rate: number | null } {
  let sent = 0
  let drops = 0
  for (const sequence of sentBoundarySequences) {
    if (sequence === null) continue
    sent += 1
    if (sequence >= 2) {
      const atBoundary = series[sequence - 1]
      const before = series[sequence - 2]
      if (atBoundary !== undefined && before !== undefined && atBoundary < before) drops += 1
    }
  }
  return { sent, drops, rate: sent === 0 ? null : drops / sent }
}

export interface MxInterventionTelemetry {
  readonly events: readonly ActiveRewriteEventEvidence[]
  readonly interventions: readonly ActiveRewriteInterventionSummary[]
  readonly attemptsUsed: number
  readonly sendsUsed: number
  readonly killSwitchTripped: boolean
}

export interface MxFixtureSummary {
  /** sha256 over the sorted `relPath:contentHash` list (metadata-only). */
  readonly summarySha256: string
  readonly lineCount: number
  readonly fileCount: number
}

export interface MxLegRecord {
  readonly runId: string
  readonly mode: 'LIVE' | 'DRY_RUN'
  readonly legIndex: number
  readonly task: MxTaskId
  readonly strategy: MxStrategy
  readonly rep: number
  readonly status: MxLegStatus
  readonly oracleResults: readonly S1OracleResult[]
  readonly recordCount: number
  readonly toolCallCount: number
  readonly observedTokenEstimateSum: number
  readonly wallClockMs: number
  readonly replayMismatches: number
  readonly trajectory: MxTrajectorySummary
  /** ACTIVE legs only: the full multi-intervention telemetry. */
  readonly interventionTelemetry?: MxInterventionTelemetry
  readonly fixtureSummary?: MxFixtureSummary
  readonly finalArtifact?: { readonly path: string; readonly sha256: string; readonly lineCount: number }
  readonly stopCondition: { readonly condition: S1StopConditionId; readonly reason: string } | null
  readonly fixtureDirRemoved: boolean
}

// ---------------------------------------------------------------------------
// Incremental evidence writers — after EACH leg, never buffered to the end
// ---------------------------------------------------------------------------

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * Write one leg's full evidence immediately at leg end: legs/<dir>/leg.json
 * plus legs/<dir>/observations.jsonl. Returns the leg directory.
 */
export async function writeMxLegEvidence(
  reportDir: string,
  record: MxLegRecord,
  observations: readonly ModelCallObservation[]
): Promise<string> {
  const plan: MxLegPlan = {
    legIndex: record.legIndex,
    task: record.task,
    strategy: record.strategy,
    rep: record.rep
  }
  const legDir = join(reportDir, 'legs', mxLegDirName(plan))
  await mkdir(legDir, { recursive: true })
  await writeJson(join(legDir, 'leg.json'), record)
  const sink = new JsonlObservationSink({ directory: legDir, sessionId: 'observations' })
  for (const observation of observations) sink.write(observation)
  await sink.closeAndFlush()
  return legDir
}

/** Rewrite the run manifest.json (binding, budgets, ledgers, stops, leg index). */
export async function writeMxManifest(reportDir: string, manifest: unknown): Promise<void> {
  await mkdir(reportDir, { recursive: true })
  await writeJson(join(reportDir, 'manifest.json'), manifest)
}

/** Rewrite matrix.json — the aggregate so far (updated after every leg). */
export async function writeMxAggregate(reportDir: string, aggregate: unknown): Promise<void> {
  await mkdir(reportDir, { recursive: true })
  await writeJson(join(reportDir, 'matrix.json'), aggregate)
}

// ---------------------------------------------------------------------------
// Offline aggregation: per-cell stats + trajectories + ACTIVE telemetry
// ---------------------------------------------------------------------------

function meanOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export interface MxLegAnalysisInput {
  readonly task: MxTaskId
  readonly strategy: MxStrategy
  readonly status: MxLegStatus
  readonly oraclePass: boolean | null
  readonly regressionPass: boolean | null
  readonly writablePass: boolean | null
  readonly recordCount: number
  readonly toolCallCount: number
  readonly wallClockMs: number
  readonly observedTokenEstimateSum: number
  readonly tokenSeries: readonly number[]
  readonly standInOracle: boolean
  readonly interventions?: {
    readonly attempts: number
    readonly sends: number
    readonly fallbackReasons: readonly string[]
    readonly toolBlocksRemoved: number
    readonly reReads: number
    readonly postFirstInterventionReads: number
    /** Removal policy of this leg's arm ('v1-per-edit' | 'v2-retain-latest-coarse' | 'v3-verify-window-dedup'). */
    readonly policy: string
    /** Eligible candidate read pairs found across interventions (pre-cap). */
    readonly candidateBlocks: number
    /** Read pairs marked superseded across interventions (post-cap). */
    readonly removedBlocks: number
    /** Total retained-latest read targets recorded (v2/v3 legs). */
    readonly retainedLatestReadTargets: number
    /** Observer sequences of SENT interventions (drop-at-boundary input). */
    readonly sentBoundarySequences: readonly (number | null)[]
    /** Read pairs removed by DEDUP-triggered interventions (v3 legs; 0 otherwise). */
    readonly dedupRemovals: number
    /** Boundary evaluations that deferred an edit sweep (v3 legs; 0 otherwise). */
    readonly deferredSweeps: number
  }
}

export interface MxCellAggregate {
  readonly task: MxTaskId
  readonly strategy: MxStrategy
  readonly n: number
  readonly completed: number
  readonly failed: number
  readonly oracle: { readonly pass: number; readonly fail: number; readonly notRun: number; readonly passRate: number | null }
  readonly regression: { readonly pass: number; readonly fail: number; readonly notRun: number }
  readonly writableConformance: { readonly pass: number; readonly fail: number; readonly notRun: number }
  readonly recordCount: { readonly mean: number | null; readonly median: number | null }
  readonly toolCalls: { readonly mean: number | null }
  readonly wallClockMs: { readonly mean: number | null; readonly median: number | null }
  readonly tokenEstimateSum: { readonly mean: number | null; readonly values: readonly number[] }
  readonly trajectory: {
    readonly meanPeak: number | null
    readonly meanFinal: number | null
    readonly meanSum: number | null
    readonly legs: readonly { readonly peak: number; readonly final: number; readonly sum: number }[]
  }
  readonly active?: {
    readonly policy: string
    readonly attempts: number
    readonly sends: number
    readonly fallbackReasons: Readonly<Record<string, number>>
    readonly toolBlocksRemoved: number
    readonly candidateBlocks: number
    readonly removedBlocks: number
    readonly retainedLatestReadTargets: number
    readonly dropAtBoundary: { readonly sent: number; readonly drops: number; readonly rate: number | null }
    readonly reReads: number
    readonly postFirstInterventionReads: number
    /** Read pairs removed by DEDUP-triggered interventions (v3 legs; 0 otherwise). */
    readonly dedupRemovals: number
    /** Boundary evaluations that deferred an edit sweep (v3 legs; 0 otherwise). */
    readonly deferredSweeps: number
  }
}

export function mxLegAnalysisInputOf(record: MxLegRecord): MxLegAnalysisInput {
  const primaryOf = (kind: 'PRIMARY' | 'REGRESSION' | 'WRITABLE_CONFORMANCE'): boolean | null => {
    const results = record.oracleResults.filter(
      (result) => !result.standIn && result.kind === kind
    )
    if (results.length === 0) return null
    return results.every((result) => result.pass === true)
  }
  const standIn = record.oracleResults.some((result) => result.standIn === true)
  const telemetry = record.interventionTelemetry
  const reReads = telemetry !== undefined ? detectReReads(telemetry.events) : null
  return {
    task: record.task,
    strategy: record.strategy,
    status: record.status,
    oraclePass: primaryOf('PRIMARY'),
    regressionPass: primaryOf('REGRESSION'),
    writablePass: primaryOf('WRITABLE_CONFORMANCE'),
    recordCount: record.recordCount,
    toolCallCount: record.toolCallCount,
    wallClockMs: record.wallClockMs,
    observedTokenEstimateSum: record.observedTokenEstimateSum,
    tokenSeries: record.trajectory.series,
    standInOracle: standIn,
    ...(telemetry !== undefined && reReads !== null
      ? {
          interventions: {
            attempts: telemetry.attemptsUsed,
            sends: telemetry.sendsUsed,
            fallbackReasons: telemetry.interventions
              .filter((attempt) => !attempt.sentRewrite)
              .map((attempt) => attempt.fallbackReason ?? attempt.guardFallbackReason ?? 'UNKNOWN'),
            toolBlocksRemoved: telemetry.interventions.reduce(
              (total, attempt) => total + attempt.toolBlocksRemoved,
              0
            ),
            // M1-era evidence lacks the policy fields; they degrade to v1/0.
            policy:
              telemetry.interventions.find((attempt) => attempt.policy !== null)?.policy ??
              'v1-per-edit',
            candidateBlocks: telemetry.interventions.reduce(
              (total, attempt) => total + (attempt.candidateBlocks ?? 0),
              0
            ),
            removedBlocks: telemetry.interventions.reduce(
              (total, attempt) => total + (attempt.removedBlocks ?? 0),
              0
            ),
            retainedLatestReadTargets: telemetry.interventions.reduce(
              (total, attempt) => total + (attempt.retainedLatestReadTargets?.length ?? 0),
              0
            ),
            sentBoundarySequences: telemetry.interventions
              .filter((attempt) => attempt.sentRewrite)
              .map((attempt) => attempt.boundarySequence),
            // M1/M2-era evidence lacks the trigger/deferral fields; both
            // degrade to 0.
            dedupRemovals: telemetry.interventions.reduce(
              (total, attempt) =>
                total + (attempt.trigger === 'dedup' ? (attempt.removedBlocks ?? 0) : 0),
              0
            ),
            deferredSweeps: telemetry.events.filter(
              (event) => event.deferredByVerifyWindow === true
            ).length,
            reReads: reReads.matches.length,
            postFirstInterventionReads: reReads.postFirstInterventionReadCount
          }
        }
      : {})
  }
}

export function aggregateMxCells(inputs: readonly MxLegAnalysisInput[]): readonly MxCellAggregate[] {
  const cells: MxCellAggregate[] = []
  // Canonical iteration over EVERY strategy the analyzer understands (the
  // historical v1 ACTIVE arm included): absent arms simply contribute no
  // cell, so M1/M2/M3 evidence dirs all aggregate correctly.
  for (const task of MX_TASK_IDS) {
    for (const strategy of MX_ALL_STRATEGIES) {
      const legs = inputs.filter((input) => input.task === task && input.strategy === strategy)
      if (legs.length === 0) continue
      const rateOf = (
        values: readonly (boolean | null)[]
      ): { pass: number; fail: number; notRun: number; passRate: number | null } => {
        const pass = values.filter((value) => value === true).length
        const fail = values.filter((value) => value === false).length
        const notRun = values.filter((value) => value === null).length
        return { pass, fail, notRun, passRate: pass + fail === 0 ? null : pass / (pass + fail) }
      }
      const trajectories = legs.map((leg) => trajectorySummaryOf(leg.tokenSeries))
      const fallbackReasons: Record<string, number> = {}
      let attempts = 0
      let sends = 0
      let toolBlocksRemoved = 0
      let candidateBlocks = 0
      let removedBlocks = 0
      let retainedLatestReadTargets = 0
      let dropSent = 0
      let dropDrops = 0
      let reReads = 0
      let postFirstInterventionReads = 0
      let dedupRemovals = 0
      let deferredSweeps = 0
      let hasActive = false
      let activePolicy = 'v1-per-edit'
      for (const leg of legs) {
        if (leg.interventions === undefined) continue
        hasActive = true
        // The arm's strategy is authoritative; the per-leg policy payload
        // degrades to the v1 default when a leg fired zero interventions.
        if (leg.strategy === 'ACTIVE_V2') {
          activePolicy = 'v2-retain-latest-coarse'
        } else if (leg.strategy === 'ACTIVE_V3') {
          activePolicy = 'v3-verify-window-dedup'
        } else if (leg.interventions.policy !== 'v1-per-edit') {
          activePolicy = leg.interventions.policy
        }
        attempts += leg.interventions.attempts
        sends += leg.interventions.sends
        toolBlocksRemoved += leg.interventions.toolBlocksRemoved
        candidateBlocks += leg.interventions.candidateBlocks
        removedBlocks += leg.interventions.removedBlocks
        retainedLatestReadTargets += leg.interventions.retainedLatestReadTargets
        dedupRemovals += leg.interventions.dedupRemovals
        deferredSweeps += leg.interventions.deferredSweeps
        const drop = dropAtBoundaryOf(leg.tokenSeries, leg.interventions.sentBoundarySequences)
        dropSent += drop.sent
        dropDrops += drop.drops
        reReads += leg.interventions.reReads
        postFirstInterventionReads += leg.interventions.postFirstInterventionReads
        for (const reason of leg.interventions.fallbackReasons) {
          fallbackReasons[reason] = (fallbackReasons[reason] ?? 0) + 1
        }
      }
      cells.push({
        task,
        strategy,
        n: legs.length,
        completed: legs.filter((leg) => leg.status === 'COMPLETED').length,
        failed: legs.filter((leg) => leg.status === 'FAILED').length,
        oracle: rateOf(legs.map((leg) => leg.oraclePass)),
        regression: rateOf(legs.map((leg) => leg.regressionPass)),
        writableConformance: rateOf(legs.map((leg) => leg.writablePass)),
        recordCount: {
          mean: meanOf(legs.map((leg) => leg.recordCount)),
          median: medianOf(legs.map((leg) => leg.recordCount))
        },
        toolCalls: { mean: meanOf(legs.map((leg) => leg.toolCallCount)) },
        wallClockMs: {
          mean: meanOf(legs.map((leg) => leg.wallClockMs)),
          median: medianOf(legs.map((leg) => leg.wallClockMs))
        },
        tokenEstimateSum: {
          mean: meanOf(legs.map((leg) => leg.observedTokenEstimateSum)),
          values: legs.map((leg) => leg.observedTokenEstimateSum)
        },
        trajectory: {
          meanPeak: meanOf(trajectories.map((trajectory) => trajectory.peak)),
          meanFinal: meanOf(trajectories.map((trajectory) => trajectory.final)),
          meanSum: meanOf(trajectories.map((trajectory) => trajectory.sum)),
          legs: trajectories.map((trajectory) => ({
            peak: trajectory.peak,
            final: trajectory.final,
            sum: trajectory.sum
          }))
        },
        ...(hasActive
          ? {
              active: {
                policy: activePolicy,
                attempts,
                sends,
                fallbackReasons,
                toolBlocksRemoved,
                candidateBlocks,
                removedBlocks,
                retainedLatestReadTargets,
                dropAtBoundary: {
                  sent: dropSent,
                  drops: dropDrops,
                  rate: dropSent === 0 ? null : dropDrops / dropSent
                },
                reReads,
                postFirstInterventionReads,
                dedupRemovals,
                deferredSweeps
              }
            }
          : {})
      })
    }
  }
  return cells
}

// ---------------------------------------------------------------------------
// Exact permutation test (two-sided, descriptive only)
// ---------------------------------------------------------------------------

export interface MxPermutationTest {
  readonly nNative: number
  readonly nActive: number
  readonly nativeSum: number
  readonly activeSum: number
  /** activeSum - nativeSum of the observed labeling. */
  readonly observedDifference: number
  /** Total number of distinct label assignments (C(n, nActive)). */
  readonly assignments: number
  /** Assignments at least as extreme as the observed one (two-sided). */
  readonly asExtreme: number
  readonly pValue: number
  readonly caveat: string
}

export const MX_LOW_POWER_CAVEAT =
  'small-n per cell: descriptive statistics and exact enumeration of all label assignments only; low statistical power; no causal claim'

function combinationSums(pool: readonly number[], k: number): readonly number[] {
  const sums: number[] = []
  const walk = (start: number, sumSoFar: number, depth: number): void => {
    if (depth === k) {
      sums.push(sumSoFar)
      return
    }
    for (let value = start; value <= pool.length - (k - depth); value += 1) {
      walk(value + 1, sumSoFar + pool[value]!, depth + 1)
    }
  }
  if (k >= 0 && k <= pool.length) walk(0, 0, 0)
  return sums
}

/**
 * Exact two-sided permutation test for a NATIVE vs ACTIVE difference in
 * per-leg sums: enumerate ALL equally-many label assignments of the pooled
 * legs and count how many produce a difference at least as extreme as the
 * observed one. Hand-checkable: perfectly separated groups of 3v3 give
 * p = 2/20 (the true labeling and its mirror); identical groups give p = 1.
 */
export function exactPermutationTest(
  native: readonly number[],
  active: readonly number[]
): MxPermutationTest | null {
  if (native.length === 0 || active.length === 0) return null
  const pool = [...native, ...active]
  const nativeSum = native.reduce((a, b) => a + b, 0)
  const activeSum = active.reduce((a, b) => a + b, 0)
  const totalSum = nativeSum + activeSum
  const observedDifference = activeSum - nativeSum
  const tolerance = 1e-9
  const chosenSums = combinationSums(pool, active.length)
  let asExtreme = 0
  for (const chosenSum of chosenSums) {
    const difference = chosenSum - (totalSum - chosenSum)
    if (Math.abs(difference) >= Math.abs(observedDifference) - tolerance) asExtreme += 1
  }
  return {
    nNative: native.length,
    nActive: active.length,
    nativeSum,
    activeSum,
    observedDifference,
    assignments: chosenSums.length,
    asExtreme,
    pValue: asExtreme / chosenSums.length,
    caveat: MX_LOW_POWER_CAVEAT
  }
}

/**
 * Pairwise arm comparisons across the strategies PRESENT in the cells, in
 * canonical order (an M3 dir yields NATIVE_vs_ACTIVE_V2, NATIVE_vs_ACTIVE_V3,
 * ACTIVE_V2_vs_ACTIVE_V3; an M2 dir yields the M2 trio; an M1 dir only
 * NATIVE_vs_ACTIVE).
 */
export function mxArmComparisons(present: readonly MxStrategy[]): readonly {
  readonly label: string
  readonly first: MxStrategy
  readonly second: MxStrategy
}[] {
  const ordered = MX_ALL_STRATEGIES.filter((strategy) => present.includes(strategy))
  const comparisons: { label: string; first: MxStrategy; second: MxStrategy }[] = []
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const first = ordered[i]!
      const second = ordered[j]!
      comparisons.push({ label: `${first}_vs_${second}`, first, second })
    }
  }
  return comparisons
}

/** One per-task arm comparison with its exact permutation test. */
export interface MxArmComparisonTest {
  readonly task: MxTaskId
  readonly comparison: string
  readonly permutation: MxPermutationTest
}

/** Per-task exact permutation tests over observedTokenEstimateSum, all PRESENT arm pairs. */
export function mxPermutationTests(
  cells: readonly MxCellAggregate[]
): readonly MxArmComparisonTest[] {
  const tests: MxArmComparisonTest[] = []
  const present = [...new Set(cells.map((cell) => cell.strategy))]
  for (const task of MX_TASK_IDS) {
    for (const comparison of mxArmComparisons(present)) {
      const first = cells.find((cell) => cell.task === task && cell.strategy === comparison.first)
      const second = cells.find((cell) => cell.task === task && cell.strategy === comparison.second)
      if (first === undefined || second === undefined) continue
      const permutation = exactPermutationTest(
        first.tokenEstimateSum.values,
        second.tokenEstimateSum.values
      )
      if (permutation !== null) {
        tests.push({ task, comparison: comparison.label, permutation })
      }
    }
  }
  return tests
}

// ---------------------------------------------------------------------------
// Re-read detection from intervention telemetry
// ---------------------------------------------------------------------------

export interface MxReReadMatch {
  /** 1-based index of the last intervention before the re-read. */
  readonly afterInterventionIndex: number
  readonly readTargetHash: string
  readonly sequence: number
}

export interface MxReReadAnalysis {
  readonly matches: readonly MxReReadMatch[]
  /** New read-class calls observed strictly after the FIRST intervention. */
  readonly postFirstInterventionReadCount: number
  readonly firstInterventionSequence: number | null
}

/**
 * A readTargetHash observed (as a NEW read call) after an intervention that
 * removed a pair with the same hash = a re-read of a removed target. Pure
 * function of the per-event telemetry sequence.
 */
export function detectReReads(events: readonly ActiveRewriteEventEvidence[]): MxReReadAnalysis {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence)
  const removedSoFar = new Set<string>()
  let interventionsSoFar = 0
  let firstInterventionSequence: number | null = null
  const matches: MxReReadMatch[] = []
  let postFirstInterventionReadCount = 0
  for (const event of ordered) {
    // Reads observed at this event are evaluated against targets removed by
    // STRICTLY EARLIER interventions (this event's own removals cannot have
    // caused the read that motivated them).
    if (firstInterventionSequence !== null && event.sequence > firstInterventionSequence) {
      postFirstInterventionReadCount += (event.readTargets ?? []).length
      for (const target of event.readTargets ?? []) {
        if (removedSoFar.has(target.readTargetHash)) {
          matches.push({
            afterInterventionIndex: interventionsSoFar,
            readTargetHash: target.readTargetHash,
            sequence: event.sequence
          })
        }
      }
    }
    if (event.interventionAttempted) {
      interventionsSoFar += 1
      if (firstInterventionSequence === null) firstInterventionSequence = event.sequence
      for (const hash of event.removedReadTargetHashes ?? []) removedSoFar.add(hash)
    }
  }
  return { matches, postFirstInterventionReadCount, firstInterventionSequence }
}

// ---------------------------------------------------------------------------
// Aggregate verdicts (raw numbers only, no causal language)
// ---------------------------------------------------------------------------

export interface MxVerdict {
  readonly reliability: string
  readonly contextEfficiency: string
}

export function mxVerdictOf(cells: readonly MxCellAggregate[]): MxVerdict {
  const present = MX_ALL_STRATEGIES.filter((strategy) =>
    cells.some((cell) => cell.strategy === strategy)
  )
  const oracleOf = (strategy: MxStrategy): { pass: number; evaluated: number } => {
    const armCells = cells.filter((cell) => cell.strategy === strategy)
    return {
      pass: armCells.reduce((total, cell) => total + cell.oracle.pass, 0),
      evaluated: armCells.reduce((total, cell) => total + cell.oracle.pass + cell.oracle.fail, 0)
    }
  }
  const oracles = present.map((strategy) => ({ strategy, ...oracleOf(strategy) }))
  const identical =
    oracles.length === 0 ||
    oracles.every(
      (arm, index) =>
        index === 0 ||
        (arm.pass === oracles[0]!.pass && arm.evaluated === oracles[0]!.evaluated)
    )
  const reliability = `reliability ${identical ? 'identical' : 'differentiated'} (raw): ${oracles
    .map((arm, index) =>
      index === 0
        ? `${arm.strategy} oracle ${arm.pass}/${arm.evaluated}`
        : `${arm.strategy} ${arm.pass}/${arm.evaluated}`
    )
    .join(' vs ')}`
  const meanOfArm = (strategy: MxStrategy): number | null =>
    meanOf(
      cells
        .filter((cell) => cell.strategy === strategy)
        .map((cell) => cell.tokenEstimateSum.mean ?? Number.NaN)
        .filter((value) => !Number.isNaN(value))
    )
  const means: { readonly strategy: MxStrategy; readonly mean: number }[] = []
  for (const strategy of present) {
    const mean = meanOfArm(strategy)
    if (mean !== null) means.push({ strategy, mean })
  }
  if (means.length < 2) {
    return { reliability, contextEfficiency: 'context-efficiency: insufficient data (fewer than two arms with completed cells)' }
  }
  const lowest = means.reduce((a, b) => (b.mean < a.mean ? b : a))
  const highest = means.reduce((a, b) => (b.mean > a.mean ? b : a))
  const direction =
    lowest.mean === highest.mean
      ? 'all equal'
      : `${lowest.strategy} lowest, ${highest.strategy} highest`
  return {
    reliability,
    contextEfficiency: `context-efficiency direction (raw, observedTokenEstimateSum mean-of-cell-means): ${means
      .map((arm) => `${arm.strategy} ${arm.mean.toFixed(0)}`)
      .join(' vs ')} (${direction})`
  }
}

/** One-line per-cell summary for stdout. */
export function mxCellOneLiner(cell: MxCellAggregate): string {
  const oracle =
    cell.oracle.passRate === null
      ? `oracle=${cell.oracle.pass}/${cell.oracle.pass + cell.oracle.fail}`
      : `oracle=${cell.oracle.pass}/${cell.oracle.pass + cell.oracle.fail} (${(cell.oracle.passRate * 100).toFixed(0)}%)`
  const tokens = cell.tokenEstimateSum.mean === null ? 'n/a' : cell.tokenEstimateSum.mean.toFixed(0)
  const base = `cell ${cell.task}/${cell.strategy} n=${cell.n} (completed=${cell.completed} failed=${cell.failed}) ${oracle} records~${cell.recordCount.mean?.toFixed(1) ?? 'n/a'} tools~${cell.toolCalls.mean?.toFixed(1) ?? 'n/a'} tokenSum~${tokens} trajPeak~${cell.trajectory.meanPeak?.toFixed(0) ?? 'n/a'} trajFinal~${cell.trajectory.meanFinal?.toFixed(0) ?? 'n/a'}`
  if (cell.active === undefined) return base
  const fallbacks = Object.entries(cell.active.fallbackReasons)
    .map(([reason, count]) => `${reason}x${count}`)
    .join(',')
  const dropRate =
    cell.active.dropAtBoundary.rate === null
      ? 'n/a'
      : `${(cell.active.dropAtBoundary.rate * 100).toFixed(0)}%`
  return `${base} policy=${cell.active.policy} interventions=${cell.active.sends}/${cell.active.attempts}${fallbacks === '' ? '' : ` fallbacks=[${fallbacks}]`} removedBlocks=${cell.active.removedBlocks}${cell.active.candidateBlocks > cell.active.removedBlocks ? ` (capped from ${cell.active.candidateBlocks})` : ''} retainedLatest=${cell.active.retainedLatestReadTargets} dropAtBoundary=${cell.active.dropAtBoundary.drops}/${cell.active.dropAtBoundary.sent} (${dropRate}) reReads=${cell.active.reReads} postFirstReads=${cell.active.postFirstInterventionReads} dedupRemovals=${cell.active.dedupRemovals} deferredSweeps=${cell.active.deferredSweeps}`
}

// ---------------------------------------------------------------------------
// Offline analyzer: analyzeMatrix(reportDir)
// ---------------------------------------------------------------------------

export interface MxAnalysisOutput {
  readonly analysis: {
    readonly reportDir: string
    readonly generatedAt: string
    readonly legsAnalyzed: number
    readonly cells: readonly MxCellAggregate[]
    readonly perTask: readonly MxArmComparisonTest[]
    readonly verdict: MxVerdict
  }
  readonly markdown: string
}

export async function analyzeMatrix(reportDir: string): Promise<MxAnalysisOutput> {
  const legsDir = join(reportDir, 'legs')
  const legDirs = (await readdir(legsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const inputs: MxLegAnalysisInput[] = []
  for (const legDir of legDirs) {
    const legJson = await readFile(join(legsDir, legDir, 'leg.json'), 'utf8')
    const record = JSON.parse(legJson) as MxLegRecord
    // Context trajectory from the observations file (per-model-call estimates).
    let series: readonly number[] = record.trajectory.series
    try {
      const raw = await readFile(join(legsDir, legDir, 'observations.jsonl'), 'utf8')
      const parsed = raw
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as { observedMessageTokenEstimate?: unknown })
        .map((observation) =>
          typeof observation.observedMessageTokenEstimate === 'number'
            ? observation.observedMessageTokenEstimate
            : 0
        )
      if (parsed.length > 0) series = parsed
    } catch {
      // observations.jsonl absent: fall back to the leg.json trajectory.
    }
    inputs.push(mxLegAnalysisInputOf({ ...record, trajectory: trajectorySummaryOf(series) }))
  }
  const cells = aggregateMxCells(inputs)
  const perTask = mxPermutationTests(cells)
  const verdict = mxVerdictOf(cells)
  const analysis = {
    reportDir,
    generatedAt: new Date().toISOString(),
    legsAnalyzed: inputs.length,
    cells,
    perTask,
    verdict
  }

  const lines: string[] = []
  lines.push(`# CR-004 Matrix Analysis — ${reportDir}`)
  lines.push('')
  lines.push(`Legs analyzed: ${inputs.length}. Metadata-only; token figures are internal estimates, not provider measurements.`)
  lines.push('')
  lines.push('## Per-cell aggregates')
  lines.push('')
  lines.push('| Cell | n | oracle | records (mean/median) | tools | wall ms (mean/median) | tokenSum mean | trajectory peak / final / sum (means) |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const cell of cells) {
    lines.push(
      `| ${cell.task}/${cell.strategy} | ${cell.n} | ${cell.oracle.pass}/${cell.oracle.pass + cell.oracle.fail} | ${cell.recordCount.mean?.toFixed(1) ?? '-'}/${cell.recordCount.median ?? '-'} | ${cell.toolCalls.mean?.toFixed(1) ?? '-'} | ${cell.wallClockMs.mean?.toFixed(0) ?? '-'}/${cell.wallClockMs.median ?? '-'} | ${cell.tokenEstimateSum.mean?.toFixed(0) ?? '-'} | ${cell.trajectory.meanPeak?.toFixed(0) ?? '-'} / ${cell.trajectory.meanFinal?.toFixed(0) ?? '-'} / ${cell.trajectory.meanSum?.toFixed(0) ?? '-'} |`
    )
  }
  lines.push('')
  lines.push('Per-leg context trajectories (observedMessageTokenEstimate per model call; NATIVE expected monotonic, ACTIVE arms should show drops at interventions):')
  for (const cell of cells) {
    lines.push(`- ${cell.task}/${cell.strategy}: ${cell.trajectory.legs.map((leg) => `peak=${leg.peak},final=${leg.final},sum=${leg.sum}`).join(' | ')}`)
  }
  lines.push('')
  lines.push('## Per-arm Active intervention telemetry (policy A/B)')
  lines.push('')
  for (const cell of cells.filter((candidate) => candidate.active !== undefined)) {
    const active = cell.active!
    lines.push(
      `- ${cell.task}/${cell.strategy}: policy=${active.policy}, sends=${active.sends}/${active.attempts} attempts, removedBlocks=${active.removedBlocks}${active.candidateBlocks > active.removedBlocks ? ` (capped from ${active.candidateBlocks} candidates)` : ` (candidates=${active.candidateBlocks})`}, retainedLatestReadTargets=${active.retainedLatestReadTargets}, dropAtBoundary=${active.dropAtBoundary.drops}/${active.dropAtBoundary.sent}${active.dropAtBoundary.rate === null ? '' : ` (${(active.dropAtBoundary.rate * 100).toFixed(0)}%)`}, reReadsOfRemovedTargets=${active.reReads}, postFirstInterventionReads=${active.postFirstInterventionReads}, dedupRemovals=${active.dedupRemovals}, deferredSweeps=${active.deferredSweeps}${Object.keys(active.fallbackReasons).length === 0 ? '' : `, fallbacks=${JSON.stringify(active.fallbackReasons)}`}`
    )
  }
  lines.push('')
  lines.push('## Per-task exact permutation tests (observedTokenEstimateSum, all arm pairs)')
  lines.push('')
  if (perTask.length === 0) {
    lines.push('(insufficient legs on one side)')
  }
  for (const { task, comparison, permutation } of perTask) {
    lines.push(
      `- ${task} ${comparison}: first-arm sum=${permutation.nativeSum} vs second-arm sum=${permutation.activeSum}; observed diff=${permutation.observedDifference}; p=${permutation.pValue.toFixed(3)} (${permutation.asExtreme}/${permutation.assignments} assignments). ${permutation.caveat}.`
    )
  }
  lines.push('')
  lines.push('## Verdict (raw, descriptive)')
  lines.push('')
  lines.push(`- ${verdict.reliability}`)
  lines.push(`- ${verdict.contextEfficiency}`)
  lines.push('')

  return { analysis, markdown: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// DRY_RUN scripted legs (provider calls exactly 0)
// ---------------------------------------------------------------------------

function scriptedEvent(
  sequence: number,
  observedTokenEstimate: number,
  extra: Partial<ActiveRewriteEventEvidence> = {}
): ActiveRewriteEventEvidence {
  return {
    sequence,
    observedTokenEstimate,
    boundaryReached: false,
    interventionAttempted: false,
    compositionVerdict: 'NOT_ATTEMPTED',
    guardVerdict: 'NOT_ATTEMPTED',
    sentRewrite: false,
    killSwitchTripped: false,
    toolBlocksRemoved: 0,
    ...extra
  }
}

function scriptedInterventionsOf(
  sequences: readonly { readonly sequence: number; readonly hash: string; readonly path: string }[]
): readonly ActiveRewriteInterventionSummary[] {
  return sequences.map((sent, index) => ({
    boundarySequence: sent.sequence,
    interventionPath: sent.path,
    interventionIndex: index + 1,
    attemptOutcome: 'SENT' as const,
    compositionVerdict: 'REWRITE_READY' as const,
    guardVerdict: 'PASS' as const,
    sentRewrite: true,
    killSwitchTripped: false,
    toolBlocksRemoved: 1,
    removedSourceKeys: [`run/tool-call://scripted-${sent.sequence}`, `run/tool-result://scripted-${sent.sequence}`],
    composedMessageCount: 4,
    latchSetAtSequence: sent.sequence,
    removedReadTargetHashes: [sent.hash],
    policy: 'v1-per-edit' as const,
    trigger: 'edit' as const,
    candidateBlocks: 1,
    removedBlocks: 1,
    retainedLatestReadTargets: []
  }))
}

/**
 * Scripted stand-in legs for DRY_RUN: one record per leg of the configured
 * shape (default: the 27-leg M3 matrix order, 3 tasks x NATIVE/ACTIVE_V2/
 * ACTIVE_V3 x 3 reps; the historical v1 ACTIVE arm still scripts for M1/M2-
 * shaped tests), driven through the FULL matrix state machine, incremental
 * evidence writers, and aggregator by the runner. NATIVE trajectories are
 * monotonic; ACTIVE trajectories drop after each scripted v1 intervention,
 * with one scripted re-read of a removed target per leg (the M1 L2 pattern)
 * so the analyzer's re-read detection is exercised; ACTIVE_V2 trajectories
 * carry v2-shaped telemetry — ONE coarse intervention removing three read
 * pairs across two edited paths while retaining the latest read of each swept
 * path, a net drop AT the boundary (series[seq-1] < series[seq-2]), and a
 * post-intervention read of a FRESH target (retain-latest kills the re-read
 * pattern: reReads=0); ACTIVE_V3 trajectories carry v3-shaped telemetry — a
 * DEDUP-triggered intervention (identical re-read of an already-read path,
 * removed with NO edit boundary in flight), one edit sweep DEFERRED by the
 * verification window (deferredByVerifyWindow event telemetry), then the
 * resumed edit sweep once the window closes (dedupRemovals=1,
 * deferredSweeps=1 per leg). Provider calls: 0.
 */
export function scriptedMxLegRecords(
  runId: string,
  shape: MxMatrixShape = MX_DEFAULT_SHAPE
): readonly MxLegRecord[] {
  const nativeSeries = [400, 900, 1500, 2300, 3300]
  const activeSeries = [400, 900, 1500, 950, 1500, 1050, 1500, 1900]
  // v2: coarse removal bends the trajectory down AT the boundary (850 < 900).
  const activeV2Series = [400, 900, 850, 1500, 1400]
  // v3: dedup drops at seq 3 (850 < 900) and the resumed (post-verify-window)
  // sweep drops at seq 5 (1300 < 1400).
  const activeV3Series = [400, 900, 850, 1400, 1300]
  const removedHash = 'feed0000feed0001'
  const removedHashV2PathA = 'feed0000feed0003'
  const removedHashV2PathB = 'feed0000feed0004'
  const freshHashV2 = 'feed0000feed0005'
  const dedupHashV3PathA = 'feed0000feed0006'
  const sweepHashV3PathB = 'feed0000feed0007'
  const records: MxLegRecord[] = []
  for (const plan of mxLegOrder(shape)) {
    const standInOracle = (kind: S1OracleResult['kind'], command: string): S1OracleResult => ({
      kind,
      command,
      exitCode: null,
      pass: null,
      standIn: true
    })
    const oracleResults = [
      standInOracle('PRIMARY', 'node --test (scripted stand-in)'),
      standInOracle('REGRESSION', 'node --test (scripted stand-in)'),
      standInOracle('WRITABLE_CONFORMANCE', 'changed paths <= expectedWritablePaths')
    ]
    const common = {
      runId,
      mode: 'DRY_RUN' as const,
      legIndex: plan.legIndex,
      task: plan.task,
      strategy: plan.strategy,
      rep: plan.rep,
      oracleResults,
      replayMismatches: 0,
      stopCondition: null,
      fixtureDirRemoved: true,
      status: 'COMPLETED' as const
    }
    if (plan.strategy === 'NATIVE') {
      records.push({
        ...common,
        recordCount: nativeSeries.length,
        toolCallCount: 7,
        observedTokenEstimateSum: nativeSeries.reduce((a, b) => a + b, 0),
        wallClockMs: 0,
        trajectory: trajectorySummaryOf(nativeSeries)
      })
    } else if (plan.strategy === 'ACTIVE') {
      const events: ActiveRewriteEventEvidence[] = [
        scriptedEvent(1, activeSeries[0]!, {
          readTargets: [{ toolCallId: 'scripted-read-1', readTargetHash: removedHash }]
        }),
        scriptedEvent(2, activeSeries[1]!),
        scriptedEvent(3, activeSeries[2]!, {
          boundaryReached: true,
          interventionAttempted: true,
          interventionIndex: 1,
          compositionVerdict: 'REWRITE_READY',
          guardVerdict: 'PASS',
          sentRewrite: true,
          toolBlocksRemoved: 1,
          interventionPath: 'src/scripted-target.ts',
          composedMessageCount: 4,
          removedReadTargetHashes: [removedHash],
          policy: 'v1-per-edit',
          trigger: 'edit',
          candidateBlocks: 1,
          removedBlocks: 1,
          retainedLatestReadTargets: []
        }),
        scriptedEvent(4, activeSeries[3]!),
        scriptedEvent(5, activeSeries[4]!, {
          boundaryReached: true,
          interventionAttempted: true,
          interventionIndex: 2,
          compositionVerdict: 'REWRITE_READY',
          guardVerdict: 'PASS',
          sentRewrite: true,
          toolBlocksRemoved: 1,
          interventionPath: 'src/scripted-target-2.ts',
          composedMessageCount: 4,
          removedReadTargetHashes: ['feed0000feed0002'],
          policy: 'v1-per-edit',
          trigger: 'edit',
          candidateBlocks: 1,
          removedBlocks: 1,
          retainedLatestReadTargets: []
        }),
        // A scripted RE-READ of the target removed at intervention 1.
        scriptedEvent(6, activeSeries[5]!, {
          readTargets: [{ toolCallId: 'scripted-read-2', readTargetHash: removedHash }]
        }),
        scriptedEvent(7, activeSeries[6]!),
        scriptedEvent(8, activeSeries[7]!)
      ]
      const interventions = scriptedInterventionsOf([
        { sequence: 3, hash: removedHash, path: 'src/scripted-target.ts' },
        { sequence: 5, hash: 'feed0000feed0002', path: 'src/scripted-target-2.ts' }
      ])
      records.push({
        ...common,
        recordCount: activeSeries.length,
        toolCallCount: 9,
        observedTokenEstimateSum: activeSeries.reduce((a, b) => a + b, 0),
        wallClockMs: 0,
        trajectory: trajectorySummaryOf(activeSeries),
        interventionTelemetry: {
          events,
          interventions,
          attemptsUsed: interventions.length,
          sendsUsed: interventions.length,
          killSwitchTripped: false
        }
      })
    } else if (plan.strategy === 'ACTIVE_V2') {
      // ACTIVE_V2: one coarse sweep over two edited paths (A read 3x, B read
      // 2x): 3 candidate older reads removed in ONE intervention, the latest
      // read of each swept path retained.
      const v2Events: ActiveRewriteEventEvidence[] = [
        scriptedEvent(1, activeV2Series[0]!, {
          readTargets: [
            { toolCallId: 'scripted-v2-a1', readTargetHash: removedHashV2PathA },
            { toolCallId: 'scripted-v2-a2', readTargetHash: removedHashV2PathA },
            { toolCallId: 'scripted-v2-a3', readTargetHash: removedHashV2PathA }
          ]
        }),
        scriptedEvent(2, activeV2Series[1]!, {
          readTargets: [
            { toolCallId: 'scripted-v2-b1', readTargetHash: removedHashV2PathB },
            { toolCallId: 'scripted-v2-b2', readTargetHash: removedHashV2PathB }
          ]
        }),
        scriptedEvent(3, activeV2Series[2]!, {
          boundaryReached: true,
          interventionAttempted: true,
          interventionIndex: 1,
          compositionVerdict: 'REWRITE_READY',
          guardVerdict: 'PASS',
          sentRewrite: true,
          toolBlocksRemoved: 3,
          interventionPath: 'src/scripted-coarse-a.ts',
          composedMessageCount: 5,
          removedReadTargetHashes: [
            removedHashV2PathA,
            removedHashV2PathA,
            removedHashV2PathB
          ],
          policy: 'v2-retain-latest-coarse',
          trigger: 'edit',
          candidateBlocks: 3,
          removedBlocks: 3,
          retainedLatestReadTargets: [removedHashV2PathA, removedHashV2PathB]
        }),
        // A post-intervention read of a FRESH target — not a re-read (the
        // latest reads of the swept paths stay in context under v2).
        scriptedEvent(4, activeV2Series[3]!, {
          readTargets: [{ toolCallId: 'scripted-v2-c1', readTargetHash: freshHashV2 }]
        }),
        scriptedEvent(5, activeV2Series[4]!)
      ]
      const v2Interventions: ActiveRewriteInterventionSummary[] = [
        {
          boundarySequence: 3,
          interventionPath: 'src/scripted-coarse-a.ts',
          interventionIndex: 1,
          attemptOutcome: 'SENT' as const,
          compositionVerdict: 'REWRITE_READY' as const,
          guardVerdict: 'PASS' as const,
          sentRewrite: true,
          killSwitchTripped: false,
          toolBlocksRemoved: 3,
          removedSourceKeys: [
            'run/tool-call://scripted-v2-a1',
            'run/tool-result://scripted-v2-a1',
            'run/tool-call://scripted-v2-a2',
            'run/tool-result://scripted-v2-a2',
            'run/tool-call://scripted-v2-b1',
            'run/tool-result://scripted-v2-b1'
          ],
          composedMessageCount: 5,
          latchSetAtSequence: 3,
          removedReadTargetHashes: [removedHashV2PathA, removedHashV2PathA, removedHashV2PathB],
          policy: 'v2-retain-latest-coarse',
          trigger: 'edit',
          candidateBlocks: 3,
          removedBlocks: 3,
          retainedLatestReadTargets: [removedHashV2PathA, removedHashV2PathB]
        }
      ]
      records.push({
        ...common,
        recordCount: activeV2Series.length,
        toolCallCount: 8,
        observedTokenEstimateSum: activeV2Series.reduce((a, b) => a + b, 0),
        wallClockMs: 0,
        trajectory: trajectorySummaryOf(activeV2Series),
        interventionTelemetry: {
          events: v2Events,
          interventions: v2Interventions,
          attemptsUsed: v2Interventions.length,
          sendsUsed: v2Interventions.length,
          killSwitchTripped: false
        }
      })
    } else {
      // ACTIVE_V3: the L2 verification pattern. Path A is read twice with
      // IDENTICAL content and NO edit boundary in flight -> a DEDUP
      // intervention removes the older duplicate. Then an edit of path B
      // arrives while the last two tool events are bash (a verification
      // sequence) -> the edit sweep is DEFERRED (deferredByVerifyWindow
      // event telemetry, deferredSweeps=1) until a read closes the window,
      // where the resumed retain-latest sweep removes B's older read.
      const v3Events: ActiveRewriteEventEvidence[] = [
        scriptedEvent(1, activeV3Series[0]!, {
          readTargets: [
            { toolCallId: 'scripted-v3-a1', readTargetHash: dedupHashV3PathA },
            { toolCallId: 'scripted-v3-a2', readTargetHash: dedupHashV3PathA }
          ]
        }),
        scriptedEvent(2, activeV3Series[1]!, {
          readTargets: [{ toolCallId: 'scripted-v3-b1', readTargetHash: sweepHashV3PathB }]
        }),
        scriptedEvent(3, activeV3Series[2]!, {
          boundaryReached: true,
          interventionAttempted: true,
          interventionIndex: 1,
          compositionVerdict: 'REWRITE_READY',
          guardVerdict: 'PASS',
          sentRewrite: true,
          toolBlocksRemoved: 1,
          interventionPath: 'src/scripted-verify-a.ts',
          composedMessageCount: 4,
          removedReadTargetHashes: [dedupHashV3PathA],
          policy: 'v3-verify-window-dedup',
          trigger: 'dedup',
          candidateBlocks: 1,
          removedBlocks: 1,
          retainedLatestReadTargets: [dedupHashV3PathA]
        }),
        // The edit boundary is observed here, but the model is mid-verification
        // (two bash-class tool events): the sweep DEFERS — nothing removed.
        scriptedEvent(4, activeV3Series[3]!, {
          deferredByVerifyWindow: true
        }),
        // The window closes (a read follows the bash runs): the deferred sweep
        // RESUMES and removes path B's older read (retain-latest).
        scriptedEvent(5, activeV3Series[4]!, {
          boundaryReached: true,
          interventionAttempted: true,
          interventionIndex: 2,
          compositionVerdict: 'REWRITE_READY',
          guardVerdict: 'PASS',
          sentRewrite: true,
          toolBlocksRemoved: 1,
          interventionPath: 'src/scripted-verify-b.ts',
          composedMessageCount: 4,
          removedReadTargetHashes: [sweepHashV3PathB],
          policy: 'v3-verify-window-dedup',
          trigger: 'edit',
          candidateBlocks: 1,
          removedBlocks: 1,
          retainedLatestReadTargets: [sweepHashV3PathB]
        })
      ]
      const v3Interventions: ActiveRewriteInterventionSummary[] = [
        {
          boundarySequence: 3,
          interventionPath: 'src/scripted-verify-a.ts',
          interventionIndex: 1,
          attemptOutcome: 'SENT' as const,
          compositionVerdict: 'REWRITE_READY' as const,
          guardVerdict: 'PASS' as const,
          sentRewrite: true,
          killSwitchTripped: false,
          toolBlocksRemoved: 1,
          removedSourceKeys: [
            'run/tool-call://scripted-v3-a1',
            'run/tool-result://scripted-v3-a1'
          ],
          composedMessageCount: 4,
          latchSetAtSequence: 3,
          removedReadTargetHashes: [dedupHashV3PathA],
          policy: 'v3-verify-window-dedup',
          trigger: 'dedup',
          candidateBlocks: 1,
          removedBlocks: 1,
          retainedLatestReadTargets: [dedupHashV3PathA]
        },
        {
          boundarySequence: 5,
          interventionPath: 'src/scripted-verify-b.ts',
          interventionIndex: 2,
          attemptOutcome: 'SENT' as const,
          compositionVerdict: 'REWRITE_READY' as const,
          guardVerdict: 'PASS' as const,
          sentRewrite: true,
          killSwitchTripped: false,
          toolBlocksRemoved: 1,
          removedSourceKeys: [
            'run/tool-call://scripted-v3-b1',
            'run/tool-result://scripted-v3-b1'
          ],
          composedMessageCount: 4,
          latchSetAtSequence: 5,
          removedReadTargetHashes: [sweepHashV3PathB],
          policy: 'v3-verify-window-dedup',
          trigger: 'edit',
          candidateBlocks: 1,
          removedBlocks: 1,
          retainedLatestReadTargets: [sweepHashV3PathB]
        }
      ]
      records.push({
        ...common,
        recordCount: activeV3Series.length,
        toolCallCount: 8,
        observedTokenEstimateSum: activeV3Series.reduce((a, b) => a + b, 0),
        wallClockMs: 0,
        trajectory: trajectorySummaryOf(activeV3Series),
        interventionTelemetry: {
          events: v3Events,
          interventions: v3Interventions,
          attemptsUsed: v3Interventions.length,
          sendsUsed: v3Interventions.length,
          killSwitchTripped: false
        }
      })
    }
  }
  return records
}

/** Observations for a scripted DRY_RUN leg, derived from its trajectory. */
export function scriptedMxObservations(record: MxLegRecord): readonly ModelCallObservation[] {
  const runtimeSessionId = `${record.runId}:${mxLegDirName({
    legIndex: record.legIndex,
    task: record.task,
    strategy: record.strategy,
    rep: record.rep
  })}`
  return record.trajectory.series.map((observedMessageTokenEstimate, index) => ({
    runtimeSessionId,
    sequence: index + 1,
    observedAt: '1970-01-01T00:00:00.000Z',
    harness: 'PI',
    estimateScope: ESTIMATE_SCOPE_AGENT_MESSAGES,
    messageCount: index + 1,
    observedMessageTokenEstimate,
    observedMessageCharEstimate: observedMessageTokenEstimate * 4,
    categoryCounts: { USER: 1, ASSISTANT: index, TOOL_RESULT: 0, OTHER: 0 },
    toolResultCount: 0,
    messageDescriptors: []
  }))
}
