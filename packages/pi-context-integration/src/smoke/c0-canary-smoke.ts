import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ContextEvent,
  type ExtensionAPI
} from '@earendil-works/pi-coding-agent'
import { JsonlObservationSink } from '@canvas-agent/context-runtime'
import { runC0PromptWithDeadline } from './c0-prompt-deadline'
import {
  C0_BUDGETS,
  C0_CORPUS_MANIFEST_ID,
  C0_POLICY_VERSION,
  C0_SCENARIOS,
  C0ScenarioExecutor,
  c0CorpusManifestHash,
  evaluateC0StopConditions,
  finalizeScenarioRun,
  isValidC0RunId,
  parseC0ScenarioSubset,
  providerCallBudgetExhausted,
  runScriptedTurns,
  suggestC0RunId,
  turnScriptedObservations,
  type C0ScenarioDefinition,
  type C0ScenarioId,
  type C0ScenarioRunResult,
  type C0StopConditionId
} from './c0-scenarios'
import {
  ProviderBindingError,
  prepareModelProvider,
  safeProviderSelection,
  type PreparedModelProvider
} from '../index'
import { handleC0ContextBoundary } from './c0-boundary-guard'
import {
  abortC0SessionWithinGrace,
  installC0OperatorKillSwitch,
  type C0AbortOutcome,
  type C0AbortableSession,
  type C0OperatorSignal
} from './c0-kill-switch'
import { C0ProviderTransportGuard } from './c0-provider-transport'
import { claimSingleUseC0ReportDir } from './c0-report-directory'
import { C0ProviderUsageLedger, type C0ProviderUsageSummary } from './c0-provider-usage'

// CSPV-C0 canary runner (docs/plan/cspv-c0-run-contract-2026-08-27.md).
//
// LIVE mode (Lead-operated only) requires ALL of:
//   CANVAS_CONTEXT_LIVE_SMOKE=1
//   CANVAS_PROVIDER_EXECUTION_MODE=experiment-strict
//   CANVAS_PROVIDER_RUN_ID=c0-<ISO-date>-<8-hex>   (single-use, fresh)
//   STEP_PLAN_API_KEY=<key>                        (never recorded)
//
// Strict binding to step-plan/step-3.7-flash with NO fallback happens before
// the first model call; any provider failure after execution starts is
// terminal. Live provider calls are counted at the outbound transport seam,
// while observer model-call records remain separate (one prompt can yield
// multiple records). Three operational hard budgets (4 scenario runs / 48
// provider calls / 60 min wall clock) fail closed via S-1..S-8. Token/cost
// remains an unresolved contract item; LIVE mode refuses to start until its
// provider-reported usage semantics and ceiling are explicitly resolved.
// Evidence collected so far is always preserved. Output is metadata-only.
//
// DRY_RUN mode (CANVAS_C0_DRY_RUN=1) proves the whole pipeline with ZERO
// provider calls: no ModelRuntime, no prepareModelProvider, no session.
// Universe revisions are derived from scripted deterministic messages through
// the SAME observation seam; providerCalls is exactly 0.
//
// Evidence: research/context-benchmarks/reports/cspv-c0/<runId>/
//   observations.jsonl  transitions.jsonl  decisions.jsonl  usage.jsonl  binding.json
//   manifest.json (transitions.json and verdicts.json remain supplementary
//   human-readable summaries for backwards-compatible local inspection.)

const REPORTS_ROOT = resolve(
  process.cwd(),
  '..',
  '..',
  'research',
  'context-benchmarks',
  'reports',
  'cspv-c0'
)
const STEP_PLAN_PROVIDER_ID = 'step-plan'
const C0_CONTRACT_PATH = 'docs/plan/cspv-c0-run-contract-2026-08-27.md'
const C0_USAGE_CONTRACT_PATH = 'docs/plan/cspv-c0-provider-usage-contract-2026-09-01.md'
const REPO_ROOT = resolve(process.cwd(), '..', '..')

type C0Status = 'EXECUTED' | 'DRY_RUN_COMPLETE' | 'STOPPED' | 'FAILED'
type C0Mode = 'LIVE' | 'DRY_RUN'

interface FiredStopCondition {
  readonly condition: C0StopConditionId
  readonly reason: string
}

