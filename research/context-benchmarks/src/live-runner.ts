import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ContextEvent,
  type ExtensionAPI,
  type ExtensionFactory,
  type ToolExecutionStartEvent,
  type ToolExecutionEndEvent
} from '@earendil-works/pi-coding-agent'
import { sha256Hex } from '@canvas-agent/context-runtime'
import {
  EnrichedPiShadowObserver,
  PiContextShadowObserver,
  ShadowPlannerObserver
} from '@canvas-agent/pi-context-integration'
import {
  FileRepresentationProvider,
  RepositoryObserver
} from '@canvas-agent/repository-observer'
import type { RepositoryRevisionContract } from '@canvas-agent/contracts'
import type {
  BenchmarkManifest,
  BenchmarkRunRecord,
  ContextStrategy,
  FileAccessEvidence,
  NativeCallEvidence,
  OracleResult,
  ShadowCallEvidence,
  ShadowRepresentationEvidence,
  RunStatus
} from './types'
import { acceptanceCriteriaPassed, evaluateAcceptanceCriteria } from './acceptance'
import { computeInitialStateHash, materializeFixture, runOracle, runProcess } from './fixture-generator'

const DEEPSEEK_PROVIDER = 'deepseek'
const FIXED_OBSERVATION_TIME = '2026-01-01T00:00:00.000Z'

export interface LiveCorpusOptions {
  readonly researchRoot: string
  readonly manifests: readonly BenchmarkManifest[]
  readonly repetitions?: number
  readonly outputDirectory?: string
}

export interface LiveCorpusResult {
  readonly records: readonly BenchmarkRunRecord[]
  readonly skipped: boolean
  readonly skipReason: string | null
  readonly outputPath: string | null
}

interface AccessCollector {
  accesses: FileAccessEvidence[]
  repeatedAccesses: number
  toolResultCount: number
  fileReadCount: number
  searchCount: number
}

// Only paths observed from real Agent reads can enter the Shadow candidate
// set. Evaluator annotations are intentionally not accepted by this helper.
export function buildObservedShadowCandidatePaths(
  observedFilePaths: readonly string[]
): readonly string[] {
  return [...new Set(observedFilePaths)].sort()
}

export function formatRepositoryObservationFailure(
  path: string,
  error: unknown,
  fixturePath: string
): string {
  const rawReason = error instanceof Error ? error.message : String(error)
  const reason = rawReason
    .replaceAll(fixturePath, '<fixture>')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
  const safePath = path.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160)
  return `repository-observation:${safePath}:${reason || 'unknown_failure'}`
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return Object.entries(value).find(([candidate]) => candidate === key)?.[1]
}

function readString(value: unknown, key: string): string | null {
  const candidate = readProperty(value, key)
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

function extractPath(args: unknown): string | null {
  for (const key of ['path', 'filePath', 'file_path', 'filepath']) {
    const value = readString(args, key)
    if (value !== null) return value
  }
  return null
}

function extractAgentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((entry) => extractAgentText(entry)).join('\n')
  if (typeof value !== 'object' || value === null) return ''
  const text = readString(value, 'text')
  if (text !== null) return text
  const content = readProperty(value, 'content')
  return content === undefined ? '' : extractAgentText(content)
}

function declaredSuccess(messages: readonly unknown[]): boolean | null {
  const text = messages.map((message) => extractAgentText(message)).join('\n')
  if (text.includes('CR-005_STATUS: SUCCESS')) return true
  if (text.includes('CR-005_STATUS:')) return false
  return null
}

function collectToolAccess(
  event: ToolExecutionEndEvent,
  args: unknown,
  sequence: number,
  collector: AccessCollector
): FileAccessEvidence | null {
  collector.toolResultCount += 1
  const toolName = event.toolName
  const isRead = toolName === 'read'
  const isSearch = toolName === 'grep' || toolName === 'find'
  if (!isRead && !isSearch) return null
  const path = extractPath(args)
  if (path === null) return null
  const kind = isRead ? 'READ' : 'SEARCH'
  const existing = collector.accesses.some((access) => access.kind === kind && access.path === path)
  if (existing) collector.repeatedAccesses += 1
  const access = { toolName, path, kind, sequence } satisfies FileAccessEvidence
  collector.accesses.push(access)
  if (isRead) collector.fileReadCount += 1
  if (isSearch) collector.searchCount += 1
  return access
}

