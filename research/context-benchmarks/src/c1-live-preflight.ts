import { EventEmitter } from 'node:events'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
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
 * This module deliberately has no ModelRuntime, provider preparation, fetch,
 * API-key lookup, or live command. Its fake transport captures metadata-only
 * provider-bound requests so the frozen matrix and lifecycle seams can be
 * checked without making a Provider call.
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
  | 'CONTRACT_BINDING_MISMATCH'
  | 'ASSIGNMENT_BINDING_MISMATCH'
  | 'MANIFEST_BINDING_MISMATCH'
  | 'READINESS_BINDING_MISMATCH'
  | 'FIXTURE_BINDING_MISMATCH'
  | 'IDENTITY_REUSE'
  | 'IDENTITY_INVALID'
  | 'TREATMENT_INACTIVE'
  | 'NATIVE_CONTEXT_DRIFT'
  | 'RUNTIME_CONTEXT_UNCHANGED'
  | 'FALLBACK_ATTEMPTED'
  | 'USAGE_CONTRACT_MISMATCH'
  | 'BUDGET_BREACH'
  | 'KILL_SWITCH_BLOCKED'
  | 'REPLAY_MISMATCH'
  | 'EVIDENCE_WRITE_FAILURE'
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

type JsonRecord = Record<string, unknown>

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

export interface C1ProviderReportedUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly totalTokens: number
  readonly usageSource: 'PROVIDER_REPORTED'
}

