import { createHash } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRunKillSwitch } from '@canvas-agent/pi-context-integration/experimental'
import {
  C1HardBudgetGuard,
  C1PreflightFailure,
  C1_MODEL_ID,
  C1_NODE_RANGE,
  C1_PROVIDER_ENDPOINT,
  C1_PROVIDER_ID,
  changedC1FixturePaths,
  computeC1FixtureContentSummary,
  loadC1FrozenStudy,
  materializeFreshC1Fixture,
  nodeVersionSatisfiesC1Range,
  prepareC1StrictProvider,
  snapshotC1Fixture,
  verifyC1FixtureBinding,
  writableScopePass,
  type C1StrictProviderBinding
} from '../../../../src/c1-live-preflight'
import {
  C1AuthorizedProviderResponseSource,
  type C1AuthorizedProviderResponseSourceOptions
} from '../../../../src/c1-authorized-provider'
import {
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingDriver,
  type C1LiveBindingCheckpoint,
  type C1LiveBindingEvidence
} from '../../../../src/c1-live-binding'
import {
  assertC1LiveWorktreeClean,
  C1LiveTaskObservationSource,
  runC1TaskOracles,
  type C1TaskEvaluation
} from '../../../../src/c1-live-study'
import {
  C1F0V2HardeningToolAdapter,
  C1F0V2CheckpointSink,
  C1_F0_V2_REQUIRED_ARTIFACTS,
  adjudicateV2Study,
  artifactSummary,
  buildC1F0V2ExecutionPlans,
  checkpointJoinComplete,
  classifyTermination,
  combineOracleStatus,
  computeC1F0V2ExecutionBinding,
  defaultV2RunRecord,
  deriveSideEffectAttributionStatus,
  evidenceForRun,
  failureOf,
  freezePostRunSnapshot,
  isSharedInvalidator,
  metadataEvidence,
  oracleStatus,
  recoveryStatus,
  taskDisposition,
  type C1F0V2AdjudicationSummary,
  type C1F0V2RunRecord,
  type C1F0V2RunDiagnostics,
  type C1F0V2SideEffectAttributionStatus,
  type C1F0V2ProvenanceSummary,
  type C1F0V2FrozenPostRunSnapshot,
  type V2ContractView
} from './c1-f0-v2-execution-runner'
import {
  C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
  validateC1F0V2FinalBoundContract,
  type C1F0V2Contract
} from '../../contract/c1-f0-v2-contract'

export const C1_F0_V2_LIVE_BINDING_ID = 'C1_F0_V2_LIVE_BINDING_V1' as const
export const C1_F0_V2_LIVE_BINDING_SCHEMA_VERSION = 1 as const
export const C1_F0_V2_LIVE_BINDING_MODE = 'AUTHORIZED_PROVIDER_NATIVE_ONLY' as const
export const C1_F0_V2_FINAL_BOUND_CONTRACT_RELATIVE_PATH =
  'research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v2-final-bound.json'
const F0_V2_LIVE_CREDENTIAL_ENV = 'STEP_PLAN_API_KEY'
const F0_V2_LIVE_STUDY_ID_PATTERN = /^c1-f0-v2-\d{8}-[0-9a-f]{8}$/

interface V2LiveContractView extends V2ContractView {
  readonly runContractSha256: string
  readonly enrollmentBinding: { readonly taskManifestSha256: string }
  readonly executionBinding: V2ContractView['executionBinding'] & {
    readonly provider: string
    readonly model: string
    readonly endpoint: string
    readonly nodeRange: string
    readonly codeRevision: string
    readonly executionSurfaceHash: string
    readonly providerConfigHash: string
  }
  readonly identityPolicy: {
    readonly studyIdStatus: string
    readonly retry: string
    readonly resume: string
    readonly reuse: string
  }
}

export interface C1F0V2LiveAuthorization {
  readonly decision: 'AUTHORIZED'
  readonly studyId: string
  readonly executionRevision: string
  readonly executionSurfaceHash: string
  readonly runContractSha256: string
  readonly finalBoundRunContractSha256: string
  readonly enrollmentManifestSha256: string
  readonly providerConfigHash: string
}

export interface C1F0V2LiveExecutionOptions {
  readonly repoRoot?: string
  readonly outputRoot?: string
  readonly authorization: C1F0V2LiveAuthorization
  readonly envFilePath?: string
  /** Test-only transport seam. Supplying it prevents any external network request. */
  readonly fetchImpl?: typeof fetch
}

