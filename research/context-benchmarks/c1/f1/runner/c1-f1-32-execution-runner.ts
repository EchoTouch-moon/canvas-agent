import { createHash } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRunKillSwitch } from '@canvas-agent/pi-context-integration/experimental'
import type { ContextWorkingSet } from '@canvas-agent/context-runtime'
import type { PiMessageView } from '@canvas-agent/pi-context-integration'
import { c1ToolPairFingerprint, type C1CarriedRemoval } from '../../../src/c1-carried-removals'
import {
  C1_F1_NATIVE32_ANCHOR_SURFACE_INVENTORY,
  type C1F1Native32SurfaceInventoryEntry
} from '../contract/c1-f1-native-feasibility-32-anchor-inventory'
import {
  C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
  C1_F1_NATIVE32_PENDING_BINDING,
  C1_F1_NATIVE32_PROVIDER_CONFIG_HASH,
  assertC1F1Native32SurfaceWitnessMatchesActualInventory,
  computeC1F1Native32SurfaceInventoryHash,
  computeC1F1Native32RunContractSha256,
  loadC1F1Native32Contract,
  validateC1F1Native32FinalBoundContract,
  type C1F1Native32Contract
} from '../contract/c1-f1-native-feasibility-32-contract'
import {
  C1_F0_V2_REQUIRED_ARTIFACTS,
  C1F0V2HardeningToolAdapter,
  C1F0V2CheckpointSink,
  adjudicateV2Study,
  artifactSummary,
  claimLegDir,
  claimStudyDir,
  checkpointJoinComplete,
  classifyTermination,
  combineOracleStatus,
  defaultV2RunRecord,
  deriveSideEffectAttributionStatus,
  evidenceForRun,
  failureOf,
  freezePostRunSnapshot,
  isSharedInvalidator,
  metadataEvidence,
  recoveryStatus,
  taskDisposition,
  type C1F0V2AdjudicationSummary,
  type C1F0V2FrozenPostRunSnapshot,
  type C1F0V2ProvenanceSummary,
  type C1F0V2RunRecord,
  type C1F0V2SideEffectAttributionStatus,
  type C1F0V2TerminationStatus,
  type V2ContractView
} from '../../f0/v2/runner/c1-f0-v2-execution-runner'
import {
  C1HardBudgetGuard,
  C1LegExecutor,
  C1PreflightFailure,
  C1_PROVIDER_ENDPOINT,
  C1_PROVIDER_ID,
  C1_MODEL_ID,
  C1_NODE_RANGE,
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
  type C1StrictProviderBinding
} from '../../../src/c1-live-preflight'
import {
  appendC1LiveResponseToObservation,
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingTransport,
  type C1LiveBindingCheckpoint,
  type C1LiveBindingEvidence,
  type C1LiveBindingLegInput,
  type C1LiveBindingLegResult,
  type C1LiveBindingResponseReceipt,
  type C1LiveBindingEvidenceSink,
  type C1LiveModelResponse,
  type C1LiveResponseSource,
  type C1LiveToolExecution,
  type C1LiveToolRequest,
  type C1LiveUsage,
  validateC1LiveBindingEvidence
} from '../../../src/c1-live-binding'
import {
  assertC1LiveWorktreeClean,
  C1LiveTaskObservationSource,
  runC1TaskOracles,
  type C1TaskEvaluation
} from '../../../src/c1-live-study'
import { buildSanitizedChildEnvironment, runProcess } from '../../../src/fixture-generator'

export const C1_F1_NATIVE32_RUNNER_ID = 'C1_F1_NATIVE_FEASIBILITY_RUNNER_32' as const
export const C1_F1_NATIVE32_RUNNER_SCHEMA_VERSION = 1 as const
export const C1_F1_NATIVE32_RUNNER_MODE = 'CREDENTIAL_FREE_NATIVE_ONLY' as const
export const C1_F1_NATIVE32_EXECUTION_SURFACE_PATH =
  'research/context-benchmarks/c1/f1/runner/c1-f1-32-execution-runner.ts' as const
export const C1_F1_NATIVE32_EXECUTION_SURFACE_PATHS = Object.freeze([
  ...C1_F1_NATIVE32_ANCHOR_SURFACE_INVENTORY.map((entry) => entry.path),
  C1_F1_NATIVE32_EXECUTION_SURFACE_PATH
] as const)

export type C1F1Native32FakeScenario =
  | 'COMPLETE'
  | 'TOOL_RECOVERY'
  | 'TOOL_LOOP'
  | 'TOOL_SIDE_EFFECT'
  | 'BUDGET_EXHAUSTION'
  | 'UNKNOWN_SNAPSHOT'
  | 'SINGLE_RUN_FAILURE'
  | 'STUDY_INVALIDATOR'

export type C1F1Native32PointLabel =
  'INVALID' | 'INCONCLUSIVE' | 'VALID_INFEASIBLE' | 'VALID_STABLE_FEASIBLE'

export interface C1F1Native32ExecutionPlan {
  readonly runOrdinal: number
  readonly repetition: number
  readonly taskOrdinal: 1 | 2
  readonly taskId: string
  readonly stratum: string
  readonly runId: string
  readonly pairId: string
}

export interface C1F1Native32ExecutionBinding {
  readonly executionRevision: string
  readonly executionSurfaceHash: string
  readonly inventory: readonly C1F1Native32SurfaceInventoryEntry[]
}

export interface C1F1Native32ExecutionRunnerOptions {
  readonly repoRoot?: string
  readonly outputRoot?: string
  /** A test-only synthetic identity; owner identities remain outside this runner. */
  readonly studyId: string
  readonly scenario?: C1F1Native32FakeScenario
  readonly testRunLimit?: number
}

export interface C1F1Native32ExecutionReport {
  readonly runnerId: typeof C1_F1_NATIVE32_RUNNER_ID
  readonly schemaVersion: typeof C1_F1_NATIVE32_RUNNER_SCHEMA_VERSION
  readonly executionMode: typeof C1_F1_NATIVE32_RUNNER_MODE
  readonly scenario: C1F1Native32FakeScenario
  readonly status: C1F1Native32PointLabel | 'NO_GO'
  readonly studyId: string
  readonly reportDir: string | null
  readonly executionRevision: string | null
  readonly executionSurfaceHash: string | null
  readonly freezeCandidateRunContractSha256:
    typeof C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256 | null
  readonly finalBoundRunContractSha256: string | null
  readonly providerConfigHash: string | null
  readonly provider: typeof C1_PROVIDER_ID
  readonly model: typeof C1_MODEL_ID
  readonly endpoint: typeof C1_PROVIDER_ENDPOINT
  readonly nodeRange: typeof C1_NODE_RANGE
  readonly responseSource: 'SCRIPTED_FAKE'
  readonly providerCalls: 0
  readonly networkRequests: 0
  readonly responseCalls: number
  readonly toolExecutions: number
  readonly runsPlanned: 32
  readonly runsStarted: number
  readonly runsCompleted: number
  readonly blockedRuns: number
  readonly studyTerminal: boolean
  readonly terminalReason: string | null
  readonly pointLabel: C1F1Native32PointLabel | 'INVALID'
  readonly surfaceWitness: Record<string, unknown> | null
  readonly artifacts: readonly {
    readonly name: string
    readonly sha256: string
    readonly bytes: number
  }[]
  readonly runs: readonly C1F0V2RunRecord[]
  readonly feasibility: C1F0V2AdjudicationSummary
  readonly failures: readonly { readonly code: string; readonly message: string }[]
}

