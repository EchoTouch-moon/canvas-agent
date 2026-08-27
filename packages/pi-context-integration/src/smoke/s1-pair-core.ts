import { randomBytes } from 'node:crypto'
import type { ActiveRewriteInterventionSummary } from '../extension/active-rewrite-extension'

// CR-004 Stage 1 pair core (docs/plan/cr004-stage1-run-contract-2026-08-27.md).
//
// Everything the Stage 1 runner and its unit tests share:
//   - the run-identity vocabulary (cr004-s1-<ISO-date>-<8-hex>, single-use);
//   - the budget ledgers (contract section 9: 2 legs / 30 provider-call
//     records total / 15 per leg / C1 manifest tool+wall budgets / 30 min run);
//   - the fail-closed stop-condition state machine S-1..S-9 (contract
//     section 10): every condition terminal-in-scope and recorded, with
//     RUN scope vs ACTIVE-MODE scope (S-5 fallback and S-8 operator kill
//     switch end Active mode only — the run continues to evidence-close as
//     Native-completed);
//   - the leg-record / pairing evidence shapes (pairs.json, manifest.json);
//   - the frozen C1 task manifest loader (read-only).
//
// No provider, no network, no ModelRuntime in this module: the credential-free
// DRY_RUN mode and the unit tests exercise the whole state machine offline.

// ---------------------------------------------------------------------------
// Run identity (contract section 2)
// ---------------------------------------------------------------------------

/** cr004-s1-<ISO-date-undashed>-<8-hex>, e.g. cr004-s1-20260827-4d7e9a1b */
export const S1_RUN_ID_PATTERN = /^cr004-s1-\d{8}-[0-9a-f]{8}$/

export function isValidS1RunId(runId: string | undefined): runId is string {
  return runId !== undefined && S1_RUN_ID_PATTERN.test(runId)
}

/** Fresh single-use run identity suggestion; the Lead must export it. */
export function suggestS1RunId(now: Date = new Date()): string {
  const isoDate = now.toISOString().slice(0, 10).replace(/-/g, '')
  return `cr004-s1-${isoDate}-${randomBytes(4).toString('hex')}`
}

// ---------------------------------------------------------------------------
// Budgets and stop conditions (contract sections 9-10)
// ---------------------------------------------------------------------------

export const S1_BUDGETS = {
  /** Exactly leg A (Native) + leg B (Active); no repeats, no second pair. */
  maxLegs: 2,
  /** Total provider-call records across both legs (C0 counting semantics). */
  maxProviderCallRecords: 30,
  /** Per-leg gate: the Active leg may not begin if Native exceeded this. */
  maxProviderCallRecordsPerLeg: 15,
  /** C1 manifest maxToolCalls (task budget, per leg). */
  maxToolCallsPerLeg: 40,
  /** C1 manifest wallClockMs (task budget, per leg). */
  legWallClockMs: 120000,
  /** Contract section 9: measured from strict preparation to evidence-close. */
  runWallClockMs: 30 * 60 * 1000
} as const

export type S1LegStrategy = 'NATIVE' | 'ACTIVE'
export type S1StopConditionId =
  | 'S-1'
  | 'S-2'
  | 'S-3'
  | 'S-4'
  | 'S-5'
  | 'S-6'
  | 'S-7'
  | 'S-8'
  | 'S-9'

/** Contract section 10 scopes. Only S-5 and S-8 are non-RUN-terminal. */
export type S1StopScope = 'RUN' | 'ACTIVE_MODE'

export interface S1FiredStop {
  readonly condition: S1StopConditionId
  readonly scope: S1StopScope
  readonly reason: string
  readonly atIso: string
}

export interface S1Ledgers {
  readonly legsCompleted: number
  readonly providerCallRecordsTotal: number
  readonly nativeProviderCallRecords: number
  readonly activeProviderCallRecords: number
  readonly nativeToolCalls: number
  readonly activeToolCalls: number
  readonly nativeWallClockMs: number
  readonly activeWallClockMs: number
  readonly runElapsedMs: number
}

