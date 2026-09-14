import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, open, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  createRunKillSwitch,
  type RunKillSwitch
} from '@canvas-agent/pi-context-integration/experimental'
import {
  C1_E0_ENDPOINT,
  C1_E0_ENROLLMENT_COHORT,
  C1_E0_MODEL,
  C1_E0_PAIR_COUNT,
  C1_E0_PROVIDER,
  C1_E0_PROVIDER_CONFIG_HASH,
  C1_E0_RUN_CONTRACT_ID,
  C1_E0_TASK_MANIFEST_RELATIVE_PATH,
  C1_E0_TOTAL_LEG_COUNT,
  buildC1E0PairAssignments,
  loadC1E0EnrollmentManifest,
  loadC1E0RunContract,
  type C1E0EnrollmentManifest,
  type C1E0EnrollmentCandidate,
  type C1E0PairAssignment,
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
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingDriver,
  C1SandboxToolExecutor,
  type C1LiveBindingEvidence,
  type C1LiveBindingLegResult,
  type C1LiveModelResponse,
  type C1LiveObservationSource,
  type C1LiveResponseSource
} from './c1-live-binding'
import {
  C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE,
  C1_MODEL_ID,
  C1_NODE_RANGE,
  C1_PROVIDER_ENDPOINT,
  C1_PROVIDER_ID,
  C1HardBudgetGuard,
  C1PreflightFailure,
  changedC1FixturePaths,
  computeC1FixtureContentSummary,
  createC1ObservedReadTrace,
  installC1OperatorKillSwitch,
  materializeFreshC1Fixture,
  prepareC1StrictProvider,
  snapshotC1Fixture,
  writableScopePass,
  type C1AgentObservation,
  type C1PreflightTask,
  type C1ProviderBoundCapture,
  type C1SignalSource,
  type C1StrictProviderBinding
} from './c1-live-preflight'
import { buildSanitizedChildEnvironment, runProcess } from './fixture-generator'
import { assertC1LiveWorktreeClean } from './c1-live-study'

export const C1_E0_EXECUTION_RUNNER_ID = 'C1_EFFECTIVENESS_E0_EXECUTION_RUNNER_V1'
export const C1_E0_EXECUTION_RUNNER_SCHEMA_VERSION = 1 as const
export const C1_E0_EXECUTION_RUNNER_MODE = 'CREDENTIAL_FREE_SCRIPTED_FAKE' as const
export const C1_E0_FAKE_SCENARIOS = Object.freeze([
  'BOTH_TASKS_NON_ZERO',
  'ONLY_T1_NON_ZERO',
  'EXPERIMENT_INVALIDATOR',
  'ISOLATED_HARNESS_FAILURE'
] as const)
export type C1E0FakeScenario = (typeof C1_E0_FAKE_SCENARIOS)[number]
export type C1E0ExecutionStatus = 'PASS' | 'INCONCLUSIVE' | 'NO_GO'

const E0_STUDY_ID_PATTERN = /^c1-e0-\d{8}-[0-9a-f]{8}$/
const E0_RUN_ID_PATTERN = /^c1-e0-\d{8}-c1-e0-\d{2}-(?:NATIVE|RUNTIME)-[0-9a-f]{8}$/
const E0_FAKE_CREDENTIAL = 'c1-e0-credential-free-sentinel'
const E0_ARTIFACT_NAMES = Object.freeze([
  'run-manifest.json',
  'checkpoints.jsonl',
  'checkpoint-summary.json',
  'study-events.jsonl',
  'response-ledger.jsonl',
  'dose-evidence.jsonl',
  'pair-adjudication.jsonl',
  'batch-qualification.json'
] as const)

type E0ArtifactName = (typeof E0_ARTIFACT_NAMES)[number]

export interface C1E0ExecutionRunnerOptions {
  readonly repoRoot?: string
  readonly outputRoot?: string
  readonly studyId?: string
  readonly scenario?: C1E0FakeScenario
  readonly now?: Date
  readonly signalSource?: C1SignalSource
}

export interface C1E0ExecutionPlan {
  readonly legIndex: number
  readonly pairOrdinal: number
  readonly pairId: string
  readonly taskId: string
  readonly stratum: string
  readonly order: 'NATIVE_THEN_RUNTIME' | 'RUNTIME_THEN_NATIVE'
  readonly arm: 'NATIVE' | 'RUNTIME'
  readonly runId: string
}

export interface C1E0ExecutionLegRecord {
  readonly legIndex: number
  readonly pairOrdinal: number
  readonly pairId: string
  readonly taskId: string
  readonly stratum: string
  readonly arm: 'NATIVE' | 'RUNTIME'
  readonly runId: string
  readonly status: 'COMPLETED' | 'BLOCKED' | 'FAILED'
  readonly blockReason?: string
  readonly responseSource: 'SCRIPTED_FAKE'
  readonly providerConfigHash: string
  readonly providerBindingProfileHash: string | null
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
  readonly replayVerdict: 'MATCH' | 'UNKNOWN'
  readonly doseObservationCount: number
  readonly errorCode?: string
}

export interface C1E0PairAdjudication {
  readonly pairOrdinal: number
  readonly pairId: string
  readonly taskId: string
  readonly stratum: string
  readonly pairStatus: 'COMPLETE' | 'INCOMPLETE' | 'INVALID_FOR_ENDPOINT'
  readonly counterpartDecision:
    | 'EXECUTED'
    | 'EXECUTED_AFTER_ISOLATED_FAILURE'
    | 'BLOCKED_EXPERIMENT_INVALIDATOR'
    | 'BLOCKED_STUDY_TERMINAL'
  readonly nativeOutcome: 'COMPLETE' | 'FAILED' | 'CONTINUE' | 'UNKNOWN'
  readonly runtimeOutcome: 'COMPLETE' | 'FAILED' | 'CONTINUE' | 'UNKNOWN'
  readonly nativeDose: 'NOT_APPLICABLE'
  readonly runtimeDoseSummary: C1E0DoseSummary | null
  readonly conditionalTreatmentEligible: boolean
  readonly treatmentIntegrity: 'PASS' | 'INACTIVE' | 'FAIL' | 'UNKNOWN'
  readonly safetyVerdict: 'PASS' | 'INACTIVE' | 'FAIL' | 'UNKNOWN'
  readonly providerBoundaryVerdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  readonly taskCorrectnessCoverage: 'NOT_OBSERVED_CREDENTIAL_FREE' | 'OUT_OF_SCOPE' | 'UNKNOWN'
  readonly efficiencyCoverage: 'NOT_OBSERVED_CREDENTIAL_FREE'
  readonly exclusionReason?: string
}

export interface C1E0StudyEvent {
  readonly sequence: number
  readonly event:
    | 'STUDY_PREPARED'
    | 'PAIR_STARTED'
    | 'LEG_STARTED'
    | 'LEG_COMPLETED'
    | 'LEG_BLOCKED'
    | 'PAIR_ADJUDICATED'
    | 'STUDY_QUALIFIED'
    | 'STUDY_TERMINATED'
  readonly pairId?: string
  readonly taskId?: string
  readonly arm?: 'NATIVE' | 'RUNTIME'
  readonly runId?: string
  readonly observedStatus?: string
}

export interface C1E0ExecutionArtifactSummary {
  readonly name: string
  readonly sha256: string
  readonly bytes: number
}