const F1_NATIVE32_STUDY_ID_PATTERN = /^c1-f1-32-\d{8}-[0-9a-f]{8}$/
const F1_NATIVE32_RUN_ID_PREFIX_PATTERN = /^(c1-f1-32-\d{8})-[0-9a-f]{8}$/
const F1_NATIVE32_CREDENTIAL_SENTINEL = 'c1-f1-32-credential-free-in-memory-sentinel'

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function asV2Contract(contract: C1F1Native32Contract): V2ContractView {
  return contract as unknown as V2ContractView
}

function assertF1StudyId(studyId: string): void {
  if (!F1_NATIVE32_STUDY_ID_PATTERN.test(studyId)) {
    throw new C1PreflightFailure('IDENTITY_INVALID', 'invalid F1-32 credential-free study identity')
  }
}

function studyRunPrefix(studyId: string): string {
  const match = F1_NATIVE32_RUN_ID_PREFIX_PATTERN.exec(studyId)
  if (match?.[1] === undefined) {
    throw new C1PreflightFailure('IDENTITY_INVALID', 'invalid F1-32 study identity prefix')
  }
  return match[1]
}

function runIdFor(studyId: string, runOrdinal: number): string {
  return (
    studyRunPrefix(studyId) +
    '-run-' +
    String(runOrdinal).padStart(2, '0') +
    '-' +
    sha256(studyId + '\u0000' + String(runOrdinal)).slice(0, 8)
  )
}

function pairIdFor(studyId: string, taskId: string, repetition: number): string {
  return studyRunPrefix(studyId) + '-pair-' + taskId + '-' + String(repetition).padStart(2, '0')
}

export function buildC1F1Native32ExecutionPlans(
  contract: C1F1Native32Contract,
  studyId: string
): readonly C1F1Native32ExecutionPlan[] {
  assertF1StudyId(studyId)
  const view = asV2Contract(contract)
  const plans: C1F1Native32ExecutionPlan[] = []
  let runOrdinal = 0
  for (let repetition = 1; repetition <= view.design.runOrder.repetitions; repetition += 1) {
    for (const [index, taskId] of view.design.runOrder.pattern.entries()) {
      const task = view.taskPanel.find((candidate) => candidate.taskId === taskId)
      if (task === undefined) {
        throw new C1PreflightFailure(
          'MANIFEST_BINDING_MISMATCH',
          'F1-32 run order references an unknown task'
        )
      }
      runOrdinal += 1
      plans.push({
        runOrdinal,
        repetition,
        taskOrdinal: (index + 1) as 1 | 2,
        taskId: task.taskId,
        stratum: task.stratum,
        runId: runIdFor(studyId, runOrdinal),
        pairId: pairIdFor(studyId, task.taskId, repetition)
      })
    }
  }
  if (
    plans.length !== view.design.totalRuns ||
    plans.filter((plan) => plan.taskId === view.taskPanel[0]?.taskId).length !==
      view.design.runsPerTask ||
    plans.filter((plan) => plan.taskId === view.taskPanel[1]?.taskId).length !==
      view.design.runsPerTask
  ) {
    throw new C1PreflightFailure(
      'MANIFEST_BINDING_MISMATCH',
      'F1-32 plan shape does not match frozen contract'
    )
  }
  return Object.freeze(plans)
}

export async function computeC1F1Native32ExecutionBinding(
  repoRoot: string
): Promise<C1F1Native32ExecutionBinding> {
  const paths = [...C1_F1_NATIVE32_EXECUTION_SURFACE_PATHS]
  const filesResult = await runProcess('git', ['ls-files', '-z', '--', ...paths], {
    cwd: repoRoot,
    timeoutMs: 30_000,
    env: buildSanitizedChildEnvironment()
  })
  if (filesResult.exitCode !== 0 || filesResult.timedOut || filesResult.outputLimitExceeded) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'unable to enumerate F1-32 execution surface'
    )
  }
  const files = filesResult.stdout.split('\0').filter(Boolean).sort()
  const expected = [...paths].sort()
  if (files.length !== expected.length || files.some((file, index) => file !== expected[index])) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'F1-32 execution surface inventory differs from frozen paths'
    )
  }
  const inventory: C1F1Native32SurfaceInventoryEntry[] = []
  for (const file of files) {
    inventory.push({ path: file, sha256: sha256(await readFile(join(repoRoot, file))) })
  }
  const revisionResult = await runProcess('git', ['log', '-1', '--format=%H', '--', ...paths], {
    cwd: repoRoot,
    timeoutMs: 30_000,
    env: buildSanitizedChildEnvironment()
  })
  const executionRevision = revisionResult.stdout.trim()
  if (revisionResult.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(executionRevision)) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'unable to resolve F1-32 execution revision'
    )
  }
  return {
    executionRevision,
    executionSurfaceHash: computeC1F1Native32SurfaceInventoryHash(inventory),
    inventory: Object.freeze(inventory)
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', path + ' must be an object')
  }
  return value as Record<string, unknown>
}

function buildFinalBoundF1Contract(input: {
  readonly candidate: C1F1Native32Contract
  readonly binding: C1F1Native32ExecutionBinding
}): {
  readonly contract: C1F1Native32Contract
  readonly surfaceWitness: Record<string, unknown>
} {
  const candidate = JSON.parse(JSON.stringify(input.candidate)) as Record<string, unknown>
  const candidateWitness = record(
    candidate['surfaceEquivalenceWitness'],
    'surfaceEquivalenceWitness'
  )
  const anchorInventory = C1_F1_NATIVE32_ANCHOR_SURFACE_INVENTORY
  const anchorByPath = new Map(anchorInventory.map((entry) => [entry.path, entry.sha256]))
  const targetInventory = [...input.binding.inventory].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  )
  const entries = targetInventory.map((entry) => {
    const anchorHash = anchorByPath.get(entry.path)
    if (anchorHash !== undefined) {
      if (entry.sha256 !== anchorHash) {
        throw new C1PreflightFailure(
          'CONTRACT_BINDING_MISMATCH',
          'F1-32 execution surface changed an anchor path: ' + entry.path
        )
      }
      return {
        path: entry.path,
        anchorPath: entry.path,
        anchorHash,
        targetHash: entry.sha256,
        classification: 'EXACT_UNCHANGED'
      }
    }
    if (!entry.path.startsWith('research/context-benchmarks/c1/f1/runner/')) {
      throw new C1PreflightFailure(
        'CONTRACT_BINDING_MISMATCH',
        'F1-32 execution surface has an undeclared target-only path: ' + entry.path
      )
    }
    return {
      path: entry.path,
      anchorPath: null,
      anchorHash: null,
      targetHash: entry.sha256,
      classification: 'BUDGET_ONLY_PROJECTION'
    }
  })
  const targetPaths = targetInventory.map((entry) => entry.path)
  const surfaceWitness: Record<string, unknown> = {
    ...candidateWitness,
    phase: 'FINAL_BOUND',
    targetExecutionBinding: {
      codeRevision: input.binding.executionRevision,
      executionSurfaceHash: input.binding.executionSurfaceHash
    },
    targetInventoryDigest: input.binding.executionSurfaceHash,
    targetSurfacePaths: targetPaths,
    entries,
    witnessStatus: 'COMPLETE'
  }
  candidate['status'] = 'FROZEN'
  candidate['designStatus'] = 'FINAL_BOUND'
  candidate['runContractHashRole'] = 'FINAL_BOUND'
  candidate['freezeCandidateRunContractSha256'] = candidate['runContractSha256']
  candidate['finalBoundRunContractSha256'] = 'PENDING_F1_32_FINAL_HASH'
  const execution = record(candidate['executionBinding'], 'executionBinding')
  execution['codeRevision'] = input.binding.executionRevision
  execution['executionSurfaceHash'] = input.binding.executionSurfaceHash
  candidate['surfaceEquivalenceWitness'] = surfaceWitness
  const finalHash = computeC1F1Native32RunContractSha256(candidate)
  candidate['runContractSha256'] = finalHash
  candidate['finalBoundRunContractSha256'] = finalHash
  const validated = validateC1F1Native32FinalBoundContract(candidate)
  return { contract: validated, surfaceWitness }
}