export interface C1F0V2LiveExecutionReport {
  readonly bindingId: typeof C1_F0_V2_LIVE_BINDING_ID
  readonly schemaVersion: typeof C1_F0_V2_LIVE_BINDING_SCHEMA_VERSION
  readonly executionMode: typeof C1_F0_V2_LIVE_BINDING_MODE
  readonly status: C1F0V2AdjudicationSummary['status']
  readonly studyId: string
  readonly reportDir: string | null
  readonly executionRevision: string | null
  readonly executionSurfaceHash: string | null
  readonly freezeCandidateRunContractSha256:
    typeof C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256 | null
  readonly finalBoundRunContractSha256: string | null
  readonly enrollmentManifestSha256: string | null
  readonly providerConfigHash: string | null
  readonly provider: typeof C1_PROVIDER_ID
  readonly model: typeof C1_MODEL_ID
  readonly endpoint: typeof C1_PROVIDER_ENDPOINT
  readonly nodeRange: typeof C1_NODE_RANGE
  readonly responseSource: 'AUTHORIZED_PROVIDER'
  readonly transportMode: 'NETWORK' | 'INJECTED_FAKE_FETCH'
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
  readonly runs: readonly C1F0V2RunRecord[]
  readonly feasibility: C1F0V2AdjudicationSummary
  readonly failures: readonly { readonly code: string; readonly message: string }[]
}

function asLiveContract(contract: C1F0V2Contract): V2LiveContractView {
  return contract as unknown as V2LiveContractView
}

function isLiveSharedInvalidator(code: string): boolean {
  return (
    isSharedInvalidator(code) || code === 'PREFLIGHT_FAILURE' || code === 'USAGE_CONTRACT_MISMATCH'
  )
}

export async function loadC1F0V2FinalBoundContract(repoRoot: string): Promise<C1F0V2Contract> {
  const path = resolve(repoRoot, C1_F0_V2_FINAL_BOUND_CONTRACT_RELATIVE_PATH)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'unable to read F0-v2 final-bound contract: ' +
        (error instanceof Error ? error.message : String(error))
    )
  }
  try {
    return validateC1F0V2FinalBoundContract(parsed)
  } catch (error) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'F0-v2 final-bound contract validation failed: ' +
        (error instanceof Error ? error.message : String(error))
    )
  }
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
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

/** Read one credential into memory only after exact authorization validation. */
async function readStepPlanApiKey(repoRoot: string, envFilePath?: string): Promise<string> {
  const processValue = process.env[F0_V2_LIVE_CREDENTIAL_ENV]
  if (typeof processValue === 'string' && processValue.length > 0) return processValue
  const path = envFilePath ?? join(repoRoot, '.env')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new C1PreflightFailure(
      'PROVIDER_PREPARATION_FAILURE',
      `${F0_V2_LIVE_CREDENTIAL_ENV} is unavailable in the authorized memory-only environment`
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
    `${F0_V2_LIVE_CREDENTIAL_ENV} is missing from the authorized memory-only environment`
  )
}

function assertLiveAuthorization(
  authorization: C1F0V2LiveAuthorization,
  contract: V2LiveContractView,
  binding: { readonly executionRevision: string; readonly executionSurfaceHash: string }
): void {
  if (
    authorization.decision !== 'AUTHORIZED' ||
    !F0_V2_LIVE_STUDY_ID_PATTERN.test(authorization.studyId) ||
    authorization.executionRevision !== binding.executionRevision ||
    authorization.executionSurfaceHash !== binding.executionSurfaceHash ||
    authorization.executionRevision !== contract.executionBinding.codeRevision ||
    authorization.executionSurfaceHash !== contract.executionBinding.executionSurfaceHash ||
    authorization.runContractSha256 !== contract['runContractSha256'] ||
    authorization.finalBoundRunContractSha256 !== contract['runContractSha256'] ||
    authorization.enrollmentManifestSha256 !== contract.enrollmentBinding.taskManifestSha256 ||
    authorization.providerConfigHash !== contract.executionBinding.providerConfigHash ||
    contract.identityPolicy.studyIdStatus !== 'NOT_CREATED' ||
    contract.identityPolicy.retry !== 'FORBIDDEN' ||
    contract.identityPolicy.resume !== 'FORBIDDEN' ||
    contract.identityPolicy.reuse !== 'FORBIDDEN'
  ) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'F0-v2 live authorization does not match the frozen contract and executable surface'
    )
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

async function appendDurable(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'a')
  try {
    await handle.write(JSON.stringify(value) + '\n')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function ensureFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'a')
  await handle.close()
}

