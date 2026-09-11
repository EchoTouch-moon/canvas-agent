import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { cp, mkdir, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRunKillSwitch } from '@canvas-agent/pi-context-integration/experimental'
import { C1_E0_PROVIDER_CONFIG_HASH } from '../../../src/c1-e0-binding'
import {
  C1_MODEL_ID,
  C1_NODE_RANGE,
  C1_PROVIDER_ENDPOINT,
  C1_PROVIDER_ID,
  C1PreflightFailure,
  C1HardBudgetGuard,
  changedC1FixturePaths,
  computeC1FixtureContentSummary,
  materializeFreshC1Fixture,
  nodeVersionSatisfiesC1Range,
  prepareC1StrictProvider,
  snapshotC1Fixture,
  loadC1FrozenStudy,
  verifyC1FixtureBinding,
  writableScopePass,
  type C1PreflightTask,
  type C1ProviderBoundCapture,
  type C1StrictProviderBinding
} from '../../../src/c1-live-preflight'
import {
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingDriver,
  C1SandboxToolExecutor,
  type C1LiveBindingCheckpoint,
  type C1LiveBindingEvidence,
  type C1LiveBindingEvidenceSink,
  type C1LiveModelResponse,
  type C1LiveResponseSource,
  type C1LiveToolExecution
} from '../../../src/c1-live-binding'
import {
  assertC1LiveWorktreeClean,
  C1LiveTaskObservationSource,
  runC1TaskOracles,
  type C1TaskEvaluation
} from '../../../src/c1-live-study'
import { buildSanitizedChildEnvironment, runProcess } from '../../../src/fixture-generator'

/** Machine-readable F0 contract consumed by the Native-only runner. */
export const C1_F0_CONTRACT_RELATIVE_PATH =
  'research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v1.json'
export const C1_F0_RUNNER_ID = 'C1_F0_EXECUTION_FEASIBILITY_RUNNER_V1'
export const C1_F0_RUNNER_SCHEMA_VERSION = 1 as const
export const C1_F0_RUNNER_MODE = 'CREDENTIAL_FREE_NATIVE_ONLY' as const
export const C1_F0_EXECUTION_SURFACE_PATHS = Object.freeze([
  'research/context-benchmarks/c1/f0/runner',
  'research/context-benchmarks/src/c1-live-preflight.ts',
  'research/context-benchmarks/src/c1-live-binding.ts',
  'research/context-benchmarks/src/c1-live-study.ts',
  'research/context-benchmarks/src/fixture-generator.ts',
  'research/context-benchmarks/src/c1-e0-binding.ts',
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

const F0_STUDY_ID_PATTERN = /^c1-f0-\d{8}-[0-9a-f]{8}$/
const F0_RUN_ID_PATTERN = /^c1-f0-\d{8}-run-\d{2}-[0-9a-f]{8}$/
const F0_PENDING_BINDING = 'PENDING_F0_IMPLEMENTATION'
const F0_CREDENTIAL_SENTINEL = 'c1-f0-credential-free-in-memory-sentinel'
const F0_REQUIRED_ARTIFACTS = Object.freeze([
  'study-manifest.json',
  'run-manifest.json',
  'checkpoints.jsonl',
  'checkpoint-summary.json',
  'response-ledger.jsonl',
  'task-adjudication.jsonl',
  'feasibility-summary.json'
] as const)

export type C1F0ExecutionStatus =
  'F0_NO_GO' | 'F0_HOLD' | 'F0_FEASIBILITY_NO_GO' | 'GO_TO_T0_DESIGN'
export type C1F0TerminationStatus =
  | 'TERMINAL_COMPLETE'
  | 'TERMINAL_FAILED'
  | 'BUDGET_EXHAUSTED'
  | 'PROVIDER_BOUNDARY_FAILURE'
  | 'TOOL_BOUNDARY_FAILURE'
  | 'BLOCKED'
export type C1F0OracleStatus = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_ADJUDICABLE'
export type C1F0EvidenceStatus = 'COMPLETE' | 'PARTIAL' | 'INVALID'
export type C1F0FakeScenario = 'COMPLETE' | 'TOOL_LOOP' | 'SINGLE_RUN_FAILURE' | 'BUDGET_EXHAUSTION'

interface JsonRecord {
  readonly [key: string]: unknown
}

export interface C1F0ContractTaskPanelEntry {
  readonly taskId: string
  readonly stratum: string
  readonly fixturePath: string
  readonly expectedWritablePaths: readonly string[]
  readonly fixtureTreeObjectId: string
  readonly fixtureContentSha256: string
  readonly promptSha256: string
  readonly objectiveOracle: {
    readonly command: 'node'
    readonly args: readonly string[]
    readonly expectedExitCode: number
    readonly timeoutMs: number
  }
  readonly regressionOracle: {
    readonly command: 'node'
    readonly args: readonly string[]
    readonly expectedExitCode: number
    readonly timeoutMs: number
  }
}

export interface C1F0Contract {
  readonly contractId: 'C1_F0_EXECUTION_FEASIBILITY_V1'
  readonly schemaVersion: 1
  readonly status: 'PREPARED' | 'FROZEN'
  readonly designStatus: string
  readonly estimand: string
  readonly design: {
    readonly arm: 'NATIVE_ONLY'
    readonly runtimeIntervention: 'DISABLED'
    readonly taskPanelId: string
    readonly taskCount: 2
    readonly runsPerTask: 16
    readonly totalRuns: 32
    readonly maxConcurrency: 1
    readonly runOrder: {
      readonly algorithmId: string
      readonly seed: string
      readonly pattern: readonly [string, string]
      readonly repetitions: 16
    }
    readonly confidence: {
      readonly level: 0.95
      readonly intervalMethod: 'CLOPPER_PEARSON_EXACT'
      readonly tail: 'ONE_SIDED'
    }
  }
  readonly taskPanel: readonly [C1F0ContractTaskPanelEntry, C1F0ContractTaskPanelEntry]
  readonly enrollmentBinding: {
    readonly taskManifestPath: string
    readonly taskManifestSha256: string
    readonly panelSelection: string
  }
  readonly executionBinding: {
    readonly provider: typeof C1_PROVIDER_ID
    readonly model: typeof C1_MODEL_ID
    readonly endpoint: typeof C1_PROVIDER_ENDPOINT
    readonly nodeRange: typeof C1_NODE_RANGE
    readonly codeRevision: string
    readonly executionSurfaceHash: string
    readonly credentialEnv: 'STEP_PLAN_API_KEY'
    readonly credentialPersistence: 'MEMORY_ONLY'
    readonly fallback: 'NONE'
    readonly runtimeIntervention: 'DISABLED'
    readonly providerConfigHash: string
  }
  readonly budgets: {
    readonly perRun: {
      readonly maxProviderRequests: 24
      readonly maxToolRequests: 96
      readonly maxWallClockMs: 600000
      readonly maxOutputTokensPerRequest: 16384
    }
    readonly study: {
      readonly maxProviderRequests: 768
      readonly maxToolRequests: 3072
      readonly maxWallClockMs: 19200000
      readonly maxRuns: 32
      readonly maxConcurrency: 1
    }
  }
  readonly gates: {
    readonly validity: {
      readonly sharedInvalidatorCount: 0
      readonly bindingsValid: true
      readonly singleStudyId: true
      readonly uniqueRunIds: true
      readonly checkpointReportJoin: 'REQUIRED'
      readonly rawCredentialOrPayloadLeakage: 'FORBIDDEN'
    }
    readonly precision: {
      readonly startedRunsPerTask: 16
      readonly taskPanelCoverage: 2
      readonly confidenceRule: string
      readonly postHocRemoval: 'FORBIDDEN'
    }
    readonly feasibility: {
      readonly perTaskEndToEndSuccessLowerBound: number
      readonly perTaskBudgetExhaustionUpperBound: number
      readonly perTaskUnrecoveredToolFailureRunUpperBound: number
      readonly perTaskOraclePassAmongAdjudicableLowerBound: number
    }
  }
  readonly runContractSha256: string
}

export interface C1F0ExecutionPlan {
  readonly runOrdinal: number
  readonly repetition: number
  readonly taskOrdinal: 1 | 2
  readonly taskId: string
  readonly stratum: string
  readonly runId: string
  readonly pairId: string
}

export interface C1F0RunDiagnostics {
  readonly providerCallPermits: number
  readonly responseCalls: number
  readonly toolRequestCount: number
  readonly toolExecutionCount: number
  readonly toolErrorCount: number
  readonly recoveredToolErrorCount: number
  readonly providerErrorCount: number
  readonly unrecoveredToolFailure: boolean
  readonly checkpointJoinComplete: boolean
}

export interface C1F0RunRecord {
  readonly runOrdinal: number
  readonly repetition: number
  readonly taskOrdinal: 1 | 2
  readonly taskId: string
  readonly stratum: string
  readonly runId: string
  readonly pairId: string
  readonly terminationStatus: C1F0TerminationStatus
  readonly oracleStatus: C1F0OracleStatus
  readonly objectiveOracleStatus: C1F0OracleStatus
  readonly regressionOracleStatus: C1F0OracleStatus
  readonly evidenceStatus: C1F0EvidenceStatus
  readonly fixtureCleaned: boolean
  readonly changedPaths: readonly string[]
  readonly writableScopePass: boolean
  readonly diagnostics: C1F0RunDiagnostics
  readonly failureCode?: string
}

export interface C1F0TaskFeasibilitySummary {
  readonly taskId: string
  readonly stratum: string
  readonly startedRuns: number
  readonly plannedRuns: 16
  readonly terminalCompleteRuns: number
  readonly endToEndSuccesses: number
  readonly budgetExhaustionRuns: number
  readonly unrecoveredToolFailureRuns: number
  readonly oraclePassesAmongAdjudicable: number
  readonly oracleAdjudicableRuns: number
  readonly rates: {
    readonly endToEndSuccess: number
    readonly budgetExhaustion: number
    readonly unrecoveredToolFailureRun: number
    readonly oraclePassAmongAdjudicable: number
  }
  readonly intervals95: {
    readonly endToEndSuccessLower: number
    readonly budgetExhaustionUpper: number
    readonly unrecoveredToolFailureRunUpper: number
    readonly oraclePassAmongAdjudicableLower: number
  }
  readonly gates: {
    readonly endToEndSuccess: boolean
    readonly budgetExhaustion: boolean
    readonly unrecoveredToolFailureRun: boolean
    readonly oraclePassAmongAdjudicable: boolean
    readonly pass: boolean
  }
}

export interface C1F0AdjudicationSummary {
  readonly status: C1F0ExecutionStatus
  readonly validityGate: {
    readonly pass: boolean
    readonly sharedInvalidatorCount: number
    readonly reasons: readonly string[]
  }
  readonly precisionGate: {
    readonly pass: boolean
    readonly startedRunsPerTask: Readonly<Record<string, number>>
    readonly uniqueRunIds: boolean
    readonly taskPanelCoverage: number
    readonly reasons: readonly string[]
  }
  readonly feasibilityGate: {
    readonly pass: boolean
    readonly tasks: readonly C1F0TaskFeasibilitySummary[]
  }
  readonly taskSummaries: readonly C1F0TaskFeasibilitySummary[]
}

export interface C1F0ExecutionArtifactSummary {
  readonly name: string
  readonly sha256: string
  readonly bytes: number
}

export interface C1F0ExecutionReport {
  readonly runnerId: typeof C1_F0_RUNNER_ID
  readonly schemaVersion: typeof C1_F0_RUNNER_SCHEMA_VERSION
  readonly executionMode: typeof C1_F0_RUNNER_MODE
  readonly scenario: C1F0FakeScenario
  readonly status: C1F0ExecutionStatus
  readonly studyId: string
  readonly reportDir: string | null
  readonly executionRevision: string | null
  readonly executionSurfaceHash: string | null
  readonly runContractSha256: string | null
  readonly providerConfigHash: string | null
  readonly provider: typeof C1_PROVIDER_ID
  readonly model: typeof C1_MODEL_ID
  readonly endpoint: typeof C1_PROVIDER_ENDPOINT
  readonly nodeRange: typeof C1_NODE_RANGE
  readonly responseSource: 'SCRIPTED_FAKE'
  readonly providerCalls: 0
  readonly networkRequests: 0
  readonly fakeProviderCallPermits: number
  readonly responseCalls: number
  readonly toolExecutions: number
  readonly runsPlanned: 32
  readonly runsStarted: number
  readonly runsCompleted: number
  readonly blockedRuns: number
  readonly studyTerminal: boolean
  readonly terminalReason: string | null
  readonly artifacts: readonly C1F0ExecutionArtifactSummary[]
  readonly runs: readonly C1F0RunRecord[]
  readonly feasibility: C1F0AdjudicationSummary
  readonly failures: readonly { readonly code: string; readonly message: string }[]
}

export interface C1F0ExecutionRunnerOptions {
  readonly repoRoot?: string
  readonly outputRoot?: string
  readonly studyId?: string
  readonly now?: Date
  readonly scenario?: C1F0FakeScenario
  /** Test-only source seam. It receives no oracle or writable-path metadata. */
  readonly responseSourceFactory?: (input: {
    readonly runId: string
    readonly taskId: string
    readonly fixtureRoot: string
    readonly prompt: string
    readonly providerBinding: C1StrictProviderBinding
  }) => C1LiveResponseSource | Promise<C1LiveResponseSource>
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error('value is not JSON serializable')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  throw new Error(`unsupported JSON value type: ${typeof value}`)
}

function hashContract(value: unknown): string {
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  clone['runContractSha256'] = 'SELF'
  return sha256(canonicalJson(clone))
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', `${label} must be an object`)
  }
  return value as JsonRecord
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', `${label} must be a non-empty string`)
  }
  return value
}