function fakeUsage(inputTokens: number, outputTokens: number): C1LiveUsage {
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: inputTokens + outputTokens,
    usageSource: 'SCRIPTED_FAKE'
  }
}

function bashRequest(runId: string, ordinal: number, command: string): C1LiveToolRequest {
  return {
    toolCallId: runId + '-tool-' + String(ordinal).padStart(2, '0'),
    toolName: 'bash',
    argumentsJson: JSON.stringify({ command })
  }
}

function scriptedResponse(
  runId: string,
  ordinal: number,
  outcome: C1LiveModelResponse['outcome'],
  toolRequests: readonly C1LiveToolRequest[] = []
): C1LiveModelResponse {
  return {
    responseId: runId + '-response-' + String(ordinal).padStart(2, '0'),
    assistantMessageCount: 1,
    assistantContent: 'credential-free F1-32 scripted response',
    usage: fakeUsage(20, 3),
    toolRequests,
    toolExecutions: [],
    outcome
  }
}

class C1F1Native32ScriptedResponseSource implements C1LiveResponseSource {
  readonly kind = 'SCRIPTED_FAKE' as const
  private cursor = 0

  constructor(
    private readonly runId: string,
    private readonly scenario: C1F1Native32FakeScenario
  ) {}

  async next(request: {
    readonly capture: { readonly providerConfigHash: string }
  }): Promise<C1LiveModelResponse> {
    if (request.capture.providerConfigHash !== C1_F1_NATIVE32_PROVIDER_CONFIG_HASH) {
      throw new C1PreflightFailure(
        'PROVIDER_BINDING_MISMATCH',
        'F1-32 fake source received a config hash mismatch'
      )
    }
    const ordinal = ++this.cursor
    if (this.scenario === 'BUDGET_EXHAUSTION') {
      return scriptedResponse(this.runId, ordinal, 'CONTINUE')
    }
    if (this.scenario === 'TOOL_RECOVERY') {
      if (ordinal === 1)
        return scriptedResponse(this.runId, ordinal, 'CONTINUE', [
          bashRequest(this.runId, 1, 'exit 7')
        ])
      if (ordinal === 2)
        return scriptedResponse(this.runId, ordinal, 'CONTINUE', [
          bashRequest(this.runId, 2, 'node --version')
        ])
      return scriptedResponse(this.runId, ordinal, 'COMPLETE')
    }
    if (this.scenario === 'TOOL_LOOP') {
      if (ordinal <= 3)
        return scriptedResponse(this.runId, ordinal, 'CONTINUE', [
          bashRequest(this.runId, ordinal, 'exit 7')
        ])
      return scriptedResponse(this.runId, ordinal, 'COMPLETE')
    }
    if (this.scenario === 'TOOL_SIDE_EFFECT') {
      if (ordinal === 1) {
        return scriptedResponse(this.runId, ordinal, 'CONTINUE', [
          bashRequest(this.runId, ordinal, "printf 'side effect' > package-lock.json")
        ])
      }
      return scriptedResponse(this.runId, ordinal, 'COMPLETE')
    }
    return scriptedResponse(this.runId, ordinal, 'COMPLETE')
  }
}

function parseToolArguments(argumentsJson: string, toolCallId: string): unknown {
  try {
    return JSON.parse(argumentsJson) as unknown
  } catch {
    throw new C1PreflightFailure(
      'PREFLIGHT_FAILURE',
      `tool request ${toolCallId} has invalid JSON arguments`
    )
  }
}

function toolRequestEvidence(request: C1LiveToolRequest): {
  readonly toolCallId: string
  readonly toolName: string
  readonly argumentHash: string
  readonly path?: string
} {
  const parsed = parseToolArguments(request.argumentsJson, request.toolCallId)
  const pathValue =
    (request.toolName === 'read' || request.toolName === 'edit') &&
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)['path']
      : undefined
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    argumentHash: sha256(request.argumentsJson),
    ...(typeof pathValue === 'string' && pathValue.length > 0 ? { path: pathValue } : {})
  }
}

function validateF1ModelResponse(response: C1LiveModelResponse): void {
  if (response.responseId.length === 0)
    throw new C1PreflightFailure(
      'PREFLIGHT_FAILURE',
      'F1-32 response is missing a stable response id'
    )
  if (!Number.isInteger(response.assistantMessageCount) || response.assistantMessageCount < 1) {
    throw new C1PreflightFailure(
      'PREFLIGHT_FAILURE',
      'F1-32 response must contain an assistant message'
    )
  }
  if (!['CONTINUE', 'COMPLETE', 'FAILED'].includes(response.outcome)) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'F1-32 response has an unknown outcome')
  }
  const requests = new Map<string, C1LiveToolRequest>()
  for (const request of response.toolRequests) {
    if (
      request.toolCallId.length === 0 ||
      request.toolName.length === 0 ||
      request.argumentsJson.length === 0 ||
      requests.has(request.toolCallId)
    ) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'F1-32 response contains an unstable tool request'
      )
    }
    parseToolArguments(request.argumentsJson, request.toolCallId)
    requests.set(request.toolCallId, request)
  }
  const executionIds = new Set<string>()
  for (const execution of response.toolExecutions) {
    const request = requests.get(execution.toolCallId)
    if (
      request === undefined ||
      request.toolName !== execution.toolName ||
      executionIds.has(execution.toolCallId) ||
      !['SUCCESS', 'ERROR'].includes(execution.result)
    ) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'F1-32 response contains an unmatched tool execution'
      )
    }
    executionIds.add(execution.toolCallId)
  }
}

