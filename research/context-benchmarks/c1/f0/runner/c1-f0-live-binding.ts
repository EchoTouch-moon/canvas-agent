import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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
  loadC1FrozenStudy,
  materializeFreshC1Fixture,
  nodeVersionSatisfiesC1Range,
  prepareC1StrictProvider,
  snapshotC1Fixture,
  verifyC1FixtureBinding,
  writableScopePass,
  type C1ProviderBoundCapture,
  type C1StrictProviderBinding
} from '../../../src/c1-live-preflight'
import {
  C1AuthorizedProviderResponseSource,
  type C1AuthorizedProviderResponseSourceOptions
} from '../../../src/c1-authorized-provider'
import {
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingDriver,
  C1SandboxToolExecutor,
  type C1LiveBindingCheckpoint,
  type C1LiveBindingEvidence,
  type C1LiveBindingEvidenceSink
} from '../../../src/c1-live-binding'
import {
  assertC1LiveWorktreeClean,
  C1LiveTaskObservationSource,
  runC1TaskOracles,
  type C1TaskEvaluation
} from '../../../src/c1-live-study'
import { buildSanitizedChildEnvironment, runProcess } from '../../../src/fixture-generator'
import {
  adjudicateC1F0Study,
  buildC1F0ExecutionPlans,
  computeC1F0ExecutionBinding,
  loadC1F0Contract,
  type C1F0AdjudicationSummary,
  type C1F0Contract,
  type C1F0ExecutionPlan,
  type C1F0RunRecord
} from './c1-f0-execution-runner'

export const C1_F0_LIVE_BINDING_ID = 'C1_F0_LIVE_BINDING_V1'
export const C1_F0_LIVE_BINDING_MODE = 'AUTHORIZED_PROVIDER_NATIVE_ONLY' as const
export const C1_F0_LIVE_ARTIFACT_NAMES = Object.freeze([
  'study-manifest.json',
  'run-manifest.json',
  'checkpoints.jsonl',
  'checkpoint-summary.json',
  'response-ledger.jsonl',
  'task-adjudication.jsonl',
  'feasibility-summary.json'
] as const)

const F0_LIVE_STUDY_ID_PATTERN = /^c1-f0-\d{8}-[0-9a-f]{8}$/
const F0_LIVE_CREDENTIAL_ENV = 'STEP_PLAN_API_KEY'

export interface C1F0LiveAuthorization {
  readonly decision: 'AUTHORIZED'
  readonly studyId: string
  readonly executionRevision: string
  readonly executionSurfaceHash: string
  readonly runContractSha256: string
  readonly providerConfigHash: string
}

export interface C1F0LiveExecutionOptions {
  readonly repoRoot?: string
  readonly outputRoot?: string
  readonly authorization: C1F0LiveAuthorization
  readonly envFilePath?: string
  readonly fetchImpl?: typeof fetch
  readonly requestTimeoutMs?: number
}

export interface C1F0LiveExecutionReport {
  readonly bindingId: typeof C1_F0_LIVE_BINDING_ID
  readonly executionMode: typeof C1_F0_LIVE_BINDING_MODE
  readonly status: C1F0AdjudicationSummary['status']
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
  readonly responseSource: 'AUTHORIZED_PROVIDER'
  readonly providerCalls: number
  readonly networkRequests: number
  readonly providerCallPermits: number
  readonly responseCalls: number
  readonly toolExecutions: number
  readonly runsPlanned: 32
  readonly runsStarted: number
  readonly runsCompleted: number
  readonly blockedRuns: number
  readonly studyTerminal: boolean
  readonly terminalReason: string | null
  readonly artifacts: readonly {
    readonly name: string
    readonly sha256: string
    readonly bytes: number
  }[]
  readonly runs: readonly C1F0RunRecord[]
  readonly feasibility: C1F0AdjudicationSummary
  readonly failures: readonly { readonly code: string; readonly message: string }[]
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function failureOf(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof C1PreflightFailure) return { code: error.code, message: error.message }
  return {
    code: 'RUN_FAILURE',
    message: error instanceof Error ? error.message : String(error)
  }
}