export interface C1E0ExecutionReport {
  readonly runnerId: typeof C1_E0_EXECUTION_RUNNER_ID
  readonly schemaVersion: typeof C1_E0_EXECUTION_RUNNER_SCHEMA_VERSION
  readonly executionMode: typeof C1_E0_EXECUTION_RUNNER_MODE
  readonly scenario: C1E0FakeScenario
  readonly status: C1E0ExecutionStatus
  readonly studyId: string
  readonly reportDir: string | null
  readonly executionRevision: string | null
  readonly runContractId: typeof C1_E0_RUN_CONTRACT_ID
  readonly runContractCodeRevision: string | null
  readonly runContractSha256: string | null
  readonly enrollmentManifestSha256: string | null
  readonly taskManifestSha256: string | null
  readonly candidatePoolHash: string | null
  readonly enrollmentCohort: typeof C1_E0_ENROLLMENT_COHORT
  readonly provider: typeof C1_E0_PROVIDER
  readonly model: typeof C1_E0_MODEL
  readonly endpoint: typeof C1_E0_ENDPOINT
  readonly nodeRange: typeof C1_NODE_RANGE
  readonly providerConfigHash: string | null
  readonly providerPreparationProfileHash: string | null
  readonly responseSource: 'SCRIPTED_FAKE'
  readonly providerCalls: 0
  readonly networkRequests: 0
  readonly fakeProviderCallPermits: number
  readonly responseCalls: number
  readonly toolExecutions: number
  readonly legsPlanned: typeof C1_E0_TOTAL_LEG_COUNT
  readonly legsAttempted: number
  readonly legsCompleted: number
  readonly blockedLegs: number
  readonly studyTerminal: boolean
  readonly terminalReason: string | null
  readonly operatorSignal: 'SIGINT' | 'SIGTERM' | null
  readonly budget: {
    readonly completedLegs: number
    readonly providerCalls: number
    readonly toolCalls: number
    readonly wallClockMs: number
  } | null
  readonly batchQualification: C1E0BatchQualificationResult
  readonly pairAdjudications: readonly C1E0PairAdjudication[]
  readonly legs: readonly C1E0ExecutionLegRecord[]
  readonly events: readonly C1E0StudyEvent[]
  readonly artifacts: readonly C1E0ExecutionArtifactSummary[]
  readonly failures: readonly { readonly code: string; readonly message: string }[]
}

interface E0ParsedTask extends C1PreflightTask {
  readonly candidate: C1E0EnrollmentCandidate
}

interface E0InternalLeg {
  readonly plan: C1E0ExecutionPlan
  readonly task: E0ParsedTask
  readonly result?: C1LiveBindingLegResult
  readonly providerProfileHash: string | null
  readonly changedPaths: readonly string[]
  readonly writableScopePass: boolean
  readonly fixtureHashVerified: boolean
  readonly fixtureCleaned: boolean
  readonly doseObservations: readonly C1E0DoseObservation[]
  readonly errorCode?: string
}

