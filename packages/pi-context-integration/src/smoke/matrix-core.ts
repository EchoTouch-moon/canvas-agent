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

// CR-004 Stage 1 MATRIX core (docs/plan/cr004-matrix-run-contract-2026-08-27.md).
//
// Everything the matrix runner, its offline analyzer, and its unit tests share:
//   - the run-identity vocabulary (cr004-m1-<ISO-date>-<8-hex>, single-use);
//   - the matrix definition (3 L-tasks x NATIVE/ACTIVE x 3 repetitions = 18
//     legs, deterministic interleaved order: rep-major, per task Native then
//     Active) and the matrix totals (400 provider-call records / 180 minutes);
//   - the matrix state machine: leg-level failures mark ONE leg FAILED and the
//     matrix CONTINUES; only matrix-level S-1 (binding) or S-7 (totals) stop
//     everything, checked between legs, evidence always preserved;
//   - incremental evidence writers (leg.json + observations.jsonl per leg,
//     manifest.json + matrix.json rewritten after EVERY leg — never buffered
//     to the end);
//   - the offline aggregator/analyzer (per-cell stats, context trajectories
//     from observations, ACTIVE-only intervention telemetry incl. re-read
//     detection, exact permutation p-values with an explicit low-power
//     caveat);
//   - the DRY_RUN scripted legs (18 stand-in records through the FULL state
//     machine + aggregator; provider calls exactly 0).
//
// No provider, no network, no ModelRuntime in this module.

// ---------------------------------------------------------------------------
// Run identity (contract section 2)
// ---------------------------------------------------------------------------

/** cr004-m1-<ISO-date-undashed>-<8-hex>, e.g. cr004-m1-20260827-4d7e9a1b */
export const MX_RUN_ID_PATTERN = /^cr004-m1-\d{8}-[0-9a-f]{8}$/

export function isValidMxRunId(runId: string | undefined): runId is string {
  return runId !== undefined && MX_RUN_ID_PATTERN.test(runId)
}

/** Fresh single-use run identity suggestion; the Lead must export it. */
export function suggestMxRunId(now: Date = new Date()): string {
  const isoDate = now.toISOString().slice(0, 10).replace(/-/g, '')
  return `cr004-m1-${isoDate}-${randomBytes(4).toString('hex')}`
}

// ---------------------------------------------------------------------------
// Matrix definition (contract section 5)
// ---------------------------------------------------------------------------

export const MX_TASK_IDS = ['L1', 'L2', 'L3'] as const
export type MxTaskId = (typeof MX_TASK_IDS)[number]

export const MX_STRATEGIES = ['NATIVE', 'ACTIVE'] as const
export type MxStrategy = (typeof MX_STRATEGIES)[number]

export const MX_REPETITIONS = 3
export const MX_TOTAL_LEGS = MX_TASK_IDS.length * MX_STRATEGIES.length * MX_REPETITIONS

export interface MxLegPlan {
  /** 0-based position in the deterministic leg order. */
  readonly legIndex: number
  readonly task: MxTaskId
  readonly strategy: MxStrategy
  /** 1-based repetition number. */
  readonly rep: number
}

/**
 * Deterministic interleaved leg order: for rep 1..3 { for task L1..L3 {
 * NATIVE then ACTIVE } } — 18 legs. Control always precedes treatment within
 * every task x repetition cell.
 */
export function mxLegOrder(): readonly MxLegPlan[] {
  const plans: MxLegPlan[] = []
  let legIndex = 0
  for (let rep = 1; rep <= MX_REPETITIONS; rep += 1) {
    for (const task of MX_TASK_IDS) {
      for (const strategy of MX_STRATEGIES) {
        plans.push({ legIndex, task, strategy, rep })
        legIndex += 1
      }
    }
  }
  return plans
}

export function mxLegDirName(plan: MxLegPlan): string {
  return `${plan.task}-${plan.strategy}-rep${plan.rep}`
}

// ---------------------------------------------------------------------------
// Budgets and stop conditions (contract sections 9-10)
// ---------------------------------------------------------------------------

