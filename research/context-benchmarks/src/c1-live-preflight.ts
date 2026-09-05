import { EventEmitter } from 'node:events'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
import type {
  ModelRuntime,
  ProviderConfig,
  ProviderModelConfig
} from '@earendil-works/pi-coding-agent'
import {
  createRepresentation,
  planWorkingSet,
  seedUniverse,
  type ContextPlanningRequest,
  type ContextRepresentation,
  type ContextRepresentationNeed,
  type ContextTransition,
  type ContextUniverseRevision,
  type ContextWorkingSet,
  type RemovalRecord,
  type SourceLifecycleSignal,
  type TaskPhase
} from '@canvas-agent/context-runtime'
import {
  computeProviderConfigHash,
  prepareModelProvider,
  ProviderBindingError,
  STEP_PLAN_PROVIDER_PROFILE,
  type ProviderExperimentBinding
} from '@canvas-agent/pi-context-integration'
import type { PiMessageView } from '@canvas-agent/pi-context-integration'
import {
  activeMessagesHash,
  activeMessageFingerprint,
  analyzeNativeMessages,
  assertRewriteSafe,
  composeActiveRewrite,
  createRunKillSwitch,
  type RunKillSwitch
} from '@canvas-agent/pi-context-integration/experimental'
import { runProcess } from './fixture-generator'
import {
  C1_C_ASSIGNMENT_MATRIX_SHA256,
  C1_C_CONTRACT_SHA256,
  C1_C_PARENT_REVISION,
  C1_C_READINESS_ID,
  C1_C_TASK_MANIFEST_SHA256,
  C1_C_TREATMENT_REVISION,
  runC1TreatmentReadiness
} from './c1-treatment-readiness'

/**
 * C1-specific, credential-free readiness for the future live runner.
 *
 * This module has a credential-free preflight boundary. It runs the actual
 * observation -> policy-v0 -> Working Set -> Active composition path and the
 * strict provider-preparation code path, but injects a fake transport before
 * any network/provider call. The same leg executor is designed to receive a
 * real transport/provider response source only after the separate live gate.
 */

export const C1_LIVE_PREFLIGHT_ID = 'C1_LIVE_PREFLIGHT_V1'
export const C1_LIVE_PREFLIGHT_MODE = 'CREDENTIAL_FREE_NO_NETWORK'
export const C1_PROTOCOL_ID = 'C1_PROTOCOL_V1'
export const C1_RUN_CONTRACT_ID = 'C1_RUN_CONTRACT_V1'
export const C1_TASK_MANIFEST_ID = 'C1_A_MANIFEST_V1'
export const C1_PROVIDER_ID = 'step-plan'
export const C1_MODEL_ID = 'step-3.7-flash'
export const C1_PROVIDER_ENDPOINT = 'https://api.stepfun.com/step_plan/v1/chat/completions'
export const C1_NODE_RANGE = '>=24.0.0 <25.0.0'

export const C1_CONTRACT_RELATIVE_PATH =
  'research/context-benchmarks/c1/contracts/c1-run-contract-v1.json'
export const C1_MANIFEST_RELATIVE_PATH =
  'research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json'
export const C1_READINESS_RELATIVE_PATH =
  'research/context-benchmarks/c1/readiness/c1-treatment-readiness-v1.json'
export const C1_PROTOCOL_RELATIVE_PATH =
  'docs/plan/cspv-c1-comparative-effectiveness-protocol-2026-09-01.md'

export const C1_PREFLIGHT_ARTIFACT_NAMES = Object.freeze([
  'run-manifest.json',
  'provider-usage-ledger.jsonl',
  'transition-evidence.jsonl',
  'decision-evidence.jsonl',
  'tool-latency-evidence.jsonl',
  'outcome-evidence.jsonl',
  'replay-evidence.jsonl'
] as const)
export type C1PreflightArtifactName = (typeof C1_PREFLIGHT_ARTIFACT_NAMES)[number]

export type C1PreflightArm = 'NATIVE' | 'RUNTIME'
export type C1PreflightOrder = 'NATIVE_THEN_RUNTIME' | 'RUNTIME_THEN_NATIVE'

export type C1PreflightFailureCode =
  | 'NODE_RANGE_MISMATCH'
  | 'NOT_AUTHORIZED'
  | 'CONTRACT_BINDING_MISMATCH'
  | 'ASSIGNMENT_BINDING_MISMATCH'
  | 'MANIFEST_BINDING_MISMATCH'
  | 'READINESS_BINDING_MISMATCH'
  | 'FIXTURE_BINDING_MISMATCH'
  | 'WRITABLE_SCOPE_FAILURE'
  | 'IDENTITY_REUSE'
  | 'IDENTITY_INVALID'
  | 'PROVIDER_BINDING_MISMATCH'
  | 'PROVIDER_PREPARATION_FAILURE'
  | 'TREATMENT_INACTIVE'
  | 'MATERIALIZATION_FAILURE'
  | 'REWRITE_FAILURE'
  | 'NATIVE_CONTEXT_DRIFT'
  | 'RUNTIME_CONTEXT_UNCHANGED'
  | 'FALLBACK_ATTEMPTED'
  | 'USAGE_CONTRACT_MISMATCH'
  | 'BUDGET_BREACH'
  | 'DEADLINE_EXCEEDED'
  | 'KILL_SWITCH_BLOCKED'
  | 'REPLAY_MISMATCH'
  | 'EVIDENCE_WRITE_FAILURE'
  | 'HARNESS_CONTRACT_FAILURE'
  | 'PREFLIGHT_FAILURE'

export class C1PreflightFailure extends Error {
  constructor(
    readonly code: C1PreflightFailureCode,
    message: string
  ) {
    super(message)
    this.name = 'C1PreflightFailure'
  }
}

const C1_POLICY_VERSION = 'policy-v0-c1-live-preflight-v1'
export const C1_SYSTEM_INSTRUCTION =
  'Follow the frozen C1 task contract and preserve tool continuity.'
const C1_TOOL_STRUCTURE_FINGERPRINT = sha256Bytes(
  'c1-provider-tool-structures-v1|read|edit|bash|same-across-arms'
)
const C1_EXPECTED_PROVIDER_CONFIG_HASH = computeProviderConfigHash(STEP_PLAN_PROVIDER_PROFILE)

type JsonRecord = Record<string, unknown>

export interface C1ProviderToolDefinition {
  readonly type: 'function'
  readonly function: {
    readonly name: 'read' | 'edit' | 'bash'
    readonly description: string
    readonly parameters: Readonly<Record<string, unknown>>
  }
}

export interface C1ProviderNativeMetadata {
  readonly api: 'openai-completions'
  readonly reasoningFormat: 'text'
  readonly responseFormat: 'text'
  readonly streaming: false
}

export interface C1ProviderStructuralEnvelope {
  readonly systemInstruction: string
  readonly developerMessages: readonly string[]
  readonly tools: readonly C1ProviderToolDefinition[]
  readonly providerNativeMetadata: C1ProviderNativeMetadata
  readonly structuralFingerprint: string
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

/**
 * Frozen provider-facing structure for the C1 experiment. System/developer
 * instructions and tool definitions are executor-owned; an authorized
 * response source may serialize this envelope but may not replace it.
 */
export const C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE: C1ProviderStructuralEnvelope = deepFreeze({
  systemInstruction: C1_SYSTEM_INSTRUCTION,
  developerMessages: [],
  tools: [
    {
      type: 'function',
      function: {
        name: 'read',
        description: 'Read a repository source file.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit',
        description: 'Edit a repository source file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            oldText: { type: 'string' },
            newText: { type: 'string' }
          },
          required: ['path', 'oldText', 'newText'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'bash',
        description: 'Run a repository command.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
          additionalProperties: false
        }
      }
    }
  ],
  providerNativeMetadata: {
    api: 'openai-completions',
    reasoningFormat: 'text',
    responseFormat: 'text',
    streaming: false
  },
  structuralFingerprint: C1_TOOL_STRUCTURE_FINGERPRINT
})

function fail(code: C1PreflightFailureCode, message: string): never {
  throw new C1PreflightFailure(code, message)
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('PREFLIGHT_FAILURE', `${label} must be a JSON object`)
  }
  return value as JsonRecord
}

function asArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail('PREFLIGHT_FAILURE', `${label} must be a JSON array`)
  return value
}

function stringField(record: JsonRecord, key: string, label = key): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    fail('PREFLIGHT_FAILURE', `${label} must be a non-empty string`)
  }
  return value
}

function boolField(record: JsonRecord, key: string, label = key): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') fail('PREFLIGHT_FAILURE', `${label} must be boolean`)
  return value
}

function intField(record: JsonRecord, key: string, label = key): number {
  const value = record[key]
  if (!Number.isInteger(value)) fail('PREFLIGHT_FAILURE', `${label} must be an integer`)
  return value as number
}

function stringArrayField(record: JsonRecord, key: string, label = key): readonly string[] {
  return asArray(record[key], label).map((value, index) => {
    if (typeof value !== 'string') fail('PREFLIGHT_FAILURE', `${label}[${index}] must be a string`)
    return value
  })
}

function sha256Bytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) fail('PREFLIGHT_FAILURE', 'value is not JSON serializable')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as JsonRecord
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  fail('PREFLIGHT_FAILURE', `unsupported JSON value type ${typeof value}`)
}

function exactValue(
  record: JsonRecord,
  key: string,
  expected: unknown,
  label: string,
  code:
    | 'CONTRACT_BINDING_MISMATCH'
    | 'ASSIGNMENT_BINDING_MISMATCH'
    | 'MANIFEST_BINDING_MISMATCH' = 'CONTRACT_BINDING_MISMATCH'
): void {
  if (canonicalJson(record[key]) !== canonicalJson(expected)) {
    fail(code, `${label} does not match the frozen value`)
  }
}

export function computeC1ContractSha256(contract: unknown): string {
  const clone = JSON.parse(JSON.stringify(contract)) as JsonRecord
  const protocolBinding = asRecord(clone['protocolBinding'], 'contract.protocolBinding')
  protocolBinding['contractSha256'] = 'SELF'
  return sha256Bytes(canonicalJson(clone))
}

export function computeC1AssignmentMatrixSha256(assignmentMatrix: unknown): string {
  return sha256Bytes(canonicalJson(assignmentMatrix))
}

export function assertC1AssignmentMatrixBinding(
  assignmentMatrix: unknown,
  expectedHash: string = C1_C_ASSIGNMENT_MATRIX_SHA256
): void {
  if (computeC1AssignmentMatrixSha256(assignmentMatrix) !== expectedHash) {
    fail('ASSIGNMENT_BINDING_MISMATCH', 'assignment matrix does not match the frozen digest')
  }
}

export function nodeVersionSatisfiesC1Range(version: string = process.versions.node): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim())
  if (match === null) return false
  const major = Number.parseInt(match[1]!, 10)
  return major >= 24 && major < 25
}

function assertNodeVersion(version: string = process.versions.node): void {
  if (!nodeVersionSatisfiesC1Range(version)) {
    fail('NODE_RANGE_MISMATCH', `Node ${version} does not satisfy ${C1_NODE_RANGE}`)
  }
}

export type C1ProviderMetric =
  | {
      readonly status: 'REPORTED'
      readonly value: number
    }
  | {
      readonly status: 'UNAVAILABLE'
      readonly reason: 'NOT_REPORTED_BY_PROVIDER'
    }

export interface C1ProviderReportedUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: C1ProviderMetric
  readonly cacheWriteTokens: C1ProviderMetric
  readonly totalTokens: number
  readonly usageSource: 'PROVIDER_REPORTED'
}

function providerMetricField(record: JsonRecord, key: string): C1ProviderMetric {
  const value = record[key]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('USAGE_CONTRACT_MISMATCH', `provider usage ${key} must be a tagged metric`)
  }
  const metric = value as JsonRecord
  if (metric['status'] === 'REPORTED') {
    const reported = metric['value']
    if (!Number.isSafeInteger(reported) || (reported as number) < 0) {
      fail('USAGE_CONTRACT_MISMATCH', `provider usage ${key}.value must be a non-negative integer`)
    }
    if (Object.prototype.hasOwnProperty.call(metric, 'reason')) {
      fail('USAGE_CONTRACT_MISMATCH', `provider usage ${key}.REPORTED must not contain reason`)
    }
    return { status: 'REPORTED', value: reported as number }
  }
  if (metric['status'] === 'UNAVAILABLE') {
    if (metric['reason'] !== 'NOT_REPORTED_BY_PROVIDER') {
      fail(
        'USAGE_CONTRACT_MISMATCH',
        `provider usage ${key}.UNAVAILABLE must cite NOT_REPORTED_BY_PROVIDER`
      )
    }
    if (
      Object.prototype.hasOwnProperty.call(metric, 'value') ||
      Object.prototype.hasOwnProperty.call(metric, 'tokens')
    ) {
      fail('USAGE_CONTRACT_MISMATCH', `provider usage ${key}.UNAVAILABLE must not contain tokens`)
    }
    return { status: 'UNAVAILABLE', reason: 'NOT_REPORTED_BY_PROVIDER' }
  }
  fail('USAGE_CONTRACT_MISMATCH', `provider usage ${key} has an unknown metric status`)
}

/** Validate the amended normalized message_end usage boundary without inventing values. */
export function validateC1ProviderUsage(value: unknown): C1ProviderReportedUsage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('USAGE_CONTRACT_MISMATCH', 'provider usage must be an object')
  }
  const record = value as JsonRecord
  const numberField = (key: 'inputTokens' | 'outputTokens' | 'totalTokens'): number => {
    const candidate = record[key]
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 0) {
      fail('USAGE_CONTRACT_MISMATCH', `provider usage ${key} must be a non-negative integer`)
    }
    return candidate as number
  }
  if (record['usageSource'] !== 'PROVIDER_REPORTED') {
    fail('USAGE_CONTRACT_MISMATCH', 'provider usage must be marked PROVIDER_REPORTED')
  }
  return {
    inputTokens: numberField('inputTokens'),
    outputTokens: numberField('outputTokens'),
    cacheReadTokens: providerMetricField(record, 'cacheReadTokens'),
    cacheWriteTokens: providerMetricField(record, 'cacheWriteTokens'),
    totalTokens: numberField('totalTokens'),
    usageSource: 'PROVIDER_REPORTED'
  }
}

/** Normalized observations supplied by the Agent/Pi adapter to one C1 leg. */
export interface C1AgentObservation {
  readonly observationId: string
  readonly messages: readonly PiMessageView[]
  readonly taskPhase: TaskPhase
  readonly currentTargetSourceKeys: readonly string[]
  readonly excludedSourceKeys: readonly string[]
  readonly latestVerificationSourceKeys: readonly string[]
  readonly recentEvidenceSourceKeys: readonly string[]
  readonly sourceLifecycleSignals?: readonly SourceLifecycleSignal[]
  readonly removalHistory?: readonly RemovalRecord[]
  readonly representationNeeds?: readonly ContextRepresentationNeed[]
  readonly previousWorkingSetId: string | null
}

export interface C1StrictProviderBinding {
  readonly experimentBinding: ProviderExperimentBinding
  readonly providerConfigHash: string
  readonly dispose: () => void
}

export interface C1ProviderTransport {
  capture(request: C1ProviderBoundCapture): void
}

/**
 * Execute the real strict provider-preparation path against an in-memory Pi
 * ModelRuntime. The sentinel credential is deliberately local to this call;
 * no environment lookup, credential persistence, model call, or network is
 * performed by the readiness runner.
 */
export async function prepareC1StrictProvider(options: {
  readonly runIdentity: string
  readonly primaryProviderId?: string
  readonly requestedModelId?: string
  readonly allowFallback?: boolean
  readonly env?: Readonly<Record<string, string | undefined>>
}): Promise<C1StrictProviderBinding> {
  const runtime = new C1InMemoryProviderRuntime()
  try {
    const prepared = await prepareModelProvider(runtime as unknown as ModelRuntime, {
      executionMode: 'experiment-strict',
      runIdentity: options.runIdentity,
      primaryProviderId: options.primaryProviderId ?? C1_PROVIDER_ID,
      fallbackProviderId: 'none',
      requestedModelId: options.requestedModelId ?? C1_MODEL_ID,
      ...(options.allowFallback !== undefined ? { allowFallback: options.allowFallback } : {}),
      env: options.env ?? {
        STEP_PLAN_API_KEY: 'c1-preflight-in-memory-sentinel'
      }
    })
    const experimentBinding = prepared.experimentBinding
    if (experimentBinding === undefined) {
      throw new ProviderBindingError('provider_unavailable')
    }
    return {
      experimentBinding,
      providerConfigHash: experimentBinding.providerConfigHash,
      dispose: () => runtime.unregisterProvider(experimentBinding.actualProviderId)
    }
  } catch (error) {
    try {
      runtime.unregisterProvider(options.primaryProviderId ?? C1_PROVIDER_ID)
    } catch {
      // Cleanup is best effort; the original preparation error is authoritative.
    }
    throw error
  }
}

