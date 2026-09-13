import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRunKillSwitch } from '@canvas-agent/pi-context-integration/experimental'
import {
  C1HardBudgetGuard,
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
  type C1FrozenStudy,
  type C1PreflightTask,
  type C1StrictProviderBinding
} from '../../../../src/c1-live-preflight'
import {
  appendC1LiveResponseToObservation,
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingDriver,
  type C1LiveBindingCheckpoint,
  type C1LiveBindingEvidence,
  type C1LiveBindingEvidenceSink,
  type C1LiveModelResponse,
  type C1LiveResponseSource,
  type C1LiveToolExecution,
  type C1LiveToolExecutor
} from '../../../../src/c1-live-binding'
import {
  assertC1LiveWorktreeClean,
  C1LiveTaskObservationSource,
  runC1TaskOracles,
  type C1TaskEvaluation
} from '../../../../src/c1-live-study'
import { buildSanitizedChildEnvironment, runProcess } from '../../../../src/fixture-generator'
import {
  C1F0ProspectiveToolExecutor,
  type C1F0ToolExecution,
  type C1F0ToolRequest
} from '../../hardening/c1-f0-tool-hardening'
import {
  C1_F0_V2_CONTRACT_RELATIVE_PATH,
  C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
  C1_F0_V2_PENDING_BINDING,
  loadC1F0V2Contract,
  type C1F0V2Contract
} from '../../contract/c1-f0-v2-contract'