function requiredHash(value: unknown, label: string): string {
  const result = requiredString(value, label)
  if (!/^[a-f0-9]{64}$/i.test(result)) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', `${label} must be a SHA-256 hash`)
  }
  return result
}

function requiredInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', `${label} must be an integer`)
  }
  return value as number
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', `${label} must be a string array`)
  }
  return Object.freeze([...value] as string[])
}

function parseOracle(value: unknown, label: string): C1F0ContractTaskPanelEntry['objectiveOracle'] {
  const record = asRecord(value, label)
  if (record['command'] !== 'node') {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', `${label}.command must be node`)
  }
  return {
    command: 'node',
    args: stringArray(record['args'], `${label}.args`),
    expectedExitCode: requiredInteger(record['expectedExitCode'], `${label}.expectedExitCode`),
    timeoutMs: requiredInteger(record['timeoutMs'], `${label}.timeoutMs`)
  }
}

function parseTaskPanelEntry(value: unknown): C1F0ContractTaskPanelEntry {
  const record = asRecord(value, 'F0 task panel entry')
  const fixtureRevision =
    record['fixtureRevision'] === undefined
      ? {}
      : asRecord(record['fixtureRevision'], 'F0 task panel fixtureRevision')
  return {
    taskId: requiredString(record['taskId'], 'F0 taskPanel.taskId'),
    stratum: requiredString(record['stratum'], 'F0 taskPanel.stratum'),
    fixturePath: requiredString(record['fixturePath'], 'F0 taskPanel.fixturePath'),
    expectedWritablePaths: stringArray(
      record['expectedWritablePaths'],
      'F0 taskPanel.expectedWritablePaths'
    ),
    fixtureTreeObjectId: requiredString(
      record['fixtureTreeObjectId'] ?? fixtureRevision['fixtureTreeObjectId'],
      'F0 taskPanel.fixtureTreeObjectId'
    ),
    fixtureContentSha256: requiredHash(
      record['fixtureContentSha256'] ?? fixtureRevision['fixtureContentSha256'],
      'F0 taskPanel.fixtureContentSha256'
    ),
    promptSha256: requiredHash(record['promptSha256'], 'F0 taskPanel.promptSha256'),
    objectiveOracle: parseOracle(record['objectiveOracle'], 'F0 taskPanel.objectiveOracle'),
    regressionOracle: parseOracle(record['regressionOracle'], 'F0 taskPanel.regressionOracle')
  }
}

function assertStudyId(value: string): void {
  if (!F0_STUDY_ID_PATTERN.test(value)) {
    throw new C1PreflightFailure('IDENTITY_INVALID', `invalid F0 study identity ${value}`)
  }
}

function assertRunId(value: string): void {
  if (!F0_RUN_ID_PATTERN.test(value)) {
    throw new C1PreflightFailure('IDENTITY_INVALID', `invalid F0 run identity ${value}`)
  }
}

function createStudyId(now: Date): string {
  return `c1-f0-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex')}`
}

function dateToken(studyId: string): string {
  return studyId.slice('c1-f0-'.length, 'c1-f0-'.length + 8)
}

function shortDigest(value: string): string {
  return sha256(value).slice(0, 8)
}

async function claimStudyDir(outputRoot: string, studyId: string): Promise<string> {
  assertStudyId(studyId)
  await mkdir(outputRoot, { recursive: true })
  const reportDir = join(outputRoot, studyId)
  try {
    await mkdir(reportDir)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { readonly code?: unknown }).code === 'EEXIST'
    ) {
      throw new C1PreflightFailure(
        'IDENTITY_REUSE',
        `F0 study identity ${studyId} is already claimed`
      )
    }
    throw error
  }
  await mkdir(join(reportDir, 'legs'))
  return reportDir
}

async function claimLegDir(reportDir: string, runId: string): Promise<string> {
  assertRunId(runId)
  const legDir = join(reportDir, 'legs', runId)
  try {
    await mkdir(legDir)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { readonly code?: unknown }).code === 'EEXIST'
    ) {
      throw new C1PreflightFailure('IDENTITY_REUSE', `F0 run identity ${runId} is already claimed`)
    }
    throw error
  }
  return legDir
}