/** Minimal ModelRuntime seam used to exercise provider preparation offline. */
class C1InMemoryProviderRuntime {
  private readonly providers = new Map<string, ProviderConfig>()

  registerProvider(providerId: string, config: ProviderConfig): void {
    this.providers.set(providerId, config)
  }

  unregisterProvider(providerId: string): void {
    this.providers.delete(providerId)
  }

  async checkAuth(providerId: string): Promise<{ readonly type: 'api_key' } | undefined> {
    return this.providers.has(providerId) ? { type: 'api_key' } : undefined
  }

  getModel(providerId: string, modelId: string): ProviderModelConfig | undefined {
    const models = this.providers.get(providerId)?.models ?? []
    return models.find((model) => model.id === modelId)
  }
}

export function assertC1StrictProviderBinding(binding: ProviderExperimentBinding): void {
  if (
    binding.requestedProviderId !== C1_PROVIDER_ID ||
    binding.actualProviderId !== C1_PROVIDER_ID ||
    binding.requestedModelId !== C1_MODEL_ID ||
    binding.actualModelId !== C1_MODEL_ID ||
    binding.fallbackUsed !== false ||
    binding.providerConfigHash !== C1_EXPECTED_PROVIDER_CONFIG_HASH
  ) {
    fail(
      'PROVIDER_BINDING_MISMATCH',
      'provider/model/fallback/config binding is not the frozen C1 binding'
    )
  }
}

export interface C1PreflightTask {
  readonly taskId: string
  readonly stratum: string
  readonly title: string
  readonly fixtureVersion: string
  readonly fixturePath: string
  readonly fixtureRevision: {
    readonly baseRevision: string
    readonly fixtureTreeObjectId: string
    readonly fixtureContentSha256: string
  }
  readonly prompt: string
  readonly promptSha256: string
  readonly objectiveOracle: C1OracleSpec
  readonly regressionOracle: C1OracleSpec
  readonly expectedWritablePaths: readonly string[]
  readonly relevantSources: readonly string[]
  readonly distractorSources: readonly string[]
  readonly requiredLaterSources: readonly string[]
}

/**
 * The executable oracle contract frozen by C1-A. The live runner resolves
 * `node` to the current Node executable, but never accepts an arbitrary
 * command from the manifest.
 */
export interface C1OracleSpec {
  readonly command: 'node'
  readonly args: readonly string[]
  readonly expectedExitCode: number
  readonly timeoutMs: number
}

export interface C1Assignment {
  readonly taskId: string
  readonly stratum: string
  readonly pairId: string
  readonly pairOrdinal: number
  readonly order: C1PreflightOrder
  readonly armSequence: readonly [C1PreflightArm, C1PreflightArm]
  readonly nativeRunIdTemplate: string
  readonly runtimeRunIdTemplate: string
}

export interface C1FrozenStudy {
  readonly repoRoot: string
  readonly contractPath: string
  readonly manifestPath: string
  readonly protocolPath: string
  readonly contractSha256: typeof C1_C_CONTRACT_SHA256
  readonly assignmentMatrixSha256: typeof C1_C_ASSIGNMENT_MATRIX_SHA256
  readonly taskManifestSha256: typeof C1_C_TASK_MANIFEST_SHA256
  readonly manifestBaseRevision: string
  readonly tasks: readonly C1PreflightTask[]
  readonly assignments: readonly C1Assignment[]
  readonly provider: typeof C1_PROVIDER_ID
  readonly model: typeof C1_MODEL_ID
  readonly endpoint: typeof C1_PROVIDER_ENDPOINT
  readonly perLegBudgets: {
    readonly maxProviderCalls: 24
    readonly maxToolCalls: 96
    readonly maxWallClockMs: 600000
  }
  readonly studyBudgets: {
    readonly maxProviderCalls: 1536
    readonly maxToolCalls: 6144
    readonly maxWallClockMs: 43200000
    readonly maxLegs: 64
  }
}

function parseOracleSpec(value: unknown, label: string): C1OracleSpec {
  const record = asRecord(value, label)
  const command = stringField(record, 'command', `${label}.command`)
  if (command !== 'node') {
    fail('MANIFEST_BINDING_MISMATCH', `${label}.command must be node`)
  }
  const args = stringArrayField(record, 'args', `${label}.args`)
  if (args.length === 0) {
    fail('MANIFEST_BINDING_MISMATCH', `${label}.args must not be empty`)
  }
  const expectedExitCode = intField(
    record,
    'expectedExitCode',
    `${label}.expectedExitCode`
  )
  const timeoutMs = intField(record, 'timeoutMs', `${label}.timeoutMs`)
  if (timeoutMs < 1) {
    fail('MANIFEST_BINDING_MISMATCH', `${label}.timeoutMs must be positive`)
  }
  return {
    command,
    args,
    expectedExitCode,
    timeoutMs
  }
}

function parseTask(value: unknown): C1PreflightTask {
  const record = asRecord(value, 'manifest task')
  const fixtureRevision = asRecord(record['fixtureRevision'], 'task.fixtureRevision')
  const prompt = stringField(record, 'prompt', 'task.prompt')
  const promptSha256 = stringField(record, 'promptSha256', 'task.promptSha256')
  if (sha256Bytes(prompt) !== promptSha256) {
    fail('MANIFEST_BINDING_MISMATCH', `prompt hash mismatch for ${stringField(record, 'taskId')}`)
  }
  return {
    taskId: stringField(record, 'taskId'),
    stratum: stringField(record, 'stratum'),
    title: stringField(record, 'title'),
    fixtureVersion: stringField(record, 'fixtureVersion'),
    fixturePath: stringField(record, 'fixturePath'),
    fixtureRevision: {
      baseRevision: stringField(
        fixtureRevision,
        'baseRevision',
        'task.fixtureRevision.baseRevision'
      ),
      fixtureTreeObjectId: stringField(
        fixtureRevision,
        'fixtureTreeObjectId',
        'task.fixtureRevision.fixtureTreeObjectId'
      ),
      fixtureContentSha256: stringField(
        fixtureRevision,
        'fixtureContentSha256',
        'task.fixtureRevision.fixtureContentSha256'
      )
    },
    prompt,
    promptSha256,
    objectiveOracle: parseOracleSpec(
      record['objectiveOracle'],
      `task ${stringField(record, 'taskId')}.objectiveOracle`
    ),
    regressionOracle: parseOracleSpec(
      record['regressionOracle'],
      `task ${stringField(record, 'taskId')}.regressionOracle`
    ),
    expectedWritablePaths: stringArrayField(record, 'expectedWritablePaths'),
    relevantSources: stringArrayField(record, 'relevantSources'),
    distractorSources: stringArrayField(record, 'distractorSources'),
    requiredLaterSources: stringArrayField(record, 'requiredLaterSources')
  }
}

function parseAssignment(value: unknown): C1Assignment {
  const record = asRecord(value, 'assignment row')
  const order = stringField(record, 'order')
  if (order !== 'NATIVE_THEN_RUNTIME' && order !== 'RUNTIME_THEN_NATIVE') {
    fail('ASSIGNMENT_BINDING_MISMATCH', `unsupported assignment order ${order}`)
  }
  const armSequence = stringArrayField(record, 'armSequence')
  if (
    armSequence.length !== 2 ||
    !armSequence.includes('NATIVE') ||
    !armSequence.includes('RUNTIME') ||
    armSequence[0] !== (order === 'NATIVE_THEN_RUNTIME' ? 'NATIVE' : 'RUNTIME')
  ) {
    fail('ASSIGNMENT_BINDING_MISMATCH', 'assignment armSequence does not match order')
  }
  return {
    taskId: stringField(record, 'taskId'),
    stratum: stringField(record, 'stratum'),
    pairId: stringField(record, 'pairId'),
    pairOrdinal: intField(record, 'pairOrdinal'),
    order,
    armSequence: armSequence as [C1PreflightArm, C1PreflightArm],
    nativeRunIdTemplate: stringField(record, 'nativeRunIdTemplate'),
    runtimeRunIdTemplate: stringField(record, 'runtimeRunIdTemplate')
  }
}

function validateAssignmentMatrix(
  assignments: readonly C1Assignment[],
  tasks: readonly C1PreflightTask[]
): void {
  if (assignments.length !== 32) {
    fail(
      'ASSIGNMENT_BINDING_MISMATCH',
      `expected 32 assignment rows, received ${assignments.length}`
    )
  }
  const taskIds = new Set(tasks.map((task) => task.taskId))
  const pairIds = new Set<string>()
  const perTask = new Map<
    string,
    {
      rows: number
      nativeThenRuntime: number
      runtimeThenNative: number
      ordinals: Set<number>
    }
  >()
  for (const assignment of assignments) {
    if (!taskIds.has(assignment.taskId)) {
      fail('ASSIGNMENT_BINDING_MISMATCH', `assignment references unknown task ${assignment.taskId}`)
    }
    const task = tasks.find((candidate) => candidate.taskId === assignment.taskId)
    if (task === undefined || task.stratum !== assignment.stratum) {
      fail('ASSIGNMENT_BINDING_MISMATCH', `assignment stratum mismatch for ${assignment.pairId}`)
    }
    if (pairIds.has(assignment.pairId)) {
      fail('ASSIGNMENT_BINDING_MISMATCH', `duplicate pair ${assignment.pairId}`)
    }
    pairIds.add(assignment.pairId)
    if (!new RegExp(`^${assignment.taskId}-p0[1-8]$`).test(assignment.pairId)) {
      fail('ASSIGNMENT_BINDING_MISMATCH', `invalid pair id ${assignment.pairId}`)
    }
    if (assignment.pairOrdinal < 1 || assignment.pairOrdinal > 8) {
      fail('ASSIGNMENT_BINDING_MISMATCH', `invalid pair ordinal ${assignment.pairOrdinal}`)
    }
    const state = perTask.get(assignment.taskId) ?? {
      rows: 0,
      nativeThenRuntime: 0,
      runtimeThenNative: 0,
      ordinals: new Set<number>()
    }
    state.rows += 1
    state.ordinals.add(assignment.pairOrdinal)
    if (assignment.order === 'NATIVE_THEN_RUNTIME') state.nativeThenRuntime += 1
    else state.runtimeThenNative += 1
    perTask.set(assignment.taskId, state)
    const expectedNative = `c1-<yyyymmdd>-${assignment.pairId}-native-<8hex>`
    const expectedRuntime = `c1-<yyyymmdd>-${assignment.pairId}-runtime-<8hex>`
    if (
      assignment.nativeRunIdTemplate !== expectedNative ||
      assignment.runtimeRunIdTemplate !== expectedRuntime
    ) {
      fail('ASSIGNMENT_BINDING_MISMATCH', `run-id template mismatch for ${assignment.pairId}`)
    }
  }
  for (const task of tasks) {
    const state = perTask.get(task.taskId)
    if (
      state === undefined ||
      state.rows !== 8 ||
      state.nativeThenRuntime !== 4 ||
      state.runtimeThenNative !== 4 ||
      state.ordinals.size !== 8
    ) {
      fail('ASSIGNMENT_BINDING_MISMATCH', `quota mismatch for ${task.taskId}`)
    }
  }
  const nativeThenRuntime = assignments.filter(
    (item) => item.order === 'NATIVE_THEN_RUNTIME'
  ).length
  const runtimeThenNative = assignments.filter(
    (item) => item.order === 'RUNTIME_THEN_NATIVE'
  ).length
  if (nativeThenRuntime !== 16 || runtimeThenNative !== 16) {
    fail('ASSIGNMENT_BINDING_MISMATCH', 'global AB/BA quota mismatch')
  }
}

function exactNumber(record: JsonRecord, key: string, expected: number, label: string): void {
  const actual = intField(record, key, label)
  if (actual !== expected)
    fail('CONTRACT_BINDING_MISMATCH', `${label} must be ${expected}, received ${actual}`)
}

