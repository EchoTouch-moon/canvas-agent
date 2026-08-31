import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ContextEvent,
  type ExtensionAPI
} from '@earendil-works/pi-coding-agent'
import { type ModelCallObservation } from '@canvas-agent/context-runtime'
import {
  ProviderBindingError,
  prepareModelProvider,
  safeProviderSelection,
  type PreparedModelProvider
} from '../index'
import { createRunKillSwitch } from '../experimental'
import {
  createActiveRewriteExtension,
  InMemoryActiveRewriteEvidenceCollector,
  type ActiveRewriteEvidenceCollector,
  type ActiveRemovalPolicy
} from '../extension/active-rewrite-extension'
import type { PiMessageView } from '../pi-message-mapper'
import { C0ScenarioExecutor } from './c0-scenarios'
import {
  LEG_DEADLINE_STOP_REASON,
  legDeadlineOf,
  runPromptWithDeadline
} from './leg-deadline'
import {
  assertMxProfileBindable,
  MxProfileError,
  readMxProfileContract,
  resolveMxArmOrder,
  validateMxShapeAgainstProfile,
  type MxArmOrderMode,
  type MxExperimentProfile
} from './mx-profiles'
import {
  verifyMxEvidenceRoot,
  writeMxEvidenceRoot,
  MX_EVIDENCE_ROOT_FILENAME
} from './mx-evidence-root'
import type { S1OracleResult } from './s1-pair-core'
import {
  aggregateMxCells,
  analyzeMatrix,
  evaluateMxLegBudgetStop,
  isValidMxRunId,
  MatrixStateMachine,
  MxConfigError,
  MX_BUDGETS,
  mxArmOrderBindingsOf,
  mxCellOneLiner,
  mxLegAnalysisInputOf,
  mxBlockArmOrderOf,
  mxLegDirName,
  mxLegOrder,
  mxPermutationTests,
  mxShapeFromEnv,
  MX_RUN_ID_PATTERN,
  mxTotalLegsOf,
  mxVerdictOf,
  resolveMxTasks,
  scriptedMxLegRecords,
  scriptedMxObservations,
  suggestMxRunId,
  trajectorySummaryOf,
  writeMxAggregate,
  writeMxLegEvidence,
  writeMxManifest,
  type MxBlockOrderBinding,
  type MxLegPlan,
  type MxLegRecord,
  type MxLegStop,
  type MxLegStatus,
  type MxMatrixShape,
  type MxStrategy,
  type MxTaskDefinition,
  type MxTaskId
} from './matrix-core'

// CR-004 Stage 1 MATRIX runner — M3/M6 experimental policy-screen edition
// (docs/plan/cr004-m3-matrix-run-contract-2026-08-27.md; M2 sibling:
// docs/plan/cr004-m2-matrix-run-contract-2026-08-27.md; M1:
// docs/plan/cr004-matrix-run-contract-2026-08-27.md).
//
//   --analyze <reportDir>   offline analysis mode: reads the leg evidence,
//                           emits analysis.json + a markdown summary; no env
//                           gates, no provider, no network. M1/M2 evidence
//                           dirs still analyze correctly (the analyzer
//                           understands the historical v1 ACTIVE arm).
//
// LIVE mode (Lead-operated only) requires ALL of:
//   CANVAS_CONTEXT_LIVE_SMOKE=1
//   CANVAS_PROVIDER_EXECUTION_MODE=experiment-strict
//   CANVAS_PROVIDER_RUN_ID=cr004-m3-<ISO-date>-<8-hex>  (single-use, fresh;
//                           consumed cr004-m1-*/cr004-m2-* identities are
//                           still accepted by validation for evidence
//                           analysis)
//   STEP_PLAN_API_KEY=<key>                            (never recorded)
//   CANVAS_MX_KILL_SWITCH_FILE=<path>                  (optional operator stop)
//   CANVAS_MX_MANIFEST_DIR=<dir>                       (optional; default
//                                                      research/context-benchmarks/matrix-manifests)
//   CANVAS_MX_TASKS=L1,L2,L3                           (optional; validated
//                                                      comma list from
//                                                      {L1,L2,L3}, default
//                                                      all — enables the
//                                                      targeted L2-only run)
//   CANVAS_MX_REPS=3                                   (optional; integer
//                                                      1..8, default 3)
//
// Matrix (M3 design): tasks (CANVAS_MX_TASKS, default L1,L2,L3) x
// {NATIVE, ACTIVE_V2, ACTIVE_V3} x CANVAS_MX_REPS repetitions — 27 legs by
// default, 12 for the targeted L2 x 4 shape — deterministic interleaved order
// (rep-major, per task NATIVE, ACTIVE_V2, ACTIVE_V3). M6 adds ACTIVE_V4 and
// requires seeded within-block randomization; its profile binds 3 tasks x 4
// arms x 4 repetitions = 48 legs, with a 2-candidate batch threshold. ONE
// strict binding for the whole matrix (prepareModelProvider once, step-plan,
// fallback 'none'). Per-leg budgets come from each task manifest; matrix
// totals are profile-bound (M3 defaults 900 records / 180 minutes; M6 binds
// 1,400 records / 300 minutes). A leg-level provider/safety error marks THAT
// leg FAILED and the matrix CONTINUES; only matrix-level S-1 (binding) or S-7
// (totals) stop everything.
//
// INCREMENTAL EVIDENCE: after EACH leg the report files are written/rewritten
// immediately (leg.json + observations.jsonl per leg; manifest.json and
// matrix.json rewritten) — never buffered to the end.
//
// DRY_RUN mode (CANVAS_MX_DRY_RUN=1) drives the configured shape's scripted
// stand-in legs (27 by default; 12 for CANVAS_MX_TASKS=L2 CANVAS_MX_REPS=4)
// through the FULL matrix state machine + incremental evidence writers +
// aggregator: no ModelRuntime, no extension, no session, provider calls
// exactly 0.
//
// Evidence: research/context-benchmarks/reports/cr004-matrix/<runId>/
//   manifest.json  legs/<task>-<strategy>-rep<N>/{leg.json, observations.jsonl}
//   matrix.json