interface E0PairState {
  readonly plan: C1E0PairAssignment
  native?: E0InternalLeg
  runtime?: E0InternalLeg
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function shortDigest(value: string): string {
  return sha256(value).slice(0, 8)
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new C1PreflightFailure('MANIFEST_BINDING_MISMATCH', `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new C1PreflightFailure('MANIFEST_BINDING_MISMATCH', `${label} must be a non-empty string`)
  }
  return value
}

function stringArray(value: unknown, label: string, allowEmpty = false): readonly string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new C1PreflightFailure(
      'MANIFEST_BINDING_MISMATCH',
      `${label} must be a non-empty string array`
    )
  }
  return Object.freeze([...value] as string[])
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new C1PreflightFailure('MANIFEST_BINDING_MISMATCH', `${label} must be a positive integer`)
  }
  return value as number
}

function parseOracle(value: unknown, label: string): C1PreflightTask['objectiveOracle'] {
  const record = asRecord(value, label)
  if (record['command'] !== 'node') {
    throw new C1PreflightFailure('MANIFEST_BINDING_MISMATCH', `${label}.command must be node`)
  }
  return {
    command: 'node',
    args: stringArray(record['args'], `${label}.args`),
    expectedExitCode: Number.isSafeInteger(record['expectedExitCode'])
      ? (record['expectedExitCode'] as number)
      : (() => {
          throw new C1PreflightFailure(
            'MANIFEST_BINDING_MISMATCH',
            `${label}.expectedExitCode must be an integer`
          )
        })(),
    timeoutMs: positiveInteger(record['timeoutMs'], `${label}.timeoutMs`)
  }
}

function parseE0Task(raw: unknown, candidate: C1E0EnrollmentCandidate): E0ParsedTask {
  const record = asRecord(raw, `task ${candidate.taskId}`)
  const fixtureRevision = asRecord(record['fixtureRevision'], `${candidate.taskId}.fixtureRevision`)
  const fixtureContentSha256 = nonEmptyString(
    fixtureRevision['fixtureContentSha256'],
    `${candidate.taskId}.fixtureRevision.fixtureContentSha256`
  )
  const fixtureTreeObjectId = nonEmptyString(
    fixtureRevision['fixtureTreeObjectId'],
    `${candidate.taskId}.fixtureRevision.fixtureTreeObjectId`
  )
  if (
    fixtureContentSha256 !== candidate.fixtureContentSha256 ||
    fixtureTreeObjectId !== candidate.fixtureTreeObjectId
  ) {
    throw new C1PreflightFailure(
      'MANIFEST_BINDING_MISMATCH',
      `E0 fixture binding drifted for ${candidate.taskId}`
    )
  }
  const prompt = nonEmptyString(record['prompt'], `${candidate.taskId}.prompt`)
  return {
    candidate,
    taskId: nonEmptyString(record['taskId'], `${candidate.taskId}.taskId`),
    stratum: nonEmptyString(record['stratum'], `${candidate.taskId}.stratum`),
    title: nonEmptyString(record['title'], `${candidate.taskId}.title`),
    fixtureVersion: nonEmptyString(record['fixtureVersion'], `${candidate.taskId}.fixtureVersion`),
    fixturePath: nonEmptyString(record['fixturePath'], `${candidate.taskId}.fixturePath`),
    fixtureRevision: {
      baseRevision: nonEmptyString(
        fixtureRevision['baseRevision'],
        `${candidate.taskId}.fixtureRevision.baseRevision`
      ),
      fixtureTreeObjectId,
      fixtureContentSha256
    },
    prompt,
    promptSha256: nonEmptyString(record['promptSha256'], `${candidate.taskId}.promptSha256`),
    objectiveOracle: parseOracle(record['objectiveOracle'], `${candidate.taskId}.objectiveOracle`),
    regressionOracle: parseOracle(
      record['regressionOracle'],
      `${candidate.taskId}.regressionOracle`
    ),
    expectedWritablePaths: stringArray(
      record['expectedWritablePaths'],
      `${candidate.taskId}.expectedWritablePaths`
    ),
    relevantSources: stringArray(record['relevantSources'], `${candidate.taskId}.relevantSources`),
    distractorSources: stringArray(
      record['distractorSources'],
      `${candidate.taskId}.distractorSources`
    ),
    requiredLaterSources: stringArray(
      record['requiredLaterSources'],
      `${candidate.taskId}.requiredLaterSources`,
      true
    )
  }
}

async function loadE0Tasks(
  repoRoot: string,
  enrollment: C1E0EnrollmentManifest
): Promise<ReadonlyMap<string, E0ParsedTask>> {
  const raw = JSON.parse(
    await readFile(resolve(repoRoot, C1_E0_TASK_MANIFEST_RELATIVE_PATH), 'utf8')
  ) as unknown
  const tasks = asRecord(raw, 'E0 task manifest')['tasks']
  if (!Array.isArray(tasks)) {
    throw new C1PreflightFailure(
      'MANIFEST_BINDING_MISMATCH',
      'E0 task manifest tasks must be an array'
    )
  }
  const byId = new Map<string, Record<string, unknown>>()
  for (const task of tasks) {
    const parsed = asRecord(task, 'E0 task manifest task')
    byId.set(nonEmptyString(parsed['taskId'], 'E0 task manifest taskId'), parsed)
  }
  const candidates = new Map(
    enrollment.candidates.map((candidate) => [candidate.taskId, candidate])
  )
  const selected = new Map<string, E0ParsedTask>()
  for (const taskId of enrollment.selectedTaskIds) {
    const candidate = candidates.get(taskId)
    const rawTask = byId.get(taskId)
    if (candidate === undefined || rawTask === undefined) {
      throw new C1PreflightFailure(
        'MANIFEST_BINDING_MISMATCH',
        `E0 selected task is missing: ${taskId}`
      )
    }
    const task = parseE0Task(rawTask, candidate)
    if (task.taskId !== taskId || task.stratum !== candidate.stratum) {
      throw new C1PreflightFailure(
        'MANIFEST_BINDING_MISMATCH',
        `E0 selected task drifted: ${taskId}`
      )
    }
    selected.set(taskId, task)
  }
  return selected
}

function dateToken(now: Date): string {
  return now.toISOString().slice(0, 10).replaceAll('-', '')
}

function createStudyId(now: Date): string {
  return `c1-e0-${dateToken(now)}-${randomBytes(4).toString('hex')}`
}

function assertStudyId(value: string): void {
  if (!E0_STUDY_ID_PATTERN.test(value)) {
    throw new C1PreflightFailure('IDENTITY_INVALID', `invalid E0 study identity ${value}`)
  }
}

function assertRunId(value: string): void {
  if (!E0_RUN_ID_PATTERN.test(value)) {
    throw new C1PreflightFailure('IDENTITY_INVALID', `invalid E0 run identity ${value}`)
  }
}

async function claimE0StudyDir(outputRoot: string, studyId: string): Promise<string> {
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
        `E0 study identity ${studyId} is already claimed`
      )
    }
    throw error
  }
  await mkdir(join(reportDir, 'legs'))
  return reportDir
}

async function claimE0LegDir(reportDir: string, runId: string): Promise<string> {
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
      throw new C1PreflightFailure('IDENTITY_REUSE', `E0 leg identity ${runId} is already claimed`)
    }
    throw error
  }
  return legDir
}

export function buildC1E0ExecutionPlans(
  contract: C1E0RunContract,
  enrollment: C1E0EnrollmentManifest,
  studyId: string
): readonly C1E0ExecutionPlan[] {
  assertStudyId(studyId)
  const plans: C1E0ExecutionPlan[] = []
  const date = studyId.slice('c1-e0-'.length, 'c1-e0-'.length + 8)
  for (const assignment of contract.pairAssignments) {
    for (const arm of assignment.armSequence) {
      const runId = `c1-e0-${date}-${assignment.pairId}-${arm}-${shortDigest(
        `${studyId}:${assignment.pairId}:${arm}`
      )}`
      assertRunId(runId)
      plans.push({
        legIndex: plans.length,
        pairOrdinal: assignment.pairOrdinal,
        pairId: assignment.pairId,
        taskId: assignment.taskId,
        stratum: assignment.stratum,
        order: assignment.order,
        arm,
        runId
      })
    }
  }
  const expected = buildC1E0PairAssignments(enrollment)
  if (JSON.stringify(contract.pairAssignments) !== JSON.stringify(expected)) {
    throw new C1PreflightFailure('ASSIGNMENT_BINDING_MISMATCH', 'E0 pair assignment matrix drifted')
  }
  if (plans.length !== C1_E0_TOTAL_LEG_COUNT) {
    throw new C1PreflightFailure(
      'ASSIGNMENT_BINDING_MISMATCH',
      `E0 expected ${C1_E0_TOTAL_LEG_COUNT} legs, received ${plans.length}`
    )
  }
  return Object.freeze(plans)
}

class E0FakeResponseSource implements C1LiveResponseSource {
  readonly kind = 'SCRIPTED_FAKE' as const
  private cursor = 0

  constructor(private readonly responses: readonly C1LiveModelResponse[]) {}

  get responsesServed(): number {
    return this.cursor
  }

  async next(request: { readonly capture: C1ProviderBoundCapture }): Promise<C1LiveModelResponse> {
    if (request.capture.providerConfigHash !== C1_E0_PROVIDER_CONFIG_HASH) {
      throw new C1PreflightFailure(
        'PROVIDER_BINDING_MISMATCH',
        'E0 fake response source received a request configuration hash mismatch'
      )
    }
    const response = this.responses[this.cursor]
    if (response === undefined) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `E0 fake response source exhausted at response ${this.cursor + 1}`
      )
    }
    this.cursor += 1
    return response
  }
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

async function createFakeResponses(input: {
  readonly task: E0ParsedTask
  readonly fixtureRoot: string
  readonly runId: string
}): Promise<readonly C1LiveModelResponse[]> {
  const editPath = input.task.expectedWritablePaths[0]
  if (editPath === undefined) {
    throw new C1PreflightFailure(
      'MANIFEST_BINDING_MISMATCH',
      `E0 task has no writable path: ${input.task.taskId}`
    )
  }
  const original = await readFile(resolve(input.fixtureRoot, editPath), 'utf8')
  const newText = `${original}${original.endsWith('\n') ? '' : '\n'}// E0 credential-free fake edit ${input.runId}\n`
  return Object.freeze([
    {
      responseId: `${input.runId}-response-01`,
      assistantMessageCount: 1,
      assistantContent: 'The scripted fake provider reads and edits the expected fixture path.',
      usage: fakeUsage(120, 12),
      toolRequests: [
        {
          toolCallId: `${input.runId}-read-01`,
          toolName: 'read',
          argumentsJson: JSON.stringify({ path: editPath })
        },
        {
          toolCallId: `${input.runId}-edit-01`,
          toolName: 'edit',
          argumentsJson: JSON.stringify({ path: editPath, oldText: original, newText })
        }
      ],
      toolExecutions: [],
      outcome: 'CONTINUE'
    },
    {
      responseId: `${input.runId}-response-02`,
      assistantMessageCount: 1,
      assistantContent: 'The scripted fake provider continues after the bounded edit.',
      usage: fakeUsage(100, 10),
      toolRequests: [],
      toolExecutions: [],
      outcome: 'CONTINUE'
    },
    {
      responseId: `${input.runId}-response-03`,
      assistantMessageCount: 1,
      assistantContent: 'The scripted fake provider completes the leg.',
      usage: fakeUsage(80, 8),
      toolRequests: [],
      toolExecutions: [],
      outcome: 'COMPLETE'
    }
  ])
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort())
}

function readPairKeyGroups(
  observation: C1AgentObservation,
  path?: string
): readonly (readonly string[])[] {
  const pairs: (readonly string[])[] = []
  for (let index = 0; index + 1 < observation.messages.length; index += 1) {
    const message = observation.messages[index]
    const next = observation.messages[index + 1]
    if (
      message?.role !== 'assistant' ||
      !Array.isArray(message.content) ||
      message.content.length !== 1
    )
      continue
    const block = message.content[0]
    if (
      typeof block !== 'object' ||
      block === null ||
      (block as { readonly type?: unknown }).type !== 'toolCall' ||
      (block as { readonly name?: unknown }).name !== 'read'
    )
      continue
    const id = (block as { readonly id?: unknown }).id
    const argumentsValue = (block as { readonly arguments?: unknown }).arguments
    const candidatePath =
      typeof argumentsValue === 'object' &&
      argumentsValue !== null &&
      !Array.isArray(argumentsValue)
        ? (argumentsValue as { readonly path?: unknown }).path
        : undefined
    if (
      typeof id !== 'string' ||
      (path !== undefined && candidatePath !== path) ||
      next?.role !== 'toolResult' ||
      next.toolCallId !== id ||
      next.toolName !== 'read'
    )
      continue
    pairs.push(Object.freeze([`run/tool-call://${id}`, `run/tool-result://${id}`]))
  }
  if (pairs.length === 0) {
    throw new C1PreflightFailure(
      'PREFLIGHT_FAILURE',
      `E0 fake observation has no read pair${path === undefined ? '' : ` for ${path}`}`
    )
  }
  return Object.freeze(pairs)
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
  const lifecycleIds: string[] = []
  for (const [id, pair] of pairs) {
    if (pair.call === undefined || pair.result === undefined) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `E0 lifecycle source pair is incomplete for tool call ${id}`
      )
    }
    lifecycleIds.push(`c1-lifecycle-${sha256(`${pair.call}|${pair.result}`)}`)
  }
  return uniqueSorted(lifecycleIds)
}

