import { mkdir, writeFile } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import {
  createAgentSession,
  createBashTool,
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
  RepositoryObserver,
  type RepositoryFileObservation
} from '@canvas-agent/repository-observer'
import { isCanonicalRepositoryPath, type RepositoryRevisionContract } from '@canvas-agent/contracts'
import type {
  BenchmarkManifest,
  BenchmarkRunRecord,
  ContextStrategy,
  FileAccessEvidence,
  NativeCallEvidence,
  OracleResult,
  RepositoryObservationEvidence,
  ShadowCallEvidence,
  ShadowRepresentationEvidence,
  RunStatus
} from './types'
import {
  acceptanceCriteriaPassed,
  evaluateAcceptanceCriteria,
  evaluateC2MultiFileContract
} from './acceptance'
import {
  buildSanitizedChildEnvironment,
  computeInitialStateHash,
  materializeFixture,
  runOracle,
  runProcess
} from './fixture-generator'

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

/**
 * Replace Pi's default bash tool for benchmark runs. The default tool starts
 * from the parent shell environment; this hook replaces it with the explicit
 * benchmark allowlist so Agent commands cannot see provider credentials.
 */
export function createBenchmarkBashTool(cwd: string) {
  return createBashTool(cwd, {
    exposeSessionEnvironment: false,
    spawnHook: ({ command, cwd: spawnCwd }) => ({
      command,
      cwd: spawnCwd,
      env: buildSanitizedChildEnvironment()
    })
  })
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

export interface ShadowCandidateInput {
  readonly observedFilePaths: readonly string[]
  readonly evaluatorAnnotations: Pick<
    BenchmarkManifest,
    'knownCandidatePaths' | 'knownRelevantPaths' | 'knownIrrelevantPaths'
  >
}

// Keep the evaluator annotations in the call shape so the runner's boundary
// is covered by invariance tests, but never consult them when building the
// Planner candidate set.
export function buildShadowFilePathCandidates(
  input: ShadowCandidateInput
): readonly string[] {
  void input.evaluatorAnnotations
  return buildObservedShadowCandidatePaths(input.observedFilePaths)
}

function collapseRetainedText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeMacTemporaryAlias(path: string): string {
  for (const prefix of ['/private/tmp', '/private/var']) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return path.slice('/private'.length)
    }
  }
  return path
}

function fixturePathAliases(fixturePath: string): readonly string[] {
  const canonical = collapseRetainedText(fixturePath).replace(/\/$/, '')
  const normalized = normalizeMacTemporaryAlias(canonical)
  const aliases = new Set([canonical, normalized])
  if (
    normalized === '/tmp' ||
    normalized.startsWith('/tmp/') ||
    normalized === '/var' ||
    normalized.startsWith('/var/')
  ) {
    aliases.add(`/private${normalized}`)
  }
  return [...aliases]
    .filter((alias) => alias.length > 0)
    .sort((left, right) => right.length - left.length)
}

function redactFixtureRoot(value: string, fixturePath: string): string {
  let redacted = value
  for (const alias of fixturePathAliases(fixturePath)) {
    redacted = redacted.replaceAll(alias, '<fixture>')
  }
  return redacted
}

function isAbsoluteOnAnySupportedPlatform(path: string): boolean {
  return path.startsWith('file://') || posix.isAbsolute(path) || isWindowsAbsolutePath(path)
}

function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

// Convert an Agent-reported path to the canonical repository-relative input
// accepted by RepositoryObserver. Absolute paths are accepted only when they
// are inside this exact fixture (including macOS temp-path aliases); outside
// paths never become Source keys or Planner candidates.
export function normalizeRepositoryToolPath(path: string, fixturePath: string): string | null {
  const collapsedPath = collapseRetainedText(path)
  const collapsedFixture = collapseRetainedText(fixturePath)
  if (collapsedPath.startsWith('file://')) return null
  if (isWindowsAbsolutePath(collapsedPath)) {
    if (!isWindowsAbsolutePath(collapsedFixture)) return null
    const relativePath = win32.relative(collapsedFixture, collapsedPath).replaceAll('\\', '/')
    return isCanonicalRepositoryPath(relativePath) ? relativePath : null
  }
  if (!posix.isAbsolute(collapsedPath)) {
    return isCanonicalRepositoryPath(collapsedPath) ? collapsedPath : null
  }
  if (!posix.isAbsolute(collapsedFixture)) return null
  const normalizedPath = normalizeMacTemporaryAlias(collapsedPath)
  const normalizedFixture = normalizeMacTemporaryAlias(collapsedFixture)
  const relativePath = posix.relative(normalizedFixture, normalizedPath)
  return isCanonicalRepositoryPath(relativePath) ? relativePath : null
}

// Sanitize a retained path: normalize the macOS /var <-> /private/var and
// /tmp <-> /private/tmp aliases before redaction, collapse control characters,
// reject every other absolute path to an opaque marker, and bound the result.
export function sanitizeRepositoryObservationPath(path: string, fixturePath: string): string {
  const collapsed = collapseRetainedText(path)
  const redacted = redactFixtureRoot(collapsed, fixturePath)
  if (redacted !== collapsed) return redacted.slice(0, 160)
  if (isAbsoluteOnAnySupportedPlatform(redacted)) return '<absolute-path>'
  return redacted.slice(0, 160)
}