export const MX_BUDGETS = {
  /** 3 tasks x 2 strategies x 3 repetitions. */
  maxLegs: MX_TOTAL_LEGS,
  /** Matrix total across all 18 legs (C0 counting semantics). */
  maxProviderCallRecords: 400,
  /** Matrix watchdog, measured from strict preparation to evidence-close. */
  runWallClockMs: 180 * 60 * 1000,
  /** Multi-intervention bound per ACTIVE leg (sends). */
  maxInterventionsPerLeg: 5,
  /** Multi-intervention bound per ACTIVE leg (composition attempts). */
  maxAttemptsPerLeg: 8
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
  readonly runElapsedMs: number
}

/**
 * Matrix state machine. Leg-level failures NEVER stop the matrix; only the
 * matrix-level totals (S-7: 400 provider-call records / 180 minutes, checked
 * between legs) or a strict binding failure (S-1) are terminal. Deterministic
 * under an injected clock; no I/O.
 */
export class MatrixStateMachine {
  private readonly ledgersByLeg: MxLegLedger[] = []
  private readonly firedStops: MxMatrixStop[] = []
  private matrixTerminal = false
  private readonly startedAtMs: number
  private readonly now: () => number
  private readonly nowIso: () => string

  constructor(options: { readonly now?: () => number; readonly nowIso?: () => string } = {}) {
    this.now = options.now ?? Date.now
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.startedAtMs = this.now()
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
    for (const leg of this.ledgersByLeg) {
      providerCallRecordsTotal += leg.providerCallRecords
      toolCallsTotal += leg.toolCalls
      wallClockMsTotal += leg.wallClockMs
      if (leg.status === 'COMPLETED') legsCompleted += 1
      if (leg.status === 'FAILED') legsFailed += 1
      if (leg.oraclePass === true) {
        if (leg.strategy === 'NATIVE') oraclePassNative += 1
        else oraclePassActive += 1
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
    if (this.ledgersByLeg.length >= MX_BUDGETS.maxLegs) {
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
 * Resolve the three L-task manifests from a manifest directory. Each task id
 * must match exactly one `<task>-*.json` file; a missing or ambiguous match
 * refuses with a clear error. Fixtures are existence-checked only when
 * `requireFixtures` (LIVE mode; DRY_RUN never touches fixtures).
 */
export async function resolveMxTasks(options: {
  readonly manifestDir: string
  /** Root the manifest fixturePath is relative to (the benchmark root). */
  readonly benchmarkRoot: string
  readonly requireFixtures: boolean
}): Promise<readonly MxTaskDefinition[]> {
  const entries = await readdir(options.manifestDir, { withFileTypes: true })
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
  const tasks: MxTaskDefinition[] = []
  for (const taskId of MX_TASK_IDS) {
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
    readonly meanSum: number | null
    readonly legs: readonly { readonly peak: number; readonly final: number; readonly sum: number }[]
  }
  readonly active?: {
    readonly attempts: number
    readonly sends: number
    readonly fallbackReasons: Readonly<Record<string, number>>
    readonly toolBlocksRemoved: number
    readonly reReads: number
    readonly postFirstInterventionReads: number
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
            reReads: reReads.matches.length,
            postFirstInterventionReads: reReads.postFirstInterventionReadCount
          }
        }
      : {})
  }
}

export function aggregateMxCells(inputs: readonly MxLegAnalysisInput[]): readonly MxCellAggregate[] {
  const cells: MxCellAggregate[] = []
  for (const task of MX_TASK_IDS) {
    for (const strategy of MX_STRATEGIES) {
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
      let reReads = 0
      let postFirstInterventionReads = 0
      let hasActive = false
      for (const leg of legs) {
        if (leg.interventions === undefined) continue
        hasActive = true
        attempts += leg.interventions.attempts
        sends += leg.interventions.sends
        toolBlocksRemoved += leg.interventions.toolBlocksRemoved
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
                attempts,
                sends,
                fallbackReasons,
                toolBlocksRemoved,
                reReads,
                postFirstInterventionReads
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
  'n=3 per cell: descriptive statistics and exact enumeration of all C(6,3)=20 label assignments only; low statistical power; no causal claim'

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

/** Per-task permutation tests over observedTokenEstimateSum. */
export function mxPermutationTests(
  cells: readonly MxCellAggregate[]
): readonly { readonly task: MxTaskId; readonly permutation: MxPermutationTest }[] {
  const tests: { task: MxTaskId; permutation: MxPermutationTest }[] = []
  for (const task of MX_TASK_IDS) {
    const native = cells.find((cell) => cell.task === task && cell.strategy === 'NATIVE')
    const active = cells.find((cell) => cell.task === task && cell.strategy === 'ACTIVE')
    if (native === undefined || active === undefined) continue
    const permutation = exactPermutationTest(
      native.tokenEstimateSum.values,
      active.tokenEstimateSum.values
    )
    if (permutation !== null) tests.push({ task, permutation })
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
  const nativeCells = cells.filter((cell) => cell.strategy === 'NATIVE')
  const activeCells = cells.filter((cell) => cell.strategy === 'ACTIVE')
  const nativePass = nativeCells.reduce((total, cell) => total + cell.oracle.pass, 0)
  const nativeEvaluated = nativeCells.reduce(
    (total, cell) => total + cell.oracle.pass + cell.oracle.fail,
    0
  )
  const activePass = activeCells.reduce((total, cell) => total + cell.oracle.pass, 0)
  const activeEvaluated = activeCells.reduce(
    (total, cell) => total + cell.oracle.pass + cell.oracle.fail,
    0
  )
  const identical =
    nativePass === activePass && nativeEvaluated === activeEvaluated
  const reliability = identical
    ? `reliability identical (raw): NATIVE oracle ${nativePass}/${nativeEvaluated} vs ACTIVE ${activePass}/${activeEvaluated}`
    : `reliability differentiated (raw): NATIVE oracle ${nativePass}/${nativeEvaluated} vs ACTIVE ${activePass}/${activeEvaluated}`
  const nativeMean = meanOf(
    nativeCells.map((cell) => cell.tokenEstimateSum.mean ?? Number.NaN).filter((value) => !Number.isNaN(value))
  )
  const activeMean = meanOf(
    activeCells.map((cell) => cell.tokenEstimateSum.mean ?? Number.NaN).filter((value) => !Number.isNaN(value))
  )
  const contextEfficiency =
    nativeMean === null || activeMean === null
      ? 'context-efficiency: insufficient data (no completed cells on one side)'
      : `context-efficiency direction (raw, observedTokenEstimateSum mean-of-cell-means): NATIVE ${nativeMean.toFixed(0)} vs ACTIVE ${activeMean.toFixed(0)} (${activeMean < nativeMean ? 'ACTIVE lower' : activeMean > nativeMean ? 'ACTIVE higher' : 'equal'})`
  return { reliability, contextEfficiency }
}

/** One-line per-cell summary for stdout. */
export function mxCellOneLiner(cell: MxCellAggregate): string {
  const oracle =
    cell.oracle.passRate === null
      ? `oracle=${cell.oracle.pass}/${cell.oracle.pass + cell.oracle.fail}`
      : `oracle=${cell.oracle.pass}/${cell.oracle.pass + cell.oracle.fail} (${(cell.oracle.passRate * 100).toFixed(0)}%)`
  const tokens = cell.tokenEstimateSum.mean === null ? 'n/a' : cell.tokenEstimateSum.mean.toFixed(0)
  const base = `cell ${cell.task}/${cell.strategy} n=${cell.n} (completed=${cell.completed} failed=${cell.failed}) ${oracle} records~${cell.recordCount.mean?.toFixed(1) ?? 'n/a'} tools~${cell.toolCalls.mean?.toFixed(1) ?? 'n/a'} tokenSum~${tokens} trajPeak~${cell.trajectory.meanPeak?.toFixed(0) ?? 'n/a'}`
  if (cell.active === undefined) return base
  const fallbacks = Object.entries(cell.active.fallbackReasons)
    .map(([reason, count]) => `${reason}x${count}`)
    .join(',')
  return `${base} interventions=${cell.active.sends}/${cell.active.attempts}${fallbacks === '' ? '' : ` fallbacks=[${fallbacks}]`} removedBlocks=${cell.active.toolBlocksRemoved} reReads=${cell.active.reReads} postFirstReads=${cell.active.postFirstInterventionReads}`
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
    readonly perTask: readonly { readonly task: MxTaskId; readonly permutation: MxPermutationTest }[]
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
  lines.push('| Cell | n | oracle | records (mean/median) | tools | wall ms (mean/median) | tokenSum mean | trajectory peak mean / sum mean |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const cell of cells) {
    lines.push(
      `| ${cell.task}/${cell.strategy} | ${cell.n} | ${cell.oracle.pass}/${cell.oracle.pass + cell.oracle.fail} | ${cell.recordCount.mean?.toFixed(1) ?? '-'}/${cell.recordCount.median ?? '-'} | ${cell.toolCalls.mean?.toFixed(1) ?? '-'} | ${cell.wallClockMs.mean?.toFixed(0) ?? '-'}/${cell.wallClockMs.median ?? '-'} | ${cell.tokenEstimateSum.mean?.toFixed(0) ?? '-'} | ${cell.trajectory.meanPeak?.toFixed(0) ?? '-'} / ${cell.trajectory.meanSum?.toFixed(0) ?? '-'} |`
    )
  }
  lines.push('')
  lines.push('Per-leg context trajectories (observedMessageTokenEstimate per model call; NATIVE expected monotonic, ACTIVE should show drops at interventions):')
  for (const cell of cells) {
    lines.push(`- ${cell.task}/${cell.strategy}: ${cell.trajectory.legs.map((leg) => `peak=${leg.peak},final=${leg.final},sum=${leg.sum}`).join(' | ')}`)
  }
  lines.push('')
  lines.push('## ACTIVE intervention telemetry')
  lines.push('')
  for (const cell of cells.filter((candidate) => candidate.active !== undefined)) {
    const active = cell.active!
    lines.push(
      `- ${cell.task}/ACTIVE: sends=${active.sends}/${active.attempts} attempts, removedBlocks=${active.toolBlocksRemoved}, reReadsOfRemovedTargets=${active.reReads}, postFirstInterventionReads=${active.postFirstInterventionReads}${Object.keys(active.fallbackReasons).length === 0 ? '' : `, fallbacks=${JSON.stringify(active.fallbackReasons)}`}`
    )
  }
  lines.push('')
  lines.push('## Per-task exact permutation tests (observedTokenEstimateSum)')
  lines.push('')
  if (perTask.length === 0) {
    lines.push('(insufficient legs on one side)')
  }
  for (const { task, permutation } of perTask) {
    lines.push(
      `- ${task}: NATIVE sum=${permutation.nativeSum} vs ACTIVE sum=${permutation.activeSum}; observed diff=${permutation.observedDifference}; p=${permutation.pValue.toFixed(3)} (${permutation.asExtreme}/${permutation.assignments} assignments). ${permutation.caveat}.`
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
    removedReadTargetHashes: [sent.hash]
  }))
}

/**
 * Scripted stand-in legs for DRY_RUN: 18 records in the deterministic matrix
 * order, driven through the FULL matrix state machine, incremental evidence
 * writers, and aggregator by the runner. NATIVE trajectories are monotonic;
 * ACTIVE trajectories drop after each scripted intervention; one scripted
 * re-read of a removed target appears in every ACTIVE leg so the analyzer's
 * re-read detection is exercised. Provider calls: 0.
 */
export function scriptedMxLegRecords(runId: string): readonly MxLegRecord[] {
  const nativeSeries = [400, 900, 1500, 2300, 3300]
  const activeSeries = [400, 900, 1500, 950, 1500, 1050, 1500, 1900]
  const removedHash = 'feed0000feed0001'
  const records: MxLegRecord[] = []
  for (const plan of mxLegOrder()) {
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
    } else {
      const interventionSequences = [3, 5]
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
          removedReadTargetHashes: [removedHash]
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
          removedReadTargetHashes: ['feed0000feed0002']
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