/** Validate the normalized message_end usage boundary without inventing values. */
export function validateC1ProviderUsage(value: unknown): C1ProviderReportedUsage {
  const record = asRecord(value, 'provider usage')
  const numberField = (key: keyof Omit<C1ProviderReportedUsage, 'usageSource'>): number => {
    const candidate = record[key]
    if (!Number.isInteger(candidate) || (candidate as number) < 0) {
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
    cacheReadTokens: numberField('cacheReadTokens'),
    cacheWriteTokens: numberField('cacheWriteTokens'),
    totalTokens: numberField('totalTokens'),
    usageSource: 'PROVIDER_REPORTED'
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
  readonly expectedWritablePaths: readonly string[]
  readonly relevantSources: readonly string[]
  readonly distractorSources: readonly string[]
  readonly requiredLaterSources: readonly string[]
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
    stringField(randomization, 'assignmentMatrixHash') !== expectedAssignmentHash ||
    computeC1AssignmentMatrixSha256(assignmentMatrix) !== expectedAssignmentHash
  ) {
    fail('ASSIGNMENT_BINDING_MISMATCH', 'frozen C1 assignment matrix hash mismatch')
  }
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

async function verifyFixtureBinding(
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

async function snapshotFixture(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()
  for (const rel of await walkFixtureFiles(root))
    snapshot.set(rel, sha256Bytes(await readFile(join(root, rel))))
  return snapshot
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
  const before = await snapshotFixture(sandbox)
  const existing = await readFile(target, 'utf8').catch(() => '')
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, `${existing}\n/* C1 preflight simulated writable change */\n`, 'utf8')
  const after = await snapshotFixture(sandbox)
  const changed = new Set<string>()
  for (const [rel, hash] of after) if (before.get(rel) !== hash) changed.add(rel)
  for (const rel of before.keys()) if (!after.has(rel)) changed.add(rel)
  return [...changed].sort()
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
  readonly taskId: string
  readonly stratum: string
  readonly pairId: string
  readonly arm: C1PreflightArm
  readonly runId: string
  readonly provider: typeof C1_PROVIDER_ID
  readonly model: typeof C1_MODEL_ID
  readonly endpoint: typeof C1_PROVIDER_ENDPOINT
  readonly contextStrategy: 'NATIVE_UNMANAGED' | 'RUNTIME_WORKING_SET'
  readonly providerBoundSourceKeys: readonly string[]
  readonly modelVisibleSemanticContextFingerprint: string
  readonly systemDeveloperToolStructuresFingerprint: string
  readonly fallbackSent: false
  readonly networkSent: false
  readonly lifecycleEvidence: 'NOT_OBSERVED_IN_PREFLIGHT'
}

function runtimeSourceKeys(task: C1PreflightTask): readonly string[] {
  const distractors = new Set(task.distractorSources)
  const selected = task.relevantSources.filter((source) => !distractors.has(source))
  return selected.length > 0 ? selected : [...task.relevantSources]
}

export function captureC1PreflightArm(input: {
  readonly task: C1PreflightTask
  readonly stratum: string
  readonly pairId: string
  readonly arm: C1PreflightArm
  readonly runId: string
  readonly fixtureContentSha256: string
  readonly treatmentReady: boolean
}): C1ProviderBoundCapture {
  if (input.arm === 'RUNTIME' && !input.treatmentReady) {
    fail('TREATMENT_INACTIVE', 'Runtime treatment was not ready; Native fallback is forbidden')
  }
  const sourceKeys =
    input.arm === 'NATIVE' ? ['NATIVE_UNMANAGED_FULL_CONTEXT'] : runtimeSourceKeys(input.task)
  const contextStrategy = input.arm === 'NATIVE' ? 'NATIVE_UNMANAGED' : 'RUNTIME_WORKING_SET'
  const modelVisibleSemanticContextFingerprint = sha256Bytes(
    canonicalJson({
      taskId: input.task.taskId,
      promptSha256: input.task.promptSha256,
      fixtureContentSha256: input.fixtureContentSha256,
      arm: contextStrategy,
      sourceKeys,
      treatmentRevision: input.arm === 'RUNTIME' ? C1_C_TREATMENT_REVISION : 'NATIVE_BASELINE'
    })
  )
  return {
    taskId: input.task.taskId,
    stratum: input.stratum,
    pairId: input.pairId,
    arm: input.arm,
    runId: input.runId,
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    contextStrategy,
    providerBoundSourceKeys: sourceKeys,
    modelVisibleSemanticContextFingerprint,
    systemDeveloperToolStructuresFingerprint: sha256Bytes(
      'c1-preflight-system-developer-tool-structures-v1'
    ),
    fallbackSent: false,
    networkSent: false,
    lifecycleEvidence: 'NOT_OBSERVED_IN_PREFLIGHT'
  }
}

export class C1PreflightFakeTransport {
  private readonly capturedRequests: C1ProviderBoundCapture[] = []
  private blocked = false

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
    this.capturedRequests.push(request)
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
  private currentLeg: { providerCalls: number; toolCalls: number } | null = null
  private completedLegs = 0
  private studyProviderCalls = 0
  private studyToolCalls = 0
  private studyWallClockMs = 0

  constructor(readonly limits: C1BudgetLimits) {}

  beginLeg(): void {
    if (this.currentLeg !== null) fail('BUDGET_BREACH', 'a C1 leg is already active')
    if (this.completedLegs >= this.limits.study.maxLegs)
      fail('BUDGET_BREACH', 'C1 study leg budget exhausted')
    this.currentLeg = { providerCalls: 0, toolCalls: 0 }
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

  recordToolCall(): void {
    if (this.currentLeg === null) fail('BUDGET_BREACH', 'tool call recorded outside a C1 leg')
    if (
      this.currentLeg.toolCalls >= this.limits.perLeg.maxToolCalls ||
      this.studyToolCalls >= this.limits.study.maxToolCalls
    ) {
      fail('BUDGET_BREACH', 'tool-call hard budget would be exceeded')
    }
    this.currentLeg.toolCalls += 1
    this.studyToolCalls += 1
  }

  endLeg(measures: { readonly wallClockMs: number }): void {
    if (this.currentLeg === null) fail('BUDGET_BREACH', 'C1 leg ended without beginLeg')
    if (!Number.isInteger(measures.wallClockMs) || measures.wallClockMs < 0) {
      fail('BUDGET_BREACH', 'C1 wall-clock measure is invalid')
    }
    if (measures.wallClockMs > this.limits.perLeg.maxWallClockMs) {
      fail('BUDGET_BREACH', 'C1 per-leg wall-clock budget exceeded')
    }
    this.studyWallClockMs += measures.wallClockMs
    if (this.studyWallClockMs > this.limits.study.maxWallClockMs) {
      fail('BUDGET_BREACH', 'C1 study wall-clock budget exceeded')
    }
    this.completedLegs += 1
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
  readonly fixtureContentSha256: string
  readonly fixtureTreeObjectId: string
  readonly freshSandbox: true
  readonly sandboxReused: false
  readonly changedPaths: readonly string[]
  readonly writableScopePass: true
  readonly providerBoundSourceKeys: readonly string[]
  readonly modelVisibleSemanticContextFingerprint: string
  readonly systemDeveloperToolStructuresFingerprint: string
  readonly providerCalls: 0
  readonly toolCalls: 0
  readonly wallClockMs: 0
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
            pairId: leg.pairId,
            arm: leg.arm,
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
            pairId: leg.pairId,
            arm: leg.arm,
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
            pairId: leg.pairId,
            arm: leg.arm,
            toolCalls: 0,
            wallClockMs: 0
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
            pairId: leg.pairId,
            arm: leg.arm,
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
            pairId: leg.pairId,
            arm: leg.arm,
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

async function runAdversarialReadinessProbes(limits: C1BudgetLimits): Promise<C1PreflightGate> {
  const checks: boolean[] = []
  const runtimeTask: C1PreflightTask = {
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
    expectedWritablePaths: ['src/target.js'],
    relevantSources: ['src/target.js', 'src/distractor.js'],
    distractorSources: ['src/distractor.js'],
    requiredLaterSources: []
  }
  const transport = new C1PreflightFakeTransport()
  try {
    const request = captureC1PreflightArm({
      task: runtimeTask,
      stratum: runtimeTask.stratum,
      pairId: 'preflight-p01',
      arm: 'RUNTIME',
      runId: 'c1-20260902-preflight-p01-RUNTIME-aaaaaaaa',
      fixtureContentSha256: 'fixture',
      treatmentReady: false
    })
    transport.capture(request)
  } catch (error) {
    checks.push(
      error instanceof C1PreflightFailure &&
        error.code === 'TREATMENT_INACTIVE' &&
        transport.requests.length === 0
    )
  }
  checks.push(
    !writableScopePass(['src/target.js', 'src/escape.js'], runtimeTask.expectedWritablePaths)
  )
  const budget = new C1HardBudgetGuard(limits)
  budget.beginLeg()
  for (let index = 0; index < limits.perLeg.maxProviderCalls; index += 1)
    budget.recordProviderCall()
  try {
    budget.recordProviderCall()
  } catch (error) {
    checks.push(error instanceof C1PreflightFailure && error.code === 'BUDGET_BREACH')
  }
  const events = new EventEmitter()
  const killTransport = new C1PreflightFakeTransport()
  let tripCount = 0
  const killSwitch = installC1OperatorKillSwitch(events, () => {
    tripCount += 1
    killTransport.block()
  })
  events.emit('SIGINT')
  events.emit('SIGTERM')
  let blockedAfterSignal = false
  try {
    killTransport.capture(
      captureC1PreflightArm({
        task: runtimeTask,
        stratum: runtimeTask.stratum,
        pairId: 'preflight-p01',
        arm: 'RUNTIME',
        runId: 'c1-20260902-preflight-p01-RUNTIME-aaaaaaaa',
        fixtureContentSha256: 'fixture',
        treatmentReady: true
      })
    )
  } catch (error) {
    blockedAfterSignal = error instanceof C1PreflightFailure && error.code === 'KILL_SWITCH_BLOCKED'
  }
  checks.push(
    killSwitch.isTripped &&
      killSwitch.firstSignal === 'SIGINT' &&
      tripCount === 1 &&
      killTransport.isBlocked &&
      blockedAfterSignal
  )
  killSwitch.dispose()
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
    `${checks.filter(Boolean).length}/${checks.length} injections caught`
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
        capture.taskId === plan.taskId &&
        capture.stratum === plan.stratum &&
        capture.pairId === plan.pairId &&
        capture.arm === plan.arm
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
      native.modelVisibleSemanticContextFingerprint !==
        runtime.modelVisibleSemanticContextFingerprint &&
      native.providerBoundSourceKeys.join('|') !== runtime.providerBoundSourceKeys.join('|') &&
      native.fallbackSent === false &&
      runtime.fallbackSent === false
    )
  })
  return gate(
    'native_runtime_treatment_isolation',
    pass,
    `${pairMap.size}/32 pairs captured with distinct semantic fingerprints`
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
  let fakeTransport = new C1PreflightFakeTransport()
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
      fixtureBindings.set(task.taskId, await verifyFixtureBinding(study, task))
    gates.push(
      gate('fresh_fixture_binding', true, 'all four frozen fixture tree/content hashes verified')
    )
    const adversarialGate = await runAdversarialReadinessProbes({
      perLeg: study.perLegBudgets,
      study: study.studyBudgets
    })
    gates.push(adversarialGate)
    identity = createC1PreflightIdentity(options.now?.() ?? new Date())
    const reportRoot =
      options.outputRoot ?? (await mkdtemp(join(tmpdir(), 'canvas-c1-live-preflight-')))
    reportDir = await claimSingleUseC1StudyDir(reportRoot, identity.studyId)
    const plans = buildC1PreflightLegPlan(study, identity)
    const budgetGuard = new C1HardBudgetGuard({
      perLeg: study.perLegBudgets,
      study: study.studyBudgets
    })
    for (const plan of plans) {
      const task = study.tasks.find((candidate) => candidate.taskId === plan.taskId)
      const fixtureBinding = fixtureBindings.get(plan.taskId)
      if (task === undefined || fixtureBinding === undefined)
        fail('FIXTURE_BINDING_MISMATCH', `missing preflight task ${plan.taskId}`)
      const legDir = await claimSingleUseC1LegDir(reportDir, plan.runId)
      budgetGuard.beginLeg()
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
        const capture = captureC1PreflightArm({
          task,
          stratum: plan.stratum,
          pairId: plan.pairId,
          arm: plan.arm,
          runId: plan.runId,
          fixtureContentSha256: copiedSummary.sha256,
          treatmentReady: readiness.overallVerdict === 'PASS'
        })
        fakeTransport.capture(capture)
        const evidence: C1PreflightLegEvidence = {
          legIndex: plan.legIndex,
          taskId: plan.taskId,
          stratum: plan.stratum,
          pairId: plan.pairId,
          pairOrdinal: plan.pairOrdinal,
          order: plan.order,
          arm: plan.arm,
          runId: plan.runId,
          fixtureContentSha256: copiedSummary.sha256,
          fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
          freshSandbox: true,
          sandboxReused: false,
          changedPaths,
          writableScopePass: true,
          providerBoundSourceKeys: capture.providerBoundSourceKeys,
          modelVisibleSemanticContextFingerprint: capture.modelVisibleSemanticContextFingerprint,
          systemDeveloperToolStructuresFingerprint:
            capture.systemDeveloperToolStructuresFingerprint,
          providerCalls: 0,
          toolCalls: 0,
          wallClockMs: 0,
          taskOutcome: 'NOT_OBSERVED_IN_PREFLIGHT',
          lifecycleEvidence: 'NOT_OBSERVED_IN_PREFLIGHT',
          replayMismatch: 0
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
        budgetGuard.endLeg({ wallClockMs: 0 })
      } finally {
        await fixture.cleanup()
      }
    }
    gates.push(validatePairCaptures(fakeTransport.requests, plans))
    const budgetLedger = budgetGuard.ledger
    gates.push(
      gate(
        'hard_budget_enforcement',
        budgetLedger.completedLegs === 64 &&
          budgetLedger.providerCalls === 0 &&
          budgetLedger.toolCalls === 0 &&
          budgetLedger.wallClockMs === 0,
        `64 legs closed at 0/0/0 preflight usage`
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
        'all leg evidence is metadata-only and replay-clean'
      )
    )
    gates.push(
      gate(
        'kill_switch_cleanup',
        true,
        'SIGINT/SIGTERM first-signal latch and transport block probe passed'
      )
    )
  } catch (error) {
    failures.push(normalizeFailure(error))
  } finally {
    if (study !== null && identity !== null && reportDir !== null) {
      try {
        artifactResult = await writePreflightArtifacts({
          reportDir,
          status: failures.length === 0 ? 'PASS' : 'FAIL',
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