const BENCHMARK_ROOT = resolve(process.cwd(), '..', '..', 'research', 'context-benchmarks')
// CR-004 matrix artifacts live apart from the frozen CR-005 six-category corpus.
const DEFAULT_MANIFEST_DIR = join(BENCHMARK_ROOT, 'matrix-manifests')
const REPORTS_ROOT = join(BENCHMARK_ROOT, 'reports', 'cr004-matrix')
/** Repo root for the experiment-profile contract existence check + hashing. */
const REPO_ROOT = resolve(process.cwd(), '..', '..')
const STEP_PLAN_PROVIDER_ID = 'step-plan'
/**
 * The Active seam's out-of-band system-instruction carrier (Stage 1 constant,
 * byte-identical through every composition).
 */
const MX_SYSTEM_INSTRUCTION =
  'You are a careful coding agent. Complete the task in the repository using the provided tools.'

type MxStatus = 'EXECUTED' | 'DRY_RUN_COMPLETE' | 'STOPPED' | 'FAILED'
type MxMode = 'LIVE' | 'DRY_RUN'

class MxBoundaryFailure extends Error {
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    super(`MX boundary failure: ${message}`)
    this.name = 'MxBoundaryFailure'
  }
}

function log(message: string): void {
  console.log(`[cr004-mx] ${message}`)
}

function sha256OfContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

async function walkFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...(await walkFiles(root, rel)))
    else files.push(rel)
  }
  return files.sort()
}

/** Metadata-only snapshot: relative path -> sha256 (writable conformance). */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()
  for (const rel of await walkFiles(root)) {
    const content = await readFile(join(root, rel), 'utf8')
    snapshot.set(rel, sha256OfContent(content))
  }
  return snapshot
}

async function changedPaths(root: string, before: Map<string, string>): Promise<string[]> {
  const after = await snapshotTree(root)
  const changed: string[] = []
  for (const [rel, hash] of after) {
    if (before.get(rel) !== hash) changed.push(rel)
  }
  for (const rel of before.keys()) {
    if (!after.has(rel)) changed.push(rel)
  }
  return changed.sort()
}

/** Metadata-only fixture summary: digest of the initial tree + line counts. */
async function fixtureSummaryOf(
  fixtureDir: string
): Promise<{ summarySha256: string; lineCount: number; fileCount: number }> {
  const snapshot = await snapshotTree(fixtureDir)
  const listing = [...snapshot.entries()].map(([rel, hash]) => `${rel}:${hash}`).sort().join('\n')
  let lineCount = 0
  for (const rel of snapshot.keys()) {
    const content = await readFile(join(fixtureDir, rel), 'utf8')
    lineCount += content.split('\n').length
  }
  return {
    summarySha256: sha256OfContent(listing),
    lineCount,
    fileCount: snapshot.size
  }
}

function runOracle(
  spec: MxTaskDefinition['oracle'],
  cwd: string
): { command: string; exitCode: number | null; pass: boolean } {
  const command = `${spec.command} ${spec.args.join(' ')}`
  const result = spawnSync(spec.command, [...spec.args], {
    cwd,
    timeout: spec.timeoutMs,
    encoding: 'utf8'
  })
  if (result.error !== undefined) {
    return { command, exitCode: null, pass: false }
  }
  return { command, exitCode: result.status, pass: result.status === spec.expectedExitCode }
}

function countToolCallBlocks(messages: readonly PiMessageView[]): number {
  let count = 0
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'toolCall'
      ) {
        count += 1
      }
    }
  }
  return count
}

function observerOnlyExtension(
  executor: C0ScenarioExecutor,
  lastMessages: { current: readonly PiMessageView[] }
) {
  return (pi: ExtensionAPI): void => {
    pi.on('context', async (event: ContextEvent) => {
      try {
        lastMessages.current = event.messages as unknown as readonly PiMessageView[]
        executor.observeBoundary(event.messages)
      } catch (error) {
        throw new MxBoundaryFailure(error)
      }
      return { messages: event.messages }
    })
  }
}

function activeInterventionExtension(
  executor: C0ScenarioExecutor,
  evidence: ActiveRewriteEvidenceCollector,
  killSwitch: ReturnType<typeof createRunKillSwitch>,
  killSwitchFilePath: string | undefined,
  runId: string,
  lastMessages: { current: readonly PiMessageView[] },
  removalPolicy: ActiveRemovalPolicy
) {
  // Multi-intervention Active extension with the matrix contract bounds.
  // ACTIVE (v1, historical) legs: 5 sends / 8 attempts (the M1 semantics).
  // ACTIVE_V2 legs: removalPolicy 'v2-retain-latest-coarse' with the raised
  // M2 bounds (8 sends / 12 attempts, 12 blocks per intervention).
  // ACTIVE_V3 legs: removalPolicy 'v3-verify-window-dedup' with the same
  // raised bounds plus the 2-tool-event verification window.
  // ACTIVE_V4 legs: removalPolicy 'v4-batched-retain-latest' with the same
  // raised bounds plus the fixed two-candidate batch threshold.
  const v2 = removalPolicy === 'v2-retain-latest-coarse'
  const v3 = removalPolicy === 'v3-verify-window-dedup'
  const v4 = removalPolicy === 'v4-batched-retain-latest'
  const raised = v2 || v3 || v4
  const factory = createActiveRewriteExtension({
    runId,
    systemInstruction: MX_SYSTEM_INSTRUCTION,
    executor,
    killSwitch,
    ...(killSwitchFilePath !== undefined ? { killSwitchFilePath } : {}),
    evidence,
    maxInterventions: raised
      ? v3
        ? MX_BUDGETS.maxInterventionsPerLegV3
        : v4
          ? MX_BUDGETS.maxInterventionsPerLegV4
          : MX_BUDGETS.maxInterventionsPerLegV2
      : MX_BUDGETS.maxInterventionsPerLeg,
    maxAttempts: raised
      ? v3
        ? MX_BUDGETS.maxAttemptsPerLegV3
        : v4
          ? MX_BUDGETS.maxAttemptsPerLegV4
          : MX_BUDGETS.maxAttemptsPerLegV2
      : MX_BUDGETS.maxAttemptsPerLeg,
    removalPolicy,
    ...(v2 ? { maxBlocksPerIntervention: MX_BUDGETS.maxBlocksPerInterventionV2 } : {}),
    ...(v3
      ? {
          maxBlocksPerIntervention: MX_BUDGETS.maxBlocksPerInterventionV3,
          verifyWindowEvents: MX_BUDGETS.verifyWindowEventsV3
        }
      : v4
        ? {
            maxBlocksPerIntervention: MX_BUDGETS.maxBlocksPerInterventionV4,
            minCandidateBlocks: MX_BUDGETS.minCandidateBlocksV4
          }
        : {})
  })
  return (pi: ExtensionAPI): void => {
    pi.on('context', async (event: ContextEvent) => {
      lastMessages.current = event.messages as unknown as readonly PiMessageView[]
    })
    factory(pi)
  }
}