function withPreviousWorkingSet(
  observation: C1AgentObservation,
  previousWorkingSet: ContextWorkingSet | null
): C1AgentObservation {
  if (previousWorkingSet !== null && observation.previousWorkingSetId === null) {
    return { ...observation, previousWorkingSetId: previousWorkingSet.workingSetId }
  }
  return observation
}

type C1F1Native32CheckpointInput = C1LiveBindingCheckpoint extends infer Checkpoint
  ? Checkpoint extends C1LiveBindingCheckpoint
    ? Omit<Checkpoint, 'checkpointOrdinal'>
    : never
  : never

/**
 * F1's only driver delta is the frozen 32-call provider envelope. The shared
 * C1 driver intentionally retains the historical 24-call ceiling, so this
 * adapter keeps its evidence and execution semantics while widening only the
 * point budget for F1-32.
 */
class C1F1Native32BindingDriver {
  private readonly executor: C1LegExecutor
  private checkpointOrdinal = 0
  private studyTerminalReason: string | null = null

  constructor(
    private readonly options: {
      readonly providerBinding: C1StrictProviderBinding
      readonly budgetGuard: C1HardBudgetGuard
      readonly evidenceSink: C1LiveBindingEvidenceSink
      readonly providerConfigHashOverride?: string
    }
  ) {
    this.executor = new C1LegExecutor({ providerBinding: options.providerBinding })
  }

  get isStudyTerminal(): boolean {
    return this.studyTerminalReason !== null
  }

  get terminalReason(): string | null {
    return this.studyTerminalReason
  }

  private tripStudyTerminal(error: unknown): void {
    if (
      error instanceof C1PreflightFailure &&
      (error.code === 'BUDGET_BREACH' || error.code === 'EVIDENCE_WRITE_FAILURE')
    ) {
      this.studyTerminalReason ??= error.message
    }
  }