/** Ledger-driven budget checks (S-7). Event-driven stops live in the machine. */
export function evaluateS1BudgetStops(
  ledgers: S1Ledgers
): { readonly stop: false } | { readonly stop: true; readonly reason: string } {
  if (ledgers.nativeProviderCallRecords > S1_BUDGETS.maxProviderCallRecordsPerLeg) {
    return {
      stop: true,
      reason: `Native leg exceeded the per-leg provider-call gate: ${ledgers.nativeProviderCallRecords} > ${S1_BUDGETS.maxProviderCallRecordsPerLeg}`
    }
  }
  if (ledgers.activeProviderCallRecords > S1_BUDGETS.maxProviderCallRecordsPerLeg) {
    return {
      stop: true,
      reason: `Active leg exceeded the per-leg provider-call gate: ${ledgers.activeProviderCallRecords} > ${S1_BUDGETS.maxProviderCallRecordsPerLeg}`
    }
  }
  if (ledgers.providerCallRecordsTotal > S1_BUDGETS.maxProviderCallRecords) {
    return {
      stop: true,
      reason: `provider-call budget breached: ${ledgers.providerCallRecordsTotal} > ${S1_BUDGETS.maxProviderCallRecords}`
    }
  }
  if (ledgers.nativeToolCalls > S1_BUDGETS.maxToolCallsPerLeg) {
    return {
      stop: true,
      reason: `Native leg tool-call budget breached: ${ledgers.nativeToolCalls} > ${S1_BUDGETS.maxToolCallsPerLeg}`
    }
  }
  if (ledgers.activeToolCalls > S1_BUDGETS.maxToolCallsPerLeg) {
    return {
      stop: true,
      reason: `Active leg tool-call budget breached: ${ledgers.activeToolCalls} > ${S1_BUDGETS.maxToolCallsPerLeg}`
    }
  }
  if (ledgers.nativeWallClockMs > S1_BUDGETS.legWallClockMs) {
    return {
      stop: true,
      reason: `Native leg wall-clock budget breached: ${ledgers.nativeWallClockMs}ms > ${S1_BUDGETS.legWallClockMs}ms`
    }
  }
  if (ledgers.activeWallClockMs > S1_BUDGETS.legWallClockMs) {
    return {
      stop: true,
      reason: `Active leg wall-clock budget breached: ${ledgers.activeWallClockMs}ms > ${S1_BUDGETS.legWallClockMs}ms`
    }
  }
  if (ledgers.legsCompleted > S1_BUDGETS.maxLegs) {
    return {
      stop: true,
      reason: `leg budget breached: ${ledgers.legsCompleted} > ${S1_BUDGETS.maxLegs}`
    }
  }
  if (ledgers.runElapsedMs > S1_BUDGETS.runWallClockMs) {
    return {
      stop: true,
      reason: `run wall-clock budget breached: ${ledgers.runElapsedMs}ms > ${S1_BUDGETS.runWallClockMs}ms`
    }
  }
  return { stop: false }
}

export type S1BeginLegResult =
  | { readonly ok: true; readonly leg: S1LegStrategy }
  | { readonly ok: false; readonly stop: S1FiredStop }

export interface S1EndLegInput {
  readonly leg: S1LegStrategy
  readonly providerCallRecords: number
  readonly toolCalls: number
  readonly wallClockMs: number
}

/**
 * Pair state machine: Native->Active order enforced, budgets fail closed via
 * S-7, S-5/S-8 end Active mode without ending the run, everything else is
 * RUN-terminal. Deterministic under an injected clock; no I/O.
 */
export class S1PairStateMachine {
  private legsCompleted = 0
  private nativeCompleted = false
  private activeCompleted = false
  private providerCallsByLeg: Record<S1LegStrategy, number> = { NATIVE: 0, ACTIVE: 0 }
  private toolCallsByLeg: Record<S1LegStrategy, number> = { NATIVE: 0, ACTIVE: 0 }
  private wallClockByLeg: Record<S1LegStrategy, number> = { NATIVE: 0, ACTIVE: 0 }
  private readonly firedStops: S1FiredStop[] = []
  private runTerminal = false
  private readonly startedAtMs: number
  private readonly now: () => number
  private readonly nowIso: () => string