class E0ObservationSource implements C1LiveObservationSource {
  readonly initialObservation: C1AgentObservation
  private readonly baseKeys: ReadonlySet<string>
  private readonly staleKeys: readonly string[]
  private readonly retainedKeys: readonly string[]

  constructor(
    base: C1AgentObservation,
    staleKeys: readonly string[],
    private readonly activateTreatment: boolean
  ) {
    this.initialObservation = base
    this.baseKeys = new Set(base.currentTargetSourceKeys)
    this.staleKeys = uniqueSorted(staleKeys)
    this.retainedKeys = uniqueSorted(
      base.currentTargetSourceKeys.filter((key) => !this.staleKeys.includes(key))
    )
  }

  next(input: {
    readonly callOrdinal: number
    readonly previousObservation: C1AgentObservation
    readonly previousExecution: { readonly workingSet: { readonly workingSetId: string } | null }
    readonly response: C1LiveModelResponse
    readonly toolObservation?: C1AgentObservation
  }): C1AgentObservation {
    const observed = input.toolObservation ?? input.previousObservation
    const previousWorkingSetId = input.previousExecution.workingSet?.workingSetId ?? null
    if (!this.activateTreatment) {
      return { ...observed, previousWorkingSetId }
    }
    const dynamicKeys = observed.currentTargetSourceKeys.filter((key) => !this.baseKeys.has(key))
    const signals = this.staleKeys.map((sourceKey) => ({
      sourceKey,
      kind: 'SUPERSEDED' as const,
      evidenceRef: 'c1-e0-credential-free-fake-superseeded'
    }))
    return {
      ...observed,
      observationId: `${observed.observationId}-e0-${input.callOrdinal}`,
      previousWorkingSetId,
      currentTargetSourceKeys: uniqueSorted([...this.retainedKeys, ...dynamicKeys]),
      excludedSourceKeys: uniqueSorted([...observed.excludedSourceKeys, ...this.staleKeys]),
      sourceLifecycleSignals: Object.freeze([
        ...(observed.sourceLifecycleSignals ?? []),
        ...signals
      ])
    }
  }
}

function doseObservationsForLeg(
  plan: C1E0ExecutionPlan,
  result: C1LiveBindingLegResult,
  eligibleLifecyclePairIds: readonly string[]
): readonly C1E0DoseObservation[] {
  const observations: C1E0DoseObservation[] = []
  const newRemovalLifecyclePairIds = new Set<string>()
  for (const row of result.evidence) {
    const removedFromTransition =
      row.decisionDetails?.filter((detail) => detail.kind === 'REMOVE') ?? []
    const removedSourceKeys = uniqueSorted([
      ...removedFromTransition.map((detail) => detail.sourceKey),
      ...(row.carriedRemovedSourceKeys ?? [])
    ])
    const removed = removedSourceKeys.length > 0
    const carried = (row.carriedRemovedSourceKeys?.length ?? 0) > 0
    const removedLifecyclePairIds = removed ? lifecyclePairIdsForSourceKeys(removedSourceKeys) : []
    const newRemovalPairIds = removedLifecyclePairIds.filter(
      (lifecyclePairId) => !newRemovalLifecyclePairIds.has(lifecyclePairId)
    )
    for (const lifecyclePairId of newRemovalPairIds) {
      newRemovalLifecyclePairIds.add(lifecyclePairId)
    }
    const carriedRemovalPairIds = carried
      ? lifecyclePairIdsForSourceKeys(row.carriedRemovedSourceKeys ?? [])
      : []
    const preHash = row.prePolicyProviderBoundMessagesHash
    const postHash = row.postPolicyProviderBoundMessagesHash
    if (preHash === undefined || postHash === undefined) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `E0 leg ${plan.runId} did not expose same-composition provider-bound hashes`
      )
    }
    observations.push(
      validateC1E0DoseObservation({
        schemaId: 'C1_EFFECTIVENESS_DOSE_V1',
        schemaVersion: 1,
        experimentPairId: plan.pairId,
        callOrdinal: row.callOrdinal,
        prePolicyProviderBoundMessagesHash: preHash,
        postPolicyProviderBoundMessagesHash: postHash,
        uniqueEligiblePairIds: row.lifecycleEligible ? eligibleLifecyclePairIds : [],
        uniqueSelectedPairIds: row.lifecycleEligible ? eligibleLifecyclePairIds : [],
        uniqueRemovedPairIds: removedLifecyclePairIds,
        uniqueRemovedSourceElementKeys: removedSourceKeys,
        newRemovalPairIds,
        carriedRemovalPairIds,
        suppressedStalePairIds: removedLifecyclePairIds,
        suppressedStalePairCallExposures: removedLifecyclePairIds.length,
        suppressedSourceElementCallExposures: removedLifecyclePairIds.length * 2,
        tokensBeforeComposition: 'UNAVAILABLE',
        tokensAfterComposition: 'UNAVAILABLE',
        removedBytes: 'UNAVAILABLE',
        removedTokens: 'UNAVAILABLE',
        activeStaleElements: removedLifecyclePairIds.length,
        rehydrateCount: row.transitionDecisionKinds.filter((kind) => kind === 'REHYDRATE').length,
        lifecycleUnknownCountByReason: {},
        protectedRemovalCount: 0,
        contractConflictCount: 0,
        runtimeContextChanged: row.runtimeContextChanged
      })
    )
  }
  return Object.freeze(observations)
}

function failureOf(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof C1PreflightFailure) return { code: error.code, message: error.message }
  return {
    code: 'PREFLIGHT_FAILURE',
    message: error instanceof Error ? error.message : String(error)
  }
}

function runtimePolicyInput(): C1E0RuntimePolicyInput {
  return {
    modelVisibleMessages: [],
    toolRequests: [],
    toolExecutionResults: [],
    versionProbeFingerprints: {},
    runtimeTransitionEvidence: [],
    carriedRemovalEvidence: []
  }
}

function checkpointComplete(
  sink: C1JsonlLiveBindingEvidenceSink,
  runId: string,
  responseCalls: number
): boolean {
  const checkpoints = sink.checkpoints
  for (let callOrdinal = 1; callOrdinal <= responseCalls; callOrdinal += 1) {
    const hasOutbound = checkpoints.some(
      (checkpoint) =>
        checkpoint.phase === 'OUTBOUND_PERMITTED' &&
        checkpoint.callOrdinal === callOrdinal &&
        checkpoint.capture.runId === runId
    )
    const hasReceived = checkpoints.some(
      (checkpoint) =>
        checkpoint.phase === 'RESPONSE_RECEIVED' &&
        checkpoint.callOrdinal === callOrdinal &&
        checkpoint.receipt.runId === runId
    )
    const hasRecorded = checkpoints.some(
      (checkpoint) =>
        checkpoint.phase === 'RESPONSE_RECORDED' &&
        checkpoint.callOrdinal === callOrdinal &&
        checkpoint.evidence.runId === runId
    )
    if (!hasOutbound || !hasReceived || !hasRecorded) return false
  }
  return true
}

export interface C1E0ProviderBoundaryCheck {
  readonly verdict: 'PASS' | 'FAIL'
  readonly expectedNetworkSent: boolean
  readonly observedNetworkSent: readonly boolean[]
}

