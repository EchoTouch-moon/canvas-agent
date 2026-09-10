import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { mkdir, open, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { RunKillSwitch } from '@canvas-agent/pi-context-integration/experimental'
import { createRunKillSwitch } from '@canvas-agent/pi-context-integration/experimental'
import {
  C1_E0_ENROLLMENT_COHORT,
  C1_E0_ENDPOINT,
  C1_E0_MODEL,
  C1_E0_NODE_RANGE,
  C1_E0_PAIR_COUNT,
  C1_E0_PROVIDER,
  C1_E0_PROVIDER_CONFIG_HASH,
  C1_E0_RUN_CONTRACT_ID,
  C1_E0_TOTAL_LEG_COUNT,
  hashCanonicalC1E0,
  loadC1E0EnrollmentManifest,
  loadC1E0RunContract,
  type C1E0EnrollmentManifest,
  type C1E0RunContract
} from './c1-e0-binding'
import {
  aggregateC1E0Dose,
  validateC1E0DoseObservation,
  type C1E0DoseObservation,
  type C1E0DoseSummary
} from './c1-e0-dose'
import {
  classifyC1E0ResponseEvidence,
  evaluateC1E0BatchQualification,
  evaluateC1E0TreatmentIntegrity,
  type C1E0BatchQualificationResult,
  type C1E0RuntimePolicyInput
} from './c1-e0-readiness'
import {
  C1AuthorizedProviderResponseSource,
  type C1AuthorizedProviderResponseSourceOptions
} from './c1-authorized-provider'
import {
  evaluateC1E0ProviderBoundary,
  buildC1E0ExecutionPlans,
  type C1E0ExecutionPlan
} from './c1-e0-execution-runner'
import {
  applyC1SupersededVersionPolicy,
  c1SupersededVersionCommittedKeys,
  type C1LifecycleUnknown
} from './c1-superseded-version-policy'
import {
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingDriver,
  C1SandboxToolExecutor,
  appendC1LiveResponseToObservation,
  type C1LiveBindingEvidence,
  type C1LiveBindingLegResult,
  type C1LiveModelResponse,
  type C1LiveObservationSource,
  type C1LiveResponseSource,
  type C1LiveResponseSourceKind,
  type C1LiveUsage
} from './c1-live-binding'
import {
  C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE,
  C1HardBudgetGuard,
  C1PreflightFailure,
  C1_PROVIDER_ENDPOINT,
  C1_PROVIDER_ID,
  C1_MODEL_ID,
  assertC1StrictProviderBinding,
  changedC1FixturePaths,
  computeC1FixtureContentSummary,
  loadC1FrozenStudy,
  materializeFreshC1Fixture,
  nodeVersionSatisfiesC1Range,
  prepareC1StrictProvider,
  snapshotC1Fixture,
  verifyC1FixtureBinding,
  writableScopePass,
  type C1AgentObservation,
  type C1LegExecutionResult,
  type C1PreflightTask,
  type C1ProviderMetric,
  type C1SignalSource,
  type C1StrictProviderBinding
} from './c1-live-preflight'
import {
  assertC1LiveWorktreeClean,
  C1LiveTaskObservationSource,
  runC1TaskOracles,
  type C1TaskEvaluation
} from './c1-live-study'
import { buildSanitizedChildEnvironment, runProcess } from './fixture-generator'

/**
 * Final E0 wiring is intentionally a separate surface from the credential-free
 * state-machine runner. This module consumes the frozen scheduler/driver and
 * supplies natural lifecycle evidence, post-leg oracles, and provenance
 * projection. It never reads a credential or opens a Provider connection by
 * itself.
 */
export const C1_E0_FINAL_LIVE_BINDING_ID = 'C1_EFFECTIVENESS_E0_LIVE_BINDING_V1'
export const C1_E0_FINAL_LIVE_BINDING_MODE = 'NO_PROVIDER_EXECUTION' as const
export const C1_E0_FINAL_LIVE_BINDING_SCHEMA_VERSION = 1 as const
/** Fixed harness context; task ground truth never chooses the initial read. */
export const C1_E0_NEUTRAL_BOOTSTRAP_FILES = Object.freeze(['README.md'] as const)

const E0_STUDY_ID_PATTERN = /^c1-e0-\d{8}-[0-9a-f]{8}$/
const E0_RUN_ID_PATTERN = /^c1-e0-\d{8}-c1-e0-\d{2}-(?:NATIVE|RUNTIME)-[0-9a-f]{8}$/
const E0_FAKE_CREDENTIAL = 'c1-e0-live-binding-in-memory-sentinel'
const E0_ARTIFACT_NAMES = Object.freeze([
  'checkpoints.jsonl',
  'checkpoint-summary.json',
  'study-events.jsonl',
  'response-ledger.jsonl',
  'dose-evidence.jsonl',
  'pair-adjudication.jsonl',
  'batch-qualification.json',
  'run-manifest.json'
] as const)

type E0ArtifactName = (typeof E0_ARTIFACT_NAMES)[number]

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

function failureOf(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof C1PreflightFailure) return { code: error.code, message: error.message }
  return {
    code: 'PREFLIGHT_FAILURE',
    message: error instanceof Error ? error.message : String(error)
  }
}

function assertE0StudyId(value: string): void {
  if (!E0_STUDY_ID_PATTERN.test(value)) {
    throw new C1PreflightFailure('IDENTITY_INVALID', `invalid E0 study identity ${value}`)
  }
}

function assertE0RunId(value: string): void {
  if (!E0_RUN_ID_PATTERN.test(value)) {
    throw new C1PreflightFailure('IDENTITY_INVALID', `invalid E0 run identity ${value}`)
  }
}

function createE0StudyId(now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '')
  return `c1-e0-${date}-${randomBytes(4).toString('hex')}`
}

function alreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'EEXIST'
  )
}

async function claimE0StudyDir(outputRoot: string, studyId: string): Promise<string> {
  assertE0StudyId(studyId)
  const reportDir = join(outputRoot, studyId)
  await mkdir(outputRoot, { recursive: true })
  try {
    await mkdir(reportDir)
  } catch (error) {
    if (alreadyExists(error)) {
      throw new C1PreflightFailure(
        'IDENTITY_REUSE',
        `E0 study identity ${studyId} is already claimed`
      )
    }
    throw error
  }
  await mkdir(join(reportDir, 'legs'))
  return reportDir
}

async function claimE0LegDir(reportDir: string, runId: string): Promise<string> {
  assertE0RunId(runId)
  const legDir = join(reportDir, 'legs', runId)
  try {
    await mkdir(legDir)
  } catch (error) {
    if (alreadyExists(error)) {
      throw new C1PreflightFailure('IDENTITY_REUSE', `E0 leg identity ${runId} is already claimed`)
    }
    throw error
  }
  return legDir
}

/** Headless research surface; Electron and documentation are deliberately excluded. */
export const C1_E0_EXECUTION_SURFACE_PATHS = Object.freeze([
  'research/context-benchmarks/src',
  'research/context-benchmarks/package.json',
  'packages/context-runtime',
  'packages/pi-context-integration',
  'packages/contracts',
  'packages/domain',
  'packages/persistence',
  'packages/worker-runtime',
  'packages/repository-observer',
  'packages/codex-context-integration',
  'packages/context-conformance',
  'package.json',
  'pnpm-lock.yaml'
] as const)

async function gitExecutableRevision(repoRoot: string): Promise<string> {
  const result = await runProcess(
    'git',
    ['log', '-1', '--format=%H', '--', ...C1_E0_EXECUTION_SURFACE_PATHS],
    {
      cwd: repoRoot,
      timeoutMs: 30_000,
      env: buildSanitizedChildEnvironment()
    }
  )
  const revision = result.stdout.trim()
  if (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.outputLimitExceeded ||
    !/^[0-9a-f]{40}$/.test(revision)
  ) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'unable to resolve the exact E0 final live-binding executable revision'
    )
  }
  return revision
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Hash every tracked file in the headless research execution surface. */
export async function computeC1E0ExecutionSurfaceHash(repoRoot: string): Promise<string> {
  const result = await runProcess(
    'git',
    ['ls-files', '-z', '--', ...C1_E0_EXECUTION_SURFACE_PATHS],
    {
      cwd: repoRoot,
      timeoutMs: 30_000,
      env: buildSanitizedChildEnvironment()
    }
  )
  if (result.exitCode !== 0 || result.timedOut || result.outputLimitExceeded) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'unable to enumerate the headless E0 execution surface'
    )
  }
  const files = result.stdout
    .split('\0')
    .filter((path) => path.length > 0)
    .sort()
  if (files.length === 0) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'headless E0 execution surface contains no tracked files'
    )
  }
  const rows: string[] = []
  for (const path of files) {
    rows.push(`${sha256Bytes(await readFile(join(repoRoot, path)))}  ${path}`)
  }
  return sha256(`${rows.join('\n')}\n`)
}

export async function computeC1E0ExecutionBinding(repoRoot: string): Promise<{
  readonly executionRevision: string
  readonly executionSurfaceHash: string
}> {
  const [executionRevision, executionSurfaceHash] = await Promise.all([
    gitExecutableRevision(repoRoot),
    computeC1E0ExecutionSurfaceHash(repoRoot)
  ])
  return { executionRevision, executionSurfaceHash }
}