/** Load and fail-closed validate the F0 machine-readable contract. */
export async function loadC1F0Contract(repoRoot: string): Promise<C1F0Contract> {
  const path = resolve(repoRoot, C1_F0_CONTRACT_RELATIVE_PATH)
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
  const record = asRecord(raw, 'F0 contract')
  if (record['contractId'] !== 'C1_F0_EXECUTION_FEASIBILITY_V1') {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', 'unexpected F0 contract id')
  }
  if (
    record['schemaVersion'] !== 1 ||
    !['PREPARED', 'FROZEN'].includes(record['status'] as string)
  ) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'F0 contract is not prepared or frozen'
    )
  }
  if (hashContract(raw) !== record['runContractSha256']) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', 'F0 run contract hash mismatch')
  }
  const design = asRecord(record['design'], 'F0 design')
  const runOrder = asRecord(design['runOrder'], 'F0 design.runOrder')
  const confidence = asRecord(design['confidence'], 'F0 design.confidence')
  const pattern = stringArray(runOrder['pattern'], 'F0 design.runOrder.pattern')
  if (
    design['arm'] !== 'NATIVE_ONLY' ||
    design['runtimeIntervention'] !== 'DISABLED' ||
    design['taskCount'] !== 2 ||
    design['runsPerTask'] !== 16 ||
    design['totalRuns'] !== 32 ||
    design['maxConcurrency'] !== 1 ||
    runOrder['repetitions'] !== 16 ||
    pattern.length !== 2 ||
    confidence['level'] !== 0.95 ||
    confidence['intervalMethod'] !== 'CLOPPER_PEARSON_EXACT' ||
    confidence['tail'] !== 'ONE_SIDED'
  ) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', 'F0 design numbers or arm drifted')
  }
  const taskPanelRaw = record['taskPanel']
  if (!Array.isArray(taskPanelRaw) || taskPanelRaw.length !== 2) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'F0 task panel must contain two tasks'
    )
  }
  const taskPanel = taskPanelRaw.map(parseTaskPanelEntry) as [
    C1F0ContractTaskPanelEntry,
    C1F0ContractTaskPanelEntry
  ]
  const binding = asRecord(record['executionBinding'], 'F0 executionBinding')
  const codeRevision = requiredString(binding['codeRevision'], 'F0 executionBinding.codeRevision')
  const executionSurfaceHash = requiredString(
    binding['executionSurfaceHash'],
    'F0 executionBinding.executionSurfaceHash'
  )
  if (
    binding['provider'] !== C1_PROVIDER_ID ||
    binding['model'] !== C1_MODEL_ID ||
    binding['endpoint'] !== C1_PROVIDER_ENDPOINT ||
    binding['nodeRange'] !== C1_NODE_RANGE ||
    binding['credentialEnv'] !== 'STEP_PLAN_API_KEY' ||
    binding['credentialPersistence'] !== 'MEMORY_ONLY' ||
    binding['fallback'] !== 'NONE' ||
    binding['runtimeIntervention'] !== 'DISABLED' ||
    binding['providerConfigHash'] !== C1_E0_PROVIDER_CONFIG_HASH ||
    (codeRevision !== F0_PENDING_BINDING && !/^[0-9a-f]{40}$/i.test(codeRevision)) ||
    (executionSurfaceHash !== F0_PENDING_BINDING && !/^[0-9a-f]{64}$/i.test(executionSurfaceHash))
  ) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', 'F0 execution binding drifted')
  }
  const enrollmentBinding = asRecord(record['enrollmentBinding'], 'F0 enrollmentBinding')
  const manifestPath = requiredString(
    enrollmentBinding['taskManifestPath'],
    'F0 enrollmentBinding.taskManifestPath'
  )
  const manifestSha = requiredHash(
    enrollmentBinding['taskManifestSha256'],
    'F0 enrollmentBinding.taskManifestSha256'
  )
  const manifestBytes = await readFile(resolve(repoRoot, manifestPath))
  if (sha256Bytes(manifestBytes) !== manifestSha) {
    throw new C1PreflightFailure('MANIFEST_BINDING_MISMATCH', 'F0 task manifest hash mismatch')
  }
  const frozen = await loadC1FrozenStudy(repoRoot)
  for (const panelEntry of taskPanel) {
    const task = frozen.tasks.find((candidate) => candidate.taskId === panelEntry.taskId)
    if (
      task === undefined ||
      task.stratum !== panelEntry.stratum ||
      task.fixturePath !== panelEntry.fixturePath ||
      task.fixtureRevision.fixtureTreeObjectId !== panelEntry.fixtureTreeObjectId ||
      task.fixtureRevision.fixtureContentSha256 !== panelEntry.fixtureContentSha256 ||
      task.promptSha256 !== panelEntry.promptSha256 ||
      canonicalJson(task.objectiveOracle) !== canonicalJson(panelEntry.objectiveOracle) ||
      canonicalJson(task.regressionOracle) !== canonicalJson(panelEntry.regressionOracle) ||
      canonicalJson(task.expectedWritablePaths) !== canonicalJson(panelEntry.expectedWritablePaths)
    ) {
      throw new C1PreflightFailure(
        'MANIFEST_BINDING_MISMATCH',
        `F0 task panel drifted for ${panelEntry.taskId}`
      )
    }
  }
  const budgets = asRecord(record['budgets'], 'F0 budgets')
  const perRun = asRecord(budgets['perRun'], 'F0 budgets.perRun')
  const study = asRecord(budgets['study'], 'F0 budgets.study')
  if (
    perRun['maxProviderRequests'] !== 24 ||
    perRun['maxToolRequests'] !== 96 ||
    perRun['maxWallClockMs'] !== 600000 ||
    perRun['maxOutputTokensPerRequest'] !== 16384 ||
    study['maxProviderRequests'] !== 768 ||
    study['maxToolRequests'] !== 3072 ||
    study['maxWallClockMs'] !== 19200000 ||
    study['maxRuns'] !== 32 ||
    study['maxConcurrency'] !== 1
  ) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', 'F0 budget binding drifted')
  }
  const gates = asRecord(record['gates'], 'F0 gates')
  const validity = asRecord(gates['validity'], 'F0 gates.validity')
  const precision = asRecord(gates['precision'], 'F0 gates.precision')
  const feasibility = asRecord(gates['feasibility'], 'F0 gates.feasibility')
  if (
    validity['sharedInvalidatorCount'] !== 0 ||
    validity['bindingsValid'] !== true ||
    validity['singleStudyId'] !== true ||
    validity['uniqueRunIds'] !== true ||
    validity['checkpointReportJoin'] !== 'REQUIRED' ||
    validity['rawCredentialOrPayloadLeakage'] !== 'FORBIDDEN' ||
    precision['startedRunsPerTask'] !== 16 ||
    precision['taskPanelCoverage'] !== 2 ||
    precision['postHocRemoval'] !== 'FORBIDDEN'
  ) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'F0 validity or precision gates drifted'
    )
  }
  return {
    contractId: 'C1_F0_EXECUTION_FEASIBILITY_V1',
    schemaVersion: 1,
    status: record['status'] as 'PREPARED' | 'FROZEN',
    designStatus: requiredString(record['designStatus'], 'F0 designStatus'),
    estimand: requiredString(record['estimand'], 'F0 estimand'),
    design: {
      arm: 'NATIVE_ONLY',
      runtimeIntervention: 'DISABLED',
      taskPanelId: requiredString(design['taskPanelId'], 'F0 design.taskPanelId'),
      taskCount: 2,
      runsPerTask: 16,
      totalRuns: 32,
      maxConcurrency: 1,
      runOrder: {
        algorithmId: requiredString(runOrder['algorithmId'], 'F0 design.runOrder.algorithmId'),
        seed: requiredString(runOrder['seed'], 'F0 design.runOrder.seed'),
        pattern: pattern as [string, string],
        repetitions: 16
      },
      confidence: {
        level: 0.95,
        intervalMethod: 'CLOPPER_PEARSON_EXACT',
        tail: 'ONE_SIDED'
      }
    },
    taskPanel,
    enrollmentBinding: {
      taskManifestPath: manifestPath,
      taskManifestSha256: manifestSha,
      panelSelection: requiredString(
        enrollmentBinding['panelSelection'],
        'F0 enrollmentBinding.panelSelection'
      )
    },
    executionBinding: {
      provider: C1_PROVIDER_ID,
      model: C1_MODEL_ID,
      endpoint: C1_PROVIDER_ENDPOINT,
      nodeRange: C1_NODE_RANGE,
      codeRevision,
      executionSurfaceHash,
      credentialEnv: 'STEP_PLAN_API_KEY',
      credentialPersistence: 'MEMORY_ONLY',
      fallback: 'NONE',
      runtimeIntervention: 'DISABLED',
      providerConfigHash: C1_E0_PROVIDER_CONFIG_HASH
    },
    budgets: {
      perRun: {
        maxProviderRequests: 24,
        maxToolRequests: 96,
        maxWallClockMs: 600000,
        maxOutputTokensPerRequest: 16384
      },
      study: {
        maxProviderRequests: 768,
        maxToolRequests: 3072,
        maxWallClockMs: 19200000,
        maxRuns: 32,
        maxConcurrency: 1
      }
    },
    gates: {
      validity: {
        sharedInvalidatorCount: 0,
        bindingsValid: true,
        singleStudyId: true,
        uniqueRunIds: true,
        checkpointReportJoin: 'REQUIRED',
        rawCredentialOrPayloadLeakage: 'FORBIDDEN'
      },
      precision: {
        startedRunsPerTask: 16,
        taskPanelCoverage: 2,
        confidenceRule: requiredString(precision['confidenceRule'], 'F0 precision confidenceRule'),
        postHocRemoval: 'FORBIDDEN'
      },
      feasibility: {
        perTaskEndToEndSuccessLowerBound: Number(feasibility['perTaskEndToEndSuccessLowerBound']),
        perTaskBudgetExhaustionUpperBound: Number(feasibility['perTaskBudgetExhaustionUpperBound']),
        perTaskUnrecoveredToolFailureRunUpperBound: Number(
          feasibility['perTaskUnrecoveredToolFailureRunUpperBound']
        ),
        perTaskOraclePassAmongAdjudicableLowerBound: Number(
          feasibility['perTaskOraclePassAmongAdjudicableLowerBound']
        )
      }
    },
    runContractSha256: requiredHash(record['runContractSha256'], 'F0 runContractSha256')
  }
}

