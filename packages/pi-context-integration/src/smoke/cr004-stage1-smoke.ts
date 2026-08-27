import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
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
import { C0ScenarioExecutor } from './c0-scenarios'
import {
  createRunKillSwitch,
  ProviderBindingError,
  prepareModelProvider,
  safeProviderSelection,
  type PreparedModelProvider
} from '../index'
import {
  createActiveRewriteExtension,
  InMemoryActiveRewriteEvidenceCollector,
  type ActiveRewriteEvidenceCollector
} from '../extension/active-rewrite-extension'
import type { PiMessageView } from '../pi-message-mapper'
import {
  isValidS1RunId,
  loadC1TaskDefinition,
  scriptedDryRunLegRecords,
  S1PairStateMachine,
  suggestS1RunId,
  type C1OracleSpec,
  type C1TaskDefinition,
  type S1LegRecord,
  type S1OracleResult
} from './s1-pair-core'

// CR-004 Stage 1 pair runner (docs/plan/cr004-stage1-run-contract-2026-08-27.md).
//
// LIVE mode (Lead-operated only) requires ALL of:
//   CANVAS_CONTEXT_LIVE_SMOKE=1
//   CANVAS_PROVIDER_EXECUTION_MODE=experiment-strict
//   CANVAS_PROVIDER_RUN_ID=cr004-s1-<ISO-date>-<8-hex>  (single-use, fresh)
//   STEP_PLAN_API_KEY=<key>                            (never recorded)
//   CANVAS_S1_KILL_SWITCH_FILE=<path>                  (optional operator stop)
//
// One C1-class task, TWO legs, ONE strict provider binding shared by both:
//   leg A NATIVE — observer-only shadow extension, unmodified context;
//   leg B ACTIVE — the Stage 1 Active intervention extension (B1), which
//                  composes the first Active rewrite at the read->edit
//                  boundary through the Stage 0 seam and sends it once.
// Order Native->Active is enforced; the Active leg is barred when the Native
// leg exceeded the per-leg provider-call gate (contract section 9). Budgets:
// 2 legs / 30 provider-call records total / 15 per leg / 40 tool calls per leg
// / 120s per leg / 30 min run — all hard-fail via S-1..S-9, fail closed,
// evidence always preserved. Output is metadata-only.
//
// DRY_RUN mode (CANVAS_S1_DRY_RUN=1) proves the pair/budget/stop plumbing
// with scripted stand-in leg records: no ModelRuntime, no extension, no
// session, provider calls exactly 0.
//
// Evidence: research/context-benchmarks/reports/cr004-stage1/<runId>/
//   legs/<leg>/observations.jsonl  manifest.json  pairs.json  transitions.json

const REPORTS_ROOT = resolve(
  process.cwd(),
  '..',
  '..',
  'research',
  'context-benchmarks',
  'reports',
  'cr004-stage1'
)
const C1_MANIFEST_PATH = resolve(
  process.cwd(),
  '..',
  '..',
  'research',
  'context-benchmarks',
  'manifests',
  'C1-localized-bug-fix.json'
)
const C1_FIXTURE_PATH = resolve(
  process.cwd(),
  '..',
  '..',
  'research',
  'context-benchmarks',
  'corpus',
  'C1-localized-bug-fix',
  'fixture'
)
const STEP_PLAN_PROVIDER_ID = 'step-plan'
/**
 * The Active seam's out-of-band system-instruction carrier. Pi assembles its
 * own system prompt out-of-band; the composition records this fixed string
 * byte-identical and never rewrites any system content.
 */
const S1_SYSTEM_INSTRUCTION =
  'You are a careful coding agent. Complete the task in the repository using the provided tools.'

type S1Status = 'EXECUTED' | 'DRY_RUN_COMPLETE' | 'STOPPED' | 'FAILED'
type S1Mode = 'LIVE' | 'DRY_RUN'

// Wraps observation/planner failures inside the Pi context callback so they
// are distinguishable from provider transport failures (S-2 vs S-9).
class S1BoundaryFailure extends Error {
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    super(`S1 boundary failure: ${message}`)
    this.name = 'S1BoundaryFailure'
  }
}