async function loadE0Tasks(
  repoRoot: string,
  enrollment: C1E0EnrollmentManifest
): Promise<ReadonlyMap<string, C1PreflightTask>> {
  const frozen = await loadC1FrozenStudy(repoRoot)
  const byId = new Map(frozen.tasks.map((task) => [task.taskId, task]))
  const selected = new Map<string, C1PreflightTask>()
  for (const candidate of enrollment.candidates) {
    if (!enrollment.selectedTaskIds.includes(candidate.taskId)) continue
    const task = byId.get(candidate.taskId)
    if (task === undefined) {
      throw new C1PreflightFailure(
        'MANIFEST_BINDING_MISMATCH',
        `E0 selected task is absent from the frozen task manifest: ${candidate.taskId}`
      )
    }
    if (
      candidate.fixtureTreeObjectId !== task.fixtureRevision.fixtureTreeObjectId ||
      candidate.fixtureContentSha256 !== task.fixtureRevision.fixtureContentSha256 ||
      candidate.promptSha256 !== task.promptSha256 ||
      candidate.objectiveOracleSha256 !== hashCanonicalC1E0(task.objectiveOracle) ||
      candidate.regressionOracleSha256 !== hashCanonicalC1E0(task.regressionOracle)
    ) {
      throw new C1PreflightFailure(
        'MANIFEST_BINDING_MISMATCH',
        `E0 enrollment candidate binding drifted for ${candidate.taskId}`
      )
    }
    selected.set(candidate.taskId, task)
  }
  if (selected.size !== new Set(enrollment.selectedTaskIds).size) {
    throw new C1PreflightFailure(
      'MANIFEST_BINDING_MISMATCH',
      'E0 selected task set could not be reconstructed from the frozen manifest'
    )
  }
  return selected
}

function fixtureVersionProbe(fixtureRoot: string, path: string): string | undefined {
  const absolute = resolve(fixtureRoot, path)
  if (absolute !== fixtureRoot && !absolute.startsWith(`${resolve(fixtureRoot)}${sep}`)) {
    return undefined
  }
  try {
    return createHash('sha256').update(readFileSync(absolute)).digest('hex')
  } catch {
    return undefined
  }
}

/**
 * Natural observation source for E0. The Runtime policy sees only the model
 * message/tool stream, successful tool results, and a private content probe.
 * No task labels, expected paths, references, or oracle output enter policy.
 */
export class C1E0NaturalObservationSource implements C1LiveObservationSource {
  readonly initialObservation: C1AgentObservation
  private readonly unknowns: C1LifecycleUnknown[] = []
  private readonly unknownsByCall = new Map<number, Readonly<Record<string, number>>>()

  private constructor(
    initialObservation: C1AgentObservation,
    private readonly fixtureRoot: string,
    private readonly arm: 'NATIVE' | 'RUNTIME'
  ) {
    this.initialObservation = initialObservation
  }

  static async fromFixture(input: {
    readonly task: C1PreflightTask
    readonly runId: string
    readonly fixtureRoot: string
    readonly arm: 'NATIVE' | 'RUNTIME'
    readonly bootstrapFiles?: readonly string[]
  }): Promise<C1E0NaturalObservationSource> {
    const bootstrapFiles = input.bootstrapFiles ?? C1_E0_NEUTRAL_BOOTSTRAP_FILES
    if (
      JSON.stringify(bootstrapFiles) !== JSON.stringify(C1_E0_NEUTRAL_BOOTSTRAP_FILES) ||
      bootstrapFiles.length === 0
    ) {
      throw new C1PreflightFailure(
        'CONTRACT_BINDING_MISMATCH',
        'E0 natural lifecycle requires the fixed neutral README bootstrap; task ground truth cannot seed exposure'
      )
    }
    const base = await C1LiveTaskObservationSource.fromFixture({
      task: input.task,
      runId: input.runId,
      fixtureRoot: input.fixtureRoot,
      bootstrapFiles
    })
    return new C1E0NaturalObservationSource(base.initialObservation, input.fixtureRoot, input.arm)
  }

  unknownsForCall(callOrdinal: number): Readonly<Record<string, number>> {
    return this.unknownsByCall.get(callOrdinal) ?? {}
  }

  next(input: {
    readonly callOrdinal: number
    readonly previousObservation: C1AgentObservation
    readonly previousExecution: C1LegExecutionResult
    readonly response: C1LiveModelResponse
    readonly toolObservation?: C1AgentObservation
  }): C1AgentObservation {
    const observed =
      input.toolObservation ??
      appendC1LiveResponseToObservation(
        input.previousObservation,
        input.response,
        `${input.previousObservation.observationId}-after-${input.callOrdinal}`
      )
    const previousWorkingSetId = input.previousExecution.workingSet?.workingSetId ?? null
    if (this.arm === 'NATIVE') {
      return { ...observed, previousWorkingSetId }
    }
    const beforeUnknowns = this.unknowns.length
    const nextObservation = applyC1SupersededVersionPolicy(
      observed,
      c1SupersededVersionCommittedKeys(input.previousExecution),
      {
        versionProbe: (path) => fixtureVersionProbe(this.fixtureRoot, path),
        unknownSink: this.unknowns
      }
    )
    const callUnknowns = this.unknowns.slice(beforeUnknowns)
    if (callUnknowns.length > 0) {
      const counts: Record<string, number> = {}
      for (const unknown of callUnknowns) counts[unknown.reason] = (counts[unknown.reason] ?? 0) + 1
      this.unknownsByCall.set(input.callOrdinal, Object.freeze(counts))
    }
    return { ...nextObservation, previousWorkingSetId }
  }
}

function lifecyclePairIdsForSourceKeys(sourceKeys: readonly string[]): readonly string[] {
  const pairs = new Map<string, { call?: string; result?: string }>()
  for (const sourceKey of sourceKeys) {
    if (sourceKey.startsWith('run/tool-call://')) {
      const id = sourceKey.slice('run/tool-call://'.length)
      const pair = pairs.get(id) ?? {}
      pair.call = sourceKey
      pairs.set(id, pair)
    } else if (sourceKey.startsWith('run/tool-result://')) {
      const id = sourceKey.slice('run/tool-result://'.length)
      const pair = pairs.get(id) ?? {}
      pair.result = sourceKey
      pairs.set(id, pair)
    }
  }
  const ids: string[] = []
  for (const [id, pair] of pairs) {
    if (pair.call === undefined || pair.result === undefined) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `E0 live removal source pair is incomplete for tool call ${id}`
      )
    }
    ids.push(`c1-lifecycle-${sha256(`${pair.call}|${pair.result}`)}`)
  }
  return uniqueSorted(ids)
}

function decisionReasonCount(evidence: C1LiveBindingEvidence, pattern: RegExp): number {
  return (evidence.decisionDetails ?? []).reduce(
    (total, detail) => total + detail.reasonCodes.filter((reason) => pattern.test(reason)).length,
    0
  )
}

/** Project Dose only from actual REMOVE/carry transition evidence in a leg. */
export function projectC1E0LiveDose(input: {
  readonly plan: C1E0ExecutionPlan
  readonly result: C1LiveBindingLegResult
  readonly unknownsForCall?: (callOrdinal: number) => Readonly<Record<string, number>>
}): readonly C1E0DoseObservation[] {
  const seenNewRemovals = new Set<string>()
  const rows: C1E0DoseObservation[] = []
  for (const row of input.result.evidence) {
    const removedSourceKeys = uniqueSorted([
      ...(row.decisionDetails ?? [])
        .filter((detail) => detail.kind === 'REMOVE')
        .map((detail) => detail.sourceKey),
      ...(row.carriedRemovedSourceKeys ?? [])
    ])
    const removedPairIds = lifecyclePairIdsForSourceKeys(removedSourceKeys)
    const carriedPairIds = lifecyclePairIdsForSourceKeys(row.carriedRemovedSourceKeys ?? [])
    const eligiblePairIds = removedPairIds
    const newRemovalPairIds = removedPairIds.filter((pairId) => !seenNewRemovals.has(pairId))
    for (const pairId of newRemovalPairIds) seenNewRemovals.add(pairId)
    const preHash = row.prePolicyProviderBoundMessagesHash
    const postHash = row.postPolicyProviderBoundMessagesHash
    if (preHash === undefined || postHash === undefined) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `E0 live leg ${input.plan.runId} lacks same-composition provider-bound hashes`
      )
    }
    rows.push(
      validateC1E0DoseObservation({
        schemaId: 'C1_EFFECTIVENESS_DOSE_V1',
        schemaVersion: 1,
        experimentPairId: input.plan.pairId,
        callOrdinal: row.callOrdinal,
        prePolicyProviderBoundMessagesHash: preHash,
        postPolicyProviderBoundMessagesHash: postHash,
        uniqueEligiblePairIds: eligiblePairIds,
        uniqueSelectedPairIds: eligiblePairIds,
        uniqueRemovedPairIds: removedPairIds,
        uniqueRemovedSourceElementKeys: removedSourceKeys,
        newRemovalPairIds,
        carriedRemovalPairIds: carriedPairIds,
        suppressedStalePairIds: removedPairIds,
        suppressedStalePairCallExposures: removedPairIds.length,
        suppressedSourceElementCallExposures: removedSourceKeys.length,
        tokensBeforeComposition: 'UNAVAILABLE',
        tokensAfterComposition: 'UNAVAILABLE',
        removedBytes: 'UNAVAILABLE',
        removedTokens: 'UNAVAILABLE',
        activeStaleElements: removedPairIds.length,
        rehydrateCount: row.transitionDecisionKinds.filter((kind) => kind === 'REHYDRATE').length,
        lifecycleUnknownCountByReason: input.unknownsForCall?.(row.callOrdinal) ?? {},
        protectedRemovalCount: decisionReasonCount(row, /PROTECTED|VERIFICATION|RECENT_EVIDENCE/i),
        contractConflictCount: decisionReasonCount(row, /CONTRACT|CONFLICT|REPLAY/i),
        runtimeContextChanged: row.runtimeContextChanged
      })
    )
  }
  return Object.freeze(rows)
}