/** Build the frozen 32-run alternating Native plan. */
export function buildC1F0ExecutionPlans(
  contract: C1F0Contract,
  studyId: string
): readonly C1F0ExecutionPlan[] {
  assertStudyId(studyId)
  const plans: C1F0ExecutionPlan[] = []
  for (let repetition = 1; repetition <= contract.design.runOrder.repetitions; repetition += 1) {
    for (const [index, taskId] of contract.design.runOrder.pattern.entries()) {
      const panelEntry = contract.taskPanel.find((task) => task.taskId === taskId)
      if (panelEntry === undefined) {
        throw new C1PreflightFailure('ASSIGNMENT_BINDING_MISMATCH', `unknown F0 task ${taskId}`)
      }
      const runOrdinal = plans.length + 1
      const runId = `c1-f0-${dateToken(studyId)}-run-${String(runOrdinal).padStart(2, '0')}-${shortDigest(
        `${studyId}:${taskId}:${repetition}`
      )}`
      assertRunId(runId)
      plans.push({
        runOrdinal,
        repetition,
        taskOrdinal: (index + 1) as 1 | 2,
        taskId,
        stratum: panelEntry.stratum,
        runId,
        pairId: `${taskId}-run-${String(repetition).padStart(2, '0')}`
      })
    }
  }
  if (
    plans.length !== 32 ||
    plans.filter((plan) => plan.taskOrdinal === 1).length !== 16 ||
    plans.filter((plan) => plan.taskOrdinal === 2).length !== 16
  ) {
    throw new C1PreflightFailure(
      'ASSIGNMENT_BINDING_MISMATCH',
      'F0 plan does not contain 32 alternating runs'
    )
  }
  return Object.freeze(plans)
}

async function gitExecutableRevision(repoRoot: string): Promise<string> {
  const result = await runProcess(
    'git',
    ['log', '-1', '--format=%H', '--', ...C1_F0_EXECUTION_SURFACE_PATHS],
    { cwd: repoRoot, timeoutMs: 30_000, env: buildSanitizedChildEnvironment() }
  )
  const revision = result.stdout.trim()
  if (result.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'unable to resolve the F0 executable revision'
    )
  }
  return revision
}

/** Hash the tracked headless execution surface; Electron and docs are excluded. */
export async function computeC1F0ExecutionSurfaceHash(repoRoot: string): Promise<string> {
  const result = await runProcess(
    'git',
    ['ls-files', '-z', '--', ...C1_F0_EXECUTION_SURFACE_PATHS],
    { cwd: repoRoot, timeoutMs: 30_000, env: buildSanitizedChildEnvironment() }
  )
  if (result.exitCode !== 0 || result.timedOut || result.outputLimitExceeded) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'unable to enumerate F0 execution surface'
    )
  }
  const files = result.stdout.split('\0').filter(Boolean).sort()
  if (files.length === 0) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', 'F0 execution surface is empty')
  }
  const rows: string[] = []
  for (const file of files)
    rows.push(`${sha256Bytes(await readFile(join(repoRoot, file)))}  ${file}`)
  return sha256(`${rows.join('\n')}\n`)
}

export async function computeC1F0ExecutionBinding(repoRoot: string): Promise<{
  readonly executionRevision: string
  readonly executionSurfaceHash: string
}> {
  const [executionRevision, executionSurfaceHash] = await Promise.all([
    gitExecutableRevision(repoRoot),
    computeC1F0ExecutionSurfaceHash(repoRoot)
  ])
  return { executionRevision, executionSurfaceHash }
}

function fakeUsage(inputTokens: number, outputTokens: number): C1LiveModelResponse['usage'] {
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: inputTokens + outputTokens,
    usageSource: 'SCRIPTED_FAKE'
  }
}

/**
 * A no-network source used only by tests and readiness checks. It deliberately
 * performs no task-specific edit, so any oracle PASS must come from a caller
 * supplied test source and can never be mistaken for a model result.
 */
export class C1F0CredentialFreeResponseSource implements C1LiveResponseSource {
  readonly kind = 'SCRIPTED_FAKE' as const
  private cursor = 0

  constructor(
    private readonly runId: string,
    private readonly mode: 'COMPLETE' | 'TOOL_LOOP' | 'BUDGET_EXHAUSTION' = 'TOOL_LOOP'
  ) {}

  get responsesServed(): number {
    return this.cursor
  }

  async next(request: { readonly capture: C1ProviderBoundCapture }): Promise<C1LiveModelResponse> {
    if (request.capture.providerConfigHash !== C1_E0_PROVIDER_CONFIG_HASH) {
      throw new C1PreflightFailure(
        'PROVIDER_BINDING_MISMATCH',
        'F0 fake source received a hash mismatch'
      )
    }
    if (this.mode === 'BUDGET_EXHAUSTION') {
      if (this.cursor >= 24) {
        throw new C1PreflightFailure(
          'BUDGET_BREACH',
          'F0 fake source exceeded the per-run response budget'
        )
      }
      this.cursor += 1
      return {
        responseId: `${this.runId}-response-${String(this.cursor).padStart(2, '0')}`,
        assistantMessageCount: 1,
        assistantContent: 'credential-free budget-boundary response',
        usage: fakeUsage(10, 1),
        toolRequests: [],
        toolExecutions: [],
        outcome: 'CONTINUE'
      }
    }
    this.cursor += 1
    if (this.mode === 'COMPLETE') {
      return {
        responseId: `${this.runId}-response-01`,
        assistantMessageCount: 1,
        assistantContent: 'credential-free scripted completion',
        usage: fakeUsage(12, 2),
        toolRequests: [],
        toolExecutions: [],
        outcome: 'COMPLETE'
      }
    }
    if (this.cursor === 1) {
      return {
        responseId: `${this.runId}-response-01`,
        assistantMessageCount: 1,
        assistantContent: 'credential-free source exercises the tool boundary',
        usage: fakeUsage(20, 3),
        toolRequests: [
          {
            toolCallId: `${this.runId}-bash-01`,
            toolName: 'bash',
            argumentsJson: JSON.stringify({ command: 'node --version' })
          }
        ],
        toolExecutions: [],
        outcome: 'CONTINUE'
      }
    }
    return {
      responseId: `${this.runId}-response-02`,
      assistantMessageCount: 1,
      assistantContent: 'credential-free scripted completion after tool boundary',
      usage: fakeUsage(18, 2),
      toolRequests: [],
      toolExecutions: [],
      outcome: 'COMPLETE'
    }
  }
}

class F0CheckpointSink implements C1LiveBindingEvidenceSink {
  private readonly entries: C1LiveBindingCheckpoint[] = []
  private ordinal = 0

  constructor(private readonly durable: C1JsonlLiveBindingEvidenceSink) {}

  async append(checkpoint: C1LiveBindingCheckpoint): Promise<void> {
    const normalized = {
      ...checkpoint,
      checkpointOrdinal: ++this.ordinal
    } as C1LiveBindingCheckpoint
    await this.durable.append(normalized)
    this.entries.push(normalized)
  }

  get checkpoints(): readonly C1LiveBindingCheckpoint[] {
    return [...this.entries]
  }
}

function failureOf(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof C1PreflightFailure) return { code: error.code, message: error.message }
  return {
    code: 'RUN_FAILURE',
    message: error instanceof Error ? error.message : String(error)
  }
}

function evidenceForRun(
  checkpoints: readonly C1LiveBindingCheckpoint[],
  runId: string
): readonly C1LiveBindingEvidence[] {
  return checkpoints
    .filter(
      (
        checkpoint
      ): checkpoint is Extract<C1LiveBindingCheckpoint, { phase: 'RESPONSE_RECORDED' }> =>
        checkpoint.phase === 'RESPONSE_RECORDED' && checkpoint.evidence.runId === runId
    )
    .map((checkpoint) => checkpoint.evidence)
}

function checkpointJoinComplete(
  checkpoints: readonly C1LiveBindingCheckpoint[],
  runId: string,
  responseCalls: number
): boolean {
  if (responseCalls === 0) return false
  for (let ordinal = 1; ordinal <= responseCalls; ordinal += 1) {
    if (
      !checkpoints.some(
        (checkpoint) =>
          checkpoint.phase === 'OUTBOUND_PERMITTED' &&
          checkpoint.callOrdinal === ordinal &&
          checkpoint.capture.runId === runId
      ) ||
      !checkpoints.some(
        (checkpoint) =>
          checkpoint.phase === 'RESPONSE_RECEIVED' &&
          checkpoint.callOrdinal === ordinal &&
          checkpoint.receipt.runId === runId
      ) ||
      !checkpoints.some(
        (checkpoint) =>
          checkpoint.phase === 'RESPONSE_RECORDED' &&
          checkpoint.callOrdinal === ordinal &&
          checkpoint.evidence.runId === runId
      )
    ) {
      return false
    }
  }
  return true
}