/** Load only the explicitly frozen C1 namespace and validate its hashes/shape. */
export async function loadC1FrozenStudy(repoRoot: string): Promise<C1FrozenStudy> {
  const contractPath = resolve(repoRoot, C1_CONTRACT_RELATIVE_PATH)
  const manifestPath = resolve(repoRoot, C1_MANIFEST_RELATIVE_PATH)
  const readinessPath = resolve(repoRoot, C1_READINESS_RELATIVE_PATH)
  const protocolPath = resolve(repoRoot, C1_PROTOCOL_RELATIVE_PATH)
  const [contractText, manifestText, readinessText] = await Promise.all([
    readFile(contractPath, 'utf8'),
    readFile(manifestPath, 'utf8'),
    readFile(readinessPath, 'utf8')
  ])
  const contract = asRecord(JSON.parse(contractText) as unknown, 'C1 run contract')
  const manifest = asRecord(JSON.parse(manifestText) as unknown, 'C1 task manifest')
  const readiness = asRecord(JSON.parse(readinessText) as unknown, 'C1 readiness artifact')
  const readinessBinding = asRecord(readiness['contractBinding'], 'readiness.contractBinding')
  if (
    stringField(contract, 'contractId') !== C1_RUN_CONTRACT_ID ||
    stringField(contract, 'status') !== 'FROZEN'
  ) {
    fail('CONTRACT_BINDING_MISMATCH', 'C1 run contract is not the frozen contract')
  }
  if (
    stringField(manifest, 'manifestId') !== 'c1-effectiveness-v1' ||
    stringField(manifest, 'status') !== 'FROZEN'
  ) {
    fail('MANIFEST_BINDING_MISMATCH', 'C1 task manifest is not frozen')
  }
  if (
    stringField(readiness, 'readinessId') !== C1_C_READINESS_ID ||
    stringField(readiness, 'status') !== 'PASS' ||
    stringField(readiness, 'overallVerdict') !== 'PASS' ||
    stringField(readiness, 'executionMode') !== C1_LIVE_PREFLIGHT_MODE ||
    intField(readiness, 'providerCalls') !== 0 ||
    stringField(readinessBinding, 'contractId') !== C1_RUN_CONTRACT_ID ||
    stringField(readinessBinding, 'contractSha256') !== C1_C_CONTRACT_SHA256 ||
    stringField(readinessBinding, 'assignmentMatrixSha256') !== C1_C_ASSIGNMENT_MATRIX_SHA256 ||
    stringField(readinessBinding, 'taskManifestSha256') !== C1_C_TASK_MANIFEST_SHA256 ||
    stringField(readinessBinding, 'parentRevision') !== C1_C_PARENT_REVISION ||
    stringField(readinessBinding, 'treatmentRevision') !== C1_C_TREATMENT_REVISION
  ) {
    fail(
      'READINESS_BINDING_MISMATCH',
      'C1-C readiness artifact is not a passing zero-provider artifact'
    )
  }
  const protocolBinding = asRecord(contract['protocolBinding'], 'contract.protocolBinding')
  const executionBinding = asRecord(contract['executionBinding'], 'contract.executionBinding')
  const armBinding = asRecord(contract['armBinding'], 'contract.armBinding')
  const design = asRecord(contract['design'], 'contract.design')
  const randomization = asRecord(contract['randomization'], 'contract.randomization')
  const taskPolicy = asRecord(contract['taskManifestPolicy'], 'contract.taskManifestPolicy')
  const runIdentity = asRecord(contract['runIdentity'], 'contract.runIdentity')
  const providerUsage = asRecord(contract['providerUsage'], 'contract.providerUsage')
  const evidenceContract = asRecord(contract['evidenceContract'], 'contract.evidenceContract')
  const authorization = asRecord(contract['authorization'], 'contract.authorization')
  const budgets = asRecord(contract['budgets'], 'contract.budgets')
  const perLeg = asRecord(budgets['perLeg'], 'contract.budgets.perLeg')
  const study = asRecord(budgets['study'], 'contract.budgets.study')
  const expectedContractHash = stringField(protocolBinding, 'contractSha256')
  if (
    expectedContractHash !== C1_C_CONTRACT_SHA256 ||
    computeC1ContractSha256(contract) !== expectedContractHash
  ) {
    fail('CONTRACT_BINDING_MISMATCH', 'frozen C1 contract hash mismatch')
  }
  const expectedManifestHash = stringField(protocolBinding, 'taskManifestSha256')
  if (
    expectedManifestHash !== C1_C_TASK_MANIFEST_SHA256 ||
    sha256Bytes(manifestText) !== expectedManifestHash
  ) {
    fail('MANIFEST_BINDING_MISMATCH', 'frozen C1 task manifest hash mismatch')
  }
  const assignmentMatrix = randomization['assignmentMatrix']
  const expectedAssignmentHash = stringField(protocolBinding, 'assignmentMatrixSha256')
  if (
    expectedAssignmentHash !== C1_C_ASSIGNMENT_MATRIX_SHA256 ||
    stringField(randomization, 'assignmentMatrixHash') !== expectedAssignmentHash
  ) {
    fail('ASSIGNMENT_BINDING_MISMATCH', 'frozen C1 assignment matrix hash mismatch')
  }
  assertC1AssignmentMatrixBinding(assignmentMatrix, expectedAssignmentHash)
  if (
    stringField(protocolBinding, 'protocolId') !== C1_PROTOCOL_ID ||
    stringField(protocolBinding, 'protocolPath') !== C1_PROTOCOL_RELATIVE_PATH ||
    stringField(protocolBinding, 'taskManifestId') !== C1_TASK_MANIFEST_ID ||
    stringField(protocolBinding, 'taskManifestPath') !== C1_MANIFEST_RELATIVE_PATH ||
    stringField(protocolBinding, 'manifestBaseRevision') !==
      'e6763734934f3b6cac6bf65df3dbd94d57f2dc59'
  ) {
    fail('CONTRACT_BINDING_MISMATCH', 'C1 protocol binding points outside the frozen C1 artifacts')
  }
  if (
    stringField(executionBinding, 'provider') !== C1_PROVIDER_ID ||
    stringField(executionBinding, 'model') !== C1_MODEL_ID ||
    stringField(executionBinding, 'baseUrl') !== 'https://api.stepfun.com/step_plan/v1' ||
    stringField(executionBinding, 'requestPath') !== '/chat/completions' ||
    stringField(executionBinding, 'endpoint') !== C1_PROVIDER_ENDPOINT ||
    stringField(executionBinding, 'nodeRange') !== C1_NODE_RANGE ||
    stringField(executionBinding, 'executionMode') !== 'experiment-strict' ||
    stringField(executionBinding, 'fallback') !== 'NONE' ||
    stringField(executionBinding, 'credentialEnv') !== 'STEP_PLAN_API_KEY' ||
    stringField(executionBinding, 'credentialPersistence') !== 'MEMORY_ONLY' ||
    stringField(executionBinding, 'readinessArtifact') !== 'C1-C_TREATMENT_READINESS_V1' ||
    boolField(executionBinding, 'providerConfigHashExcludesCredential') !== true
  ) {
    fail('CONTRACT_BINDING_MISMATCH', 'C1 provider binding drifted from the frozen contract')
  }
  exactValue(executionBinding, 'codeRevision', 'PENDING_C1_C', 'executionBinding.codeRevision')
  exactValue(
    executionBinding,
    'exactTreatmentRevisionRequiredBeforeLive',
    true,
    'executionBinding.exactTreatmentRevisionRequiredBeforeLive'
  )
  exactValue(
    armBinding,
    'native',
    {
      contextStrategy: 'NATIVE_UNMANAGED',
      modelFacingSemanticContext: 'UNCHANGED_NATIVE_BASELINE',
      lifecycleRewrite: false,
      metadataObservationAllowed: true
    },
    'armBinding.native'
  )
  exactValue(
    armBinding,
    'runtime',
    {
      contextStrategy: 'CONTEXT_RUNTIME_FROZEN_POLICY',
      modelFacingSemanticContext: 'WORKING_SET_MATERIALIZATION',
      mustDifferWhenEligible: true,
      systemDeveloperToolProviderNativeStructuresPreserved: true,
      silentNativeFallback: false,
      scriptedLifecycleInjection: false
    },
    'armBinding.runtime'
  )
  exactValue(
    armBinding,
    'primaryIndependentVariable',
    'context_management_strategy',
    'armBinding.primaryIndependentVariable'
  )
  exactValue(
    randomization,
    'algorithm',
    "SHA-256(seed + ':' + taskId + ':' + pairId), ascending digest order within task; first four receive NATIVE_THEN_RUNTIME and last four receive RUNTIME_THEN_NATIVE",
    'randomization.algorithm'
  )
  exactValue(randomization, 'seed', 'c1-feasibility-v1-order-seed-20260901', 'randomization.seed')
  exactValue(randomization, 'seedMayChangeQuota', false, 'randomization.seedMayChangeQuota')
  exactValue(
    randomization,
    'quotaPerStratum',
    { pairs: 8, nativeThenRuntime: 4, runtimeThenNative: 4 },
    'randomization.quotaPerStratum'
  )
  exactValue(
    randomization,
    'globalQuota',
    { nativeThenRuntime: 16, runtimeThenNative: 16 },
    'randomization.globalQuota'
  )
  exactValue(
    randomization,
    'matrixFrozenBeforeFirstProviderCall',
    true,
    'randomization.matrixFrozenBeforeFirstProviderCall'
  )
  exactValue(
    runIdentity,
    'studyIdFormat',
    'c1-<yyyymmdd>-c1-feasibility-v1-<8hex>',
    'runIdentity.studyIdFormat'
  )
  exactValue(
    runIdentity,
    'runIdFormat',
    'c1-<yyyymmdd>-<pairId>-<arm>-<8hex>',
    'runIdentity.runIdFormat'
  )
  for (const key of [
    'freshStudyRequired',
    'freshRunRequired',
    'singleUse',
    'terminalNeverResume',
    'overwriteExistingRunId',
    'retryUntilSuccess',
    'crossArmStateSharing',
    'providerRebindingAfterStart',
    'identityClaimBeforeFirstProviderCall'
  ]) {
    const expected = [
      'overwriteExistingRunId',
      'retryUntilSuccess',
      'crossArmStateSharing',
      'providerRebindingAfterStart'
    ].includes(key)
      ? false
      : true
    exactValue(runIdentity, key, expected, `runIdentity.${key}`)
  }
  exactValue(providerUsage, 'source', 'PROVIDER_REPORTED_MESSAGE_END', 'providerUsage.source')
  exactValue(
    providerUsage,
    'requiredFields',
    [
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'totalTokens',
      'usageSource'
    ],
    'providerUsage.requiredFields'
  )
  exactValue(
    providerUsage,
    'usageSourceRequired',
    'PROVIDER_REPORTED',
    'providerUsage.usageSourceRequired'
  )
  exactValue(
    providerUsage,
    'costSourceAllowed',
    ['PROVIDER_REPORTED', 'UNAVAILABLE'],
    'providerUsage.costSourceAllowed'
  )
  for (const key of [
    'localEstimateAsProviderUsage',
    'rawPayloadPersistence',
    'promptPersistence',
    'responsePersistence',
    'credentialPersistence'
  ]) {
    exactValue(providerUsage, key, false, `providerUsage.${key}`)
  }
  exactValue(evidenceContract, 'metadataOnly', true, 'evidenceContract.metadataOnly')
  exactValue(
    evidenceContract,
    'stableJoinKeys',
    ['studyId', 'runId', 'taskId', 'stratum', 'pairId', 'arm', 'turnId', 'modelCallId'],
    'evidenceContract.stableJoinKeys'
  )
  exactValue(
    evidenceContract,
    'requiredArtifacts',
    [
      'run_manifest',
      'provider_usage_ledger',
      'transition_evidence',
      'decision_evidence',
      'tool_latency_evidence',
      'outcome_evidence',
      'replay_evidence'
    ],
    'evidenceContract.requiredArtifacts'
  )
  for (const key of [
    'rawPromptStored',
    'rawResponseStored',
    'rawProviderPayloadStored',
    'credentialsStored',
    'authorizationHeadersStored',
    'replayMismatchIsHardFailure',
    'evidenceWriteFailureIsHardFailure'
  ]) {
    const expected = ['replayMismatchIsHardFailure', 'evidenceWriteFailureIsHardFailure'].includes(
      key
    )
      ? true
      : false
    exactValue(evidenceContract, key, expected, `evidenceContract.${key}`)
  }
  exactValue(
    authorization,
    'providerCallsDuringC1BDesignAndFreeze',
    0,
    'authorization.providerCallsDuringC1BDesignAndFreeze'
  )
  exactValue(authorization, 'c1LiveAuthorized', false, 'authorization.c1LiveAuthorized')
  exactValue(authorization, 'c1CReadinessRequired', true, 'authorization.c1CReadinessRequired')
  exactValue(
    authorization,
    'separateLeadAuthorizationRequired',
    true,
    'authorization.separateLeadAuthorizationRequired'
  )
  exactValue(authorization, 'cr004Authorized', false, 'authorization.cr004Authorized')
  exactValue(authorization, 'waveAAuthorized', false, 'authorization.waveAAuthorized')
  exactValue(authorization, 'waveBAuthorized', false, 'authorization.waveBAuthorized')
  exactValue(
    budgets,
    'breachAction',
    'TERMINAL_PRESERVE_EVIDENCE_NO_RESUME_NO_NEXT_LEG',
    'budgets.breachAction'
  )
  exactValue(
    budgets,
    'providerCallCounterSeam',
    'OUTBOUND_PROVIDER_TRANSPORT',
    'budgets.providerCallCounterSeam'
  )
  exactValue(
    budgets,
    'assistantMessagesAreNotCallSubstitute',
    true,
    'budgets.assistantMessagesAreNotCallSubstitute'
  )
  exactNumber(design, 'strataCount', 4, 'design.strataCount')
  exactNumber(design, 'pairsPerStratum', 8, 'design.pairsPerStratum')
  exactNumber(design, 'totalMatchedPairs', 32, 'design.totalMatchedPairs')
  exactNumber(design, 'nativeLegs', 32, 'design.nativeLegs')
  exactNumber(design, 'runtimeLegs', 32, 'design.runtimeLegs')
  exactNumber(design, 'totalLiveLegs', 64, 'design.totalLiveLegs')
  exactNumber(design, 'maxConcurrency', 1, 'design.maxConcurrency')
  exactNumber(perLeg, 'maxProviderCalls', 24, 'budgets.perLeg.maxProviderCalls')
  exactNumber(perLeg, 'maxToolCalls', 96, 'budgets.perLeg.maxToolCalls')
  exactNumber(perLeg, 'maxWallClockMs', 600000, 'budgets.perLeg.maxWallClockMs')
  exactNumber(study, 'maxProviderCalls', 1536, 'budgets.study.maxProviderCalls')
  exactNumber(study, 'maxToolCalls', 6144, 'budgets.study.maxToolCalls')
  exactNumber(study, 'maxWallClockMs', 43200000, 'budgets.study.maxWallClockMs')
  exactNumber(study, 'maxConcurrency', 1, 'budgets.study.maxConcurrency')
  if (
    boolField(taskPolicy, 'priorEvidenceAdmissible') ||
    boolField(taskPolicy, 'fixtureMutationAllowed') ||
    boolField(taskPolicy, 'promptMutationAllowed') ||
    boolField(taskPolicy, 'oracleMutationAllowed') ||
    boolField(taskPolicy, 'c0LifecycleAdapterAllowed')
  ) {
    fail(
      'CONTRACT_BINDING_MISMATCH',
      'C1 task policy permits a forbidden mutation or prior evidence'
    )
  }
  if (
    stringField(manifest, 'protocol') !== C1_PROTOCOL_ID ||
    intField(manifest, 'taskCount') !== 4
  ) {
    fail('MANIFEST_BINDING_MISMATCH', 'C1 manifest header mismatch')
  }
  exactValue(
    manifest,
    'strata',
    [
      'localized_investigation_distractors',
      'multi_file_multi_source',
      'failure_diagnosis_recovery',
      'phase_transition_delayed_context'
    ],
    'manifest.strata',
    'MANIFEST_BINDING_MISMATCH'
  )
  if ((await stat(protocolPath)).isFile() === false) {
    fail('CONTRACT_BINDING_MISMATCH', `frozen protocol is missing at ${C1_PROTOCOL_RELATIVE_PATH}`)
  }
  const taskManifestPolicyIds = stringArrayField(taskPolicy, 'taskIds')
  const tasks = asArray(manifest['tasks'], 'manifest.tasks').map(parseTask)
  if (
    tasks.length !== 4 ||
    tasks.map((task) => task.taskId).join('|') !== taskManifestPolicyIds.join('|')
  ) {
    fail(
      'MANIFEST_BINDING_MISMATCH',
      'C1 task order or count does not match the frozen contract policy'
    )
  }
  for (const task of tasks) {
    if (
      task.fixtureRevision.baseRevision !== stringField(protocolBinding, 'manifestBaseRevision')
    ) {
      fail('FIXTURE_BINDING_MISMATCH', `fixture base revision mismatch for ${task.taskId}`)
    }
  }
  const assignments = asArray(assignmentMatrix, 'contract.randomization.assignmentMatrix').map(
    parseAssignment
  )
  validateAssignmentMatrix(assignments, tasks)
  return {
    repoRoot,
    contractPath: contractPath,
    manifestPath,
    protocolPath,
    contractSha256: C1_C_CONTRACT_SHA256,
    assignmentMatrixSha256: C1_C_ASSIGNMENT_MATRIX_SHA256,
    taskManifestSha256: C1_C_TASK_MANIFEST_SHA256,
    manifestBaseRevision: stringField(protocolBinding, 'manifestBaseRevision'),
    tasks,
    assignments,
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    perLegBudgets: {
      maxProviderCalls: 24,
      maxToolCalls: 96,
      maxWallClockMs: 600000
    },
    studyBudgets: {
      maxProviderCalls: 1536,
      maxToolCalls: 6144,
      maxWallClockMs: 43200000,
      maxLegs: 64
    }
  }
}

async function walkFixtureFiles(root: string, prefix = ''): Promise<readonly string[]> {
  const entries = (await readdir(join(root, prefix), { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name)
  )
  const files: string[] = []
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isSymbolicLink())
      fail('FIXTURE_BINDING_MISMATCH', `fixture symlink is not admissible: ${rel}`)
    if (entry.isDirectory()) files.push(...(await walkFixtureFiles(root, rel)))
    else if (entry.isFile()) files.push(rel)
    else fail('FIXTURE_BINDING_MISMATCH', `unsupported fixture entry: ${rel}`)
  }
  return files.sort()
}

export interface C1FixtureContentSummary {
  readonly sha256: string
  readonly fileCount: number
  readonly files: readonly string[]
}

/** The C1-A frozen fixture content hash: sorted `<file hash>  <relative path>` plus a newline. */
export async function computeC1FixtureContentSummary(
  root: string
): Promise<C1FixtureContentSummary> {
  const files = await walkFixtureFiles(root)
  const rows: string[] = []
  for (const rel of files) {
    rows.push(`${sha256Bytes(await readFile(join(root, rel)))}  ${rel}`)
  }
  return {
    sha256: sha256Bytes(`${rows.join('\n')}\n`),
    fileCount: files.length,
    files
  }
}

async function copyFixtureDirectory(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  for (const rel of await walkFixtureFiles(source)) {
    const target = join(destination, rel)
    await mkdir(resolve(target, '..'), { recursive: true })
    await writeFile(target, await readFile(join(source, rel)))
  }
}

