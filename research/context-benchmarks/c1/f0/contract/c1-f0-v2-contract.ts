import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const C1_F0_V2_CONTRACT_RELATIVE_PATH =
  'research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v2.json'
export const C1_F0_V2_CONTRACT_ID = 'C1_F0_EXECUTION_FEASIBILITY_V2' as const
export const C1_F0_V2_CONTRACT_SCHEMA_VERSION = 2 as const
export const C1_F0_V2_PENDING_BINDING = 'PENDING_F0_V2_IMPLEMENTATION' as const
export const C1_F0_V2_PROVIDER_CONFIG_HASH =
  'bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a'
export const C1_F0_V2_MAX_UNKNOWN_RUN_RATE = 0.125
export const C1_F0_V2_MIN_ADJUDICABLE_RUNS_PER_TASK = 14

type JsonRecord = Record<string, unknown>

/**
 * Minimal code-side binding for freeze-critical design fields. Execution
 * revision and surface hash remain intentionally outside this projection.
 */
export const C1_F0_V2_FREEZE_INVARIANTS = Object.freeze({
  runContractHashRole: 'FREEZE_CANDIDATE',
  claims: 'F0_V2_FEASIBILITY_ONLY_NO_RUNTIME_EFFECT_NO_RECOVERY_CAUSAL_CLAIM',
  estimand: 'NATIVE_EXECUTION_FEASIBILITY_ON_F0_V2_FROZEN_TASK_PANEL',
  studyRelation: {
    priorContractId: 'C1_F0_EXECUTION_FEASIBILITY_V1',
    priorStudyId: 'c1-f0-20260912-41753674',
    priorArtifactPolicy: 'IMMUTABLE_CONSUMED_NO_RESUME_RETRY_REUSE_REBIND',
    comparisonPolicy: 'DESCRIPTIVE_V1_V2_ONLY_NOT_POOLED'
  },
  design: {
    arm: 'NATIVE_ONLY',
    runtimeIntervention: 'DISABLED',
    taskPanelId: 'C1_F0_TASK_PANEL_V1',
    taskCount: 2,
    runsPerTask: 16,
    totalRuns: 32,
    maxConcurrency: 1,
    runOrder: {
      algorithmId: 'C1_F0_DETERMINISTIC_BALANCED_ALTERNATION_V1',
      seed: 'c1-f0-v2-task-order-20260913',
      pattern: ['c1-t1-localized-distractor-v1', 'c1-t2-multi-file-migration-v1'],
      repetitions: 16
    },
    confidence: {
      level: 0.95,
      intervalMethod: 'CLOPPER_PEARSON_EXACT',
      tail: 'ONE_SIDED'
    }
  },
  taskPanel: [
    {
      taskId: 'c1-t1-localized-distractor-v1',
      stratum: 'localized_investigation_distractors',
      fixturePath: 'research/context-benchmarks/corpus/L3-noisy-bug-hunt/fixture',
      expectedWritablePaths: ['src/scheduler/paginator.js'],
      fixtureTreeObjectId: '860da37c32e15ba749b106a0187dde5a36a161a9',
      fixtureContentSha256: '09d921c46e6a7c524d8992f7ec87753efbcc69e5bd1470d5873f53f72927d8d5',
      promptSha256: '7ede05ac9f2f5d77771ad72ca2b83d652bf26b8dcc61dbba03aa4f6978068615',
      objectiveOracle: {
        command: 'node',
        args: ['--test', 'test/pagination.test.js'],
        expectedExitCode: 0,
        timeoutMs: 30000
      },
      regressionOracle: {
        command: 'node',
        args: ['--test', 'test/regression.test.js'],
        expectedExitCode: 0,
        timeoutMs: 30000
      }
    },
    {
      taskId: 'c1-t2-multi-file-migration-v1',
      stratum: 'multi_file_multi_source',
      fixturePath: 'research/context-benchmarks/corpus/L1-multi-file-refactor/fixture',
      expectedWritablePaths: [
        'utils/format.js',
        'models/product.js',
        'models/order.js',
        'models/shipment.js',
        'services/cart.js',
        'services/pricing.js',
        'services/inventory.js',
        'services/billing.js',
        'index.js'
      ],
      fixtureTreeObjectId: 'd0ac86afcc7bb76b19e0f6d6e052ce642d25e784',
      fixtureContentSha256: '1a9ecd5bc168568ce9285c405257d7c2875090411fd8f594dc5849d1f868ede3',
      promptSha256: '1c09fb86ab5e4cfde9a9cf1ba05282b5007081b5c468df2fe3c9b44eff084a03',
      objectiveOracle: {
        command: 'node',
        args: ['--test', 'test/format-price.test.js'],
        expectedExitCode: 0,
        timeoutMs: 30000
      },
      regressionOracle: {
        command: 'node',
        args: ['--test', 'test/regression.test.js'],
        expectedExitCode: 0,
        timeoutMs: 30000
      }
    }
  ],
  enrollmentBinding: {
    taskManifestPath: 'research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json',
    taskManifestSha256: '2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38',
    panelSelection: 'FROZEN_F0_TASK_PANEL_ONLY',
    historicalOpportunityUse: 'NOT_USED_FOR_EXECUTION_OR_SELECTION_AFTER_FREEZE'
  },
  executionBinding: {
    provider: 'step-plan',
    model: 'step-3.7-flash',
    endpoint: 'https://api.stepfun.com/step_plan/v1/chat/completions',
    nodeRange: '>=24.0.0 <25.0.0',
    credentialEnv: 'STEP_PLAN_API_KEY',
    credentialPersistence: 'MEMORY_ONLY',
    fallback: 'NONE',
    runtimeIntervention: 'DISABLED',
    providerConfigHash: C1_F0_V2_PROVIDER_CONFIG_HASH
  },
  toolHardening: {
    moduleId: 'C1_F0_TOOL_HARDENING_V1',
    modulePath: 'research/context-benchmarks/c1/f0/hardening/c1-f0-tool-hardening.ts',
    mode: 'PROSPECTIVE_OPT_IN_ONLY',
    recoveryPolicy: {
      maxIdenticalFailureAttempts: 2,
      requestSignature: 'SHA256(toolName + NUL + canonicalJson(semanticArguments))',
      canonicalization: 'JSON_OBJECT_KEYS_SORTED_RECURSIVELY',
      streakResetOn: ['DIFFERENT_CANONICAL_REQUEST', 'SUCCESS'],
      thirdIdenticalAction: 'REPEATED_FAILURE_BLOCKED',
      implicitRetry: 'FORBIDDEN',
      correctedRetry: 'MODEL_EMITTED_ONLY',
      linkageFields: ['recoveryOfToolCallId', 'recoveryAttemptOrdinal']
    },
    operationalRecoveryDefinition:
      'A successful tool execution linked by recoveryOfToolCallId to a preceding failed execution; this does not claim semantic task recovery.'
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
      provenanceEventCoverage: 'REQUIRED',
      rawCredentialOrPayloadLeakage: 'FORBIDDEN',
      missingProvenanceRow: 'STUDY_INVALID',
      schemaConflict: 'STUDY_INVALID'
    },
    precision: {
      startedRunsPerTask: 16,
      taskPanelCoverage: 2,
      confidenceRule: 'ONE_SIDED_95_PERCENT_CLOPPER_PEARSON_EXACT',
      maxUnknownRunRate: 0.125,
      minAdjudicableRunsPerTask: 14,
      unknownIsNotFailure: true,
      postHocRemoval: 'FORBIDDEN'
    },
    feasibility: {
      perTaskSuccessAmongAdjudicableLowerBound: 0.8,
      perTaskBudgetExhaustionUpperBound: 0.2,
      perTaskUnrecoveredToolFailureRunUpperBound: 0.2,
      perTaskOraclePassAmongAdjudicableLowerBound: 0.8,
      startedRunSuccessRate: 'DESCRIPTIVE_ONLY'
    },
    provenanceSafety: {
      everyToolExecutionHasExactlyOneRow: true,
      noRawCommandArgumentPayload: true,
      blockedRequestHasZeroSideEffectPaths: true
    },
    recoverySafety: {
      canonicalSignatureRequired: true,
      maxIdenticalFailureAttempts: 2,
      thirdConsecutiveIdenticalRequest: 'BLOCKED',
      differentRequestOrSuccessResetsStreak: true,
      correctedRetryMustBeModelEmitted: true,
      correctedRetrySignatureMustDiffer: true,
      operationalRecoveryRequiresLinkage: true
    }
  },
  identityPolicy: {
    studyIdPattern: '^c1-f0-v2-[0-9]{8}-[0-9a-f]{8}$',
    oneStudyIdPerStudy: true,
    runIdPattern: '^c1-f0-v2-[0-9]{8}-run-[0-9]{2}-[0-9a-f]{8}$',
    runIdsUnique: true,
    retry: 'FORBIDDEN',
    resume: 'FORBIDDEN',
    reuse: 'FORBIDDEN',
    studyIdStatus: 'NOT_CREATED'
  },
  groundTruthFirewall: {
    postRunSequence: [
      'EXECUTION_TERMINATES',
      'FREEZE_IMMUTABLE_POST_RUN_FIXTURE_SNAPSHOT',
      'ORACLE_AND_WRITABLE_SCOPE_ADJUDICATION',
      'PERSIST_ADJUDICATION_EVIDENCE',
      'CLEANUP_LIVE_SANDBOX'
    ],
    oracleTiming: 'AFTER_POST_RUN_SNAPSHOT_BEFORE_CLEANUP'
  }
} as const)

