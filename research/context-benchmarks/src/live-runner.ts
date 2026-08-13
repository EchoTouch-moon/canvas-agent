import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
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
import { diagnoseBenchmarkFailure } from './diagnostics'
import {
  buildSanitizedChildEnvironment,
  computeInitialStateHash,
  materializeFixture,
  runOracle,
  runProcess
} from './fixture-generator'
import { aggregateRuns } from './aggregation'
import {
  benchmarkRecordIsValid,
  retainedEvidenceHasSecretPattern,
  retainedEvidenceIsSanitized
} from './replacement-canary'
import {
  evaluateWaveAGate,
  evaluateWaveAPairGate,
  selectWaveAManifests,
  WAVE_A_REPETITIONS,
  WAVE_A_TARGETS,
  waveAManifestExecutionFingerprint
} from './wave-a'

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

export interface ProgressiveWaveATask {
  readonly researchRoot: string
  readonly manifest: BenchmarkManifest
  readonly strategy: ContextStrategy
  readonly repetition: typeof WAVE_A_REPETITIONS
}

export type ProgressiveWaveATaskExecutor = (
  task: ProgressiveWaveATask
) => Promise<BenchmarkRunRecord>

export type ProgressiveWaveAStatus = 'PASS' | 'STOPPED' | 'SKIPPED'

export interface ProgressiveWaveACheckpointManifest {
  readonly schemaVersion: 1
  readonly runId: string
  readonly baselineSha: string
  readonly createdAt: string
  readonly authorizationScope: {
    readonly provider: string
    readonly model: string
    readonly thinkingLevel: string
    readonly maxRecords: number
    readonly maxSemanticCalls: number
    readonly maxToolCalls: number
    readonly maxWallClockMs: number
  }
  readonly expectedScope: {
    readonly repetitions: typeof WAVE_A_REPETITIONS
    readonly records: readonly {
      readonly runId: string
      readonly taskId: string
      readonly category: BenchmarkManifest['category']
      readonly strategy: ContextStrategy
      readonly repetition: typeof WAVE_A_REPETITIONS
      readonly manifestFingerprint: string
    }[]
  }
}

export interface ProgressiveWaveAProgress {
  readonly schemaVersion: 1
  readonly runId: string
  readonly baselineSha: string
  readonly status: 'RUNNING' | 'PASS' | 'STOPPED'
  readonly completedPairs: readonly string[]
  readonly nextCategory: BenchmarkManifest['category'] | null
  readonly nextStrategy: ContextStrategy | null
  readonly recordCount: number
  readonly recordIds: readonly string[]
  readonly recordHashes: readonly string[]
  readonly stopReason: string | null
}

export interface ProgressiveWaveACheckpointWriteEvent {
  readonly kind: 'manifest' | 'records' | 'progress' | 'aggregate'
  readonly path: string
  readonly metadata: {
    readonly runId: string
    readonly recordCount: number
    readonly completedPairs: number
    readonly status: string
  }
}

export interface ProgressiveWaveAOptions {
  readonly researchRoot: string
  readonly manifests: readonly BenchmarkManifest[]
  readonly baselineSha: string
  readonly outputDirectory?: string
  readonly runId?: string
  readonly resume?: boolean
  /** Required for provider-backed execution; fake executors may omit it. */
  readonly providerExecutionAuthorized?: boolean
  readonly credentialValue?: string
  readonly executeTask?: ProgressiveWaveATaskExecutor
  readonly checkpointWriteInterceptor?: (
    event: ProgressiveWaveACheckpointWriteEvent
  ) => void | Promise<void>
}