/** Network traversal is a boundary fact; it is never used as fallback evidence. */
export function evaluateC1E0ProviderBoundary(
  evidence: readonly Pick<C1LiveBindingEvidence, 'networkSent'>[],
  source: 'SCRIPTED_FAKE' | 'AUTHORIZED_PROVIDER'
): C1E0ProviderBoundaryCheck {
  const expectedNetworkSent = source === 'AUTHORIZED_PROVIDER'
  const observedNetworkSent = Object.freeze(evidence.map((row) => row.networkSent))
  return {
    verdict:
      evidence.length > 0 && evidence.every((row) => row.networkSent === expectedNetworkSent)
        ? 'PASS'
        : 'FAIL',
    expectedNetworkSent,
    observedNetworkSent
  }
}

function pairAdjudications(
  assignments: readonly C1E0PairAssignment[],
  states: ReadonlyMap<string, E0PairState>,
  sink: C1JsonlLiveBindingEvidenceSink | null,
  experimentInvalidator: boolean
): readonly C1E0PairAdjudication[] {
  return Object.freeze(
    assignments.map((assignment) => {
      const state = states.get(assignment.pairId)
      const native = state?.native
      const runtime = state?.runtime
      const complete = native?.result !== undefined && runtime?.result !== undefined
      let runtimeDoseSummary: C1E0DoseSummary | null = null
      let integrity: ReturnType<typeof evaluateC1E0TreatmentIntegrity> | null = null
      let providerBoundaryVerdict: C1E0PairAdjudication['providerBoundaryVerdict'] = 'UNKNOWN'
      if (runtime?.result !== undefined) {
        runtimeDoseSummary = aggregateC1E0Dose(runtime.doseObservations)
        const evidence = runtime.result.evidence
        const providerBoundary = evaluateC1E0ProviderBoundary(evidence, 'SCRIPTED_FAKE')
        providerBoundaryVerdict = providerBoundary.verdict
        const envelopePreserved = evidence.every(
          (row) =>
            row.systemDeveloperToolStructuresFingerprint ===
            C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE.structuralFingerprint
        )
        const replayVerdict = evidence.every((row) => row.replayMismatch === 0)
          ? 'MATCH'
          : 'UNKNOWN'
        const evaluatedIntegrity = evaluateC1E0TreatmentIntegrity({
          dose: runtimeDoseSummary,
          replayVerdict,
          envelopePreserved,
          protectedEvidenceRemoved: runtimeDoseSummary.protectedRemovalCount > 0,
          noFallback: evidence.every((row) => !row.fallbackSent),
          checkpointComplete:
            sink !== null && checkpointComplete(sink, runtime.plan.runId, evidence.length),
          runtimePolicyInput: runtimePolicyInput()
        })
        integrity =
          providerBoundary.verdict === 'PASS'
            ? evaluatedIntegrity
            : {
                verdict: 'FAIL',
                reasons: Object.freeze([
                  ...evaluatedIntegrity.reasons,
                  'provider boundary expectation mismatch'
                ])
              }
      }
      const pairStatus: C1E0PairAdjudication['pairStatus'] = complete
        ? 'COMPLETE'
        : experimentInvalidator
          ? 'INVALID_FOR_ENDPOINT'
          : 'INCOMPLETE'
      const isolatedFailure =
        native?.errorCode === 'ISOLATED_HARNESS_FAILURE' ||
        runtime?.errorCode === 'ISOLATED_HARNESS_FAILURE'
      const counterpartDecision: C1E0PairAdjudication['counterpartDecision'] = complete
        ? 'EXECUTED'
        : isolatedFailure && (native?.result !== undefined || runtime?.result !== undefined)
          ? 'EXECUTED_AFTER_ISOLATED_FAILURE'
          : experimentInvalidator
            ? 'BLOCKED_EXPERIMENT_INVALIDATOR'
            : 'BLOCKED_STUDY_TERMINAL'
      const nativeOutcome: C1E0PairAdjudication['nativeOutcome'] =
        native?.result?.finalOutcome ?? 'UNKNOWN'
      const runtimeOutcome: C1E0PairAdjudication['runtimeOutcome'] =
        runtime?.result?.finalOutcome ?? 'UNKNOWN'
      const taskCorrectnessCoverage: C1E0PairAdjudication['taskCorrectnessCoverage'] =
        complete === false
          ? 'UNKNOWN'
          : native?.writableScopePass === false || runtime?.writableScopePass === false
            ? 'OUT_OF_SCOPE'
            : 'NOT_OBSERVED_CREDENTIAL_FREE'
      return {
        pairOrdinal: assignment.pairOrdinal,
        pairId: assignment.pairId,
        taskId: assignment.taskId,
        stratum: assignment.stratum,
        pairStatus,
        counterpartDecision,
        nativeOutcome,
        runtimeOutcome,
        nativeDose: 'NOT_APPLICABLE',
        runtimeDoseSummary,
        conditionalTreatmentEligible:
          runtimeDoseSummary !== null &&
          runtimeDoseSummary.uniqueEligiblePairs.length > 0 &&
          runtimeDoseSummary.uniqueRemovedPairs.length > 0,
        treatmentIntegrity: integrity?.verdict ?? 'UNKNOWN',
        safetyVerdict: integrity?.verdict ?? 'UNKNOWN',
        providerBoundaryVerdict,
        taskCorrectnessCoverage,
        efficiencyCoverage: 'NOT_OBSERVED_CREDENTIAL_FREE' as const,
        ...(complete
          ? {}
          : {
              exclusionReason: isolatedFailure
                ? 'isolated harness failure retained; paired endpoint is unavailable'
                : experimentInvalidator
                  ? 'experiment invalidator blocked the frozen counterpart'
                  : 'study terminated before both legs completed'
            })
      } satisfies C1E0PairAdjudication
    })
  )
}

function evidenceMetadata(row: C1LiveBindingEvidence): Record<string, unknown> {
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
      usageStatus: 'UNAVAILABLE'
    }),
    usageSource: row.usage.usageSource,
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
        `E0 artifact ${document.name} contains raw provider/tool content`
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
  name: string
): Promise<C1E0ExecutionArtifactSummary> {
  const content = await readFile(join(reportDir, name))
  const information = await stat(join(reportDir, name))
  return {
    name,
    sha256: createHash('sha256').update(content).digest('hex'),
    bytes: information.size
  }
}