export interface C1F0V2Contract {
  readonly contractId: typeof C1_F0_V2_CONTRACT_ID
  readonly schemaVersion: typeof C1_F0_V2_CONTRACT_SCHEMA_VERSION
  readonly status: 'FREEZE_REVIEW'
  readonly designStatus: 'READY_FOR_CONTRACT_FREEZE_REVIEW'
  readonly runContractSha256: string
  readonly [key: string]: unknown
}

export class C1F0V2ContractError extends Error {
  override readonly name = 'C1F0V2ContractError'
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return '"__MISSING__"'
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new C1F0V2ContractError('value is not JSON serializable')
    return encoded
  }
  if (Array.isArray(value)) return '[' + value.map((item) => canonicalJson(item)).join(',') + ']'
  if (typeof value === 'object') {
    const record = value as JsonRecord
    return (
      '{' +
      Object.keys(record)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key]))
        .join(',') +
      '}'
    )
  }
  throw new C1F0V2ContractError('unsupported JSON value type: ' + typeof value)
}

export function computeC1F0V2RunContractSha256(contract: unknown): string {
  const clone = JSON.parse(JSON.stringify(contract)) as JsonRecord
  clone['runContractSha256'] = 'SELF'
  return sha256(canonicalJson(clone))
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new C1F0V2ContractError(path + ' must be an object')
  }
  return value as JsonRecord
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new C1F0V2ContractError(path + ' must be an array')
  return value
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new C1F0V2ContractError(path + ' must be a non-empty string')
  }
  return value
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    throw new C1F0V2ContractError(path + ' must equal ' + JSON.stringify(expected))
  }
}