interface RunLedgers {
  providerCallRecords: number
  scenarioRunsCompleted: number
  elapsedMs: number
  replayMismatches: number
  mandatoryEvictions: number
  unexplainedDecisions: number
  orphanRehydrates: number
}

interface C0ActiveSession extends C0AbortableSession {
  dispose(): void
}

function log(message: string): void {
  console.log(`[c0] ${message}`)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

interface C0FinalEvidenceInput {
  readonly reportDir: string
  readonly runId: string
  readonly mode: C0Mode
  readonly status: C0Status
  readonly startedAt: Date
  readonly finishedAt: Date
  readonly wallClockMs: number
  readonly state: {
    readonly scenarioRunsCompleted: number
    readonly providerCallRecords: number
  }
  readonly providerCalls: number
  readonly bindingEvidence: Record<string, unknown> | null
  readonly firedStops: readonly FiredStopCondition[]
  readonly scenarios: readonly C0ScenarioDefinition[]
  readonly scenarioResults: ReadonlyMap<C0ScenarioId, C0ScenarioRunResult>
  readonly providerCallsByScenario: ReadonlyMap<C0ScenarioId, number>
  readonly operatorAbortOutcome: C0AbortOutcome | null
  readonly runnerFailureMessage: string | null
  readonly identityEvidence: C0IdentityEvidence
  readonly providerUsageRecords: readonly Record<string, unknown>[]
  readonly providerUsageSummary: C0ProviderUsageSummary
}

interface C0FinalEvidenceResult {
  readonly failedArtifacts: readonly string[]
}

interface C0IdentityEvidence {
  readonly corpusManifestId: string
  readonly corpusManifestHash: string
  readonly contractPath: string
  readonly contractSha256: string
  readonly providerUsageContractPath: string
  readonly providerUsageContractSha256: string
}

async function loadC0IdentityEvidence(): Promise<C0IdentityEvidence> {
  const [contractContent, providerUsageContractContent] = await Promise.all([
    readFile(join(REPO_ROOT, C0_CONTRACT_PATH), 'utf8'),
    readFile(join(REPO_ROOT, C0_USAGE_CONTRACT_PATH), 'utf8')
  ])
  return {
    corpusManifestId: C0_CORPUS_MANIFEST_ID,
    corpusManifestHash: c0CorpusManifestHash(),
    contractPath: C0_CONTRACT_PATH,
    contractSha256: createHash('sha256').update(contractContent, 'utf8').digest('hex'),
    providerUsageContractPath: C0_USAGE_CONTRACT_PATH,
    providerUsageContractSha256: createHash('sha256')
      .update(providerUsageContractContent, 'utf8')
      .digest('hex')
  }
}

/**
 * Finalize all run-level evidence independently. A failure writing one
 * artifact must not prevent the manifest from recording that failure or the
 * remaining artifacts from being attempted.
 */
async function writeC0FinalEvidence(input: C0FinalEvidenceInput): Promise<C0FinalEvidenceResult> {
  const failedArtifacts: string[] = []
  const writeArtifact = async (name: string, build: () => unknown): Promise<void> => {
    try {
      await writeJson(join(input.reportDir, name), build())
    } catch (error) {
      failedArtifacts.push(name)
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[c0] evidence write FAILED (${name}): ${message}`)
    }
  }
  const verdictOf = (id: C0ScenarioId): string =>
    input.scenarioResults.get(id)?.scenarioVerdict ?? 'NOT_OBSERVED'

  const writeJsonLines = async (
    name: string,
    rows: readonly Record<string, unknown>[]
  ): Promise<void> => {
    try {
      const content = rows.map((row) => JSON.stringify(row)).join('\n')
      await writeFile(join(input.reportDir, name), content.length > 0 ? `${content}\n` : '', 'utf8')
    } catch (error) {
      failedArtifacts.push(name)
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[c0] evidence write FAILED (${name}): ${message}`)
    }
  }

  const transitionRows = [...input.scenarioResults.values()].flatMap((result) =>
    result.boundaries.map((boundary) => ({
      runId: input.runId,
      scenarioId: result.scenarioId,
      ...boundary
    }))
  )
  const decisionRows = [...input.scenarioResults.values()].flatMap((result) =>
    result.records.map((record) => ({
      runId: input.runId,
      scenarioId: result.scenarioId,
      ...record
    }))
  )

  await writeJsonLines('transitions.jsonl', transitionRows)
  await writeJsonLines('decisions.jsonl', decisionRows)
  await writeJsonLines('usage.jsonl', input.providerUsageRecords)

  await writeArtifact('binding.json', () =>
    input.mode === 'LIVE'
      ? {
          runId: input.runId,
          mode: input.mode,
          binding: input.bindingEvidence
        }
      : {
          runId: input.runId,
          mode: input.mode,
          binding: null,
          providerCalls: 0,
          note: 'DRY_RUN: no provider binding or ModelRuntime session'
        }
  )

  await writeArtifact('transitions.json', () => ({
    runId: input.runId,
    mode: input.mode,
    scenarios: [...input.scenarioResults.values()].map((result) => ({
      scenarioId: result.scenarioId,
      runtimeSessionId: result.runtimeSessionId,
      boundaries: result.boundaries,
      decisions: result.records,
      chain: result.chain,
      finalActiveSourceKeys: result.finalActiveSourceKeys
    }))
  }))

  await writeArtifact('verdicts.json', () => ({
    runId: input.runId,
    mode: input.mode,
    overall: {
      scenariosPass: [...input.scenarioResults.values()].filter(
        (result) => result.scenarioVerdict === 'PASS'
      ).length,
      scenariosFail: [...input.scenarioResults.values()].filter(
        (result) => result.scenarioVerdict === 'FAIL'
      ).length,
      scenariosNotObserved: input.scenarios.length - input.scenarioResults.size,
      providerCalls: input.providerCalls,
      stopConditionsFired: input.firedStops
    },
    scenarios: C0_SCENARIOS.map((scenario) => {
      const result = input.scenarioResults.get(scenario.id)
      if (result === undefined) {
        return {
          scenarioId: scenario.id,
          name: scenario.name,
          scenarioVerdict: 'NOT_OBSERVED' as const,
          reason: 'scenario not reached before terminal stop'
        }
      }
      return {
        scenarioId: scenario.id,
        name: scenario.name,
        scenarioVerdict: result.scenarioVerdict,
        chainSatisfied: result.chainSatisfied,
        chainFailures: result.chainFailures,
        replayMismatches: result.replayMismatchCount,
        providerCalls: input.providerCallsByScenario.get(scenario.id) ?? 0,
        evaluator: {
          overall: result.evaluator.overall,
          criteria: result.evaluator.criteria,
          counts: result.evaluator.counts
        }
      }
    })
  }))

  const manifestStatus: C0Status = failedArtifacts.length > 0 ? 'FAILED' : input.status
  await writeArtifact('manifest.json', () => ({
    runId: input.runId,
    mode: input.mode,
    status: manifestStatus,
    contract: input.identityEvidence.contractPath,
    contractSha256: input.identityEvidence.contractSha256,
    providerUsageContract: input.identityEvidence.providerUsageContractPath,
    providerUsageContractSha256: input.identityEvidence.providerUsageContractSha256,
    corpusManifestId: input.identityEvidence.corpusManifestId,
    corpusManifestHash: input.identityEvidence.corpusManifestHash,
    policyVersion: C0_POLICY_VERSION,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    wallClockMs: input.wallClockMs,
    budgets: C0_BUDGETS,
    ledgers: {
      scenarioRunsCompleted: input.state.scenarioRunsCompleted,
      providerCallRecords: input.state.providerCallRecords,
      providerCalls: input.providerCalls
    },
    provider:
      input.mode === 'LIVE'
        ? input.bindingEvidence
        : {
            binding: null,
            providerCalls: 0,
            note: 'DRY_RUN: no ModelRuntime, no prepareModelProvider, no session; scripted deterministic messages',
            sourceDerivation: 'scripted-messages'
          },
    providerUsage: input.providerUsageSummary,
    stopConditionsFired: input.firedStops,
    ...(input.operatorAbortOutcome !== null ? { operatorAbort: input.operatorAbortOutcome } : {}),
    ...(input.runnerFailureMessage !== null
      ? { runnerFailure: 'unexpected C0 runner exception' }
      : {}),
    ...(failedArtifacts.length > 0 ? { evidenceWriteFailures: failedArtifacts } : {}),
    scenariosRequested: input.scenarios.map((scenario) => scenario.id),
    scenarioVerdicts: Object.fromEntries(
      C0_SCENARIOS.map((scenario) => [scenario.id, verdictOf(scenario.id)])
    )
  }))

  return { failedArtifacts }
}