async function writeE0Artifacts(input: {
  readonly reportDir: string
  readonly reportBase: Omit<C1E0ExecutionReport, 'artifacts'>
  readonly evidence: readonly C1LiveBindingEvidence[]
  readonly doseObservations: readonly C1E0DoseObservation[]
  readonly pairs: readonly C1E0PairAdjudication[]
  readonly events: readonly C1E0StudyEvent[]
  readonly checkpoints: readonly unknown[]
}): Promise<readonly C1E0ExecutionArtifactSummary[]> {
  const responseLedger = input.evidence
    .map((row) => evidenceMetadata(row))
    .map(jsonLine)
    .join('')
  const doseEvidence = input.doseObservations.map(jsonLine).join('')
  const pairEvidence = input.pairs.map(jsonLine).join('')
  const eventEvidence = input.events.map(jsonLine).join('')
  const checkpointPath = join(input.reportDir, 'checkpoints.jsonl')
  const checkpointContent = await readFile(checkpointPath, 'utf8').catch(() => '')
  const checkpointSummary = {
    checkpointCount: input.checkpoints.length,
    phases: Object.fromEntries(
      [
        ...new Set(
          input.checkpoints.map((checkpoint) => (checkpoint as { readonly phase?: string }).phase)
        )
      ]
        .filter((phase): phase is string => phase !== undefined)
        .sort()
        .map((phase) => [
          phase,
          input.checkpoints.filter(
            (checkpoint) => (checkpoint as { readonly phase?: string }).phase === phase
          ).length
        ])
    ),
    checkpointSha256: sha256(checkpointContent)
  }
  const baseDocuments: readonly {
    readonly name: Exclude<E0ArtifactName, 'run-manifest.json'>
    readonly content: string
  }[] = [
    { name: 'checkpoints.jsonl', content: checkpointContent },
    { name: 'checkpoint-summary.json', content: `${JSON.stringify(checkpointSummary, null, 2)}\n` },
    { name: 'study-events.jsonl', content: eventEvidence },
    { name: 'response-ledger.jsonl', content: responseLedger },
    { name: 'dose-evidence.jsonl', content: doseEvidence },
    { name: 'pair-adjudication.jsonl', content: pairEvidence },
    {
      name: 'batch-qualification.json',
      content: `${JSON.stringify(input.reportBase.batchQualification, null, 2)}\n`
    }
  ]
  assertMetadataOnly(baseDocuments)
  for (const document of baseDocuments)
    await writeDurable(join(input.reportDir, document.name), document.content)
  const summaries = await Promise.all(
    baseDocuments.map((document) => artifactSummary(input.reportDir, document.name))
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

function legRecord(input: {
  readonly internal: E0InternalLeg
  readonly providerConfigHash: string
}): C1E0ExecutionLegRecord {
  const result = input.internal.result
  return {
    legIndex: input.internal.plan.legIndex,
    pairOrdinal: input.internal.plan.pairOrdinal,
    pairId: input.internal.plan.pairId,
    taskId: input.internal.plan.taskId,
    stratum: input.internal.plan.stratum,
    arm: input.internal.plan.arm,
    runId: input.internal.plan.runId,
    status:
      result !== undefined
        ? 'COMPLETED'
        : input.internal.errorCode === 'EXPERIMENT_INVALIDATOR' ||
            input.internal.errorCode === 'KILL_SWITCH_BLOCKED'
          ? 'BLOCKED'
          : 'FAILED',
    ...(input.internal.errorCode === undefined ? {} : { errorCode: input.internal.errorCode }),
    responseSource: 'SCRIPTED_FAKE',
    providerConfigHash: input.providerConfigHash,
    providerBindingProfileHash: input.internal.providerProfileHash,
    responseCalls: result?.evidence.length ?? 0,
    fakeProviderCallPermits: result?.providerCallPermits ?? 0,
    toolExecutions: result?.toolCalls ?? 0,
    finalOutcome: result?.finalOutcome ?? 'UNKNOWN',
    fixtureHashVerified: input.internal.fixtureHashVerified,
    fixtureCleaned: input.internal.fixtureCleaned,
    changedPaths: input.internal.changedPaths,
    writableScopePass: input.internal.writableScopePass,
    lifecycleEligibleCalls: result?.evidence.filter((row) => row.lifecycleEligible).length ?? 0,
    runtimeContextChangedCalls:
      result?.evidence.filter((row) => row.runtimeContextChanged).length ?? 0,
    replayVerdict:
      result === undefined || result.evidence.some((row) => row.replayMismatch !== 0)
        ? 'UNKNOWN'
        : 'MATCH',
    doseObservationCount: input.internal.doseObservations.length
  }
}

async function gitHead(repoRoot: string): Promise<string> {
  const result = await runProcess('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    timeoutMs: 30_000,
    env: buildSanitizedChildEnvironment()
  })
  if (result.exitCode !== 0 || result.timedOut || result.outputLimitExceeded) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'unable to resolve E0 runner execution revision'
    )
  }
  const revision = result.stdout.trim()
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new C1PreflightFailure(
      'CONTRACT_BINDING_MISMATCH',
      'E0 runner execution revision is not a commit SHA'
    )
  }
  return revision
}

function scenarioActivatesTask(scenario: C1E0FakeScenario, taskId: string): boolean {
  if (scenario === 'BOTH_TASKS_NON_ZERO') return true
  if (scenario === 'ONLY_T1_NON_ZERO') return taskId === 'c1-t1-localized-distractor-v1'
  if (scenario === 'ISOLATED_HARNESS_FAILURE') return true
  return false
}

function emptyBudget(): C1E0ExecutionReport['budget'] {
  return null
}

/**
 * Run the complete E0 study state machine without Provider access. The fake
 * source still traverses the real C1 observation, tool, Runtime composition,
 * checkpoint and budget paths; the resulting PASS is a state-machine result,
 * never an effectiveness claim.
 */
