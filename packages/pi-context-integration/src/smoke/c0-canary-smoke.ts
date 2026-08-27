import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
import {
  C0_BUDGETS,
  C0_POLICY_VERSION,
  C0_SCENARIOS,
  C0ScenarioExecutor,
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
// terminal. Provider calls are counted as observer model-call records, not
// prompts (one prompt can yield multiple records). Four hard budgets
// (4 scenario runs / 12 provider calls / 60 min wall clock; token cost is
// Lead-tracked) fail closed via S-1..S-8, and evidence collected so far is
// always preserved. Output is metadata-only.
//
// DRY_RUN mode (CANVAS_C0_DRY_RUN=1) proves the whole pipeline with ZERO
// provider calls: no ModelRuntime, no prepareModelProvider, no session.
// Universe revisions are derived from scripted deterministic messages through
// the SAME observation seam; providerCalls is exactly 0.
//
// Evidence: research/context-benchmarks/reports/cspv-c0/<runId>/
//   observations.jsonl  transitions.json  verdicts.json  manifest.json

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

// Wraps executor failures so a planner/validation error inside the Pi context
// callback is distinguishable from a provider transport failure (S-2 vs S-1).
class C0BoundaryFailure extends Error {
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    super(`C0 boundary failure: ${message}`)
    this.name = 'C0BoundaryFailure'
  }
}