function log(message: string): void {
  console.log(`[cr004-s1] ${message}`)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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

function runOracle(spec: C1OracleSpec, cwd: string): S1OracleResult {
  const command = `${spec.command} ${spec.args.join(' ')}`
  const result = spawnSync(spec.command, [...spec.args], {
    cwd,
    timeout: spec.timeoutMs,
    encoding: 'utf8'
  })
  if (result.error !== undefined) {
    return { kind: 'PRIMARY', command, exitCode: null, pass: false }
  }
  return {
    kind: 'PRIMARY',
    command,
    exitCode: result.status,
    pass: result.status === spec.expectedExitCode
  }
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
        throw new S1BoundaryFailure(error)
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
  lastMessages: { current: readonly PiMessageView[] }
) {
  const factory = createActiveRewriteExtension({
    runId,
    systemInstruction: S1_SYSTEM_INSTRUCTION,
    executor,
    killSwitch,
    ...(killSwitchFilePath !== undefined ? { killSwitchFilePath } : {}),
    evidence,
    // The Stage 1 contract pins the once-only latch: exactly one intervention
    // attempt (one send at most) per Active leg. The matrix contract lifts
    // this to bounded repeated intervention; the defaults live in the
    // extension module.
    maxInterventions: 1,
    maxAttempts: 1
  })
  // One wrapper factory, two handlers (registration order = run order; Pi
  // applies each handler's returned messages sequentially and ignores
  // undefined results): the recorder updates the metadata holder first, the
  // Active extension then observes and — at the single boundary — returns the
  // composed rewrite.
  return (pi: ExtensionAPI): void => {
    pi.on('context', async (event: ContextEvent) => {
      lastMessages.current = event.messages as unknown as readonly PiMessageView[]
    })
    factory(pi)
  }
}

interface LegRunResult {
  readonly legRecord: S1LegRecord
  readonly executor: C0ScenarioExecutor
  readonly evidence: ActiveRewriteEvidenceCollector | null
}

/** Flush the leg's observations to its report dir; evidence is ALWAYS preserved. */
async function flushObservations(
  executor: C0ScenarioExecutor,
  directory: string,
  sessionId: string
): Promise<void> {
  const sink = new JsonlObservationSink({ directory, sessionId })
  for (const observation of executor.base.inMemory.observations) {
    sink.write(observation)
  }
  await sink.closeAndFlush()
}

async function runLiveLeg(options: {
  readonly strategy: 'NATIVE' | 'ACTIVE'
  readonly task: C1TaskDefinition
  readonly runId: string
  readonly prepared: PreparedModelProvider
  readonly runtime: ModelRuntime
  readonly killSwitch: ReturnType<typeof createRunKillSwitch>
  readonly killSwitchFilePath: string | undefined
  readonly observationDir: string
}): Promise<LegRunResult> {
  const fixtureDir = await mkdtemp(join(tmpdir(), `canvas-s1-${options.strategy.toLowerCase()}-`))
  const legStartedAt = Date.now()
  try {
    await cp(C1_FIXTURE_PATH, fixtureDir, { recursive: true })
    const initialTree = await snapshotTree(fixtureDir)

    const executor = new C0ScenarioExecutor({
      runtimeSessionId: `${options.runId}:${options.strategy.toLowerCase()}`
    })
    const evidence =
      options.strategy === 'ACTIVE' ? new InMemoryActiveRewriteEvidenceCollector() : null
    const lastMessages: { current: readonly PiMessageView[] } = { current: [] }

    const extensionFactory =
      options.strategy === 'ACTIVE' && evidence !== null
        ? activeInterventionExtension(
            executor,
            evidence,
            options.killSwitch,
            options.killSwitchFilePath,
            options.runId,
            lastMessages
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
        { name: `canvas-cr004-s1-${options.strategy.toLowerCase()}`, factory: extensionFactory }
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
      tools: [...options.task.allowedTools]
    })

    // The manifest task prompt, issued ONCE, exactly as the manifest specifies.
    log(`leg=${options.strategy} prompt issued (taskId=${options.task.taskId})`)
    try {
      await session.prompt(options.task.prompt)
    } catch (error) {
      // Fail closed, but evidence-close first: the observations collected so
      // far are always preserved before the error escapes (contract S-1..S-9).
      await flushObservations(
        executor,
        options.observationDir,
        `${options.strategy.toLowerCase()}-observations`
      )
      throw error
    }
    await flushObservations(
      executor,
      options.observationDir,
      `${options.strategy.toLowerCase()}-observations`
    )
    const wallClockMs = Date.now() - legStartedAt

    const recordCount = executor.observationCount
    const toolCallCount = countToolCallBlocks(lastMessages.current)
    const observedTokenEstimateSum = executor.base.inMemory.observations.reduce(
      (sum, observation) => sum + observation.observedMessageTokenEstimate,
      0
    )
    log(
      `leg=${options.strategy} records=${recordCount} toolCalls=${toolCallCount} wallClockMs=${wallClockMs}`
    )

    // Objective oracles + writable-path conformance, in the leg's fixture dir.
    const oracleResults: S1OracleResult[] = [
      { ...runOracle(options.task.oracle, fixtureDir), kind: 'PRIMARY' }
    ]
    if (options.task.regressionOracle !== null) {
      oracleResults.push({
        ...runOracle(options.task.regressionOracle, fixtureDir),
        kind: 'REGRESSION'
      })
    }
    const changed = await changedPaths(fixtureDir, initialTree)
    oracleResults.push({
      kind: 'WRITABLE_CONFORMANCE',
      command: 'changed paths <= expectedWritablePaths',
      exitCode: changed.every((path) => options.task.expectedWritablePaths.includes(path)) ? 0 : 1,
      pass: changed.every((path) => options.task.expectedWritablePaths.includes(path))
    })

    // Metadata-only summary of the final writable artifact.
    const artifactPath = join(fixtureDir, options.task.expectedWritablePaths[0] ?? 'src/discount.js')
    let finalArtifact: S1LegRecord['finalArtifact']
    try {
      const artifactStat = await stat(artifactPath)
      if (artifactStat.isFile()) {
        const content = await readFile(artifactPath, 'utf8')
        finalArtifact = {
          path: options.task.expectedWritablePaths[0] ?? basename(artifactPath),
          sha256: sha256OfContent(content),
          lineCount: content.split('\n').length
        }
      }
    } catch {
      // absent artifact: recorded by its absence
    }

    const legRecord: S1LegRecord = {
      leg: options.strategy === 'NATIVE' ? 'A-NATIVE' : 'B-ACTIVE',
      strategy: options.strategy,
      oracleResults,
      recordCount,
      toolCallCount,
      observedTokenEstimateSum,
      wallClockMs,
      replayMismatches: executor.replayMismatchCount,
      ...(options.strategy === 'ACTIVE' && evidence !== null
        ? { intervention: evidence.intervention }
        : {}),
      ...(finalArtifact !== undefined ? { finalArtifact } : {}),
      fixtureDirRemoved: false
    }
    return { legRecord, executor, evidence }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
}

async function run(): Promise<void> {
  const dryRun = process.env['CANVAS_S1_DRY_RUN'] === '1'

  if (!dryRun && process.env['CANVAS_CONTEXT_LIVE_SMOKE'] !== '1') {
    console.log('[cr004-s1] CANVAS_CONTEXT_LIVE_SMOKE=1 (or CANVAS_S1_DRY_RUN=1) is required. SKIPPED')
    console.log('S1_STATUS=SKIPPED')
    return
  }

  const mode: S1Mode = dryRun ? 'DRY_RUN' : 'LIVE'

  if (!dryRun) {
    if (process.env['CANVAS_PROVIDER_EXECUTION_MODE'] !== 'experiment-strict') {
      console.error(
        '[cr004-s1] REFUSED: CANVAS_PROVIDER_EXECUTION_MODE=experiment-strict is required for the Stage 1 pair.'
      )
      console.error('S1_STATUS=FAILED')
      process.exit(1)
    }
    if (!isValidS1RunId(process.env['CANVAS_PROVIDER_RUN_ID'])) {
      console.error(
        '[cr004-s1] REFUSED: CANVAS_PROVIDER_RUN_ID must match /^cr004-s1-\\d{8}-[0-9a-f]{8}$/.'
      )
      console.error(`[cr004-s1] SUGGESTED_CANVAS_PROVIDER_RUN_ID=${suggestS1RunId()}`)
      console.error(
        '[cr004-s1] Export the suggested fresh identity explicitly; run identities are single-use.'
      )
      console.error('S1_STATUS=FAILED')
      process.exit(1)
    }
    if (
      process.env['STEP_PLAN_API_KEY'] === undefined ||
      process.env['STEP_PLAN_API_KEY'].length === 0
    ) {
      console.error('[cr004-s1] REFUSED: STEP_PLAN_API_KEY is required in live mode.')
      console.error('S1_STATUS=FAILED')
      process.exit(1)
    }
  }

  const envRunId = process.env['CANVAS_PROVIDER_RUN_ID']
  const runId = isValidS1RunId(envRunId) ? envRunId : suggestS1RunId()
  if (!isValidS1RunId(envRunId)) {
    log(`DRY_RUN generated run identity ${runId} (no provider binding occurs in DRY_RUN)`)
  }

  const task = loadC1TaskDefinition(JSON.parse(await readFile(C1_MANIFEST_PATH, 'utf8')))

  const reportDir = join(REPORTS_ROOT, runId)
  await mkdir(join(reportDir, 'legs', 'native'), { recursive: true })
  await mkdir(join(reportDir, 'legs', 'active'), { recursive: true })

  const startedAt = new Date()
  const machine = new S1PairStateMachine()
  const killSwitch = createRunKillSwitch(runId, { now: () => new Date().toISOString() })
  const killSwitchFilePath = process.env['CANVAS_S1_KILL_SWITCH_FILE']

  let nativeRecord: S1LegRecord | null = null
  let activeRecord: S1LegRecord | null = null
  let activeExecutor: C0ScenarioExecutor | null = null
  let activeEvidence: ActiveRewriteEvidenceCollector | null = null
  let bindingEvidence: Record<string, unknown> | null = null

  if (dryRun) {
    // DRY_RUN: scripted stand-in legs prove the pair/budget/stop plumbing only.
    const scripted = scriptedDryRunLegRecords()
    const nativeBegin = machine.beginLeg('NATIVE')
    if (nativeBegin.ok) machine.endLeg({
      leg: 'NATIVE',
      providerCallRecords: scripted.native.recordCount,
      toolCalls: scripted.native.toolCallCount,
      wallClockMs: scripted.native.wallClockMs
    })
    const activeBegin = machine.beginLeg('ACTIVE')
    if (activeBegin.ok) machine.endLeg({
      leg: 'ACTIVE',
      providerCallRecords: scripted.active.recordCount,
      toolCalls: scripted.active.toolCallCount,
      wallClockMs: scripted.active.wallClockMs
    })
    nativeRecord = scripted.native
    activeRecord = scripted.active
  } else {
    // LIVE: strict binding ONCE per run; BOTH legs share the one binding.
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
        bindingSharedByLegs: ['NATIVE', 'ACTIVE'],
        sourceDerivation: 'live-pi-messages-only'
      }
      log(`binding=${JSON.stringify(bindingEvidence)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      machine.fireRunStop(
        'S-1',
        error instanceof ProviderBindingError
          ? message
          : `strict provider preparation failed: ${message}`
      )
    }

    if (!machine.isTerminal && prepared !== null && runtime !== null) {
      // ---- LEG A: NATIVE (control) -----------------------------------------
      const beginNative = machine.beginLeg('NATIVE')
      if (beginNative.ok) {
        try {
          const nativeRun = await runLiveLeg({
            strategy: 'NATIVE',
            task,
            runId,
            prepared,
            runtime,
            killSwitch,
            killSwitchFilePath,
            observationDir: join(reportDir, 'legs', 'native')
          })
          nativeRecord = nativeRun.legRecord
          const end = machine.endLeg({
            leg: 'NATIVE',
            providerCallRecords: nativeRecord.recordCount,
            toolCalls: nativeRecord.toolCallCount,
            wallClockMs: nativeRecord.wallClockMs
          })
          if (end.stop) log(`Native leg budget stop: ${end.reason}`)
          if (nativeRecord.replayMismatches > 0) {
            machine.fireRunStop(
              'S-2',
              `Native leg observation validation failure: ${nativeRecord.replayMismatches} replay mismatch(es)`
            )
          }
        } catch (error) {
          if (error instanceof S1BoundaryFailure) {
            machine.fireRunStop('S-2', error.message)
          } else {
            const message = error instanceof Error ? error.message : String(error)
            machine.fireRunStop('S-9', `Native leg provider failure: ${message}`)
          }
        }
      }
    }

    if (!machine.isTerminal && nativeRecord !== null) {
      // ---- LEG B: ACTIVE (treatment) ---------------------------------------
      const beginActive = machine.beginLeg('ACTIVE')
      if (beginActive.ok) {
        try {
          const activeRun = await runLiveLeg({
            strategy: 'ACTIVE',
            task,
            runId,
            prepared: prepared!,
            runtime: runtime!,
            killSwitch,
            killSwitchFilePath,
            observationDir: join(reportDir, 'legs', 'active')
          })
          activeRecord = activeRun.legRecord
          activeExecutor = activeRun.executor
          activeEvidence = activeRun.evidence
          const end = machine.endLeg({
            leg: 'ACTIVE',
            providerCallRecords: activeRecord.recordCount,
            toolCalls: activeRecord.toolCallCount,
            wallClockMs: activeRecord.wallClockMs
          })
          if (end.stop) log(`Active leg budget stop: ${end.reason}`)

          // Contract stop mapping for the Active leg.
          if (activeRecord.replayMismatches > 0) {
            machine.fireRunStop(
              'S-3',
              `Active leg transition-chain replay mismatch: ${activeRecord.replayMismatches}`
            )
          }
          const protectedRemovals = activeRun.executor.records.filter(
            (record) =>
              record.kind === 'REMOVE' &&
              (record.protection === 'MANDATORY' || record.protection === 'PINNED')
          )
          if (protectedRemovals.length > 0) {
            machine.fireRunStop(
              'S-4',
              `mandatory/pinned item REMOVEd in the Active leg: ${protectedRemovals
                .map((record) => record.sourceKey)
                .join(', ')}`
            )
          }
          const intervention = activeRun.legRecord.intervention
          if (intervention !== undefined && intervention.compositionVerdict !== 'NOT_ATTEMPTED') {
            if (intervention.compositionVerdict === 'FALLBACK_NATIVE') {
              machine.recordActiveFallback(intervention.fallbackReason ?? 'UNKNOWN')
            } else if (intervention.guardVerdict === 'FALLBACK_NATIVE') {
              machine.recordActiveFallback(`guard:${intervention.guardFallbackReason ?? 'UNKNOWN'}`)
            }
          }
          const trip = killSwitch.tripRecord
          if (trip !== undefined && trip.reason.startsWith('operator kill-switch file')) {
            machine.recordKillSwitchTrip(trip.reason)
          }
        } catch (error) {
          if (error instanceof S1BoundaryFailure) {
            machine.fireRunStop('S-2', error.message)
          } else {
            const message = error instanceof Error ? error.message : String(error)
            machine.fireRunStop('S-9', `Active leg provider failure: ${message}`)
          }
        }
      } else if (beginActive.stop !== undefined) {
        log(`Active leg refused: ${beginActive.stop.condition} ${beginActive.stop.reason}`)
      }
    }
  }

  const finishedAt = new Date()
  const wallClockMs = finishedAt.getTime() - startedAt.getTime()
  const providerCalls =
    mode === 'LIVE'
      ? (nativeRecord?.recordCount ?? 0) + (activeRecord?.recordCount ?? 0)
      : 0
  const oracleOf = (record: S1LegRecord | null): 'PASS' | 'FAIL' | 'NOT_RUN' => {
    if (record === null) return 'NOT_RUN'
    const primary = record.oracleResults.filter(
      (result) => !result.standIn && (result.kind === 'PRIMARY' || result.kind === 'REGRESSION')
    )
    if (primary.length === 0) return 'NOT_RUN'
    return primary.every((result) => result.pass === true) ? 'PASS' : 'FAIL'
  }
  const interventionState = (record: S1LegRecord | null): string => {
    const intervention = record?.intervention
    if (intervention === undefined || intervention.compositionVerdict === 'NOT_ATTEMPTED') {
      return 'NOT_REACHED'
    }
    if (intervention.sentRewrite) return 'COMPOSED_AND_SENT'
    if (intervention.compositionVerdict === 'FALLBACK_NATIVE') {
      return `FALLBACK:${intervention.fallbackReason ?? 'UNKNOWN'}`
    }
    return `FALLBACK:guard:${intervention.guardFallbackReason ?? 'UNKNOWN'}`
  }
  const terminalRunStop = machine.stopsFired.find((stop) => stop.scope === 'RUN')
  const status: S1Status = terminalRunStop !== undefined
    ? 'STOPPED'
    : mode === 'DRY_RUN'
      ? 'DRY_RUN_COMPLETE'
      : 'EXECUTED'

  // ---- Evidence (metadata-only; never prompts, transcripts, or the key) ----
  try {
    await writeJson(join(reportDir, 'pairs.json'), {
      runId,
      mode,
      taskId: task.taskId,
      category: task.category,
      divergenceLedger: [
        {
          kind: 'MODEL_PROFILE',
          note: 'manifest pins deepseek/deepseek-v4-flash; this run binds step-plan/step-3.7-flash; no cross-baseline comparison claimed'
        },
        {
          kind: 'STRATEGY',
          note: "manifest contextStrategies are NATIVE/SHADOW; leg B is ACTIVE (Stage 1 strategy outside the frozen manifest; manifest NOT modified)"
        },
        { kind: 'HARNESS', note: 'Pi-only Active capability profile' },
        {
          kind: 'EVIDENCE_LAYOUT',
          note: 'observations written per leg under legs/<leg>/observations.jsonl (contract lists a single observations.jsonl)'
        }
      ],
      legs: [nativeRecord, activeRecord].filter((record): record is S1LegRecord => record !== null)
    })
    await writeJson(join(reportDir, 'transitions.json'), {
      runId,
      mode,
      activeLeg:
        activeExecutor !== null
          ? {
              runtimeSessionId: activeExecutor.runtimeSessionId,
              boundaries: activeExecutor.boundaries,
              decisions: activeExecutor.records,
              chain: activeExecutor.chain,
              finalActiveSourceKeys: [...activeExecutor.finalActiveSourceKeys()],
              replayMismatches: activeExecutor.replayMismatchCount,
              intervention: activeEvidence?.intervention ?? null
            }
          : null
    })
    await writeJson(join(reportDir, 'manifest.json'), {
      runId,
      mode,
      status,
      contract: 'docs/plan/cr004-stage1-run-contract-2026-08-27.md',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      wallClockMs,
      task: {
        taskId: task.taskId,
        category: task.category,
        title: task.title,
        promptHash: sha256OfContent(task.prompt),
        manifestPath: relative(process.cwd(), C1_MANIFEST_PATH),
        fixturePath: relative(process.cwd(), C1_FIXTURE_PATH),
        allowedTools: [...task.allowedTools],
        expectedTools: [...task.expectedTools],
        expectedWritablePaths: [...task.expectedWritablePaths]
      },
      budgets: {
        legs: 2,
        providerCallRecordsTotal: 30,
        providerCallRecordsPerLeg: 15,
        toolCallsPerLeg: task.budget.maxToolCalls,
        legWallClockMs: task.budget.wallClockMs,
        runWallClockMs: 30 * 60 * 1000
      },
      ledgers: {
        ...machine.ledgers(),
        providerCalls
      },
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
      stopConditionsFired: machine.stopsFired,
      legs: {
        native: nativeRecord === null ? 'NOT_RUN' : 'COMPLETED',
        active: activeRecord === null ? 'NOT_RUN' : 'COMPLETED'
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[cr004-s1] evidence write FAILED: ${message}`)
  }

  log(`runId=${runId} mode=${mode} status=${status} legs=${machine.legsDone}/2`)
  log(`provider-call records=${providerCalls} wallClockMs=${wallClockMs}`)
  for (const stop of machine.stopsFired) {
    log(`stop ${stop.condition} (${stop.scope}): ${stop.reason}`)
  }
  log(`report=${reportDir}`)
  console.log(`S1_STATUS=${status}`)
  console.log(`S1_PROVIDER_CALLS=${providerCalls}`)
  console.log(`S1_NATIVE_ORACLE=${oracleOf(nativeRecord)}`)
  console.log(`S1_ACTIVE_ORACLE=${oracleOf(activeRecord)}`)
  console.log(`S1_INTERVENTION=${interventionState(activeRecord)}`)
  console.log(`S1_REPORT_DIR=${reportDir}`)
  if (status === 'STOPPED') {
    process.exit(1)
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[cr004-s1] FAILED: ${message}`)
    console.error('S1_STATUS=FAILED')
    process.exit(1)
  })