function assertAuthorization(
  value: C1F0LiveAuthorization,
  contract: C1F0Contract,
  binding: {
    readonly executionRevision: string
    readonly executionSurfaceHash: string
  }
): void {
  if (
    value.decision !== 'AUTHORIZED' ||
    !F0_LIVE_STUDY_ID_PATTERN.test(value.studyId) ||
    value.executionRevision !== binding.executionRevision ||
    value.executionSurfaceHash !== binding.executionSurfaceHash ||
    value.executionRevision !== contract.executionBinding.codeRevision ||
    value.executionSurfaceHash !== contract.executionBinding.executionSurfaceHash ||
    value.runContractSha256 !== contract.runContractSha256 ||
    value.providerConfigHash !== contract.executionBinding.providerConfigHash
  ) {
    throw new C1PreflightFailure(
      'NOT_AUTHORIZED',
      'F0 live authorization does not match the frozen contract and executable surface'
    )
  }
}

function envValue(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  const comment = trimmed.indexOf(' #')
  return comment >= 0 ? trimmed.slice(0, comment).trim() : trimmed
}

/** Read one credential into memory after exact authorization validation. */
async function readStepPlanApiKey(repoRoot: string, envFilePath?: string): Promise<string> {
  const processValue = process.env[F0_LIVE_CREDENTIAL_ENV]
  if (typeof processValue === 'string' && processValue.length > 0) return processValue
  const path = envFilePath ?? join(repoRoot, '.env')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new C1PreflightFailure(
      'PROVIDER_PREPARATION_FAILURE',
      `${F0_LIVE_CREDENTIAL_ENV} is unavailable in the authorized memory-only environment`
    )
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?STEP_PLAN_API_KEY\s*=\s*(.*)\s*$/.exec(line)
    if (match === null) continue
    const value = envValue(match[1] ?? '')
    if (value !== undefined && value.length > 0) return value
  }
  throw new C1PreflightFailure(
    'PROVIDER_PREPARATION_FAILURE',
    `${F0_LIVE_CREDENTIAL_ENV} is missing from the authorized memory-only environment`
  )
}

async function claimStudyDir(outputRoot: string, studyId: string): Promise<string> {
  if (!F0_LIVE_STUDY_ID_PATTERN.test(studyId)) {
    throw new C1PreflightFailure('IDENTITY_INVALID', `invalid F0 study identity ${studyId}`)
  }
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

class F0LiveCheckpointSink implements C1LiveBindingEvidenceSink {
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
    const outbound = checkpoints.some(
      (checkpoint) =>
        checkpoint.phase === 'OUTBOUND_PERMITTED' &&
        checkpoint.callOrdinal === ordinal &&
        checkpoint.capture.runId === runId
    )
    const received = checkpoints.some(
      (checkpoint) =>
        checkpoint.phase === 'RESPONSE_RECEIVED' &&
        checkpoint.callOrdinal === ordinal &&
        checkpoint.receipt.runId === runId
    )
    const recorded = checkpoints.some(
      (checkpoint) =>
        checkpoint.phase === 'RESPONSE_RECORDED' &&
        checkpoint.callOrdinal === ordinal &&
        checkpoint.evidence.runId === runId
    )
    if (!outbound || !received || !recorded) return false
  }
  return true
}

function copyForOracle(source: string): Promise<{
  readonly path: string
  readonly cleanup: () => Promise<void>
}> {
  return (async () => {
    const path = await mkdtemp(join(tmpdir(), 'canvas-c1-f0-live-oracle-'))
    try {
      await cp(source, path, { recursive: true, force: true })
      return { path, cleanup: async () => rm(path, { recursive: true, force: true }) }
    } catch (error) {
      await rm(path, { recursive: true, force: true })
      throw error
    }
  })()
}