export async function materializeFreshC1Fixture(source: string): Promise<{
  readonly path: string
  readonly cleanup: () => Promise<void>
}> {
  const path = await mkdtemp(join(tmpdir(), 'canvas-c1-leg-'))
  try {
    await copyFixtureDirectory(source, path)
    return {
      path,
      cleanup: async () => rm(path, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(path, { recursive: true, force: true })
    throw error
  }
}

async function gitTreeObjectId(
  repoRoot: string,
  revision: string,
  fixturePath: string
): Promise<string> {
  const result = await runProcess('git', ['rev-parse', `${revision}:${fixturePath}`], {
    cwd: repoRoot,
    timeoutMs: 30000
  })
  if (result.exitCode !== 0 || result.timedOut || result.outputLimitExceeded) {
    fail(
      'FIXTURE_BINDING_MISMATCH',
      `cannot resolve frozen fixture tree ${revision}:${fixturePath}`
    )
  }
  const tree = result.stdout.trim()
  if (!/^[0-9a-f]{40}$/.test(tree))
    fail('FIXTURE_BINDING_MISMATCH', `invalid fixture tree object ${tree}`)
  return tree
}

export async function verifyC1FixtureBinding(
  study: C1FrozenStudy,
  task: C1PreflightTask
): Promise<{
  readonly sourcePath: string
  readonly contentSummary: C1FixtureContentSummary
}> {
  const sourcePath = resolve(study.repoRoot, task.fixturePath)
  if (!(await stat(sourcePath)).isDirectory()) {
    fail('FIXTURE_BINDING_MISMATCH', `fixture directory missing for ${task.taskId}`)
  }
  const contentSummary = await computeC1FixtureContentSummary(sourcePath)
  if (contentSummary.sha256 !== task.fixtureRevision.fixtureContentSha256) {
    fail('FIXTURE_BINDING_MISMATCH', `fixture content hash mismatch for ${task.taskId}`)
  }
  const tree = await gitTreeObjectId(
    study.repoRoot,
    task.fixtureRevision.baseRevision,
    task.fixturePath
  )
  if (tree !== task.fixtureRevision.fixtureTreeObjectId) {
    fail('FIXTURE_BINDING_MISMATCH', `fixture tree object mismatch for ${task.taskId}`)
  }
  return { sourcePath, contentSummary }
}

export async function snapshotC1Fixture(root: string): Promise<ReadonlyMap<string, string>> {
  const snapshot = new Map<string, string>()
  for (const rel of await walkFixtureFiles(root))
    snapshot.set(rel, sha256Bytes(await readFile(join(root, rel))))
  return snapshot
}

export function changedC1FixturePaths(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>
): readonly string[] {
  const changed = new Set<string>()
  for (const [rel, hash] of after) if (before.get(rel) !== hash) changed.add(rel)
  for (const rel of before.keys()) if (!after.has(rel)) changed.add(rel)
  return [...changed].sort()
}

async function simulateExpectedWritableChange(
  sandbox: string,
  expectedWritablePath: string
): Promise<readonly string[]> {
  const target = resolve(sandbox, expectedWritablePath)
  if (!(target === sandbox || target.startsWith(`${sandbox}${sep}`))) {
    fail(
      'FIXTURE_BINDING_MISMATCH',
      `expected writable path escapes fixture sandbox: ${expectedWritablePath}`
    )
  }
  const before = await snapshotC1Fixture(sandbox)
  const existing = await readFile(target, 'utf8').catch(() => '')
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, `${existing}\n/* C1 preflight simulated writable change */\n`, 'utf8')
  const after = await snapshotC1Fixture(sandbox)
  return changedC1FixturePaths(before, after)
}

export function writableScopePass(
  changedPaths: readonly string[],
  expectedWritablePaths: readonly string[]
): boolean {
  return (
    changedPaths.length > 0 && changedPaths.every((path) => expectedWritablePaths.includes(path))
  )
}

export interface C1PreflightIdentity {
  readonly studyId: string
  readonly dateToken: string
}

function dateTokenOf(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '')
}

export function createC1PreflightIdentity(now: Date = new Date()): C1PreflightIdentity {
  const dateToken = dateTokenOf(now)
  return {
    dateToken,
    studyId: `c1-${dateToken}-c1-feasibility-v1-${randomBytes(4).toString('hex')}`
  }
}

function assertIdentitySegment(value: string, kind: 'study' | 'run'): void {
  if (
    value.trim() === '' ||
    value === '.' ||
    value === '..' ||
    basename(value) !== value ||
    /[\\/]/.test(value)
  ) {
    fail('IDENTITY_INVALID', `${kind} identity is not a safe path segment`)
  }
  const pattern =
    kind === 'study'
      ? /^c1-\d{8}-c1-feasibility-v1-[0-9a-f]{8}$/
      : /^c1-\d{8}-.+-(?:NATIVE|RUNTIME)-[0-9a-f]{8}$/
  if (!pattern.test(value)) fail('IDENTITY_INVALID', `invalid ${kind} identity ${value}`)
}

function alreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST'
  )
}

/** Atomically claims a fresh preflight study directory; existing identities are never reused. */
export async function claimSingleUseC1StudyDir(
  reportRoot: string,
  studyId: string
): Promise<string> {
  assertIdentitySegment(studyId, 'study')
  const reportDir = join(reportRoot, studyId)
  await mkdir(reportRoot, { recursive: true })
  try {
    await mkdir(reportDir)
  } catch (error) {
    if (alreadyExists(error)) fail('IDENTITY_REUSE', `study identity ${studyId} is already claimed`)
    throw error
  }
  await mkdir(join(reportDir, 'legs'))
  return reportDir
}

export async function claimSingleUseC1LegDir(reportDir: string, runId: string): Promise<string> {
  assertIdentitySegment(runId, 'run')
  const legDir = join(reportDir, 'legs', runId)
  try {
    await mkdir(legDir)
  } catch (error) {
    if (alreadyExists(error)) fail('IDENTITY_REUSE', `leg identity ${runId} is already claimed`)
    throw error
  }
  return legDir
}

export interface C1PreflightLegPlan {
  readonly legIndex: number
  readonly taskId: string
  readonly stratum: string
  readonly pairId: string
  readonly pairOrdinal: number
  readonly order: C1PreflightOrder
  readonly arm: C1PreflightArm
  readonly runId: string
}

export function buildC1PreflightLegPlan(
  study: C1FrozenStudy,
  identity: C1PreflightIdentity
): readonly C1PreflightLegPlan[] {
  assertIdentitySegment(identity.studyId, 'study')
  const plans: C1PreflightLegPlan[] = []
  const seenRuns = new Set<string>()
  for (const assignment of study.assignments) {
    for (const arm of assignment.armSequence) {
      const lowerArm = arm.toLowerCase()
      const runId = `c1-${identity.dateToken}-${assignment.pairId}-${lowerArm === 'native' ? 'NATIVE' : 'RUNTIME'}-${randomBytes(4).toString('hex')}`
      assertIdentitySegment(runId, 'run')
      if (seenRuns.has(runId)) fail('IDENTITY_INVALID', `duplicate generated run identity ${runId}`)
      seenRuns.add(runId)
      plans.push({
        legIndex: plans.length,
        taskId: assignment.taskId,
        stratum: assignment.stratum,
        pairId: assignment.pairId,
        pairOrdinal: assignment.pairOrdinal,
        order: assignment.order,
        arm,
        runId
      })
    }
  }
  if (plans.length !== 64)
    fail('ASSIGNMENT_BINDING_MISMATCH', `expected 64 legs, received ${plans.length}`)
  return plans
}

export interface C1ProviderBoundCapture {
  readonly studyId: string
  readonly taskId: string
  readonly stratum: string
  readonly pairId: string
  readonly arm: C1PreflightArm
  readonly runId: string
  readonly turnId: string
  readonly modelCallId: string
  readonly provider: typeof C1_PROVIDER_ID
  readonly model: typeof C1_MODEL_ID
  readonly endpoint: typeof C1_PROVIDER_ENDPOINT
  readonly providerConfigHash: string
  readonly contextStrategy: 'NATIVE_UNMANAGED' | 'RUNTIME_WORKING_SET'
  readonly sourceDerivation: 'PI_NATIVE_MESSAGE_ANALYSIS'
  readonly providerBoundSourceKeys: readonly string[]
  readonly modelVisibleSemanticContextFingerprint: string
  readonly systemDeveloperToolStructuresFingerprint: string
  readonly workingSetId: string
  readonly transitionId: string
  readonly lifecycleEligible: boolean
  readonly runtimeContextChanged: boolean
  readonly fallbackSent: false
  readonly networkSent: false
  readonly lifecycleEvidence: 'NOT_OBSERVED_IN_PREFLIGHT'
}

export function captureC1PreflightArm(input: {
  readonly task: C1PreflightTask
  readonly stratum: string
  readonly pairId: string
  readonly arm: C1PreflightArm
  readonly runId: string
  readonly fixtureContentSha256: string
  readonly treatmentReady: boolean
  readonly studyId?: string
  readonly turnId?: string
  readonly modelCallId?: string
  readonly providerConfigHash?: string
  readonly providerBoundSourceKeys?: readonly string[]
  readonly modelVisibleSemanticContextFingerprint?: string
  readonly systemDeveloperToolStructuresFingerprint?: string
  readonly workingSetId?: string
  readonly transitionId?: string
  readonly lifecycleEligible?: boolean
  readonly runtimeContextChanged?: boolean
  readonly sourceDerivation?: 'PI_NATIVE_MESSAGE_ANALYSIS'
  readonly fallbackSent?: boolean
  readonly networkSent?: boolean
}): C1ProviderBoundCapture {
  if (input.arm === 'RUNTIME' && !input.treatmentReady) {
    fail('TREATMENT_INACTIVE', 'Runtime treatment was not ready; Native fallback is forbidden')
  }
  if (input.providerBoundSourceKeys === undefined) {
    fail(
      'PREFLIGHT_FAILURE',
      'provider-bound source keys must come from the observed Pi message list'
    )
  }
  if (input.modelVisibleSemanticContextFingerprint === undefined) {
    fail('PREFLIGHT_FAILURE', 'provider-bound semantic fingerprint must come from the executor')
  }
  if (input.providerConfigHash === undefined) {
    fail(
      'PROVIDER_BINDING_MISMATCH',
      'provider config hash is required before provider preparation'
    )
  }
  if (input.fallbackSent === true) {
    fail('FALLBACK_ATTEMPTED', 'a provider-bound capture may not record a Native fallback')
  }
  if (input.networkSent === true) {
    fail('PREFLIGHT_FAILURE', 'credential-free preflight may not record a network request')
  }
  const sourceKeys = [...input.providerBoundSourceKeys]
  if (sourceKeys.length === 0) {
    fail('PREFLIGHT_FAILURE', 'provider-bound context must contain observed source keys')
  }
  const contextStrategy = input.arm === 'NATIVE' ? 'NATIVE_UNMANAGED' : 'RUNTIME_WORKING_SET'
  return {
    studyId: input.studyId ?? 'c1-preflight-study',
    taskId: input.task.taskId,
    stratum: input.stratum,
    pairId: input.pairId,
    arm: input.arm,
    runId: input.runId,
    turnId: input.turnId ?? `${input.runId}-turn-01`,
    modelCallId: input.modelCallId ?? `${input.runId}-model-call-01`,
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    providerConfigHash: input.providerConfigHash,
    contextStrategy,
    sourceDerivation: input.sourceDerivation ?? 'PI_NATIVE_MESSAGE_ANALYSIS',
    providerBoundSourceKeys: sourceKeys,
    modelVisibleSemanticContextFingerprint: input.modelVisibleSemanticContextFingerprint,
    systemDeveloperToolStructuresFingerprint:
      input.systemDeveloperToolStructuresFingerprint ?? C1_TOOL_STRUCTURE_FINGERPRINT,
    workingSetId: input.workingSetId ?? `${contextStrategy}:unmanaged`,
    transitionId: input.transitionId ?? `${contextStrategy}:unmanaged`,
    lifecycleEligible: input.lifecycleEligible ?? false,
    runtimeContextChanged: input.runtimeContextChanged ?? false,
    fallbackSent: false,
    networkSent: false,
    lifecycleEvidence: 'NOT_OBSERVED_IN_PREFLIGHT'
  }
}

export class C1PreflightFakeTransport {
  private readonly capturedRequests: C1ProviderBoundCapture[] = []
  private blocked = false

  constructor(
    private readonly expectedBinding?: {
      readonly provider: typeof C1_PROVIDER_ID
      readonly model: typeof C1_MODEL_ID
      readonly endpoint: typeof C1_PROVIDER_ENDPOINT
      readonly providerConfigHash: string
    }
  ) {}

  get requests(): readonly C1ProviderBoundCapture[] {
    return [...this.capturedRequests]
  }

  get providerCalls(): 0 {
    return 0
  }

  get networkRequests(): 0 {
    return 0
  }

  get isBlocked(): boolean {
    return this.blocked
  }

  block(): void {
    this.blocked = true
  }

  capture(request: C1ProviderBoundCapture): void {
    if (this.blocked)
      fail('KILL_SWITCH_BLOCKED', 'terminal kill switch blocked fake transport capture')
    if (request.networkSent)
      fail('PREFLIGHT_FAILURE', 'preflight capture cannot mark a network request')
    if (request.fallbackSent)
      fail('FALLBACK_ATTEMPTED', 'fake transport received a fallback capture')
    if (
      request.provider !== (this.expectedBinding?.provider ?? C1_PROVIDER_ID) ||
      request.model !== (this.expectedBinding?.model ?? C1_MODEL_ID) ||
      request.endpoint !== (this.expectedBinding?.endpoint ?? C1_PROVIDER_ENDPOINT) ||
      request.providerConfigHash !==
        (this.expectedBinding?.providerConfigHash ?? C1_EXPECTED_PROVIDER_CONFIG_HASH)
    ) {
      fail('PROVIDER_BINDING_MISMATCH', 'fake transport received a provider binding mismatch')
    }
    if (
      request.studyId.length === 0 ||
      request.taskId.length === 0 ||
      request.stratum.length === 0 ||
      request.pairId.length === 0 ||
      request.runId.length === 0 ||
      request.turnId.length === 0 ||
      request.modelCallId.length === 0
    ) {
      fail('PREFLIGHT_FAILURE', 'provider-bound capture is missing a stable join key')
    }
    this.capturedRequests.push(request)
  }
}

interface C1ObservedPlanningContext {
  readonly universe: ContextUniverseRevision
  readonly representationsById: ReadonlyMap<string, ContextRepresentation>
  readonly representationsBySourceKey: ReadonlyMap<string, ContextRepresentation>
}

interface C1MaterializedWorkingSet {
  readonly workingSetId: string
  readonly sourceKeys: readonly string[]
  readonly fingerprint: string
}

export interface C1LegExecutionInput {
  readonly studyId: string
  readonly task: C1PreflightTask
  readonly stratum: string
  readonly pairId: string
  readonly arm: C1PreflightArm
  readonly runId: string
  readonly turnId: string
  readonly modelCallId: string
  readonly fixtureContentSha256: string
  readonly fixtureTreeObjectId: string
  readonly observation: C1AgentObservation
  readonly providerBinding: C1StrictProviderBinding
  readonly transport: C1ProviderTransport
  readonly treatmentReady: boolean
  readonly killSwitch?: RunKillSwitch
  readonly previousWorkingSet?: ContextWorkingSet | null
  readonly recompositionSequence?: number
  readonly runtimeSessionId?: string
  /** Set only for the deterministic treatment-opportunity probe. */
  readonly requireRuntimeDifference?: boolean
  /** Used by adversarial readiness probes; never enabled by the main 64 legs. */
  readonly failureInjection?: C1LegFailureInjection
  /** Expected Native fingerprint for a fidelity comparison. */
  readonly nativeBaselineSemanticContextFingerprint?: string
}

export interface C1LegExecutionResult {
  readonly capture: C1ProviderBoundCapture
  /**
   * The exact in-memory message list that was handed to the provider-bound
   * capture seam. This is available to the live transport only and must never
   * be serialized into evidence artifacts.
   */
  readonly providerBoundMessages: readonly PiMessageView[]
  /** Executor-owned structure that surrounds the model-visible messages. */
  readonly structuralEnvelope: C1ProviderStructuralEnvelope
  readonly workingSet: ContextWorkingSet | null
  readonly transition: ContextTransition | null
  readonly materializedWorkingSetFingerprint: string
  readonly runtimeContextChanged: boolean
  readonly lifecycleEligible: boolean
  readonly replayMismatch: 0
}

export type C1LegFailureInjection =
  | 'MATERIALIZATION_FAILURE'
  | 'REWRITE_FAILURE'
  | 'FALLBACK'
  | 'NATIVE_DRIFT'
  | 'RUNTIME_UNCHANGED'
  | 'REPLAY_MISMATCH'

const C1_OBSERVATION_NOW = '2026-09-02T00:00:00.000Z'

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

/** Exact source identities derived from the Pi observation, never task metadata. */
export function observedC1SourceKeys(
  messages: readonly PiMessageView[],
  runtimeSessionId: string,
  modelCallSequence: number
): readonly string[] {
  const analysis = analyzeNativeMessages(messages, {
    runtimeSessionId,
    modelCallSequence
  })
  const keys = analysis.messages.flatMap((message) => message.sourceKeys)
  if (keys.length === 0)
    fail('PREFLIGHT_FAILURE', 'Pi observation contains no attributable source keys')
  return uniqueSorted(keys)
}