  private async appendCheckpoint(checkpoint: C1F1Native32CheckpointInput): Promise<void> {
    const next = Object.freeze({
      checkpointOrdinal: ++this.checkpointOrdinal,
      ...checkpoint
    }) as C1LiveBindingCheckpoint
    try {
      await this.options.evidenceSink.append(next)
    } catch (error) {
      if (error instanceof C1PreflightFailure && error.code === 'EVIDENCE_WRITE_FAILURE') {
        throw error
      }
      throw new C1PreflightFailure(
        'EVIDENCE_WRITE_FAILURE',
        `F1-32 evidence checkpoint ${next.checkpointOrdinal} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  async runLeg(input: C1LiveBindingLegInput): Promise<C1LiveBindingLegResult> {
    if (this.studyTerminalReason !== null) {
      throw new C1PreflightFailure(
        'BUDGET_BREACH',
        `F1-32 study is terminal; next leg is forbidden (${this.studyTerminalReason})`
      )
    }
    const maxCalls = input.maxCalls ?? 32
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 32) {
      throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'F1-32 maxCalls must be in the 1..32 range')
    }
    const startedAtMs = input.startedAtMs ?? Date.now()
    try {
      this.options.budgetGuard.beginLeg(startedAtMs)
    } catch (error) {
      this.tripStudyTerminal(error)
      throw error
    }
    let legEnded = false
    const killSwitch =
      input.killSwitch ?? createRunKillSwitch(input.runId, { now: () => new Date().toISOString() })
    let observation = input.observationSource.initialObservation
    let previousObservation = observation
    let previousWorkingSet: ContextWorkingSet | null = input.initialWorkingSet ?? null
    let previousExecution: C1LegExecutionResult | null = null
    const carriedRemovals = new Map<string, C1CarriedRemoval>(
      (input.initialCarriedRemovals ?? []).map((removal) => [removal.toolCallId, removal])
    )
    const evidence: C1LiveBindingEvidence[] = []
    let finalOutcome: C1LiveModelResponse['outcome'] | undefined
    let transportSendAttempts = 0
    let blockedProviderCallAttempts = 0
    try {
      for (let callOrdinal = 1; callOrdinal <= maxCalls; callOrdinal += 1) {
        const currentObservation = withPreviousWorkingSet(observation, previousWorkingSet)
        const transport = new C1LiveBindingTransport({
          provider: C1_PROVIDER_ID,
          model: C1_MODEL_ID,
          endpoint: C1_PROVIDER_ENDPOINT,
          providerConfigHash:
            this.options.providerConfigHashOverride ??
            this.options.providerBinding.providerConfigHash
        })
        let execution: C1LegExecutionResult
        try {
          execution = this.executor.execute({
            studyId: input.studyId,
            task: input.task,
            stratum: input.stratum,
            pairId: input.pairId,
            arm: input.arm,
            runId: input.runId,
            turnId: `${input.runId}-turn-${String(callOrdinal).padStart(2, '0')}`,
            modelCallId: `${input.runId}-model-call-${String(callOrdinal).padStart(2, '0')}`,
            fixtureContentSha256: input.fixtureContentSha256,
            fixtureTreeObjectId: input.fixtureTreeObjectId,
            observation: currentObservation,
            providerBinding: this.options.providerBinding,
            transport,
            treatmentReady: true,
            ...(this.options.providerConfigHashOverride === undefined
              ? {}
              : { providerConfigHashOverride: this.options.providerConfigHashOverride }),
            killSwitch,
            previousWorkingSet,
            carriedRemovals: [...carriedRemovals.values()],
            recompositionSequence: callOrdinal - 1,
            runtimeSessionId: input.runtimeSessionId,
            requireRuntimeDifference: input.requireRuntimeDifferenceForCall?.(callOrdinal) ?? false
          })
        } catch (error) {
          if (error instanceof C1PreflightFailure) {
            throw new C1PreflightFailure(
              error.code,
              `F1-32 call ${callOrdinal} (${input.arm}) failed: ${error.message}`
            )
          }
          throw error
        }
        transport.attachProviderBoundMessages(
          execution.providerBoundMessages,
          execution.structuralEnvelope
        )
        let response: C1LiveModelResponse
        try {
          response = await transport.send({
            budgetGuard: this.options.budgetGuard,
            responseSource: input.responseSource,
            killSwitch,
            ...(input.responseAbortSignal === undefined
              ? {}
              : { signal: input.responseAbortSignal }),
            ...(input.nowMs !== undefined ? { nowMs: input.nowMs } : {}),
            transportSendAttemptOrdinal: transportSendAttempts + 1,
            onOutboundPermitted: ({ request, providerCallOrdinal, transportSendAttemptOrdinal }) =>
              this.appendCheckpoint({
                phase: 'OUTBOUND_PERMITTED',
                callOrdinal,
                providerCallOrdinal,
                transportSendAttemptOrdinal,
                capture: request.capture
              })
          })
        } catch (error) {
          transportSendAttempts += transport.sendAttempts
          blockedProviderCallAttempts += transport.blockedSendAttempts
          throw error
        }
        transportSendAttempts += transport.sendAttempts
        blockedProviderCallAttempts += transport.blockedSendAttempts
        validateF1ModelResponse(response)
        const receipt: C1LiveBindingResponseReceipt = {
          studyId: execution.capture.studyId,
          taskId: execution.capture.taskId,
          stratum: execution.capture.stratum,
          pairId: execution.capture.pairId,
          arm: execution.capture.arm,
          runId: execution.capture.runId,
          callOrdinal,
          turnId: execution.capture.turnId,
          modelCallId: execution.capture.modelCallId,
          responseId: response.responseId,
          responseSource: input.responseSource.kind,
          assistantMessages: response.assistantMessageCount,
          usage: response.usage,
          toolCalls: response.toolRequests.length,
          toolRequestEvidence: Object.freeze(
            response.toolRequests.map((request) => toolRequestEvidence(request))
          ),
          taskOutcome: response.outcome,
          provider: execution.capture.provider,
          model: execution.capture.model,
          endpoint: execution.capture.endpoint,
          providerConfigHash: execution.capture.providerConfigHash,
          contextStrategy: execution.capture.contextStrategy,
          providerBoundSourceKeys: execution.capture.providerBoundSourceKeys,
          ...(execution.capture.prePolicyProviderBoundMessagesHash === undefined
            ? {}
            : {
                prePolicyProviderBoundMessagesHash:
                  execution.capture.prePolicyProviderBoundMessagesHash
              }),
          ...(execution.capture.postPolicyProviderBoundMessagesHash === undefined
            ? {}
            : {
                postPolicyProviderBoundMessagesHash:
                  execution.capture.postPolicyProviderBoundMessagesHash
              }),
          modelVisibleSemanticContextFingerprint:
            execution.capture.modelVisibleSemanticContextFingerprint,
          systemDeveloperToolStructuresFingerprint:
            execution.capture.systemDeveloperToolStructuresFingerprint,
          workingSetId: execution.capture.workingSetId,
          transitionId: execution.capture.transitionId,
          transitionDecisionKinds: Object.freeze(
            execution.transition?.orderedDecisions.map((decision) => decision.kind) ?? []
          ),
          decisionDetails:
            execution.transition?.orderedDecisions.map((decision) => ({
              kind: decision.kind,
              sourceKey: decision.sourceKey,
              sourceVersionId: decision.sourceVersionId,
              reasonCodes: [...decision.reasonCodes]
            })) ?? [],
          carriedRemovedSourceKeys: execution.carriedRemovedSourceKeys,
          carriedRemovalEvidence: [...carriedRemovals.values()].filter((removal) =>
            execution.carriedRemovedSourceKeys.includes(`run/tool-call://${removal.toolCallId}`)
          ),
          lifecycleEligible: execution.capture.lifecycleEligible,
          runtimeContextChanged: execution.capture.runtimeContextChanged,
          fallbackSent: false,
          networkSent: false,
          replayMismatch: execution.replayMismatch
        }
        await this.appendCheckpoint({ phase: 'RESPONSE_RECEIVED', callOrdinal, receipt })
        const recordedTools = new Map<string, C1LiveToolExecution>()
        const recordTool = async (tool: C1LiveToolExecution): Promise<void> => {
          const request = receipt.toolRequestEvidence.find(
            (item) => item.toolCallId === tool.toolCallId
          )
          if (request?.toolName !== tool.toolName || recordedTools.has(tool.toolCallId)) {
            throw new C1PreflightFailure(
              'PREFLIGHT_FAILURE',
              'tool event is duplicate or has no matching request'
            )
          }
          const metadata: C1LiveToolExecution = {
            toolCallId: tool.toolCallId,
            toolName: tool.toolName,
            ...(tool.path === undefined ? {} : { path: tool.path }),
            result: tool.result
          }
          await this.appendCheckpoint({
            phase: 'TOOL_EXECUTION_RECORDED',
            callOrdinal,
            runId: input.runId,
            execution: metadata
          })
          recordedTools.set(tool.toolCallId, metadata)
        }
        this.options.budgetGuard.reserveToolCalls(response.toolRequests.length)
        let effectiveResponse = response
        let toolObservation: C1AgentObservation | undefined
        if (input.toolExecutor !== undefined && response.toolRequests.length > 0) {
          if (response.toolExecutions.length > 0) {
            throw new C1PreflightFailure(
              'PREFLIGHT_FAILURE',
              'F1-32 scripted response prepopulated tool executions'
            )
          }
          const toolLoop = await input.toolExecutor.execute({
            previousObservation: currentObservation,
            response,
            observationId: `${input.runId}-observation-after-call-${String(callOrdinal).padStart(2, '0')}`,
            onToolExecution: recordTool
          })
          if (toolLoop.executions.length !== response.toolRequests.length) {
            throw new C1PreflightFailure(
              'PREFLIGHT_FAILURE',
              `F1-32 tool executor returned ${toolLoop.executions.length} executions for ${response.toolRequests.length} requests`
            )
          }
          effectiveResponse = Object.freeze({
            ...response,
            toolExecutions: Object.freeze([...toolLoop.executions])
          })
          toolObservation = toolLoop.observation
        }
        validateF1ModelResponse(effectiveResponse)
        for (const tool of effectiveResponse.toolExecutions) {
          const recorded = recordedTools.get(tool.toolCallId)
          if (recorded === undefined) await recordTool(tool)
          else if (
            recorded.toolName !== tool.toolName ||
            recorded.result !== tool.result ||
            recorded.path !== tool.path
          ) {
            throw new C1PreflightFailure(
              'PREFLIGHT_FAILURE',
              'tool return differs from persisted event'
            )
          }
        }
        if (recordedTools.size !== effectiveResponse.toolExecutions.length) {
          throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'tool return omits persisted event')
        }
        const row: C1LiveBindingEvidence = {
          ...receipt,
          toolEvents: Object.freeze([...recordedTools.values()])
        }
        await this.appendCheckpoint({ phase: 'RESPONSE_RECORDED', callOrdinal, evidence: row })
        evidence.push(row)
        const removedKeys = new Set(
          execution.transition?.orderedDecisions
            .filter((decision) => decision.kind === 'REMOVE')
            .map((decision) => decision.sourceKey) ?? []
        )
        for (const key of removedKeys) {
          if (!key.startsWith('run/tool-call://')) continue
          const toolCallId = key.slice('run/tool-call://'.length)
          if (
            !removedKeys.has(`run/tool-result://${toolCallId}`) ||
            execution.capture.providerBoundSourceKeys.includes(key)
          ) {
            continue
          }
          carriedRemovals.set(toolCallId, {
            toolCallId,
            pairFingerprint: c1ToolPairFingerprint(currentObservation.messages, toolCallId),
            removalTransitionId: execution.capture.transitionId
          })
        }
        for (const [id] of carriedRemovals) {
          if (execution.capture.providerBoundSourceKeys.includes(`run/tool-call://${id}`))
            carriedRemovals.delete(id)
        }
        previousObservation = currentObservation
        previousExecution = execution
        finalOutcome = effectiveResponse.outcome
        if (effectiveResponse.outcome !== 'CONTINUE') break
        if (callOrdinal === maxCalls) {
          throw new C1PreflightFailure(
            'PREFLIGHT_FAILURE',
            `F1-32 leg reached maxCalls=${maxCalls} without a terminal outcome`
          )
        }
        observation = input.observationSource.next({
          callOrdinal,
          previousObservation,
          previousExecution,
          response: effectiveResponse,
          ...(toolObservation === undefined ? {} : { toolObservation })
        })
        previousWorkingSet = execution.workingSet
      }
      if (finalOutcome === undefined)
        throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'F1-32 leg produced no terminal outcome')
      this.options.budgetGuard.endLeg({
        wallClockMs: input.wallClockMs ?? Math.max(0, Date.now() - startedAtMs)
      })
      legEnded = true
      validateC1LiveBindingEvidence(evidence, {
        arm: input.arm,
        responseSource: input.responseSource.kind,
        providerConfigHash:
          this.options.providerConfigHashOverride ?? this.options.providerBinding.providerConfigHash
      })
      return {
        status: 'COMPLETED',
        evidence: Object.freeze(evidence),
        finalOutcome,
        providerCallPermits: evidence.length,
        toolCalls: evidence.reduce((sum, row) => sum + row.toolCalls, 0),
        transportSendAttempts,
        blockedProviderCallAttempts,
        budget: this.options.budgetGuard.ledger
      }
    } catch (error) {
      this.studyTerminalReason ??= 'F1-32 leg did not complete; study is terminal'
      this.tripStudyTerminal(error)
      throw error
    } finally {
      if (!legEnded) {
        if (this.studyTerminalReason !== null) {
          this.options.budgetGuard.abortLeg()
        } else {
          try {
            this.options.budgetGuard.endLeg({
              wallClockMs: input.wallClockMs ?? Math.max(0, Date.now() - startedAtMs)
            })
          } catch {
            // The original terminal failure remains authoritative.
          }
        }
      }
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

function pointLabel(feasibility: C1F0V2AdjudicationSummary): C1F1Native32PointLabel {
  if (!feasibility.validityGate.pass) return 'INVALID'
  if (!feasibility.precisionGate.pass) return 'INCONCLUSIVE'
  if (!feasibility.feasibilityGate.pass) return 'VALID_INFEASIBLE'
  return 'VALID_STABLE_FEASIBLE'
}

function fallbackContractView(): V2ContractView {
  return {
    contractId: 'C1_F1_NATIVE_FEASIBILITY_32',
    executionBinding: {
      providerConfigHash: C1_F1_NATIVE32_PROVIDER_CONFIG_HASH,
      codeRevision: C1_F1_NATIVE32_PENDING_BINDING,
      executionSurfaceHash: C1_F1_NATIVE32_PENDING_BINDING
    },
    design: {
      taskCount: 2,
      runsPerTask: 16,
      totalRuns: 32,
      runOrder: {
        pattern: ['c1-t1-localized-distractor-v1', 'c1-t2-multi-file-migration-v1'],
        repetitions: 16
      }
    },
    taskPanel: [
      {
        taskId: 'c1-t1-localized-distractor-v1',
        stratum: 'unknown',
        fixturePath: '',
        expectedWritablePaths: [],
        fixtureContentSha256: '',
        fixtureTreeObjectId: ''
      },
      {
        taskId: 'c1-t2-multi-file-migration-v1',
        stratum: 'unknown',
        fixturePath: '',
        expectedWritablePaths: [],
        fixtureContentSha256: '',
        fixtureTreeObjectId: ''
      }
    ],
    budgets: {
      perRun: { maxProviderRequests: 32, maxToolRequests: 96, maxWallClockMs: 600000 },
      study: {
        maxProviderRequests: 1024,
        maxToolRequests: 3072,
        maxWallClockMs: 19200000,
        maxRuns: 32
      }
    },
    gates: {
      precision: { maxUnknownRunRate: 0.125, minAdjudicableRunsPerTask: 14 },
      feasibility: {
        perTaskSuccessAmongAdjudicableLowerBound: 0.8,
        perTaskBudgetExhaustionUpperBound: 0.2,
        perTaskUnrecoveredToolFailureRunUpperBound: 0.2,
        perTaskOraclePassAmongAdjudicableLowerBound: 0.8
      }
    }
  }
}

async function writeF1Artifacts(input: {
  readonly reportDir: string
  readonly contract: V2ContractView
  readonly studyId: string
  readonly scenario: C1F1Native32FakeScenario
  readonly executionRevision: string
  readonly executionSurfaceHash: string
  readonly finalBoundRunContractSha256: string
  readonly surfaceWitness: Record<string, unknown>
  readonly finalBoundContract: C1F1Native32Contract
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
  const label = pointLabel(input.feasibility)
  const studyManifest = {
    runnerId: C1_F1_NATIVE32_RUNNER_ID,
    schemaVersion: C1_F1_NATIVE32_RUNNER_SCHEMA_VERSION,
    executionMode: C1_F1_NATIVE32_RUNNER_MODE,
    scenario: input.scenario,
    studyId: input.studyId,
    contractId: input.contract.contractId,
    freezeCandidateRunContractSha256: C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
    finalBoundRunContractSha256: input.finalBoundRunContractSha256,
    executionRevision: input.executionRevision,
    executionSurfaceHash: input.executionSurfaceHash,
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    providerConfigHash: input.contract.executionBinding.providerConfigHash,
    responseSource: 'SCRIPTED_FAKE',
    providerCalls: 0,
    networkRequests: 0,
    fallback: 'NONE',
    runtimeIntervention: 'DISABLED',
    taskPanel: input.contract.taskPanel.map((task) => ({
      taskId: task.taskId,
      stratum: task.stratum
    })),
    runsPlanned: input.contract.design.totalRuns,
    requiredArtifacts: C1_F0_V2_REQUIRED_ARTIFACTS
  }
  const runManifest = {
    studyId: input.studyId,
    status: label,
    runsPlanned: input.contract.design.totalRuns,
    runsStarted: input.runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
    runsCompleted: input.runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
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
  const documents: ReadonlyArray<readonly [string, string]> = [
    ['study-manifest.json', JSON.stringify(studyManifest, null, 2) + '\n'],
    ['run-manifest.json', JSON.stringify(runManifest, null, 2) + '\n'],
    ['checkpoint-summary.json', JSON.stringify(checkpointSummary, null, 2) + '\n'],
    ['response-ledger.jsonl', responseRows.map((row) => JSON.stringify(row) + '\n').join('')],
    [
      'feasibility-summary.json',
      JSON.stringify({ pointLabel: label, ...input.feasibility }, null, 2) + '\n'
    ],
    ['surface-witness.json', JSON.stringify(input.surfaceWitness, null, 2) + '\n'],
    [
      'execution-binding.json',
      JSON.stringify(
        {
          executionRevision: input.executionRevision,
          executionSurfaceHash: input.executionSurfaceHash,
          inventory: input.surfaceWitness['targetSurfacePaths'],
          targetInventoryDigest: input.surfaceWitness['targetInventoryDigest']
        },
        null,
        2
      ) + '\n'
    ],
    ['final-bound-contract.json', JSON.stringify(input.finalBoundContract, null, 2) + '\n']
  ]
  for (const [name, content] of documents) await writeDurable(join(input.reportDir, name), content)
  for (const name of [
    'checkpoints.jsonl',
    'tool-provenance.jsonl',
    'post-run-snapshot-manifest.jsonl',
    'task-adjudication.jsonl'
  ]) {
    await ensureFile(join(input.reportDir, name))
  }
  const required = []
  for (const name of C1_F0_V2_REQUIRED_ARTIFACTS)
    required.push(await artifactSummary(input.reportDir, name))
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
      'F1-32 artifact set contains forbidden raw payload'
    )
  }
  return Object.freeze(required)
}

export async function runC1F1Native32CredentialFreeStudy(
  options: C1F1Native32ExecutionRunnerOptions
): Promise<C1F1Native32ExecutionReport> {
  const repoRoot = options.repoRoot ?? process.cwd()
  const scenario = options.scenario ?? 'TOOL_RECOVERY'
  const studyId = options.studyId
  const failures: { code: string; message: string }[] = []
  const runs: C1F0V2RunRecord[] = []
  let candidate: C1F1Native32Contract | null = null
  let reportDir: string | null = null
  let binding: C1F1Native32ExecutionBinding | null = null
  let finalBoundContract: C1F1Native32Contract | null = null
  let surfaceWitness: Record<string, unknown> | null = null
  let checkpoints: readonly C1LiveBindingCheckpoint[] = []
  let responseCalls = 0
  let toolExecutions = 0
  let artifactList: readonly {
    readonly name: string
    readonly sha256: string
    readonly bytes: number
  }[] = []
  let sharedInvalidator = false
  const invalidatorReasons: string[] = []

  try {
    if (process.env['NODE_ENV'] !== 'test') {
      throw new C1PreflightFailure(
        'IDENTITY_INVALID',
        'F1-32 credential-free runner accepts only a test synthetic study identity'
      )
    }
    assertF1StudyId(studyId)
    if (!nodeVersionSatisfiesC1Range(process.versions.node)) {
      throw new C1PreflightFailure(
        'NODE_RANGE_MISMATCH',
        'Node ' + process.versions.node + ' is outside ' + C1_NODE_RANGE
      )
    }
    await assertC1LiveWorktreeClean(repoRoot)
    candidate = await loadC1F1Native32Contract(repoRoot, 'FREEZE_CANDIDATE')
    const view = asV2Contract(candidate)
    const execution = view.executionBinding
    if (
      execution.codeRevision !== C1_F1_NATIVE32_PENDING_BINDING ||
      execution.executionSurfaceHash !== C1_F1_NATIVE32_PENDING_BINDING
    ) {
      throw new C1PreflightFailure(
        'CONTRACT_BINDING_MISMATCH',
        'F1-32 candidate has a bound execution revision or surface hash'
      )
    }
    if (
      view.budgets.perRun.maxProviderRequests !== 32 ||
      view.budgets.study.maxProviderRequests !== 1024
    ) {
      throw new C1PreflightFailure(
        'BUDGET_BREACH',
        'F1-32 runner requires the frozen 32/1024 Provider budgets'
      )
    }
    binding = await computeC1F1Native32ExecutionBinding(repoRoot)
    const bound = buildFinalBoundF1Contract({ candidate, binding })
    finalBoundContract = bound.contract
    surfaceWitness = bound.surfaceWitness
    assertC1F1Native32SurfaceWitnessMatchesActualInventory(finalBoundContract, binding.inventory)
    const allPlans = buildC1F1Native32ExecutionPlans(candidate, studyId)
    if (
      options.testRunLimit !== undefined &&
      (!Number.isSafeInteger(options.testRunLimit) ||
        options.testRunLimit < 1 ||
        options.testRunLimit > allPlans.length)
    ) {
      throw new C1PreflightFailure(
        'IDENTITY_INVALID',
        'testRunLimit must be within the frozen 32-run plan'
      )
    }
    const plans =
      options.testRunLimit === undefined ? allPlans : allPlans.slice(0, options.testRunLimit)
    reportDir = await claimStudyDir(
      options.outputRoot ??
        join(repoRoot, 'research/context-benchmarks/.live-output/c1-f1-32-runner'),
      studyId
    )
    const providerBinding = await prepareC1StrictProvider({
      runIdentity: studyId,
      primaryProviderId: C1_PROVIDER_ID,
      requestedModelId: C1_MODEL_ID,
      allowFallback: false,
      env: { STEP_PLAN_API_KEY: F1_NATIVE32_CREDENTIAL_SENTINEL }
    })
    try {
      const frozenStudy = await loadC1FrozenStudy(repoRoot)
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
      for (const plan of plans) {
        if (sharedInvalidator) {
          runs.push(defaultV2RunRecord(plan as never, 'STUDY_INVALIDATED'))
          continue
        }
        const taskEntry = view.taskPanel.find((entry) => entry.taskId === plan.taskId)
        const task = frozenStudy.tasks.find((entry) => entry.taskId === plan.taskId)
        if (taskEntry === undefined || task === undefined) {
          const failure = {
            code: 'MANIFEST_BINDING_MISMATCH',
            message: 'missing F1-32 task ' + plan.taskId
          }
          failures.push(failure)
          sharedInvalidator = true
          invalidatorReasons.push(failure.message)
          runs.push(defaultV2RunRecord(plan as never, failure.code))
          continue
        }
        const legDir = await claimLegDir(reportDir, plan.runId)
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
        let terminationStatus: C1F0V2TerminationStatus = 'TERMINAL_FAILED'
        let resultEvidence: readonly C1LiveBindingEvidence[] = []
        let hardeningAdapter: C1F0V2HardeningToolAdapter | null = null
        try {
          const fixtureBinding = await verifyC1FixtureBinding(frozenStudy, task)
          fixture = await materializeFreshC1Fixture(fixtureBinding.sourcePath)
          const before = await computeC1FixtureContentSummary(fixture.path)
          beforeSnapshot = await snapshotC1Fixture(fixture.path)
          if (before.sha256 !== taskEntry.fixtureContentSha256) {
            throw new C1PreflightFailure(
              'FIXTURE_BINDING_MISMATCH',
              'F1-32 fixture hash mismatch for ' + plan.runId
            )
          }
          if (scenario === 'STUDY_INVALIDATOR' && plan.runOrdinal === 1) {
            throw new C1PreflightFailure(
              'EVIDENCE_WRITE_FAILURE',
              'credential-free F1-32 study invalidator test'
            )
          }
          if (scenario === 'SINGLE_RUN_FAILURE' && plan.runOrdinal === 1)
            throw new Error('credential-free F1-32 ordinary run failure test')
          const responseSource = new C1F1Native32ScriptedResponseSource(
            plan.runId,
            scenario === 'UNKNOWN_SNAPSHOT' ? 'COMPLETE' : scenario
          )
          const observationSource = await C1LiveTaskObservationSource.fromFixture({
            task,
            runId: plan.runId,
            fixtureRoot: fixture.path
          })
          hardeningAdapter = new C1F0V2HardeningToolAdapter({
            sandboxRoot: fixture.path,
            studyId,
            runId: plan.runId,
            provenancePath
          })
          const driver = new C1F1Native32BindingDriver({
            providerBinding,
            budgetGuard,
            evidenceSink: checkpointSink,
            providerConfigHashOverride: view.executionBinding.providerConfigHash
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
            runtimeSessionId: studyId + ':' + plan.runId,
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
          if (isSharedInvalidator(failure.code)) {
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
              unavailable: scenario === 'UNKNOWN_SNAPSHOT' && plan.runOrdinal === 1
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
          sharedInvalidator && failureCode !== undefined && isSharedInvalidator(failureCode)
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
          studyId,
          runOrdinal: plan.runOrdinal,
          runId: plan.runId,
          status: snapshot.status,
          snapshotId: snapshot.snapshotId,
          ...(snapshot.contentSha256 === undefined
            ? {}
            : { contentSha256: snapshot.contentSha256 }),
          ...(snapshot.fileCount === undefined ? {} : { fileCount: snapshot.fileCount }),
          changedPathsStatus: afterSnapshot === null ? 'UNKNOWN' : 'OBSERVED',
          changedPaths
        })
        await appendDurable(adjudicationPath, {
          adjudicationPhase: 'PRE_CLEANUP_ADJUDICATION',
          studyId,
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
        const runRecord: C1F0V2RunRecord = {
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
          diagnostics: {
            responseCalls: responseCount,
            toolRequestCount: resultEvidence.reduce((sum, row) => sum + row.toolCalls, 0),
            toolExecutionCount: toolEvents.length,
            toolErrorCount: hardeningSummary.failedExecutions,
            recoveredToolErrorCount: hardeningSummary.recoveredExecutions,
            blockedRepeatedFailures: hardeningSummary.blockedRepeatedFailures,
            unrecoveredToolFailure:
              hardeningSummary.failedExecutions > hardeningSummary.recoveredExecutions,
            checkpointJoinComplete: joinComplete
          },
          ...(finalRunDisposition === 'FEASIBILITY_UNKNOWN'
            ? {
                unknownReason: [
                  snapshot.status === 'UNAVAILABLE' ? 'POST_RUN_SNAPSHOT_UNAVAILABLE' : null,
                  evidenceStatus === 'PARTIAL' ? 'EVIDENCE_PARTIAL' : null,
                  provenanceStatus === 'PARTIAL' ? 'PROVENANCE_PARTIAL' : null,
                  currentOracleStatus === 'NOT_ADJUDICABLE' || currentOracleStatus === 'UNKNOWN'
                    ? 'ORACLE_UNAVAILABLE'
                    : null,
                  sideEffectAttributionStatus === 'UNKNOWN'
                    ? 'SIDE_EFFECT_ATTRIBUTION_UNKNOWN'
                    : null
                ]
                  .filter((value): value is string => value !== null)
                  .join(',')
              }
            : {}),
          ...(failureCode === undefined ? {} : { failureCode })
        }
        runs.push(runRecord)
        await writeDurable(
          join(legDir, 'leg-manifest.json'),
          JSON.stringify(
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
              diagnostics: runRecord.diagnostics,
              ...(failureCode === undefined ? {} : { failureCode })
            },
            null,
            2
          ) + '\n'
        )
        responseCalls += responseCount
        toolExecutions += toolEvents.length
      }
      checkpoints = checkpointSink.checkpoints
      const feasibility = adjudicateV2Study({
        contract: view,
        runs,
        sharedInvalidator,
        invalidatorReasons
      })
      if (
        reportDir !== null &&
        binding !== null &&
        finalBoundContract !== null &&
        surfaceWitness !== null
      ) {
        artifactList = await writeF1Artifacts({
          reportDir,
          contract: view,
          studyId,
          scenario,
          executionRevision: binding.executionRevision,
          executionSurfaceHash: binding.executionSurfaceHash,
          finalBoundRunContractSha256: finalBoundContract.runContractSha256,
          surfaceWitness,
          finalBoundContract,
          runs,
          checkpoints,
          feasibility,
          failures
        })
      }
      const label = pointLabel(feasibility)
      return {
        runnerId: C1_F1_NATIVE32_RUNNER_ID,
        schemaVersion: C1_F1_NATIVE32_RUNNER_SCHEMA_VERSION,
        executionMode: C1_F1_NATIVE32_RUNNER_MODE,
        scenario,
        status: label,
        studyId,
        reportDir,
        executionRevision: binding?.executionRevision ?? null,
        executionSurfaceHash: binding?.executionSurfaceHash ?? null,
        freezeCandidateRunContractSha256: C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
        finalBoundRunContractSha256: finalBoundContract?.runContractSha256 ?? null,
        providerConfigHash: view.executionBinding.providerConfigHash,
        provider: C1_PROVIDER_ID,
        model: C1_MODEL_ID,
        endpoint: C1_PROVIDER_ENDPOINT,
        nodeRange: C1_NODE_RANGE,
        responseSource: 'SCRIPTED_FAKE',
        providerCalls: 0,
        networkRequests: 0,
        responseCalls,
        toolExecutions,
        runsPlanned: 32,
        runsStarted: runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
        runsCompleted: runs.filter((run) => run.terminationStatus !== 'BLOCKED').length,
        blockedRuns: runs.filter((run) => run.terminationStatus === 'BLOCKED').length,
        studyTerminal: sharedInvalidator,
        terminalReason: sharedInvalidator
          ? 'shared study invalidator stopped remaining runs'
          : null,
        pointLabel: label,
        surfaceWitness,
        artifacts: artifactList,
        runs: Object.freeze(runs),
        feasibility,
        failures: Object.freeze(failures)
      }
    } finally {
      providerBinding.dispose()
    }
  } catch (error) {
    const failure = failureOf(error)
    failures.push(failure)
    const feasibility = adjudicateV2Study({
      contract: candidate === null ? fallbackContractView() : asV2Contract(candidate),
      runs,
      sharedInvalidator: true,
      invalidatorReasons: [failure.message]
    })
    return {
      runnerId: C1_F1_NATIVE32_RUNNER_ID,
      schemaVersion: C1_F1_NATIVE32_RUNNER_SCHEMA_VERSION,
      executionMode: C1_F1_NATIVE32_RUNNER_MODE,
      scenario,
      status: 'NO_GO',
      studyId,
      reportDir,
      executionRevision: binding?.executionRevision ?? null,
      executionSurfaceHash: binding?.executionSurfaceHash ?? null,
      freezeCandidateRunContractSha256: C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
      finalBoundRunContractSha256: finalBoundContract?.runContractSha256 ?? null,
      providerConfigHash:
        candidate === null ? null : asV2Contract(candidate).executionBinding.providerConfigHash,
      provider: C1_PROVIDER_ID,
      model: C1_MODEL_ID,
      endpoint: C1_PROVIDER_ENDPOINT,
      nodeRange: C1_NODE_RANGE,
      responseSource: 'SCRIPTED_FAKE',
      providerCalls: 0,
      networkRequests: 0,
      responseCalls,
      toolExecutions,
      runsPlanned: 32,
      runsStarted: runs.length,
      runsCompleted: runs.length,
      blockedRuns: 0,
      studyTerminal: true,
      terminalReason: failure.message,
      pointLabel: 'INVALID',
      surfaceWitness,
      artifacts: artifactList,
      runs: Object.freeze(runs),
      feasibility,
      failures: Object.freeze(failures)
    }
  }
}