  constructor(options: { readonly now?: () => number; readonly nowIso?: () => string } = {}) {
    this.now = options.now ?? Date.now
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.startedAtMs = this.now()
  }

  get isTerminal(): boolean {
    return this.runTerminal
  }

  get stopsFired(): readonly S1FiredStop[] {
    return [...this.firedStops]
  }

  get legsDone(): number {
    return this.legsCompleted
  }

  ledgers(): S1Ledgers {
    return {
      legsCompleted: this.legsCompleted,
      providerCallRecordsTotal: this.providerCallsByLeg.NATIVE + this.providerCallsByLeg.ACTIVE,
      nativeProviderCallRecords: this.providerCallsByLeg.NATIVE,
      activeProviderCallRecords: this.providerCallsByLeg.ACTIVE,
      nativeToolCalls: this.toolCallsByLeg.NATIVE,
      activeToolCalls: this.toolCallsByLeg.ACTIVE,
      nativeWallClockMs: this.wallClockByLeg.NATIVE,
      activeWallClockMs: this.wallClockByLeg.ACTIVE,
      runElapsedMs: this.now() - this.startedAtMs
    }
  }

  private fire(condition: S1StopConditionId, scope: S1StopScope, reason: string): S1FiredStop {
    if (scope === 'RUN') this.runTerminal = true
    const stop: S1FiredStop = { condition, scope, reason, atIso: this.nowIso() }
    const duplicate = this.firedStops.some(
      (fired) => fired.condition === condition && fired.reason === reason
    )
    if (!duplicate) this.firedStops.push(stop)
    return stop
  }

  /** Fire a RUN-scope terminal stop (S-1..S-4, S-6, S-9; S-7 via budgets). */
  fireRunStop(condition: S1StopConditionId, reason: string): S1FiredStop {
    return this.fire(condition, 'RUN', reason)
  }

  /**
   * S-5: pre-send guard/composer FALLBACK_NATIVE after opt-in during the
   * Active leg. Active mode ends permanently; the run CONTINUES to
   * evidence-close as Native-completed (LEG-terminal only).
   */
  recordActiveFallback(reason: string): S1FiredStop {
    return this.fire(
      'S-5',
      'ACTIVE_MODE',
      `guard FALLBACK_NATIVE after opt-in: ${reason}; Active leg aborts to native-completion, run continues`
    )
  }

  /**
   * S-8: operator kill switch. All remaining Active sends permanently Native;
   * the Native-completed run still evidence-closes.
   */
  recordKillSwitchTrip(reason: string): S1FiredStop {
    return this.fire('S-8', 'ACTIVE_MODE', `operator kill switch tripped: ${reason}`)
  }

  /**
   * Begin one leg. Fixed order: NATIVE first (control data is secured before
   * any rewrite risk). Starting ACTIVE before NATIVE completed is a runner
   * bug and throws. The Active leg is REFUSED (S-7, RUN-terminal) when the
   * Native leg already exceeded the per-leg provider-call gate.
   */
  beginLeg(strategy: S1LegStrategy): S1BeginLegResult {
    if (this.runTerminal) {
      return {
        ok: false,
        stop: this.fire('S-7', 'RUN', 'leg start refused: the run is already terminal')
      }
    }
    if (strategy === 'ACTIVE') {
      if (!this.nativeCompleted) {
        throw new Error(
          'S1 pair order violated: the NATIVE leg must evidence-close before the ACTIVE leg begins'
        )
      }
      if (this.activeCompleted) {
        return {
          ok: false,
          stop: this.fire('S-7', 'RUN', 'the single ACTIVE leg already completed')
        }
      }
      if (this.providerCallsByLeg.NATIVE > S1_BUDGETS.maxProviderCallRecordsPerLeg) {
        return {
          ok: false,
          stop: this.fire(
            'S-7',
            'RUN',
            `Active leg barred: Native leg exceeded the per-leg provider-call gate (${this.providerCallsByLeg.NATIVE} > ${S1_BUDGETS.maxProviderCallRecordsPerLeg})`
          )
        }
      }
    } else if (this.nativeCompleted) {
      return {
        ok: false,
        stop: this.fire('S-7', 'RUN', 'the single NATIVE leg already completed')
      }
    }
    if (this.legsCompleted >= S1_BUDGETS.maxLegs) {
      return {
        ok: false,
        stop: this.fire('S-7', 'RUN', `leg budget exhausted: ${this.legsCompleted} legs done`)
      }
    }
    return { ok: true, leg: strategy }
  }