/** Carries the partial executor out of a failed live leg for evidence-close. */
class MxLegObservationError extends Error {
  readonly failure: unknown
  constructor(
    readonly executor: C0ScenarioExecutor,
    failure: unknown
  ) {
    super(failure instanceof Error ? failure.message : String(failure))
    this.name = 'MxLegObservationError'
    this.failure = failure
  }
}

/**
 * The leg's prompt exceeded its in-flight deadline (manifest wallClockMs +
 * grace): the session was aborted in flight. Evidence-close happens through
 * the MxLegObservationError channel; the leg is FAILED with S-9 and the
 * matrix CONTINUES (replaces the external-kill mitigation).
 */
class MxLegDeadlineExceeded extends MxLegObservationError {
  constructor(executor: C0ScenarioExecutor, detail: {
    readonly deadlineMs: number
    readonly settledWithinGrace: boolean
    readonly abortErrorMessage?: string
  }) {
    super(executor, new Error(
      `leg deadline exceeded after ${detail.deadlineMs}ms; session aborted in-flight` +
        (detail.settledWithinGrace ? '' : '; prompt did not settle within the post-abort grace') +
        (detail.abortErrorMessage !== undefined ? `; abort error: ${detail.abortErrorMessage}` : '')
    ))
    this.name = 'MxLegDeadlineExceeded'
  }
}

/** One live matrix leg in a FRESH temp fixture copy. */
async function runLiveLeg(options: {
  readonly plan: MxLegPlan
  readonly task: MxTaskDefinition
  readonly runId: string
  readonly prepared: PreparedModelProvider
  readonly runtime: ModelRuntime
  readonly killSwitch: ReturnType<typeof createRunKillSwitch>
  readonly killSwitchFilePath: string | undefined
}): Promise<{
  legRecord: Omit<MxLegRecord, 'status' | 'stopCondition'>
  observations: readonly ModelCallObservation[]
}> {
  const { plan, task } = options
  const fixtureDir = await mkdtemp(
    join(tmpdir(), `canvas-mx-${plan.task.toLowerCase()}-${plan.strategy.toLowerCase()}-`)
  )
  const legStartedAt = Date.now()
  try {
    await cp(task.fixturePath!, fixtureDir, { recursive: true })
    const initialTree = await snapshotTree(fixtureDir)
    const fixtureSummary = await fixtureSummaryOf(fixtureDir)

    const executor = new C0ScenarioExecutor({
      runtimeSessionId: `${options.runId}:${mxLegDirName(plan)}`
    })
    const evidence =
      plan.strategy !== 'NATIVE' ? new InMemoryActiveRewriteEvidenceCollector() : null
    const lastMessages: { current: readonly PiMessageView[] } = { current: [] }

    const extensionFactory =
      plan.strategy !== 'NATIVE' && evidence !== null
        ? activeInterventionExtension(
            executor,
            evidence,
            options.killSwitch,
            options.killSwitchFilePath,
            options.runId,
            lastMessages,
            plan.strategy === 'ACTIVE_V2'
              ? 'v2-retain-latest-coarse'
              : plan.strategy === 'ACTIVE_V3'
                ? 'v3-verify-window-dedup'
                : plan.strategy === 'ACTIVE_V4'
                  ? 'v4-batched-retain-latest'
                  : 'v1-per-edit'
          )
        : observerOnlyExtension(executor, lastMessages)

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 }
    })
    const loader = new DefaultResourceLoader({
      cwd: fixtureDir,
      agentDir: join(fixtureDir, '.pi-agent'),
      settingsManager,
      extensionFactories: [
        {
          name: `canvas-cr004-mx-${plan.task.toLowerCase()}-${plan.strategy.toLowerCase()}`,
          factory: extensionFactory
        }
      ]
    })
    await loader.reload()
    const { session } = await createAgentSession({
      cwd: fixtureDir,
      model: options.prepared.model,
      modelRuntime: options.runtime,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(fixtureDir),
      settingsManager,
      tools: [...task.allowedTools]
    })

    // The manifest task prompt, issued ONCE, exactly as the manifest specifies,
    // bounded by the IN-FLIGHT LEG DEADLINE (manifest wallClockMs + 60s grace):
    // on the deadline the session is aborted in flight, the leg is FAILED with
    // S-9, and the matrix continues (no external kill needed).
    const deadlineMs = legDeadlineOf(task.budget.wallClockMs)
    log(`leg=${mxLegDirName(plan)} prompt issued (taskId=${task.taskId}) deadlineMs=${deadlineMs}`)
    try {
      const outcome = await runPromptWithDeadline(session, task.prompt, deadlineMs)
      if (outcome.status === 'TIMED_OUT') {
        log(
          `leg=${mxLegDirName(plan)} deadline exceeded (deadlineMs=${outcome.deadlineMs}); session aborted in-flight` +
            (outcome.settledWithinGrace ? '' : '; prompt did not settle within the post-abort grace')
        )
        throw new MxLegDeadlineExceeded(executor, outcome)
      }
    } catch (error) {
      // Evidence-close first: observations collected so far are preserved
      // before the error escapes; the runner then marks the leg FAILED.
      if (!(error instanceof MxLegDeadlineExceeded)) {
        throw new MxLegObservationError(executor, error)
      }
      throw error
    }
    const wallClockMs = Date.now() - legStartedAt

    const recordCount = executor.observationCount
    const toolCallCount = countToolCallBlocks(lastMessages.current)
    const observations = [...executor.base.inMemory.observations]
    const observedTokenEstimateSum = observations.reduce(
      (sum, observation) => sum + observation.observedMessageTokenEstimate,
      0
    )
    log(
      `leg=${mxLegDirName(plan)} records=${recordCount} toolCalls=${toolCallCount} wallClockMs=${wallClockMs}`
    )

    // Objective oracles + writable-path conformance, in the leg's fixture dir.
    const oracleResults: S1OracleResult[] = [
      { ...runOracle(task.oracle, fixtureDir), kind: 'PRIMARY' }
    ]
    if (task.regressionOracle !== null) {
      oracleResults.push({ ...runOracle(task.regressionOracle, fixtureDir), kind: 'REGRESSION' })
    }
    const changed = await changedPaths(fixtureDir, initialTree)
    const writablePass = changed.every((path) => task.expectedWritablePaths.includes(path))
    oracleResults.push({
      kind: 'WRITABLE_CONFORMANCE',
      command: 'changed paths <= expectedWritablePaths',
      exitCode: writablePass ? 0 : 1,
      pass: writablePass
    })

    // Metadata-only summary of the first expected writable artifact.
    const artifactPath = join(fixtureDir, task.expectedWritablePaths[0] ?? '')
    let finalArtifact: MxLegRecord['finalArtifact']
    try {
      const artifactStat = await stat(artifactPath)
      if (artifactStat.isFile()) {
        const content = await readFile(artifactPath, 'utf8')
        finalArtifact = {
          path: task.expectedWritablePaths[0] ?? '',
          sha256: sha256OfContent(content),
          lineCount: content.split('\n').length
        }
      }
    } catch {
      // absent artifact: recorded by its absence
    }

    const telemetry =
      plan.strategy !== 'NATIVE' && evidence !== null
        ? {
            events: evidence.events,
            interventions: evidence.interventions,
            attemptsUsed: evidence.attemptsUsed,
            sendsUsed: evidence.sendsUsed,
            killSwitchTripped: options.killSwitch.isTripped
          }
        : undefined

    return {
      legRecord: {
        runId: options.runId,
        mode: 'LIVE',
        legIndex: plan.legIndex,
        task: plan.task,
        strategy: plan.strategy,
        rep: plan.rep,
        oracleResults,
        recordCount,
        toolCallCount,
        observedTokenEstimateSum,
        wallClockMs,
        replayMismatches: executor.replayMismatchCount,
        trajectory: trajectorySummaryOf(
          observations.map((observation) => observation.observedMessageTokenEstimate)
        ),
        ...(telemetry !== undefined ? { interventionTelemetry: telemetry } : {}),
        fixtureSummary,
        ...(finalArtifact !== undefined ? { finalArtifact } : {}),
        fixtureDirRemoved: true
      },
      observations
    }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
}