/**
 * Build a normalized agent observation from actual fixture file paths. The
 * task's relevant/distractor arrays are deliberately not consulted: source
 * identity comes from the same Pi message analysis used by Active composition.
 */
export function createC1ObservedReadTrace(input: {
  readonly observationId: string
  readonly prompt: string
  readonly fixtureFiles: readonly string[]
  readonly taskPhase?: TaskPhase
}): C1AgentObservation {
  const files = input.fixtureFiles.length > 0 ? [...input.fixtureFiles] : ['observed/source.js']
  const messages: PiMessageView[] = [
    { role: 'user', content: [{ type: 'text', text: input.prompt }] }
  ]
  for (const [index, file] of files.entries()) {
    const callId = `c1-observation-${input.observationId}-${index + 1}`
    messages.push({
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: callId,
          name: 'read',
          arguments: { path: file }
        }
      ]
    })
    messages.push({
      role: 'toolResult',
      content: [{ type: 'text', text: `observation captured for ${file}` }],
      toolCallId: callId,
      toolName: 'read',
      isError: false
    })
  }
  const sourceKeys = observedC1SourceKeys(messages, input.observationId, 0)
  return {
    observationId: input.observationId,
    messages: Object.freeze(messages),
    taskPhase: input.taskPhase ?? 'INVESTIGATE',
    currentTargetSourceKeys: sourceKeys,
    excludedSourceKeys: [],
    latestVerificationSourceKeys: [],
    recentEvidenceSourceKeys: [],
    previousWorkingSetId: null
  }
}

function createObservedPlanningContext(
  observation: C1AgentObservation,
  runtimeSessionId: string,
  modelCallSequence: number
): C1ObservedPlanningContext {
  const analysis = analyzeNativeMessages(observation.messages, {
    runtimeSessionId,
    modelCallSequence
  })
  const fingerprintBySource = new Map<string, string[]>()
  for (const analyzedMessage of analysis.messages) {
    const message = observation.messages[analyzedMessage.index]
    if (message === undefined) continue
    for (const sourceKey of analyzedMessage.sourceKeys) {
      const fingerprints = fingerprintBySource.get(sourceKey) ?? []
      fingerprints.push(activeMessageFingerprint(message))
      fingerprintBySource.set(sourceKey, fingerprints)
    }
  }
  const sourceKeys = uniqueSorted([...fingerprintBySource.keys()])
  if (sourceKeys.length === 0)
    fail('PREFLIGHT_FAILURE', 'cannot plan an observation without source identities')
  const seeds = sourceKeys.map((sourceKey) => {
    const messageFingerprints = fingerprintBySource.get(sourceKey) ?? []
    return {
      sourceKey,
      sourceKind: 'PI_AGENT_OBSERVATION',
      provenance: 'C1_AGENT_VISIBLE_OBSERVATION',
      authority: 'pi-agent',
      contentHash: sha256Bytes(
        `c1-observed-source-v1|${sourceKey}|${uniqueSorted(messageFingerprints).join('|')}`
      ),
      observedAt: C1_OBSERVATION_NOW
    }
  })
  const universe = seedUniverse({ runtimeSessionId, seeds })
  const representationsById = new Map<string, ContextRepresentation>()
  const representationsBySourceKey = new Map<string, ContextRepresentation>()
  for (const entry of universe.entries) {
    const sourceKey = entry.source.sourceKey
    const version = entry.admittedVersion
    if (version === null)
      fail('MATERIALIZATION_FAILURE', `observation source ${sourceKey} has no admitted version`)
    const sourceContent = `c1-observed-content-v1|${sourceKey}|${version.contentHash}`
    const representation = createRepresentation({
      kind: 'FULL',
      sourceVersionIds: [version.versionId],
      contentHash: version.contentHash,
      tokenEstimate: Math.max(1, Math.ceil(sourceContent.length / 4)),
      lossiness: 'NONE',
      derivation: {
        adapter: 'C1_PI_AGENT_OBSERVATION',
        observationId: observation.observationId,
        sourceKey,
        sourceVersionId: version.versionId
      },
      content: sourceContent
    })
    representationsById.set(representation.id, representation)
    representationsBySourceKey.set(sourceKey, representation)
  }
  return { universe, representationsById, representationsBySourceKey }
}

function buildObservedPlanningRequest(input: {
  readonly observation: C1AgentObservation
  readonly runtimeSessionId: string
  readonly sequence: number
}): ContextPlanningRequest {
  return {
    runtimeSessionId: input.runtimeSessionId,
    recompositionSequence: input.sequence,
    taskPhase: input.observation.taskPhase,
    budget: { maxSemanticTokens: 1_000_000 },
    pinnedSourceKeys: [],
    excludedSourceKeys: input.observation.excludedSourceKeys,
    currentTargetSourceKeys: input.observation.currentTargetSourceKeys,
    latestVerificationSourceKeys: input.observation.latestVerificationSourceKeys,
    recentEvidenceSourceKeys: input.observation.recentEvidenceSourceKeys,
    ...(input.observation.sourceLifecycleSignals !== undefined
      ? { sourceLifecycleSignals: input.observation.sourceLifecycleSignals }
      : {}),
    ...(input.observation.removalHistory !== undefined
      ? { removalHistory: input.observation.removalHistory }
      : {}),
    ...(input.observation.representationNeeds !== undefined
      ? { representationNeeds: input.observation.representationNeeds }
      : {}),
    previousWorkingSetId: input.observation.previousWorkingSetId
  }
}

function planObservedRuntime(input: {
  readonly observation: C1AgentObservation
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly previousWorkingSet: ContextWorkingSet | null
  readonly failureInjection?: C1LegFailureInjection
}): {
  readonly context: C1ObservedPlanningContext
  readonly workingSet: ContextWorkingSet
  readonly transition: ContextTransition
} {
  if (
    input.previousWorkingSet !== null &&
    input.observation.previousWorkingSetId !== input.previousWorkingSet.workingSetId
  ) {
    fail('REWRITE_FAILURE', 'observation previousWorkingSetId does not match executor state')
  }
  const context = createObservedPlanningContext(
    input.observation,
    input.runtimeSessionId,
    input.sequence
  )
  const request = buildObservedPlanningRequest({
    observation: input.observation,
    runtimeSessionId: input.runtimeSessionId,
    sequence: input.sequence
  })
  const result = planWorkingSet({
    universe: context.universe,
    request,
    previousWorkingSet: input.previousWorkingSet,
    options: {
      policyVersion: C1_POLICY_VERSION,
      createdAt: C1_OBSERVATION_NOW,
      represent: (entry) => context.representationsBySourceKey.get(entry.source.sourceKey) ?? null
    }
  })
  return {
    context,
    workingSet: result.workingSet,
    transition: result.transition
  }
}

function materializeObservedWorkingSet(input: {
  readonly workingSet: ContextWorkingSet
  readonly universe: ContextUniverseRevision
  readonly representationsById: ReadonlyMap<string, ContextRepresentation>
  readonly failureInjection?: C1LegFailureInjection
}): C1MaterializedWorkingSet {
  if (input.failureInjection === 'MATERIALIZATION_FAILURE') {
    fail('MATERIALIZATION_FAILURE', 'C1 materialization failure was injected before composition')
  }
  if (input.workingSet.plannedFromUniverseHash !== input.universe.logicalHash) {
    fail(
      'MATERIALIZATION_FAILURE',
      'working set universe hash does not match the observed universe'
    )
  }
  const sourceKeys: string[] = []
  const identityRows: string[] = []
  for (const item of input.workingSet.items) {
    if (item.sourceKeys.length !== 1 || item.sourceVersionIds.length !== 1) {
      fail('MATERIALIZATION_FAILURE', 'C1 materializer requires one source/version per item')
    }
    const sourceKey = item.sourceKeys[0]
    const sourceVersionId = item.sourceVersionIds[0]
    if (sourceKey === undefined || sourceVersionId === undefined) {
      fail('MATERIALIZATION_FAILURE', 'C1 materializer found an incomplete source identity')
    }
    const entry = input.universe.entries.find(
      (candidate) => candidate.source.sourceKey === sourceKey
    )
    if (entry?.admittedVersion?.versionId !== sourceVersionId) {
      fail('MATERIALIZATION_FAILURE', `stale SourceVersion for ${sourceKey}`)
    }
    const representation = input.representationsById.get(item.representationId)
    if (
      representation === undefined ||
      representation.content === undefined ||
      representation.contentRef !== undefined ||
      !representation.sourceVersionIds.includes(sourceVersionId)
    ) {
      fail('MATERIALIZATION_FAILURE', `exact representation is unavailable for ${sourceKey}`)
    }
    sourceKeys.push(sourceKey)
    identityRows.push(
      [
        sourceKey,
        sourceVersionId,
        representation.id,
        representation.contentHash,
        representation.content
      ].join('|')
    )
  }
  return {
    workingSetId: input.workingSet.workingSetId,
    sourceKeys: Object.freeze(sourceKeys),
    fingerprint: sha256Bytes(['c1-materialized-observed-v1', ...identityRows].join('\u241F'))
  }
}

function sameSourceSet(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson(uniqueSorted(left)) === canonicalJson(uniqueSorted(right))
}

export function replayC1ProviderBoundCapture(
  capture: C1ProviderBoundCapture,
  mutate = false
): void {
  const replay = mutate
    ? {
        ...capture,
        providerBoundSourceKeys: [...capture.providerBoundSourceKeys, 'replay-mutation']
      }
    : {
        ...capture,
        providerBoundSourceKeys: [...capture.providerBoundSourceKeys]
      }
  if (canonicalJson(replay) !== canonicalJson(capture)) {
    fail('REPLAY_MISMATCH', `provider-bound capture replay differs for ${capture.modelCallId}`)
  }
}

/**
 * The single executor used by the 64-leg preflight and the deterministic
 * treatment opportunity. A future live transport can replace the capture
 * sink; observation, policy, materialization, composition, and guard logic
 * stay identical.
 */
export class C1LegExecutor {
  constructor(
    private readonly options: {
      readonly providerBinding: C1StrictProviderBinding
    }
  ) {}

  execute(input: C1LegExecutionInput): C1LegExecutionResult {
    assertC1StrictProviderBinding(input.providerBinding.experimentBinding)
    const killSwitch =
      input.killSwitch ??
      createRunKillSwitch(input.runId, {
        now: () => C1_OBSERVATION_NOW
      })
    if (killSwitch.isTripped)
      fail('KILL_SWITCH_BLOCKED', 'C1 leg started after its kill switch tripped')

    const nativeFingerprint = activeMessagesHash(input.observation.messages)
    if (
      input.arm === 'NATIVE' &&
      input.nativeBaselineSemanticContextFingerprint !== undefined &&
      input.nativeBaselineSemanticContextFingerprint !== nativeFingerprint
    ) {
      fail(
        'NATIVE_CONTEXT_DRIFT',
        'Native provider-bound semantic context drifted from the observation'
      )
    }

    let workingSet: ContextWorkingSet | null = null
    let transition: ContextTransition | null = null
    let materializedWorkingSetFingerprint = 'NATIVE_UNMANAGED'
    let providerBoundMessages = input.observation.messages
    let lifecycleEligible = false
    let runtimeContextChanged = false

    if (input.arm === 'RUNTIME') {
      if (!input.treatmentReady) {
        fail('TREATMENT_INACTIVE', 'Runtime treatment was not ready; Native fallback is forbidden')
      }
      const runtimeSessionId = input.runtimeSessionId ?? `${input.studyId}:${input.pairId}`
      const sequence = input.recompositionSequence ?? 0
      const planned = planObservedRuntime({
        observation: input.observation,
        runtimeSessionId,
        sequence,
        previousWorkingSet: input.previousWorkingSet ?? null,
        ...(input.failureInjection !== undefined
          ? { failureInjection: input.failureInjection }
          : {})
      })
      workingSet = planned.workingSet
      transition = planned.transition
      const materialized = materializeObservedWorkingSet({
        workingSet: planned.workingSet,
        universe: planned.context.universe,
        representationsById: planned.context.representationsById,
        ...(input.failureInjection !== undefined
          ? { failureInjection: input.failureInjection }
          : {})
      })
      materializedWorkingSetFingerprint = materialized.fingerprint
      lifecycleEligible =
        input.requireRuntimeDifference === true ||
        (input.observation.sourceLifecycleSignals?.length ?? 0) > 0
      const composition = composeActiveRewrite({
        messages: input.observation.messages,
        workingSet: planned.workingSet,
        transition:
          input.failureInjection === 'REWRITE_FAILURE'
            ? {
                ...planned.transition,
                toWorkingSetId: 'c1-invalid-rewrite-target'
              }
            : planned.transition,
        runId: input.runId,
        killSwitch,
        activeModeOptIn: input.failureInjection !== 'FALLBACK',
        systemInstruction: C1_SYSTEM_INSTRUCTION,
        harness: 'PI'
      })
      if (composition.kind !== 'REWRITE_READY') {
        fail(
          input.failureInjection === 'REWRITE_FAILURE' ? 'REWRITE_FAILURE' : 'FALLBACK_ATTEMPTED',
          `Active composition did not produce a sendable Runtime context: ${composition.reason}`
        )
      }
      const guarded = assertRewriteSafe(composition, killSwitch)
      if (!guarded.ok) {
        fail(
          'REWRITE_FAILURE',
          `pre-send guard rejected the Runtime composition: ${guarded.reason}`
        )
      }
      // The unchanged-context injection simulates a broken treatment adapter
      // that silently returns the Native message list after planning and
      // composition. The executor must detect that loss at the same
      // provider-bound comparison used by the real path.
      providerBoundMessages =
        input.failureInjection === 'RUNTIME_UNCHANGED'
          ? input.observation.messages
          : composition.messages
      const providerBoundSourceKeys = observedC1SourceKeys(
        providerBoundMessages,
        runtimeSessionId,
        sequence
      )
      if (!sameSourceSet(providerBoundSourceKeys, materialized.sourceKeys)) {
        fail(
          'MATERIALIZATION_FAILURE',
          'provider-bound source keys do not match the materialized Working Set'
        )
      }
      const runtimeFingerprint = activeMessagesHash(providerBoundMessages)
      runtimeContextChanged = runtimeFingerprint !== nativeFingerprint
      if (lifecycleEligible && !runtimeContextChanged) {
        fail(
          'RUNTIME_CONTEXT_UNCHANGED',
          'eligible Runtime treatment did not change provider-bound context'
        )
      }
    }

    const providerBoundSourceKeys = observedC1SourceKeys(
      providerBoundMessages,
      input.runtimeSessionId ?? `${input.studyId}:${input.pairId}`,
      input.recompositionSequence ?? 0
    )
    const capture = captureC1PreflightArm({
      task: input.task,
      stratum: input.stratum,
      pairId: input.pairId,
      arm: input.arm,
      runId: input.runId,
      fixtureContentSha256: input.fixtureContentSha256,
      treatmentReady: input.treatmentReady,
      studyId: input.studyId,
      turnId: input.turnId,
      modelCallId: input.modelCallId,
      providerConfigHash: input.providerBinding.providerConfigHash,
      providerBoundSourceKeys,
      modelVisibleSemanticContextFingerprint: activeMessagesHash(providerBoundMessages),
      systemDeveloperToolStructuresFingerprint: C1_TOOL_STRUCTURE_FINGERPRINT,
      workingSetId: workingSet?.workingSetId ?? 'NATIVE_UNMANAGED',
      transitionId: transition?.transitionId ?? 'NATIVE_UNMANAGED',
      lifecycleEligible,
      runtimeContextChanged
    })
    if (input.failureInjection === 'NATIVE_DRIFT' && input.arm === 'NATIVE') {
      fail('NATIVE_CONTEXT_DRIFT', 'Native context drift injection rejected before capture')
    }
    input.transport.capture(capture)
    replayC1ProviderBoundCapture(capture, input.failureInjection === 'REPLAY_MISMATCH')
    return {
      capture,
      providerBoundMessages: Object.freeze([...providerBoundMessages]),
      structuralEnvelope: C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE,
      workingSet,
      transition,
      materializedWorkingSetFingerprint,
      runtimeContextChanged,
      lifecycleEligible,
      replayMismatch: 0
    }
  }
}