function liveRunUnknownReason(input: {
  readonly snapshot: C1F0V2FrozenPostRunSnapshot
  readonly evidenceStatus: 'COMPLETE' | 'PARTIAL' | 'INVALID'
  readonly provenanceStatus: 'COMPLETE' | 'PARTIAL' | 'INVALID'
  readonly oracleStatus: 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_ADJUDICABLE'
  readonly sideEffectAttributionStatus: C1F0V2SideEffectAttributionStatus
}): string {
  return [
    input.snapshot.status === 'UNAVAILABLE' ? 'POST_RUN_SNAPSHOT_UNAVAILABLE' : null,
    input.evidenceStatus === 'PARTIAL' ? 'EVIDENCE_PARTIAL' : null,
    input.provenanceStatus === 'PARTIAL' ? 'PROVENANCE_PARTIAL' : null,
    input.oracleStatus === 'NOT_ADJUDICABLE' || input.oracleStatus === 'UNKNOWN'
      ? 'ORACLE_UNAVAILABLE'
      : null,
    input.sideEffectAttributionStatus === 'UNKNOWN' ? 'SIDE_EFFECT_ATTRIBUTION_UNKNOWN' : null
  ]
    .filter((value): value is string => value !== null)
    .join(',')
}

async function writeLiveArtifacts(input: {
  readonly reportDir: string
  readonly contract: V2LiveContractView
  readonly authorization: C1F0V2LiveAuthorization
  readonly transportMode: 'NETWORK' | 'INJECTED_FAKE_FETCH'
  readonly providerCalls: number
  readonly networkRequests: number
  readonly providerCallPermits: number
  readonly responseCalls: number
  readonly toolExecutions: number
  readonly runs: readonly C1F0V2RunRecord[]
  readonly checkpoints: readonly C1LiveBindingCheckpoint[]
  readonly feasibility: C1F0V2AdjudicationSummary
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
  const phaseNames = [
    'OUTBOUND_PERMITTED',
    'RESPONSE_RECEIVED',
    'TOOL_EXECUTION_RECORDED',
    'RESPONSE_RECORDED'
  ] as const
  const phaseCounts = Object.fromEntries(
    phaseNames.map((phase) => [
      phase,
      input.checkpoints.filter((checkpoint) => checkpoint.phase === phase).length
    ])
  )
  const studyManifest = {
    bindingId: C1_F0_V2_LIVE_BINDING_ID,
    schemaVersion: C1_F0_V2_LIVE_BINDING_SCHEMA_VERSION,
    executionMode: C1_F0_V2_LIVE_BINDING_MODE,
    studyId: input.authorization.studyId,
    contractId: input.contract.contractId,
    freezeCandidateRunContractSha256: C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
    finalBoundRunContractSha256: input.authorization.finalBoundRunContractSha256,
    executionRevision: input.authorization.executionRevision,
    executionSurfaceHash: input.authorization.executionSurfaceHash,
    enrollmentManifestSha256: input.authorization.enrollmentManifestSha256,
    provider: input.contract.executionBinding.provider,
    model: input.contract.executionBinding.model,
    endpoint: input.contract.executionBinding.endpoint,
    providerConfigHash: input.authorization.providerConfigHash,
    responseSource: 'AUTHORIZED_PROVIDER',
    providerCalls: input.providerCalls,
    networkRequests: input.networkRequests,
    transportMode: input.transportMode,
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
    runsPlanned: input.contract.design.totalRuns,
    requiredArtifacts: C1_F0_V2_REQUIRED_ARTIFACTS
  }
  const runManifest = {
    studyId: input.authorization.studyId,
    status: input.feasibility.status,
    providerCalls: input.providerCalls,
    networkRequests: input.networkRequests,
    transportMode: input.transportMode,
    providerCallPermits: input.providerCallPermits,
    responseCalls: input.responseCalls,
    toolExecutions: input.toolExecutions,
    runsPlanned: input.contract.design.totalRuns,
    runsStarted: input.runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
    runsCompleted: input.runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
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
  const documents: ReadonlyArray<readonly [string, string]> = [
    ['study-manifest.json', JSON.stringify(studyManifest, null, 2) + '\n'],
    ['run-manifest.json', JSON.stringify(runManifest, null, 2) + '\n'],
    ['checkpoint-summary.json', JSON.stringify(checkpointSummary, null, 2) + '\n'],
    ['response-ledger.jsonl', responseRows.map((row) => JSON.stringify(row) + '\n').join('')],
    ['feasibility-summary.json', JSON.stringify(input.feasibility, null, 2) + '\n']
  ]
  for (const [name, content] of documents) {
    await writeDurable(join(input.reportDir, name), content)
  }
  for (const name of C1_F0_V2_REQUIRED_ARTIFACTS) {
    await ensureFile(join(input.reportDir, name))
  }
  const serialized = await Promise.all(
    C1_F0_V2_REQUIRED_ARTIFACTS.map(async (name) => readFile(join(input.reportDir, name), 'utf8'))
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
      'F0-v2 live artifact set contains forbidden raw payload'
    )
  }
  const artifacts = []
  for (const name of C1_F0_V2_REQUIRED_ARTIFACTS) {
    artifacts.push(await artifactSummary(input.reportDir, name))
  }
  return Object.freeze(artifacts)
}

function liveReportFailure(input: {
  readonly studyId: string
  readonly reportDir: string | null
  readonly executionRevision: string | null
  readonly executionSurfaceHash: string | null
  readonly contract: C1F0V2Contract | null
  readonly transportMode: 'NETWORK' | 'INJECTED_FAKE_FETCH'
  readonly failures: readonly { readonly code: string; readonly message: string }[]
}): C1F0V2LiveExecutionReport {
  const view = input.contract === null ? null : asLiveContract(input.contract)
  return {
    bindingId: C1_F0_V2_LIVE_BINDING_ID,
    schemaVersion: C1_F0_V2_LIVE_BINDING_SCHEMA_VERSION,
    executionMode: C1_F0_V2_LIVE_BINDING_MODE,
    status: 'F0_V2_NO_GO',
    studyId: input.studyId,
    reportDir: input.reportDir,
    executionRevision: input.executionRevision,
    executionSurfaceHash: input.executionSurfaceHash,
    freezeCandidateRunContractSha256:
      input.contract === null ? null : C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
    finalBoundRunContractSha256: (view?.['runContractSha256'] as string | undefined) ?? null,
    enrollmentManifestSha256: view?.enrollmentBinding.taskManifestSha256 ?? null,
    providerConfigHash: view?.executionBinding.providerConfigHash ?? null,
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    nodeRange: C1_NODE_RANGE,
    responseSource: 'AUTHORIZED_PROVIDER',
    transportMode: input.transportMode,
    providerCalls: 0,
    networkRequests: 0,
    providerCallPermits: 0,
    responseCalls: 0,
    toolExecutions: 0,
    runsPlanned: 32,
    runsStarted: 0,
    runsCompleted: 0,
    blockedRuns: 0,
    studyTerminal: true,
    terminalReason: input.failures.at(-1)?.message ?? 'F0-v2 live execution failed before start',
    artifacts: [],
    runs: Object.freeze([]),
    feasibility: {
      status: 'F0_V2_NO_GO',
      validityGate: {
        pass: false,
        sharedInvalidatorCount: 1,
        reasons: input.failures.map((f) => f.message)
      },
      precisionGate: {
        pass: false,
        startedRunsPerTask: {},
        uniqueRunIds: true,
        taskPanelCoverage: 0,
        unknownRunRate: {},
        adjudicableRunsPerTask: {},
        reasons: ['live preflight failed before study start']
      },
      feasibilityGate: { pass: false, tasks: [] },
      taskSummaries: []
    },
    failures: Object.freeze(input.failures)
  }
}

export async function runC1F0V2AuthorizedStudy(
  options: C1F0V2LiveExecutionOptions
): Promise<C1F0V2LiveExecutionReport> {
  const repoRoot = options.repoRoot ?? resolve(import.meta.dirname, '..', '..', '..', '..', '..')
  const failures: { code: string; message: string }[] = []
  let contract: C1F0V2Contract | null = null
  let reportDir: string | null = null
  let executionRevision: string | null = null
  let executionSurfaceHash: string | null = null
  let providerBinding: C1StrictProviderBinding | null = null
  let providerCalls = 0
  let networkRequests = 0
  let providerCallPermits = 0
  let responseCalls = 0
  let toolExecutions = 0
  let studyTerminal = false
  let terminalReason: string | null = null
  let artifacts: readonly {
    readonly name: string
    readonly sha256: string
    readonly bytes: number
  }[] = []
  const runs: C1F0V2RunRecord[] = []
  let checkpoints: readonly C1LiveBindingCheckpoint[] = []
  let sharedInvalidator = false
  const invalidatorReasons: string[] = []

  try {
    if (!nodeVersionSatisfiesC1Range(process.versions.node)) {
      throw new C1PreflightFailure(
        'NODE_RANGE_MISMATCH',
        'Node ' + process.versions.node + ' is outside ' + C1_NODE_RANGE
      )
    }
    await assertC1LiveWorktreeClean(repoRoot)
    contract = await loadC1F0V2FinalBoundContract(repoRoot)
    const view = asLiveContract(contract)
    const binding = await computeC1F0V2ExecutionBinding(repoRoot)
    executionRevision = binding.executionRevision
    executionSurfaceHash = binding.executionSurfaceHash
    assertLiveAuthorization(options.authorization, view, binding)
    if (
      view.executionBinding.provider !== C1_PROVIDER_ID ||
      view.executionBinding.model !== C1_MODEL_ID
    ) {
      throw new C1PreflightFailure(
        'PROVIDER_BINDING_MISMATCH',
        'F0-v2 provider/model binding is not exact'
      )
    }
    const apiKey = await readStepPlanApiKey(repoRoot, options.envFilePath)
    providerBinding = await prepareC1StrictProvider({
      runIdentity: options.authorization.studyId,
      env: { STEP_PLAN_API_KEY: apiKey }
    })
    const fetchFunction = options.fetchImpl ?? globalThis.fetch
    if (typeof fetchFunction !== 'function') {
      throw new C1PreflightFailure('PROVIDER_PREPARATION_FAILURE', 'global fetch is unavailable')
    }
    const injectedFetch = options.fetchImpl !== undefined
    const countedFetch: typeof fetch = async (input, init) => {
      if (!injectedFetch) networkRequests += 1
      return fetchFunction(input, init)
    }
    reportDir = await (async () => {
      const root =
        options.outputRoot ??
        join(repoRoot, 'research/context-benchmarks/.live-output/c1-f0-v2-live')
      const path = join(root, options.authorization.studyId)
      await mkdir(root, { recursive: true })
      try {
        await mkdir(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new C1PreflightFailure('IDENTITY_REUSE', 'F0-v2 study identity is already claimed')
        }
        throw error
      }
      return path
    })()
    const budgetGuard = new C1HardBudgetGuard({
      perLeg: {
        maxProviderCalls: view.budgets.perRun.maxProviderRequests,
        maxToolCalls: view.budgets.perRun.maxToolRequests,
        maxWallClockMs: view.budgets.perRun.maxWallClockMs
      },
      study: {
        maxProviderCalls: view.budgets.study.maxProviderRequests,
        maxToolCalls: view.budgets.study.maxToolRequests,
        maxWallClockMs: view.budgets.study.maxWallClockMs,
        maxLegs: view.budgets.study.maxRuns
      }
    })
    const checkpointSink = new C1F0V2CheckpointSink(
      new C1JsonlLiveBindingEvidenceSink(join(reportDir, 'checkpoints.jsonl'))
    )
    const provenancePath = join(reportDir, 'tool-provenance.jsonl')
    const snapshotManifestPath = join(reportDir, 'post-run-snapshot-manifest.jsonl')
    const adjudicationPath = join(reportDir, 'task-adjudication.jsonl')
    const frozenStudy = await loadC1FrozenStudy(repoRoot)
    const plans = buildC1F0V2ExecutionPlans(contract, options.authorization.studyId)

    for (const plan of plans) {
      if (sharedInvalidator) {
        runs.push(defaultV2RunRecord(plan, 'STUDY_INVALIDATED'))
        continue
      }
      const taskEntry = view.taskPanel.find((candidate) => candidate.taskId === plan.taskId)
      const task = frozenStudy.tasks.find((candidate) => candidate.taskId === plan.taskId)
      if (taskEntry === undefined || task === undefined) {
        const failure = {
          code: 'MANIFEST_BINDING_MISMATCH',
          message: 'missing F0-v2 task ' + plan.taskId
        }
        failures.push(failure)
        sharedInvalidator = true
        invalidatorReasons.push(failure.message)
        runs.push(defaultV2RunRecord(plan, failure.code))
        continue
      }
      const legDir = join(reportDir, 'legs', plan.runId)
      await mkdir(legDir, { recursive: true })
      let fixture: Awaited<ReturnType<typeof materializeFreshC1Fixture>> | null = null
      let fixtureCleaned = false
      let snapshot: C1F0V2FrozenPostRunSnapshot = {
        snapshotId: plan.runId + '-post-run',
        status: 'UNAVAILABLE',
        cleanup: async () => undefined
      }
      let beforeSnapshot: ReadonlyMap<string, string> = new Map()
      let afterSnapshot: ReadonlyMap<string, string> | null = null
      let changedPaths: readonly string[] = []
      let evaluation: C1TaskEvaluation | undefined
      let writableScopeStatus: 'PASS' | 'FAIL' | 'UNKNOWN' = 'UNKNOWN'
      let failureCode: string | undefined
      let terminationStatus: C1F0V2RunRecord['terminationStatus'] = 'TERMINAL_FAILED'
      let resultEvidence: readonly C1LiveBindingEvidence[] = []
      let hardeningAdapter: C1F0V2HardeningToolAdapter | null = null
      let responseSource: C1AuthorizedProviderResponseSource | null = null
      try {
        const fixtureBinding = await verifyC1FixtureBinding(frozenStudy, task)
        fixture = await materializeFreshC1Fixture(fixtureBinding.sourcePath)
        const before = await computeC1FixtureContentSummary(fixture.path)
        beforeSnapshot = await snapshotC1Fixture(fixture.path)
        if (
          before.sha256 !== taskEntry.fixtureContentSha256 ||
          task.fixtureRevision.fixtureTreeObjectId !== taskEntry.fixtureTreeObjectId
        ) {
          throw new C1PreflightFailure(
            'FIXTURE_BINDING_MISMATCH',
            'F0-v2 fixture binding mismatch for ' + plan.runId
          )
        }
        const sourceOptions: C1AuthorizedProviderResponseSourceOptions = {
          providerBinding: providerBinding!,
          apiKey,
          providerConfigHashOverride: options.authorization.providerConfigHash,
          fetchImpl: countedFetch
        }
        responseSource = new C1AuthorizedProviderResponseSource(sourceOptions)
        const observationSource = await C1LiveTaskObservationSource.fromFixture({
          task,
          runId: plan.runId,
          fixtureRoot: fixture.path
        })
        hardeningAdapter = new C1F0V2HardeningToolAdapter({
          sandboxRoot: fixture.path,
          studyId: options.authorization.studyId,
          runId: plan.runId,
          provenancePath
        })
        const driver = new C1LiveBindingDriver({
          providerBinding: providerBinding!,
          budgetGuard,
          evidenceSink: checkpointSink,
          providerConfigHashOverride: options.authorization.providerConfigHash
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
          runtimeSessionId: options.authorization.studyId + ':' + plan.runId,
          observationSource,
          responseSource,
          toolExecutor: hardeningAdapter,
          maxCalls: view.budgets.perRun.maxProviderRequests,
          killSwitch: createRunKillSwitch(plan.runId, { now: () => new Date().toISOString() })
        })
        resultEvidence = legResult.evidence
        terminationStatus =
          legResult.finalOutcome === 'COMPLETE' ? 'TERMINAL_COMPLETE' : 'TERMINAL_FAILED'
      } catch (error) {
        const failure = failureOf(error)
        failureCode = failure.code
        failures.push(failure)
        terminationStatus = classifyTermination(error)
        if (isLiveSharedInvalidator(failure.code)) {
          sharedInvalidator = true
          invalidatorReasons.push(failure.message)
        }
      }
      resultEvidence =
        resultEvidence.length > 0
          ? resultEvidence
          : evidenceForRun(checkpointSink.checkpoints, plan.runId)
      try {
        if (fixture !== null) {
          afterSnapshot = await snapshotC1Fixture(fixture.path)
          changedPaths = changedC1FixturePaths(beforeSnapshot, afterSnapshot)
          snapshot = await freezePostRunSnapshot({
            fixtureRoot: fixture.path,
            snapshotId: plan.runId + '-post-run',
            unavailable: false
          })
        }
      } catch (error) {
        snapshot = {
          snapshotId: plan.runId + '-post-run',
          status: 'UNAVAILABLE',
          cleanup: async () => undefined
        }
        failures.push(failureOf(error))
      }
      if (snapshot.status === 'FROZEN' && snapshot.path !== undefined) {
        writableScopeStatus = writableScopePass(changedPaths, task.expectedWritablePaths)
          ? 'PASS'
          : 'FAIL'
        evaluation = await runC1TaskOracles({ task, fixtureRoot: snapshot.path }).catch(
          () => undefined
        )
      }
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
      const currentOracleStatus = combineOracleStatus(objectiveStatus, regressionStatus)
      const toolEvents = resultEvidence.flatMap((row) => row.toolEvents)
      const hardeningSummary: C1F0V2ProvenanceSummary = hardeningAdapter?.summary ?? {
        toolExecutions: 0,
        failedExecutions: 0,
        recoveredExecutions: 0,
        blockedRepeatedFailures: 0,
        uniqueFailureSignatures: 0
      }
      const provenanceStatus =
        hardeningAdapter === null && toolEvents.length > 0
          ? 'PARTIAL'
          : hardeningSummary.toolExecutions === toolEvents.length
            ? 'COMPLETE'
            : 'PARTIAL'
      const responseCount = resultEvidence.length
      const joinComplete = checkpointJoinComplete(
        checkpointSink.checkpoints,
        plan.runId,
        responseCount
      )
      const evidenceStatus =
        sharedInvalidator && failureCode !== undefined && isLiveSharedInvalidator(failureCode)
          ? 'INVALID'
          : responseCount > 0 && joinComplete
            ? 'COMPLETE'
            : 'PARTIAL'
      const currentRecoveryStatus = recoveryStatus(hardeningSummary)
      const sideEffectAttributionStatus = deriveSideEffectAttributionStatus({
        changedPaths,
        snapshotStatus: snapshot.status,
        provenanceStatus,
        executions: hardeningAdapter?.executions ?? []
      })
      await appendDurable(snapshotManifestPath, {
        studyId: options.authorization.studyId,
        runOrdinal: plan.runOrdinal,
        runId: plan.runId,
        status: snapshot.status,
        snapshotId: snapshot.snapshotId,
        ...(snapshot.contentSha256 === undefined ? {} : { contentSha256: snapshot.contentSha256 }),
        ...(snapshot.fileCount === undefined ? {} : { fileCount: snapshot.fileCount }),
        changedPathsStatus: afterSnapshot === null ? 'UNKNOWN' : 'OBSERVED',
        changedPaths
      })
      await appendDurable(adjudicationPath, {
        adjudicationPhase: 'PRE_CLEANUP_ADJUDICATION',
        studyId: options.authorization.studyId,
        runOrdinal: plan.runOrdinal,
        taskId: plan.taskId,
        stratum: plan.stratum,
        runId: plan.runId,
        terminationStatus,
        oracleStatus: currentOracleStatus,
        objectiveOracleStatus: objectiveStatus,
        regressionOracleStatus: regressionStatus,
        evidenceStatus,
        provenanceStatus,
        recoveryStatus: currentRecoveryStatus,
        sideEffectAttributionStatus,
        postRunFixtureSnapshotStatus: snapshot.status,
        ...(snapshot.contentSha256 === undefined
          ? {}
          : { postRunFixtureSnapshotHash: snapshot.contentSha256 }),
        changedPaths,
        writableScopeStatus,
        ...(failureCode === undefined ? {} : { failureCode })
      })
      if (fixture !== null) {
        try {
          await fixture.cleanup()
          fixtureCleaned = true
        } catch (error) {
          const failure = failureOf(error)
          failures.push(failure)
          sharedInvalidator = true
          invalidatorReasons.push(failure.message)
        }
      }
      await snapshot.cleanup().catch(() => undefined)
      const finalRunDisposition = taskDisposition({
        terminationStatus,
        oracleStatus: currentOracleStatus,
        evidenceStatus,
        provenanceStatus,
        sideEffectAttributionStatus,
        writableScopeStatus,
        fixtureCleaned,
        snapshotStatus: snapshot.status,
        sharedInvalidator
      })
      const diagnostics: C1F0V2RunDiagnostics = {
        responseCalls: responseCount,
        toolRequestCount: resultEvidence.reduce((sum, row) => sum + row.toolCalls, 0),
        toolExecutionCount: toolEvents.length,
        toolErrorCount: hardeningSummary.failedExecutions,
        recoveredToolErrorCount: hardeningSummary.recoveredExecutions,
        blockedRepeatedFailures: hardeningSummary.blockedRepeatedFailures,
        unrecoveredToolFailure:
          hardeningSummary.failedExecutions > hardeningSummary.recoveredExecutions,
        checkpointJoinComplete: joinComplete
      }
      const record: C1F0V2RunRecord = {
        runOrdinal: plan.runOrdinal,
        repetition: plan.repetition,
        taskOrdinal: plan.taskOrdinal,
        taskId: plan.taskId,
        stratum: plan.stratum,
        runId: plan.runId,
        pairId: plan.pairId,
        terminationStatus,
        oracleStatus: currentOracleStatus,
        objectiveOracleStatus: objectiveStatus,
        regressionOracleStatus: regressionStatus,
        evidenceStatus,
        provenanceStatus,
        recoveryStatus: currentRecoveryStatus,
        sideEffectAttributionStatus,
        runDisposition: finalRunDisposition,
        fixtureCleaned,
        postRunFixtureSnapshotStatus: snapshot.status,
        ...(snapshot.contentSha256 === undefined
          ? {}
          : { postRunFixtureSnapshotHash: snapshot.contentSha256 }),
        changedPaths,
        writableScopeStatus,
        diagnostics,
        ...(finalRunDisposition === 'FEASIBILITY_UNKNOWN'
          ? {
              unknownReason: liveRunUnknownReason({
                snapshot,
                evidenceStatus,
                provenanceStatus,
                oracleStatus: currentOracleStatus,
                sideEffectAttributionStatus
              })
            }
          : {}),
        ...(failureCode === undefined ? {} : { failureCode })
      }
      runs.push(record)
      await writeDurable(
        join(legDir, 'leg-manifest.json'),
        JSON.stringify(
          {
            studyId: options.authorization.studyId,
            runOrdinal: plan.runOrdinal,
            taskId: plan.taskId,
            stratum: plan.stratum,
            pairId: plan.pairId,
            runId: plan.runId,
            arm: 'NATIVE',
            responseSource: 'AUTHORIZED_PROVIDER',
            providerCalls: responseCount,
            terminationStatus,
            oracleStatus: currentOracleStatus,
            evidenceStatus,
            provenanceStatus,
            recoveryStatus: currentRecoveryStatus,
            sideEffectAttributionStatus,
            runDisposition: finalRunDisposition,
            fixtureCleaned,
            postRunFixtureSnapshotStatus: snapshot.status,
            changedPaths,
            writableScopeStatus,
            diagnostics,
            ...(failureCode === undefined ? {} : { failureCode })
          },
          null,
          2
        ) + '\n'
      )
      providerCalls += responseSource?.requestCount ?? 0
      responseCalls += responseCount
      toolExecutions += toolEvents.length
    }
    checkpoints = checkpointSink.checkpoints
    providerCallPermits = budgetGuard.ledger.providerCalls
    const feasibility = adjudicateV2Study({
      contract: view,
      runs,
      sharedInvalidator,
      invalidatorReasons
    })
    studyTerminal = sharedInvalidator
    terminalReason = sharedInvalidator ? (invalidatorReasons.at(-1) ?? 'shared invalidator') : null
    artifacts = await writeLiveArtifacts({
      reportDir,
      contract: view,
      authorization: options.authorization,
      transportMode: injectedFetch ? 'INJECTED_FAKE_FETCH' : 'NETWORK',
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
    providerBinding?.dispose()
    providerBinding = null
    return {
      bindingId: C1_F0_V2_LIVE_BINDING_ID,
      schemaVersion: C1_F0_V2_LIVE_BINDING_SCHEMA_VERSION,
      executionMode: C1_F0_V2_LIVE_BINDING_MODE,
      status: feasibility.status,
      studyId: options.authorization.studyId,
      reportDir,
      executionRevision,
      executionSurfaceHash,
      freezeCandidateRunContractSha256: C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
      finalBoundRunContractSha256: options.authorization.finalBoundRunContractSha256,
      enrollmentManifestSha256: options.authorization.enrollmentManifestSha256,
      providerConfigHash: options.authorization.providerConfigHash,
      provider: C1_PROVIDER_ID,
      model: C1_MODEL_ID,
      endpoint: C1_PROVIDER_ENDPOINT,
      nodeRange: C1_NODE_RANGE,
      responseSource: 'AUTHORIZED_PROVIDER',
      transportMode: injectedFetch ? 'INJECTED_FAKE_FETCH' : 'NETWORK',
      providerCalls,
      networkRequests,
      providerCallPermits,
      responseCalls,
      toolExecutions,
      runsPlanned: 32,
      runsStarted: runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
      runsCompleted: runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
      blockedRuns: runs.filter((run) => run.terminationStatus === 'BLOCKED').length,
      studyTerminal,
      terminalReason,
      artifacts,
      runs: Object.freeze(runs),
      feasibility,
      failures: Object.freeze(failures)
    }
  } catch (error) {
    const failure = failureOf(error)
    failures.push(failure)
    providerBinding?.dispose()
    return liveReportFailure({
      studyId: options.authorization.studyId,
      reportDir,
      executionRevision,
      executionSurfaceHash,
      contract,
      transportMode: options.fetchImpl === undefined ? 'NETWORK' : 'INJECTED_FAKE_FETCH',
      failures
    })
  }
}