function ledgersOf(state: {
  providerCallRecords: number
  scenarioRunsCompleted: number
  startedAtMs: number
  replayMismatches: number
  mandatoryEvictions: number
  unexplainedDecisions: number
  orphanRehydrates: number
}): RunLedgers {
  return {
    providerCallRecords: state.providerCallRecords,
    scenarioRunsCompleted: state.scenarioRunsCompleted,
    elapsedMs: Date.now() - state.startedAtMs,
    replayMismatches: state.replayMismatches,
    mandatoryEvictions: state.mandatoryEvictions,
    unexplainedDecisions: state.unexplainedDecisions,
    orphanRehydrates: state.orphanRehydrates
  }
}

function c0ExtensionFactory(
  executor: C0ScenarioExecutor,
  fireStop: (condition: C0StopConditionId, reason: string) => void,
  shouldStop: () => boolean
) {
  return (pi: ExtensionAPI): void => {
    pi.on('context', async (event: ContextEvent, context) => {
      // The boundary helper explicitly calls context.abort(): Pi's extension
      // runner records and swallows handler exceptions, so throwing here would
      // not stop a prompt burst before another provider request.
      return handleC0ContextBoundary(executor, event.messages, context, fireStop, shouldStop)
    })
  }
}

async function runLiveScenario(
  scenario: C0ScenarioDefinition,
  runId: string,
  prepared: PreparedModelProvider,
  runtime: ModelRuntime,
  state: {
    providerCallRecords: number
    startedAtMs: number
    replayMismatches: number
  },
  fireStop: (condition: C0StopConditionId, reason: string) => void,
  shouldStop: () => boolean,
  transport: C0ProviderTransportGuard,
  setActiveSession: (session: C0ActiveSession) => void,
  clearActiveSession: (session: C0ActiveSession) => void,
  operatorKillPromise: Promise<C0OperatorSignal>,
  usageLedger: C0ProviderUsageLedger
): Promise<C0ScenarioExecutor | null> {
  const fixtureDir = await mkdtemp(join(tmpdir(), `canvas-c0-${scenario.id.toLowerCase()}-`))
  let disposeSession: (() => void) | undefined
  try {
    for (const file of scenario.fixtureFiles ?? []) {
      const path = join(fixtureDir, file.path)
      await mkdir(resolve(path, '..'), { recursive: true })
      await writeFile(path, file.content, 'utf8')
    }
    const executor = new C0ScenarioExecutor({
      runtimeSessionId: `${runId}:${scenario.id.toLowerCase()}`
    })
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
          name: 'canvas-c0-canary',
          factory: c0ExtensionFactory(executor, fireStop, shouldStop)
        }
      ]
    })
    await loader.reload()
    const { session } = await createAgentSession({
      cwd: fixtureDir,
      model: prepared.model,
      modelRuntime: runtime,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(fixtureDir),
      settingsManager,
      tools: ['read']
    })
    setActiveSession(session)
    let currentTurnLabel = 'unstarted'
    const unsubscribeUsage = session.subscribe((event) => {
      if (event.type !== 'message_end' || event.message.role !== 'assistant') return
      usageLedger.recordAssistantMessage({
        runId,
        scenarioId: scenario.id,
        turnLabel: currentTurnLabel,
        message: event.message
      })
    })
    disposeSession = () => {
      unsubscribeUsage()
      clearActiveSession(session)
      session.dispose()
    }

    let reportedReplayMismatches = 0
    const syncLiveLedgers = (): void => {
      state.providerCallRecords = transport.providerCalls
      const currentReplayMismatches = executor.replayMismatchCount
      const newReplayMismatches = currentReplayMismatches - reportedReplayMismatches
      if (newReplayMismatches > 0) {
        state.replayMismatches += newReplayMismatches
      }
      reportedReplayMismatches = currentReplayMismatches
    }

    for (const turn of scenario.turns) {
      if (shouldStop()) return executor
      syncLiveLedgers()
      if (providerCallBudgetExhausted(state.providerCallRecords)) {
        fireStop(
          'S-7',
          `provider-call budget exhausted before turn ${turn.label}: ${state.providerCallRecords} records`
        )
        return executor
      }
      const remainingWallClockMs = C0_BUDGETS.maxWallClockMs - (Date.now() - state.startedAtMs)
      if (remainingWallClockMs <= 0) {
        fireStop(
          'S-7',
          `wall-clock budget exhausted before turn ${turn.label}: ${C0_BUDGETS.maxWallClockMs}ms`
        )
        return executor
      }
      currentTurnLabel = turn.label
      executor.beginTurn(turn)
      const scripted = turnScriptedObservations(scenario, turn, new Date().toISOString())
      if (scripted.length > 0) executor.queueExternalObservations(scripted)
      const recordsBefore = executor.observationCount
      log(`scenario=${scenario.id} turn=${turn.label} prompt issued`)
      try {
        const promptPromise = runC0PromptWithDeadline(
          session,
          turn.prompt,
          remainingWallClockMs,
          () =>
            fireStop(
              'S-7',
              `wall-clock budget exhausted during turn ${turn.label}: ${C0_BUDGETS.maxWallClockMs}ms`
            )
        )
        const promptOutcome = await Promise.race([
          promptPromise,
          operatorKillPromise.then(() => null)
        ])
        if (promptOutcome === null) {
          // The signal handler already marked the run terminal and started the
          // bounded session abort. Do not wait on a provider/prompt promise
          // that may be stuck behind a broken abort channel.
          void promptPromise.catch(() => undefined)
          syncLiveLedgers()
          return executor
        }
        if (promptOutcome.status === 'TIMED_OUT') {
          if (promptOutcome.abortErrorMessage !== undefined) {
            log(
              `scenario=${scenario.id} turn=${turn.label} deadline abort error=${promptOutcome.abortErrorMessage}`
            )
          }
          syncLiveLedgers()
          return executor
        }
      } catch (error) {
        syncLiveLedgers()
        if (!shouldStop()) {
          const message = error instanceof Error ? error.message : String(error)
          fireStop('S-1', `provider failure after execution started: ${message}`)
        }
        return executor
      }
      syncLiveLedgers()
      const newRecords = executor.observationCount - recordsBefore
      log(
        `scenario=${scenario.id} turn=${turn.label} observer-records=${newRecords} providerCalls=${state.providerCallRecords}`
      )
      const safetyStop = executor.currentSafetyStop()
      if (safetyStop.stop) {
        fireStop(safetyStop.condition, safetyStop.reason)
        return executor
      }
      const stop = evaluateC0StopConditions(
        ledgersOf({
          ...state,
          scenarioRunsCompleted: 0,
          mandatoryEvictions: 0,
          unexplainedDecisions: 0,
          orphanRehydrates: 0
        })
      )
      if (stop.stop) {
        fireStop(stop.condition, stop.reason)
        return executor
      }
    }
    return executor
  } finally {
    try {
      disposeSession?.()
    } finally {
      await rm(fixtureDir, { recursive: true, force: true })
    }
  }
}