function includes(values: unknown[], expected: string, path: string): void {
  if (!values.includes(expected)) {
    throw new C1F0V2ContractError(path + ' must include ' + expected)
  }
}

function exactArray(value: unknown, expected: readonly unknown[], path: string): void {
  const values = array(value, path)
  if (values.length !== expected.length || values.some((item, index) => item !== expected[index])) {
    throw new C1F0V2ContractError(path + ' does not match the frozen sequence')
  }
}

function pick(source: JsonRecord, keys: readonly string[]): JsonRecord {
  return Object.fromEntries(keys.map((key) => [key, source[key]]))
}

function freezeProjection(raw: unknown): JsonRecord {
  const root = record(raw, 'F0-v2 contract')
  const design = record(root['design'], 'design')
  const runOrder = record(design['runOrder'], 'design.runOrder')
  const confidence = record(design['confidence'], 'design.confidence')
  const tasks = array(root['taskPanel'], 'taskPanel')
  const taskPanel = tasks.map((task, index) => {
    const entry = record(task, 'taskPanel.' + String(index))
    return pick(entry, [
      'taskId',
      'stratum',
      'fixturePath',
      'expectedWritablePaths',
      'fixtureTreeObjectId',
      'fixtureContentSha256',
      'promptSha256',
      'objectiveOracle',
      'regressionOracle'
    ])
  })
  const enrollment = record(root['enrollmentBinding'], 'enrollmentBinding')
  const execution = record(root['executionBinding'], 'executionBinding')
  const gates = record(root['gates'], 'gates')
  const validity = record(gates['validity'], 'gates.validity')
  const precision = record(gates['precision'], 'gates.precision')
  const feasibility = record(gates['feasibility'], 'gates.feasibility')
  const provenanceSafety = record(gates['provenanceSafety'], 'gates.provenanceSafety')
  const recoverySafety = record(gates['recoverySafety'], 'gates.recoverySafety')
  const firewall = record(root['groundTruthFirewall'], 'groundTruthFirewall')
  return {
    runContractHashRole: root['runContractHashRole'],
    claims: root['claims'],
    estimand: root['estimand'],
    studyRelation: root['studyRelation'],
    design: {
      ...pick(design, [
        'arm',
        'runtimeIntervention',
        'taskPanelId',
        'taskCount',
        'runsPerTask',
        'totalRuns',
        'maxConcurrency'
      ]),
      runOrder,
      confidence
    },
    taskPanel,
    enrollmentBinding: pick(enrollment, [
      'taskManifestPath',
      'taskManifestSha256',
      'panelSelection',
      'historicalOpportunityUse'
    ]),
    executionBinding: pick(execution, [
      'provider',
      'model',
      'endpoint',
      'nodeRange',
      'credentialEnv',
      'credentialPersistence',
      'fallback',
      'runtimeIntervention',
      'providerConfigHash'
    ]),
    toolHardening: root['toolHardening'],
    budgets: root['budgets'],
    gates: {
      validity,
      precision,
      feasibility,
      provenanceSafety,
      recoverySafety
    },
    identityPolicy: root['identityPolicy'],
    groundTruthFirewall: {
      postRunSequence: firewall['postRunSequence'],
      oracleTiming: firewall['oracleTiming']
    }
  }
}