export interface C1SignalSource {
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  removeListener(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

export interface C1OperatorKillSwitch {
  readonly isTripped: boolean
  readonly firstSignal: 'SIGINT' | 'SIGTERM' | null
  dispose(): void
}

/** Signal lifecycle used by both readiness tests and the future live runner. */
export function installC1OperatorKillSwitch(
  source: C1SignalSource,
  onTrip: (signal: 'SIGINT' | 'SIGTERM') => void
): C1OperatorKillSwitch {
  let tripped = false
  let firstSignal: 'SIGINT' | 'SIGTERM' | null = null
  const handle = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (tripped) return
    tripped = true
    firstSignal = signal
    onTrip(signal)
  }
  const sigint = (): void => handle('SIGINT')
  const sigterm = (): void => handle('SIGTERM')
  source.on('SIGINT', sigint)
  source.on('SIGTERM', sigterm)
  return {
    get isTripped(): boolean {
      return tripped
    },
    get firstSignal(): 'SIGINT' | 'SIGTERM' | null {
      return firstSignal
    },
    dispose(): void {
      source.removeListener('SIGINT', sigint)
      source.removeListener('SIGTERM', sigterm)
    }
  }
}

export interface C1BudgetLimits {
  readonly perLeg: {
    readonly maxProviderCalls: number
    readonly maxToolCalls: number
    readonly maxWallClockMs: number
  }
  readonly study: {
    readonly maxProviderCalls: number
    readonly maxToolCalls: number
    readonly maxWallClockMs: number
    readonly maxLegs: number
  }
}

export class C1HardBudgetGuard {
  private currentLeg: {
    providerCalls: number
    toolCalls: number
    startedAtMs: number
  } | null = null
  private completedLegs = 0
  private studyProviderCalls = 0
  private studyToolCalls = 0
  private studyWallClockMs = 0

  constructor(readonly limits: C1BudgetLimits) {}

  beginLeg(startedAtMs: number = Date.now()): void {
    if (this.currentLeg !== null) fail('BUDGET_BREACH', 'a C1 leg is already active')
    if (this.completedLegs >= this.limits.study.maxLegs)
      fail('BUDGET_BREACH', 'C1 study leg budget exhausted')
    if (!Number.isInteger(startedAtMs) || startedAtMs < 0) {
      fail('BUDGET_BREACH', 'C1 leg start time is invalid')
    }
    this.currentLeg = { providerCalls: 0, toolCalls: 0, startedAtMs }
  }

  /** Enforce the wall-clock ceiling while a leg is still in flight. */
  assertWallClockBudget(nowMs: number = Date.now()): number {
    if (this.currentLeg === null) fail('BUDGET_BREACH', 'wall-clock checked outside a C1 leg')
    if (!Number.isInteger(nowMs) || nowMs < this.currentLeg.startedAtMs) {
      fail('BUDGET_BREACH', 'C1 wall-clock clock reading is invalid')
    }
    const elapsed = nowMs - this.currentLeg.startedAtMs
    if (elapsed > this.limits.perLeg.maxWallClockMs) {
      fail('BUDGET_BREACH', 'C1 per-leg wall-clock budget exceeded while leg was in flight')
    }
    return elapsed
  }

  recordProviderCall(): void {
    if (this.currentLeg === null) fail('BUDGET_BREACH', 'provider call recorded outside a C1 leg')
    if (
      this.currentLeg.providerCalls >= this.limits.perLeg.maxProviderCalls ||
      this.studyProviderCalls >= this.limits.study.maxProviderCalls
    ) {
      fail('BUDGET_BREACH', 'provider-call hard budget would be exceeded')
    }
    this.currentLeg.providerCalls += 1
    this.studyProviderCalls += 1
  }

  /**
   * Atomically reserve a batch of provider-requested tool calls before any
   * tool executor is allowed to perform a side effect. Both leg and study
   * ceilings are checked before either counter is mutated.
   */
  reserveToolCalls(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      fail('BUDGET_BREACH', 'tool-call reservation count is invalid')
    }
    if (this.currentLeg === null) {
      fail('BUDGET_BREACH', 'tool calls reserved outside a C1 leg')
    }
    if (count === 0) return
    if (
      this.currentLeg.toolCalls + count > this.limits.perLeg.maxToolCalls ||
      this.studyToolCalls + count > this.limits.study.maxToolCalls
    ) {
      fail('BUDGET_BREACH', 'tool-call hard budget would be exceeded')
    }
    this.currentLeg.toolCalls += count
    this.studyToolCalls += count
  }

  recordToolCall(): void {
    if (this.currentLeg === null) fail('BUDGET_BREACH', 'tool call recorded outside a C1 leg')
    this.reserveToolCalls(1)
  }

  endLeg(measures: { readonly wallClockMs: number }): void {
    if (this.currentLeg === null) fail('BUDGET_BREACH', 'C1 leg ended without beginLeg')
    if (!Number.isInteger(measures.wallClockMs) || measures.wallClockMs < 0) {
      fail('BUDGET_BREACH', 'C1 wall-clock measure is invalid')
    }
    this.assertWallClockBudget(this.currentLeg.startedAtMs + measures.wallClockMs)
    this.studyWallClockMs += measures.wallClockMs
    if (this.studyWallClockMs > this.limits.study.maxWallClockMs) {
      fail('BUDGET_BREACH', 'C1 study wall-clock budget exceeded')
    }
    this.completedLegs += 1
    this.currentLeg = null
  }

  /** Close an interrupted leg without treating it as a completed leg. */
  abortLeg(): void {
    this.currentLeg = null
  }

  get ledger(): Readonly<{
    completedLegs: number
    providerCalls: number
    toolCalls: number
    wallClockMs: number
  }> {
    return {
      completedLegs: this.completedLegs,
      providerCalls: this.studyProviderCalls,
      toolCalls: this.studyToolCalls,
      wallClockMs: this.studyWallClockMs
    }
  }
}

export interface C1BoundedOperationResult<T> {
  readonly status: 'COMPLETED' | 'DEADLINE_EXCEEDED'
  readonly value?: T
  readonly aborted: boolean
}

/**
 * Shared deadline boundary for the future live leg executor. The preflight
 * uses it only with an in-memory operation; a deadline aborts the operation
 * and invokes the same terminal callback that blocks transport.
 */
export async function runC1BoundedOperation<T>(input: {
  readonly operation: (signal: AbortSignal) => Promise<T>
  readonly timeoutMs: number
  readonly onDeadline: () => void
}): Promise<C1BoundedOperationResult<T>> {
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 0) {
    fail('BUDGET_BREACH', 'C1 deadline must be a non-negative integer')
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let deadlineWon = false
  const operation = Promise.resolve()
    .then(() => input.operation(controller.signal))
    .then(
      (value) => ({ kind: 'completed' as const, value }),
      (error: unknown) => ({ kind: 'failed' as const, error })
    )
  const deadline = new Promise<{ readonly kind: 'deadline' }>((resolveDeadline) => {
    timer = setTimeout(() => {
      deadlineWon = true
      input.onDeadline()
      controller.abort()
      resolveDeadline({ kind: 'deadline' })
    }, input.timeoutMs)
  })
  const result = await Promise.race([operation, deadline])
  if (timer !== undefined) clearTimeout(timer)
  if (result.kind === 'deadline') {
    // The operation promise has a rejection handler above, so a late abort
    // cannot become an unhandled rejection after the terminal return.
    return { status: 'DEADLINE_EXCEEDED', aborted: deadlineWon }
  }
  if (result.kind === 'failed') throw result.error
  return { status: 'COMPLETED', value: result.value, aborted: false }
}

export interface C1IndependentArtifactWrite {
  readonly name: string
  readonly content: string
}

export interface C1IndependentArtifactResult {
  readonly attempted: readonly string[]
  readonly failed: readonly string[]
}

export async function writeIndependentC1Artifacts(input: {
  readonly reportDir: string
  readonly documents: readonly C1IndependentArtifactWrite[]
  readonly write?: (path: string, content: string) => Promise<void>
}): Promise<C1IndependentArtifactResult> {
  const attempted: string[] = []
  const failed: string[] = []
  const writer =
    input.write ?? ((path: string, content: string) => writeFile(path, content, 'utf8'))
  for (const document of input.documents) {
    attempted.push(document.name)
    try {
      await writer(join(input.reportDir, document.name), document.content)
    } catch {
      failed.push(document.name)
    }
  }
  return { attempted, failed }
}

export interface C1PreflightLegEvidence {
  readonly legIndex: number
  readonly taskId: string
  readonly stratum: string
  readonly pairId: string
  readonly pairOrdinal: number
  readonly order: C1PreflightOrder
  readonly arm: C1PreflightArm
  readonly runId: string
  readonly turnId: string
  readonly modelCallId: string
  readonly fixtureContentSha256: string
  readonly fixtureTreeObjectId: string
  readonly freshSandbox: true
  readonly sandboxReused: false
  readonly changedPaths: readonly string[]
  readonly writableScopePass: true
  readonly providerBoundSourceKeys: readonly string[]
  readonly modelVisibleSemanticContextFingerprint: string
  readonly systemDeveloperToolStructuresFingerprint: string
  readonly providerConfigHash: string
  readonly workingSetId: string
  readonly transitionId: string
  readonly lifecycleEligible: boolean
  readonly runtimeContextChanged: boolean
  readonly sourceDerivation: 'PI_NATIVE_MESSAGE_ANALYSIS'
  readonly providerCalls: 0
  readonly toolCalls: 0
  readonly wallClockMs: number
  readonly taskOutcome: 'NOT_OBSERVED_IN_PREFLIGHT'
  readonly lifecycleEvidence: 'NOT_OBSERVED_IN_PREFLIGHT'
  readonly replayMismatch: 0
}

export interface C1PreflightGate {
  readonly gateId: string
  readonly verdict: 'PASS' | 'FAIL'
  readonly observed: string
}

export interface C1PreflightArtifactSummary {
  readonly name: string
  readonly sha256: string
  readonly bytes: number
}

export interface C1LivePreflightReport {
  readonly preflightId: typeof C1_LIVE_PREFLIGHT_ID
  readonly executionMode: typeof C1_LIVE_PREFLIGHT_MODE
  readonly status: 'PASS' | 'FAIL'
  readonly nodeVersion: string
  readonly provider: typeof C1_PROVIDER_ID
  readonly model: typeof C1_MODEL_ID
  readonly endpoint: typeof C1_PROVIDER_ENDPOINT
  readonly providerConfigHash: string | null
  readonly providerCalls: 0
  readonly networkRequests: 0
  readonly fakeProviderBoundCaptures: number
  readonly studyId: string | null
  readonly reportDir: string | null
  readonly contractSha256: typeof C1_C_CONTRACT_SHA256
  readonly assignmentMatrixSha256: typeof C1_C_ASSIGNMENT_MATRIX_SHA256
  readonly taskManifestSha256: typeof C1_C_TASK_MANIFEST_SHA256
  readonly treatmentRevision: typeof C1_C_TREATMENT_REVISION
  readonly gates: readonly C1PreflightGate[]
  readonly legs: readonly C1PreflightLegEvidence[]
  readonly artifacts: readonly C1PreflightArtifactSummary[]
  readonly failures: readonly {
    readonly code: C1PreflightFailureCode
    readonly message: string
  }[]
}

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function gate(gateId: string, pass: boolean, observed: string): C1PreflightGate {
  return { gateId, verdict: pass ? 'PASS' : 'FAIL', observed }
}

async function writePreflightArtifacts(input: {
  readonly reportDir: string
  readonly status: 'PASS' | 'FAIL'
  readonly study: C1FrozenStudy
  readonly identity: C1PreflightIdentity
  readonly legs: readonly C1PreflightLegEvidence[]
  readonly gates: readonly C1PreflightGate[]
  readonly evidenceWriteFailures?: readonly string[]
}): Promise<{
  readonly artifacts: readonly C1PreflightArtifactSummary[]
  readonly failed: readonly string[]
}> {
  const legRows = input.legs
  const documents: C1IndependentArtifactWrite[] = [
    {
      name: 'provider-usage-ledger.jsonl',
      content: legRows
        .map((leg) =>
          line({
            studyId: input.identity.studyId,
            runId: leg.runId,
            taskId: leg.taskId,
            stratum: leg.stratum,
            pairId: leg.pairId,
            arm: leg.arm,
            turnId: leg.turnId,
            modelCallId: leg.modelCallId,
            providerCalls: 0,
            usageStatus: 'NOT_OBSERVED_IN_PREFLIGHT'
          })
        )
        .join('')
    },
    {
      name: 'transition-evidence.jsonl',
      content: legRows
        .map((leg) =>
          line({
            studyId: input.identity.studyId,
            runId: leg.runId,
            taskId: leg.taskId,
            stratum: leg.stratum,
            pairId: leg.pairId,
            arm: leg.arm,
            turnId: leg.turnId,
            modelCallId: leg.modelCallId,
            lifecycleEvidence: leg.lifecycleEvidence,
            providerBoundSourceKeys: leg.providerBoundSourceKeys
          })
        )
        .join('')
    },
    {
      name: 'decision-evidence.jsonl',
      content: legRows
        .map((leg) =>
          line({
            studyId: input.identity.studyId,
            runId: leg.runId,
            taskId: leg.taskId,
            stratum: leg.stratum,
            pairId: leg.pairId,
            arm: leg.arm,
            turnId: leg.turnId,
            modelCallId: leg.modelCallId,
            contextFingerprint: leg.modelVisibleSemanticContextFingerprint,
            treatmentRevision: C1_C_TREATMENT_REVISION
          })
        )
        .join('')
    },
    {
      name: 'tool-latency-evidence.jsonl',
      content: legRows
        .map((leg) =>
          line({
            studyId: input.identity.studyId,
            runId: leg.runId,
            taskId: leg.taskId,
            stratum: leg.stratum,
            pairId: leg.pairId,
            arm: leg.arm,
            turnId: leg.turnId,
            modelCallId: leg.modelCallId,
            toolCalls: 0,
            wallClockMs: leg.wallClockMs
          })
        )
        .join('')
    },
    {
      name: 'outcome-evidence.jsonl',
      content: legRows
        .map((leg) =>
          line({
            studyId: input.identity.studyId,
            runId: leg.runId,
            taskId: leg.taskId,
            stratum: leg.stratum,
            pairId: leg.pairId,
            arm: leg.arm,
            turnId: leg.turnId,
            modelCallId: leg.modelCallId,
            taskOutcome: leg.taskOutcome,
            writableScopePass: leg.writableScopePass
          })
        )
        .join('')
    },
    {
      name: 'replay-evidence.jsonl',
      content: legRows
        .map((leg) =>
          line({
            studyId: input.identity.studyId,
            runId: leg.runId,
            taskId: leg.taskId,
            stratum: leg.stratum,
            pairId: leg.pairId,
            arm: leg.arm,
            turnId: leg.turnId,
            modelCallId: leg.modelCallId,
            replayMismatch: leg.replayMismatch
          })
        )
        .join('')
    }
  ]
  const firstWrite = await writeIndependentC1Artifacts({
    reportDir: input.reportDir,
    documents
  })
  const priorFailures = [...(input.evidenceWriteFailures ?? []), ...firstWrite.failed]
  const manifestStatus = priorFailures.length === 0 && input.status === 'PASS' ? 'PASS' : 'FAIL'
  const manifestContent =
    JSON.stringify(
      {
        preflightId: C1_LIVE_PREFLIGHT_ID,
        executionMode: C1_LIVE_PREFLIGHT_MODE,
        status: manifestStatus,
        studyId: input.identity.studyId,
        provider: input.study.provider,
        model: input.study.model,
        endpoint: input.study.endpoint,
        credentialEnv: 'STEP_PLAN_API_KEY',
        credentialPersistence: 'MEMORY_ONLY',
        providerCalls: 0,
        networkRequests: 0,
        contractSha256: input.study.contractSha256,
        assignmentMatrixSha256: input.study.assignmentMatrixSha256,
        taskManifestSha256: input.study.taskManifestSha256,
        treatmentRevision: C1_C_TREATMENT_REVISION,
        stableJoinKeys: [
          'studyId',
          'runId',
          'taskId',
          'stratum',
          'pairId',
          'arm',
          'turnId',
          'modelCallId'
        ],
        legCount: legRows.length,
        gates: input.gates,
        requiredArtifacts: C1_PREFLIGHT_ARTIFACT_NAMES,
        evidenceWriteFailures: priorFailures
      },
      null,
      2
    ) + '\n'
  const manifestWrite = await writeIndependentC1Artifacts({
    reportDir: input.reportDir,
    documents: [{ name: 'run-manifest.json', content: manifestContent }]
  })
  const failed = [...priorFailures, ...manifestWrite.failed]
  const summaries = [...documents, { name: 'run-manifest.json', content: manifestContent }]
    .filter((document) => !failed.includes(document.name))
    .map((document) => ({
      name: document.name,
      sha256: sha256Bytes(document.content),
      bytes: Buffer.byteLength(document.content, 'utf8')
    }))
  return { artifacts: summaries, failed }
}