function log(message: string): void {
  console.log(`[c0] ${message}`)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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

function c0ExtensionFactory(executor: C0ScenarioExecutor) {
  return (pi: ExtensionAPI): void => {
    pi.on('context', async (event: ContextEvent) => {
      try {
        executor.observeBoundary(event.messages)
      } catch (error) {
        throw new C0BoundaryFailure(error)
      }
      return { messages: event.messages }
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
  shouldStop: () => boolean
): Promise<C0ScenarioExecutor | null> {
  const fixtureDir = await mkdtemp(join(tmpdir(), `canvas-c0-${scenario.id.toLowerCase()}-`))
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
        { name: 'canvas-c0-canary', factory: c0ExtensionFactory(executor) }
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

    for (const turn of scenario.turns) {
      if (shouldStop()) return executor
      if (providerCallBudgetExhausted(state.providerCallRecords)) {
        fireStop(
          'S-7',
          `provider-call budget exhausted before turn ${turn.label}: ${state.providerCallRecords} records`
        )
        return executor
      }
      executor.beginTurn(turn)
      const scripted = turnScriptedObservations(scenario, turn, new Date().toISOString())
      if (scripted.length > 0) executor.queueExternalObservations(scripted)
      const recordsBefore = executor.observationCount
      log(`scenario=${scenario.id} turn=${turn.label} prompt issued`)
      try {
        await session.prompt(turn.prompt)
      } catch (error) {
        if (error instanceof C0BoundaryFailure) {
          fireStop('S-2', error.message)
        } else {
          const message = error instanceof Error ? error.message : String(error)
          fireStop('S-1', `provider failure after execution started: ${message}`)
        }
        return executor
      }
      const newRecords = executor.observationCount - recordsBefore
      state.providerCallRecords += newRecords
      state.replayMismatches += executor.replayMismatchCount
      log(
        `scenario=${scenario.id} turn=${turn.label} model-call records=${newRecords} total=${state.providerCallRecords}`
      )
      const stop = evaluateC0StopConditions(ledgersOf({ ...state, scenarioRunsCompleted: 0, mandatoryEvictions: 0, unexplainedDecisions: 0, orphanRehydrates: 0 }))
      if (stop.stop) {
        fireStop(stop.condition, stop.reason)
        return executor
      }
    }
    return executor
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
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

  if (!dryRun) {
    if (process.env['CANVAS_PROVIDER_EXECUTION_MODE'] !== 'experiment-strict') {
      console.error(
        '[c0] REFUSED: CANVAS_PROVIDER_EXECUTION_MODE=experiment-strict is required for the C0 canary.'
      )
      console.error('C0_STATUS=FAILED')
      process.exit(1)
    }
    if (!isValidC0RunId(process.env['CANVAS_PROVIDER_RUN_ID'])) {
      console.error(
        '[c0] REFUSED: CANVAS_PROVIDER_RUN_ID must match /^c0-\\d{8}-[0-9a-f]{8}$/.'
      )
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

  const reportDir = join(REPORTS_ROOT, runId)
  await mkdir(reportDir, { recursive: true })
  const sink = new JsonlObservationSink({ directory: reportDir, sessionId: 'observations' })

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

  let prepared: PreparedModelProvider | null = null
  let runtime: ModelRuntime | null = null
  let bindingEvidence: Record<string, unknown> | null = null

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
      log(`binding=${JSON.stringify(bindingEvidence)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isBindingFailure = error instanceof ProviderBindingError
      fireStop(
        'S-1',
        isBindingFailure
          ? message
          : `strict provider preparation failed: ${message}`
      )
    }
  }

  const subset = parseC0ScenarioSubset(process.env['CANVAS_C0_ONLY'])
  if (subset.error !== undefined) {
    console.error(`[c0] REFUSED: ${subset.error}`)
    console.error('C0_STATUS=FAILED')
    process.exit(1)
  }
  const scenarios = subset.scenarios
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
    try {
      if (mode === 'LIVE' && prepared !== null && runtime !== null) {
        executor = await runLiveScenario(
          scenario,
          runId,
          prepared,
          runtime,
          state,
          fireStop,
          shouldStop
        )
      } else if (mode === 'DRY_RUN') {
        executor = new C0ScenarioExecutor({
          runtimeSessionId: `${runId}:${scenario.id.toLowerCase()}-dry`
        })
        runScriptedTurns(scenario, executor)
        state.providerCallRecords += executor.observationCount
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
      mode === 'LIVE' ? executor.observationCount : 0
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

  const finishedAt = new Date()
  const wallClockMs = finishedAt.getTime() - startedAt.getTime()
  const providerCalls = mode === 'LIVE' ? state.providerCallRecords : 0
  const verdictOf = (id: C0ScenarioId): string => scenarioResults.get(id)?.scenarioVerdict ?? 'NOT_OBSERVED'
  const status: C0Status = terminal
    ? 'STOPPED'
    : mode === 'DRY_RUN'
      ? 'DRY_RUN_COMPLETE'
      : 'EXECUTED'

  try {
    await writeJson(join(reportDir, 'transitions.json'), {
      runId,
      mode,
      scenarios: [...scenarioResults.values()].map((result) => ({
        scenarioId: result.scenarioId,
        runtimeSessionId: result.runtimeSessionId,
        boundaries: result.boundaries,
        decisions: result.records,
        chain: result.chain,
        finalActiveSourceKeys: result.finalActiveSourceKeys
      }))
    })
    await writeJson(join(reportDir, 'verdicts.json'), {
      runId,
      mode,
      overall: {
        scenariosPass: [...scenarioResults.values()].filter((r) => r.scenarioVerdict === 'PASS').length,
        scenariosFail: [...scenarioResults.values()].filter((r) => r.scenarioVerdict === 'FAIL').length,
        scenariosNotObserved: C0_SCENARIOS.length - scenarioResults.size,
        providerCalls,
        stopConditionsFired: firedStops
      },
      scenarios: C0_SCENARIOS.map((scenario) => {
        const result = scenarioResults.get(scenario.id)
        if (result === undefined) {
          return { scenarioId: scenario.id, name: scenario.name, scenarioVerdict: 'NOT_OBSERVED' as const, reason: 'scenario not reached before terminal stop' }
        }
        return {
          scenarioId: scenario.id,
          name: scenario.name,
          scenarioVerdict: result.scenarioVerdict,
          chainSatisfied: result.chainSatisfied,
          chainFailures: result.chainFailures,
          replayMismatches: result.replayMismatchCount,
          providerCalls: providerCallsByScenario.get(scenario.id) ?? 0,
          evaluator: {
            overall: result.evaluator.overall,
            criteria: result.evaluator.criteria,
            counts: result.evaluator.counts
          }
        }
      })
    })
    await writeJson(join(reportDir, 'manifest.json'), {
      runId,
      mode,
      status,
      contract: 'docs/plan/cspv-c0-run-contract-2026-08-27.md',
      policyVersion: C0_POLICY_VERSION,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      wallClockMs,
      budgets: C0_BUDGETS,
      ledgers: {
        scenarioRunsCompleted: state.scenarioRunsCompleted,
        providerCallRecords: state.providerCallRecords,
        providerCalls
      },
      provider:
        mode === 'LIVE'
          ? bindingEvidence
          : {
              binding: null,
              providerCalls: 0,
              note: 'DRY_RUN: no ModelRuntime, no prepareModelProvider, no session; scripted deterministic messages',
              sourceDerivation: 'scripted-messages'
            },
      stopConditionsFired: firedStops,
      scenariosRequested: scenarios.map((scenario) => scenario.id),
      scenarioVerdicts: Object.fromEntries(
        C0_SCENARIOS.map((scenario) => [scenario.id, verdictOf(scenario.id)])
      )
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[c0] evidence write FAILED: ${message}`)
  }

  log(`runId=${runId} mode=${mode} scenarios=${scenarioResults.size}/${C0_SCENARIOS.length}`)
  log(
    `provider-call records=${state.providerCallRecords} providerCalls=${providerCalls} wallClockMs=${wallClockMs}`
  )
  log(`report=${reportDir}`)
  console.log(`C0_STATUS=${status}`)
  console.log(`C0_PROVIDER_CALLS=${providerCalls}`)
  for (const scenario of C0_SCENARIOS) {
    console.log(`C0_VERDICT_${scenario.id}=${verdictOf(scenario.id)}`)
  }
  console.log(`C0_REPORT_DIR=${reportDir}`)
  if (terminal) {
    process.exit(1)
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