  /**
   * Evidence-close one leg and run the ledger-driven budget stops (S-7).
   */
  endLeg(input: S1EndLegInput): { readonly stop: false } | { readonly stop: true; readonly reason: string } {
    if (input.leg === 'NATIVE') this.nativeCompleted = true
    else this.activeCompleted = true
    this.legsCompleted += 1
    this.providerCallsByLeg[input.leg] = input.providerCallRecords
    this.toolCallsByLeg[input.leg] = input.toolCalls
    this.wallClockByLeg[input.leg] = input.wallClockMs
    const budgetStop = evaluateS1BudgetStops(this.ledgers())
    if (budgetStop.stop) {
      this.fire('S-7', 'RUN', budgetStop.reason)
      return budgetStop
    }
    return { stop: false }
  }
}

// ---------------------------------------------------------------------------
// Pairing evidence (contract section 11: pairs.json / manifest.json shapes)
// ---------------------------------------------------------------------------

export interface S1OracleResult {
  readonly kind: 'PRIMARY' | 'REGRESSION' | 'WRITABLE_CONFORMANCE'
  readonly command: string
  readonly exitCode: number | null
  /** null when the oracle did not run (DRY_RUN stand-in). */
  readonly pass: boolean | null
  /** True for DRY_RUN stand-in records that prove plumbing, not outcomes. */
  readonly standIn?: boolean
}

export interface S1FinalArtifactSummary {
  readonly path: string
  readonly sha256: string
  readonly lineCount: number
}

export interface S1LegRecord {
  readonly leg: 'A-NATIVE' | 'B-ACTIVE'
  readonly strategy: S1LegStrategy
  readonly oracleResults: readonly S1OracleResult[]
  readonly recordCount: number
  readonly toolCallCount: number
  readonly observedTokenEstimateSum: number
  readonly wallClockMs: number
  readonly replayMismatches: number
  /** Active leg only: the single intervention attempt. */
  readonly intervention?: ActiveRewriteInterventionSummary
  /** Metadata-only summary of the final writable artifact. */
  readonly finalArtifact?: S1FinalArtifactSummary
  readonly fixtureDirRemoved: boolean
}

/** DRY_RUN stand-in leg records: prove the pair/budget/stop plumbing only. */
export function scriptedDryRunLegRecords(): { native: S1LegRecord; active: S1LegRecord } {
  const standInOracle = (kind: S1OracleResult['kind'], command: string): S1OracleResult => ({
    kind,
    command,
    exitCode: null,
    pass: null,
    standIn: true
  })
  return {
    native: {
      leg: 'A-NATIVE',
      strategy: 'NATIVE',
      oracleResults: [
        standInOracle('PRIMARY', 'node --test test/discount.test.js'),
        standInOracle('REGRESSION', 'node --test test/regression.test.js'),
        standInOracle('WRITABLE_CONFORMANCE', 'changed paths <= expectedWritablePaths')
      ],
      recordCount: 5,
      toolCallCount: 7,
      observedTokenEstimateSum: 0,
      wallClockMs: 0,
      replayMismatches: 0,
      fixtureDirRemoved: true
    },
    active: {
      leg: 'B-ACTIVE',
      strategy: 'ACTIVE',
      oracleResults: [
        standInOracle('PRIMARY', 'node --test test/discount.test.js'),
        standInOracle('REGRESSION', 'node --test test/regression.test.js'),
        standInOracle('WRITABLE_CONFORMANCE', 'changed paths <= expectedWritablePaths')
      ],
      recordCount: 6,
      toolCallCount: 9,
      observedTokenEstimateSum: 0,
      wallClockMs: 0,
      replayMismatches: 0,
      fixtureDirRemoved: true
    }
  }
}