function classifyTermination(error: unknown): C1F0RunRecord['terminationStatus'] {
  if (error instanceof C1PreflightFailure) {
    if (error.code === 'BUDGET_BREACH' || error.message.includes('maxCalls'))
      return 'BUDGET_EXHAUSTED'
    if (error.code === 'PROVIDER_PREPARATION_FAILURE' || error.code === 'DEADLINE_EXCEEDED') {
      return 'PROVIDER_BOUNDARY_FAILURE'
    }
    if (error.code === 'EVIDENCE_WRITE_FAILURE') return 'TOOL_BOUNDARY_FAILURE'
    if (error.code === 'KILL_SWITCH_BLOCKED') return 'BLOCKED'
  }
  return 'TERMINAL_FAILED'
}

function isSharedInvalidator(code: string): boolean {
  return new Set([
    'CONTRACT_BINDING_MISMATCH',
    'MANIFEST_BINDING_MISMATCH',
    'IDENTITY_REUSE',
    'IDENTITY_INVALID',
    'EVIDENCE_WRITE_FAILURE'
  ]).has(code)
}

function oracleStatus(
  evaluation: C1TaskEvaluation | undefined,
  field: 'objective' | 'regression'
): 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_ADJUDICABLE' {
  if (evaluation === undefined) return 'NOT_ADJUDICABLE'
  const result = evaluation[field]
  if (result.status === 'PASS') return 'PASS'
  if (result.status === 'FAIL') return 'FAIL'
  return 'UNKNOWN'
}

function combineOracleStatus(
  objective: C1F0RunRecord['objectiveOracleStatus'],
  regression: C1F0RunRecord['regressionOracleStatus']
): C1F0RunRecord['oracleStatus'] {
  if (objective === 'UNKNOWN' || regression === 'UNKNOWN') return 'UNKNOWN'
  if (objective === 'NOT_ADJUDICABLE' || regression === 'NOT_ADJUDICABLE') {
    return 'NOT_ADJUDICABLE'
  }
  return objective === 'PASS' && regression === 'PASS' ? 'PASS' : 'FAIL'
}

function usageMetadata(row: C1LiveBindingEvidence): Record<string, unknown> {
  const usage = row.usage
  return {
    usageSource: usage.usageSource,
    availability: 'REPORTED',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens
  }
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
      usage: 'REPORTED',
      zeroSubstitutionAllowed: false
    },
    usage: usageMetadata(row),
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
): Promise<{
  readonly name: string
  readonly sha256: string
  readonly bytes: number
}> {
  const bytes = await readFile(join(reportDir, name))
  return { name, sha256: sha256Bytes(bytes), bytes: bytes.byteLength }
}