function metricSum(
  values: readonly C1LiveUsage[],
  key: 'inputTokens' | 'outputTokens' | 'totalTokens'
): number | 'UNAVAILABLE' {
  if (values.some((usage) => usage.usageSource !== 'PROVIDER_REPORTED')) return 'UNAVAILABLE'
  return values.reduce((sum, usage) => sum + usage[key], 0)
}

function taggedMetricSum(
  values: readonly C1LiveUsage[],
  key: 'cacheReadTokens' | 'cacheWriteTokens'
): number | 'UNAVAILABLE' {
  const metrics: (C1ProviderMetric | null)[] = values.map((usage) => {
    if (usage.usageSource !== 'PROVIDER_REPORTED') return null
    return usage[key]
  })
  if (metrics.some((metric) => metric === null)) return 'UNAVAILABLE'
  if (metrics.some((metric) => metric?.status !== 'REPORTED')) return 'UNAVAILABLE'
  return metrics.reduce(
    (sum, metric) => sum + (metric?.status === 'REPORTED' ? metric.value : 0),
    0
  )
}

export interface C1E0EfficiencyProvenance {
  readonly responseReceipt: 'OBSERVED' | 'UNKNOWN'
  readonly providerUsage: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN'
  readonly usageSource: 'PROVIDER_REPORTED' | 'SCRIPTED_FAKE' | 'MIXED' | 'UNKNOWN'
  readonly inputTokens: number | 'UNAVAILABLE'
  readonly outputTokens: number | 'UNAVAILABLE'
  readonly cacheReadTokens: number | 'UNAVAILABLE'
  readonly cacheWriteTokens: number | 'UNAVAILABLE'
  readonly totalTokens: number | 'UNAVAILABLE'
  readonly latencyMs: number | 'UNAVAILABLE'
}

/** Numeric efficiency fields remain unavailable for scripted substitutes. */
export function summarizeC1E0Efficiency(
  evidence: readonly C1LiveBindingEvidence[]
): C1E0EfficiencyProvenance {
  if (evidence.length === 0) {
    return {
      responseReceipt: 'UNKNOWN',
      providerUsage: 'UNKNOWN',
      usageSource: 'UNKNOWN',
      inputTokens: 'UNAVAILABLE',
      outputTokens: 'UNAVAILABLE',
      cacheReadTokens: 'UNAVAILABLE',
      cacheWriteTokens: 'UNAVAILABLE',
      totalTokens: 'UNAVAILABLE',
      latencyMs: 'UNAVAILABLE'
    }
  }
  const sources = new Set(evidence.map((row) => row.usage.usageSource))
  const usageSource = sources.size === 1 ? [...sources][0]! : 'MIXED'
  const provider = evidence.every((row) => row.usage.usageSource === 'PROVIDER_REPORTED')
  return {
    responseReceipt: 'OBSERVED',
    providerUsage: provider ? 'AVAILABLE' : 'UNAVAILABLE',
    usageSource,
    inputTokens: metricSum(
      evidence.map((row) => row.usage),
      'inputTokens'
    ),
    outputTokens: metricSum(
      evidence.map((row) => row.usage),
      'outputTokens'
    ),
    cacheReadTokens: taggedMetricSum(
      evidence.map((row) => row.usage),
      'cacheReadTokens'
    ),
    cacheWriteTokens: taggedMetricSum(
      evidence.map((row) => row.usage),
      'cacheWriteTokens'
    ),
    totalTokens: metricSum(
      evidence.map((row) => row.usage),
      'totalTokens'
    ),
    // The current capture contract does not expose latency; do not infer it.
    latencyMs: 'UNAVAILABLE'
  }
}

export interface C1E0AuthorizedProviderSourceOptions extends Omit<
  C1AuthorizedProviderResponseSourceOptions,
  'providerConfigHashOverride'
> {}

/**
 * Prepare the authorized Step Plan response source without reading a
 * credential. The caller must supply the memory-only key explicitly; this
 * function performs no request until the returned source is driven.
 */
export function createC1E0AuthorizedProviderResponseSource(
  options: C1E0AuthorizedProviderSourceOptions
): C1AuthorizedProviderResponseSource {
  assertC1StrictProviderBinding(options.providerBinding.experimentBinding)
  return new C1AuthorizedProviderResponseSource({
    ...options,
    providerConfigHashOverride: C1_E0_PROVIDER_CONFIG_HASH
  })
}

export interface C1E0LiveBindingLegFactoryInput {
  readonly studyId: string
  readonly plan: C1E0ExecutionPlan
  readonly task: C1PreflightTask
  readonly fixtureRoot: string
  readonly legDir: string
  readonly providerBinding: C1StrictProviderBinding
  readonly bootstrapFiles: typeof C1_E0_NEUTRAL_BOOTSTRAP_FILES
  readonly killSwitch: RunKillSwitch
  readonly responseAbortSignal: AbortSignal
}

export type C1E0LiveResponseSourceFactory = (
  input: C1E0LiveBindingLegFactoryInput
) => C1LiveResponseSource | Promise<C1LiveResponseSource>

export interface C1E0FinalLiveBindingOptions {
  readonly repoRoot?: string
  readonly outputRoot?: string
  readonly studyId?: string
  readonly now?: Date
  readonly signalSource?: C1SignalSource
  readonly maxCalls?: number
  /** Test-only escape hatch for hosts that cannot provide the frozen Node 24 runtime. */
  readonly allowUnsupportedNodeForTests?: boolean
  /** Explicit scripted substitute; no default can reach a Provider. */
  readonly responseSourceFactory: C1E0LiveResponseSourceFactory
}

export interface C1E0LiveAuthorization {
  readonly decision: 'AUTHORIZED'
  readonly studyId: string
  readonly executionRevision: string
  readonly executionSurfaceHash: string
  readonly runContractSha256: string
  readonly enrollmentManifestSha256: string
  readonly providerConfigHash: string
}

export interface C1E0AuthorizedLiveBindingOptions {
  readonly repoRoot?: string
  readonly outputRoot?: string
  readonly authorization: C1E0LiveAuthorization
  /** Memory-only credential; this module never reads it from the environment. */
  readonly apiKey: string
  readonly fetchImpl?: typeof fetch
  readonly requestTimeoutMs?: number
  readonly signalSource?: C1SignalSource
  readonly maxCalls?: number
  /** Test-only path for the current freeze-prep contract, never for live use. */
  readonly allowPendingContractForTests?: boolean
}

interface C1E0StudyRunnerOptions {
  readonly repoRoot?: string
  readonly outputRoot?: string
  readonly studyId?: string
  readonly now?: Date
  readonly signalSource?: C1SignalSource
  readonly maxCalls?: number
  readonly allowUnsupportedNodeForTests?: boolean
  readonly executionMode: string
  readonly responseSourceKind: C1LiveResponseSourceKind
  readonly requireNoProvider: boolean
  readonly responseSourceFactory: C1E0LiveResponseSourceFactory
  readonly prepareProvider: (studyId: string) => Promise<C1StrictProviderBinding>
  readonly providerCalls: () => number
  readonly networkRequests: () => number
  readonly authorization?: C1E0LiveAuthorization
  readonly allowPendingContractForTests?: boolean
}

function assertC1E0Authorization(value: C1E0LiveAuthorization): void {
  if (
    value.decision !== 'AUTHORIZED' ||
    !E0_STUDY_ID_PATTERN.test(value.studyId) ||
    !/^[0-9a-f]{40}$/.test(value.executionRevision) ||
    !/^[0-9a-f]{64}$/.test(value.executionSurfaceHash) ||
    !/^[0-9a-f]{64}$/.test(value.runContractSha256) ||
    !/^[0-9a-f]{64}$/.test(value.enrollmentManifestSha256) ||
    !/^[0-9a-f]{64}$/.test(value.providerConfigHash)
  ) {
    throw new C1PreflightFailure(
      'NOT_AUTHORIZED',
      'E0 authorization must bind study, execution revision, execution surface, contract, manifest, and provider hash'
    )
  }
}

export interface C1E0LiveBindingLegRecord {
  readonly legIndex: number
  readonly pairOrdinal: number
  readonly pairId: string
  readonly taskId: string
  readonly stratum: string
  readonly arm: 'NATIVE' | 'RUNTIME'
  readonly runId: string
  readonly status: 'COMPLETED' | 'FAILED' | 'BLOCKED'
  readonly responseSource: C1LiveResponseSourceKind
  readonly providerConfigHash: string
  readonly providerPreparationProfileHash: string | null
  readonly responseCalls: number
  readonly fakeProviderCallPermits: number
  readonly toolExecutions: number
  readonly finalOutcome: 'CONTINUE' | 'COMPLETE' | 'FAILED' | 'UNKNOWN'
  readonly fixtureHashVerified: boolean
  readonly fixtureCleaned: boolean
  readonly changedPaths: readonly string[]
  readonly writableScopePass: boolean
  readonly lifecycleEligibleCalls: number
  readonly runtimeContextChangedCalls: number
  readonly doseObservationCount: number
  readonly taskEvaluation?: C1TaskEvaluation
  readonly efficiency: C1E0EfficiencyProvenance
  readonly errorCode?: string
}