export async function runC1E0CredentialFreeStudy(
  options: C1E0ExecutionRunnerOptions = {}
): Promise<C1E0ExecutionReport> {
  const repoRoot = options.repoRoot ?? resolve(import.meta.dirname, '..', '..', '..')
  const scenario = options.scenario ?? 'BOTH_TASKS_NON_ZERO'
  const now = options.now ?? new Date()
  const studyId = options.studyId ?? createStudyId(now)
  const outputRoot =
    options.outputRoot ??
    join(repoRoot, 'research/context-benchmarks/.live-output/c1-e0-execution-runner')
  const failures: { code: string; message: string }[] = []
  const events: C1E0StudyEvent[] = []
  const internalLegs: E0InternalLeg[] = []
  const states = new Map<string, E0PairState>()
  let enrollment: C1E0EnrollmentManifest | null = null
  let contract: C1E0RunContract | null = null
  let executionRevision: string | null = null
  let reportDir: string | null = null
  let providerBinding: C1StrictProviderBinding | null = null
  let providerPreparationProfileHash: string | null = null
  let budgetGuard: C1HardBudgetGuard | null = null
  let evidenceSink: C1JsonlLiveBindingEvidenceSink | null = null
  let driver: C1LiveBindingDriver | null = null
  let operatorKillSwitch: ReturnType<typeof installC1OperatorKillSwitch> | null = null
  let activeKillSwitch: RunKillSwitch | null = null
  let activeAbortController: AbortController | null = null
  let operatorSignal: 'SIGINT' | 'SIGTERM' | null = null
  let studyTerminal = false
  let terminalReason: string | null = null
  let experimentInvalidator = false
  const startedPairs = new Set<string>()
  const signalSource = options.signalSource ?? new EventEmitter()

  try {
    assertStudyId(studyId)
    await assertC1LiveWorktreeClean(repoRoot)
    executionRevision = await gitHead(repoRoot)
    enrollment = await loadC1E0EnrollmentManifest(repoRoot)
    contract = await loadC1E0RunContract(repoRoot)
    if (contract.executionBinding.providerConfigHash !== C1_E0_PROVIDER_CONFIG_HASH) {
      throw new C1PreflightFailure(
        'PROVIDER_BINDING_MISMATCH',
        'E0 run contract providerConfigHash drifted'
      )
    }
    const tasks = await loadE0Tasks(repoRoot, enrollment)
    const plans = buildC1E0ExecutionPlans(contract, enrollment, studyId)
    reportDir = await claimE0StudyDir(outputRoot, studyId)
    events.push({
      sequence: events.length + 1,
      event: 'STUDY_PREPARED',
      observedStatus: 'PREPARED'
    })
    const prepared = await prepareC1StrictProvider({
      runIdentity: studyId,
      env: { STEP_PLAN_API_KEY: E0_FAKE_CREDENTIAL }
    })
    providerPreparationProfileHash = prepared.providerConfigHash
    providerBinding = prepared
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
      providerConfigHashOverride: contract.executionBinding.providerConfigHash
    })
    operatorKillSwitch = installC1OperatorKillSwitch(signalSource, (signal) => {
      operatorSignal = signal
      studyTerminal = true
      terminalReason = `operator ${signal}`
      activeKillSwitch?.trip(terminalReason)
      activeAbortController?.abort()
    })
    for (const plan of plans) {
      const pairState = states.get(plan.pairId) ?? {
        plan: contract.pairAssignments.find((assignment) => assignment.pairId === plan.pairId)!
      }
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
      if (
        scenario === 'EXPERIMENT_INVALIDATOR' &&
        plan.pairOrdinal === 1 &&
        plan.arm === 'RUNTIME' &&
        !experimentInvalidator
      ) {
        experimentInvalidator = true
        failures.push({
          code: 'EXPERIMENT_INVALIDATOR',
          message:
            'credential-free scenario injected an experiment invalidator before the counterpart'
        })
        const emitter = signalSource as C1SignalSource & {
          readonly emit?: (signal: 'SIGINT' | 'SIGTERM') => unknown
        }
        if (typeof emitter.emit === 'function') {
          emitter.emit('SIGINT')
        } else {
          operatorSignal = 'SIGINT'
          studyTerminal = true
          terminalReason = 'experiment invalidator blocked the frozen counterpart'
        }
      }
      if (studyTerminal) {
        internalLegs.push({
          plan,
          task: tasks.get(plan.taskId)!,
          providerProfileHash: providerPreparationProfileHash,
          changedPaths: [],
          writableScopePass: false,
          fixtureHashVerified: false,
          fixtureCleaned: true,
          doseObservations: [],
          errorCode: experimentInvalidator ? 'EXPERIMENT_INVALIDATOR' : 'KILL_SWITCH_BLOCKED'
        })
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
      const task = tasks.get(plan.taskId)
      if (task === undefined) {
        throw new C1PreflightFailure(
          'MANIFEST_BINDING_MISMATCH',
          `E0 plan references missing task ${plan.taskId}`
        )
      }
      events.push({
        sequence: events.length + 1,
        event: 'LEG_STARTED',
        pairId: plan.pairId,
        taskId: plan.taskId,
        arm: plan.arm,
        runId: plan.runId,
        observedStatus: 'STARTED'
      })
      const legDir = await claimE0LegDir(reportDir, plan.runId)
      const fixture = await materializeFreshC1Fixture(resolve(repoRoot, task.fixturePath))
      let fixtureCleaned = false
      let fixtureHashVerified = false
      let changedPaths: readonly string[] = []
      let scopePass = false
      let result: C1LiveBindingLegResult | undefined
      let doseObservations: readonly C1E0DoseObservation[] = []
      try {
        const before = await computeC1FixtureContentSummary(fixture.path)
        const beforeSnapshot = await snapshotC1Fixture(fixture.path)
        fixtureHashVerified = before.sha256 === task.fixtureRevision.fixtureContentSha256
        if (!fixtureHashVerified) {
          throw new C1PreflightFailure(
            'FIXTURE_BINDING_MISMATCH',
            `E0 fixture hash mismatch for ${plan.runId}`
          )
        }
        const editPath = task.expectedWritablePaths[0]
        if (editPath === undefined) {
          throw new C1PreflightFailure(
            'MANIFEST_BINDING_MISMATCH',
            `E0 task has no writable path ${task.taskId}`
          )
        }
        if (scenario === 'ISOLATED_HARNESS_FAILURE' && plan.legIndex === 0) {
          throw new C1PreflightFailure(
            'HARNESS_CONTRACT_FAILURE',
            'credential-free scenario injected an isolated harness failure for the first leg'
          )
        }
        const baseObservation = createC1ObservedReadTrace({
          observationId: `${plan.runId}-base`,
          prompt: task.prompt,
          fixtureFiles: [editPath, 'README.md']
        })
        const staleKeyGroups = readPairKeyGroups(baseObservation)
        const staleKeys = staleKeyGroups.flat()
        const eligibleLifecyclePairIds = lifecyclePairIdsForSourceKeys(staleKeys)
        const responses = await createFakeResponses({
          task,
          fixtureRoot: fixture.path,
          runId: plan.runId
        })
        const responseSource = new E0FakeResponseSource(responses)
        const observationSource = new E0ObservationSource(
          baseObservation,
          staleKeys,
          plan.arm === 'RUNTIME' && scenarioActivatesTask(scenario, task.taskId)
        )
        const abortController = new AbortController()
        activeAbortController = abortController
        const legKillSwitch = createRunKillSwitch(plan.runId, {
          now: () => new Date().toISOString()
        })
        activeKillSwitch = legKillSwitch
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
          maxCalls: 3,
          responseAbortSignal: abortController.signal,
          killSwitch: legKillSwitch
        })
        const after = await computeC1FixtureContentSummary(fixture.path)
        const afterSnapshot = await snapshotC1Fixture(fixture.path)
        changedPaths = changedC1FixturePaths(beforeSnapshot, afterSnapshot)
        scopePass = writableScopePass(changedPaths, task.expectedWritablePaths)
        doseObservations =
          plan.arm === 'RUNTIME'
            ? doseObservationsForLeg(plan, result, eligibleLifecyclePairIds)
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
              responseCalls: result.evidence.length,
              toolExecutions: result.toolCalls,
              providerConfigHash: C1_E0_PROVIDER_CONFIG_HASH,
              providerCalls: 0,
              networkRequests: 0,
              fixtureHashVerified,
              fixtureCleaned: true,
              changedPaths,
              writableScopePass: scopePass,
              doseObservationCount: doseObservations.length
            },
            null,
            2
          )}\n`
        )
        const internal: E0InternalLeg = {
          plan,
          task,
          result,
          providerProfileHash: providerPreparationProfileHash,
          changedPaths,
          writableScopePass: scopePass,
          fixtureHashVerified,
          fixtureCleaned: true,
          doseObservations
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
        if (scenario === 'ISOLATED_HARNESS_FAILURE' && plan.legIndex === 0) {
          const failure = failureOf(error)
          const isolatedInternal: E0InternalLeg = {
            plan,
            task,
            providerProfileHash: providerPreparationProfileHash,
            changedPaths,
            writableScopePass: false,
            fixtureHashVerified,
            fixtureCleaned: true,
            doseObservations: [],
            errorCode: 'ISOLATED_HARNESS_FAILURE'
          }
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
                status: 'FAILED',
                failureCode: 'ISOLATED_HARNESS_FAILURE',
                failureMessage: failure.message,
                responseCalls: 0,
                toolExecutions: 0,
                providerConfigHash: C1_E0_PROVIDER_CONFIG_HASH,
                providerCalls: 0,
                networkRequests: 0,
                fixtureHashVerified,
                fixtureCleaned: true,
                changedPaths,
                writableScopePass: false,
                doseObservationCount: 0
              },
              null,
              2
            )}\n`
          )
          internalLegs.push(isolatedInternal)
          if (plan.arm === 'NATIVE') pairState.native = isolatedInternal
          else pairState.runtime = isolatedInternal
          failures.push({ code: 'ISOLATED_HARNESS_FAILURE', message: failure.message })
          events.push({
            sequence: events.length + 1,
            event: 'LEG_COMPLETED',
            pairId: plan.pairId,
            taskId: plan.taskId,
            arm: plan.arm,
            runId: plan.runId,
            observedStatus: 'ISOLATED_HARNESS_FAILURE'
          })
          continue
        }
        throw error
      } finally {
        if (!fixtureCleaned) {
          await fixture.cleanup()
          fixtureCleaned = true
        }
        activeAbortController = null
        activeKillSwitch = null
      }
    }
  } catch (error) {
    const failure = failureOf(error)
    failures.push(failure)
    studyTerminal = true
    terminalReason = failure.message
    if (failure.code === 'EXPERIMENT_INVALIDATOR') experimentInvalidator = true
    if (contract !== null) {
      const tasks = await loadE0Tasks(repoRoot, enrollment!).catch(
        () => new Map<string, E0ParsedTask>()
      )
      for (const assignment of contract.pairAssignments) {
        for (const arm of assignment.armSequence) {
          const already = internalLegs.some(
            (leg) => leg.plan.pairId === assignment.pairId && leg.plan.arm === arm
          )
          if (already) continue
          const task = tasks.get(assignment.taskId)
          if (task === undefined) continue
          const plan = buildC1E0ExecutionPlans(contract, enrollment!, studyId).find(
            (candidate) => candidate.pairId === assignment.pairId && candidate.arm === arm
          )
          if (plan === undefined) continue
          internalLegs.push({
            plan,
            task,
            providerProfileHash: providerPreparationProfileHash,
            changedPaths: [],
            writableScopePass: false,
            fixtureHashVerified: false,
            fixtureCleaned: true,
            doseObservations: [],
            errorCode: failure.code
          })
        }
      }
    }
  } finally {
    operatorKillSwitch?.dispose()
    providerBinding?.dispose()
  }

  const assignments = contract?.pairAssignments ?? []
  const hardStudyFailure = failures.some((failure) => failure.code !== 'ISOLATED_HARNESS_FAILURE')
  const adjudications = pairAdjudications(
    assignments,
    states,
    evidenceSink,
    experimentInvalidator || hardStudyFailure
  )
  for (const pair of adjudications) {
    events.push({
      sequence: events.length + 1,
      event: 'PAIR_ADJUDICATED',
      pairId: pair.pairId,
      taskId: pair.taskId,
      observedStatus: pair.pairStatus
    })
  }
  const nonZeroTaskIds = adjudications
    .filter((pair) => pair.runtimeDoseSummary?.uniqueRemovedPairs.length)
    .map((pair) => pair.taskId)
  let batchQualification = evaluateC1E0BatchQualification({
    pairCount: contract?.design.pairCount ?? C1_E0_PAIR_COUNT,
    completedPairCount: adjudications.filter((pair) => pair.pairStatus === 'COMPLETE').length,
    nonZeroTreatmentPairTaskIds: nonZeroTaskIds,
    experimentInvalidator: experimentInvalidator || hardStudyFailure
  })
  const status: C1E0ExecutionStatus = batchQualification.verdict
  if (status === 'PASS') {
    events.push({ sequence: events.length + 1, event: 'STUDY_QUALIFIED', observedStatus: status })
  } else {
    studyTerminal = studyTerminal || status === 'NO_GO'
    terminalReason =
      terminalReason ??
      (status === 'NO_GO' ? 'E0 study terminated by invalidator' : 'E0 batch remains inconclusive')
    events.push({ sequence: events.length + 1, event: 'STUDY_TERMINATED', observedStatus: status })
  }

  const publicLegs = Object.freeze(
    internalLegs
      .sort((left, right) => left.plan.legIndex - right.plan.legIndex)
      .map((internal) =>
        legRecord({
          internal,
          providerConfigHash:
            contract?.executionBinding.providerConfigHash ?? C1_E0_PROVIDER_CONFIG_HASH
        })
      )
  )
  const allEvidence = internalLegs.flatMap((leg) => leg.result?.evidence ?? [])
  const allDoseObservations = internalLegs.flatMap((leg) => leg.doseObservations)
  let artifacts: readonly C1E0ExecutionArtifactSummary[] = []
  if (reportDir !== null && contract !== null && enrollment !== null && evidenceSink !== null) {
    const budget = budgetGuard?.ledger ?? null
    const reportBase = {
      runnerId: C1_E0_EXECUTION_RUNNER_ID,
      schemaVersion: C1_E0_EXECUTION_RUNNER_SCHEMA_VERSION,
      executionMode: C1_E0_EXECUTION_RUNNER_MODE,
      scenario,
      status,
      studyId,
      reportDir,
      executionRevision,
      runContractId: contract.contractId,
      runContractCodeRevision: contract.executionBinding.codeRevision,
      runContractSha256: contract.runContractSha256,
      enrollmentManifestSha256: enrollment.manifestSha256,
      taskManifestSha256: enrollment.taskManifestSha256,
      candidatePoolHash: enrollment.candidatePoolHash,
      enrollmentCohort: enrollment.enrollmentCohort,
      provider: C1_E0_PROVIDER,
      model: C1_E0_MODEL,
      endpoint: C1_E0_ENDPOINT,
      nodeRange: C1_NODE_RANGE,
      providerConfigHash: contract.executionBinding.providerConfigHash,
      providerPreparationProfileHash,
      responseSource: 'SCRIPTED_FAKE' as const,
      providerCalls: 0 as const,
      networkRequests: 0 as const,
      fakeProviderCallPermits: budget?.providerCalls ?? 0,
      responseCalls: allEvidence.length,
      toolExecutions: allEvidence.reduce((sum, row) => sum + row.toolCalls, 0),
      legsPlanned: C1_E0_TOTAL_LEG_COUNT as typeof C1_E0_TOTAL_LEG_COUNT,
      legsAttempted: publicLegs.filter((leg) => leg.status !== 'BLOCKED').length,
      legsCompleted: publicLegs.filter((leg) => leg.status === 'COMPLETED').length,
      blockedLegs: publicLegs.filter((leg) => leg.status === 'BLOCKED').length,
      studyTerminal,
      terminalReason,
      operatorSignal,
      budget,
      batchQualification,
      pairAdjudications: adjudications,
      legs: publicLegs,
      events,
      failures
    } satisfies Omit<C1E0ExecutionReport, 'artifacts'>
    try {
      artifacts = await writeE0Artifacts({
        reportDir,
        reportBase,
        evidence: allEvidence,
        doseObservations: allDoseObservations,
        pairs: adjudications,
        events,
        checkpoints: evidenceSink.checkpoints
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

  const budget = budgetGuard?.ledger ?? null
  return {
    runnerId: C1_E0_EXECUTION_RUNNER_ID,
    schemaVersion: C1_E0_EXECUTION_RUNNER_SCHEMA_VERSION,
    executionMode: C1_E0_EXECUTION_RUNNER_MODE,
    scenario,
    status: batchQualification.verdict,
    studyId,
    reportDir,
    executionRevision,
    runContractId: C1_E0_RUN_CONTRACT_ID,
    runContractCodeRevision: contract?.executionBinding.codeRevision ?? null,
    runContractSha256: contract?.runContractSha256 ?? null,
    enrollmentManifestSha256: enrollment?.manifestSha256 ?? null,
    taskManifestSha256: enrollment?.taskManifestSha256 ?? null,
    candidatePoolHash: enrollment?.candidatePoolHash ?? null,
    enrollmentCohort: enrollment?.enrollmentCohort ?? C1_E0_ENROLLMENT_COHORT,
    provider: C1_E0_PROVIDER,
    model: C1_E0_MODEL,
    endpoint: C1_E0_ENDPOINT,
    nodeRange: C1_NODE_RANGE,
    providerConfigHash: contract?.executionBinding.providerConfigHash ?? null,
    providerPreparationProfileHash,
    responseSource: 'SCRIPTED_FAKE',
    providerCalls: 0,
    networkRequests: 0,
    fakeProviderCallPermits: budget?.providerCalls ?? 0,
    responseCalls: allEvidence.length,
    toolExecutions: allEvidence.reduce((sum, row) => sum + row.toolCalls, 0),
    legsPlanned: C1_E0_TOTAL_LEG_COUNT,
    legsAttempted: publicLegs.filter((leg) => leg.status !== 'BLOCKED').length,
    legsCompleted: publicLegs.filter((leg) => leg.status === 'COMPLETED').length,
    blockedLegs: publicLegs.filter((leg) => leg.status === 'BLOCKED').length,
    studyTerminal,
    terminalReason,
    operatorSignal,
    budget: budget ?? emptyBudget(),
    batchQualification,
    pairAdjudications: adjudications,
    legs: publicLegs,
    events: Object.freeze(events),
    artifacts,
    failures: Object.freeze(failures)
  }
}