function oracleStatus(evaluation: C1TaskEvaluation | undefined): C1F0OracleStatus {
  if (evaluation === undefined) return 'NOT_ADJUDICABLE'
  if (evaluation.status === 'HARNESS_CONTRACT_FAILURE') return 'UNKNOWN'
  return evaluation.status === 'PASS' ? 'PASS' : 'FAIL'
}

function combineOracleStatus(
  objective: C1F0OracleStatus,
  regression: C1F0OracleStatus
): C1F0OracleStatus {
  if (objective === 'UNKNOWN' || regression === 'UNKNOWN') return 'UNKNOWN'
  if (objective === 'NOT_ADJUDICABLE' || regression === 'NOT_ADJUDICABLE') {
    return 'NOT_ADJUDICABLE'
  }
  return objective === 'PASS' && regression === 'PASS' ? 'PASS' : 'FAIL'
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
    responseEvidence: {
      status: 'OBSERVED',
      usage: 'UNAVAILABLE',
      zeroSubstitutionAllowed: false
    },
    assistantMessages: row.assistantMessages,
    toolCalls: row.toolCalls,
    toolRequestEvidence: row.toolRequestEvidence,
    toolEvents: row.toolEvents,
    provider: row.provider,
    model: row.model,
    endpoint: row.endpoint,
    providerConfigHash: row.providerConfigHash,
    contextStrategy: row.contextStrategy,
    providerBoundSourceKeys: row.providerBoundSourceKeys,
    modelVisibleSemanticContextFingerprint: row.modelVisibleSemanticContextFingerprint,
    systemDeveloperToolStructuresFingerprint: row.systemDeveloperToolStructuresFingerprint,
    workingSetId: row.workingSetId,
    transitionId: row.transitionId,
    transitionDecisionKinds: row.transitionDecisionKinds,
    lifecycleEligible: row.lifecycleEligible,
    runtimeContextChanged: row.runtimeContextChanged,
    fallbackSent: row.fallbackSent,
    networkSent: row.networkSent,
    replayMismatch: row.replayMismatch
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
  name: string
): Promise<C1F0ExecutionArtifactSummary> {
  const bytes = await readFile(join(reportDir, name))
  return { name, sha256: sha256Bytes(bytes), bytes: bytes.byteLength }
}

/** Lanczos log-gamma approximation, sufficient for the small F0 intervals. */
function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
    12.507343278686905, -0.13857109526572012, 9.984369578019571e-6, 1.5056327351493116e-7
  ]
  if (value < 0.5)
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value)
  let x = 0.9999999999998099
  const shifted = value - 1
  for (const [index, coefficient] of coefficients.entries())
    x += coefficient / (shifted + index + 1)
  const t = shifted + coefficients.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x)
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 200
  const epsilon = 3e-14
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let result = d
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const m2 = 2 * iteration
    let numerator = (iteration * (b - iteration) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + numerator * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + numerator / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    result *= d * c
    numerator = (-(a + iteration) * (a + b + iteration) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + numerator * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + numerator / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    result *= delta
    if (Math.abs(delta - 1) < epsilon) break
  }
  return result
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const logFactor =
    a * Math.log(x) + b * Math.log1p(-x) - logGamma(a) - logGamma(b) + logGamma(a + b)
  const factor = Math.exp(logFactor)
  if (x < (a + 1) / (a + b + 2)) return (factor * betaContinuedFraction(a, b, x)) / a
  return 1 - (factor * betaContinuedFraction(b, a, 1 - x)) / b
}

function betaQuantile(probability: number, a: number, b: number): number {
  if (probability <= 0) return 0
  if (probability >= 1) return 1
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const middle = (low + high) / 2
    if (regularizedBeta(middle, a, b) < probability) low = middle
    else high = middle
  }
  return (low + high) / 2
}

export function clopperPearsonLower(successes: number, trials: number, alpha = 0.05): number {
  if (trials <= 0 || successes <= 0) return 0
  return betaQuantile(alpha, successes, trials - successes + 1)
}

export function clopperPearsonUpper(failures: number, trials: number, alpha = 0.05): number {
  if (trials <= 0 || failures <= 0) {
    return trials <= 0 ? 0 : betaQuantile(1 - alpha, 1, trials)
  }
  if (failures >= trials) return 1
  return betaQuantile(1 - alpha, failures + 1, trials - failures)
}

function taskSummary(
  taskId: string,
  stratum: string,
  runs: readonly C1F0RunRecord[],
  contract: C1F0Contract
): C1F0TaskFeasibilitySummary {
  const started = runs.filter((run) => run.terminationStatus !== 'BLOCKED')
  const terminalCompleteRuns = started.filter(
    (run) => run.terminationStatus === 'TERMINAL_COMPLETE'
  ).length
  const successes = started.filter(
    (run) =>
      run.terminationStatus === 'TERMINAL_COMPLETE' &&
      run.oracleStatus === 'PASS' &&
      run.evidenceStatus === 'COMPLETE' &&
      run.fixtureCleaned &&
      run.writableScopePass
  ).length
  const budgetExhaustionRuns = started.filter(
    (run) => run.terminationStatus === 'BUDGET_EXHAUSTED'
  ).length
  const unrecoveredToolFailureRuns = started.filter(
    (run) => run.diagnostics.unrecoveredToolFailure
  ).length
  const oracleAdjudicableRuns = started.filter(
    (run) => run.oracleStatus === 'PASS' || run.oracleStatus === 'FAIL'
  ).length
  const oraclePassesAmongAdjudicable = started.filter((run) => run.oracleStatus === 'PASS').length
  const trials = started.length
  const oracleTrials = oracleAdjudicableRuns
  const intervals95 = {
    endToEndSuccessLower: clopperPearsonLower(successes, trials),
    budgetExhaustionUpper: clopperPearsonUpper(budgetExhaustionRuns, trials),
    unrecoveredToolFailureRunUpper: clopperPearsonUpper(unrecoveredToolFailureRuns, trials),
    oraclePassAmongAdjudicableLower: clopperPearsonLower(oraclePassesAmongAdjudicable, oracleTrials)
  }
  const limits = contract.gates.feasibility
  const gates = {
    endToEndSuccess: intervals95.endToEndSuccessLower >= limits.perTaskEndToEndSuccessLowerBound,
    budgetExhaustion: intervals95.budgetExhaustionUpper <= limits.perTaskBudgetExhaustionUpperBound,
    unrecoveredToolFailureRun:
      intervals95.unrecoveredToolFailureRunUpper <=
      limits.perTaskUnrecoveredToolFailureRunUpperBound,
    oraclePassAmongAdjudicable:
      oracleTrials > 0 &&
      intervals95.oraclePassAmongAdjudicableLower >=
        limits.perTaskOraclePassAmongAdjudicableLowerBound,
    pass:
      trials === 16 &&
      intervals95.endToEndSuccessLower >= limits.perTaskEndToEndSuccessLowerBound &&
      intervals95.budgetExhaustionUpper <= limits.perTaskBudgetExhaustionUpperBound &&
      intervals95.unrecoveredToolFailureRunUpper <=
        limits.perTaskUnrecoveredToolFailureRunUpperBound &&
      oracleTrials > 0 &&
      intervals95.oraclePassAmongAdjudicableLower >=
        limits.perTaskOraclePassAmongAdjudicableLowerBound
  }
  return {
    taskId,
    stratum,
    startedRuns: started.length,
    plannedRuns: 16,
    terminalCompleteRuns,
    endToEndSuccesses: successes,
    budgetExhaustionRuns,
    unrecoveredToolFailureRuns,
    oraclePassesAmongAdjudicable,
    oracleAdjudicableRuns,
    rates: {
      endToEndSuccess: trials === 0 ? 0 : successes / trials,
      budgetExhaustion: trials === 0 ? 0 : budgetExhaustionRuns / trials,
      unrecoveredToolFailureRun: trials === 0 ? 0 : unrecoveredToolFailureRuns / trials,
      oraclePassAmongAdjudicable:
        oracleTrials === 0 ? 0 : oraclePassesAmongAdjudicable / oracleTrials
    },
    intervals95,
    gates
  }
}