// Agent tool paths stay raw in memory for authoritative observation. Only the
// durable call evidence is normalized here; in-fixture paths become relative.
export function sanitizeFileAccessEvidence(
  accesses: readonly FileAccessEvidence[],
  fixturePath: string
): readonly FileAccessEvidence[] {
  return accesses.map((access) => {
    const safePath = sanitizeRepositoryObservationPath(access.path, fixturePath)
    const retainedPath = safePath === '<fixture>'
      ? '.'
      : safePath.startsWith('<fixture>/')
        ? safePath.slice('<fixture>/'.length)
        : safePath
    return { ...access, path: retainedPath }
  })
}

function sanitizeRepositoryObservationReason(reason: string, fixturePath: string): string {
  return redactFixtureRoot(collapseRetainedText(reason), fixturePath)
    .replace(/(^|[\s("'=:])\/[^\s"'<>]*/g, '$1<absolute-path>')
    .replace(/(^|[\s("'=:])[A-Za-z]:[\\/][^\s"'<>]*/g, '$1<absolute-path>')
    .slice(0, 240)
}

export function formatRepositoryObservationFailure(
  path: string,
  error: unknown,
  fixturePath: string
): string {
  const rawReason = error instanceof Error ? error.message : String(error)
  const reason = sanitizeRepositoryObservationReason(rawReason, fixturePath)
  const safePath = sanitizeRepositoryObservationPath(path, fixturePath)
  return `repository-observation:${safePath}:${reason || 'unknown_failure'}`
}

// Shared by the live runner and credential-free composed-world regression.
// The returned boolean is the sole candidate-admission decision.
export function queueRepositoryObservationForShadow(
  observer: EnrichedPiShadowObserver,
  entry: RepositoryFileObservation
): boolean {
  observer.queueExternalObservations([{
    observation: entry.observation,
    descriptor: {
      sourceKey: entry.sourceKey,
      sourceKind: entry.sourceKind,
      provenance: entry.provenance
    }
  }])
  return entry.observation.status === 'AVAILABLE'
}

const REPOSITORY_MUTATION_TOOL_NAMES = new Set(['bash', 'edit', 'write'])

/**
 * A successful or partially failed mutating tool may change repository state
 * without a later `read`. Refresh only sources already discovered from real
 * Agent reads; evaluator annotations never enter this list.
 */
export function selectObservedPathsForMutationRefresh(
  toolName: string,
  observedPaths: readonly string[]
): readonly string[] {
  if (!REPOSITORY_MUTATION_TOOL_NAMES.has(toolName)) return []
  return [...new Set(observedPaths)].sort()
}

export class RepositoryMutationRefreshGate {
  private pendingToolName: string | null = null

  markToolCompletion(toolName: string): void {
    if (REPOSITORY_MUTATION_TOOL_NAMES.has(toolName)) {
      this.pendingToolName = toolName
    }
  }

  takeObservedPaths(observedPaths: readonly string[]): readonly string[] {
    const toolName = this.pendingToolName
    this.pendingToolName = null
    return toolName === null ? [] : selectObservedPathsForMutationRefresh(toolName, observedPaths)
  }
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

function buildNativeCalls(
  observer: PiContextShadowObserver,
  accesses: readonly FileAccessEvidence[],
  fixturePath: string
): readonly NativeCallEvidence[] {
  const retainedAccesses = sanitizeFileAccessEvidence(accesses, fixturePath)
  return observer.inMemory.observations.map((observation) => ({
    sequence: observation.sequence,
    observedMessageTokenEstimate: observation.observedMessageTokenEstimate,
    categoryCounts: observation.categoryCounts,
    toolResultCount: observation.toolResultCount,
    fileAccesses: retainedAccesses.filter((access) => access.sequence === observation.sequence)
  }))
}

function buildShadowCalls(
  observer: ShadowPlannerObserver,
  accesses: readonly FileAccessEvidence[],
  fixturePath: string
): readonly ShadowCallEvidence[] {
  const retainedAccesses = sanitizeFileAccessEvidence(accesses, fixturePath)
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
      fileAccesses: retainedAccesses.filter((access) => access.sequence === call.metrics.modelCallSequence)
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
    env: buildSanitizedChildEnvironment()
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
  if (
    processResults.some(
      (result) => result.exitCode !== 0 || result.timedOut || result.outputLimitExceeded
    ) ||
    baseAncestor.exitCode !== 0
  ) {
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
  const shadowFilePathCandidates: string[] = []
  let repositoryObserver: RepositoryObserver | null = null
  let enrichedObserver: EnrichedPiShadowObserver | null = null
  let repositoryObservationQueue: Promise<void> = Promise.resolve()
  const mutationRefreshGate = new RepositoryMutationRefreshGate()
  const observationFailures: string[] = []
  const repositoryObservations: RepositoryObservationEvidence[] = []

  const recordObservationFailure = (path: string, error: unknown): void => {
    if (observationFailures.length >= 32) return
    observationFailures.push(formatRepositoryObservationFailure(path, error, fixture.path))
  }

  const recordRepositoryObservation = (path: string, status: RepositoryObservationEvidence['status'], reasonCode: string | null): void => {
    if (repositoryObservations.length >= 64) return
    repositoryObservations.push({
      path: sanitizeRepositoryObservationPath(path, fixture.path),
      status,
      reasonCode
    })
  }
  const refreshShadowFilePathCandidates = (): void => {
    const nextCandidates = buildShadowFilePathCandidates({
      observedFilePaths: observedRepositoryPaths,
      evaluatorAnnotations: {
        knownCandidatePaths: manifest.knownCandidatePaths,
        knownRelevantPaths: manifest.knownRelevantPaths,
        knownIrrelevantPaths: manifest.knownIrrelevantPaths
      }
    })
    shadowFilePathCandidates.splice(0, shadowFilePathCandidates.length, ...nextCandidates)
  }
  let nativeObserver: PiContextShadowObserver | null = null
  let planner: ShadowPlannerObserver | null = null

  const queueRepositoryRead = (path: string): void => {
    if (strategy !== 'SHADOW' || repositoryObserver === null || enrichedObserver === null) return
    const activeRepositoryObserver = repositoryObserver
    const activeEnrichedObserver = enrichedObserver
    const repositoryPath = normalizeRepositoryToolPath(path, fixture.path)
    if (repositoryPath === null) {
      recordObservationFailure(path, new Error('path_outside_repository'))
      return
    }
    repositoryObservationQueue = repositoryObservationQueue
      .then(async () => {
        const observed = await activeRepositoryObserver.observe({
          repositoryPath: fixture.path,
          expectedRevision: fixture.identity.repositoryRevision,
          paths: [repositoryPath],
          observedAt: FIXED_OBSERVATION_TIME
        })
        const entry = observed[0]
        if (entry === undefined) {
          recordObservationFailure(repositoryPath, new Error('observer_returned_no_observation'))
          return
        }
        // Enqueue the exact SourceObservation + descriptor regardless of
        // AVAILABLE/ABSENT/UNAVAILABLE so the Universe records the state
        // transition explicitly (DS-014 C). The observation carries the
        // contentHash for AVAILABLE and reasonCode for UNAVAILABLE.
        const candidateAvailable = queueRepositoryObservationForShadow(activeEnrichedObserver, entry)
        // Record the state (not only prose) for auditable evidence. Sanitize
        // path and bound the retained list.
        recordRepositoryObservation(
          repositoryPath,
          entry.observation.status,
          entry.observation.status === 'UNAVAILABLE' ? entry.observation.reasonCode : null
        )
        // A path enters the Planner candidate set only after an authoritative
        // AVAILABLE observation. UNAVAILABLE/ABSENT observations never promote
        // a path to candidates.
        if (candidateAvailable) {
          if (!observedRepositoryPaths.includes(repositoryPath)) {
            observedRepositoryPaths.push(repositoryPath)
            refreshShadowFilePathCandidates()
          }
        } else if (entry.observation.status === 'UNAVAILABLE') {
          recordObservationFailure(repositoryPath, new Error(`observer_unavailable:${entry.observation.reasonCode}`))
        }
      })
      .catch((error: unknown) => {
        recordObservationFailure(repositoryPath, error)
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
        filePathCandidates: shadowFilePathCandidates,
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
        if (manifest.allowedTools.includes('bash')) {
          pi.registerTool(createBenchmarkBashTool(fixture.path))
        }
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
            for (const path of mutationRefreshGate.takeObservedPaths(observedRepositoryPaths)) {
              queueRepositoryRead(path)
            }
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
        mutationRefreshGate.markToolCompletion(event.toolName)
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
    const c2MultiFileContract = manifest.category === 'C2-multi-file-feature'
      ? await evaluateC2MultiFileContract(fixture.path)
      : null
    const acceptanceCriteriaResults = evaluateAcceptanceCriteria(manifest, {
      objectiveOracle,
      regressionOracle,
      writablePathsValid,
      originalMessagesUnchanged,
      rawProviderPayloadsCaptured: false,
      c2MultiFileContract
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
    const nativeCalls = nativeObserver === null ? [] : buildNativeCalls(nativeObserver, accesses.accesses, fixture.path)
    const shadowCalls = planner === null ? [] : buildShadowCalls(planner, accesses.accesses, fixture.path)
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
      repositoryObservations: [...repositoryObservations],
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
      nativeCalls: nativeObserver === null ? [] : buildNativeCalls(nativeObserver, accesses.accesses, fixture.path),
      shadowCalls: planner === null ? [] : buildShadowCalls(planner, accesses.accesses, fixture.path),
      observationFailures: [...observationFailures],
      repositoryObservations: [...repositoryObservations],
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