function buildNativeCalls(observer: PiContextShadowObserver, accesses: readonly FileAccessEvidence[]): readonly NativeCallEvidence[] {
  return observer.inMemory.observations.map((observation) => ({
    sequence: observation.sequence,
    observedMessageTokenEstimate: observation.observedMessageTokenEstimate,
    categoryCounts: observation.categoryCounts,
    toolResultCount: observation.toolResultCount,
    fileAccesses: accesses.filter((access) => access.sequence === observation.sequence)
  }))
}

function buildShadowCalls(observer: ShadowPlannerObserver, accesses: readonly FileAccessEvidence[]): readonly ShadowCallEvidence[] {
  const previousRepresentationBySource = new Map<string, string | null>()
  let previousWorkingSet = null as ShadowPlannerObserver['callResults'][number]['plannerResult']['workingSet'] | null
  const records: ShadowCallEvidence[] = []
  for (const call of observer.callResults) {
    const decisions = call.plannerResult.decisions.map((decision) => {
      const item = call.plannerResult.workingSet.items.find((candidate) => candidate.sourceKeys.includes(decision.sourceKey))
      return {
        kind: decision.kind,
        sourceKey: decision.sourceKey,
        sourceVersionId: decision.sourceVersionId,
        representationId: decision.representationId,
        fromWorkingSetId: decision.fromWorkingSetId,
        toWorkingSetId: decision.toWorkingSetId,
        reasonCodes: decision.reasonCodes,
        tokenDelta: decision.tokenDelta,
        previousRepresentationKind: previousRepresentationBySource.get(decision.sourceKey) ?? null,
        representationKind: item?.representationKind ?? null
      }
    })
    const representations: { readonly sourceKey: string; readonly representation: ShadowRepresentationEvidence }[] = call.representations.map(
      ({ sourceKey, representation }) => ({
        sourceKey,
        representation: {
          id: representation.id,
          kind: representation.kind,
          sourceVersionIds: representation.sourceVersionIds,
          contentHash: representation.contentHash,
          tokenEstimate: representation.tokenEstimate,
          lossiness: representation.lossiness,
          derivation: { sourceKey, kind: representation.kind }
        }
      })
    )
    records.push({
      sequence: call.metrics.modelCallSequence,
      universeSequence: call.metrics.universeSequence,
      universeHash: call.metrics.universeHash,
      workingSetId: call.metrics.workingSetId,
      workingSetHash: call.plannerResult.workingSet.logicalHash,
      planningRequestHash: call.plannerResult.workingSet.planningRequestHash,
      universe: call.enrichedResult.universeRevision,
      planningRequest: call.planningRequest,
      previousWorkingSet,
      policyVersion: call.plannerResult.workingSet.policyVersion,
      transitionHash: call.plannerResult.transition.logicalHash,
      representations,
      proposedSemanticTokenEstimate: call.metrics.proposedSemanticTokenEstimate,
      itemCount: call.plannerResult.workingSet.items.length,
      nativeContextEstimate: call.metrics.nativeContextEstimate,
      decisions,
      representationCounts: {
        FULL: call.metrics.representationCounts.full,
        LINE_RANGE: call.metrics.representationCounts.lineRange,
        REFERENCE: call.metrics.representationCounts.reference
      },
      reasonCodeCounts: call.metrics.reasonCodeCounts,
      materializationFailures: call.materializationFailures,
      fileAccesses: accesses.filter((access) => access.sequence === call.metrics.modelCallSequence)
    })
    for (const item of call.plannerResult.workingSet.items) {
      for (const sourceKey of item.sourceKeys) {
        previousRepresentationBySource.set(sourceKey, item.representationKind ?? null)
      }
    }
    previousWorkingSet = call.plannerResult.workingSet
  }
  return records
}