export interface C1E0LiveBindingPairAdjudication {
  readonly pairOrdinal: number
  readonly pairId: string
  readonly taskId: string
  readonly stratum: string
  readonly pairStatus: 'COMPLETE' | 'INCOMPLETE' | 'INVALID_FOR_BINDING'
  readonly counterpartDecision:
    'EXECUTED' | 'EXECUTED_AFTER_ISOLATED_FAILURE' | 'BLOCKED_STUDY_TERMINAL'
  readonly nativeOutcome: C1E0LiveBindingLegRecord['finalOutcome']
  readonly runtimeOutcome: C1E0LiveBindingLegRecord['finalOutcome']
  readonly runtimeDoseSummary: C1E0DoseSummary | null
  readonly treatmentIntegrity: 'PASS' | 'INACTIVE' | 'FAIL' | 'UNKNOWN'
  readonly safetyVerdict: 'PASS' | 'INACTIVE' | 'FAIL' | 'UNKNOWN'
  readonly providerBoundaryVerdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  readonly taskCorrectness: 'PASS' | 'FAIL' | 'UNKNOWN'
  readonly nativeTaskEvaluation: C1TaskEvaluation | null
  readonly runtimeTaskEvaluation: C1TaskEvaluation | null
  readonly efficiency: C1E0EfficiencyProvenance | null
  readonly exclusionReason?: string
}

export interface C1E0LiveBindingEvent {
  readonly sequence: number
  readonly event:
    | 'STUDY_PREPARED'
    | 'PAIR_STARTED'
    | 'LEG_STARTED'
    | 'LEG_COMPLETED'
    | 'LEG_FAILED'
    | 'LEG_BLOCKED'
    | 'PAIR_ADJUDICATED'
    | 'STUDY_QUALIFIED'
    | 'STUDY_TERMINATED'
  readonly pairId?: string
  readonly taskId?: string
  readonly arm?: 'NATIVE' | 'RUNTIME'
  readonly runId?: string
  readonly observedStatus: string
}

export interface C1E0LiveBindingArtifactSummary {
  readonly name: E0ArtifactName
  readonly sha256: string
  readonly bytes: number
}

export interface C1E0FinalLiveBindingReport {
  readonly bindingId: typeof C1_E0_FINAL_LIVE_BINDING_ID
  readonly schemaVersion: typeof C1_E0_FINAL_LIVE_BINDING_SCHEMA_VERSION
  readonly executionMode: string
  readonly status: 'PASS' | 'INCONCLUSIVE' | 'NO_GO'
  readonly finalBindingReady: false
  readonly studyId: string | null
  readonly reportDir: string | null
  readonly executionRevision: string | null
  readonly executionSurfaceHash: string | null
  readonly runContractId: typeof C1_E0_RUN_CONTRACT_ID
  readonly runContractCodeRevision: string | null
  readonly runContractSha256: string | null
  readonly enrollmentManifestSha256: string | null
  readonly taskManifestSha256: string | null
  readonly enrollmentCohort: typeof C1_E0_ENROLLMENT_COHORT
  readonly provider: typeof C1_E0_PROVIDER
  readonly model: typeof C1_E0_MODEL
  readonly endpoint: typeof C1_E0_ENDPOINT
  readonly nodeRange: typeof C1_E0_NODE_RANGE
  readonly providerConfigHash: string
  readonly providerPreparationProfileHash: string | null
  readonly responseSource: C1LiveResponseSourceKind
  readonly providerCalls: number
  readonly networkRequests: number
  readonly fakeProviderCallPermits: number
  readonly responseCalls: number
  readonly toolExecutions: number
  readonly legsPlanned: typeof C1_E0_TOTAL_LEG_COUNT
  readonly legsAttempted: number
  readonly legsCompleted: number
  readonly legsFailed: number
  readonly blockedLegs: number
  readonly studyTerminal: boolean
  readonly terminalReason: string | null
  readonly operatorSignal: 'SIGINT' | 'SIGTERM' | null
  readonly budget: Readonly<{
    readonly completedLegs: number
    readonly providerCalls: number
    readonly toolCalls: number
    readonly wallClockMs: number
  }> | null
  readonly batchQualification: C1E0BatchQualificationResult
  readonly pairAdjudications: readonly C1E0LiveBindingPairAdjudication[]
  readonly legs: readonly C1E0LiveBindingLegRecord[]
  readonly events: readonly C1E0LiveBindingEvent[]
  readonly failures: readonly { readonly code: string; readonly message: string }[]
  readonly artifacts: readonly C1E0LiveBindingArtifactSummary[]
}

interface InternalLeg {
  readonly plan: C1E0ExecutionPlan
  readonly task: C1PreflightTask
  readonly status: C1E0LiveBindingLegRecord['status']
  readonly responseSourceKind: C1LiveResponseSourceKind
  readonly result?: C1LiveBindingLegResult
  readonly doseObservations: readonly C1E0DoseObservation[]
  readonly providerProfileHash: string | null
  readonly changedPaths: readonly string[]
  readonly writableScopePass: boolean
  readonly fixtureHashVerified: boolean
  readonly fixtureCleaned: boolean
  readonly taskEvaluation?: C1TaskEvaluation
  readonly errorCode?: string
}

interface PairState {
  readonly assignment: C1E0ExecutionPlan
  native?: InternalLeg
  runtime?: InternalLeg
}

function runtimePolicyInputFromEvidence(
  evidence: readonly C1LiveBindingEvidence[]
): C1E0RuntimePolicyInput {
  return {
    modelVisibleMessages: evidence.map((row) => ({
      callOrdinal: row.callOrdinal,
      semanticFingerprint: row.modelVisibleSemanticContextFingerprint
    })),
    toolRequests: evidence.flatMap((row) => row.toolRequestEvidence),
    toolExecutionResults: evidence.flatMap((row) => row.toolEvents),
    versionProbeFingerprints: {},
    runtimeTransitionEvidence: evidence.map((row) => ({
      callOrdinal: row.callOrdinal,
      transitionId: row.transitionId,
      decisionKinds: row.transitionDecisionKinds,
      decisionDetails: row.decisionDetails ?? []
    })),
    carriedRemovalEvidence: evidence.flatMap((row) => row.carriedRemovalEvidence ?? [])
  }
}

function checkpointComplete(
  sink: C1JsonlLiveBindingEvidenceSink,
  runId: string,
  responseCalls: number
): boolean {
  for (let ordinal = 1; ordinal <= responseCalls; ordinal += 1) {
    const outbound = sink.checkpoints.some(
      (checkpoint) =>
        checkpoint.phase === 'OUTBOUND_PERMITTED' &&
        checkpoint.callOrdinal === ordinal &&
        checkpoint.capture.runId === runId
    )
    const received = sink.checkpoints.some(
      (checkpoint) =>
        checkpoint.phase === 'RESPONSE_RECEIVED' &&
        checkpoint.callOrdinal === ordinal &&
        checkpoint.receipt.runId === runId
    )
    const recorded = sink.checkpoints.some(
      (checkpoint) =>
        checkpoint.phase === 'RESPONSE_RECORDED' &&
        checkpoint.callOrdinal === ordinal &&
        checkpoint.evidence.runId === runId
    )
    if (!outbound || !received || !recorded) return false
  }
  return true
}

function metadataEvidence(row: C1LiveBindingEvidence): Record<string, unknown> {
  return {
    studyId: row.studyId,
    taskId: row.taskId,
    stratum: row.stratum,
    pairId: row.pairId,
    arm: row.arm,
    runId: row.runId,
    callOrdinal: row.callOrdinal,
    turnId: row.turnId,
    modelCallId: row.modelCallId,
    responseId: row.responseId,
    responseSource: row.responseSource,
    responseEvidence: classifyC1E0ResponseEvidence({
      responseRecorded: true,
      usageStatus: row.usage.usageSource === 'PROVIDER_REPORTED' ? 'AVAILABLE' : 'UNAVAILABLE'
    }),
    usageSource: row.usage.usageSource,
    providerUsage:
      row.usage.usageSource === 'PROVIDER_REPORTED'
        ? row.usage
        : { status: 'UNAVAILABLE', reason: 'SCRIPTED_FAKE' },
    toolCalls: row.toolCalls,
    toolRequestEvidence: row.toolRequestEvidence,
    toolEvents: row.toolEvents,
    provider: row.provider,
    model: row.model,
    endpoint: row.endpoint,
    providerConfigHash: row.providerConfigHash,
    contextStrategy: row.contextStrategy,
    providerBoundSourceKeys: row.providerBoundSourceKeys,
    prePolicyProviderBoundMessagesHash: row.prePolicyProviderBoundMessagesHash,
    postPolicyProviderBoundMessagesHash: row.postPolicyProviderBoundMessagesHash,
    modelVisibleSemanticContextFingerprint: row.modelVisibleSemanticContextFingerprint,
    systemDeveloperToolStructuresFingerprint: row.systemDeveloperToolStructuresFingerprint,
    workingSetId: row.workingSetId,
    transitionId: row.transitionId,
    transitionDecisionKinds: row.transitionDecisionKinds,
    decisionDetails: row.decisionDetails ?? [],
    carriedRemovedSourceKeys: row.carriedRemovedSourceKeys ?? [],
    carriedRemovalEvidence: row.carriedRemovalEvidence ?? [],
    lifecycleEligible: row.lifecycleEligible,
    runtimeContextChanged: row.runtimeContextChanged,
    fallbackSent: row.fallbackSent,
    networkSent: row.networkSent,
    replayMismatch: row.replayMismatch
  }
}