async function run(): Promise<void> {
  const dryRun = process.env['CANVAS_C0_DRY_RUN'] === '1'

  if (!dryRun && process.env['CANVAS_CONTEXT_LIVE_SMOKE'] !== '1') {
    console.log('[c0] CANVAS_CONTEXT_LIVE_SMOKE=1 (or CANVAS_C0_DRY_RUN=1) is required. SKIPPED')
    console.log('C0_STATUS=SKIPPED')
    return
  }

  const mode: C0Mode = dryRun ? 'DRY_RUN' : 'LIVE'

  let identityEvidence: C0IdentityEvidence
  try {
    identityEvidence = await loadC0IdentityEvidence()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[c0] REFUSED: C0 identity evidence unavailable: ${message}`)
    console.error('C0_STATUS=FAILED')
    process.exit(1)
    return
  }

  if (!dryRun) {
    if (C0_BUDGETS.maxTokenCostUsd === null) {
      console.error(
        '[c0] REFUSED: token/cost hard budget is unresolved; Lead must confirm provider-reported usage and pricing before live execution.'
      )
      console.error('C0_STATUS=FAILED')
      process.exit(1)
    }
    if (process.env['CANVAS_PROVIDER_EXECUTION_MODE'] !== 'experiment-strict') {
      console.error(
        '[c0] REFUSED: CANVAS_PROVIDER_EXECUTION_MODE=experiment-strict is required for the C0 canary.'
      )
      console.error('C0_STATUS=FAILED')
      process.exit(1)
    }
    if (!isValidC0RunId(process.env['CANVAS_PROVIDER_RUN_ID'])) {
      console.error('[c0] REFUSED: CANVAS_PROVIDER_RUN_ID must match /^c0-\\d{8}-[0-9a-f]{8}$/.')
      console.error(`[c0] SUGGESTED_CANVAS_PROVIDER_RUN_ID=${suggestC0RunId()}`)
      console.error(
        '[c0] Export the suggested fresh identity explicitly; run identities are single-use.'
      )
      console.error('C0_STATUS=FAILED')
      process.exit(1)
    }
    if (
      process.env['STEP_PLAN_API_KEY'] === undefined ||
      process.env['STEP_PLAN_API_KEY'].length === 0
    ) {
      console.error('[c0] REFUSED: STEP_PLAN_API_KEY is required in live mode.')
      console.error('C0_STATUS=FAILED')
      process.exit(1)
    }
  }

  const envRunId = process.env['CANVAS_PROVIDER_RUN_ID']
  const runId = isValidC0RunId(envRunId) ? envRunId : suggestC0RunId()
  if (!isValidC0RunId(envRunId)) {
    log(`DRY_RUN generated run identity ${runId} (no provider binding occurs in DRY_RUN)`)
  }

  let reportDir: string
  try {
    reportDir = await claimSingleUseC0ReportDir(REPORTS_ROOT, runId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[c0] REFUSED: ${message}`)
    console.error('C0_STATUS=FAILED')
    process.exit(1)
  }
  const sink = new JsonlObservationSink({
    directory: reportDir,
    sessionId: 'observations'
  })

  const startedAt = new Date()
  const state = {
    providerCallRecords: 0,
    scenarioRunsCompleted: 0,
    startedAtMs: startedAt.getTime(),
    replayMismatches: 0,
    mandatoryEvictions: 0,
    unexplainedDecisions: 0,
    orphanRehydrates: 0
  }
  const firedStops: FiredStopCondition[] = []
  const scenarioResults = new Map<C0ScenarioId, C0ScenarioRunResult>()
  const providerCallsByScenario = new Map<C0ScenarioId, number>()
  const providerUsageLedger = new C0ProviderUsageLedger()
  let terminal = false
  const fireStop = (condition: C0StopConditionId, reason: string): void => {
    terminal = true
    const duplicate = firedStops.some(
      (fired) => fired.condition === condition && fired.reason === reason
    )
    if (!duplicate) {
      firedStops.push({ condition, reason })
    }
    console.error(`C0_STOP_CONDITION=${condition}`)
    console.error(`[c0] terminal stop: ${condition} ${reason}`)
  }
  const shouldStop = (): boolean => terminal

  let activeSession: C0ActiveSession | null = null
  let operatorAbortPromise: Promise<void> | null = null
  let operatorAbortOutcome: C0AbortOutcome | null = null
  const setActiveSession = (session: C0ActiveSession): void => {
    activeSession = session
  }
  const clearActiveSession = (session: C0ActiveSession): void => {
    if (activeSession === session) activeSession = null
  }
  const abortActiveSession = (): void => {
    if (activeSession === null || operatorAbortPromise !== null) return
    const session = activeSession
    operatorAbortPromise = abortC0SessionWithinGrace(session)
      .then((outcome) => {
        operatorAbortOutcome = outcome
        if (outcome.status !== 'SETTLED') {
          log(`operator abort outcome=${outcome.status} ${outcome.errorMessage}`)
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        operatorAbortOutcome = { status: 'REJECTED', errorMessage: message }
        log(`operator abort outcome=REJECTED ${message}`)
      })
  }
  const operatorKillSwitch = installC0OperatorKillSwitch((signal) => {
    fireStop('S-8', `operator kill-switch invoked by ${signal}`)
    abortActiveSession()
  })

  let prepared: PreparedModelProvider | null = null
  let runtime: ModelRuntime | null = null
  let bindingEvidence: Record<string, unknown> | null = null
  let transport: C0ProviderTransportGuard | null = null
  let runnerFailureMessage: string | null = null
  let status: C0Status = mode === 'DRY_RUN' ? 'DRY_RUN_COMPLETE' : 'EXECUTED'
  let evidenceWriteFailed = false
  let scenarios: readonly C0ScenarioDefinition[] = []

  try {
    if (mode === 'LIVE') {
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
          sourceDerivation: 'queued-external-script + live-pi-messages'
        }
        try {
          transport = new C0ProviderTransportGuard({
            providerBaseUrl: prepared.model.baseUrl,
            maxCalls: C0_BUDGETS.maxProviderCalls,
            shouldBlock: shouldStop,
            onBudgetExhausted: (attemptedCall) => {
              fireStop(
                'S-7',
                `provider-call budget exhausted before outbound request ${attemptedCall}; maximum is ${C0_BUDGETS.maxProviderCalls}`
              )
            }
          })
          transport.install()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          fireStop('S-1', `provider transport guard setup failed: ${message}`)
        }
        log(`binding=${JSON.stringify(bindingEvidence)}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isBindingFailure = error instanceof ProviderBindingError
        fireStop(
          'S-1',
          isBindingFailure ? message : `strict provider preparation failed: ${message}`
        )
      }
    }

    const subset = parseC0ScenarioSubset(process.env['CANVAS_C0_ONLY'])
    if (subset.error !== undefined) {
      throw new Error(`invalid C0 scenario subset: ${subset.error}`)
    }
    scenarios = subset.scenarios
    if (scenarios.length < C0_SCENARIOS.length) {
      log(
        `scenario subset requested via CANVAS_C0_ONLY: ${scenarios
          .map((scenario) => scenario.id)
          .join(',')}`
      )
    }

    for (const scenario of scenarios) {
      if (shouldStop()) break
      if (state.scenarioRunsCompleted >= C0_BUDGETS.maxScenarioRuns) {
        fireStop(
          'S-7',
          `scenario-run budget exhausted: ${state.scenarioRunsCompleted} >= ${C0_BUDGETS.maxScenarioRuns}`
        )
        break
      }

      let executor: C0ScenarioExecutor | null = null
      const providerCallsBeforeScenario = transport?.providerCalls ?? state.providerCallRecords
      try {
        if (mode === 'LIVE' && prepared !== null && runtime !== null && transport !== null) {
          executor = await runLiveScenario(
            scenario,
            runId,
            prepared,
            runtime,
            state,
            fireStop,
            shouldStop,
            transport,
            setActiveSession,
            clearActiveSession,
            operatorKillSwitch.whenKilled,
            providerUsageLedger
          )
        } else if (mode === 'DRY_RUN') {
          executor = new C0ScenarioExecutor({
            runtimeSessionId: `${runId}:${scenario.id.toLowerCase()}-dry`
          })
          runScriptedTurns(scenario, executor)
          state.replayMismatches += executor.replayMismatchCount
        } else {
          fireStop('S-1', 'live scenario requested without a prepared provider binding')
          break
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        fireStop('S-2', `unexpected planner/observation error: ${message}`)
      }

      if (executor === null) break
      for (const observation of executor.base.inMemory.observations) sink.write(observation)
      await sink.flush()

      const result = finalizeScenarioRun(scenario, executor)
      scenarioResults.set(scenario.id, result)
      providerCallsByScenario.set(
        scenario.id,
        mode === 'LIVE' && transport !== null
          ? transport.providerCalls - providerCallsBeforeScenario
          : 0
      )
      state.scenarioRunsCompleted += 1
      state.mandatoryEvictions += result.evaluator.counts.mandatoryEvictions
      state.unexplainedDecisions += result.evaluator.counts.unexplainedDecisions
      state.orphanRehydrates += result.evaluator.counts.orphanRehydrates

      if (result.stopCondition !== null) {
        fireStop(result.stopCondition.condition, result.stopCondition.reason)
      }
      const stop = evaluateC0StopConditions(ledgersOf(state))
      if (stop.stop) {
        fireStop(stop.condition, stop.reason)
      }

      log(
        `scenario=${scenario.id} verdict=${result.scenarioVerdict} chain=${result.chainSatisfied ? 'SATISFIED' : 'DIVERGED'} remove=${result.evaluator.counts.removeObserved} rehydrate=${result.evaluator.counts.rehydrateObserved} evaluator=${result.evaluator.overall}`
      )
      for (const failure of result.chainFailures) {
        log(`scenario=${scenario.id} chain-failure: ${failure}`)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    runnerFailureMessage = message
    if (!terminal) fireStop('S-2', `unexpected C0 runner failure: ${message}`)
  } finally {
    try {
      operatorKillSwitch.dispose()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      runnerFailureMessage ??= `operator kill-switch cleanup failed: ${message}`
    }
    if (operatorAbortPromise !== null) await operatorAbortPromise
    const sessionToCleanUp = activeSession as C0ActiveSession | null
    if (sessionToCleanUp !== null) {
      let cleanupOutcome: C0AbortOutcome
      try {
        cleanupOutcome = await abortC0SessionWithinGrace(sessionToCleanUp)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        cleanupOutcome = { status: 'REJECTED', errorMessage: message }
        runnerFailureMessage ??= `active session abort failed: ${message}`
      }
      if (operatorAbortOutcome === null) operatorAbortOutcome = cleanupOutcome
      try {
        sessionToCleanUp.dispose()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        runnerFailureMessage ??= `active session cleanup failed: ${message}`
      }
      activeSession = null
    }
    try {
      transport?.restore()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      runnerFailureMessage ??= `provider transport restoration failed: ${message}`
    }

    if (runnerFailureMessage !== null) {
      status = 'FAILED'
    } else if (terminal) {
      status = 'STOPPED'
    }
    const finishedAt = new Date()
    const wallClockMs = finishedAt.getTime() - startedAt.getTime()
    const providerCalls = mode === 'LIVE' ? state.providerCallRecords : 0
    let finalEvidence: C0FinalEvidenceResult = { failedArtifacts: [] }
    try {
      const usageSummary = providerUsageLedger.summary()
      finalEvidence = await writeC0FinalEvidence({
        reportDir,
        runId,
        mode,
        status,
        startedAt,
        finishedAt,
        wallClockMs,
        state,
        providerCalls,
        bindingEvidence,
        firedStops,
        scenarios,
        scenarioResults,
        providerCallsByScenario,
        operatorAbortOutcome,
        runnerFailureMessage,
        identityEvidence,
        providerUsageRecords: providerUsageLedger.records.map((record) => ({
          ...record
        })),
        providerUsageSummary:
          mode === 'DRY_RUN' ? { ...usageSummary, status: 'NOT_APPLICABLE' } : usageSummary
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      runnerFailureMessage ??= `final evidence finalization failed: ${message}`
      console.error(`[c0] final evidence finalization FAILED: ${message}`)
    }
    evidenceWriteFailed = finalEvidence.failedArtifacts.length > 0 || runnerFailureMessage !== null

    const verdictOf = (id: C0ScenarioId): string =>
      scenarioResults.get(id)?.scenarioVerdict ?? 'NOT_OBSERVED'
    log(`runId=${runId} mode=${mode} scenarios=${scenarioResults.size}/${scenarios.length}`)
    log(
      `provider-call records=${state.providerCallRecords} providerCalls=${providerCalls} wallClockMs=${wallClockMs}`
    )
    log(`report=${reportDir}`)
    console.log(`C0_STATUS=${evidenceWriteFailed ? 'FAILED' : status}`)
    console.log(`C0_PROVIDER_CALLS=${providerCalls}`)
    for (const scenario of C0_SCENARIOS) {
      console.log(`C0_VERDICT_${scenario.id}=${verdictOf(scenario.id)}`)
    }
    console.log(`C0_REPORT_DIR=${reportDir}`)
    if (terminal || evidenceWriteFailed || runnerFailureMessage !== null) {
      process.exit(1)
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[c0] FAILED: ${message}`)
    console.error('C0_STATUS=FAILED')
    process.exit(1)
  })