export async function readFinalFixtureIdentity(
  fixturePath: string,
  initialBaseCommit: string
): Promise<{
  readonly repositoryRevision: RepositoryRevisionContract
  readonly stateHash: string
  readonly changedPaths: readonly string[]
} | null> {
  const gitOptions = {
    cwd: fixturePath,
    timeoutMs: 30000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }
  const [commit, tree, baseAncestor, committedChanged, diff, stagedDiff, changed, stagedChanged, untracked] = await Promise.all([
    runProcess('git', ['rev-parse', 'HEAD'], gitOptions),
    runProcess('git', ['rev-parse', 'HEAD^{tree}'], gitOptions),
    runProcess('git', ['merge-base', '--is-ancestor', initialBaseCommit, 'HEAD'], gitOptions),
    runProcess('git', ['diff', '--name-only', '--no-ext-diff', '--no-renames', initialBaseCommit, 'HEAD'], gitOptions),
    runProcess('git', ['diff', '--binary', '--no-ext-diff', '--no-renames'], gitOptions),
    runProcess('git', ['diff', '--cached', '--binary', '--no-ext-diff', '--no-renames'], gitOptions),
    runProcess('git', ['diff', '--name-only', '--no-ext-diff', '--no-renames'], gitOptions),
    runProcess('git', ['diff', '--cached', '--name-only', '--no-ext-diff', '--no-renames'], gitOptions),
    runProcess('git', ['ls-files', '--others', '--exclude-standard'], gitOptions)
  ])
  const processResults = [commit, tree, baseAncestor, committedChanged, diff, stagedDiff, changed, stagedChanged, untracked]
  if (processResults.some((result) => result.exitCode !== 0 || result.timedOut) || baseAncestor.exitCode !== 0) {
    return null
  }
  const changedPaths = [...new Set(
    [committedChanged.stdout, changed.stdout, stagedChanged.stdout, untracked.stdout]
      .flatMap((output) => output.split('\n'))
      .map((path) => path.trim())
      .filter((path) => path.length > 0)
  )].sort()
  return {
    repositoryRevision: {
      baseCommit: commit.stdout.trim(),
      treeHash: tree.stdout.trim(),
      workingTreePatchHash:
        diff.stdout.length === 0 && stagedDiff.stdout.length === 0
          ? null
          : sha256Hex(`${diff.stdout}\n${stagedDiff.stdout}`)
    },
    stateHash: await computeInitialStateHash(fixturePath),
    changedPaths
  }
}

export function evaluateWritablePaths(
  changedPaths: readonly string[],
  expectedWritablePaths: readonly string[]
): { readonly outOfScopePaths: readonly string[]; readonly valid: boolean } {
  const expected = new Set(expectedWritablePaths)
  const outOfScopePaths = [...new Set(changedPaths)].filter((path) => !expected.has(path)).sort()
  return { outOfScopePaths, valid: outOfScopePaths.length === 0 }
}

export function determineRunStatus(input: {
  readonly budgetExceeded: boolean
  readonly runError: string | null
  readonly objectiveOracle: OracleResult
  readonly regressionOracle: OracleResult
  readonly acceptanceCriteriaPassed: boolean
  readonly originalMessagesUnchanged: boolean
  readonly writablePathsValid: boolean
}): RunStatus {
  if (input.budgetExceeded || input.runError !== null) return 'ABORTED'
  return input.objectiveOracle.passed &&
    input.regressionOracle.passed &&
    input.acceptanceCriteriaPassed &&
    input.originalMessagesUnchanged &&
    input.writablePathsValid
    ? 'VALID'
    : 'INVALID'
}