function firstMismatch(actual: unknown, expected: unknown, path: string): string | undefined {
  if (expected === null || typeof expected !== 'object') {
    return actual === expected ? undefined : path
  }
  if (actual === null || typeof actual !== 'object') return path
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return path
    for (let index = 0; index < expected.length; index += 1) {
      const mismatch = firstMismatch(actual[index], expected[index], path + '.' + String(index))
      if (mismatch !== undefined) return mismatch
    }
    return undefined
  }
  if (Array.isArray(actual)) return path
  for (const key of Object.keys(expected)) {
    const mismatch = firstMismatch(
      (actual as JsonRecord)[key],
      (expected as JsonRecord)[key],
      path.length === 0 ? key : path + '.' + key
    )
    if (mismatch !== undefined) return mismatch
  }
  return undefined
}

export function assertC1F0V2FreezeInvariants(raw: unknown): void {
  const mismatch = firstMismatch(freezeProjection(raw), C1_F0_V2_FREEZE_INVARIANTS, '')
  if (mismatch !== undefined) {
    throw new C1F0V2ContractError('SEMANTIC_FREEZE_MISMATCH: ' + mismatch)
  }
}

function validateTask(task: unknown, index: number): void {
  const path = 'taskPanel[' + String(index) + ']'
  const entry = record(task, path)
  string(entry['taskId'], path + '.taskId')
  string(entry['stratum'], path + '.stratum')
  string(entry['fixturePath'], path + '.fixturePath')
  const writablePaths = array(entry['expectedWritablePaths'], path + '.expectedWritablePaths')
  if (writablePaths.length === 0) {
    throw new C1F0V2ContractError(path + '.expectedWritablePaths must not be empty')
  }
  writablePaths.forEach((item, itemIndex) =>
    string(item, path + '.expectedWritablePaths[' + String(itemIndex) + ']')
  )
  for (const field of ['fixtureTreeObjectId', 'fixtureContentSha256', 'promptSha256']) {
    const value = string(entry[field], path + '.' + field)
    if (!/^[a-f0-9]{40,64}$/.test(value)) {
      throw new C1F0V2ContractError(path + '.' + field + ' must be a lowercase digest')
    }
  }
  for (const oracleName of ['objectiveOracle', 'regressionOracle']) {
    const oracle = record(entry[oracleName], path + '.' + oracleName)
    exact(oracle['command'], 'node', path + '.' + oracleName + '.command')
    const args = array(oracle['args'], path + '.' + oracleName + '.args')
    args.forEach((item, itemIndex) =>
      string(item, path + '.' + oracleName + '.args[' + String(itemIndex) + ']')
    )
    exact(oracle['expectedExitCode'], 0, path + '.' + oracleName + '.expectedExitCode')
    exact(oracle['timeoutMs'], 30000, path + '.' + oracleName + '.timeoutMs')
  }
}