async function writeLiveArtifacts(input: {
  readonly reportDir: string
  readonly contract: C1F0Contract
  readonly authorization: C1F0LiveAuthorization
  readonly providerConfigHash: string
  readonly providerCalls: number
  readonly networkRequests: number
  readonly providerCallPermits: number
  readonly responseCalls: number
  readonly toolExecutions: number
  readonly runs: readonly C1F0RunRecord[]
  readonly checkpoints: readonly C1LiveBindingCheckpoint[]
  readonly feasibility: C1F0AdjudicationSummary
  readonly failures: readonly { readonly code: string; readonly message: string }[]
}): Promise<readonly { readonly name: string; readonly sha256: string; readonly bytes: number }[]> {
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
    bindingId: C1_F0_LIVE_BINDING_ID,
    executionMode: C1_F0_LIVE_BINDING_MODE,
    studyId: input.authorization.studyId,
    contractId: input.contract.contractId,
    runContractSha256: input.authorization.runContractSha256,
    executionRevision: input.authorization.executionRevision,
    executionSurfaceHash: input.authorization.executionSurfaceHash,
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    providerConfigHash: input.providerConfigHash,
    responseSource: 'AUTHORIZED_PROVIDER',
    providerCalls: input.providerCalls,
    networkRequests: input.networkRequests,
    providerCallPermits: input.providerCallPermits,
    runtimeIntervention: 'DISABLED',
    fallback: 'NONE',
    retry: 'FORBIDDEN',
    resume: 'FORBIDDEN',
    reuse: 'FORBIDDEN',
    credentialPersistence: 'MEMORY_ONLY',
    taskPanel: input.contract.taskPanel.map((task) => ({
      taskId: task.taskId,
      stratum: task.stratum
    })),
    runsPlanned: 32,
    requiredArtifacts: C1_F0_LIVE_ARTIFACT_NAMES
  }
  const runManifest = {
    studyId: input.authorization.studyId,
    status: input.feasibility.status,
    providerCalls: input.providerCalls,
    networkRequests: input.networkRequests,
    providerCallPermits: input.providerCallPermits,
    responseCalls: input.responseCalls,
    toolExecutions: input.toolExecutions,
    runsPlanned: 32,
    runsStarted: input.runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
    runsCompleted: input.runs.filter(
      (run) => run.terminationStatus !== 'BLOCKED' && run.evidenceStatus !== 'INVALID'
    ).length,
    blockedRuns: input.runs.filter((run) => run.terminationStatus === 'BLOCKED').length,
    failures: input.failures,
    runs: input.runs
  }
  const checkpointSummary = {
    studyId: input.authorization.studyId,
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
    studyId: input.authorization.studyId,
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
    ['response-ledger.jsonl', responseRows.map(jsonLine).join('')],
    ['task-adjudication.jsonl', adjudicationRows.map(jsonLine).join('')],
    ['feasibility-summary.json', `${JSON.stringify(input.feasibility, null, 2)}\n`]
  ]
  for (const [name, content] of documents) await writeDurable(join(input.reportDir, name), content)
  const checkpointPath = join(input.reportDir, 'checkpoints.jsonl')
  try {
    await stat(checkpointPath)
  } catch {
    await writeDurable(checkpointPath, '')
  }
  const serialized = await Promise.all(
    C1_F0_LIVE_ARTIFACT_NAMES.map(async (name) => readFile(join(input.reportDir, name), 'utf8'))
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
      'F0 live artifacts contain forbidden raw payload'
    )
  }
  return Object.freeze(
    await Promise.all(
      C1_F0_LIVE_ARTIFACT_NAMES.map((name) => artifactSummary(input.reportDir, name))
    )
  )
}

function emptyReport(input: {
  readonly status: C1F0AdjudicationSummary['status']
  readonly studyId: string
  readonly reportDir: string | null
  readonly executionRevision: string | null
  readonly executionSurfaceHash: string | null
  readonly runContractSha256: string | null
  readonly providerConfigHash: string | null
  readonly providerCalls: number
  readonly networkRequests: number
  readonly providerCallPermits: number
  readonly responseCalls: number
  readonly toolExecutions: number
  readonly runs: readonly C1F0RunRecord[]
  readonly feasibility: C1F0AdjudicationSummary
  readonly terminalReason: string | null
  readonly failures: readonly { readonly code: string; readonly message: string }[]
  readonly artifacts?: readonly {
    readonly name: string
    readonly sha256: string
    readonly bytes: number
  }[]
}): C1F0LiveExecutionReport {
  return {
    bindingId: C1_F0_LIVE_BINDING_ID,
    executionMode: C1_F0_LIVE_BINDING_MODE,
    status: input.status,
    studyId: input.studyId,
    reportDir: input.reportDir,
    executionRevision: input.executionRevision,
    executionSurfaceHash: input.executionSurfaceHash,
    runContractSha256: input.runContractSha256,
    providerConfigHash: input.providerConfigHash,
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    nodeRange: C1_NODE_RANGE,
    responseSource: 'AUTHORIZED_PROVIDER',
    providerCalls: input.providerCalls,
    networkRequests: input.networkRequests,
    providerCallPermits: input.providerCallPermits,
    responseCalls: input.responseCalls,
    toolExecutions: input.toolExecutions,
    runsPlanned: 32,
    runsStarted: input.runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
    runsCompleted: input.runs.filter(
      (run) => run.terminationStatus !== 'BLOCKED' && run.evidenceStatus !== 'INVALID'
    ).length,
    blockedRuns: input.runs.filter((run) => run.terminationStatus === 'BLOCKED').length,
    studyTerminal: input.status === 'F0_NO_GO',
    terminalReason: input.terminalReason,
    artifacts: input.artifacts ?? [],
    runs: Object.freeze([...input.runs]),
    feasibility: input.feasibility,
    failures: Object.freeze([...input.failures])
  }
}