interface MxLegObservation {
  readonly observedMessageTokenEstimate: number
}

interface LegOutcome {
  readonly status: MxLegStatus
  readonly stopCondition: { readonly condition: MxLegStop['condition']; readonly reason: string } | null
}

async function run(): Promise<void> {
  // ---- Evidence verification mode (--verify-evidence <reportDir>) ----------
  const verifyArgIndex = process.argv.indexOf('--verify-evidence')
  if (verifyArgIndex !== -1) {
    const reportDir = process.argv[verifyArgIndex + 1]
    if (reportDir === undefined || reportDir === '') {
      console.error('[cr004-mx] REFUSED: --verify-evidence requires a report directory argument.')
      console.error('MX_STATUS=FAILED')
      process.exit(1)
    }
    const resolvedReportDir = resolve(reportDir)
    const verification = await verifyMxEvidenceRoot(resolvedReportDir, { repoRoot: REPO_ROOT })
    for (const [field, check] of Object.entries(verification.fields)) {
      console.log(`[cr004-mx] EVIDENCE ${field}=${check}`)
    }
    console.log(`MX_EVIDENCE_VERIFY=${verification.allMatch ? 'MATCH' : 'MISMATCH'}`)
    if (!verification.allMatch) process.exit(1)
    return
  }

  // ---- Offline analysis mode (--analyze <reportDir>) -----------------------
  const analyzeArgIndex = process.argv.indexOf('--analyze')
  if (analyzeArgIndex !== -1) {
    const reportDir = process.argv[analyzeArgIndex + 1]
    if (reportDir === undefined || reportDir === '') {
      console.error('[cr004-mx] REFUSED: --analyze requires a report directory argument.')
      console.error('MX_STATUS=FAILED')
      process.exit(1)
    }
    const resolvedReportDir = resolve(reportDir)
    const { analysis, markdown } = await analyzeMatrix(resolvedReportDir)
    await writeFile(
      join(resolvedReportDir, 'analysis.json'),
      `${JSON.stringify(analysis, null, 2)}\n`,
      'utf8'
    )
    // Refresh the evidence root AFTER analysis.json lands (the root covers it).
    const evidenceRoot = await writeMxEvidenceRoot(resolvedReportDir, { repoRoot: REPO_ROOT })
    console.log(markdown)
    console.log(`MX_ANALYSIS=${join(resolvedReportDir, 'analysis.json')}`)
    console.log(`MX_EVIDENCE_ROOT=${join(resolvedReportDir, MX_EVIDENCE_ROOT_FILENAME)}`)
    console.log(`MX_EVIDENCE_LEGS_ROOT=${evidenceRoot.legsRoot}`)
    return
  }

  const dryRun = process.env['CANVAS_MX_DRY_RUN'] === '1'

  if (!dryRun && process.env['CANVAS_CONTEXT_LIVE_SMOKE'] !== '1') {
    console.log('[cr004-mx] CANVAS_CONTEXT_LIVE_SMOKE=1 (or CANVAS_MX_DRY_RUN=1) is required. SKIPPED')
    console.log('MX_STATUS=SKIPPED')
    return
  }

  const mode: MxMode = dryRun ? 'DRY_RUN' : 'LIVE'

  if (!dryRun) {
    if (process.env['CANVAS_PROVIDER_EXECUTION_MODE'] !== 'experiment-strict') {
      console.error(
        '[cr004-mx] REFUSED: CANVAS_PROVIDER_EXECUTION_MODE=experiment-strict is required for the matrix.'
      )
      console.error('MX_STATUS=FAILED')
      process.exit(1)
    }
    if (!isValidMxRunId(process.env['CANVAS_PROVIDER_RUN_ID'])) {
      console.error(
        `[cr004-mx] REFUSED: CANVAS_PROVIDER_RUN_ID must match a REGISTERED experiment profile /^${MX_RUN_ID_PATTERN.source}$/ (unregistered series need a deliberate registry entry + contract).`
      )
      console.error(`[cr004-mx] SUGGESTED_CANVAS_PROVIDER_RUN_ID=${suggestMxRunId()}`)
      console.error(
        '[cr004-mx] Export the suggested fresh identity explicitly; run identities are single-use.'
      )
      console.error('MX_STATUS=FAILED')
      process.exit(1)
    }
    if (
      process.env['STEP_PLAN_API_KEY'] === undefined ||
      process.env['STEP_PLAN_API_KEY'].length === 0
    ) {
      console.error('[cr004-mx] REFUSED: STEP_PLAN_API_KEY is required in live mode.')
      console.error('MX_STATUS=FAILED')
      process.exit(1)
    }
  }

  const envRunId = process.env['CANVAS_PROVIDER_RUN_ID']
  const runId = isValidMxRunId(envRunId) ? envRunId : suggestMxRunId()
  if (!isValidMxRunId(envRunId)) {
    log(`DRY_RUN generated run identity ${runId} (no provider binding occurs in DRY_RUN)`)
  }

  // ---- Experiment profile / contract binding (BOTH modes, startup gate) ----
  // The run identity must match exactly one REGISTERED series whose contract
  // file EXISTS on disk; the manifest then records that series' contractPath,
  // contractSha256 and matrixDesign (the hardcoded M3 constants recorded the
  // wrong contract + design for the real M4 run — verified mislabel).
  let profile: MxExperimentProfile
  try {
    profile = assertMxProfileBindable(runId, { repoRoot: REPO_ROOT })
  } catch (error) {
    const message = error instanceof MxProfileError ? error.message : String(error)
    console.error(`[cr004-mx] REFUSED: experiment profile binding failed: ${message}`)
    console.error(`[cr004-mx] SUGGESTED_CANVAS_PROVIDER_RUN_ID=${suggestMxRunId()}`)
    console.error('MX_STATUS=FAILED')
    process.exit(1)
  }
  const contractBinding = await readMxProfileContract(profile, { repoRoot: REPO_ROOT })
  log(
    `profile=${profile.series} contract=${profile.contractPath} sha256=${contractBinding.contractSha256.slice(0, 12)} design=${profile.matrixDesign}`
  )

  // ---- Matrix shape (validated env knobs; recorded in the manifest) -------
  let shape: MxMatrixShape
  try {
    shape = mxShapeFromEnv({
      tasks: process.env['CANVAS_MX_TASKS'],
      reps: process.env['CANVAS_MX_REPS'],
      arms: process.env['CANVAS_MX_ARMS'],
      armOrder: process.env['CANVAS_MX_ARM_ORDER']
    })
  } catch (error) {
    if (!(error instanceof MxConfigError)) throw error
    console.error(`[cr004-mx] REFUSED: ${error.message}`)
    console.error('MX_STATUS=FAILED')
    process.exit(1)
  }
  // ---- Arm-order resolution (M5/M6 pre-registration; BOTH modes) ----------
  // A profile with a REQUIRED arm-order mode (M5/M6: 'randomized') forces it —
  // an explicit conflicting CANVAS_MX_ARM_ORDER request is REFUSED; an unset
  // knob adopts the profile's mode. Historical series keep 'canonical'.
  let armOrder: MxArmOrderMode
  try {
    armOrder = resolveMxArmOrder(shape.armOrder, profile)
  } catch (error) {
    const message = error instanceof MxProfileError ? error.message : String(error)
    console.error(`[cr004-mx] REFUSED: ${message}`)
    console.error('MX_STATUS=FAILED')
    process.exit(1)
  }
  shape = { ...shape, armOrder }
  log(`armOrder=${armOrder}${armOrder === 'randomized' ? ' (seeded per task x rep block from the run identity)' : ''}`)
  // LIVE runs are bound to the profile's shape bounds (allowed tasks/arms,
  // max repetitions, required arm-order mode). DRY_RUN scripted stand-ins
  // legitimately replay historical shapes, so the bounds gate applies to
  // LIVE only.
  if (!dryRun) {
    try {
      validateMxShapeAgainstProfile(shape, profile)
    } catch (error) {
      const message = error instanceof MxProfileError ? error.message : String(error)
      console.error(`[cr004-mx] REFUSED: ${message}`)
      console.error('MX_STATUS=FAILED')
      process.exit(1)
    }
  }
  const totalLegs = mxTotalLegsOf(shape)
  // The full leg order (randomized shapes derive every block's shuffle from
  // the run identity) and the per-block order bindings for the manifest.
  const legOrder = mxLegOrder(shape, { runId })
  const armOrderBindings = mxArmOrderBindingsOf(shape, runId)
  const armOrderBindingByBlock = new Map(
    armOrderBindings.map((binding) => [`${binding.task}:rep${binding.rep}`, binding])
  )
  const blockBindingOf = (task: MxTaskId, rep: number): MxBlockOrderBinding | null =>
    armOrderBindingByBlock.get(`${task}:rep${rep}`) ?? null

  // ---- Manifest resolution (both modes): refuse clearly when missing -------
  const manifestDir = resolve(
    process.env['CANVAS_MX_MANIFEST_DIR'] ?? DEFAULT_MANIFEST_DIR
  )
  const benchmarkRoot = resolve(manifestDir, '..')
  let tasks: readonly MxTaskDefinition[]
  try {
    tasks = await resolveMxTasks({
      manifestDir,
      benchmarkRoot,
      requireFixtures: mode === 'LIVE',
      taskIds: shape.tasks
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[cr004-mx] REFUSED: task manifest resolution failed: ${message}`)
    console.error('MX_STATUS=FAILED')
    process.exit(1)
  }
  const tasksBySlot = new Map<MxTaskId, MxTaskDefinition>(tasks.map((task) => [task.slot, task]))
  const taskForSlot = (slot: MxTaskId): MxTaskDefinition => {
    const task = tasksBySlot.get(slot)
    if (task === undefined) throw new Error(`matrix task slot ${slot} unresolved (internal error)`)
    return task
  }

  const reportDir = join(REPORTS_ROOT, runId)
  await mkdir(join(reportDir, 'legs'), { recursive: true })

  const startedAt = new Date()
  const matrixMaxProviderCallRecords =
    profile.maxProviderCallRecords ?? MX_BUDGETS.maxProviderCallRecords
  const matrixRunWallClockMs = profile.runWallClockMs ?? MX_BUDGETS.runWallClockMs
  const machine = new MatrixStateMachine({
    maxLegs: totalLegs,
    maxProviderCallRecords: matrixMaxProviderCallRecords,
    runWallClockMs: matrixRunWallClockMs
  })
  const killSwitch = createRunKillSwitch(runId, { now: () => new Date().toISOString() })
  const killSwitchFilePath = process.env['CANVAS_MX_KILL_SWITCH_FILE']
  const legIndexEntries: {
    readonly legIndex: number
    readonly dir: string
    readonly task: string
    readonly strategy: string
    readonly rep: number
    readonly status: MxLegStatus
    readonly stopCondition: MxLegRecord['stopCondition']
    /** Randomized shapes: this leg's block seed (null when canonical). */
    readonly blockSeed: string | null
    /** Randomized shapes: the realized arm order of this leg's block. */
    readonly blockArmOrder: readonly string[] | null
  }[] = []
  let bindingEvidence: Record<string, unknown> | null = null

  const legRecords: MxLegRecord[] = []

  const writeIncrementalEvidence = async (final: boolean): Promise<void> => {
    // INCREMENTAL EVIDENCE: rewritten after EVERY leg; a crash mid-matrix
    // leaves complete evidence for every leg that already ended.
    const finishedAt = new Date()
    await writeMxManifest(reportDir, {
      runId,
      mode,
      status: final
        ? machine.isTerminal
          ? 'STOPPED'
          : mode === 'DRY_RUN'
            ? 'DRY_RUN_COMPLETE'
            : 'EXECUTED'
        : 'RUNNING',
      contract: profile.contractPath,
      contractSha256: contractBinding.contractSha256,
      startedAt: startedAt.toISOString(),
      ...(final ? { finishedAt: finishedAt.toISOString() } : {}),
      wallClockMs: finishedAt.getTime() - startedAt.getTime(),
      matrixDesign: profile.matrixDesign,
      experimentProfile: {
        series: profile.series,
        allowedTasks: [...profile.allowedTasks],
        allowedArms: [...profile.allowedArms],
        maxReps: profile.maxReps,
        maxProviderCallRecords: matrixMaxProviderCallRecords,
        runWallClockMs: matrixRunWallClockMs
      },
      design: {
        tasks: [...shape.tasks],
        strategies: [...shape.strategies],
        envConfig: {
          tasks: [...shape.tasks].join(','),
          reps: shape.repetitions,
          arms: [...shape.strategies].join(','),
          armOrder: shape.armOrder
        },
        armOrder: shape.armOrder,
        activeV2: {
          removalPolicy: 'v2-retain-latest-coarse',
          maxInterventionsPerLeg: MX_BUDGETS.maxInterventionsPerLegV2,
          maxAttemptsPerLeg: MX_BUDGETS.maxAttemptsPerLegV2,
          maxBlocksPerIntervention: MX_BUDGETS.maxBlocksPerInterventionV2
        },
        activeV3: {
          removalPolicy: 'v3-verify-window-dedup',
          maxInterventionsPerLeg: MX_BUDGETS.maxInterventionsPerLegV3,
          maxAttemptsPerLeg: MX_BUDGETS.maxAttemptsPerLegV3,
          maxBlocksPerIntervention: MX_BUDGETS.maxBlocksPerInterventionV3,
          verifyWindowEvents: MX_BUDGETS.verifyWindowEventsV3
        },
        activeV4: {
          removalPolicy: 'v4-batched-retain-latest',
          maxInterventionsPerLeg: MX_BUDGETS.maxInterventionsPerLegV4,
          maxAttemptsPerLeg: MX_BUDGETS.maxAttemptsPerLegV4,
          maxBlocksPerIntervention: MX_BUDGETS.maxBlocksPerInterventionV4,
          minCandidateBlocks: MX_BUDGETS.minCandidateBlocksV4
        },
        repetitions: shape.repetitions,
        totalLegs,
        legOrder: mxLegOrder(shape, { runId }).map((plan) => `${mxLegDirName(plan)}#${plan.legIndex}`)
      },
      tasks: tasks.map((task) => ({
        slot: task.slot,
        taskId: task.taskId,
        category: task.category,
        title: task.title,
        manifestPath: relative(process.cwd(), task.manifestPath),
        manifestSha256: task.manifestSha256,
        fixturePath: task.fixturePath === null ? null : relative(process.cwd(), task.fixturePath),
        allowedTools: [...task.allowedTools],
        expectedWritablePaths: [...task.expectedWritablePaths],
        promptHash: sha256OfContent(task.prompt),
        budget: task.budget
      })),
      budgets: {
        ...MX_BUDGETS,
        maxProviderCallRecords: matrixMaxProviderCallRecords,
        runWallClockMs: matrixRunWallClockMs,
        perLeg: Object.fromEntries(
          tasks.map((task) => [task.taskId, task.budget])
        )
      },
      ledgers: machine.ledgers(),
      provider:
        mode === 'LIVE'
          ? bindingEvidence
          : {
              binding: null,
              providerCalls: 0,
              note: 'DRY_RUN: no ModelRuntime, no prepareModelProvider, no session, no extension; scripted stand-in leg records'
            },
      killSwitchFile: killSwitchFilePath ?? null,
      killSwitchTrip: killSwitch.tripRecord ?? null,
      stopsFired: machine.stopsFired,
      legs: legIndexEntries
    })
    const cells = aggregateMxCells(legRecords.map(mxLegAnalysisInputOf))
    await writeMxAggregate(reportDir, {
      runId,
      mode,
      updatedAt: finishedAt.toISOString(),
      legsAttempted: machine.ledgers().legsAttempted,
      cells,
      perTask: mxPermutationTests(cells),
      verdict: mxVerdictOf(cells)
    })
  }

  if (dryRun) {
    // DRY_RUN: the configured shape's scripted stand-in legs through the FULL
    // matrix state machine + incremental evidence writers + aggregator.
    // Provider calls exactly 0.
    const scripted = scriptedMxLegRecords(runId, shape)
    for (const record of scripted) {
      const plan = mxLegOrder(shape, { runId })[record.legIndex]!
      const begin = machine.beginLeg(plan)
      if (!begin.ok) {
        log(`leg=${mxLegDirName(plan)} refused: ${begin.stop.condition} ${begin.stop.reason}`)
        break
      }
      await writeMxLegEvidence(reportDir, record, scriptedMxObservations(record))
      const scriptedBlock =
        shape.armOrder === 'randomized'
          ? mxBlockArmOrderOf(shape.strategies, runId, plan.task, plan.rep)
          : null
      legIndexEntries.push({
        legIndex: record.legIndex,
        dir: mxLegDirName(plan),
        task: record.task,
        strategy: record.strategy,
        rep: record.rep,
        status: record.status,
        stopCondition: record.stopCondition,
        blockSeed: scriptedBlock?.seedHex ?? null,
        blockArmOrder: scriptedBlock?.arms ?? null
      })
      legRecords.push(record)
      machine.endLeg({
        legIndex: record.legIndex,
        task: record.task,
        strategy: record.strategy,
        rep: record.rep,
        status: record.status,
        // DRY_RUN stand-ins make no provider calls.
        providerCallRecords: 0,
        toolCalls: record.toolCallCount,
        wallClockMs: record.wallClockMs,
        oraclePass: null,
        stopCondition: record.stopCondition
      })
      await writeIncrementalEvidence(false)
    }
  } else {
    // LIVE: ONE strict binding for the WHOLE matrix.
    let prepared: PreparedModelProvider | null = null
    let runtime: ModelRuntime | null = null
    try {
      runtime = await ModelRuntime.create({
        refreshOnCreate: false,
        allowModelNetwork: false
      })
      prepared = await prepareModelProvider(runtime, {
        executionMode: 'experiment-strict',
        runIdentity: runId,
        primaryProviderId: STEP_PLAN_PROVIDER_ID,
        fallbackProviderId: 'none'
      })
      bindingEvidence = {
        safeSelection: safeProviderSelection(prepared.selection),
        experimentBinding: prepared.experimentBinding,
        bindingSharedByLegs: `ALL ${totalLegs} MATRIX LEGS`,
        sourceDerivation: 'live-pi-messages-only'
      }
      log(`binding=${JSON.stringify(bindingEvidence)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      machine.fireMatrixStop(
        'S-1',
        error instanceof ProviderBindingError
          ? message
          : `strict provider preparation failed: ${message}`
      )
    }

    if (!machine.isTerminal && prepared !== null && runtime !== null) {
      for (const plan of mxLegOrder(shape, { runId })) {
        // Operator kill switch between legs: a trip is MATRIX-TERMINAL (S-8).
        // Without this check an operator trip recorded by one Active leg's
        // extension would leave every later Active leg running rewrite-free
        // under the ACTIVE label, silently contaminating the matrix.
        if (
          killSwitchFilePath !== undefined &&
          existsSync(killSwitchFilePath) &&
          !killSwitch.isTripped
        ) {
          killSwitch.trip(`operator kill-switch file present: ${killSwitchFilePath}`)
        }
        if (killSwitch.isTripped) {
          const trip = killSwitch.tripRecord
          machine.fireMatrixStop(
            'S-8',
            `operator kill switch tripped: ${trip?.reason ?? 'unknown reason'} at ${trip?.trippedAt ?? 'unknown time'} — no further legs launched`
          )
          break
        }
        const begin = machine.beginLeg(plan)
        if (!begin.ok) {
          log(`leg=${mxLegDirName(plan)} NOT LAUNCHED: ${begin.stop.condition} ${begin.stop.reason}`)
          continue
        }
        const task = taskForSlot(plan.task)
        let legRecordBase: Omit<MxLegRecord, 'status' | 'stopCondition'> | null = null
        let legObservations: readonly ModelCallObservation[] = []
        let outcome: LegOutcome = { status: 'COMPLETED', stopCondition: null }
        try {
          const leg = await runLiveLeg({
            plan,
            task,
            runId,
            prepared,
            runtime,
            killSwitch,
            killSwitchFilePath
          })
          legRecordBase = leg.legRecord
          legObservations = leg.observations
          // Per-leg manifest budgets, enforced post-hoc at leg end.
          const budgetStop = evaluateMxLegBudgetStop(
            {
              providerCallRecords: leg.legRecord.recordCount,
              toolCalls: leg.legRecord.toolCallCount,
              wallClockMs: leg.legRecord.wallClockMs
            },
            task.budget
          )
          if (budgetStop.stop) {
            outcome = { status: 'FAILED', stopCondition: { condition: 'S-7', reason: budgetStop.reason } }
          } else if (leg.legRecord.replayMismatches > 0) {
            outcome = {
              status: 'FAILED',
              stopCondition: {
                condition: plan.strategy !== 'NATIVE' ? 'S-3' : 'S-2',
                reason: `transition-chain replay mismatch: ${leg.legRecord.replayMismatches}`
              }
            }
          }
          if (plan.strategy !== 'NATIVE') {
            const telemetry = leg.legRecord.interventionTelemetry
            if (telemetry !== undefined) {
              for (const attempt of telemetry.interventions) {
                if (
                  attempt.compositionVerdict === 'FALLBACK_NATIVE' ||
                  attempt.guardVerdict === 'FALLBACK_NATIVE'
                ) {
                  log(
                    `leg=${mxLegDirName(plan)} intervention ${attempt.interventionIndex} FALLBACK_NATIVE (S-5, evidence; leg continues natively): ${attempt.fallbackReason ?? attempt.guardFallbackReason ?? 'UNKNOWN'}`
                  )
                }
              }
            }
          }
        } catch (error) {
          if (error instanceof MxLegDeadlineExceeded) {
            // Evidence-close the partial leg FIRST, then mark it FAILED with
            // the canonical S-9 deadline reason; the matrix CONTINUES.
            legObservations = [...error.executor.base.inMemory.observations]
            outcome = {
              status: 'FAILED',
              stopCondition: { condition: 'S-9', reason: `${LEG_DEADLINE_STOP_REASON} (${error.message})` }
            }
          } else if (error instanceof MxLegObservationError) {
            // Evidence-close the partial leg FIRST, then mark it FAILED.
            legObservations = [...error.executor.base.inMemory.observations]
            const isBoundary = error.failure instanceof MxBoundaryFailure
            outcome = {
              status: 'FAILED',
              stopCondition: {
                condition: isBoundary ? 'S-2' : 'S-9',
                reason: isBoundary
                  ? (error.failure as Error).message
                  : `leg provider failure: ${error.message}`
              }
            }
          } else if (error instanceof MxBoundaryFailure) {
            outcome = { status: 'FAILED', stopCondition: { condition: 'S-2', reason: error.message } }
          } else {
            const message = error instanceof Error ? error.message : String(error)
            outcome = {
              status: 'FAILED',
              stopCondition: { condition: 'S-9', reason: `leg provider failure: ${message}` }
            }
          }
        }

        if (legRecordBase === null) {
          // The leg failed before any record was produced: a minimal record
          // still evidence-closes the leg slot.
          legRecordBase = {
            runId,
            mode: 'LIVE',
            legIndex: plan.legIndex,
            task: plan.task,
            strategy: plan.strategy,
            rep: plan.rep,
            oracleResults: [],
            recordCount: legObservations.length,
            toolCallCount: 0,
            observedTokenEstimateSum: legObservations.reduce(
              (sum, observation) => sum + observation.observedMessageTokenEstimate,
              0
            ),
            wallClockMs: 0,
            replayMismatches: 0,
            trajectory: trajectorySummaryOf(
              legObservations.map((observation) => observation.observedMessageTokenEstimate)
            ),
            fixtureDirRemoved: true
          }
        }
        const legRecord: MxLegRecord = {
          ...legRecordBase,
          status: outcome.status,
          stopCondition: outcome.stopCondition
        }
        // IMMEDIATE per-leg evidence write; matrix continues on leg failure.
        await writeMxLegEvidence(reportDir, legRecord, legObservations)
        const liveBlock =
          shape.armOrder === 'randomized'
            ? mxBlockArmOrderOf(shape.strategies, runId, plan.task, plan.rep)
            : null
        legIndexEntries.push({
          legIndex: legRecord.legIndex,
          dir: mxLegDirName(plan),
          task: legRecord.task,
          strategy: legRecord.strategy,
          rep: legRecord.rep,
          status: legRecord.status,
          stopCondition: legRecord.stopCondition,
          blockSeed: liveBlock?.seedHex ?? null,
          blockArmOrder: liveBlock?.arms ?? null
        })
        legRecords.push(legRecord)
        const primary = legRecord.oracleResults.filter(
          (result) => !result.standIn && result.kind === 'PRIMARY'
        )
        const end = machine.endLeg({
          legIndex: legRecord.legIndex,
          task: legRecord.task,
          strategy: legRecord.strategy,
          rep: legRecord.rep,
          status: legRecord.status,
          providerCallRecords: legRecord.recordCount,
          toolCalls: legRecord.toolCallCount,
          wallClockMs: legRecord.wallClockMs,
          oraclePass: primary.length === 0 ? null : primary.every((result) => result.pass === true),
          stopCondition: legRecord.stopCondition
        })
        if (end.stop) log(`matrix totals stop after leg ${mxLegDirName(plan)}: ${end.reason}`)
        if (legRecord.status === 'FAILED' && legRecord.stopCondition !== null) {
          log(
            `leg=${mxLegDirName(plan)} FAILED (${legRecord.stopCondition.condition}): ${legRecord.stopCondition.reason}; matrix CONTINUES`
          )
        }
        await writeIncrementalEvidence(false)
        if (machine.isTerminal) break
      }
    }
  }

  await writeIncrementalEvidence(true)

  // EVIDENCE ROOT: tamper-evident anchor over the finished run dir (covers
  // every file incl. manifest.json/matrix.json; excludes itself).
  const evidenceRoot = await writeMxEvidenceRoot(reportDir, { repoRoot: REPO_ROOT })
  log(`evidence-root legsRoot=${evidenceRoot.legsRoot.slice(0, 16)} commit=${evidenceRoot.codeCommit ?? 'null'}`)

  const ledgers = machine.ledgers()
  const terminalStop = machine.stopsFired[0]
  const status: MxStatus = terminalStop !== undefined ? 'STOPPED' : mode === 'DRY_RUN' ? 'DRY_RUN_COMPLETE' : 'EXECUTED'
  const providerCalls = mode === 'LIVE' ? ledgers.providerCallRecordsTotal : 0

  // Oracle pass counts over legs whose REAL (non-stand-in) primary oracle ran.
  const oraclePassOf = (strategy: MxStrategy): { pass: number; evaluated: number } => {
    let pass = 0
    let evaluated = 0
    for (const record of legRecords.filter((candidate) => candidate.strategy === strategy)) {
      const primary = record.oracleResults.filter(
        (result) => !result.standIn && result.kind === 'PRIMARY'
      )
      if (primary.length === 0) continue
      evaluated += 1
      if (primary.every((result) => result.pass === true)) pass += 1
    }
    return { pass, evaluated }
  }
  const nativeOracle = oraclePassOf('NATIVE')
  const activeV2Oracle = oraclePassOf('ACTIVE_V2')
  const activeV3Oracle = oraclePassOf('ACTIVE_V3')
  const activeV4Oracle = oraclePassOf('ACTIVE_V4')

  log(`runId=${runId} mode=${mode} status=${status} legs=${ledgers.legsAttempted}/${totalLegs}`)
  log(`provider-call records=${providerCalls} wallClockMs=${ledgers.runElapsedMs}`)
  for (const stop of machine.stopsFired) {
    log(`stop ${stop.condition} (MATRIX): ${stop.reason}`)
  }
  for (const cell of aggregateMxCells(legRecords.map(mxLegAnalysisInputOf))) {
    log(mxCellOneLiner(cell))
  }
  log(`report=${reportDir}`)
  console.log(`MX_STATUS=${status}`)
  console.log(`MX_PROVIDER_CALLS=${providerCalls}`)
  console.log(`MX_LEGS=${ledgers.legsAttempted}/${totalLegs}`)
  console.log(`MX_ORACLE_PASS_NATIVE=${nativeOracle.pass}/${nativeOracle.evaluated}`)
  console.log(`MX_ORACLE_PASS_ACTIVE_V2=${activeV2Oracle.pass}/${activeV2Oracle.evaluated}`)
  console.log(`MX_ORACLE_PASS_ACTIVE_V3=${activeV3Oracle.pass}/${activeV3Oracle.evaluated}`)
  console.log(`MX_ORACLE_PASS_ACTIVE_V4=${activeV4Oracle.pass}/${activeV4Oracle.evaluated}`)
  console.log(`MX_REPORT_DIR=${reportDir}`)
  if (status === 'STOPPED') {
    process.exit(1)
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[cr004-mx] FAILED: ${message}`)
    console.error('MX_STATUS=FAILED')
    process.exit(1)
  })