function assertMetadataOnly(
  documents: readonly { readonly name: string; readonly content: string }[]
): void {
  for (const document of documents) {
    if (
      /providerBoundMessages|argumentsJson|assistantContent|rawProviderPayload|authorizationHeader|toolResultContent/.test(
        document.content
      )
    ) {
      throw new C1PreflightFailure(
        'EVIDENCE_WRITE_FAILURE',
        `E0 live-binding artifact ${document.name} contains raw provider/tool content`
      )
    }
  }
}

async function writeDurable(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'w')
  try {
    await handle.write(content)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function artifactSummary(
  reportDir: string,
  name: E0ArtifactName
): Promise<C1E0LiveBindingArtifactSummary> {
  const content = await readFile(join(reportDir, name))
  const information = await stat(join(reportDir, name))
  return {
    name,
    sha256: createHash('sha256').update(content).digest('hex'),
    bytes: information.size
  }
}

function legRecord(input: InternalLeg, providerConfigHash: string): C1E0LiveBindingLegRecord {
  const result = input.result
  return {
    legIndex: input.plan.legIndex,
    pairOrdinal: input.plan.pairOrdinal,
    pairId: input.plan.pairId,
    taskId: input.plan.taskId,
    stratum: input.plan.stratum,
    arm: input.plan.arm,
    runId: input.plan.runId,
    status: input.status,
    responseSource: input.responseSourceKind,
    providerConfigHash,
    providerPreparationProfileHash: input.providerProfileHash,
    responseCalls: result?.evidence.length ?? 0,
    fakeProviderCallPermits: result?.providerCallPermits ?? 0,
    toolExecutions: result?.toolCalls ?? 0,
    finalOutcome: result?.finalOutcome ?? 'UNKNOWN',
    fixtureHashVerified: input.fixtureHashVerified,
    fixtureCleaned: input.fixtureCleaned,
    changedPaths: input.changedPaths,
    writableScopePass: input.writableScopePass,
    lifecycleEligibleCalls: result?.evidence.filter((row) => row.lifecycleEligible).length ?? 0,
    runtimeContextChangedCalls:
      result?.evidence.filter((row) => row.runtimeContextChanged).length ?? 0,
    doseObservationCount: input.doseObservations.length,
    ...(input.taskEvaluation === undefined ? {} : { taskEvaluation: input.taskEvaluation }),
    efficiency: summarizeC1E0Efficiency(result?.evidence ?? []),
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode })
  }
}

function pairAdjudications(input: {
  readonly assignments: readonly C1E0ExecutionPlan[]
  readonly states: ReadonlyMap<string, PairState>
  readonly evidenceSink: C1JsonlLiveBindingEvidenceSink | null
  readonly invalidated: boolean
  readonly responseSourceKind: C1LiveResponseSourceKind
}): readonly C1E0LiveBindingPairAdjudication[] {
  const byPair = new Map<string, C1E0ExecutionPlan>()
  for (const plan of input.assignments) byPair.set(plan.pairId, plan)
  return Object.freeze(
    [...byPair.values()]
      .sort((left, right) => left.pairOrdinal - right.pairOrdinal)
      .map((plan): C1E0LiveBindingPairAdjudication => {
        const state = input.states.get(plan.pairId)
        const native = state?.native
        const runtime = state?.runtime
        const nativeRecord =
          native === undefined ? null : legRecord(native, C1_E0_PROVIDER_CONFIG_HASH)
        const runtimeRecord =
          runtime === undefined ? null : legRecord(runtime, C1_E0_PROVIDER_CONFIG_HASH)
        const complete = native?.status === 'COMPLETED' && runtime?.status === 'COMPLETED'
        const runtimeDoseSummary =
          runtime === undefined || runtime.doseObservations.length === 0
            ? null
            : aggregateC1E0Dose(runtime.doseObservations)
        let treatmentIntegrity: C1E0LiveBindingPairAdjudication['treatmentIntegrity'] = 'UNKNOWN'
        let providerBoundaryVerdict: C1E0LiveBindingPairAdjudication['providerBoundaryVerdict'] =
          'UNKNOWN'
        if (
          runtime?.result !== undefined &&
          runtimeDoseSummary !== null &&
          input.evidenceSink !== null
        ) {
          const evidence = runtime.result.evidence
          const providerBoundary = evaluateC1E0ProviderBoundary(evidence, input.responseSourceKind)
          providerBoundaryVerdict = providerBoundary.verdict
          const integrity = evaluateC1E0TreatmentIntegrity({
            dose: runtimeDoseSummary,
            replayVerdict: evidence.every((row) => row.replayMismatch === 0) ? 'MATCH' : 'UNKNOWN',
            envelopePreserved: evidence.every(
              (row) =>
                row.systemDeveloperToolStructuresFingerprint ===
                C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE.structuralFingerprint
            ),
            protectedEvidenceRemoved: runtimeDoseSummary.protectedRemovalCount > 0,
            noFallback: evidence.every((row) => !row.fallbackSent),
            checkpointComplete: checkpointComplete(input.evidenceSink, plan.runId, evidence.length),
            runtimePolicyInput: runtimePolicyInputFromEvidence(evidence)
          })
          treatmentIntegrity = providerBoundary.verdict === 'PASS' ? integrity.verdict : 'FAIL'
        }
        const taskStatuses = [native?.taskEvaluation?.status, runtime?.taskEvaluation?.status]
        const taskCorrectness: C1E0LiveBindingPairAdjudication['taskCorrectness'] =
          taskStatuses.length < 2 || taskStatuses.some((status) => status === undefined)
            ? 'UNKNOWN'
            : taskStatuses.every((status) => status === 'PASS')
              ? 'PASS'
              : taskStatuses.some((status) => status === 'HARNESS_CONTRACT_FAILURE')
                ? 'UNKNOWN'
                : 'FAIL'
        const isolatedFailure =
          native?.errorCode === 'HARNESS_CONTRACT_FAILURE' ||
          runtime?.errorCode === 'HARNESS_CONTRACT_FAILURE'
        return {
          pairOrdinal: plan.pairOrdinal,
          pairId: plan.pairId,
          taskId: plan.taskId,
          stratum: plan.stratum,
          pairStatus: input.invalidated
            ? 'INVALID_FOR_BINDING'
            : complete
              ? 'COMPLETE'
              : 'INCOMPLETE',
          counterpartDecision: complete
            ? 'EXECUTED'
            : isolatedFailure && (native !== undefined || runtime !== undefined)
              ? 'EXECUTED_AFTER_ISOLATED_FAILURE'
              : 'BLOCKED_STUDY_TERMINAL',
          nativeOutcome: nativeRecord?.finalOutcome ?? 'UNKNOWN',
          runtimeOutcome: runtimeRecord?.finalOutcome ?? 'UNKNOWN',
          runtimeDoseSummary,
          treatmentIntegrity,
          safetyVerdict: treatmentIntegrity,
          providerBoundaryVerdict,
          taskCorrectness,
          nativeTaskEvaluation: native?.taskEvaluation ?? null,
          runtimeTaskEvaluation: runtime?.taskEvaluation ?? null,
          efficiency: runtimeRecord?.efficiency ?? null,
          ...(complete
            ? {}
            : {
                exclusionReason: isolatedFailure
                  ? 'isolated harness failure retained; paired endpoint is incomplete'
                  : input.invalidated
                    ? 'study binding invalidated before both legs completed'
                    : 'study terminated before both legs completed'
              })
        }
      })
  )
}

function isHardStudyFailure(code: string): boolean {
  if (code === 'HARNESS_CONTRACT_FAILURE') return false
  return new Set([
    'BUDGET_BREACH',
    'EVIDENCE_WRITE_FAILURE',
    'KILL_SWITCH_BLOCKED',
    'CONTRACT_BINDING_MISMATCH',
    'PROVIDER_BINDING_MISMATCH',
    'REPLAY_MISMATCH',
    'NODE_RANGE_MISMATCH',
    'IDENTITY_REUSE',
    'IDENTITY_INVALID',
    'ASSIGNMENT_BINDING_MISMATCH',
    'FIXTURE_BINDING_MISMATCH',
    'MANIFEST_BINDING_MISMATCH',
    'READINESS_BINDING_MISMATCH',
    'NOT_AUTHORIZED',
    'PROVIDER_PREPARATION_FAILURE'
  ]).has(code)
}