/**
 * Execute one fresh, fully authorized F0 study against the real Provider.
 * Exact contract/surface validation and identity claim happen before the
 * credential is read. The API key remains in memory and is never serialized.
 */
export async function runC1F0AuthorizedStudy(
  options: C1F0LiveExecutionOptions
): Promise<C1F0LiveExecutionReport> {
  const repoRoot = options.repoRoot ?? resolve(import.meta.dirname, '..', '..', '..', '..', '..')
  const failures: { code: string; message: string }[] = []
  let contract: C1F0Contract | null = null
  let reportDir: string | null = null
  let executionRevision: string | null = null
  let executionSurfaceHash: string | null = null
  let providerConfigHash: string | null = null
  let providerCalls = 0
  let networkRequests = 0
  let providerCallPermits = 0
  let responseCalls = 0
  let toolExecutions = 0
  let providerBinding: C1StrictProviderBinding | null = null
  const runs: C1F0RunRecord[] = []
  let artifacts: readonly {
    readonly name: string
    readonly sha256: string
    readonly bytes: number
  }[] = []

  try {
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
    assertAuthorization(options.authorization, contract, binding)
    reportDir = await claimStudyDir(
      options.outputRoot ??
        join(repoRoot, 'research/context-benchmarks/.live-output/c1-f0-live-binding'),
      options.authorization.studyId
    )
    const apiKey = await readStepPlanApiKey(repoRoot, options.envFilePath)
    providerBinding = await prepareC1StrictProvider({
      runIdentity: options.authorization.studyId,
      env: { [F0_LIVE_CREDENTIAL_ENV]: apiKey }
    })
    providerConfigHash = contract.executionBinding.providerConfigHash
    const fetchFunction = options.fetchImpl ?? globalThis.fetch
    if (typeof fetchFunction !== 'function') {
      throw new C1PreflightFailure('PROVIDER_PREPARATION_FAILURE', 'global fetch is unavailable')
    }
    const countedFetch: typeof fetch = async (input, init) => {
      networkRequests += 1
      return fetchFunction(input, init)
    }
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
    const checkpointSink = new F0LiveCheckpointSink(durableSink)
    const frozenStudy = await loadC1FrozenStudy(repoRoot)
    const preparedProviderBinding = providerBinding
    if (preparedProviderBinding === null) {
      throw new C1PreflightFailure(
        'PROVIDER_PREPARATION_FAILURE',
        'F0 provider binding was not prepared'
      )
    }
    const plans = buildC1F0ExecutionPlans(contract, options.authorization.studyId)
    for (const plan of plans) {
      const task = frozenStudy.tasks.find((candidate) => candidate.taskId === plan.taskId)
      if (task === undefined) {
        throw new C1PreflightFailure('MANIFEST_BINDING_MISMATCH', `missing F0 task ${plan.taskId}`)
      }
      const legDir = join(reportDir, 'legs', plan.runId)
      await mkdir(legDir)
      const fixtureBinding = await verifyC1FixtureBinding(frozenStudy, task)
      const fixture = await materializeFreshC1Fixture(fixtureBinding.sourcePath)
      let fixtureCleaned = false
      let oracleSandbox: { readonly path: string; readonly cleanup: () => Promise<void> } | null =
        null
      let beforeSnapshot: ReadonlyMap<string, string> = new Map()
      let changedPaths: readonly string[] = []
      let scopePass = false
      let evidence: readonly C1LiveBindingEvidence[] = []
      let evaluation: C1TaskEvaluation | undefined
      let responseSource: C1AuthorizedProviderResponseSource | null = null
      let failureCode: string | undefined
      let terminationStatus: C1F0RunRecord['terminationStatus'] = 'TERMINAL_FAILED'
      let runEvidenceInvalid = false
      try {
        const before = await computeC1FixtureContentSummary(fixture.path)
        beforeSnapshot = await snapshotC1Fixture(fixture.path)
        if (before.sha256 !== task.fixtureRevision.fixtureContentSha256) {
          throw new C1PreflightFailure(
            'FIXTURE_BINDING_MISMATCH',
            `F0 fixture hash mismatch for ${plan.runId}`
          )
        }
        const sourceOptions: C1AuthorizedProviderResponseSourceOptions = {
          providerBinding: preparedProviderBinding,
          apiKey,
          providerConfigHashOverride: contract.executionBinding.providerConfigHash,
          fetchImpl: countedFetch,
          ...(options.requestTimeoutMs === undefined
            ? {}
            : { requestTimeoutMs: options.requestTimeoutMs })
        }
        responseSource = new C1AuthorizedProviderResponseSource(sourceOptions)
        const observationSource = await C1LiveTaskObservationSource.fromFixture({
          task,
          runId: plan.runId,
          fixtureRoot: fixture.path
        })
        const driver = new C1LiveBindingDriver({
          providerBinding: preparedProviderBinding,
          budgetGuard,
          evidenceSink: checkpointSink,
          providerConfigHashOverride: contract.executionBinding.providerConfigHash
        })
        const legResult = await driver.runLeg({
          studyId: options.authorization.studyId,
          task,
          stratum: plan.stratum,
          pairId: plan.pairId,
          arm: 'NATIVE',
          runId: plan.runId,
          fixtureContentSha256: before.sha256,
          fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
          runtimeSessionId: `${options.authorization.studyId}:${plan.runId}`,
          observationSource,
          responseSource,
          toolExecutor: new C1SandboxToolExecutor(fixture.path),
          maxCalls: contract.budgets.perRun.maxProviderRequests
        })
        evidence = legResult.evidence
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
        runEvidenceInvalid = isSharedInvalidator(failure.code)
        const afterSnapshot = await snapshotC1Fixture(fixture.path).catch(
          () => new Map<string, string>()
        )
        changedPaths = changedC1FixturePaths(beforeSnapshot, afterSnapshot)
        scopePass = writableScopePass(changedPaths, task.expectedWritablePaths)
        oracleSandbox = await copyForOracle(fixture.path).catch(() => null)
        try {
          await fixture.cleanup()
          fixtureCleaned = true
        } catch (cleanupError) {
          const cleanupFailure = failureOf(cleanupError)
          failures.push(cleanupFailure)
          runEvidenceInvalid = true
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
            runEvidenceInvalid = true
          }
        }
        if (oracleSandbox !== null) await oracleSandbox.cleanup().catch(() => undefined)
      }
      providerCalls += responseSource?.requestCount ?? 0
      evidence =
        evidence.length > 0 ? evidence : evidenceForRun(checkpointSink.checkpoints, plan.runId)
      const toolEvents = evidence.flatMap((row) => row.toolEvents)
      const toolErrorCount = toolEvents.filter((event) => event.result === 'ERROR').length
      const responseCount = evidence.length
      const objectiveStatus = oracleStatus(evaluation, 'objective')
      const regressionStatus = oracleStatus(evaluation, 'regression')
      const record: C1F0RunRecord = {
        runOrdinal: plan.runOrdinal,
        repetition: plan.repetition,
        taskOrdinal: plan.taskOrdinal,
        taskId: plan.taskId,
        stratum: plan.stratum,
        runId: plan.runId,
        pairId: plan.pairId,
        terminationStatus,
        oracleStatus: combineOracleStatus(objectiveStatus, regressionStatus),
        objectiveOracleStatus: objectiveStatus,
        regressionOracleStatus: regressionStatus,
        evidenceStatus: runEvidenceInvalid
          ? 'INVALID'
          : responseCount > 0 &&
              checkpointJoinComplete(checkpointSink.checkpoints, plan.runId, responseCount)
            ? 'COMPLETE'
            : 'PARTIAL',
        fixtureCleaned,
        changedPaths,
        writableScopePass: scopePass,
        diagnostics: {
          providerCallPermits: responseCount,
          responseCalls: responseCount,
          toolRequestCount: evidence.reduce((sum, row) => sum + row.toolCalls, 0),
          toolExecutionCount: toolEvents.length,
          toolErrorCount,
          recoveredToolErrorCount: terminationStatus === 'TERMINAL_COMPLETE' ? toolErrorCount : 0,
          providerErrorCount: terminationStatus === 'PROVIDER_BOUNDARY_FAILURE' ? 1 : 0,
          unrecoveredToolFailure: toolErrorCount > 0 && terminationStatus !== 'TERMINAL_COMPLETE',
          checkpointJoinComplete: checkpointJoinComplete(
            checkpointSink.checkpoints,
            plan.runId,
            responseCount
          )
        },
        ...(failureCode === undefined ? {} : { failureCode })
      }
      runs.push(record)
      await writeDurable(
        join(legDir, 'leg-manifest.json'),
        `${JSON.stringify(
          {
            studyId: options.authorization.studyId,
            runOrdinal: plan.runOrdinal,
            taskId: plan.taskId,
            stratum: plan.stratum,
            pairId: plan.pairId,
            runId: plan.runId,
            arm: 'NATIVE',
            responseSource: 'AUTHORIZED_PROVIDER',
            providerCalls: evidence.length,
            networkRequests,
            terminationStatus,
            oracleStatus: record.oracleStatus,
            evidenceStatus: record.evidenceStatus,
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
      responseCalls += responseCount
      toolExecutions += toolEvents.length
    }
    const checkpoints = checkpointSink.checkpoints
    providerCallPermits = budgetGuard.ledger.providerCalls
    const feasibility = adjudicateC1F0Study(contract, runs)
    artifacts = await writeLiveArtifacts({
      reportDir,
      contract,
      authorization: options.authorization,
      providerConfigHash,
      providerCalls,
      networkRequests,
      providerCallPermits,
      responseCalls,
      toolExecutions,
      runs,
      checkpoints,
      feasibility,
      failures
    })
    providerBinding.dispose()
    providerBinding = null
    return emptyReport({
      status: feasibility.status,
      studyId: options.authorization.studyId,
      reportDir,
      executionRevision,
      executionSurfaceHash,
      runContractSha256: contract.runContractSha256,
      providerConfigHash,
      providerCalls,
      networkRequests,
      providerCallPermits,
      responseCalls,
      toolExecutions,
      runs,
      feasibility,
      terminalReason: feasibility.status === 'F0_NO_GO' ? 'F0 validity gate failed' : null,
      artifacts,
      failures
    })
  } catch (error) {
    const failure = failureOf(error)
    failures.push(failure)
    providerBinding?.dispose()
    const feasibility =
      contract === null || runs.length === 0
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
        : adjudicateC1F0Study(contract, runs)
    return emptyReport({
      status: feasibility.status,
      studyId: options.authorization.studyId,
      reportDir,
      executionRevision,
      executionSurfaceHash,
      runContractSha256: contract?.runContractSha256 ?? null,
      providerConfigHash,
      providerCalls,
      networkRequests,
      providerCallPermits,
      responseCalls,
      toolExecutions,
      runs,
      feasibility,
      terminalReason: failure.message,
      failures
    })
  }
}