function normalizeFailure(error: unknown): {
  readonly code: C1PreflightFailureCode
  readonly message: string
} {
  if (error instanceof C1PreflightFailure) return { code: error.code, message: error.message }
  return {
    code: 'PREFLIGHT_FAILURE',
    message: error instanceof Error ? error.message : String(error)
  }
}

function adversarialTask(): C1PreflightTask {
  return {
    taskId: 'c1-preflight-adversarial-task',
    stratum: 'preflight',
    title: 'preflight',
    fixtureVersion: 'preflight',
    fixturePath: 'preflight',
    fixtureRevision: {
      baseRevision: 'preflight',
      fixtureTreeObjectId: 'preflight',
      fixtureContentSha256: 'preflight'
    },
    prompt: 'preflight',
    promptSha256: sha256Bytes('preflight'),
    objectiveOracle: {
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      expectedExitCode: 0,
      timeoutMs: 1_000
    },
    regressionOracle: {
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      expectedExitCode: 0,
      timeoutMs: 1_000
    },
    expectedWritablePaths: ['src/target.js'],
    relevantSources: ['metadata-only-test-field'],
    distractorSources: ['metadata-only-test-field'],
    requiredLaterSources: []
  }
}

export function runC1TreatmentOpportunityProbe(
  providerBinding: C1StrictProviderBinding
): C1PreflightGate {
  const task = adversarialTask()
  const studyId = 'c1-preflight-treatment-opportunity'
  const pairId = 'c1-preflight-treatment-opportunity-p01'
  const runtimeSessionId = 'c1-preflight-treatment-opportunity-session'
  const observation = createC1ObservedReadTrace({
    observationId: 'treatment-opportunity-initial',
    prompt: task.prompt,
    fixtureFiles: ['src/target.js', 'src/distractor.js']
  })
  const firstCallKey = observation.currentTargetSourceKeys.find((key) =>
    key.startsWith('run/tool-call://')
  )
  if (firstCallKey === undefined) {
    return gate(
      'actual_runtime_treatment_opportunity',
      false,
      'observation did not contain a tool-call source identity'
    )
  }
  const firstCallId = firstCallKey.slice('run/tool-call://'.length)
  const retainedKeys = observation.currentTargetSourceKeys.filter(
    (key) => key === firstCallKey || key === `run/tool-result://${firstCallId}`
  )
  const removedKeys = observation.currentTargetSourceKeys.filter(
    (key) => !retainedKeys.includes(key)
  )
  const changedObservation: C1AgentObservation = {
    ...observation,
    observationId: 'treatment-opportunity-after-triage',
    currentTargetSourceKeys: retainedKeys,
    excludedSourceKeys: removedKeys,
    sourceLifecycleSignals: removedKeys.map((sourceKey) => ({
      sourceKey,
      kind: 'RULED_OUT' as const,
      evidenceRef: 'preflight-triage'
    }))
  }
  const nativeTransport = new C1PreflightFakeTransport({
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    providerConfigHash: providerBinding.providerConfigHash
  })
  const executor = new C1LegExecutor({ providerBinding })
  const native = executor.execute({
    studyId,
    task,
    stratum: task.stratum,
    pairId,
    arm: 'NATIVE',
    runId: 'c1-20260902-treatment-opportunity-NATIVE-aaaaaaaa',
    turnId: 'turn-treatment-native',
    modelCallId: 'model-call-treatment-native',
    fixtureContentSha256: 'preflight-fixture',
    fixtureTreeObjectId: 'preflight-tree',
    observation,
    providerBinding,
    transport: nativeTransport,
    treatmentReady: true,
    runtimeSessionId,
    recompositionSequence: 0
  })
  const initialRuntime = executor.execute({
    studyId,
    task,
    stratum: task.stratum,
    pairId,
    arm: 'RUNTIME',
    runId: 'c1-20260902-treatment-initial-RUNTIME-bbbbbbbb',
    turnId: 'turn-treatment-initial',
    modelCallId: 'model-call-treatment-initial',
    fixtureContentSha256: 'preflight-fixture',
    fixtureTreeObjectId: 'preflight-tree',
    observation,
    providerBinding,
    transport: nativeTransport,
    treatmentReady: true,
    runtimeSessionId,
    recompositionSequence: 0
  })
  const restoredTransport = new C1PreflightFakeTransport({
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    providerConfigHash: providerBinding.providerConfigHash
  })
  const runtime = executor.execute({
    studyId,
    task,
    stratum: task.stratum,
    pairId,
    arm: 'RUNTIME',
    runId: 'c1-20260902-treatment-changed-RUNTIME-cccccccc',
    turnId: 'turn-treatment-changed',
    modelCallId: 'model-call-treatment-changed',
    fixtureContentSha256: 'preflight-fixture',
    fixtureTreeObjectId: 'preflight-tree',
    observation: {
      ...changedObservation,
      previousWorkingSetId: initialRuntime.workingSet?.workingSetId ?? null
    },
    providerBinding,
    transport: restoredTransport,
    treatmentReady: true,
    runtimeSessionId,
    recompositionSequence: 1,
    previousWorkingSet: initialRuntime.workingSet,
    requireRuntimeDifference: true
  })
  const pass =
    native.capture.contextStrategy === 'NATIVE_UNMANAGED' &&
    runtime.capture.contextStrategy === 'RUNTIME_WORKING_SET' &&
    runtime.capture.lifecycleEligible &&
    runtime.capture.runtimeContextChanged &&
    runtime.capture.modelVisibleSemanticContextFingerprint !==
      native.capture.modelVisibleSemanticContextFingerprint &&
    !sameSourceSet(
      native.capture.providerBoundSourceKeys,
      runtime.capture.providerBoundSourceKeys
    ) &&
    native.capture.systemDeveloperToolStructuresFingerprint ===
      runtime.capture.systemDeveloperToolStructuresFingerprint
  return gate(
    'actual_runtime_treatment_opportunity',
    pass,
    pass
      ? 'Native remained unchanged while an eligible Runtime observation changed through policy-v0 and Active composition'
      : 'the shared executor did not produce the expected Native/Runtime provider-bound difference'
  )
}