// ---------------------------------------------------------------------------
// Frozen C1 task manifest (read-only; contract section 4)
// ---------------------------------------------------------------------------

export interface C1OracleSpec {
  readonly command: string
  readonly args: readonly string[]
  readonly expectedExitCode: number
  readonly timeoutMs: number
}

export interface C1TaskDefinition {
  readonly taskId: string
  readonly category: string
  readonly title: string
  readonly prompt: string
  readonly allowedTools: readonly string[]
  readonly expectedTools: readonly string[]
  readonly expectedWritablePaths: readonly string[]
  readonly oracle: C1OracleSpec
  readonly regressionOracle: C1OracleSpec | null
  readonly budget: {
    readonly maxSemanticCalls: number
    readonly maxToolCalls: number
    readonly wallClockMs: number
  }
}

interface RawC1Manifest {
  taskId?: unknown
  category?: unknown
  title?: unknown
  prompt?: unknown
  allowedTools?: unknown
  expectedTools?: unknown
  expectedWritablePaths?: unknown
  oracle?: unknown
  regressionOracle?: unknown
  budget?: unknown
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`C1 manifest field '${field}' must be a non-empty string`)
  }
  return value
}

function expectStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`C1 manifest field '${field}' must be an array of strings`)
  }
  return value as readonly string[]
}

function expectOracle(value: unknown, field: string): C1OracleSpec {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`C1 manifest field '${field}' must be an oracle object`)
  }
  const record = value as Record<string, unknown>
  const args = expectStringArray(record['args'], `${field}.args`)
  return {
    command: expectString(record['command'], `${field}.command`),
    args,
    expectedExitCode:
      typeof record['expectedExitCode'] === 'number' ? record['expectedExitCode'] : 0,
    timeoutMs: typeof record['timeoutMs'] === 'number' ? record['timeoutMs'] : 10000
  }
}

/** Load and validate the frozen C1 manifest. Read-only; never rewrites it. */
export function loadC1TaskDefinition(raw: unknown): C1TaskDefinition {
  const manifest = (raw ?? {}) as RawC1Manifest
  const budgetRecord =
    typeof manifest.budget === 'object' && manifest.budget !== null
      ? (manifest.budget as Record<string, unknown>)
      : {}
  const regression =
    manifest.regressionOracle === undefined || manifest.regressionOracle === null
      ? null
      : expectOracle(manifest.regressionOracle, 'regressionOracle')
  return {
    taskId: expectString(manifest.taskId, 'taskId'),
    category: expectString(manifest.category, 'category'),
    title: expectString(manifest.title, 'title'),
    prompt: expectString(manifest.prompt, 'prompt'),
    allowedTools: expectStringArray(manifest.allowedTools, 'allowedTools'),
    expectedTools: expectStringArray(manifest.expectedTools, 'expectedTools'),
    expectedWritablePaths: expectStringArray(manifest.expectedWritablePaths, 'expectedWritablePaths'),
    oracle: expectOracle(manifest.oracle, 'oracle'),
    regressionOracle: regression,
    budget: {
      maxSemanticCalls:
        typeof budgetRecord['maxSemanticCalls'] === 'number'
          ? budgetRecord['maxSemanticCalls']
          : 12,
      maxToolCalls: typeof budgetRecord['maxToolCalls'] === 'number' ? budgetRecord['maxToolCalls'] : 40,
      wallClockMs: typeof budgetRecord['wallClockMs'] === 'number' ? budgetRecord['wallClockMs'] : 120000
    }
  }
}