export const C1_F0_V2_RUNNER_ID = 'C1_F0_EXECUTION_FEASIBILITY_RUNNER_V2' as const
export const C1_F0_V2_RUNNER_SCHEMA_VERSION = 2 as const
export const C1_F0_V2_RUNNER_MODE = 'CREDENTIAL_FREE_NATIVE_ONLY' as const
export const C1_F0_V2_HARDENING_ID = 'C1_F0_TOOL_HARDENING_V1' as const
export const C1_F0_V2_EXECUTION_SURFACE_PATHS = Object.freeze([
  'research/context-benchmarks/c1/f0/v2',
  'research/context-benchmarks/c1/f0/hardening',
  'research/context-benchmarks/c1/f0/contract',
  'research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v2.json',
  'research/context-benchmarks/scripts/c1-f0-v2-execution-runner.ts',
  'research/context-benchmarks/src/c1-live-preflight.ts',
  'research/context-benchmarks/src/c1-live-binding.ts',
  'research/context-benchmarks/src/c1-live-study.ts',
  'research/context-benchmarks/src/fixture-generator.ts',
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

export type C1F0V2ExecutionStatus =
  'F0_V2_NO_GO' | 'F0_V2_HOLD' | 'F0_V2_FEASIBILITY_NO_GO' | 'GO_TO_T0_DESIGN'
export type C1F0V2TerminationStatus =
  | 'TERMINAL_COMPLETE'
  | 'TERMINAL_FAILED'
  | 'BUDGET_EXHAUSTED'
  | 'PROVIDER_BOUNDARY_FAILURE'
  | 'TOOL_BOUNDARY_FAILURE'
  | 'BLOCKED'
export type C1F0V2OracleStatus = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_ADJUDICABLE'
export type C1F0V2EvidenceStatus = 'COMPLETE' | 'PARTIAL' | 'INVALID'
export type C1F0V2ProvenanceStatus = 'COMPLETE' | 'PARTIAL' | 'INVALID'
export type C1F0V2RecoveryStatus = 'NONE' | 'RECOVERED' | 'UNRECOVERED' | 'BLOCKED'
export type C1F0V2SideEffectAttributionStatus =
  'NOT_APPLICABLE' | 'ATTRIBUTED' | 'UNKNOWN' | 'CONFLICT'
export type C1F0V2RunDisposition =
  'FEASIBILITY_SUCCESS' | 'FEASIBILITY_FAILURE' | 'FEASIBILITY_UNKNOWN' | 'STUDY_INVALID'
export type C1F0V2FakeScenario =
  | 'COMPLETE'
  | 'TOOL_RECOVERY'
  | 'TOOL_LOOP'
  | 'TOOL_SIDE_EFFECT'
  | 'BUDGET_EXHAUSTION'
  | 'UNKNOWN_SNAPSHOT'
  | 'SINGLE_RUN_FAILURE'
  | 'STUDY_INVALIDATOR'

interface V2TaskEntry {
  readonly taskId: string
  readonly stratum: string
  readonly fixturePath: string
  readonly expectedWritablePaths: readonly string[]
  readonly fixtureContentSha256: string
  readonly fixtureTreeObjectId: string
}

interface V2ContractView {
  readonly contractId: string
  readonly executionBinding: {
    readonly providerConfigHash: string
    readonly codeRevision: string
    readonly executionSurfaceHash: string
  }
  readonly design: {
    readonly taskCount: number
    readonly runsPerTask: number
    readonly totalRuns: number
    readonly runOrder: {
      readonly pattern: readonly string[]
      readonly repetitions: number
    }
  }
  readonly taskPanel: readonly V2TaskEntry[]
  readonly budgets: {
    readonly perRun: {
      readonly maxProviderRequests: number
      readonly maxToolRequests: number
      readonly maxWallClockMs: number
    }
    readonly study: {
      readonly maxProviderRequests: number
      readonly maxToolRequests: number
      readonly maxWallClockMs: number
      readonly maxRuns: number
    }
  }
  readonly gates: {
    readonly precision: {
      readonly maxUnknownRunRate: number
      readonly minAdjudicableRunsPerTask: number
    }
    readonly feasibility: {
      readonly perTaskSuccessAmongAdjudicableLowerBound: number
      readonly perTaskBudgetExhaustionUpperBound: number
      readonly perTaskUnrecoveredToolFailureRunUpperBound: number
      readonly perTaskOraclePassAmongAdjudicableLowerBound: number
    }
  }
}

export interface C1F0V2ExecutionPlan {
  readonly runOrdinal: number
  readonly repetition: number
  readonly taskOrdinal: 1 | 2
  readonly taskId: string
  readonly stratum: string
  readonly runId: string
  readonly pairId: string
}

export interface C1F0V2RunDiagnostics {
  readonly responseCalls: number
  readonly toolRequestCount: number
  readonly toolExecutionCount: number
  readonly toolErrorCount: number
  readonly recoveredToolErrorCount: number
  readonly blockedRepeatedFailures: number
  readonly unrecoveredToolFailure: boolean
  readonly checkpointJoinComplete: boolean
}

export interface C1F0V2RunRecord {
  readonly runOrdinal: number
  readonly repetition: number
  readonly taskOrdinal: 1 | 2
  readonly taskId: string
  readonly stratum: string
  readonly runId: string
  readonly pairId: string
  readonly terminationStatus: C1F0V2TerminationStatus
  readonly oracleStatus: C1F0V2OracleStatus
  readonly objectiveOracleStatus: C1F0V2OracleStatus
  readonly regressionOracleStatus: C1F0V2OracleStatus
  readonly evidenceStatus: C1F0V2EvidenceStatus
  readonly provenanceStatus: C1F0V2ProvenanceStatus
  readonly recoveryStatus: C1F0V2RecoveryStatus
  readonly sideEffectAttributionStatus: C1F0V2SideEffectAttributionStatus
  readonly runDisposition: C1F0V2RunDisposition
  readonly fixtureCleaned: boolean
  readonly postRunFixtureSnapshotStatus: 'FROZEN' | 'UNAVAILABLE'
  readonly postRunFixtureSnapshotHash?: string
  readonly changedPaths: readonly string[]
  readonly writableScopeStatus: 'PASS' | 'FAIL' | 'UNKNOWN'
  readonly diagnostics: C1F0V2RunDiagnostics
  readonly unknownReason?: string
  readonly failureCode?: string
}

export interface C1F0V2TaskSummary {
  readonly taskId: string
  readonly stratum: string
  readonly startedRuns: number
  readonly plannedRuns: number
  readonly adjudicableRuns: number
  readonly unknownRuns: number
  readonly feasibilitySuccesses: number
  readonly feasibilityFailures: number
  readonly terminalCompleteRuns: number
  readonly budgetExhaustionRuns: number
  readonly unrecoveredToolFailureRuns: number
  readonly oraclePassesAmongAdjudicable: number
  readonly rates: {
    readonly successAmongAdjudicable: number
    readonly startedRunSuccess: number
    readonly unknown: number
    readonly budgetExhaustion: number
    readonly unrecoveredToolFailure: number
    readonly oraclePassAmongAdjudicable: number
  }
  readonly intervals95: {
    readonly successAmongAdjudicableLower: number
    readonly budgetExhaustionUpper: number
    readonly unrecoveredToolFailureUpper: number
    readonly oraclePassAmongAdjudicableLower: number
  }
  readonly gates: {
    readonly unknownRate: boolean
    readonly minimumAdjudicable: boolean
    readonly successAmongAdjudicable: boolean
    readonly budgetExhaustion: boolean
    readonly unrecoveredToolFailure: boolean
    readonly oraclePassAmongAdjudicable: boolean
    readonly pass: boolean
  }
}

export interface C1F0V2AdjudicationSummary {
  readonly status: C1F0V2ExecutionStatus
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
    readonly unknownRunRate: Readonly<Record<string, number>>
    readonly adjudicableRunsPerTask: Readonly<Record<string, number>>
    readonly reasons: readonly string[]
  }
  readonly feasibilityGate: {
    readonly pass: boolean
    readonly tasks: readonly C1F0V2TaskSummary[]
  }
  readonly taskSummaries: readonly C1F0V2TaskSummary[]
}

export interface C1F0V2ExecutionReport {
  readonly runnerId: typeof C1_F0_V2_RUNNER_ID
  readonly schemaVersion: typeof C1_F0_V2_RUNNER_SCHEMA_VERSION
  readonly executionMode: typeof C1_F0_V2_RUNNER_MODE
  readonly scenario: C1F0V2FakeScenario
  readonly status: C1F0V2ExecutionStatus
  readonly studyId: string
  readonly reportDir: string | null
  readonly executionRevision: string | null
  readonly executionSurfaceHash: string | null
  readonly freezeCandidateRunContractSha256:
    typeof C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256 | null
  readonly finalBoundRunContractSha256: null
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
  readonly artifacts: readonly {
    readonly name: string
    readonly sha256: string
    readonly bytes: number
  }[]
  readonly runs: readonly C1F0V2RunRecord[]
  readonly feasibility: C1F0V2AdjudicationSummary
  readonly failures: readonly { readonly code: string; readonly message: string }[]
}

export interface C1F0V2ExecutionRunnerOptions {
  readonly repoRoot?: string
  readonly outputRoot?: string
  readonly studyId?: string
  readonly now?: Date
  readonly scenario?: C1F0V2FakeScenario
  readonly unknownSnapshotRunOrdinals?: readonly number[]
  /** Test-only limit for targeted failure-path checks; production runs remain 32-run. */
  readonly testRunLimit?: number
  readonly responseSourceFactory?: (input: {
    readonly runId: string
    readonly taskId: string
    readonly fixtureRoot: string
    readonly providerBinding: C1StrictProviderBinding
  }) => C1LiveResponseSource | Promise<C1LiveResponseSource>
}

const F0_V2_STUDY_ID_PATTERN = /^c1-f0-v2-\d{8}-[0-9a-f]{8}$/
const F0_V2_RUN_ID_PREFIX_PATTERN = /^(c1-f0-v2-\d{8})-[0-9a-f]{8}$/
const F0_V2_CREDENTIAL_SENTINEL = 'c1-f0-v2-credential-free-in-memory-sentinel'
const F0_V2_REQUIRED_ARTIFACTS = Object.freeze([
  'study-manifest.json',
  'run-manifest.json',
  'checkpoints.jsonl',
  'checkpoint-summary.json',
  'response-ledger.jsonl',
  'tool-provenance.jsonl',
  'post-run-snapshot-manifest.jsonl',
  'task-adjudication.jsonl',
  'feasibility-summary.json'
] as const)

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function asV2Contract(contract: C1F0V2Contract): V2ContractView {
  return contract as unknown as V2ContractView
}

function assertStudyId(studyId: string): void {
  if (!F0_V2_STUDY_ID_PATTERN.test(studyId)) {
    throw new C1PreflightFailure('IDENTITY_INVALID', 'invalid F0-v2 credential-free study identity')
  }
}

function studyRunPrefix(studyId: string): string {
  const match = F0_V2_RUN_ID_PREFIX_PATTERN.exec(studyId)
  if (match?.[1] === undefined) {
    throw new C1PreflightFailure('IDENTITY_INVALID', 'invalid F0-v2 study identity prefix')
  }
  return match[1]
}

function runIdFor(studyId: string, runOrdinal: number): string {
  const prefix = studyRunPrefix(studyId)
  return (
    prefix +
    '-run-' +
    String(runOrdinal).padStart(2, '0') +
    '-' +
    sha256(studyId + '\u0000' + String(runOrdinal)).slice(0, 8)
  )
}

function pairIdFor(studyId: string, taskId: string, repetition: number): string {
  return studyRunPrefix(studyId) + '-pair-' + taskId + '-' + String(repetition).padStart(2, '0')
}

function createStudyId(now: Date): string {
  const stamp = now.toISOString().slice(0, 10).replaceAll('-', '')
  return 'c1-f0-v2-' + stamp + '-' + sha256(now.toISOString()).slice(0, 8)
}

export function buildC1F0V2ExecutionPlans(
  contract: C1F0V2Contract,
  studyId: string
): readonly C1F0V2ExecutionPlan[] {
  assertStudyId(studyId)
  const view = asV2Contract(contract)
  const plans: C1F0V2ExecutionPlan[] = []
  let runOrdinal = 0
  for (let repetition = 1; repetition <= view.design.runOrder.repetitions; repetition += 1) {
    for (const [index, taskId] of view.design.runOrder.pattern.entries()) {
      const task = view.taskPanel.find((candidate) => candidate.taskId === taskId)
      if (task === undefined) {
        throw new C1PreflightFailure(
          'MANIFEST_BINDING_MISMATCH',
          'F0-v2 run order references an unknown task'
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
      'F0-v2 plan shape does not match frozen contract'
    )
  }
  return Object.freeze(plans)
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

function bashRequest(runId: string, ordinal: number, command: string): C1F0ToolRequest {
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
  toolRequests: readonly C1F0ToolRequest[] = []
): C1LiveModelResponse {
  return {
    responseId: runId + '-response-' + String(ordinal).padStart(2, '0'),
    assistantMessageCount: 1,
    assistantContent: 'credential-free F0-v2 scripted response',
    usage: fakeUsage(20, 3),
    toolRequests,
    toolExecutions: [],
    outcome
  }
}

class C1F0V2ScriptedResponseSource implements C1LiveResponseSource {
  readonly kind = 'SCRIPTED_FAKE' as const
  private cursor = 0

  constructor(
    private readonly runId: string,
    private readonly scenario: C1F0V2FakeScenario
  ) {}

  async next(request: {
    readonly capture: { readonly providerConfigHash: string }
  }): Promise<C1LiveModelResponse> {
    if (
      request.capture.providerConfigHash !==
      'bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a'
    ) {
      throw new C1PreflightFailure(
        'PROVIDER_BINDING_MISMATCH',
        'F0-v2 fake source received a hash mismatch'
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

class C1F0V2JsonlSink {
  private readonly path: string

  constructor(path: string) {
    this.path = path
  }

  async append(value: unknown): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const handle = await open(this.path, 'a')
    try {
      await handle.write(JSON.stringify(value) + '\n')
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}

interface C1F0V2ProvenanceSummary {
  readonly toolExecutions: number
  readonly failedExecutions: number
  readonly recoveredExecutions: number
  readonly blockedRepeatedFailures: number
  readonly uniqueFailureSignatures: number
}

class C1F0V2HardeningToolAdapter implements C1LiveToolExecutor {
  private readonly hardening: C1F0ProspectiveToolExecutor
  private readonly provenanceSink: C1F0V2JsonlSink
  private readonly studyId: string
  private readonly runId: string
  private readonly allExecutions: C1F0ToolExecution[] = []
  private failedExecutions = 0
  private recoveredExecutions = 0
  private blockedRepeatedFailures = 0
  private readonly failureSignatures = new Set<string>()

  constructor(input: {
    readonly sandboxRoot: string
    readonly studyId: string
    readonly runId: string
    readonly provenancePath: string
  }) {
    this.hardening = new C1F0ProspectiveToolExecutor(input.sandboxRoot, {
      provenanceEnabled: true,
      recoveryPolicy: {
        enabled: true,
        maxIdenticalFailureAttempts: 2
      }
    })
    this.provenanceSink = new C1F0V2JsonlSink(input.provenancePath)
    this.studyId = input.studyId
    this.runId = input.runId
  }

  async execute(input: {
    readonly previousObservation: C1AgentObservation
    readonly response: C1LiveModelResponse
    readonly observationId: string
    readonly onToolExecution?: (execution: C1LiveToolExecution) => Promise<void>
  }) {
    const hardeningResult = await this.hardening.execute(
      input.response.toolRequests.map((request) => ({
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        argumentsJson: request.argumentsJson
      }))
    )
    const liveExecutions: C1LiveToolExecution[] = []
    for (const execution of hardeningResult.executions) {
      this.allExecutions.push(execution)
      this.failedExecutions += execution.result === 'ERROR' ? 1 : 0
      this.recoveredExecutions +=
        execution.result === 'SUCCESS' && execution.provenance.recoveryOfToolCallId !== undefined
          ? 1
          : 0
      this.blockedRepeatedFailures +=
        execution.provenance.failureClass === 'REPEATED_FAILURE_BLOCKED' ? 1 : 0
      if (execution.result === 'ERROR') {
        this.failureSignatures.add(execution.provenance.canonicalRequestSignature)
      }
      const liveExecution: C1LiveToolExecution = {
        toolCallId: execution.toolCallId,
        toolName: execution.toolName,
        ...(execution.path === undefined ? {} : { path: execution.path }),
        result: execution.result
      }
      liveExecutions.push(liveExecution)
      await this.provenanceSink.append({
        studyId: this.studyId,
        runId: this.runId,
        ordinal: this.allExecutions.length,
        toolCallId: execution.toolCallId,
        toolName: execution.toolName,
        ...(execution.path === undefined ? {} : { path: execution.path }),
        result: execution.result,
        provenance: execution.provenance
      })
      await input.onToolExecution?.(liveExecution)
    }
    const responseWithExecutions: C1LiveModelResponse = {
      ...input.response,
      toolExecutions: Object.freeze(liveExecutions)
    }
    return {
      executions: Object.freeze(liveExecutions),
      observation: appendC1LiveResponseToObservation(
        input.previousObservation,
        responseWithExecutions,
        input.observationId,
        hardeningResult.resultContents
      )
    }
  }

  get summary(): C1F0V2ProvenanceSummary {
    return {
      toolExecutions: this.allExecutions.length,
      failedExecutions: this.failedExecutions,
      recoveredExecutions: this.recoveredExecutions,
      blockedRepeatedFailures: this.blockedRepeatedFailures,
      uniqueFailureSignatures: this.failureSignatures.size
    }
  }

  get executions(): readonly C1F0ToolExecution[] {
    return [...this.allExecutions]
  }
}

class C1F0V2CheckpointSink implements C1LiveBindingEvidenceSink {
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
  if (error instanceof C1PreflightFailure) {
    return { code: error.code, message: error.message }
  }
  return {
    code: 'RUN_FAILURE',
    message: error instanceof Error ? error.message : String(error)
  }
}

function classifyTermination(error: unknown): C1F0V2TerminationStatus {
  if (error instanceof C1PreflightFailure) {
    if (error.code === 'BUDGET_BREACH' || error.message.includes('maxCalls')) {
      return 'BUDGET_EXHAUSTED'
    }
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

function combineOracleStatus(
  objective: C1F0V2OracleStatus,
  regression: C1F0V2OracleStatus
): C1F0V2OracleStatus {
  if (objective === 'UNKNOWN' || regression === 'UNKNOWN') return 'UNKNOWN'
  if (objective === 'NOT_ADJUDICABLE' || regression === 'NOT_ADJUDICABLE') {
    return 'NOT_ADJUDICABLE'
  }
  return objective === 'PASS' && regression === 'PASS' ? 'PASS' : 'FAIL'
}

function oracleStatus(evaluation: C1TaskEvaluation | undefined): C1F0V2OracleStatus {
  if (evaluation === undefined) return 'NOT_ADJUDICABLE'
  if (evaluation.status === 'HARNESS_CONTRACT_FAILURE') return 'UNKNOWN'
  return evaluation.status === 'PASS' ? 'PASS' : 'FAIL'
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
    assistantMessages: row.assistantMessages,
    usage: {
      usageSource: row.usage.usageSource,
      inputTokens: row.usage.inputTokens,
      outputTokens: row.usage.outputTokens,
      cacheReadTokens: row.usage.cacheReadTokens,
      cacheWriteTokens: row.usage.cacheWriteTokens,
      totalTokens: row.usage.totalTokens
    },
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

async function artifactSummary(
  reportDir: string,
  name: string
): Promise<{ readonly name: string; readonly sha256: string; readonly bytes: number }> {
  const bytes = await readFile(join(reportDir, name))
  return { name, sha256: sha256Bytes(bytes), bytes: bytes.byteLength }
}

async function claimStudyDir(outputRoot: string, studyId: string): Promise<string> {
  const reportDir = join(outputRoot, studyId)
  await mkdir(outputRoot, { recursive: true })
  try {
    await mkdir(reportDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new C1PreflightFailure('IDENTITY_REUSE', 'F0-v2 study identity already exists')
    }
    throw error
  }
  return reportDir
}

async function claimLegDir(reportDir: string, runId: string): Promise<string> {
  const legDir = join(reportDir, 'legs', runId)
  await mkdir(legDir, { recursive: true })
  return legDir
}

interface C1F0V2FrozenPostRunSnapshot {
  readonly snapshotId: string
  readonly status: 'FROZEN' | 'UNAVAILABLE'
  readonly contentSha256?: string
  readonly fileCount?: number
  readonly path?: string
  readonly cleanup: () => Promise<void>
}

async function freezePostRunSnapshot(input: {
  readonly fixtureRoot: string
  readonly snapshotId: string
  readonly unavailable: boolean
}): Promise<C1F0V2FrozenPostRunSnapshot> {
  if (input.unavailable) {
    return {
      snapshotId: input.snapshotId,
      status: 'UNAVAILABLE',
      cleanup: async () => undefined
    }
  }
  const path = await mkdtemp(join(tmpdir(), 'canvas-c1-f0-v2-snapshot-'))
  try {
    await cp(input.fixtureRoot, path, { recursive: true, force: true })
    const summary = await computeC1FixtureContentSummary(path)
    return {
      snapshotId: input.snapshotId,
      status: 'FROZEN',
      contentSha256: summary.sha256,
      fileCount: summary.fileCount,
      path,
      cleanup: async () => rm(path, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(path, { recursive: true, force: true })
    throw error
  }
}

function recoveryStatus(summary: C1F0V2ProvenanceSummary): C1F0V2RecoveryStatus {
  if (summary.blockedRepeatedFailures > 0) return 'BLOCKED'
  if (summary.recoveredExecutions > 0) return 'RECOVERED'
  if (summary.failedExecutions > 0) return 'UNRECOVERED'
  return 'NONE'
}

function deriveSideEffectAttributionStatus(input: {
  readonly changedPaths: readonly string[]
  readonly snapshotStatus: 'FROZEN' | 'UNAVAILABLE'
  readonly provenanceStatus: C1F0V2ProvenanceStatus
  readonly executions: readonly C1F0ToolExecution[]
}): C1F0V2SideEffectAttributionStatus {
  if (input.changedPaths.length === 0) return 'NOT_APPLICABLE'
  if (input.snapshotStatus !== 'FROZEN' || input.provenanceStatus !== 'COMPLETE') {
    return 'UNKNOWN'
  }
  const attributedPaths = new Set(
    input.executions.flatMap((execution) => execution.provenance.changedPaths)
  )
  return input.changedPaths.every((path) => attributedPaths.has(path)) ? 'ATTRIBUTED' : 'UNKNOWN'
}

function taskDisposition(input: {
  readonly terminationStatus: C1F0V2TerminationStatus
  readonly oracleStatus: C1F0V2OracleStatus
  readonly evidenceStatus: C1F0V2EvidenceStatus
  readonly provenanceStatus: C1F0V2ProvenanceStatus
  readonly sideEffectAttributionStatus: C1F0V2SideEffectAttributionStatus
  readonly writableScopeStatus: 'PASS' | 'FAIL' | 'UNKNOWN'
  readonly fixtureCleaned: boolean
  readonly snapshotStatus: 'FROZEN' | 'UNAVAILABLE'
  readonly sharedInvalidator: boolean
}): C1F0V2RunDisposition {
  if (input.sharedInvalidator) return 'STUDY_INVALID'
  if (
    input.oracleStatus === 'UNKNOWN' ||
    input.oracleStatus === 'NOT_ADJUDICABLE' ||
    input.evidenceStatus === 'PARTIAL' ||
    input.provenanceStatus === 'PARTIAL' ||
    input.sideEffectAttributionStatus === 'UNKNOWN' ||
    input.snapshotStatus === 'UNAVAILABLE'
  ) {
    return 'FEASIBILITY_UNKNOWN'
  }
  if (
    input.terminationStatus === 'TERMINAL_COMPLETE' &&
    input.oracleStatus === 'PASS' &&
    input.evidenceStatus === 'COMPLETE' &&
    input.provenanceStatus === 'COMPLETE' &&
    input.writableScopeStatus === 'PASS' &&
    input.fixtureCleaned
  ) {
    return 'FEASIBILITY_SUCCESS'
  }
  return 'FEASIBILITY_FAILURE'
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
    12.507343278686905, -0.13857109526572012, 9.984369578019571e-6, 1.5056327351493116e-7
  ]
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value)
  }
  let x = 0.9999999999998099
  const shifted = value - 1
  for (const [index, coefficient] of coefficients.entries()) {
    x += coefficient / (shifted + index + 1)
  }
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

function clopperPearsonLower(successes: number, trials: number, alpha = 0.05): number {
  if (trials <= 0 || successes <= 0) return 0
  return betaQuantile(alpha, successes, trials - successes + 1)
}

function clopperPearsonUpper(failures: number, trials: number, alpha = 0.05): number {
  if (trials <= 0 || failures <= 0) {
    return trials <= 0 ? 0 : betaQuantile(1 - alpha, 1, trials)
  }
  if (failures >= trials) return 1
  return betaQuantile(1 - alpha, failures + 1, trials - failures)
}

function taskSummary(
  taskId: string,
  stratum: string,
  runs: readonly C1F0V2RunRecord[],
  contract: V2ContractView
): C1F0V2TaskSummary {
  const started = runs.filter((run) => run.taskId === taskId && run.terminationStatus !== 'BLOCKED')
  const successes = started.filter((run) => run.runDisposition === 'FEASIBILITY_SUCCESS').length
  const failures = started.filter((run) => run.runDisposition === 'FEASIBILITY_FAILURE').length
  const unknownRuns = started.filter((run) => run.runDisposition === 'FEASIBILITY_UNKNOWN').length
  const adjudicableRuns = successes + failures
  const terminalCompleteRuns = started.filter(
    (run) => run.terminationStatus === 'TERMINAL_COMPLETE'
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
  const successTrials = adjudicableRuns
  const startedTrials = started.length
  const intervals95 = {
    successAmongAdjudicableLower: clopperPearsonLower(successes, successTrials),
    budgetExhaustionUpper: clopperPearsonUpper(budgetExhaustionRuns, startedTrials),
    unrecoveredToolFailureUpper: clopperPearsonUpper(unrecoveredToolFailureRuns, startedTrials),
    oraclePassAmongAdjudicableLower: clopperPearsonLower(
      oraclePassesAmongAdjudicable,
      oracleAdjudicableRuns
    )
  }
  const limits = contract.gates.feasibility
  const precision = contract.gates.precision
  const gates = {
    unknownRate: startedTrials > 0 && unknownRuns / startedTrials <= precision.maxUnknownRunRate,
    minimumAdjudicable: adjudicableRuns >= precision.minAdjudicableRunsPerTask,
    successAmongAdjudicable:
      adjudicableRuns >= precision.minAdjudicableRunsPerTask &&
      intervals95.successAmongAdjudicableLower >= limits.perTaskSuccessAmongAdjudicableLowerBound,
    budgetExhaustion:
      startedTrials > 0 &&
      intervals95.budgetExhaustionUpper <= limits.perTaskBudgetExhaustionUpperBound,
    unrecoveredToolFailure:
      startedTrials > 0 &&
      intervals95.unrecoveredToolFailureUpper <= limits.perTaskUnrecoveredToolFailureRunUpperBound,
    oraclePassAmongAdjudicable:
      oracleAdjudicableRuns >= precision.minAdjudicableRunsPerTask &&
      intervals95.oraclePassAmongAdjudicableLower >=
        limits.perTaskOraclePassAmongAdjudicableLowerBound,
    pass: false
  }
  gates.pass =
    gates.unknownRate &&
    gates.minimumAdjudicable &&
    gates.successAmongAdjudicable &&
    gates.budgetExhaustion &&
    gates.unrecoveredToolFailure &&
    gates.oraclePassAmongAdjudicable
  return {
    taskId,
    stratum,
    startedRuns: started.length,
    plannedRuns: contract.design.runsPerTask,
    adjudicableRuns,
    unknownRuns,
    feasibilitySuccesses: successes,
    feasibilityFailures: failures,
    terminalCompleteRuns,
    budgetExhaustionRuns,
    unrecoveredToolFailureRuns,
    oraclePassesAmongAdjudicable,
    rates: {
      successAmongAdjudicable: successTrials === 0 ? 0 : successes / successTrials,
      startedRunSuccess: startedTrials === 0 ? 0 : successes / startedTrials,
      unknown: startedTrials === 0 ? 0 : unknownRuns / startedTrials,
      budgetExhaustion: startedTrials === 0 ? 0 : budgetExhaustionRuns / startedTrials,
      unrecoveredToolFailure: startedTrials === 0 ? 0 : unrecoveredToolFailureRuns / startedTrials,
      oraclePassAmongAdjudicable:
        oracleAdjudicableRuns === 0 ? 0 : oraclePassesAmongAdjudicable / oracleAdjudicableRuns
    },
    intervals95,
    gates
  }
}

function adjudicateV2Study(input: {
  readonly contract: V2ContractView
  readonly runs: readonly C1F0V2RunRecord[]
  readonly sharedInvalidator: boolean
  readonly invalidatorReasons: readonly string[]
}): C1F0V2AdjudicationSummary {
  const taskSummaries = input.contract.taskPanel.map((task) =>
    taskSummary(task.taskId, task.stratum, input.runs, input.contract)
  )
  const started = input.runs.filter((run) => run.terminationStatus !== 'BLOCKED')
  const uniqueRunIds = new Set(input.runs.map((run) => run.runId)).size === input.runs.length
  const startedRunsPerTask = Object.fromEntries(
    taskSummaries.map((summary) => [summary.taskId, summary.startedRuns])
  )
  const unknownRunRate = Object.fromEntries(
    taskSummaries.map((summary) => [summary.taskId, summary.rates.unknown])
  )
  const adjudicableRunsPerTask = Object.fromEntries(
    taskSummaries.map((summary) => [summary.taskId, summary.adjudicableRuns])
  )
  const precisionReasons: string[] = []
  if (taskSummaries.some((summary) => summary.startedRuns !== input.contract.design.runsPerTask)) {
    precisionReasons.push('started run count does not match frozen per-task sample')
  }
  if (new Set(started.map((run) => run.taskId)).size !== input.contract.design.taskCount) {
    precisionReasons.push('task panel coverage is incomplete')
  }
  for (const summary of taskSummaries) {
    if (summary.rates.unknown > input.contract.gates.precision.maxUnknownRunRate) {
      precisionReasons.push(summary.taskId + ' exceeds max unknown run rate')
    }
    if (summary.adjudicableRuns < input.contract.gates.precision.minAdjudicableRunsPerTask) {
      precisionReasons.push(summary.taskId + ' has too few adjudicable runs')
    }
  }
  if (!uniqueRunIds) precisionReasons.push('run ids are not unique')
  const validityGate = {
    pass: !input.sharedInvalidator,
    sharedInvalidatorCount: input.sharedInvalidator ? 1 : 0,
    reasons: Object.freeze([...input.invalidatorReasons])
  }
  const precisionGate = {
    pass:
      precisionReasons.length === 0 &&
      startedRunsPerTask[input.contract.taskPanel[0]?.taskId ?? ''] ===
        input.contract.design.runsPerTask &&
      startedRunsPerTask[input.contract.taskPanel[1]?.taskId ?? ''] ===
        input.contract.design.runsPerTask,
    startedRunsPerTask,
    uniqueRunIds,
    taskPanelCoverage: new Set(started.map((run) => run.taskId)).size,
    unknownRunRate,
    adjudicableRunsPerTask,
    reasons: Object.freeze(precisionReasons)
  }
  const feasibilityGate = {
    pass: taskSummaries.every((summary) => summary.gates.pass),
    tasks: Object.freeze(taskSummaries)
  }
  const status: C1F0V2ExecutionStatus = !validityGate.pass
    ? 'F0_V2_NO_GO'
    : !precisionGate.pass
      ? 'F0_V2_HOLD'
      : feasibilityGate.pass
        ? 'GO_TO_T0_DESIGN'
        : 'F0_V2_FEASIBILITY_NO_GO'
  return {
    status,
    validityGate,
    precisionGate,
    feasibilityGate,
    taskSummaries: Object.freeze(taskSummaries)
  }
}

export async function computeC1F0V2ExecutionBinding(repoRoot: string): Promise<{
  readonly executionRevision: string
  readonly executionSurfaceHash: string
}> {
  const revisionResult = await runProcess('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    timeoutMs: 30_000,
    env: buildSanitizedChildEnvironment()
  })
  const revision = revisionResult.stdout.trim()
  if (
    revisionResult.exitCode !== 0 ||
    revisionResult.timedOut ||
    revisionResult.outputLimitExceeded ||
    !/^[a-f0-9]{40}$/.test(revision)
  ) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'unable to resolve F0-v2 execution revision'
    )
  }
  const filesResult = await runProcess(
    'git',
    ['ls-files', '-z', '--', ...C1_F0_V2_EXECUTION_SURFACE_PATHS],
    { cwd: repoRoot, timeoutMs: 30_000, env: buildSanitizedChildEnvironment() }
  )
  if (filesResult.exitCode !== 0 || filesResult.timedOut || filesResult.outputLimitExceeded) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'unable to enumerate F0-v2 execution surface'
    )
  }
  const files = filesResult.stdout.split('\0').filter(Boolean).sort()
  if (files.length === 0) {
    throw new C1PreflightFailure('CONTRACT_BINDING_MISMATCH', 'F0-v2 execution surface is empty')
  }
  const rows: string[] = []
  for (const file of files) {
    rows.push(sha256Bytes(await readFile(join(repoRoot, file))) + '  ' + file)
  }
  return {
    executionRevision: revision,
    executionSurfaceHash: sha256(rows.join('\n') + '\n')
  }
}

function defaultV2RunRecord(
  plan: C1F0V2ExecutionPlan,
  failureCode: string,
  disposition: C1F0V2RunDisposition = 'STUDY_INVALID'
): C1F0V2RunRecord {
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
    evidenceStatus: disposition === 'STUDY_INVALID' ? 'INVALID' : 'PARTIAL',
    provenanceStatus: disposition === 'STUDY_INVALID' ? 'INVALID' : 'PARTIAL',
    recoveryStatus: 'NONE',
    sideEffectAttributionStatus: 'UNKNOWN',
    runDisposition: disposition,
    fixtureCleaned: false,
    postRunFixtureSnapshotStatus: 'UNAVAILABLE',
    changedPaths: [],
    writableScopeStatus: 'UNKNOWN',
    diagnostics: {
      responseCalls: 0,
      toolRequestCount: 0,
      toolExecutionCount: 0,
      toolErrorCount: 0,
      recoveredToolErrorCount: 0,
      blockedRepeatedFailures: 0,
      unrecoveredToolFailure: false,
      checkpointJoinComplete: false
    },
    failureCode
  }
}

async function ensureFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  try {
    await open(path, 'a').then(async (handle) => {
      await handle.close()
    })
  } catch {
    await writeDurable(path, '')
  }
}

async function writeV2Artifacts(input: {
  readonly reportDir: string
  readonly contract: V2ContractView
  readonly studyId: string
  readonly scenario: C1F0V2FakeScenario
  readonly executionRevision: string | null
  readonly executionSurfaceHash: string | null
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
    runnerId: C1_F0_V2_RUNNER_ID,
    schemaVersion: C1_F0_V2_RUNNER_SCHEMA_VERSION,
    executionMode: C1_F0_V2_RUNNER_MODE,
    scenario: input.scenario,
    studyId: input.studyId,
    contractId: input.contract.contractId,
    freezeCandidateRunContractSha256: C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
    finalBoundRunContractSha256: null,
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
    requiredArtifacts: F0_V2_REQUIRED_ARTIFACTS
  }
  const runManifest = {
    studyId: input.studyId,
    status: input.feasibility.status,
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
    ['feasibility-summary.json', JSON.stringify(input.feasibility, null, 2) + '\n']
  ]
  for (const [name, content] of documents) {
    await writeDurable(join(input.reportDir, name), content)
  }
  for (const name of [
    'checkpoints.jsonl',
    'tool-provenance.jsonl',
    'post-run-snapshot-manifest.jsonl',
    'task-adjudication.jsonl'
  ]) {
    await ensureFile(join(input.reportDir, name))
  }
  const artifacts = []
  for (const name of F0_V2_REQUIRED_ARTIFACTS) {
    artifacts.push(await artifactSummary(input.reportDir, name))
  }
  const serialized = await Promise.all(
    F0_V2_REQUIRED_ARTIFACTS.map(async (name) => readFile(join(input.reportDir, name), 'utf8'))
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
      'F0-v2 artifact set contains forbidden raw payload'
    )
  }
  return Object.freeze(artifacts)
}

export async function runC1F0V2CredentialFreeStudy(
  options: C1F0V2ExecutionRunnerOptions = {}
): Promise<C1F0V2ExecutionReport> {
  const repoRoot = options.repoRoot ?? process.cwd()
  const scenario = options.scenario ?? 'TOOL_RECOVERY'
  const studyId = options.studyId ?? createStudyId(options.now ?? new Date())
  const failures: { code: string; message: string }[] = []
  const runs: C1F0V2RunRecord[] = []
  let contract: C1F0V2Contract | null = null
  let reportDir: string | null = null
  let executionRevision: string | null = null
  let executionSurfaceHash: string | null = null
  let providerBinding: C1StrictProviderBinding | null = null
  let checkpoints: readonly C1LiveBindingCheckpoint[] = []
  let responseCalls = 0
  let toolExecutions = 0
  let studyTerminal = false
  let terminalReason: string | null = null
  let artifactList: readonly {
    readonly name: string
    readonly sha256: string
    readonly bytes: number
  }[] = []
  let sharedInvalidator = false
  const invalidatorReasons: string[] = []

  try {
    assertStudyId(studyId)
    if (!nodeVersionSatisfiesC1Range(process.versions.node)) {
      throw new C1PreflightFailure(
        'NODE_RANGE_MISMATCH',
        'Node ' + process.versions.node + ' is outside ' + C1_NODE_RANGE
      )
    }
    await assertC1LiveWorktreeClean(repoRoot)
    contract = await loadC1F0V2Contract(repoRoot, 'FREEZE_CANDIDATE')
    const view = asV2Contract(contract)
    if (view.executionBinding.codeRevision !== C1_F0_V2_PENDING_BINDING) {
      throw new C1PreflightFailure(
        'CONTRACT_BINDING_MISMATCH',
        'F0-v2 candidate has a bound execution revision'
      )
    }
    if (view.executionBinding.executionSurfaceHash !== C1_F0_V2_PENDING_BINDING) {
      throw new C1PreflightFailure(
        'CONTRACT_BINDING_MISMATCH',
        'F0-v2 candidate has a bound execution surface hash'
      )
    }
    const binding = await computeC1F0V2ExecutionBinding(repoRoot)
    executionRevision = binding.executionRevision
    executionSurfaceHash = binding.executionSurfaceHash
    const allPlans = buildC1F0V2ExecutionPlans(contract, studyId)
    if (options.testRunLimit !== undefined) {
      if (
        process.env['NODE_ENV'] !== 'test' ||
        !Number.isSafeInteger(options.testRunLimit) ||
        options.testRunLimit < 1 ||
        options.testRunLimit > allPlans.length
      ) {
        throw new C1PreflightFailure(
          'IDENTITY_INVALID',
          'testRunLimit is restricted to Node test execution and the frozen plan range'
        )
      }
    }
    const plans =
      options.testRunLimit === undefined ? allPlans : allPlans.slice(0, options.testRunLimit)
    reportDir = await claimStudyDir(
      options.outputRoot ??
        join(repoRoot, 'research/context-benchmarks/.live-output/c1-f0-v2-runner'),
      studyId
    )
    providerBinding = await prepareC1StrictProvider({
      runIdentity: studyId,
      env: { STEP_PLAN_API_KEY: F0_V2_CREDENTIAL_SENTINEL }
    })
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
            'F0-v2 fixture hash mismatch for ' + plan.runId
          )
        }
        if (scenario === 'STUDY_INVALIDATOR' && plan.runOrdinal === 1) {
          throw new C1PreflightFailure(
            'EVIDENCE_WRITE_FAILURE',
            'credential-free study invalidator test'
          )
        }
        if (scenario === 'SINGLE_RUN_FAILURE' && plan.runOrdinal === 1) {
          throw new Error('credential-free ordinary run failure test')
        }
        const responseSource = options.responseSourceFactory
          ? await options.responseSourceFactory({
              runId: plan.runId,
              taskId: plan.taskId,
              fixtureRoot: fixture.path,
              providerBinding: providerBinding!
            })
          : new C1F0V2ScriptedResponseSource(
              plan.runId,
              scenario === 'UNKNOWN_SNAPSHOT' ? 'COMPLETE' : scenario
            )
        if (responseSource.kind !== 'SCRIPTED_FAKE') {
          throw new C1PreflightFailure(
            'PROVIDER_BINDING_MISMATCH',
            'F0-v2 credential-free runner accepts only SCRIPTED_FAKE'
          )
        }
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
        const driver = new C1LiveBindingDriver({
          providerBinding: providerBinding!,
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
          killSwitch: createRunKillSwitch(plan.runId, {
            now: () => new Date().toISOString()
          })
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
          const unavailable = scenario === 'UNKNOWN_SNAPSHOT' && plan.runOrdinal === 1
          snapshot = await freezePostRunSnapshot({
            fixtureRoot: fixture.path,
            snapshotId: plan.runId + '-post-run',
            unavailable
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
        evaluation = await runC1TaskOracles({
          task,
          fixtureRoot: snapshot.path
        }).catch(() => undefined)
      } else {
        writableScopeStatus = 'UNKNOWN'
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
      const hardeningSummary = hardeningAdapter?.summary ?? {
        toolExecutions: 0,
        failedExecutions: 0,
        recoveredExecutions: 0,
        blockedRepeatedFailures: 0,
        uniqueFailureSignatures: 0
      }
      const provenanceStatus: C1F0V2ProvenanceStatus =
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
      const evidenceStatus: C1F0V2EvidenceStatus =
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
      const runDisposition = taskDisposition({
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

      await appendDurable(snapshotManifestPath, {
        studyId,
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
        runDisposition,
        fixtureCleaned,
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
        ...(runDisposition === 'FEASIBILITY_UNKNOWN'
          ? {
              unknownReason: [
                snapshot.status === 'UNAVAILABLE' ? 'POST_RUN_SNAPSHOT_UNAVAILABLE' : null,
                evidenceStatus === 'PARTIAL' ? 'EVIDENCE_PARTIAL' : null,
                provenanceStatus === 'PARTIAL' ? 'PROVENANCE_PARTIAL' : null,
                currentOracleStatus === 'NOT_ADJUDICABLE' || currentOracleStatus === 'UNKNOWN'
                  ? 'ORACLE_UNAVAILABLE'
                  : null,
                sideEffectAttributionStatus === 'UNKNOWN' ? 'SIDE_EFFECT_ATTRIBUTION_UNKNOWN' : null
              ]
                .filter((value): value is string => value !== null)
                .join(',')
            }
          : {}),
        ...(failureCode === undefined ? {} : { failureCode })
      }
      runs.push(record)
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
            diagnostics: record.diagnostics,
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
    studyTerminal = sharedInvalidator
    terminalReason = sharedInvalidator ? 'shared study invalidator stopped remaining runs' : null
    if (reportDir !== null) {
      artifactList = await writeV2Artifacts({
        reportDir,
        contract: view,
        studyId,
        scenario,
        executionRevision,
        executionSurfaceHash,
        runs,
        checkpoints,
        feasibility,
        failures
      })
    }
    return {
      runnerId: C1_F0_V2_RUNNER_ID,
      schemaVersion: C1_F0_V2_RUNNER_SCHEMA_VERSION,
      executionMode: C1_F0_V2_RUNNER_MODE,
      scenario,
      status: feasibility.status,
      studyId,
      reportDir,
      executionRevision,
      executionSurfaceHash,
      freezeCandidateRunContractSha256: C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
      finalBoundRunContractSha256: null,
      providerConfigHash: contract?.['executionBinding']
        ? (contract['executionBinding'] as { providerConfigHash: string }).providerConfigHash
        : null,
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
      studyTerminal,
      terminalReason,
      artifacts: artifactList,
      runs: Object.freeze(runs),
      feasibility,
      failures: Object.freeze(failures)
    }
  } catch (error) {
    const failure = failureOf(error)
    failures.push(failure)
    if (isSharedInvalidator(failure.code)) {
      sharedInvalidator = true
      invalidatorReasons.push(failure.message)
    }
    return {
      runnerId: C1_F0_V2_RUNNER_ID,
      schemaVersion: C1_F0_V2_RUNNER_SCHEMA_VERSION,
      executionMode: C1_F0_V2_RUNNER_MODE,
      scenario,
      status: 'F0_V2_NO_GO',
      studyId,
      reportDir,
      executionRevision,
      executionSurfaceHash,
      freezeCandidateRunContractSha256: C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
      finalBoundRunContractSha256: null,
      providerConfigHash: contract?.['executionBinding']
        ? (contract['executionBinding'] as { providerConfigHash: string }).providerConfigHash
        : null,
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
      artifacts: artifactList,
      runs: Object.freeze(runs),
      feasibility: adjudicateV2Study({
        contract:
          contract === null
            ? ({
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
                    fixtureContentSha256: ''
                  },
                  {
                    taskId: 'c1-t2-multi-file-migration-v1',
                    stratum: 'unknown',
                    fixtureContentSha256: ''
                  }
                ],
                budgets: {
                  perRun: {
                    maxProviderRequests: 24,
                    maxToolRequests: 96,
                    maxWallClockMs: 600000
                  },
                  study: {
                    maxProviderRequests: 768,
                    maxToolRequests: 3072,
                    maxWallClockMs: 19200000,
                    maxRuns: 32
                  }
                },
                gates: {
                  precision: {
                    maxUnknownRunRate: 0.125,
                    minAdjudicableRunsPerTask: 14
                  },
                  feasibility: {
                    perTaskSuccessAmongAdjudicableLowerBound: 0.8,
                    perTaskBudgetExhaustionUpperBound: 0.2,
                    perTaskUnrecoveredToolFailureRunUpperBound: 0.2,
                    perTaskOraclePassAmongAdjudicableLowerBound: 0.8
                  }
                }
              } as unknown as V2ContractView)
            : asV2Contract(contract),
        runs,
        sharedInvalidator,
        invalidatorReasons
      }),
      failures: Object.freeze(failures)
    }
  } finally {
    providerBinding?.dispose()
  }
}