export function validateC1F0V2Contract(raw: unknown): C1F0V2Contract {
  const root = record(raw, 'F0-v2 contract')
  exact(root['contractId'], C1_F0_V2_CONTRACT_ID, 'contractId')
  exact(root['schemaVersion'], C1_F0_V2_CONTRACT_SCHEMA_VERSION, 'schemaVersion')
  exact(root['status'], 'FREEZE_REVIEW', 'status')
  exact(root['designStatus'], 'READY_FOR_CONTRACT_FREEZE_REVIEW', 'designStatus')
  if ('studyId' in root) {
    throw new C1F0V2ContractError('studyId must not exist before authorization')
  }
  const contractHash = string(root['runContractSha256'], 'runContractSha256')
  if (!/^[a-f0-9]{64}$/.test(contractHash)) {
    throw new C1F0V2ContractError('runContractSha256 must be a lowercase SHA-256 digest')
  }
  if (computeC1F0V2RunContractSha256(root) !== contractHash) {
    throw new C1F0V2ContractError('runContractSha256 does not match canonical contract content')
  }
  assertC1F0V2FreezeInvariants(root)

  const relation = record(root['studyRelation'], 'studyRelation')
  exact(
    relation['priorContractId'],
    'C1_F0_EXECUTION_FEASIBILITY_V1',
    'studyRelation.priorContractId'
  )
  exact(relation['priorStudyId'], 'c1-f0-20260912-41753674', 'studyRelation.priorStudyId')
  exact(
    relation['priorArtifactPolicy'],
    'IMMUTABLE_CONSUMED_NO_RESUME_RETRY_REUSE_REBIND',
    'studyRelation.priorArtifactPolicy'
  )
  exact(
    relation['comparisonPolicy'],
    'DESCRIPTIVE_V1_V2_ONLY_NOT_POOLED',
    'studyRelation.comparisonPolicy'
  )

  const design = record(root['design'], 'design')
  exact(design['arm'], 'NATIVE_ONLY', 'design.arm')
  exact(design['runtimeIntervention'], 'DISABLED', 'design.runtimeIntervention')
  exact(design['taskPanelId'], 'C1_F0_TASK_PANEL_V1', 'design.taskPanelId')
  exact(design['taskCount'], 2, 'design.taskCount')
  exact(design['runsPerTask'], 16, 'design.runsPerTask')
  exact(design['totalRuns'], 32, 'design.totalRuns')
  exact(design['maxConcurrency'], 1, 'design.maxConcurrency')
  const runOrder = record(design['runOrder'], 'design.runOrder')
  exact(
    runOrder['algorithmId'],
    'C1_F0_DETERMINISTIC_BALANCED_ALTERNATION_V1',
    'design.runOrder.algorithmId'
  )
  exact(runOrder['seed'], 'c1-f0-v2-task-order-20260913', 'design.runOrder.seed')
  exactArray(
    runOrder['pattern'],
    ['c1-t1-localized-distractor-v1', 'c1-t2-multi-file-migration-v1'],
    'design.runOrder.pattern'
  )
  exact(runOrder['repetitions'], 16, 'design.runOrder.repetitions')
  const confidence = record(design['confidence'], 'design.confidence')
  exact(confidence['level'], 0.95, 'design.confidence.level')
  exact(confidence['intervalMethod'], 'CLOPPER_PEARSON_EXACT', 'design.confidence.intervalMethod')
  exact(confidence['tail'], 'ONE_SIDED', 'design.confidence.tail')

  const tasks = array(root['taskPanel'], 'taskPanel')
  exact(tasks.length, 2, 'taskPanel.length')
  tasks.forEach((task, index) => validateTask(task, index))
  exact(
    record(tasks[0], 'taskPanel[0]')['taskId'],
    'c1-t1-localized-distractor-v1',
    'taskPanel[0].taskId'
  )
  exact(
    record(tasks[1], 'taskPanel[1]')['taskId'],
    'c1-t2-multi-file-migration-v1',
    'taskPanel[1].taskId'
  )

  const enrollment = record(root['enrollmentBinding'], 'enrollmentBinding')
  exact(
    enrollment['taskManifestPath'],
    'research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json',
    'enrollmentBinding.taskManifestPath'
  )
  exact(
    enrollment['panelSelection'],
    'FROZEN_F0_TASK_PANEL_ONLY',
    'enrollmentBinding.panelSelection'
  )
  string(enrollment['taskManifestSha256'], 'enrollmentBinding.taskManifestSha256')

  const execution = record(root['executionBinding'], 'executionBinding')
  exact(execution['provider'], 'step-plan', 'executionBinding.provider')
  exact(execution['model'], 'step-3.7-flash', 'executionBinding.model')
  exact(
    execution['endpoint'],
    'https://api.stepfun.com/step_plan/v1/chat/completions',
    'executionBinding.endpoint'
  )
  exact(execution['nodeRange'], '>=24.0.0 <25.0.0', 'executionBinding.nodeRange')
  exact(execution['codeRevision'], C1_F0_V2_PENDING_BINDING, 'executionBinding.codeRevision')
  exact(
    execution['executionSurfaceHash'],
    C1_F0_V2_PENDING_BINDING,
    'executionBinding.executionSurfaceHash'
  )
  exact(execution['credentialEnv'], 'STEP_PLAN_API_KEY', 'executionBinding.credentialEnv')
  exact(execution['credentialPersistence'], 'MEMORY_ONLY', 'executionBinding.credentialPersistence')
  exact(execution['fallback'], 'NONE', 'executionBinding.fallback')
  exact(execution['runtimeIntervention'], 'DISABLED', 'executionBinding.runtimeIntervention')
  exact(
    execution['providerConfigHash'],
    C1_F0_V2_PROVIDER_CONFIG_HASH,
    'executionBinding.providerConfigHash'
  )

  const hardening = record(root['toolHardening'], 'toolHardening')
  exact(hardening['moduleId'], 'C1_F0_TOOL_HARDENING_V1', 'toolHardening.moduleId')
  exact(hardening['mode'], 'PROSPECTIVE_OPT_IN_ONLY', 'toolHardening.mode')
  const recovery = record(hardening['recoveryPolicy'], 'toolHardening.recoveryPolicy')
  exact(
    recovery['maxIdenticalFailureAttempts'],
    2,
    'toolHardening.recoveryPolicy.maxIdenticalFailureAttempts'
  )
  exact(
    recovery['requestSignature'],
    'SHA256(toolName + NUL + canonicalJson(semanticArguments))',
    'toolHardening.recoveryPolicy.requestSignature'
  )
  exact(
    recovery['canonicalization'],
    'JSON_OBJECT_KEYS_SORTED_RECURSIVELY',
    'toolHardening.recoveryPolicy.canonicalization'
  )
  exactArray(
    recovery['streakResetOn'],
    ['DIFFERENT_CANONICAL_REQUEST', 'SUCCESS'],
    'toolHardening.recoveryPolicy.streakResetOn'
  )
  exact(
    recovery['thirdIdenticalAction'],
    'REPEATED_FAILURE_BLOCKED',
    'toolHardening.recoveryPolicy.thirdIdenticalAction'
  )
  exact(recovery['implicitRetry'], 'FORBIDDEN', 'toolHardening.recoveryPolicy.implicitRetry')
  exact(
    recovery['correctedRetry'],
    'MODEL_EMITTED_ONLY',
    'toolHardening.recoveryPolicy.correctedRetry'
  )
  exactArray(
    recovery['linkageFields'],
    ['recoveryOfToolCallId', 'recoveryAttemptOrdinal'],
    'toolHardening.recoveryPolicy.linkageFields'
  )
  string(hardening['operationalRecoveryDefinition'], 'toolHardening.operationalRecoveryDefinition')

  const budgets = record(root['budgets'], 'budgets')
  const perRun = record(budgets['perRun'], 'budgets.perRun')
  exact(perRun['maxProviderRequests'], 24, 'budgets.perRun.maxProviderRequests')
  exact(perRun['maxToolRequests'], 96, 'budgets.perRun.maxToolRequests')
  exact(perRun['maxWallClockMs'], 600000, 'budgets.perRun.maxWallClockMs')
  exact(perRun['maxOutputTokensPerRequest'], 16384, 'budgets.perRun.maxOutputTokensPerRequest')
  const study = record(budgets['study'], 'budgets.study')
  exact(study['maxProviderRequests'], 768, 'budgets.study.maxProviderRequests')
  exact(study['maxToolRequests'], 3072, 'budgets.study.maxToolRequests')
  exact(study['maxWallClockMs'], 19200000, 'budgets.study.maxWallClockMs')
  exact(study['maxRuns'], 32, 'budgets.study.maxRuns')
  exact(study['maxConcurrency'], 1, 'budgets.study.maxConcurrency')

  const axes = record(root['evidenceAxes'], 'evidenceAxes')
  includes(
    array(axes['oracleStatus'], 'evidenceAxes.oracleStatus'),
    'UNKNOWN',
    'evidenceAxes.oracleStatus'
  )
  includes(
    array(axes['provenanceStatus'], 'evidenceAxes.provenanceStatus'),
    'PARTIAL',
    'evidenceAxes.provenanceStatus'
  )
  includes(
    array(axes['runDisposition'], 'evidenceAxes.runDisposition'),
    'FEASIBILITY_UNKNOWN',
    'evidenceAxes.runDisposition'
  )

  const firewall = record(root['groundTruthFirewall'], 'groundTruthFirewall')
  const forbidden = array(
    firewall['executionForbiddenInputs'],
    'groundTruthFirewall.executionForbiddenInputs'
  )
  for (const field of ['objectiveOracle', 'expectedWritablePaths', 'priorStudyOutcomes']) {
    includes(forbidden, field, 'groundTruthFirewall.executionForbiddenInputs')
  }
  const allowed = array(
    firewall['postRunAdjudicatorAllowedInputs'],
    'groundTruthFirewall.postRunAdjudicatorAllowedInputs'
  )
  for (const field of ['expectedWritablePaths', 'frozenPostRunFixtureSnapshot']) {
    includes(allowed, field, 'groundTruthFirewall.postRunAdjudicatorAllowedInputs')
  }
  exactArray(
    firewall['postRunSequence'],
    [
      'EXECUTION_TERMINATES',
      'FREEZE_IMMUTABLE_POST_RUN_FIXTURE_SNAPSHOT',
      'ORACLE_AND_WRITABLE_SCOPE_ADJUDICATION',
      'PERSIST_ADJUDICATION_EVIDENCE',
      'CLEANUP_LIVE_SANDBOX'
    ],
    'groundTruthFirewall.postRunSequence'
  )
  exact(
    firewall['oracleTiming'],
    'AFTER_POST_RUN_SNAPSHOT_BEFORE_CLEANUP',
    'groundTruthFirewall.oracleTiming'
  )
  const durableFields = array(
    firewall['durableProvenanceFields'],
    'groundTruthFirewall.durableProvenanceFields'
  )
  for (const field of [
    'canonicalRequestSignature',
    'consecutiveFailureStreak',
    'recoveryOfToolCallId',
    'recoveryAttemptOrdinal'
  ]) {
    includes(durableFields, field, 'groundTruthFirewall.durableProvenanceFields')
  }

  const gates = record(root['gates'], 'gates')
  const precision = record(gates['precision'], 'gates.precision')
  exact(precision['startedRunsPerTask'], 16, 'gates.precision.startedRunsPerTask')
  exact(precision['taskPanelCoverage'], 2, 'gates.precision.taskPanelCoverage')
  exact(
    precision['maxUnknownRunRate'],
    C1_F0_V2_MAX_UNKNOWN_RUN_RATE,
    'gates.precision.maxUnknownRunRate'
  )
  exact(
    precision['minAdjudicableRunsPerTask'],
    C1_F0_V2_MIN_ADJUDICABLE_RUNS_PER_TASK,
    'gates.precision.minAdjudicableRunsPerTask'
  )
  exact(precision['unknownIsNotFailure'], true, 'gates.precision.unknownIsNotFailure')
  const feasibility = record(gates['feasibility'], 'gates.feasibility')
  exact(
    feasibility['perTaskSuccessAmongAdjudicableLowerBound'],
    0.8,
    'gates.feasibility.perTaskSuccessAmongAdjudicableLowerBound'
  )
  exact(
    feasibility['perTaskBudgetExhaustionUpperBound'],
    0.2,
    'gates.feasibility.perTaskBudgetExhaustionUpperBound'
  )
  exact(
    feasibility['perTaskUnrecoveredToolFailureRunUpperBound'],
    0.2,
    'gates.feasibility.perTaskUnrecoveredToolFailureRunUpperBound'
  )
  exact(
    feasibility['perTaskOraclePassAmongAdjudicableLowerBound'],
    0.8,
    'gates.feasibility.perTaskOraclePassAmongAdjudicableLowerBound'
  )
  const recoverySafety = record(gates['recoverySafety'], 'gates.recoverySafety')
  exact(
    recoverySafety['canonicalSignatureRequired'],
    true,
    'gates.recoverySafety.canonicalSignatureRequired'
  )
  exact(
    recoverySafety['maxIdenticalFailureAttempts'],
    2,
    'gates.recoverySafety.maxIdenticalFailureAttempts'
  )
  exact(
    recoverySafety['thirdConsecutiveIdenticalRequest'],
    'BLOCKED',
    'gates.recoverySafety.thirdConsecutiveIdenticalRequest'
  )
  exact(
    recoverySafety['differentRequestOrSuccessResetsStreak'],
    true,
    'gates.recoverySafety.differentRequestOrSuccessResetsStreak'
  )
  exact(
    recoverySafety['correctedRetryMustBeModelEmitted'],
    true,
    'gates.recoverySafety.correctedRetryMustBeModelEmitted'
  )
  exact(
    recoverySafety['correctedRetrySignatureMustDiffer'],
    true,
    'gates.recoverySafety.correctedRetrySignatureMustDiffer'
  )
  exact(
    recoverySafety['operationalRecoveryRequiresLinkage'],
    true,
    'gates.recoverySafety.operationalRecoveryRequiresLinkage'
  )

  const identity = record(root['identityPolicy'], 'identityPolicy')
  exact(
    identity['studyIdPattern'],
    '^c1-f0-v2-[0-9]{8}-[0-9a-f]{8}$',
    'identityPolicy.studyIdPattern'
  )
  exact(
    identity['runIdPattern'],
    '^c1-f0-v2-[0-9]{8}-run-[0-9]{2}-[0-9a-f]{8}$',
    'identityPolicy.runIdPattern'
  )
  exact(identity['studyIdStatus'], 'NOT_CREATED', 'identityPolicy.studyIdStatus')
  exact(identity['retry'], 'FORBIDDEN', 'identityPolicy.retry')
  exact(identity['resume'], 'FORBIDDEN', 'identityPolicy.resume')
  exact(identity['reuse'], 'FORBIDDEN', 'identityPolicy.reuse')

  const artifacts = array(root['requiredArtifacts'], 'requiredArtifacts')
  for (const artifact of [
    'tool-provenance.jsonl',
    'post-run-snapshot-manifest.jsonl',
    'task-adjudication.jsonl'
  ]) {
    includes(artifacts, artifact, 'requiredArtifacts')
  }

  const implementation = record(root['implementationBoundary'], 'implementationBoundary')
  exact(
    implementation['historicalRunnerDefault'],
    'UNCHANGED',
    'implementationBoundary.historicalRunnerDefault'
  )
  exact(
    implementation['futureRunnerOptIn'],
    'C1_F0_TOOL_HARDENING_V1',
    'implementationBoundary.futureRunnerOptIn'
  )
  exact(
    implementation['credentialFreeE2ERequired'],
    true,
    'implementationBoundary.credentialFreeE2ERequired'
  )
  exact(
    implementation['providerExecution'],
    'NO_GO_UNTIL_OWNER_AUTHORIZATION',
    'implementationBoundary.providerExecution'
  )

  return Object.freeze(root as C1F0V2Contract)
}

export async function loadC1F0V2Contract(repoRoot: string): Promise<C1F0V2Contract> {
  const path = resolve(repoRoot, C1_F0_V2_CONTRACT_RELATIVE_PATH)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new C1F0V2ContractError(
      'unable to read F0-v2 contract: ' + (error instanceof Error ? error.message : String(error))
    )
  }
  return validateC1F0V2Contract(parsed)
}