async function runLiveTask(
  researchRoot: string,
  manifest: BenchmarkManifest,
  strategy: ContextStrategy,
  repetition: number,
  runtime: ModelRuntime
): Promise<BenchmarkRunRecord> {
  const fixture = await materializeFixture(researchRoot, manifest, 'fixture')
  const runId = `${manifest.taskId}-${strategy.toLowerCase()}-r${repetition}`
  const runtimeSessionId = `cr005:${manifest.taskId}:${strategy}:r${repetition}`
  const accesses: AccessCollector = {
    accesses: [],
    repeatedAccesses: 0,
    toolResultCount: 0,
    fileReadCount: 0,
    searchCount: 0
  }
  let session: AgentSession | null = null
  let semanticCallCount = 0
  let budgetExceeded = false
  let lastAgentMessages: readonly unknown[] = []
  let originalMessagesUnchanged = true
  let runError: string | null = null
  const observedRepositoryPaths: string[] = []
  let repositoryObserver: RepositoryObserver | null = null
  let enrichedObserver: EnrichedPiShadowObserver | null = null
  let repositoryObservationQueue: Promise<void> = Promise.resolve()
  const observationFailures: string[] = []

  const recordObservationFailure = (path: string, error: unknown): void => {
    if (observationFailures.length >= 32) return
    observationFailures.push(formatRepositoryObservationFailure(path, error, fixture.path))
  }
  let nativeObserver: PiContextShadowObserver | null = null
  let planner: ShadowPlannerObserver | null = null

  const queueRepositoryRead = (path: string): void => {
    if (strategy !== 'SHADOW' || repositoryObserver === null || enrichedObserver === null) return
    repositoryObservationQueue = repositoryObservationQueue
      .then(async () => {
        const observed = await repositoryObserver?.observe({
          repositoryPath: fixture.path,
          expectedRevision: fixture.identity.repositoryRevision,
          paths: [path],
          observedAt: FIXED_OBSERVATION_TIME
        })
        const entry = observed?.[0]
        if (entry === undefined) {
          recordObservationFailure(path, new Error('observer_returned_no_observation'))
          return
        }
        if (entry.observation.status !== 'AVAILABLE') {
          if (entry.observation.status === 'UNAVAILABLE') {
            recordObservationFailure(path, new Error(`observer_unavailable:${entry.observation.reasonCode}`))
          }
          return
        }
        if (!observedRepositoryPaths.includes(path)) observedRepositoryPaths.push(path)
        enrichedObserver?.queueExternalSeeds([{
          sourceKey: entry.sourceKey,
          sourceKind: entry.sourceKind,
          contentHash: entry.observation.contentHash,
          provenance: entry.provenance,
          observedAt: FIXED_OBSERVATION_TIME
        }])
      })
      .catch((error: unknown) => {
        recordObservationFailure(path, error)
      })
  }

  try {
    const base = new PiContextShadowObserver({ runtimeSessionId, harness: 'PI' })
    if (strategy === 'NATIVE') {
      nativeObserver = base
    } else {
      repositoryObserver = new RepositoryObserver()
      enrichedObserver = new EnrichedPiShadowObserver({ base })
      const representationProvider = new FileRepresentationProvider()
      planner = new ShadowPlannerObserver({
        enriched: enrichedObserver,
        policyVersion: 'policy-v0',
        // This mutable list is populated only after an actual Agent `read`
        // has been authoritatively observed. Manifest candidate/relevant paths
        // never enter the Planner.
        filePathCandidates: observedRepositoryPaths,
        representationProvider: async ({ entry, need }) => {
          if (entry.admittedVersion === null) return null
          const result = await representationProvider.materialize({
            repositoryPath: fixture.path,
            expectedRevision: fixture.identity.repositoryRevision,
            sourceKey: entry.source.sourceKey,
            sourceVersionId: entry.admittedVersion.versionId,
            sourceVersionContentHash: entry.admittedVersion.contentHash,
            need
          })
          if (result.kind === 'failed') throw new Error(result.reason)
          return result.representation
        }
      })
    }

    const abortIfActive = (): void => {
      const activeSession = session
      if (activeSession !== null) void activeSession.abort().catch(() => undefined)
    }
    const extension: { readonly name: string; readonly factory: ExtensionFactory } = {
      name: `cr005-${strategy.toLowerCase()}-${manifest.taskId}`,
      factory: (pi: ExtensionAPI) => {
        const contextHandler = async (event: ContextEvent) => {
          const originalMessages = event.messages
          if (semanticCallCount >= manifest.budget.maxSemanticCalls) {
            budgetExceeded = true
            abortIfActive()
            return { messages: originalMessages }
          }
          semanticCallCount += 1
          if (strategy === 'NATIVE') {
            if (nativeObserver === null) throw new Error('native observer unavailable')
            const result = nativeObserver.handleContextEvent(event.messages)
            originalMessagesUnchanged = originalMessagesUnchanged && result.messages === event.messages
          } else {
            if (planner === null) throw new Error('shadow planner unavailable')
            await repositoryObservationQueue
            await planner.observeModelCall(event.messages)
          }
          originalMessagesUnchanged = originalMessagesUnchanged && event.messages === originalMessages
          return { messages: originalMessages }
        }
        pi.on('context', contextHandler)
      }
    }

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 }
    })
    const loader = new DefaultResourceLoader({
      cwd: fixture.path,
      agentDir: join(fixture.path, '.pi-agent'),
      settingsManager,
      extensionFactories: [extension]
    })
    await loader.reload()
    const model = runtime.getModel(manifest.modelProfile.provider, manifest.modelProfile.model)
    if (model === undefined) throw new Error(`model unavailable: ${manifest.modelProfile.provider}/${manifest.modelProfile.model}`)
    const created = await createAgentSession({
      cwd: fixture.path,
      model,
      modelRuntime: runtime,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(fixture.path),
      settingsManager,
      thinkingLevel: manifest.modelProfile.thinkingLevel,
      tools: [...manifest.allowedTools]
    })
    session = created.session
    const pendingToolArgs = new Map<string, unknown>()
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === 'tool_execution_start') {
        const startEvent: ToolExecutionStartEvent = event
        pendingToolArgs.set(startEvent.toolCallId, startEvent.args)
      } else if (event.type === 'tool_execution_end') {
        const args = pendingToolArgs.get(event.toolCallId)
        pendingToolArgs.delete(event.toolCallId)
        const access = collectToolAccess(event, args, semanticCallCount, accesses)
        if (access?.kind === 'READ') queueRepositoryRead(access.path)
        if (accesses.toolResultCount >= manifest.budget.maxToolCalls) {
          budgetExceeded = true
          abortIfActive()
        }
      } else if (event.type === 'agent_end') {
        lastAgentMessages = event.messages
      }
    })
    const startedAt = Date.now()
    const wallClockTimer = setTimeout(() => {
      budgetExceeded = true
      abortIfActive()
    }, manifest.budget.wallClockMs)
    try {
      await session.prompt(manifest.prompt)
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error)
    } finally {
      clearTimeout(wallClockTimer)
      await session.waitForIdle().catch(() => undefined)
      await repositoryObservationQueue
    }
    const wallClockMs = Date.now() - startedAt
    unsubscribe()
    const objectiveOracle = await runOracle(manifest, fixture.path)
    const regressionOracle = await runOracle(manifest, fixture.path, manifest.regressionOracle)
    const finalIdentity = await readFinalFixtureIdentity(
      fixture.path,
      fixture.identity.repositoryRevision.baseCommit
    )
    const changedPaths = finalIdentity?.changedPaths ?? []
    const writablePathEvaluation = finalIdentity === null
      ? { outOfScopePaths: [], valid: false }
      : evaluateWritablePaths(changedPaths, manifest.expectedWritablePaths)
    const outOfScopePaths = writablePathEvaluation.outOfScopePaths
    const writablePathsValid = writablePathEvaluation.valid
    const agentDeclaredSuccess = declaredSuccess(lastAgentMessages)
    const acceptanceCriteriaResults = evaluateAcceptanceCriteria(manifest, {
      objectiveOracle,
      regressionOracle,
      writablePathsValid,
      originalMessagesUnchanged,
      rawProviderPayloadsCaptured: false
    })
    const acceptanceCriteriaPassedResult = acceptanceCriteriaPassed(manifest, acceptanceCriteriaResults)
    const status = determineRunStatus({
      budgetExceeded,
      runError,
      objectiveOracle,
      regressionOracle,
      acceptanceCriteriaPassed: acceptanceCriteriaPassedResult,
      originalMessagesUnchanged,
      writablePathsValid
    })
    const nativeCalls = nativeObserver === null ? [] : buildNativeCalls(nativeObserver, accesses.accesses)
    const shadowCalls = planner === null ? [] : buildShadowCalls(planner, accesses.accesses)
    return {
      runId,
      taskId: manifest.taskId,
      category: manifest.category,
      strategy,
      repetition,
      status,
      fixtureIdentity: fixture.identity,
      finalRepositoryRevision: finalIdentity?.repositoryRevision ?? null,
      finalStateHash: finalIdentity?.stateHash ?? null,
      changedPaths,
      outOfScopePaths,
      writablePathsValid,
      modelProfile: manifest.modelProfile,
      semanticCallCount,
      toolCallCount: accesses.toolResultCount,
      toolResultCount: accesses.toolResultCount,
      fileReadCount: accesses.fileReadCount,
      searchCount: accesses.searchCount,
      repeatedAccessCount: accesses.repeatedAccesses,
      wallClockMs,
      abortReason: runError ?? (budgetExceeded ? 'benchmark_budget_exceeded' : null),
      agentDeclaredSuccess,
      objectiveOracle,
      regressionOracle,
      acceptanceCriteriaResults,
      acceptanceCriteriaPassed: acceptanceCriteriaPassedResult,
      nativeCalls,
      shadowCalls,
      observationFailures: [...observationFailures],
      originalMessagesUnchanged,
      rawProviderPayloadsCaptured: false
    }
  } catch (error) {
    return {
      runId,
      taskId: manifest.taskId,
      category: manifest.category,
      strategy,
      repetition,
      status: 'ABORTED',
      fixtureIdentity: fixture.identity,
      finalRepositoryRevision: null,
      finalStateHash: null,
      changedPaths: [],
      outOfScopePaths: [],
      writablePathsValid: false,
      modelProfile: manifest.modelProfile,
      semanticCallCount,
      toolCallCount: accesses.toolResultCount,
      toolResultCount: accesses.toolResultCount,
      fileReadCount: accesses.fileReadCount,
      searchCount: accesses.searchCount,
      repeatedAccessCount: accesses.repeatedAccesses,
      wallClockMs: 0,
      abortReason: error instanceof Error ? error.message : String(error),
      agentDeclaredSuccess: declaredSuccess(lastAgentMessages),
      objectiveOracle: { passed: false, exitCode: null, timedOut: false, stdout: '', stderr: '', durationMs: 0 },
      regressionOracle: { passed: false, exitCode: null, timedOut: false, stdout: '', stderr: '', durationMs: 0 },
      acceptanceCriteriaResults: [],
      acceptanceCriteriaPassed: false,
      nativeCalls: nativeObserver === null ? [] : buildNativeCalls(nativeObserver, accesses.accesses),
      shadowCalls: planner === null ? [] : buildShadowCalls(planner, accesses.accesses),
      observationFailures: [...observationFailures],
      originalMessagesUnchanged,
      rawProviderPayloadsCaptured: false
    }
  } finally {
    session?.dispose()
    await fixture.cleanup()
  }
}