/** Pure study adjudicator; it never reads fixtures, oracles, or credentials. */
export function adjudicateC1F0Study(
  contract: C1F0Contract,
  runs: readonly C1F0RunRecord[]
): C1F0AdjudicationSummary {
  const taskIds = contract.taskPanel.map((task) => task.taskId)
  const summaries = taskIds.map((taskId) => {
    const task = contract.taskPanel.find((candidate) => candidate.taskId === taskId)!
    return taskSummary(
      taskId,
      task.stratum,
      runs.filter((run) => run.taskId === taskId),
      contract
    )
  })
  const invalidRuns = runs.filter(
    (run) =>
      run.evidenceStatus === 'INVALID' ||
      run.terminationStatus === 'PROVIDER_BOUNDARY_FAILURE' ||
      run.terminationStatus === 'TOOL_BOUNDARY_FAILURE'
  )
  const runIds = runs.map((run) => run.runId)
  const uniqueRunIds = new Set(runIds).size === runIds.length
  const startedRunsPerTask = Object.fromEntries(
    summaries.map((summary) => [summary.taskId, summary.startedRuns])
  )
  const validityReasons: string[] = []
  if (invalidRuns.length > 0) validityReasons.push(`invalidRuns=${invalidRuns.length}`)
  const validityGate = {
    pass: invalidRuns.length === 0,
    sharedInvalidatorCount: invalidRuns.length,
    reasons: Object.freeze(validityReasons)
  }
  const precisionReasons: string[] = []
  if (!uniqueRunIds) precisionReasons.push('run identities are not unique')
  if (summaries.some((summary) => summary.startedRuns !== 16)) {
    precisionReasons.push('each task does not have 16 started runs')
  }
  const precisionGate = {
    pass: uniqueRunIds && summaries.every((summary) => summary.startedRuns === 16),
    startedRunsPerTask,
    uniqueRunIds,
    taskPanelCoverage: summaries.filter((summary) => summary.startedRuns > 0).length,
    reasons: Object.freeze(precisionReasons)
  }
  const feasibilityGate = {
    pass: summaries.every((summary) => summary.gates.pass),
    tasks: Object.freeze(summaries)
  }
  const status: C1F0ExecutionStatus = !validityGate.pass
    ? 'F0_NO_GO'
    : !precisionGate.pass
      ? 'F0_HOLD'
      : feasibilityGate.pass
        ? 'GO_TO_T0_DESIGN'
        : 'F0_FEASIBILITY_NO_GO'
  return {
    status,
    validityGate,
    precisionGate,
    feasibilityGate,
    taskSummaries: Object.freeze(summaries)
  }
}

function defaultRunRecord(plan: C1F0ExecutionPlan, failureCode?: string): C1F0RunRecord {
  return {
    runOrdinal: plan.runOrdinal,
    repetition: plan.repetition,
    taskOrdinal: plan.taskOrdinal,
    taskId: plan.taskId,
    stratum: plan.stratum,
    runId: plan.runId,
    pairId: plan.pairId,
    terminationStatus: 'BLOCKED',
    oracleStatus: 'NOT_ADJUDICABLE',
    objectiveOracleStatus: 'NOT_ADJUDICABLE',
    regressionOracleStatus: 'NOT_ADJUDICABLE',
    evidenceStatus: 'INVALID',
    fixtureCleaned: false,
    changedPaths: [],
    writableScopePass: false,
    diagnostics: {
      providerCallPermits: 0,
      responseCalls: 0,
      toolRequestCount: 0,
      toolExecutionCount: 0,
      toolErrorCount: 0,
      recoveredToolErrorCount: 0,
      providerErrorCount: 0,
      unrecoveredToolFailure: false,
      checkpointJoinComplete: false
    },
    ...(failureCode === undefined ? {} : { failureCode })
  }
}

async function copyForOracle(
  source: string
): Promise<{ readonly path: string; readonly cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'canvas-c1-f0-oracle-'))
  try {
    await cp(source, path, { recursive: true, force: true })
    return { path, cleanup: async () => rm(path, { recursive: true, force: true }) }
  } catch (error) {
    await rm(path, { recursive: true, force: true })
    throw error
  }
}

function classifyTermination(error: unknown): C1F0TerminationStatus {
  if (error instanceof C1PreflightFailure) {
    if (error.code === 'BUDGET_BREACH' || error.message.includes('maxCalls'))
      return 'BUDGET_EXHAUSTED'
    if (
      error.code === 'PROVIDER_BINDING_MISMATCH' ||
      error.code === 'PROVIDER_PREPARATION_FAILURE'
    ) {
      return 'PROVIDER_BOUNDARY_FAILURE'
    }
    if (error.code === 'EVIDENCE_WRITE_FAILURE') return 'TOOL_BOUNDARY_FAILURE'
  }
  return 'TERMINAL_FAILED'
}

function isSharedInvalidator(code: string): boolean {
  return new Set([
    'CONTRACT_BINDING_MISMATCH',
    'MANIFEST_BINDING_MISMATCH',
    'IDENTITY_REUSE',
    'IDENTITY_INVALID',
    'EVIDENCE_WRITE_FAILURE',
    'PROVIDER_BINDING_MISMATCH',
    'PROVIDER_PREPARATION_FAILURE'
  ]).has(code)
}

async function writeF0Artifacts(input: {
  readonly reportDir: string
  readonly contract: C1F0Contract
  readonly studyId: string
  readonly scenario: C1F0FakeScenario
  readonly executionRevision: string | null
  readonly executionSurfaceHash: string | null
  readonly providerConfigHash: string
  readonly runs: readonly C1F0RunRecord[]
  readonly checkpoints: readonly C1LiveBindingCheckpoint[]
  readonly feasibility: C1F0AdjudicationSummary
  readonly failures: readonly { readonly code: string; readonly message: string }[]
}): Promise<readonly C1F0ExecutionArtifactSummary[]> {
  const responseRows = input.checkpoints
    .filter(
      (
        checkpoint
      ): checkpoint is Extract<C1LiveBindingCheckpoint, { phase: 'RESPONSE_RECORDED' }> =>
        checkpoint.phase === 'RESPONSE_RECORDED'
    )
    .map((checkpoint) => metadataEvidence(checkpoint.evidence))
  const phaseCounts = Object.fromEntries(
    ['OUTBOUND_PERMITTED', 'RESPONSE_RECEIVED', 'TOOL_EXECUTION_RECORDED', 'RESPONSE_RECORDED'].map(
      (phase) => [
        phase,
        input.checkpoints.filter((checkpoint) => checkpoint.phase === phase).length
      ]
    )
  )
  const studyManifest = {
    runnerId: C1_F0_RUNNER_ID,
    schemaVersion: C1_F0_RUNNER_SCHEMA_VERSION,
    executionMode: C1_F0_RUNNER_MODE,
    scenario: input.scenario,
    studyId: input.studyId,
    contractId: input.contract.contractId,
    runContractSha256: input.contract.runContractSha256,
    executionRevision: input.executionRevision,
    executionSurfaceHash: input.executionSurfaceHash,
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    providerConfigHash: input.providerConfigHash,
    responseSource: 'SCRIPTED_FAKE',
    providerCalls: 0,
    networkRequests: 0,
    fallback: 'NONE',
    credentialPersistence: 'MEMORY_ONLY',
    runtimeIntervention: 'DISABLED',
    taskPanel: input.contract.taskPanel.map((task) => ({
      taskId: task.taskId,
      stratum: task.stratum
    })),
    runsPlanned: 32,
    requiredArtifacts: F0_REQUIRED_ARTIFACTS
  }
  const runManifest = {
    studyId: input.studyId,
    status: input.feasibility.status,
    runsPlanned: 32,
    runsStarted: input.runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
    runsCompleted: input.runs.filter(
      (run) => run.terminationStatus !== 'BLOCKED' && run.evidenceStatus !== 'INVALID'
    ).length,
    blockedRuns: input.runs.filter((run) => run.terminationStatus === 'BLOCKED').length,
    providerCalls: 0,
    networkRequests: 0,
    failures: input.failures,
    runs: input.runs
  }
  const checkpointSummary = {
    studyId: input.studyId,
    checkpointCount: input.checkpoints.length,
    phaseCounts,
    responseRunIds: Object.fromEntries(
      input.runs.map((run) => [
        run.runId,
        input.checkpoints.filter((checkpoint) => {
          if (checkpoint.phase === 'OUTBOUND_PERMITTED')
            return checkpoint.capture.runId === run.runId
          if (checkpoint.phase === 'RESPONSE_RECEIVED')
            return checkpoint.receipt.runId === run.runId
          if (checkpoint.phase === 'RESPONSE_RECORDED')
            return checkpoint.evidence.runId === run.runId
          return checkpoint.runId === run.runId
        }).length
      ])
    )
  }
  const adjudicationRows = input.runs.map((run) => ({
    studyId: input.studyId,
    runOrdinal: run.runOrdinal,
    taskId: run.taskId,
    stratum: run.stratum,
    runId: run.runId,
    terminationStatus: run.terminationStatus,
    oracleStatus: run.oracleStatus,
    objectiveOracleStatus: run.objectiveOracleStatus,
    regressionOracleStatus: run.regressionOracleStatus,
    evidenceStatus: run.evidenceStatus,
    fixtureCleaned: run.fixtureCleaned,
    changedPaths: run.changedPaths,
    writableScopePass: run.writableScopePass,
    diagnostics: run.diagnostics,
    ...(run.failureCode === undefined ? {} : { failureCode: run.failureCode })
  }))
  const documents: ReadonlyArray<readonly [string, string]> = [
    ['study-manifest.json', `${JSON.stringify(studyManifest, null, 2)}\n`],
    ['run-manifest.json', `${JSON.stringify(runManifest, null, 2)}\n`],
    ['checkpoint-summary.json', `${JSON.stringify(checkpointSummary, null, 2)}\n`],
    ['response-ledger.jsonl', responseRows.map((row) => `${JSON.stringify(row)}\n`).join('')],
    ['task-adjudication.jsonl', adjudicationRows.map((row) => `${JSON.stringify(row)}\n`).join('')],
    ['feasibility-summary.json', `${JSON.stringify(input.feasibility, null, 2)}\n`]
  ]
  for (const [name, content] of documents) await writeDurable(join(input.reportDir, name), content)
  const checkpointPath = join(input.reportDir, 'checkpoints.jsonl')
  try {
    await stat(checkpointPath)
  } catch {
    await writeDurable(checkpointPath, '')
  }
  const artifacts: C1F0ExecutionArtifactSummary[] = []
  for (const name of F0_REQUIRED_ARTIFACTS)
    artifacts.push(await artifactSummary(input.reportDir, name))
  const serialized = await Promise.all(
    F0_REQUIRED_ARTIFACTS.map(async (name) => readFile(join(input.reportDir, name), 'utf8'))
  )
  if (
    serialized.some((content) =>
      /providerBoundMessages|argumentsJson|assistantContent|rawProviderPayload|authorizationHeader|toolResultContent/.test(
        content
      )
    )
  ) {
    throw new C1PreflightFailure(
      'EVIDENCE_WRITE_FAILURE',
      'F0 artifact set contains forbidden raw payload'
    )
  }
  return Object.freeze(artifacts)
}