export interface ProgressiveWaveAResult {
  readonly records: readonly BenchmarkRunRecord[]
  readonly skipped: boolean
  readonly skipReason: string | null
  readonly status: ProgressiveWaveAStatus
  readonly stopReason: string | null
  readonly outputPath: string | null
  readonly checkpointDirectory: string | null
  readonly completedPairs: number
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
    const record: BenchmarkRunRecord = {
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
    const diagnosis = diagnoseBenchmarkFailure(record)
    return { ...record, ...diagnosis }
  } catch (error) {
    const record: BenchmarkRunRecord = {
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
    const diagnosis = diagnoseBenchmarkFailure(record)
    return { ...record, ...diagnosis }
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

const PROGRESSIVE_CHECKPOINT_SCHEMA_VERSION = 1 as const

interface ProgressiveCheckpointFilePaths {
  readonly manifest: string
  readonly records: string
  readonly progress: string
  readonly aggregate: string
}

function progressiveCheckpointPaths(directory: string): ProgressiveCheckpointFilePaths {
  return {
    manifest: join(directory, 'manifest.json'),
    records: join(directory, 'records.jsonl'),
    progress: join(directory, 'progress.json'),
    aggregate: join(directory, 'aggregate.json')
  }
}

async function writeAtomicCheckpointFile(
  path: string,
  content: string,
  event: ProgressiveWaveACheckpointWriteEvent,
  interceptor?: ProgressiveWaveAOptions['checkpointWriteInterceptor']
): Promise<void> {
  await interceptor?.(event)
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  try {
    const handle = await open(temporaryPath, 'wx')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

class ProgressiveWaveACheckpointStore {
  readonly paths: ProgressiveCheckpointFilePaths

  constructor(
    readonly directory: string,
    private readonly runId: string,
    private readonly interceptor?: ProgressiveWaveAOptions['checkpointWriteInterceptor']
  ) {
    this.paths = progressiveCheckpointPaths(directory)
  }

  private async writeJson(
    kind: 'manifest' | 'progress' | 'aggregate',
    path: string,
    value: unknown,
    metadata: ProgressiveWaveACheckpointWriteEvent['metadata']
  ): Promise<void> {
    await writeAtomicCheckpointFile(
      path,
      `${JSON.stringify(value, null, 2)}\n`,
      { kind, path, metadata },
      this.interceptor
    )
  }

  async writeManifest(value: ProgressiveWaveACheckpointManifest): Promise<void> {
    await this.writeJson('manifest', this.paths.manifest, value, {
      runId: this.runId,
      recordCount: 0,
      completedPairs: 0,
      status: 'RUNNING'
    })
  }

  async writeRecords(records: readonly BenchmarkRunRecord[], completedPairs: number): Promise<void> {
    const content = records.length === 0
      ? ''
      : `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
    await writeAtomicCheckpointFile(
      this.paths.records,
      content,
      {
        kind: 'records',
        path: this.paths.records,
        metadata: {
          runId: this.runId,
          recordCount: records.length,
          completedPairs,
          status: 'RUNNING'
        }
      },
      this.interceptor
    )
  }

  async writeProgress(value: ProgressiveWaveAProgress): Promise<void> {
    await this.writeJson('progress', this.paths.progress, value, {
      runId: this.runId,
      recordCount: value.recordCount,
      completedPairs: value.completedPairs.length,
      status: value.status
    })
  }

  async writeAggregate(
    value: ReturnType<typeof aggregateRuns>,
    records: readonly BenchmarkRunRecord[],
    completedPairs: number,
    status: 'PASS' | 'STOPPED',
    baselineSha: string,
    stopReason: string | null = null
  ): Promise<void> {
    const recordsContent = await readFile(this.paths.records, 'utf8')
    // The aggregate keeps its existing top-level shape for simple inspection,
    // while this marker makes a terminal checkpoint recognizable even when a
    // later progress write fails.
    const aggregateWithTerminalMarker = {
      ...value,
      checkpointSchemaVersion: PROGRESSIVE_CHECKPOINT_SCHEMA_VERSION,
      checkpointStatus: status,
      checkpointStopReason: stopReason,
      checkpointBaselineSha: baselineSha,
      checkpointOutputSha256: sha256Hex(recordsContent),
      checkpointOutputBytes: Buffer.byteLength(recordsContent, 'utf8'),
      checkpointOutputRecordCount: records.length
    }
    await writeAtomicCheckpointFile(
      this.paths.aggregate,
      `${JSON.stringify(aggregateWithTerminalMarker, null, 2)}\n`,
      {
        kind: 'aggregate',
        path: this.paths.aggregate,
        metadata: {
          runId: this.runId,
          recordCount: records.length,
          completedPairs,
          status
        }
      },
      this.interceptor
    )
  }

  async readManifest(): Promise<ProgressiveWaveACheckpointManifest> {
    return JSON.parse(await readFile(this.paths.manifest, 'utf8')) as ProgressiveWaveACheckpointManifest
  }

  async readProgress(): Promise<ProgressiveWaveAProgress> {
    return JSON.parse(await readFile(this.paths.progress, 'utf8')) as ProgressiveWaveAProgress
  }

  async readAggregateMarker(): Promise<{
    readonly checkpointSchemaVersion?: unknown
    readonly checkpointStatus?: unknown
  } | null> {
    try {
      const parsed = JSON.parse(await readFile(this.paths.aggregate, 'utf8')) as unknown
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('wave_a_checkpoint_aggregate_schema_invalid')
      }
      return parsed as {
        readonly checkpointSchemaVersion?: unknown
        readonly checkpointStatus?: unknown
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async readRecords(): Promise<readonly BenchmarkRunRecord[]> {
    let content: string
    try {
      content = await readFile(this.paths.records, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    const lines = content.split('\n').filter((line) => line.trim().length > 0)
    return lines.map((line, index) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        throw new Error(`wave_a_checkpoint_record_json_invalid:index=${index}`)
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as { runId?: unknown }).runId !== 'string'
      ) {
        throw new Error(`wave_a_checkpoint_record_schema_invalid:index=${index}`)
      }
      return parsed as BenchmarkRunRecord
    })
  }
}

function isSafeProgressiveRunId(runId: string): boolean {
  return /^[A-Za-z0-9._-]{1,160}$/.test(runId)
}

function checkpointRecordHash(record: BenchmarkRunRecord): string {
  return sha256Hex(JSON.stringify(record))
}

function checkpointRecordHashes(records: readonly BenchmarkRunRecord[]): readonly string[] {
  return records.map(checkpointRecordHash)
}

function checkpointRecordsMetadataOnly(
  records: readonly BenchmarkRunRecord[],
  credentialValue?: string
): boolean {
  const serialized = JSON.stringify(records)
  return (
    retainedEvidenceIsSanitized(serialized) &&
    !retainedEvidenceHasSecretPattern(serialized) &&
    (credentialValue === undefined || credentialValue.length === 0 || !serialized.includes(credentialValue)) &&
    records.every((record) => !record.rawProviderPayloadsCaptured)
  )
}

function buildProgressiveCheckpointManifest(
  runId: string,
  baselineSha: string,
  manifests: readonly BenchmarkManifest[]
): ProgressiveWaveACheckpointManifest {
  const records = WAVE_A_TARGETS.flatMap((target) => {
    const manifest = manifests.find(
      (candidate) => candidate.category === target.category && candidate.taskId === target.taskId
    )
    if (manifest === undefined) {
      throw new Error(`wave_a_checkpoint_manifest_missing:${target.taskId}`)
    }
    return (['NATIVE', 'SHADOW'] as const).map((strategy) => ({
      runId: `${target.taskId}-${strategy.toLowerCase()}-r${WAVE_A_REPETITIONS}`,
      taskId: target.taskId,
      category: target.category,
      strategy,
      repetition: WAVE_A_REPETITIONS as typeof WAVE_A_REPETITIONS,
      manifestFingerprint: waveAManifestExecutionFingerprint(manifest)
    }))
  })
  return {
    schemaVersion: PROGRESSIVE_CHECKPOINT_SCHEMA_VERSION,
    runId,
    baselineSha,
    createdAt: new Date().toISOString(),
    authorizationScope: {
      provider: manifests[0]?.modelProfile.provider ?? 'deepseek',
      model: manifests[0]?.modelProfile.model ?? 'deepseek-v4-flash',
      thinkingLevel: manifests[0]?.modelProfile.thinkingLevel ?? 'medium',
      maxRecords: WAVE_A_TARGETS.length * 2,
      maxSemanticCalls: manifests.reduce(
        (total, manifest) => total + manifest.budget.maxSemanticCalls * 2,
        0
      ),
      maxToolCalls: manifests.reduce(
        (total, manifest) => total + manifest.budget.maxToolCalls * 2,
        0
      ),
      maxWallClockMs: manifests.reduce(
        (total, manifest) => total + manifest.budget.wallClockMs * 2,
        0
      )
    },
    expectedScope: {
      repetitions: WAVE_A_REPETITIONS,
      records
    }
  }
}

function checkpointProgressFor(
  metadata: ProgressiveWaveACheckpointManifest,
  records: readonly BenchmarkRunRecord[],
  completedPairs: readonly string[],
  status: ProgressiveWaveAProgress['status'],
  stopReason: string | null
): ProgressiveWaveAProgress {
  const nextTarget = WAVE_A_TARGETS[completedPairs.length]
  const nextStrategy = status === 'RUNNING'
    ? (records.length % 2 === 0 ? 'NATIVE' : 'SHADOW')
    : null
  return {
    schemaVersion: PROGRESSIVE_CHECKPOINT_SCHEMA_VERSION,
    runId: metadata.runId,
    baselineSha: metadata.baselineSha,
    status,
    completedPairs,
    nextCategory: nextTarget?.category ?? null,
    nextStrategy,
    recordCount: records.length,
    recordIds: records.map((record) => record.runId),
    recordHashes: checkpointRecordHashes(records),
    stopReason
  }
}

function expectedProgressiveRecord(
  metadata: ProgressiveWaveACheckpointManifest,
  index: number
): ProgressiveWaveACheckpointManifest['expectedScope']['records'][number] | undefined {
  return metadata.expectedScope.records[index]
}

function matchingWaveATarget(
  record: BenchmarkRunRecord
): (typeof WAVE_A_TARGETS)[number] | undefined {
  return WAVE_A_TARGETS.find(
    (target) => target.category === record.category && target.taskId === record.taskId
  )
}

function recordMatchesProgressiveIdentity(
  record: BenchmarkRunRecord,
  expected: ProgressiveWaveACheckpointManifest['expectedScope']['records'][number],
  manifests: readonly BenchmarkManifest[]
): boolean {
  const target = matchingWaveATarget(record)
  const manifest = manifests.find(
    (candidate) => candidate.category === expected.category && candidate.taskId === expected.taskId
  )
  return (
    target !== undefined &&
    manifest !== undefined &&
    record.runId === expected.runId &&
    record.taskId === expected.taskId &&
    record.category === expected.category &&
    record.strategy === expected.strategy &&
    record.repetition === expected.repetition &&
    JSON.stringify(record.fixtureIdentity) === JSON.stringify(target.fixtureIdentity) &&
    waveAManifestExecutionFingerprint(manifest) === expected.manifestFingerprint &&
    record.modelProfile.provider === 'deepseek' &&
    record.modelProfile.model === 'deepseek-v4-flash' &&
    record.modelProfile.thinkingLevel === 'medium'
  )
}

export interface ProgressiveWaveACheckpointSnapshot {
  readonly manifest: ProgressiveWaveACheckpointManifest
  readonly progress: ProgressiveWaveAProgress
  readonly records: readonly BenchmarkRunRecord[]
  readonly recoveredRecordLag: boolean
}

function checkpointExpectedCompletedPairs(
  metadata: ProgressiveWaveACheckpointManifest,
  recordCount: number
): readonly string[] {
  const pairCount = Math.floor(recordCount / 2)
  return metadata.expectedScope.records
    .filter((_, index) => index < pairCount * 2 && index % 2 === 0)
    .map((record) => record.taskId)
}

function checkpointProgressMatchesPrefix(
  progress: ProgressiveWaveAProgress,
  records: readonly BenchmarkRunRecord[]
): boolean {
  if (progress.recordCount > records.length) return false
  const prefix = records.slice(0, progress.recordCount)
  return (
    JSON.stringify(progress.recordIds) === JSON.stringify(prefix.map((record) => record.runId)) &&
    JSON.stringify(progress.recordHashes) === JSON.stringify(checkpointRecordHashes(prefix))
  )
}

function checkpointProgressShapeIsValid(
  progress: ProgressiveWaveAProgress,
  metadata: ProgressiveWaveACheckpointManifest
): boolean {
  return (
    progress.schemaVersion === PROGRESSIVE_CHECKPOINT_SCHEMA_VERSION &&
    progress.runId === metadata.runId &&
    progress.baselineSha === metadata.baselineSha &&
    ['RUNNING', 'PASS', 'STOPPED'].includes(progress.status) &&
    Number.isInteger(progress.recordCount) &&
    progress.recordCount >= 0 &&
    Array.isArray(progress.recordIds) &&
    Array.isArray(progress.recordHashes) &&
    Array.isArray(progress.completedPairs)
  )
}

export async function readProgressiveWaveACheckpoint(input: {
  readonly directory: string
  readonly runId: string
  readonly baselineSha: string
  readonly manifests: readonly BenchmarkManifest[]
  readonly credentialValue?: string
}): Promise<ProgressiveWaveACheckpointSnapshot> {
  if (!isSafeProgressiveRunId(input.runId)) {
    throw new Error('wave_a_checkpoint_run_id_invalid')
  }
  const manifests = selectWaveAManifests(input.manifests)
  const expectedManifest = buildProgressiveCheckpointManifest(
    input.runId,
    input.baselineSha,
    manifests
  )
  const store = new ProgressiveWaveACheckpointStore(input.directory, input.runId)
  const manifest = await store.readManifest()
  const progress = await store.readProgress()
  const aggregateMarker = await store.readAggregateMarker()
  if (aggregateMarker !== null) {
    if (
      aggregateMarker.checkpointSchemaVersion !== PROGRESSIVE_CHECKPOINT_SCHEMA_VERSION ||
      (aggregateMarker.checkpointStatus !== 'PASS' &&
        aggregateMarker.checkpointStatus !== 'STOPPED')
    ) {
      throw new Error('wave_a_checkpoint_aggregate_schema_invalid')
    }
    throw new Error('wave_a_checkpoint_terminal')
  }
  const records = await store.readRecords()
  if (
    manifest.schemaVersion !== PROGRESSIVE_CHECKPOINT_SCHEMA_VERSION ||
    manifest.runId !== expectedManifest.runId ||
    manifest.baselineSha !== expectedManifest.baselineSha ||
    JSON.stringify(manifest.authorizationScope) !==
      JSON.stringify(expectedManifest.authorizationScope) ||
    JSON.stringify(manifest.expectedScope) !== JSON.stringify(expectedManifest.expectedScope)
  ) {
    throw new Error('wave_a_checkpoint_identity_mismatch')
  }
  if (!checkpointProgressShapeIsValid(progress, manifest)) {
    throw new Error('wave_a_checkpoint_progress_schema_invalid')
  }
  if (progress.recordCount > records.length) {
    throw new Error('wave_a_checkpoint_progress_ahead_of_records')
  }
  if (!checkpointProgressMatchesPrefix(progress, records)) {
    throw new Error('wave_a_checkpoint_record_hash_or_order_mismatch')
  }
  if (records.length > manifest.expectedScope.records.length) {
    throw new Error('wave_a_checkpoint_record_count_invalid')
  }

  for (const [index, record] of records.entries()) {
    const expected = expectedProgressiveRecord(manifest, index)
    if (expected === undefined || !recordMatchesProgressiveIdentity(record, expected, manifests)) {
      throw new Error(`wave_a_checkpoint_record_identity_invalid:index=${index}`)
    }
  }
  if (!checkpointRecordsMetadataOnly(records, input.credentialValue)) {
    throw new Error('wave_a_checkpoint_durable_evidence_unsafe')
  }
  for (let index = 0; index + 1 < records.length; index += 2) {
    const pairGate = evaluateWaveAPairGate(
      records.slice(index, index + 2),
      input.credentialValue
    )
    if (pairGate.status !== 'PASS') {
      throw new Error(
        `wave_a_checkpoint_pair_invalid:${pairGate.failedChecks.join(',')}`
      )
    }
  }
  if (records.length % 2 === 1) {
    const last = records.at(-1)
    if (last === undefined || !benchmarkRecordIsValid(last)) {
      throw new Error('wave_a_checkpoint_partial_record_invalid')
    }
  }

  const expectedCompletedPairs = checkpointExpectedCompletedPairs(manifest, records.length)
  const expectedProgressPairs = checkpointExpectedCompletedPairs(manifest, progress.recordCount)
  const progressMatchesAllRecords = progress.recordCount === records.length
  const nextTarget = WAVE_A_TARGETS[expectedProgressPairs.length]
  const expectedNextCategory = nextTarget?.category ?? null
  const expectedNextStrategy = progress.status === 'RUNNING' &&
    progress.recordCount < manifest.expectedScope.records.length
    ? (progress.recordCount % 2 === 0 ? 'NATIVE' : 'SHADOW')
    : null
  if (
    progress.status === 'RUNNING' &&
    JSON.stringify(progress.completedPairs) !== JSON.stringify(expectedProgressPairs)
  ) {
    throw new Error('wave_a_checkpoint_completed_pairs_mismatch')
  }
  if (
    progress.status === 'RUNNING' &&
    (progress.nextCategory !== expectedNextCategory ||
      progress.nextStrategy !== expectedNextStrategy)
  ) {
    throw new Error('wave_a_checkpoint_next_boundary_mismatch')
  }
  if (
    progress.status === 'RUNNING' &&
    progress.recordCount === records.length &&
    progress.stopReason !== null
  ) {
    throw new Error('wave_a_checkpoint_running_stop_reason_invalid')
  }
  if (progress.status === 'PASS') {
    const finalGate = evaluateWaveAGate(records, input.credentialValue)
    if (finalGate.status !== 'PASS') throw new Error('wave_a_checkpoint_pass_gate_invalid')
  }

  if (progressMatchesAllRecords) {
    return { manifest, progress, records, recoveredRecordLag: false }
  }
  if (progress.status !== 'RUNNING') {
    throw new Error('wave_a_checkpoint_terminal_record_lag')
  }
  const recoveredProgress = checkpointProgressFor(
    manifest,
    records,
    expectedCompletedPairs,
    'RUNNING',
    null
  )
  return {
    manifest,
    progress: recoveredProgress,
    records,
    recoveredRecordLag: true
  }
}

function recordWithinManifestBudget(
  record: BenchmarkRunRecord,
  manifest: BenchmarkManifest
): boolean {
  return (
    Number.isInteger(record.semanticCallCount) &&
    record.semanticCallCount >= 0 &&
    record.semanticCallCount <= manifest.budget.maxSemanticCalls &&
    Number.isInteger(record.toolCallCount) &&
    record.toolCallCount >= 0 &&
    record.toolCallCount <= manifest.budget.maxToolCalls &&
    Number.isInteger(record.toolResultCount) &&
    record.toolResultCount === record.toolCallCount &&
    Number.isInteger(record.wallClockMs) &&
    record.wallClockMs >= 0 &&
    record.wallClockMs <= manifest.budget.wallClockMs
  )
}

function progressiveBudgetUsage(records: readonly BenchmarkRunRecord[]): {
  readonly semanticCallCount: number
  readonly toolCallCount: number
  readonly wallClockMs: number
} {
  return records.reduce(
    (usage, record) => ({
      semanticCallCount: usage.semanticCallCount + record.semanticCallCount,
      toolCallCount: usage.toolCallCount + record.toolCallCount,
      wallClockMs: usage.wallClockMs + record.wallClockMs
    }),
    { semanticCallCount: 0, toolCallCount: 0, wallClockMs: 0 }
  )
}

function progressiveBudgetLimits(manifests: readonly BenchmarkManifest[]): {
  readonly semanticCallCount: number
  readonly toolCallCount: number
  readonly wallClockMs: number
} {
  return manifests.reduce(
    (limits, manifest) => ({
      semanticCallCount: limits.semanticCallCount + manifest.budget.maxSemanticCalls * 2,
      toolCallCount: limits.toolCallCount + manifest.budget.maxToolCalls * 2,
      wallClockMs: limits.wallClockMs + manifest.budget.wallClockMs * 2
    }),
    { semanticCallCount: 0, toolCallCount: 0, wallClockMs: 0 }
  )
}

function progressiveBudgetExceeded(
  records: readonly BenchmarkRunRecord[],
  manifests: readonly BenchmarkManifest[]
): boolean {
  const usage = progressiveBudgetUsage(records)
  const limits = progressiveBudgetLimits(manifests)
  return (
    usage.semanticCallCount > limits.semanticCallCount ||
    usage.toolCallCount > limits.toolCallCount ||
    usage.wallClockMs > limits.wallClockMs
  )
}

function progressiveStopReason(reason: string): string {
  return reason
    .replace(/(?:\/private)?\/(?:tmp|var\/folders|Users)\/[^\s"'<>]+/g, '<absolute-path>')
    .replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, '<absolute-path>')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer <redacted>')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '<redacted>')
    .slice(0, 240)
}

export async function runProgressiveWaveA(
  options: ProgressiveWaveAOptions
): Promise<ProgressiveWaveAResult> {
  const manifests = selectWaveAManifests(options.manifests)
  if (options.baselineSha.trim().length === 0) {
    throw new Error('wave_a_baseline_sha_required')
  }
  const outputDirectory = options.outputDirectory ?? join(
    options.researchRoot,
    '.live-output',
    'wave-a'
  )
  const injectedExecutor = options.executeTask
  const authorized = options.providerExecutionAuthorized === true ||
    (options.providerExecutionAuthorized === undefined && injectedExecutor !== undefined)
  if (options.resume === true && options.providerExecutionAuthorized !== true) {
    throw new Error('wave_a_resume_authorization_required')
  }
  if (injectedExecutor === undefined && !authorized) {
    return {
      records: [],
      skipped: true,
      skipReason: 'provider_execution_not_authorized',
      status: 'SKIPPED',
      stopReason: null,
      outputPath: null,
      checkpointDirectory: null,
      completedPairs: 0
    }
  }

  const runId = options.runId ?? `wave-a-${Date.now()}-${randomUUID()}`
  if (!isSafeProgressiveRunId(runId)) throw new Error('wave_a_run_id_invalid')
  await mkdir(outputDirectory, { recursive: true })
  const checkpointDirectory = join(outputDirectory, runId)
  let checkpointExists = false
  try {
    const existing = await stat(checkpointDirectory)
    checkpointExists = existing.isDirectory()
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  if (checkpointExists && options.resume !== true) {
    throw new Error('wave_a_run_identity_exists')
  }
  if (!checkpointExists && options.resume === true) {
    throw new Error('wave_a_checkpoint_missing')
  }
  if (!checkpointExists) await mkdir(checkpointDirectory)

  const credentialValue = options.credentialValue ?? (
    injectedExecutor === undefined ? process.env['DEEPSEEK_API_KEY'] : undefined
  )
  const checkpointStore = new ProgressiveWaveACheckpointStore(
    checkpointDirectory,
    runId,
    options.checkpointWriteInterceptor
  )
  const checkpointManifest = buildProgressiveCheckpointManifest(
    runId,
    options.baselineSha,
    manifests
  )
  let records: BenchmarkRunRecord[] = []
  let completedPairs: string[] = []
  let recoveredRecordLag = false

  if (checkpointExists) {
    const checkpointReadInput = {
      directory: checkpointDirectory,
      runId,
      baselineSha: options.baselineSha,
      manifests
    } as const
    const snapshot = await readProgressiveWaveACheckpoint(
      credentialValue === undefined
        ? checkpointReadInput
        : { ...checkpointReadInput, credentialValue }
    )
    if (snapshot.progress.status !== 'RUNNING') {
      throw new Error('wave_a_checkpoint_terminal')
    }
    records = [...snapshot.records]
    completedPairs = [...snapshot.progress.completedPairs]
    recoveredRecordLag = snapshot.recoveredRecordLag
  } else {
    await checkpointStore.writeManifest(checkpointManifest)
    const writtenManifest = await checkpointStore.readManifest()
    if (JSON.stringify(writtenManifest) !== JSON.stringify(checkpointManifest)) {
      throw new Error('wave_a_checkpoint_manifest_reverify_failed')
    }
    await checkpointStore.writeRecords(records, completedPairs.length)
    const initialRecords = await checkpointStore.readRecords()
    if (initialRecords.length !== 0) throw new Error('wave_a_checkpoint_records_reverify_failed')
    const initialProgress = checkpointProgressFor(
      checkpointManifest,
      records,
      completedPairs,
      'RUNNING',
      null
    )
    await checkpointStore.writeProgress(initialProgress)
    const writtenProgress = await checkpointStore.readProgress()
    if (JSON.stringify(writtenProgress) !== JSON.stringify(initialProgress)) {
      throw new Error('wave_a_checkpoint_progress_reverify_failed')
    }
  }

  const stop = async (reason: string): Promise<ProgressiveWaveAResult> => {
    let finalReason = progressiveStopReason(reason)
    const terminalProgress = checkpointProgressFor(
      checkpointManifest,
      records,
      completedPairs,
      'STOPPED',
      finalReason
    )
    try {
      await checkpointStore.writeAggregate(
        aggregateRuns(records),
        records,
        completedPairs.length,
        'STOPPED',
        checkpointManifest.baselineSha,
        finalReason
      )
    } catch {
      finalReason = 'checkpoint_persistence_failed'
    }
    try {
      await checkpointStore.writeProgress({ ...terminalProgress, stopReason: finalReason })
      const reread = await checkpointStore.readProgress()
      if (JSON.stringify(reread) !== JSON.stringify({ ...terminalProgress, stopReason: finalReason })) {
        finalReason = 'checkpoint_persistence_failed'
      }
    } catch {
      finalReason = 'checkpoint_persistence_failed'
    }
    return {
      records,
      skipped: false,
      skipReason: null,
      status: 'STOPPED',
      stopReason: finalReason,
      outputPath: checkpointStore.paths.records,
      checkpointDirectory,
      completedPairs: completedPairs.length
    }
  }

  let executeTask = injectedExecutor
  if (executeTask === undefined) {
    let runtime: ModelRuntime
    try {
      runtime = await ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false })
      const apiKey = process.env['DEEPSEEK_API_KEY']
      if (apiKey !== undefined && apiKey.length > 0) {
        await runtime.setRuntimeApiKey(DEEPSEEK_PROVIDER, apiKey)
      }
      const providers = [...new Set(manifests.map((manifest) => manifest.modelProfile.provider))]
      for (const provider of providers) {
        const auth = await runtime.checkAuth(provider)
        if (auth === undefined) return stop('provider_credentials_unavailable')
      }
      for (const manifest of manifests) {
        const model = runtime.getModel(manifest.modelProfile.provider, manifest.modelProfile.model)
        if (model === undefined) {
          return stop(`model_unavailable:${manifest.modelProfile.provider}/${manifest.modelProfile.model}`)
        }
      }
    } catch {
      return stop('provider_runtime_unavailable')
    }
    executeTask = (task) => runLiveTask(
      task.researchRoot,
      task.manifest,
      task.strategy,
      task.repetition,
      runtime
    )
  }

  if (recoveredRecordLag) {
    try {
      const recoveredProgress = checkpointProgressFor(
        checkpointManifest,
        records,
        completedPairs,
        'RUNNING',
        null
      )
      await checkpointStore.writeProgress(recoveredProgress)
      const reread = await checkpointStore.readProgress()
      if (JSON.stringify(reread) !== JSON.stringify(recoveredProgress)) {
        return stop('checkpoint_persistence_failed')
      }
    } catch {
      return stop('checkpoint_persistence_failed')
    }
  }

  const expectedRecords = checkpointManifest.expectedScope.records
  const manifestByTaskId = new Map(manifests.map((manifest) => [manifest.taskId, manifest]))

  for (let index = records.length; index < expectedRecords.length; index += 1) {
    const expected = expectedRecords[index]
    if (expected === undefined) return stop('wave_a_scope_exhausted')
    const manifest = manifestByTaskId.get(expected.taskId)
    if (manifest === undefined) return stop('wave_a_manifest_lookup_failed')
    if (progressiveBudgetExceeded(records, manifests)) {
      return stop('approved_budget_upper_bound_exceeded')
    }

    let record: BenchmarkRunRecord
    try {
      record = await executeTask({
        researchRoot: options.researchRoot,
        manifest,
        strategy: expected.strategy,
        repetition: WAVE_A_REPETITIONS
      })
    } catch {
      return stop('provider_task_execution_failed')
    }

    const safe = checkpointRecordsMetadataOnly([record], credentialValue)
    if (!safe) return stop('durable_evidence_unsafe')
    const nextRecords = [...records, record]
    try {
      await checkpointStore.writeRecords(nextRecords, completedPairs.length)
      const rereadRecords = await checkpointStore.readRecords()
      if (
        JSON.stringify(checkpointRecordHashes(rereadRecords)) !==
          JSON.stringify(checkpointRecordHashes(nextRecords)) ||
        JSON.stringify(rereadRecords.map((entry) => entry.runId)) !==
          JSON.stringify(nextRecords.map((entry) => entry.runId))
      ) {
        return stop('checkpoint_record_reverify_failed')
      }
    } catch {
      return stop('checkpoint_persistence_failed')
    }
    records = nextRecords

    const recordValid =
      recordMatchesProgressiveIdentity(record, expected, manifests) &&
      benchmarkRecordIsValid(record) &&
      recordWithinManifestBudget(record, manifest)
    if (!recordValid) return stop('record_gate_failed')
    if (progressiveBudgetExceeded(records, manifests)) {
      return stop('approved_budget_upper_bound_exceeded')
    }

    if (index % 2 === 1) {
      const pair = records.slice(index - 1, index + 1)
      const pairGate = evaluateWaveAPairGate(pair, credentialValue)
      if (pairGate.status !== 'PASS') {
        return stop(`pair_gate_failed:${pairGate.failedChecks.join(',')}`)
      }
      completedPairs = [...completedPairs, expected.taskId]
    }

    const runningProgress = checkpointProgressFor(
      checkpointManifest,
      records,
      completedPairs,
      'RUNNING',
      null
    )
    try {
      await checkpointStore.writeProgress(runningProgress)
      const rereadProgress = await checkpointStore.readProgress()
      if (JSON.stringify(rereadProgress) !== JSON.stringify(runningProgress)) {
        return stop('checkpoint_progress_reverify_failed')
      }
    } catch {
      return stop('checkpoint_persistence_failed')
    }
  }

  const finalGate = evaluateWaveAGate(records, credentialValue)
  if (finalGate.status !== 'PASS') {
    const failedChecks = Object.entries(finalGate.checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name)
    return stop(`wave_a_gate_failed:${failedChecks.join(',')}`)
  }

  const aggregate = aggregateRuns(records)
  try {
    await checkpointStore.writeAggregate(
      aggregate,
      records,
      completedPairs.length,
      'PASS',
      checkpointManifest.baselineSha,
      null
    )
    const passProgress = checkpointProgressFor(
      checkpointManifest,
      records,
      completedPairs,
      'PASS',
      null
    )
    await checkpointStore.writeProgress(passProgress)
    const rereadProgress = await checkpointStore.readProgress()
    if (JSON.stringify(rereadProgress) !== JSON.stringify(passProgress)) {
      return stop('checkpoint_progress_reverify_failed')
    }
  } catch {
    return stop('checkpoint_persistence_failed')
  }
  return {
    records,
    skipped: false,
    skipReason: null,
    status: 'PASS',
    stopReason: null,
    outputPath: checkpointStore.paths.records,
    checkpointDirectory,
    completedPairs: completedPairs.length
  }
}