async function runAdversarialReadinessProbes(
  limits: C1BudgetLimits,
  providerBinding: C1StrictProviderBinding
): Promise<C1PreflightGate> {
  const checks: boolean[] = []
  const runtimeTask = adversarialTask()
  const observation = createC1ObservedReadTrace({
    observationId: 'adversarial-observation',
    prompt: runtimeTask.prompt,
    fixtureFiles: ['src/target.js', 'src/distractor.js']
  })
  const executor = new C1LegExecutor({ providerBinding })
  const baseInput = {
    studyId: 'c1-20260902-adversarial-study',
    task: runtimeTask,
    stratum: runtimeTask.stratum,
    pairId: 'c1-preflight-adversarial-p01',
    arm: 'RUNTIME' as const,
    runId: 'c1-20260902-preflight-p01-RUNTIME-aaaaaaaa',
    turnId: 'turn-adversarial-01',
    modelCallId: 'model-call-adversarial-01',
    fixtureContentSha256: 'fixture',
    fixtureTreeObjectId: 'tree',
    observation,
    providerBinding,
    treatmentReady: true,
    recompositionSequence: 0,
    runtimeSessionId: 'c1-adversarial-session'
  }
  try {
    executor.execute({
      ...baseInput,
      treatmentReady: false,
      transport: new C1PreflightFakeTransport()
    })
  } catch (error) {
    checks.push(error instanceof C1PreflightFailure && error.code === 'TREATMENT_INACTIVE')
  }
  checks.push(
    !writableScopePass(['src/target.js', 'src/escape.js'], runtimeTask.expectedWritablePaths)
  )

  const providerBudget = new C1HardBudgetGuard({
    perLeg: { maxProviderCalls: 1, maxToolCalls: 4, maxWallClockMs: 100 },
    study: {
      maxProviderCalls: 1,
      maxToolCalls: 4,
      maxWallClockMs: 100,
      maxLegs: 1
    }
  })
  providerBudget.beginLeg(100)
  providerBudget.recordProviderCall()
  try {
    providerBudget.recordProviderCall()
  } catch (error) {
    checks.push(error instanceof C1PreflightFailure && error.code === 'BUDGET_BREACH')
  }
  const toolBudget = new C1HardBudgetGuard({
    perLeg: { maxProviderCalls: 4, maxToolCalls: 1, maxWallClockMs: 100 },
    study: {
      maxProviderCalls: 4,
      maxToolCalls: 1,
      maxWallClockMs: 100,
      maxLegs: 1
    }
  })
  toolBudget.beginLeg(100)
  toolBudget.recordToolCall()
  try {
    toolBudget.recordToolCall()
  } catch (error) {
    checks.push(error instanceof C1PreflightFailure && error.code === 'BUDGET_BREACH')
  }
  const wallClockBudget = new C1HardBudgetGuard({
    perLeg: { maxProviderCalls: 4, maxToolCalls: 4, maxWallClockMs: 1 },
    study: {
      maxProviderCalls: 4,
      maxToolCalls: 4,
      maxWallClockMs: 1,
      maxLegs: 1
    }
  })
  wallClockBudget.beginLeg(100)
  try {
    wallClockBudget.assertWallClockBudget(102)
  } catch (error) {
    checks.push(error instanceof C1PreflightFailure && error.code === 'BUDGET_BREACH')
  }

  checks.push(
    validateC1ProviderUsage({
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: { status: 'REPORTED', value: 0 },
      cacheWriteTokens: { status: 'REPORTED', value: 0 },
      totalTokens: 2,
      usageSource: 'PROVIDER_REPORTED'
    }).usageSource === 'PROVIDER_REPORTED'
  )
  try {
    validateC1ProviderUsage({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2
    })
  } catch (error) {
    checks.push(error instanceof C1PreflightFailure && error.code === 'USAGE_CONTRACT_MISMATCH')
  }
  try {
    validateC1ProviderUsage({
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: { status: 'REPORTED', value: 0 },
      cacheWriteTokens: { status: 'REPORTED', value: 0 },
      totalTokens: 2,
      usageSource: 'LOCAL_ESTIMATE'
    })
  } catch (error) {
    checks.push(error instanceof C1PreflightFailure && error.code === 'USAGE_CONTRACT_MISMATCH')
  }

  try {
    await prepareC1StrictProvider({
      runIdentity: 'c1-20260902-adversarial-model-mismatch',
      requestedModelId: 'wrong-model',
      env: { STEP_PLAN_API_KEY: 'c1-preflight-in-memory-sentinel' }
    })
  } catch (error) {
    checks.push(error instanceof ProviderBindingError && error.code === 'model_mismatch')
  }
  try {
    const wrongProvider = await prepareC1StrictProvider({
      runIdentity: 'c1-20260902-adversarial-provider-mismatch',
      primaryProviderId: 'deepseek',
      requestedModelId: 'deepseek-v4-flash',
      env: { DEEPSEEK_API_KEY: 'c1-preflight-in-memory-sentinel' }
    })
    try {
      assertC1StrictProviderBinding(wrongProvider.experimentBinding)
    } catch (error) {
      checks.push(error instanceof C1PreflightFailure && error.code === 'PROVIDER_BINDING_MISMATCH')
    } finally {
      wrongProvider.dispose()
    }
  } catch {
    checks.push(false)
  }
  try {
    await prepareC1StrictProvider({
      runIdentity: 'c1-20260902-adversarial-fallback',
      allowFallback: true,
      env: { STEP_PLAN_API_KEY: 'c1-preflight-in-memory-sentinel' }
    })
  } catch (error) {
    checks.push(error instanceof ProviderBindingError && error.code === 'fallback_forbidden')
  }

  const mutatedAssignment = [{ taskId: 'mutated' }]
  try {
    assertC1AssignmentMatrixBinding(mutatedAssignment)
  } catch (error) {
    checks.push(error instanceof C1PreflightFailure && error.code === 'ASSIGNMENT_BINDING_MISMATCH')
  }

  const expectInjected = (injection: C1LegFailureInjection, code: C1PreflightFailureCode): void => {
    const transport = new C1PreflightFakeTransport({
      provider: C1_PROVIDER_ID,
      model: C1_MODEL_ID,
      endpoint: C1_PROVIDER_ENDPOINT,
      providerConfigHash: providerBinding.providerConfigHash
    })
    try {
      executor.execute({
        ...baseInput,
        transport,
        failureInjection: injection,
        ...(injection === 'RUNTIME_UNCHANGED' ? { requireRuntimeDifference: true } : {})
      })
    } catch (error) {
      checks.push(
        error instanceof C1PreflightFailure &&
          error.code === code &&
          transport.requests.length === 0
      )
    }
  }
  expectInjected('MATERIALIZATION_FAILURE', 'MATERIALIZATION_FAILURE')
  expectInjected('REWRITE_FAILURE', 'REWRITE_FAILURE')
  expectInjected('FALLBACK', 'FALLBACK_ATTEMPTED')
  expectInjected('RUNTIME_UNCHANGED', 'RUNTIME_CONTEXT_UNCHANGED')
  try {
    executor.execute({
      ...baseInput,
      arm: 'NATIVE',
      runId: 'c1-20260902-preflight-native-aaaaaaaa',
      failureInjection: 'NATIVE_DRIFT',
      nativeBaselineSemanticContextFingerprint: 'wrong-native-fingerprint',
      transport: new C1PreflightFakeTransport()
    })
  } catch (error) {
    checks.push(error instanceof C1PreflightFailure && error.code === 'NATIVE_CONTEXT_DRIFT')
  }
  try {
    executor.execute({
      ...baseInput,
      failureInjection: 'REPLAY_MISMATCH',
      transport: new C1PreflightFakeTransport()
    })
  } catch (error) {
    checks.push(error instanceof C1PreflightFailure && error.code === 'REPLAY_MISMATCH')
  }

  const events = new EventEmitter()
  const killTransport = new C1PreflightFakeTransport()
  let activeKillSwitch: RunKillSwitch | null = null
  let tripCount = 0
  const operatorKillSwitch = installC1OperatorKillSwitch(events, (signal) => {
    tripCount += 1
    activeKillSwitch?.trip(`operator ${signal}`)
    killTransport.block()
  })
  activeKillSwitch = createRunKillSwitch(baseInput.runId, {
    now: () => C1_OBSERVATION_NOW
  })
  events.emit('SIGINT')
  events.emit('SIGTERM')
  try {
    executor.execute({
      ...baseInput,
      killSwitch: activeKillSwitch,
      transport: killTransport
    })
  } catch (error) {
    checks.push(
      error instanceof C1PreflightFailure &&
        error.code === 'KILL_SWITCH_BLOCKED' &&
        activeKillSwitch.isTripped &&
        operatorKillSwitch.firstSignal === 'SIGINT' &&
        tripCount === 1 &&
        killTransport.isBlocked
    )
  }
  operatorKillSwitch.dispose()

  const deadlineEvents = new EventEmitter()
  const deadlineTransport = new C1PreflightFakeTransport()
  let deadlineKillSwitch: RunKillSwitch | null = createRunKillSwitch(
    'c1-20260902-deadline-RUNTIME-aaaaaaaa',
    { now: () => C1_OBSERVATION_NOW }
  )
  const deadlineOperator = installC1OperatorKillSwitch(deadlineEvents, () => {
    deadlineKillSwitch?.trip('deadline')
    deadlineTransport.block()
  })
  const deadlineResult = await runC1BoundedOperation({
    timeoutMs: 5,
    operation: (signal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true
        })
      }),
    onDeadline: () => deadlineEvents.emit('SIGTERM')
  })
  let deadlineBlocked = false
  try {
    deadlineTransport.capture(
      executor.execute({
        ...baseInput,
        runId: 'c1-20260902-deadline-RUNTIME-aaaaaaaa',
        killSwitch: deadlineKillSwitch,
        transport: deadlineTransport
      }).capture
    )
  } catch (error) {
    deadlineBlocked = error instanceof C1PreflightFailure && error.code === 'KILL_SWITCH_BLOCKED'
  }
  checks.push(
    deadlineResult.status === 'DEADLINE_EXCEEDED' &&
      deadlineResult.aborted &&
      deadlineKillSwitch.isTripped &&
      deadlineTransport.isBlocked &&
      deadlineBlocked
  )
  deadlineOperator.dispose()
  deadlineKillSwitch = null

  const root = await mkdtemp(join(tmpdir(), 'canvas-c1-identity-probe-'))
  try {
    const studyId = 'c1-20260902-c1-feasibility-v1-aaaaaaaa'
    await claimSingleUseC1StudyDir(root, studyId)
    try {
      await claimSingleUseC1StudyDir(root, studyId)
    } catch (error) {
      checks.push(error instanceof C1PreflightFailure && error.code === 'IDENTITY_REUSE')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  const artifactRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-artifact-probe-'))
  try {
    const attempted: string[] = []
    const artifactProbe = await writeIndependentC1Artifacts({
      reportDir: artifactRoot,
      documents: [
        { name: 'first.json', content: '{}\n' },
        { name: 'second.json', content: '{}\n' }
      ],
      write: async (path, content) => {
        attempted.push(basename(path))
        if (basename(path) === 'first.json') throw new Error('injected write failure')
        await writeFile(path, content, 'utf8')
      }
    })
    checks.push(artifactProbe.failed.includes('first.json') && attempted.includes('second.json'))
  } finally {
    await rm(artifactRoot, { recursive: true, force: true })
  }
  return gate(
    'credential_free_adversarial_failures',
    checks.every(Boolean),
    `${checks.filter(Boolean).length}/${checks.length} provider, binding, budget, lifecycle, replay, deadline, signal, identity, and evidence injections caught`
  )
}

function validatePairCaptures(
  captures: readonly C1ProviderBoundCapture[],
  plans: readonly C1PreflightLegPlan[]
): C1PreflightGate {
  const planByRunId = new Map(plans.map((plan) => [plan.runId, plan] as const))
  const captureBindingsPass =
    captures.length === plans.length &&
    new Set(captures.map((capture) => capture.runId)).size === captures.length &&
    captures.every((capture) => {
      const plan = planByRunId.get(capture.runId)
      return (
        plan !== undefined &&
        capture.studyId.length > 0 &&
        capture.taskId === plan.taskId &&
        capture.stratum === plan.stratum &&
        capture.pairId === plan.pairId &&
        capture.arm === plan.arm &&
        capture.turnId.length > 0 &&
        capture.modelCallId.length > 0 &&
        capture.sourceDerivation === 'PI_NATIVE_MESSAGE_ANALYSIS' &&
        capture.provider === C1_PROVIDER_ID &&
        capture.model === C1_MODEL_ID &&
        capture.endpoint === C1_PROVIDER_ENDPOINT &&
        capture.providerConfigHash === C1_EXPECTED_PROVIDER_CONFIG_HASH &&
        capture.fallbackSent === false &&
        capture.networkSent === false
      )
    })
  if (!captureBindingsPass) {
    return gate(
      'native_runtime_treatment_isolation',
      false,
      'capture identities do not match the frozen 64-leg plan'
    )
  }
  const pairMap = new Map<string, C1ProviderBoundCapture[]>()
  for (const capture of captures) {
    const rows = pairMap.get(capture.pairId) ?? []
    rows.push(capture)
    pairMap.set(capture.pairId, rows)
  }
  const pass = plans.every((plan) => {
    if (plan.arm !== 'NATIVE') return true
    const rows = pairMap.get(plan.pairId) ?? []
    const native = rows.find((row) => row.arm === 'NATIVE')
    const runtime = rows.find((row) => row.arm === 'RUNTIME')
    return (
      rows.length === 2 &&
      native !== undefined &&
      runtime !== undefined &&
      native.systemDeveloperToolStructuresFingerprint ===
        runtime.systemDeveloperToolStructuresFingerprint &&
      native.providerConfigHash === runtime.providerConfigHash &&
      native.fallbackSent === false &&
      runtime.fallbackSent === false &&
      (!runtime.lifecycleEligible ||
        (native.modelVisibleSemanticContextFingerprint !==
          runtime.modelVisibleSemanticContextFingerprint &&
          !sameSourceSet(native.providerBoundSourceKeys, runtime.providerBoundSourceKeys)))
    )
  })
  const eligibleCount = captures.filter((capture) => capture.lifecycleEligible).length
  return gate(
    'native_runtime_treatment_isolation',
    pass,
    `${pairMap.size}/32 pairs captured; ${eligibleCount} lifecycle-eligible captures required an observed Runtime change`
  )
}

/** Run the complete credential-free C1 live-runner/preflight check. */
export async function runC1LivePreflight(
  options: {
    readonly repoRoot?: string
    readonly outputRoot?: string
    readonly now?: () => Date
  } = {}
): Promise<C1LivePreflightReport> {
  const repoRoot = options.repoRoot ?? resolve(import.meta.dirname, '..', '..', '..')
  const nodeVersion = process.versions.node
  const gates: C1PreflightGate[] = []
  const legs: C1PreflightLegEvidence[] = []
  const failures: { code: C1PreflightFailureCode; message: string }[] = []
  let study: C1FrozenStudy | null = null
  let identity: C1PreflightIdentity | null = null
  let reportDir: string | null = null
  let providerBinding: C1StrictProviderBinding | null = null
  const fakeTransport = new C1PreflightFakeTransport({
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    providerConfigHash: C1_EXPECTED_PROVIDER_CONFIG_HASH
  })
  let artifactResult: {
    readonly artifacts: readonly C1PreflightArtifactSummary[]
    readonly failed: readonly string[]
  } = {
    artifacts: [],
    failed: []
  }
  try {
    assertNodeVersion(nodeVersion)
    gates.push(gate('node_range', true, `${nodeVersion} satisfies ${C1_NODE_RANGE}`))
    study = await loadC1FrozenStudy(repoRoot)
    gates.push(
      gate('frozen_binding', true, 'protocol, manifest, contract, readiness, and hashes match')
    )
    const readiness = runC1TreatmentReadiness()
    const readinessPass = readiness.overallVerdict === 'PASS' && readiness.providerCalls === 0
    if (!readinessPass)
      fail(
        'READINESS_BINDING_MISMATCH',
        'C1-C treatment readiness replay did not pass zero-provider'
      )
    gates.push(
      gate('c1c_treatment_readiness', true, 'C1-C treatment readiness PASS with providerCalls=0')
    )
    const fixtureBindings = new Map<
      string,
      {
        readonly sourcePath: string
        readonly contentSummary: C1FixtureContentSummary
      }
    >()
    for (const task of study.tasks)
      fixtureBindings.set(task.taskId, await verifyC1FixtureBinding(study, task))
    gates.push(
      gate('fresh_fixture_binding', true, 'all four frozen fixture tree/content hashes verified')
    )
    identity = createC1PreflightIdentity(options.now?.() ?? new Date())
    const reportRoot =
      options.outputRoot ?? (await mkdtemp(join(tmpdir(), 'canvas-c1-live-preflight-')))
    reportDir = await claimSingleUseC1StudyDir(reportRoot, identity.studyId)
    try {
      providerBinding = await prepareC1StrictProvider({
        runIdentity: identity.studyId
      })
      assertC1StrictProviderBinding(providerBinding.experimentBinding)
    } catch (error) {
      const normalized = normalizeFailure(error)
      fail(
        error instanceof ProviderBindingError ? 'PROVIDER_PREPARATION_FAILURE' : normalized.code,
        normalized.message
      )
    }
    gates.push(
      gate(
        'strict_provider_preparation',
        providerBinding !== null,
        'Step Plan primary/model binding prepared in memory with fallback disabled'
      )
    )
    const boundProvider = providerBinding
    if (boundProvider === null)
      fail('PROVIDER_PREPARATION_FAILURE', 'strict provider binding is absent')
    const adversarialGate = await runAdversarialReadinessProbes(
      {
        perLeg: study.perLegBudgets,
        study: study.studyBudgets
      },
      boundProvider
    )
    gates.push(adversarialGate)
    gates.push(runC1TreatmentOpportunityProbe(boundProvider))
    const plans = buildC1PreflightLegPlan(study, identity)
    const budgetGuard = new C1HardBudgetGuard({
      perLeg: study.perLegBudgets,
      study: study.studyBudgets
    })
    let activeLegKillSwitch: RunKillSwitch | null = null
    let killSwitchDisposed = false
    const operatorSignals = new EventEmitter()
    const operatorKillSwitch = installC1OperatorKillSwitch(operatorSignals, (signal) => {
      activeLegKillSwitch?.trip(`operator ${signal}`)
      fakeTransport.block()
    })
    const executor = new C1LegExecutor({ providerBinding: boundProvider })
    try {
      for (const plan of plans) {
        if (operatorKillSwitch.isTripped) {
          fail(
            'KILL_SWITCH_BLOCKED',
            'C1 study received a terminal operator signal before the next leg'
          )
        }
        const task = study.tasks.find((candidate) => candidate.taskId === plan.taskId)
        const fixtureBinding = fixtureBindings.get(plan.taskId)
        if (task === undefined || fixtureBinding === undefined)
          fail('FIXTURE_BINDING_MISMATCH', `missing preflight task ${plan.taskId}`)
        const legDir = await claimSingleUseC1LegDir(reportDir, plan.runId)
        const legStartedAt = Date.now()
        budgetGuard.beginLeg(legStartedAt)
        const legKillSwitch = createRunKillSwitch(plan.runId, {
          now: () => new Date().toISOString()
        })
        activeLegKillSwitch = legKillSwitch
        const fixture = await materializeFreshC1Fixture(fixtureBinding.sourcePath)
        try {
          const copiedSummary = await computeC1FixtureContentSummary(fixture.path)
          if (copiedSummary.sha256 !== fixtureBinding.contentSummary.sha256) {
            fail('FIXTURE_BINDING_MISMATCH', `fresh sandbox content mismatch for ${plan.runId}`)
          }
          const changedPaths = await simulateExpectedWritableChange(
            fixture.path,
            task.expectedWritablePaths[0]!
          )
          if (!writableScopePass(changedPaths, task.expectedWritablePaths)) {
            fail('FIXTURE_BINDING_MISMATCH', `simulated writable scope failed for ${plan.runId}`)
          }
          const observation = createC1ObservedReadTrace({
            observationId: plan.runId,
            prompt: task.prompt,
            fixtureFiles: copiedSummary.files,
            taskPhase: 'INVESTIGATE'
          })
          budgetGuard.assertWallClockBudget(Date.now())
          const execution = executor.execute({
            studyId: identity.studyId,
            task,
            stratum: plan.stratum,
            pairId: plan.pairId,
            arm: plan.arm,
            runId: plan.runId,
            turnId: `turn-${String(plan.legIndex + 1).padStart(2, '0')}`,
            modelCallId: `model-call-${String(plan.legIndex + 1).padStart(2, '0')}`,
            fixtureContentSha256: copiedSummary.sha256,
            fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
            observation,
            providerBinding: boundProvider,
            transport: fakeTransport,
            treatmentReady: readiness.overallVerdict === 'PASS',
            killSwitch: legKillSwitch,
            runtimeSessionId: `${identity.studyId}:${plan.pairId}`,
            recompositionSequence: 0
          })
          const wallClockMs = Date.now() - legStartedAt
          budgetGuard.assertWallClockBudget(Date.now())
          const evidence: C1PreflightLegEvidence = {
            legIndex: plan.legIndex,
            taskId: plan.taskId,
            stratum: plan.stratum,
            pairId: plan.pairId,
            pairOrdinal: plan.pairOrdinal,
            order: plan.order,
            arm: plan.arm,
            runId: plan.runId,
            turnId: execution.capture.turnId,
            modelCallId: execution.capture.modelCallId,
            fixtureContentSha256: copiedSummary.sha256,
            fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
            freshSandbox: true,
            sandboxReused: false,
            changedPaths,
            writableScopePass: true,
            providerBoundSourceKeys: execution.capture.providerBoundSourceKeys,
            modelVisibleSemanticContextFingerprint:
              execution.capture.modelVisibleSemanticContextFingerprint,
            systemDeveloperToolStructuresFingerprint:
              execution.capture.systemDeveloperToolStructuresFingerprint,
            providerConfigHash: execution.capture.providerConfigHash,
            workingSetId: execution.capture.workingSetId,
            transitionId: execution.capture.transitionId,
            lifecycleEligible: execution.capture.lifecycleEligible,
            runtimeContextChanged: execution.capture.runtimeContextChanged,
            sourceDerivation: execution.capture.sourceDerivation,
            providerCalls: 0,
            toolCalls: 0,
            wallClockMs,
            taskOutcome: 'NOT_OBSERVED_IN_PREFLIGHT',
            lifecycleEvidence: 'NOT_OBSERVED_IN_PREFLIGHT',
            replayMismatch: execution.replayMismatch
          }
          try {
            await writeFile(
              join(legDir, 'leg.json'),
              `${JSON.stringify(evidence, null, 2)}\n`,
              'utf8'
            )
          } catch (error) {
            fail(
              'EVIDENCE_WRITE_FAILURE',
              `failed to write leg evidence for ${plan.runId}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
          legs.push(evidence)
          budgetGuard.endLeg({ wallClockMs })
        } finally {
          activeLegKillSwitch = null
          await fixture.cleanup()
        }
      }
    } finally {
      operatorKillSwitch.dispose()
      killSwitchDisposed = true
    }
    gates.push(validatePairCaptures(fakeTransport.requests, plans))
    const budgetLedger = budgetGuard.ledger
    gates.push(
      gate(
        'hard_budget_enforcement',
        budgetLedger.completedLegs === 64 &&
          budgetLedger.providerCalls === 0 &&
          budgetLedger.toolCalls === 0 &&
          budgetLedger.wallClockMs <= study.studyBudgets.maxWallClockMs,
        `64 legs closed at 0 provider calls, 0 tool calls, ${budgetLedger.wallClockMs}ms wall clock`
      )
    )
    gates.push(
      gate(
        'identity_and_checkpoint',
        legs.length === 64 && new Set(legs.map((leg) => leg.runId)).size === 64,
        '64 unique leg identities claimed before capture'
      )
    )
    gates.push(
      gate(
        'replay_and_evidence_shape',
        legs.every((leg) => leg.replayMismatch === 0 && leg.writableScopePass),
        'all leg evidence is metadata-only, joinable, and replay-clean'
      )
    )
    gates.push(
      gate(
        'kill_switch_cleanup',
        killSwitchDisposed && !operatorKillSwitch.isTripped,
        'SIGINT/SIGTERM operator kill switch was installed for the 64-leg flow and disposed cleanly'
      )
    )
  } catch (error) {
    failures.push(normalizeFailure(error))
  } finally {
    providerBinding?.dispose()
    if (study !== null && identity !== null && reportDir !== null) {
      try {
        artifactResult = await writePreflightArtifacts({
          reportDir,
          status:
            failures.length === 0 && gates.every((item) => item.verdict === 'PASS')
              ? 'PASS'
              : 'FAIL',
          study,
          identity,
          legs,
          gates,
          evidenceWriteFailures: failures
            .filter((failure) => failure.code === 'EVIDENCE_WRITE_FAILURE')
            .map((failure) => failure.message)
        })
        for (const artifact of artifactResult.failed) {
          failures.push({
            code: 'EVIDENCE_WRITE_FAILURE',
            message: `artifact write failed: ${artifact}`
          })
        }
      } catch (error) {
        failures.push({
          code: 'EVIDENCE_WRITE_FAILURE',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }
  const status =
    failures.length === 0 && gates.length > 0 && gates.every((item) => item.verdict === 'PASS')
      ? 'PASS'
      : 'FAIL'
  return {
    preflightId: C1_LIVE_PREFLIGHT_ID,
    executionMode: C1_LIVE_PREFLIGHT_MODE,
    status,
    nodeVersion,
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    providerConfigHash: providerBinding?.providerConfigHash ?? null,
    providerCalls: 0,
    networkRequests: fakeTransport.networkRequests,
    fakeProviderBoundCaptures: fakeTransport.requests.length,
    studyId: identity?.studyId ?? null,
    reportDir,
    contractSha256: C1_C_CONTRACT_SHA256,
    assignmentMatrixSha256: C1_C_ASSIGNMENT_MATRIX_SHA256,
    taskManifestSha256: C1_C_TASK_MANIFEST_SHA256,
    treatmentRevision: C1_C_TREATMENT_REVISION,
    gates,
    legs,
    artifacts: artifactResult.artifacts,
    failures
  }
}