/**
 * Run the complete 32-run F0 state machine without Provider access. The
 * scripted source is a transport substitute only; oracle outcomes remain
 * ordinary post-run evidence and never enter model-visible context.
 */
export async function runC1F0CredentialFreeStudy(
  options: C1F0ExecutionRunnerOptions = {}
): Promise<C1F0ExecutionReport> {
  const repoRoot = options.repoRoot ?? resolve(import.meta.dirname, '..', '..', '..')
  const scenario = options.scenario ?? 'TOOL_LOOP'
  const studyId = options.studyId ?? createStudyId(options.now ?? new Date())
  const failures: { code: string; message: string }[] = []
  let contract: C1F0Contract | null = null
  let reportDir: string | null = null
  let executionRevision: string | null = null
  let executionSurfaceHash: string | null = null
  let providerConfigHash: string | null = null
  const runs: C1F0RunRecord[] = []
  let checkpoints: readonly C1LiveBindingCheckpoint[] = []
  let fakeProviderCallPermits = 0
  let responseCalls = 0
  let toolExecutions = 0
  let studyTerminal = false
  let terminalReason: string | null = null
  let providerBinding: C1StrictProviderBinding | null = null
  let artifactList: readonly C1F0ExecutionArtifactSummary[] = []

  try {
    assertStudyId(studyId)
    if (!nodeVersionSatisfiesC1Range(process.versions.node)) {
      throw new C1PreflightFailure(
        'NODE_RANGE_MISMATCH',
        `Node ${process.versions.node} is outside ${C1_NODE_RANGE}`
      )
    }
    await assertC1LiveWorktreeClean(repoRoot)
    contract = await loadC1F0Contract(repoRoot)
    const binding = await computeC1F0ExecutionBinding(repoRoot)
    executionRevision = binding.executionRevision
    executionSurfaceHash = binding.executionSurfaceHash
    if (
      contract.executionBinding.codeRevision !== F0_PENDING_BINDING &&
      contract.executionBinding.codeRevision !== executionRevision
    ) {
      throw new C1PreflightFailure(
        'CONTRACT_BINDING_MISMATCH',
        'F0 code revision does not match this checkout'
      )
    }
    if (
      contract.executionBinding.executionSurfaceHash !== F0_PENDING_BINDING &&
      contract.executionBinding.executionSurfaceHash !== executionSurfaceHash
    ) {
      throw new C1PreflightFailure(
        'CONTRACT_BINDING_MISMATCH',
        'F0 execution surface hash does not match this checkout'
      )
    }
    const plans = buildC1F0ExecutionPlans(contract, studyId)
    reportDir = await claimStudyDir(
      options.outputRoot ??
        join(repoRoot, 'research/context-benchmarks/.live-output/c1-f0-execution-runner'),
      studyId
    )
    providerBinding = await prepareC1StrictProvider({
      runIdentity: studyId,
      env: { STEP_PLAN_API_KEY: F0_CREDENTIAL_SENTINEL }
    })
    providerConfigHash = contract.executionBinding.providerConfigHash
    const budgetGuard = new C1HardBudgetGuard({
      perLeg: {
        maxProviderCalls: contract.budgets.perRun.maxProviderRequests,
        maxToolCalls: contract.budgets.perRun.maxToolRequests,
        maxWallClockMs: contract.budgets.perRun.maxWallClockMs
      },
      study: {
        maxProviderCalls: contract.budgets.study.maxProviderRequests,
        maxToolCalls: contract.budgets.study.maxToolRequests,
        maxWallClockMs: contract.budgets.study.maxWallClockMs,
        maxLegs: contract.budgets.study.maxRuns
      }
    })
    const durableSink = new C1JsonlLiveBindingEvidenceSink(join(reportDir, 'checkpoints.jsonl'))
    const checkpointSink = new F0CheckpointSink(durableSink)
    let sharedInvalidator = false
    const frozenStudy = await loadC1FrozenStudy(repoRoot)
    const preparedProviderBinding = providerBinding
    if (preparedProviderBinding === null) {
      throw new C1PreflightFailure(
        'PROVIDER_PREPARATION_FAILURE',
        'F0 provider binding was not prepared'
      )
    }
    for (const plan of plans) {
      if (sharedInvalidator) {
        runs.push(defaultRunRecord(plan, 'STUDY_INVALIDATED'))
        continue
      }
      const taskPanel = contract.taskPanel.find((task) => task.taskId === plan.taskId)!
      const task = frozenStudy.tasks.find((candidate) => candidate.taskId === plan.taskId)
      if (task === undefined)
        throw new C1PreflightFailure('MANIFEST_BINDING_MISMATCH', `missing F0 task ${plan.taskId}`)
      const legDir = await claimLegDir(reportDir, plan.runId)
      const fixtureBinding = await verifyC1FixtureBinding(frozenStudy, task)
      const fixture = await materializeFreshC1Fixture(fixtureBinding.sourcePath)
      let fixtureCleaned = false
      let oracleSandbox: { readonly path: string; readonly cleanup: () => Promise<void> } | null =
        null
      let beforeSnapshot: ReadonlyMap<string, string> = new Map()
      let changedPaths: readonly string[] = []
      let scopePass = false
      let resultEvidence: readonly C1LiveBindingEvidence[] = []
      let evaluation: C1TaskEvaluation | undefined
      let failureCode: string | undefined
      let terminationStatus: C1F0TerminationStatus = 'TERMINAL_FAILED'
      try {
        const before = await computeC1FixtureContentSummary(fixture.path)
        beforeSnapshot = await snapshotC1Fixture(fixture.path)
        if (before.sha256 !== taskPanel.fixtureContentSha256) {
          throw new C1PreflightFailure(
            'FIXTURE_BINDING_MISMATCH',
            `F0 fixture hash mismatch for ${plan.runId}`
          )
        }
        const responseSource = options.responseSourceFactory
          ? await options.responseSourceFactory({
              runId: plan.runId,
              taskId: plan.taskId,
              fixtureRoot: fixture.path,
              prompt: task.prompt,
              providerBinding: preparedProviderBinding
            })
          : new C1F0CredentialFreeResponseSource(
              plan.runId,
              scenario === 'BUDGET_EXHAUSTION'
                ? 'BUDGET_EXHAUSTION'
                : scenario === 'COMPLETE'
                  ? 'COMPLETE'
                  : 'TOOL_LOOP'
            )
        if (scenario === 'SINGLE_RUN_FAILURE' && plan.runOrdinal === 1) {
          throw new Error('credential-free isolated task failure')
        }
        const observationSource = await C1LiveTaskObservationSource.fromFixture({
          task,
          runId: plan.runId,
          fixtureRoot: fixture.path
        })
        const killSwitch = createRunKillSwitch(plan.runId, {
          now: () => new Date().toISOString()
        })
        const driver = new C1LiveBindingDriver({
          providerBinding: preparedProviderBinding,
          budgetGuard,
          evidenceSink: checkpointSink,
          providerConfigHashOverride: contract.executionBinding.providerConfigHash
        })
        const legResult = await driver.runLeg({
          studyId,
          task,
          stratum: plan.stratum,
          pairId: plan.pairId,
          arm: 'NATIVE',
          runId: plan.runId,
          fixtureContentSha256: before.sha256,
          fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
          runtimeSessionId: `${studyId}:${plan.runId}`,
          observationSource,
          responseSource,
          toolExecutor: new C1SandboxToolExecutor(fixture.path),
          maxCalls: contract.budgets.perRun.maxProviderRequests,
          killSwitch
        })
        resultEvidence = legResult.evidence
        terminationStatus =
          legResult.finalOutcome === 'COMPLETE' ? 'TERMINAL_COMPLETE' : 'TERMINAL_FAILED'
        const afterSnapshot = await snapshotC1Fixture(fixture.path)
        changedPaths = changedC1FixturePaths(beforeSnapshot, afterSnapshot)
        scopePass = writableScopePass(changedPaths, task.expectedWritablePaths)
        oracleSandbox = await copyForOracle(fixture.path)
        await fixture.cleanup()
        fixtureCleaned = true
        evaluation = await runC1TaskOracles({ task, fixtureRoot: oracleSandbox.path })
      } catch (error) {
        const failure = failureOf(error)
        failureCode = failure.code
        failures.push({ code: failure.code, message: failure.message })
        terminationStatus = classifyTermination(error)
        if (isSharedInvalidator(failure.code)) sharedInvalidator = true
        const afterSnapshot = await snapshotC1Fixture(fixture.path).catch(
          () => new Map<string, string>()
        )
        changedPaths = changedC1FixturePaths(beforeSnapshot, afterSnapshot)
        scopePass = writableScopePass(changedPaths, task.expectedWritablePaths)
        try {
          oracleSandbox = await copyForOracle(fixture.path)
        } catch {
          oracleSandbox = null
        }
        try {
          await fixture.cleanup()
          fixtureCleaned = true
        } catch (cleanupError) {
          const cleanupFailure = failureOf(cleanupError)
          failures.push(cleanupFailure)
          sharedInvalidator = true
        }
        if (oracleSandbox !== null && fixtureCleaned) {
          evaluation = await runC1TaskOracles({ task, fixtureRoot: oracleSandbox.path }).catch(
            () => undefined
          )
        }
      } finally {
        if (!fixtureCleaned) {
          try {
            await fixture.cleanup()
            fixtureCleaned = true
          } catch {
            sharedInvalidator = true
          }
        }
        if (oracleSandbox !== null) await oracleSandbox.cleanup().catch(() => undefined)
      }
      resultEvidence =
        resultEvidence.length > 0
          ? resultEvidence
          : evidenceForRun(checkpointSink.checkpoints, plan.runId)
      const toolEvents: readonly C1LiveToolExecution[] = resultEvidence.flatMap(
        (row) => row.toolEvents
      )
      const toolErrorCount = toolEvents.filter((event) => event.result === 'ERROR').length
      const responseCount = resultEvidence.length
      const joinComplete = checkpointJoinComplete(
        checkpointSink.checkpoints,
        plan.runId,
        responseCount
      )
      const evidenceStatus: C1F0EvidenceStatus =
        sharedInvalidator && isSharedInvalidator(failureCode ?? '')
          ? 'INVALID'
          : responseCount > 0 && joinComplete
            ? 'COMPLETE'
            : 'PARTIAL'
      const objectiveStatus = evaluation
        ? evaluation.objective.status === 'PASS'
          ? 'PASS'
          : evaluation.objective.status === 'FAIL'
            ? 'FAIL'
            : 'UNKNOWN'
        : 'NOT_ADJUDICABLE'
      const regressionStatus = evaluation
        ? evaluation.regression.status === 'PASS'
          ? 'PASS'
          : evaluation.regression.status === 'FAIL'
            ? 'FAIL'
            : 'UNKNOWN'
        : 'NOT_ADJUDICABLE'
      const record: C1F0RunRecord = {
        runOrdinal: plan.runOrdinal,
        repetition: plan.repetition,
        taskOrdinal: plan.taskOrdinal,
        taskId: plan.taskId,
        stratum: plan.stratum,
        runId: plan.runId,
        pairId: plan.pairId,
        terminationStatus,
        objectiveOracleStatus: objectiveStatus,
        regressionOracleStatus: regressionStatus,
        oracleStatus: combineOracleStatus(objectiveStatus, regressionStatus),
        evidenceStatus,
        fixtureCleaned,
        changedPaths,
        writableScopePass: scopePass,
        diagnostics: {
          providerCallPermits: responseCount,
          responseCalls: responseCount,
          toolRequestCount: resultEvidence.reduce((sum, row) => sum + row.toolCalls, 0),
          toolExecutionCount: toolEvents.length,
          toolErrorCount,
          recoveredToolErrorCount: terminationStatus === 'TERMINAL_COMPLETE' ? toolErrorCount : 0,
          providerErrorCount: terminationStatus === 'PROVIDER_BOUNDARY_FAILURE' ? 1 : 0,
          unrecoveredToolFailure: toolErrorCount > 0 && terminationStatus !== 'TERMINAL_COMPLETE',
          checkpointJoinComplete: joinComplete
        },
        ...(failureCode === undefined ? {} : { failureCode })
      }
      runs.push(record)
      await writeDurable(
        join(legDir, 'leg-manifest.json'),
        `${JSON.stringify(
          {
            studyId,
            runOrdinal: plan.runOrdinal,
            taskId: plan.taskId,
            stratum: plan.stratum,
            pairId: plan.pairId,
            runId: plan.runId,
            arm: 'NATIVE',
            responseSource: 'SCRIPTED_FAKE',
            providerCalls: 0,
            networkRequests: 0,
            terminationStatus,
            oracleStatus: combineOracleStatus(objectiveStatus, regressionStatus),
            evidenceStatus,
            fixtureCleaned,
            changedPaths,
            writableScopePass: scopePass,
            diagnostics: record.diagnostics,
            ...(failureCode === undefined ? {} : { failureCode })
          },
          null,
          2
        )}\n`
      )
      fakeProviderCallPermits += responseCount
      responseCalls += responseCount
      toolExecutions += toolEvents.length
    }
    checkpoints = checkpointSink.checkpoints
    const feasibility = adjudicateC1F0Study(contract, runs)
    const hardFailure = feasibility.status === 'F0_NO_GO'
    studyTerminal = sharedInvalidator || hardFailure
    terminalReason = sharedInvalidator
      ? 'shared F0 validity failure terminated the study'
      : feasibility.status === 'F0_HOLD'
        ? 'F0 precision gate is incomplete'
        : null
    if (providerConfigHash === null) {
      throw new C1PreflightFailure(
        'PROVIDER_BINDING_MISMATCH',
        'F0 provider binding was not prepared'
      )
    }
    artifactList = await writeF0Artifacts({
      reportDir,
      contract,
      studyId,
      scenario,
      executionRevision,
      executionSurfaceHash,
      providerConfigHash,
      runs,
      checkpoints,
      feasibility,
      failures
    })
    providerBinding.dispose()
    providerBinding = null
    return {
      runnerId: C1_F0_RUNNER_ID,
      schemaVersion: C1_F0_RUNNER_SCHEMA_VERSION,
      executionMode: C1_F0_RUNNER_MODE,
      scenario,
      status: feasibility.status,
      studyId,
      reportDir,
      executionRevision,
      executionSurfaceHash,
      runContractSha256: contract.runContractSha256,
      providerConfigHash,
      provider: C1_PROVIDER_ID,
      model: C1_MODEL_ID,
      endpoint: C1_PROVIDER_ENDPOINT,
      nodeRange: C1_NODE_RANGE,
      responseSource: 'SCRIPTED_FAKE',
      providerCalls: 0,
      networkRequests: 0,
      fakeProviderCallPermits,
      responseCalls,
      toolExecutions,
      runsPlanned: 32,
      runsStarted: runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
      runsCompleted: runs.filter(
        (run) => run.terminationStatus !== 'BLOCKED' && run.evidenceStatus !== 'INVALID'
      ).length,
      blockedRuns: runs.filter((run) => run.terminationStatus === 'BLOCKED').length,
      studyTerminal,
      terminalReason,
      artifacts: artifactList,
      runs: Object.freeze(runs),
      feasibility,
      failures
    }
  } catch (error) {
    const failure = failureOf(error)
    failures.push(failure)
    studyTerminal = true
    terminalReason = failure.message
    providerBinding?.dispose()
    const fallbackContract = contract
    const feasibility =
      fallbackContract === null
        ? {
            status: 'F0_NO_GO' as const,
            validityGate: { pass: false, sharedInvalidatorCount: 1, reasons: [failure.message] },
            precisionGate: {
              pass: false,
              startedRunsPerTask: {},
              uniqueRunIds: true,
              taskPanelCoverage: 0,
              reasons: ['contract unavailable']
            },
            feasibilityGate: { pass: false, tasks: [] },
            taskSummaries: []
          }
        : adjudicateC1F0Study(fallbackContract, runs)
    return {
      runnerId: C1_F0_RUNNER_ID,
      schemaVersion: C1_F0_RUNNER_SCHEMA_VERSION,
      executionMode: C1_F0_RUNNER_MODE,
      scenario,
      status: feasibility.status,
      studyId,
      reportDir,
      executionRevision,
      executionSurfaceHash,
      runContractSha256: contract?.runContractSha256 ?? null,
      providerConfigHash,
      provider: C1_PROVIDER_ID,
      model: C1_MODEL_ID,
      endpoint: C1_PROVIDER_ENDPOINT,
      nodeRange: C1_NODE_RANGE,
      responseSource: 'SCRIPTED_FAKE',
      providerCalls: 0,
      networkRequests: 0,
      fakeProviderCallPermits,
      responseCalls,
      toolExecutions,
      runsPlanned: 32,
      runsStarted: runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
      runsCompleted: runs.filter(
        (run) => run.terminationStatus !== 'BLOCKED' && run.evidenceStatus !== 'INVALID'
      ).length,
      blockedRuns: runs.filter((run) => run.terminationStatus === 'BLOCKED').length,
      studyTerminal,
      terminalReason,
      artifacts: artifactList,
      runs: Object.freeze(runs),
      feasibility,
      failures
    }
  }
}