async function writeArtifacts(input: {
  readonly reportDir: string
  readonly reportBase: Omit<C1E0FinalLiveBindingReport, 'artifacts'>
  readonly evidence: readonly C1LiveBindingEvidence[]
  readonly dose: readonly C1E0DoseObservation[]
  readonly pairs: readonly C1E0LiveBindingPairAdjudication[]
  readonly sink: C1JsonlLiveBindingEvidenceSink
}): Promise<readonly C1E0LiveBindingArtifactSummary[]> {
  const checkpointText = await readFile(input.sink.checkpointPath, 'utf8').catch(() => '')
  const checkpoints = input.sink.checkpoints
  const checkpointSummary = {
    checkpointCount: checkpoints.length,
    phases: Object.fromEntries(
      [...new Set(checkpoints.map((checkpoint) => checkpoint.phase))]
        .sort()
        .map((phase) => [
          phase,
          checkpoints.filter((checkpoint) => checkpoint.phase === phase).length
        ])
    ),
    checkpointSha256: sha256(checkpointText)
  }
  const documents: readonly {
    readonly name: Exclude<E0ArtifactName, 'run-manifest.json'>
    readonly content: string
  }[] = [
    { name: 'checkpoints.jsonl', content: checkpointText },
    { name: 'checkpoint-summary.json', content: `${JSON.stringify(checkpointSummary, null, 2)}\n` },
    {
      name: 'study-events.jsonl',
      content: input.reportBase.events.map((event) => `${JSON.stringify(event)}\n`).join('')
    },
    {
      name: 'response-ledger.jsonl',
      content: input.evidence.map((row) => `${JSON.stringify(metadataEvidence(row))}\n`).join('')
    },
    {
      name: 'dose-evidence.jsonl',
      content: input.dose.map((row) => `${JSON.stringify(row)}\n`).join('')
    },
    {
      name: 'pair-adjudication.jsonl',
      content: input.pairs.map((pair) => `${JSON.stringify(pair)}\n`).join('')
    },
    {
      name: 'batch-qualification.json',
      content: `${JSON.stringify(input.reportBase.batchQualification, null, 2)}\n`
    }
  ]
  assertMetadataOnly(documents)
  for (const document of documents)
    await writeDurable(join(input.reportDir, document.name), document.content)
  const summaries = await Promise.all(
    documents.map((document) => artifactSummary(input.reportDir, document.name))
  )
  const manifest = {
    ...input.reportBase,
    artifacts: summaries,
    requiredArtifacts: [...E0_ARTIFACT_NAMES],
    evidencePolicy: 'METADATA_ONLY_NO_RAW_PROVIDER_OR_TOOL_CONTENT'
  }
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`
  assertMetadataOnly([{ name: 'run-manifest.json', content: manifestContent }])
  await writeDurable(join(input.reportDir, 'run-manifest.json'), manifestContent)
  return Object.freeze([...summaries, await artifactSummary(input.reportDir, 'run-manifest.json')])
}

/**
 * Execute the complete E0 scheduler/state-machine with an injected scripted
 * substitute. This is a wiring qualification only: providerCalls and network
 * requests are hard-coded to zero, while fake transport permits remain visible.
 */
async function runC1E0StudyInternal(
  options: C1E0StudyRunnerOptions
): Promise<C1E0FinalLiveBindingReport> {
  const repoRoot = options.repoRoot ?? resolve(import.meta.dirname, '..', '..', '..')
  const studyId = options.studyId ?? createE0StudyId(options.now ?? new Date())
  const outputRoot =
    options.outputRoot ??
    join(repoRoot, 'research/context-benchmarks/.live-output/c1-e0-live-binding')
  const failures: { code: string; message: string }[] = []
  const events: C1E0LiveBindingEvent[] = []
  const states = new Map<string, PairState>()
  const internalLegs: InternalLeg[] = []
  let enrollment: C1E0EnrollmentManifest | null = null
  let contract: C1E0RunContract | null = null
  let executionRevision: string | null = null
  let executionSurfaceHash: string | null = null
  let reportDir: string | null = null
  let providerBinding: C1StrictProviderBinding | null = null
  let providerProfileHash: string | null = null
  let budgetGuard: C1HardBudgetGuard | null = null
  let evidenceSink: C1JsonlLiveBindingEvidenceSink | null = null
  let driver: C1LiveBindingDriver | null = null
  let activeKillSwitch: RunKillSwitch | null = null
  let activeAbortController: AbortController | null = null
  let operatorSignal: 'SIGINT' | 'SIGTERM' | null = null
  let studyTerminal = false
  let terminalReason: string | null = null
  let hardStudyFailure = false
  let legsAttempted = 0
  let fixtureSandboxesCreated = 0
  let fixtureSandboxesCleaned = 0
  const signalSource = options.signalSource ?? new EventEmitter()
  const startedPairs = new Set<string>()

  const baseReport = (): Omit<C1E0FinalLiveBindingReport, 'artifacts'> => ({
    bindingId: C1_E0_FINAL_LIVE_BINDING_ID,
    schemaVersion: C1_E0_FINAL_LIVE_BINDING_SCHEMA_VERSION,
    executionMode: options.executionMode,
    status: hardStudyFailure ? 'NO_GO' : 'INCONCLUSIVE',
    finalBindingReady: false,
    studyId: reportDir === null ? null : studyId,
    reportDir,
    executionRevision,
    executionSurfaceHash,
    runContractId: C1_E0_RUN_CONTRACT_ID,
    runContractCodeRevision: contract?.executionBinding.codeRevision ?? null,
    runContractSha256: contract?.runContractSha256 ?? null,
    enrollmentManifestSha256: enrollment?.manifestSha256 ?? null,
    taskManifestSha256: enrollment?.taskManifestSha256 ?? null,
    enrollmentCohort: C1_E0_ENROLLMENT_COHORT,
    provider: C1_E0_PROVIDER,
    model: C1_E0_MODEL,
    endpoint: C1_E0_ENDPOINT,
    nodeRange: C1_E0_NODE_RANGE,
    providerConfigHash: C1_E0_PROVIDER_CONFIG_HASH,
    providerPreparationProfileHash: providerProfileHash,
    responseSource: options.responseSourceKind,
    providerCalls: options.providerCalls(),
    networkRequests: options.networkRequests(),
    fakeProviderCallPermits: budgetGuard?.ledger.providerCalls ?? 0,
    responseCalls: internalLegs.reduce(
      (total, leg) => total + (leg.result?.evidence.length ?? 0),
      0
    ),
    toolExecutions: internalLegs.reduce((total, leg) => total + (leg.result?.toolCalls ?? 0), 0),
    legsPlanned: C1_E0_TOTAL_LEG_COUNT,
    legsAttempted,
    legsCompleted: internalLegs.filter((leg) => leg.status === 'COMPLETED').length,
    legsFailed: internalLegs.filter((leg) => leg.status === 'FAILED').length,
    blockedLegs: internalLegs.filter((leg) => leg.status === 'BLOCKED').length,
    studyTerminal,
    terminalReason,
    operatorSignal,
    budget: budgetGuard?.ledger ?? null,
    batchQualification: evaluateC1E0BatchQualification({
      pairCount: contract?.design.pairCount ?? C1_E0_PAIR_COUNT,
      completedPairCount: 0,
      nonZeroTreatmentPairTaskIds: [],
      experimentInvalidator: hardStudyFailure
    }),
    pairAdjudications: [],
    legs: [],
    events,
    failures
  })

  try {
    assertE0StudyId(studyId)
    const nodeRangePass = nodeVersionSatisfiesC1Range(process.versions.node)
    const testNodeOverride =
      options.allowUnsupportedNodeForTests === true && process.env['NODE_ENV'] === 'test'
    if (!nodeRangePass && !testNodeOverride) {
      throw new C1PreflightFailure(
        'NODE_RANGE_MISMATCH',
        `Node ${process.versions.node} does not satisfy ${C1_E0_NODE_RANGE}`
      )
    }
    await assertC1LiveWorktreeClean(repoRoot)
    const executionBinding = await computeC1E0ExecutionBinding(repoRoot)
    executionRevision = executionBinding.executionRevision
    executionSurfaceHash = executionBinding.executionSurfaceHash
    enrollment = await loadC1E0EnrollmentManifest(repoRoot)
    contract = await loadC1E0RunContract(repoRoot)
    if (contract.executionBinding.providerConfigHash !== C1_E0_PROVIDER_CONFIG_HASH) {
      throw new C1PreflightFailure(
        'CONTRACT_BINDING_MISMATCH',
        'E0 live-binding provider request hash drifted from the frozen contract'
      )
    }
    const pendingContractTestOverride =
      options.allowPendingContractForTests === true && process.env['NODE_ENV'] === 'test'
    if (
      options.requireNoProvider &&
      contract.executionBinding.codeRevision !== 'PENDING_E0_EXECUTION'
    ) {
      throw new C1PreflightFailure(
        'CONTRACT_BINDING_MISMATCH',
        'NO_PROVIDER final live binding requires the unchanged freeze-prep E0 contract'
      )
    }
    if (
      options.authorization !== undefined &&
      contract.executionBinding.codeRevision === 'PENDING_E0_EXECUTION' &&
      !pendingContractTestOverride
    ) {
      throw new C1PreflightFailure(
        'NOT_AUTHORIZED',
        'authorized E0 execution cannot use a pending freeze-prep code revision'
      )
    }
    if (options.authorization !== undefined) {
      assertC1E0Authorization(options.authorization)
      if (
        options.authorization.studyId !== studyId ||
        options.authorization.executionRevision !== executionRevision ||
        options.authorization.executionSurfaceHash !== executionSurfaceHash ||
        options.authorization.runContractSha256 !== contract.runContractSha256 ||
        options.authorization.enrollmentManifestSha256 !== enrollment.manifestSha256 ||
        options.authorization.providerConfigHash !== C1_E0_PROVIDER_CONFIG_HASH
      ) {
        throw new C1PreflightFailure(
          'NOT_AUTHORIZED',
          'authorized E0 execution binding does not match the loaded frozen artifacts'
        )
      }
    }
    const tasks = await loadE0Tasks(repoRoot, enrollment)
    const plans = buildC1E0ExecutionPlans(contract, enrollment, studyId)
    if (plans.length !== C1_E0_TOTAL_LEG_COUNT) {
      throw new C1PreflightFailure(
        'ASSIGNMENT_BINDING_MISMATCH',
        'E0 live binding did not produce eight legs'
      )
    }
    reportDir = await claimE0StudyDir(outputRoot, studyId)
    events.push({
      sequence: events.length + 1,
      event: 'STUDY_PREPARED',
      observedStatus: 'PREPARED'
    })

    providerBinding = await options.prepareProvider(studyId)
    assertC1StrictProviderBinding(providerBinding.experimentBinding)
    providerProfileHash = providerBinding.providerConfigHash
    budgetGuard = new C1HardBudgetGuard({
      perLeg: {
        maxProviderCalls: contract.budgets.perLeg.maxProviderRequests,
        maxToolCalls: contract.budgets.perLeg.maxProviderToolRequests,
        maxWallClockMs: contract.budgets.perLeg.maxWallClockMs
      },
      study: {
        maxProviderCalls: contract.budgets.study.maxProviderRequests,
        maxToolCalls: contract.budgets.study.maxProviderToolRequests,
        maxWallClockMs: contract.budgets.study.maxWallClockMs,
        maxLegs: contract.budgets.study.maxLegs
      }
    })
    evidenceSink = new C1JsonlLiveBindingEvidenceSink(join(reportDir, 'checkpoints.jsonl'))
    driver = new C1LiveBindingDriver({
      providerBinding,
      budgetGuard,
      evidenceSink,
      providerConfigHashOverride: C1_E0_PROVIDER_CONFIG_HASH
    })
    let operatorTripped = false
    const operator = {
      on: signalSource.on.bind(signalSource),
      removeListener: signalSource.removeListener.bind(signalSource)
    }
    const listeners = {
      sigint: (): void => {
        if (operatorTripped) return
        operatorTripped = true
        operatorSignal = 'SIGINT'
        studyTerminal = true
        terminalReason = 'operator SIGINT'
        activeKillSwitch?.trip(terminalReason)
        activeAbortController?.abort()
      },
      sigterm: (): void => {
        if (operatorTripped) return
        operatorTripped = true
        operatorSignal = 'SIGTERM'
        studyTerminal = true
        terminalReason = 'operator SIGTERM'
        activeKillSwitch?.trip(terminalReason)
        activeAbortController?.abort()
      }
    }
    operator.on('SIGINT', listeners.sigint)
    operator.on('SIGTERM', listeners.sigterm)
    try {
      for (const plan of plans) {
        const task = tasks.get(plan.taskId)
        if (task === undefined) {
          throw new C1PreflightFailure(
            'MANIFEST_BINDING_MISMATCH',
            `missing E0 task ${plan.taskId}`
          )
        }
        const pairState: PairState = states.get(plan.pairId) ?? { assignment: plan }
        states.set(plan.pairId, pairState)
        if (!startedPairs.has(plan.pairId)) {
          startedPairs.add(plan.pairId)
          events.push({
            sequence: events.length + 1,
            event: 'PAIR_STARTED',
            pairId: plan.pairId,
            taskId: plan.taskId,
            observedStatus: 'STARTED'
          })
        }
        if (operatorTripped || studyTerminal) {
          const blocked: InternalLeg = {
            plan,
            task,
            status: 'BLOCKED',
            responseSourceKind: options.responseSourceKind,
            doseObservations: [],
            providerProfileHash,
            changedPaths: [],
            writableScopePass: false,
            fixtureHashVerified: false,
            fixtureCleaned: true,
            errorCode: 'KILL_SWITCH_BLOCKED'
          }
          internalLegs.push(blocked)
          if (plan.arm === 'NATIVE') pairState.native = blocked
          else pairState.runtime = blocked
          events.push({
            sequence: events.length + 1,
            event: 'LEG_BLOCKED',
            pairId: plan.pairId,
            taskId: plan.taskId,
            arm: plan.arm,
            runId: plan.runId,
            observedStatus: 'BLOCKED'
          })
          continue
        }

        let fixture: Awaited<ReturnType<typeof materializeFreshC1Fixture>> | null = null
        let fixtureCleaned = false
        let fixtureHashVerified = false
        let changedPaths: readonly string[] = []
        let scopePass = false
        let legDir: string | null = null
        let result: C1LiveBindingLegResult | undefined
        let doseObservations: readonly C1E0DoseObservation[] = []
        let taskEvaluation: C1TaskEvaluation | undefined
        try {
          legDir = await claimE0LegDir(reportDir, plan.runId)
          legsAttempted += 1
          const binding = await verifyC1FixtureBinding(await loadC1FrozenStudy(repoRoot), task)
          fixture = await materializeFreshC1Fixture(binding.sourcePath)
          fixtureSandboxesCreated += 1
          const before = await computeC1FixtureContentSummary(fixture.path)
          const beforeSnapshot = await snapshotC1Fixture(fixture.path)
          fixtureHashVerified = before.sha256 === task.fixtureRevision.fixtureContentSha256
          if (!fixtureHashVerified) {
            throw new C1PreflightFailure(
              'FIXTURE_BINDING_MISMATCH',
              `E0 live fixture hash mismatch for ${plan.runId}`
            )
          }
          const bootstrapFiles = C1_E0_NEUTRAL_BOOTSTRAP_FILES
          const abortController = new AbortController()
          const legKillSwitch = createRunKillSwitch(plan.runId, {
            now: () => new Date().toISOString()
          })
          activeAbortController = abortController
          activeKillSwitch = legKillSwitch
          const factoryInput: C1E0LiveBindingLegFactoryInput = {
            studyId,
            plan,
            task,
            fixtureRoot: fixture.path,
            legDir,
            providerBinding,
            bootstrapFiles,
            killSwitch: legKillSwitch,
            responseAbortSignal: abortController.signal
          }
          const responseSource = await options.responseSourceFactory(factoryInput)
          if (responseSource.kind !== options.responseSourceKind) {
            throw new C1PreflightFailure(
              'PROVIDER_BINDING_MISMATCH',
              `E0 response source kind ${responseSource.kind} does not match ${options.responseSourceKind}`
            )
          }
          const observationSource = await C1E0NaturalObservationSource.fromFixture({
            task,
            runId: plan.runId,
            fixtureRoot: fixture.path,
            arm: plan.arm,
            bootstrapFiles
          })
          result = await driver.runLeg({
            studyId,
            task,
            stratum: plan.stratum,
            pairId: plan.pairId,
            arm: plan.arm,
            runId: plan.runId,
            fixtureContentSha256: before.sha256,
            fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
            runtimeSessionId: `${studyId}:${plan.pairId}:${plan.arm}`,
            observationSource,
            responseSource,
            toolExecutor: new C1SandboxToolExecutor(fixture.path),
            maxCalls: options.maxCalls ?? 24,
            responseAbortSignal: abortController.signal,
            killSwitch: legKillSwitch
          })
          const after = await computeC1FixtureContentSummary(fixture.path)
          const afterSnapshot = await snapshotC1Fixture(fixture.path)
          changedPaths = changedC1FixturePaths(beforeSnapshot, afterSnapshot)
          scopePass = writableScopePass(changedPaths, task.expectedWritablePaths)
          taskEvaluation = await runC1TaskOracles({ task, fixtureRoot: fixture.path })
          if (!scopePass) {
            taskEvaluation = {
              ...taskEvaluation,
              status: 'TASK_FAILURE',
              taskOutcome: 'FAILURE',
              writableScopePass: false
            }
          }
          doseObservations =
            plan.arm === 'RUNTIME'
              ? projectC1E0LiveDose({
                  plan,
                  result,
                  unknownsForCall: (callOrdinal) => observationSource.unknownsForCall(callOrdinal)
                })
              : []
          await writeDurable(
            join(legDir, 'leg-manifest.json'),
            `${JSON.stringify(
              {
                studyId,
                pairId: plan.pairId,
                pairOrdinal: plan.pairOrdinal,
                taskId: plan.taskId,
                stratum: plan.stratum,
                arm: plan.arm,
                runId: plan.runId,
                status: 'COMPLETED',
                responseSource: options.responseSourceKind,
                providerConfigHash: C1_E0_PROVIDER_CONFIG_HASH,
                providerCalls: options.providerCalls(),
                networkRequests: options.networkRequests(),
                responseCalls: result.evidence.length,
                toolExecutions: result.toolCalls,
                fixtureHashVerified,
                fixtureCleaned: true,
                changedPaths,
                writableScopePass: scopePass,
                doseObservationCount: doseObservations.length,
                taskEvaluation
              },
              null,
              2
            )}\n`
          )
          const internal: InternalLeg = {
            plan,
            task,
            status: 'COMPLETED',
            responseSourceKind: options.responseSourceKind,
            result,
            doseObservations,
            providerProfileHash,
            changedPaths,
            writableScopePass: scopePass,
            fixtureHashVerified,
            fixtureCleaned: true,
            taskEvaluation
          }
          internalLegs.push(internal)
          if (plan.arm === 'NATIVE') pairState.native = internal
          else pairState.runtime = internal
          events.push({
            sequence: events.length + 1,
            event: 'LEG_COMPLETED',
            pairId: plan.pairId,
            taskId: plan.taskId,
            arm: plan.arm,
            runId: plan.runId,
            observedStatus: 'COMPLETED'
          })
        } catch (error) {
          const failure = failureOf(error)
          failures.push(failure)
          const failed: InternalLeg = {
            plan,
            task,
            status: 'FAILED',
            responseSourceKind: options.responseSourceKind,
            doseObservations: [],
            providerProfileHash,
            changedPaths,
            writableScopePass: false,
            fixtureHashVerified,
            fixtureCleaned,
            errorCode: failure.code
          }
          internalLegs.push(failed)
          if (plan.arm === 'NATIVE') pairState.native = failed
          else pairState.runtime = failed
          events.push({
            sequence: events.length + 1,
            event: 'LEG_FAILED',
            pairId: plan.pairId,
            taskId: plan.taskId,
            arm: plan.arm,
            runId: plan.runId,
            observedStatus: failure.code
          })
          if (isHardStudyFailure(failure.code) || driver.isStudyTerminal) {
            hardStudyFailure = true
            studyTerminal = true
            terminalReason ??= failure.message
          }
        } finally {
          if (fixture !== null && !fixtureCleaned) {
            await fixture.cleanup()
            fixtureCleaned = true
            fixtureSandboxesCleaned += 1
          }
          activeKillSwitch = null
          activeAbortController = null
        }
      }
    } finally {
      operator.removeListener('SIGINT', listeners.sigint)
      operator.removeListener('SIGTERM', listeners.sigterm)
    }
  } catch (error) {
    const failure = failureOf(error)
    failures.push(failure)
    if (isHardStudyFailure(failure.code)) hardStudyFailure = true
    studyTerminal = true
    terminalReason ??= failure.message
  } finally {
    activeKillSwitch = null
    activeAbortController = null
    providerBinding?.dispose()
  }

  const plans =
    contract === null || enrollment === null
      ? []
      : buildC1E0ExecutionPlans(contract, enrollment, studyId)
  const pairs = pairAdjudications({
    assignments: plans,
    states,
    evidenceSink,
    invalidated: hardStudyFailure,
    responseSourceKind: options.responseSourceKind
  })
  for (const pair of pairs) {
    events.push({
      sequence: events.length + 1,
      event: 'PAIR_ADJUDICATED',
      pairId: pair.pairId,
      taskId: pair.taskId,
      observedStatus: pair.pairStatus
    })
  }
  const nonZeroTaskIds = pairs
    .filter((pair) => (pair.runtimeDoseSummary?.uniqueRemovedPairs.length ?? 0) > 0)
    .map((pair) => pair.taskId)
  let batchQualification = evaluateC1E0BatchQualification({
    pairCount: contract?.design.pairCount ?? C1_E0_PAIR_COUNT,
    completedPairCount: pairs.filter((pair) => pair.pairStatus === 'COMPLETE').length,
    nonZeroTreatmentPairTaskIds: nonZeroTaskIds,
    experimentInvalidator: hardStudyFailure
  })
  if (batchQualification.verdict === 'PASS') {
    events.push({ sequence: events.length + 1, event: 'STUDY_QUALIFIED', observedStatus: 'PASS' })
  } else {
    if (batchQualification.verdict === 'NO_GO') studyTerminal = true
    terminalReason ??=
      batchQualification.verdict === 'NO_GO'
        ? 'E0 live binding invalidated'
        : 'E0 live binding remains inconclusive'
    events.push({
      sequence: events.length + 1,
      event: 'STUDY_TERMINATED',
      observedStatus: batchQualification.verdict
    })
  }

  const allEvidence = internalLegs.flatMap((leg) => leg.result?.evidence ?? [])
  const allDose = internalLegs.flatMap((leg) => leg.doseObservations)
  const reportWithoutArtifacts: Omit<C1E0FinalLiveBindingReport, 'artifacts'> = {
    ...baseReport(),
    status: batchQualification.verdict,
    studyId: reportDir === null ? null : studyId,
    reportDir,
    executionRevision,
    runContractCodeRevision: contract?.executionBinding.codeRevision ?? null,
    runContractSha256: contract?.runContractSha256 ?? null,
    enrollmentManifestSha256: enrollment?.manifestSha256 ?? null,
    taskManifestSha256: enrollment?.taskManifestSha256 ?? null,
    providerPreparationProfileHash: providerProfileHash,
    fakeProviderCallPermits: budgetGuard?.ledger.providerCalls ?? 0,
    responseCalls: allEvidence.length,
    toolExecutions: allEvidence.reduce((total, row) => total + row.toolCalls, 0),
    legsAttempted,
    legsCompleted: internalLegs.filter((leg) => leg.status === 'COMPLETED').length,
    legsFailed: internalLegs.filter((leg) => leg.status === 'FAILED').length,
    blockedLegs: internalLegs.filter((leg) => leg.status === 'BLOCKED').length,
    studyTerminal,
    terminalReason,
    operatorSignal,
    budget: budgetGuard?.ledger ?? null,
    batchQualification,
    pairAdjudications: pairs,
    legs: Object.freeze(
      internalLegs
        .sort((left, right) => left.plan.legIndex - right.plan.legIndex)
        .map((leg) => legRecord(leg, C1_E0_PROVIDER_CONFIG_HASH))
    ),
    events: Object.freeze(events),
    failures: Object.freeze(failures)
  }

  let artifacts: readonly C1E0LiveBindingArtifactSummary[] = []
  if (reportDir !== null && evidenceSink !== null) {
    try {
      artifacts = await writeArtifacts({
        reportDir,
        reportBase: reportWithoutArtifacts,
        evidence: allEvidence,
        dose: allDose,
        pairs,
        sink: evidenceSink
      })
    } catch (error) {
      const failure = failureOf(error)
      failures.push(failure)
      batchQualification = {
        ...batchQualification,
        verdict: 'NO_GO',
        reasons: Object.freeze([...batchQualification.reasons, failure.message])
      }
      studyTerminal = true
      terminalReason = failure.message
    }
  }

  return {
    ...reportWithoutArtifacts,
    status: batchQualification.verdict,
    studyTerminal,
    terminalReason,
    batchQualification,
    failures: Object.freeze(failures),
    artifacts
  }
}

/** Strict no-provider wrapper used by readiness and credential-free tests. */
export async function runC1E0FinalLiveBindingNoProvider(
  options: C1E0FinalLiveBindingOptions
): Promise<C1E0FinalLiveBindingReport> {
  return runC1E0StudyInternal({
    ...options,
    executionMode: C1_E0_FINAL_LIVE_BINDING_MODE,
    responseSourceKind: 'SCRIPTED_FAKE',
    requireNoProvider: true,
    prepareProvider: (studyId) =>
      prepareC1StrictProvider({
        runIdentity: studyId,
        env: { STEP_PLAN_API_KEY: E0_FAKE_CREDENTIAL }
      }),
    providerCalls: () => 0,
    networkRequests: () => 0
  })
}

/**
 * Authorized Provider wrapper. It is intentionally separate from the
 * no-provider entrypoint and requires an explicit, fully bound authorization.
 * The current freeze-prep contract can only be used through the test-only
 * pending-contract override with an injected fetch stub.
 */
export async function runC1E0FinalLiveBindingAuthorized(
  options: C1E0AuthorizedLiveBindingOptions
): Promise<C1E0FinalLiveBindingReport> {
  let providerAttempts = 0
  let networkRequests = 0
  const upstreamFetch = options.fetchImpl ?? globalThis.fetch
  if (typeof upstreamFetch !== 'function') {
    throw new C1PreflightFailure('PROVIDER_PREPARATION_FAILURE', 'global fetch is unavailable')
  }
  const countedFetch: typeof fetch = async (input, init) => {
    networkRequests += 1
    return upstreamFetch(input, init)
  }
  return runC1E0StudyInternal({
    studyId: options.authorization.studyId,
    executionMode: 'AUTHORIZED_PROVIDER',
    responseSourceKind: 'AUTHORIZED_PROVIDER',
    requireNoProvider: false,
    authorization: options.authorization,
    ...(options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot }),
    ...(options.outputRoot === undefined ? {} : { outputRoot: options.outputRoot }),
    ...(options.signalSource === undefined ? {} : { signalSource: options.signalSource }),
    ...(options.maxCalls === undefined ? {} : { maxCalls: options.maxCalls }),
    ...(options.allowPendingContractForTests === undefined
      ? {}
      : { allowPendingContractForTests: options.allowPendingContractForTests }),
    prepareProvider: async (studyId) => {
      if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
        throw new C1PreflightFailure(
          'PROVIDER_PREPARATION_FAILURE',
          'authorized E0 binding requires an explicit memory-only API key'
        )
      }
      return prepareC1StrictProvider({
        runIdentity: studyId,
        env: { STEP_PLAN_API_KEY: options.apiKey }
      })
    },
    responseSourceFactory: (input) => {
      const source = createC1E0AuthorizedProviderResponseSource({
        providerBinding: input.providerBinding,
        apiKey: options.apiKey,
        fetchImpl: countedFetch,
        ...(options.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: options.requestTimeoutMs })
      })
      return {
        kind: 'AUTHORIZED_PROVIDER' as const,
        next: async (request, sourceOptions) => {
          providerAttempts += 1
          return source.next(request, sourceOptions)
        }
      }
    },
    providerCalls: () => providerAttempts,
    networkRequests: () => networkRequests,
    allowUnsupportedNodeForTests: options.allowPendingContractForTests === true ? true : false
  })
}