export async function runLiveCorpus(options: LiveCorpusOptions): Promise<LiveCorpusResult> {
  const repetitions = options.repetitions ?? 2
  const runtime = await ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false })
  const firstManifest = options.manifests[0]
  if (firstManifest === undefined) return { records: [], skipped: true, skipReason: 'no_manifests', outputPath: null }
  const apiKey = process.env['DEEPSEEK_API_KEY']
  if (apiKey !== undefined && apiKey.length > 0) await runtime.setRuntimeApiKey(DEEPSEEK_PROVIDER, apiKey)
  const auth = await runtime.checkAuth(firstManifest.modelProfile.provider)
  if (auth === undefined) {
    return { records: [], skipped: true, skipReason: 'provider_credentials_unavailable', outputPath: null }
  }
  const records: BenchmarkRunRecord[] = []
  for (const manifest of options.manifests) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (const strategy of ['NATIVE', 'SHADOW'] as const) {
        records.push(await runLiveTask(options.researchRoot, manifest, strategy, repetition, runtime))
      }
    }
  }
  const outputDirectory = options.outputDirectory ?? join(options.researchRoot, 'output')
  await mkdir(outputDirectory, { recursive: true })
  const outputPath = join(outputDirectory, `cr005-${Date.now()}.jsonl`)
  await writeFile(outputPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8')
  return { records, skipped: false, skipReason: null, outputPath }
}
