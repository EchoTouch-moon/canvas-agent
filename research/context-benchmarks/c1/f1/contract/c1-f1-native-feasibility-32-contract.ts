import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
  C1_F0_V2_FREEZE_INVARIANTS,
  computeC1F0V2RunContractSha256
} from '../../f0/contract/c1-f0-v2-contract'
import {
  C1_F1_NATIVE32_ANCHOR_SURFACE_INVENTORY,
  C1_F1_NATIVE32_ANCHOR_SURFACE_PATH_ROOTS,
  C1_F1_NATIVE32_SURFACE_HASH_ALGORITHM,
  type C1F1Native32SurfaceInventoryEntry
} from './c1-f1-native-feasibility-32-anchor-inventory'

export const C1_F1_NATIVE32_CONTRACT_RELATIVE_PATH =
  'research/context-benchmarks/c1/f1/contracts/c1-f1-native-feasibility-32.json'
export const C1_F1_NATIVE32_CONTRACT_ID = 'C1_F1_NATIVE_FEASIBILITY_32' as const
export const C1_F1_NATIVE32_CONTRACT_SCHEMA_VERSION = 1 as const
export const C1_F1_NATIVE32_PENDING_BINDING = 'PENDING_F1_32_IMPLEMENTATION' as const
export const C1_F1_NATIVE32_BUDGET_ONLY_PROJECTION_PATH =
  'research/context-benchmarks/c1/f1/runner/c1-f1-32-execution-runner.ts' as const
export const C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256 =
  '053fa42d540e3955b8228303036191ffd985292ddd9665d87397b232570885da' as const
export const C1_F1_NATIVE32_PROVIDER_CONFIG_HASH =
  'bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a'
export const C1_F1_NATIVE32_BINDING_CONTROL_SURFACE_PATH_ROOTS = Object.freeze([
  'research/context-benchmarks/c1/f1/contract',
  'research/context-benchmarks/c1/f1/contracts'
] as const)
export const C1_F1_NATIVE32_SUPPLEMENTAL_EXECUTION_DEPENDENCIES = Object.freeze([
  {
    path: 'research/context-benchmarks/src/c1-carried-removals.ts',
    historicalHash: 'de2538329df22823da68237ed7690042d0abb080173c924431c1e6df1dfd93bf',
    historicalGitBlobSha1: '1bd1c23def28407678ea8ca87adbfffcf921aa37'
  }
] as const)
export const C1_F1_NATIVE32_HISTORICAL_ANCHOR = Object.freeze({
  contractId: 'C1_F0_EXECUTION_FEASIBILITY_V2',
  studyId: 'c1-f0-v2-20260913-341fbab9',
  budget: 24,
  status: 'VALID / F0_V2_FEASIBILITY_NO_GO / CONSUMED',
  executionRevision: '6d0189a998772e8d9e379f8ec56bc7f429546a2a',
  executionSurfaceHash: '583f6c974c207eb3e338b89aa345ab1aadd894fb25d83455b06ee59af13fbe0a',
  runContractSha256: '4120e8d4c5c029ce224fb1341989cdc208d96799f1c399e736ee77aa36ea0611'
} as const)

type JsonRecord = Record<string, unknown>

export interface C1F1Native32Contract {
  readonly contractId: typeof C1_F1_NATIVE32_CONTRACT_ID
  readonly schemaVersion: typeof C1_F1_NATIVE32_CONTRACT_SCHEMA_VERSION
  readonly status: 'FREEZE_REVIEW' | 'FROZEN'
  readonly designStatus: 'READY_FOR_CONTRACT_FREEZE_REVIEW' | 'FINAL_BOUND'
  readonly runContractHashRole: 'FREEZE_CANDIDATE' | 'FINAL_BOUND'
  readonly runContractSha256: string
  readonly effectiveSurfaceParity?: Readonly<Record<string, unknown>>
  readonly [key: string]: unknown
}

export type C1F1Native32ContractPhase = 'AUTO' | 'FREEZE_CANDIDATE' | 'FINAL_BOUND'

export class C1F1Native32ContractError extends Error {
  override readonly name = 'C1F1Native32ContractError'
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new C1F1Native32ContractError(path + ' must be an object')
  }
  return value as JsonRecord
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new C1F1Native32ContractError(path + ' must be an array')
  return value
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new C1F1Native32ContractError(path + ' must be a non-empty string')
  }
  return value
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    throw new C1F1Native32ContractError(
      'SEMANTIC_FREEZE_MISMATCH: ' + path + ' must equal ' + JSON.stringify(expected)
    )
  }
}

function exactArray(value: unknown, expected: readonly unknown[], path: string): void {
  const actual = array(value, path)
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new C1F1Native32ContractError(path + ' does not match the frozen sequence')
  }
}

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableClone(item))
  if (value !== null && typeof value === 'object') {
    const object = value as JsonRecord
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, stableClone(object[key])])
    )
  }
  return value
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

function assertProjection(raw: unknown, expected: unknown, path: string): void {
  const mismatch = firstMismatch(raw, expected, path)
  if (mismatch !== undefined) {
    throw new C1F1Native32ContractError('SEMANTIC_FREEZE_MISMATCH: ' + mismatch)
  }
}

function assertExactJsonValue(raw: unknown, expected: unknown, path: string): void {
  if (JSON.stringify(stableClone(raw)) !== JSON.stringify(stableClone(expected))) {
    throw new C1F1Native32ContractError('SEMANTIC_FREEZE_MISMATCH: ' + path)
  }
}

function pick(source: JsonRecord, keys: readonly string[]): JsonRecord {
  return Object.fromEntries(keys.map((key) => [key, source[key]]))
}

function f0InheritedProjection(): JsonRecord {
  const frozen = C1_F0_V2_FREEZE_INVARIANTS as unknown as JsonRecord
  return {
    taskPanel: frozen['taskPanel'],
    enrollmentBinding: frozen['enrollmentBinding'],
    toolHardening: frozen['toolHardening'],
    gates: frozen['gates'],
    evidenceAxes: frozen['evidenceAxes'],
    outcomes: frozen['outcomes'],
    requiredArtifacts: frozen['requiredArtifacts'],
    groundTruthFirewall: frozen['groundTruthFirewall']
  }
}

const F1_NATIVE32_SURFACE_WITNESS_POLICY = Object.freeze({
  schemaVersion: 1,
  mode: 'PER_PATH_CLASSIFICATION',
  anchorContractId: C1_F1_NATIVE32_HISTORICAL_ANCHOR.contractId,
  anchorExecutionRevision: C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionRevision,
  anchorExecutionSurfaceHash: C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionSurfaceHash,
  anchorSurfacePathRoots: C1_F1_NATIVE32_ANCHOR_SURFACE_PATH_ROOTS,
  anchorSurfacePaths: C1_F1_NATIVE32_ANCHOR_SURFACE_INVENTORY.map((entry) => entry.path),
  anchorSurfaceInventory: C1_F1_NATIVE32_ANCHOR_SURFACE_INVENTORY,
  anchorInventoryDigest: C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionSurfaceHash,
  hashing: C1_F1_NATIVE32_SURFACE_HASH_ALGORITHM,
  allowedClassifications: ['EXACT_UNCHANGED', 'BUDGET_ONLY_PROJECTION'],
  budgetOnlyProjectionPaths: [
    'budgets.perRun.maxProviderRequests',
    'budgets.study.maxProviderRequests'
  ],
  // Frozen candidate declaration; final binding narrows this to the exact path constant below.
  budgetOnlyProjectionSurfacePrefixes: ['research/context-benchmarks/c1/f1/runner/'],
  exactUnchangedDomains: [
    'taskPanel',
    'enrollmentBinding',
    'executionBinding.provider',
    'executionBinding.model',
    'executionBinding.endpoint',
    'executionBinding.providerConfigHash',
    'toolHardening',
    'gates',
    'evidenceAxes',
    'outcomes',
    'requiredArtifacts',
    'groundTruthFirewall',
    'budgets.perRun.maxToolRequests',
    'budgets.perRun.maxWallClockMs',
    'budgets.perRun.maxOutputTokensPerRequest',
    'budgets.study.maxToolRequests',
    'budgets.study.maxWallClockMs'
  ],
  failClosedOn: ['OTHER_CHANGE', 'MISSING_PATH', 'UNRESOLVED_PATH']
} as const)

/** Final-bound execution evidence; deliberately excluded from the freeze-candidate projection. */
export const C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY = Object.freeze({
  schemaVersion: 1,
  policyId: 'C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_V1',
  status: 'PASS',
  baselineContractId: C1_F1_NATIVE32_HISTORICAL_ANCHOR.contractId,
  baselineExecutionSurfaceHash: C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionSurfaceHash,
  baselineProviderRequestsPerRun: 24,
  targetProviderRequestsPerRun: 32,
  baselineProviderRequestsPerStudy: 768,
  targetProviderRequestsPerStudy: 1024,
  baselineDriver: 'C1LiveBindingDriver',
  targetDriver: 'C1F1Native32BindingDriver',
  responseSource: 'C1AuthorizedProviderResponseSource',
  toolExecutor: 'C1F0V2HardeningToolAdapter',
  comparedSemantics: [
    'PROVIDER_REQUEST_STRUCTURE',
    'TOOL_RECOVERY_EVIDENCE',
    'TERMINATION_BEHAVIOR'
  ],
  onlyPermittedDifferences: [
    'budgets.perRun.maxProviderRequests',
    'budgets.study.maxProviderRequests'
  ],
  transportMode: 'INJECTED_FAKE_FETCH',
  actualNetworkRequests: 0,
  scenarioEvidence: [
    {
      scenarioId: 'RECOVERY_THEN_COMPLETE',
      baselineProviderCalls: 3,
      targetProviderCalls: 3,
      baselineTermination: 'TERMINAL_COMPLETE',
      targetTermination: 'TERMINAL_COMPLETE',
      providerRequestStructureParity: true,
      toolRecoveryEvidenceParity: true,
      responseEvidenceParity: true
    },
    {
      scenarioId: 'MAX_CALL_BUDGET_EXHAUSTION',
      baselineProviderCalls: 24,
      targetProviderCalls: 32,
      baselineTermination: 'BUDGET_EXHAUSTED',
      targetTermination: 'BUDGET_EXHAUSTED',
      commonProviderRequestPrefix: 24,
      commonResponseEvidencePrefix: 24,
      commonToolExecutionPrefix: 24,
      targetOnlyAdditionalProviderCalls: 8
    }
  ],
  parityEvidenceSha256: '68b0e74fc767458c743254e18769b3eb1431edd8e5e7465cb341cbfaba8f426a'
} as const)

const F1_NATIVE32_PRE_BINDING_SURFACE_WITNESS = Object.freeze({
  ...F1_NATIVE32_SURFACE_WITNESS_POLICY,
  phase: 'PRE_BINDING',
  targetExecutionBinding: {
    codeRevision: C1_F1_NATIVE32_PENDING_BINDING,
    executionSurfaceHash: C1_F1_NATIVE32_PENDING_BINDING
  },
  targetInventoryDigest: C1_F1_NATIVE32_PENDING_BINDING,
  targetSurfacePaths: [],
  entries: [],
  witnessStatus: 'PENDING_IMPLEMENTATION'
} as const)

const F1_NATIVE32_FRONTIER = Object.freeze({
  pointBudget: 32,
  historicalAnchorBudget: 24,
  pointRole: 'NEW_F1_NATIVE_POINT',
  pointLabelDefinitions: {
    INVALID: 'validity gate fails',
    INCONCLUSIVE: 'validity passes but precision gate fails',
    VALID_INFEASIBLE: 'validity + precision + safety pass, one or more feasibility gates fail',
    VALID_STABLE_FEASIBLE: 'validity + precision + safety + all feasibility gates pass'
  },
  frontierDrivingGate: {
    requiredPasses: [
      'validity',
      'precision',
      'provenanceSafety',
      'allT1Gates',
      't2Oracle',
      't2StrictRecovery'
    ],
    requiredFailure: 't2BudgetSensitiveComposite',
    t2BudgetSensitiveComposite: {
      successLower95: '>=0.80',
      budgetExhaustionUpper95: '<=0.20'
    },
    nonBudgetFailureDisposition: 'FRONTIER_INCONCLUSIVE_NON_BUDGET'
  },
  continuationPolicy: {
    allowedNextBudgets: [40, 48],
    requires: 'FRONTIER_DRIVING_GATE=PASS',
    eachPointRequiresNewContractBindingIdentity: true,
    noUnboundedBudgetIncrease: true
  },
  observedTransitionBracket: {
    derivation: '(L,B]',
    upperBound: 'FIRST_TESTED_STABLE_FEASIBLE_POINT',
    lowerBound:
      'highest tested budget below B labelled VALID_INFEASIBLE whose continuation was driven by FRONTIER_DRIVING_GATE',
    chainMustBeContinuous: true,
    chainBreakers: ['INVALID', 'INCONCLUSIVE', 'FRONTIER_INCONCLUSIVE_NON_BUDGET'],
    noBracketWhenSearchChainBreaks: true,
    noExactThresholdClaim: true
  }
} as const)

const F1_NATIVE32_CLAIMS =
  'F1_NATIVE_FEASIBILITY_FRONTIER_ONLY_NO_RUNTIME_EFFECT_NO_CAUSAL_BUDGET_CLAIM'
const F1_NATIVE32_ESTIMAND = 'NATIVE_EXECUTION_FEASIBILITY_AT_F1_32_PROVIDER_CALL_BUDGET'

export function computeC1F1Native32RunContractSha256(contract: unknown): string {
  return computeC1F0V2RunContractSha256(contract)
}

export function assertC1F1Native32FreezeInvariants(raw: unknown): void {
  const root = record(raw, 'F1-32 contract')
  const inherited = {
    taskPanel: root['taskPanel'],
    enrollmentBinding: root['enrollmentBinding'],
    toolHardening: root['toolHardening'],
    gates: root['gates'],
    evidenceAxes: root['evidenceAxes'],
    outcomes: root['outcomes'],
    requiredArtifacts: root['requiredArtifacts'],
    groundTruthFirewall: root['groundTruthFirewall']
  }
  assertProjection(inherited, f0InheritedProjection(), '')

  assertProjection(root['historicalAnchor'], C1_F1_NATIVE32_HISTORICAL_ANCHOR, 'historicalAnchor')

  exact(root['claims'], F1_NATIVE32_CLAIMS, 'claims')
  exact(root['estimand'], F1_NATIVE32_ESTIMAND, 'estimand')
  assertProjection(
    root['studyRelation'],
    {
      priorContractId: C1_F1_NATIVE32_HISTORICAL_ANCHOR.contractId,
      priorStudyId: C1_F1_NATIVE32_HISTORICAL_ANCHOR.studyId,
      priorArtifactPolicy: 'IMMUTABLE_CONSUMED_NO_RESUME_RETRY_REUSE_REBIND',
      comparisonPolicy: 'DESCRIPTIVE_F0_V2_ANCHOR_ONLY_NOT_POOLED'
    },
    'studyRelation'
  )

  const design = record(root['design'], 'design')
  exact(design['arm'], 'NATIVE_ONLY', 'design.arm')
  exact(design['runtimeIntervention'], 'DISABLED', 'design.runtimeIntervention')
  exact(design['taskPanelId'], 'C1_F0_TASK_PANEL_V1', 'design.taskPanelId')
  exact(design['taskCount'], 2, 'design.taskCount')
  exact(design['runsPerTask'], 16, 'design.runsPerTask')
  exact(design['totalRuns'], 32, 'design.totalRuns')
  exact(design['maxConcurrency'], 1, 'design.maxConcurrency')
  assertProjection(
    design['runOrder'],
    {
      algorithmId: 'C1_F0_DETERMINISTIC_BALANCED_ALTERNATION_V1',
      seed: 'c1-f0-v2-task-order-20260913',
      pattern: ['c1-t1-localized-distractor-v1', 'c1-t2-multi-file-migration-v1'],
      repetitions: 16
    },
    'design.runOrder'
  )
  assertProjection(
    design['confidence'],
    {
      level: 0.95,
      intervalMethod: 'CLOPPER_PEARSON_EXACT',
      tail: 'ONE_SIDED'
    },
    'design.confidence'
  )

  const enrollment = record(root['enrollmentBinding'], 'enrollmentBinding')
  exact(
    enrollment['taskManifestPath'],
    'research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json',
    'enrollmentBinding.taskManifestPath'
  )
  exact(
    enrollment['taskManifestSha256'],
    '2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38',
    'enrollmentBinding.taskManifestSha256'
  )
  exact(
    enrollment['panelSelection'],
    'FROZEN_F0_TASK_PANEL_ONLY',
    'enrollmentBinding.panelSelection'
  )
  exact(
    enrollment['historicalOpportunityUse'],
    'NOT_USED_FOR_EXECUTION_OR_SELECTION_AFTER_FREEZE',
    'enrollmentBinding.historicalOpportunityUse'
  )

  const execution = record(root['executionBinding'], 'executionBinding')
  exact(execution['provider'], 'step-plan', 'executionBinding.provider')
  exact(execution['model'], 'step-3.7-flash', 'executionBinding.model')
  exact(
    execution['endpoint'],
    'https://api.stepfun.com/step_plan/v1/chat/completions',
    'executionBinding.endpoint'
  )
  exact(execution['nodeRange'], '>=24.0.0 <25.0.0', 'executionBinding.nodeRange')
  exact(execution['codeRevision'], C1_F1_NATIVE32_PENDING_BINDING, 'executionBinding.codeRevision')
  exact(
    execution['executionSurfaceHash'],
    C1_F1_NATIVE32_PENDING_BINDING,
    'executionBinding.executionSurfaceHash'
  )
  exact(execution['credentialEnv'], 'STEP_PLAN_API_KEY', 'executionBinding.credentialEnv')
  exact(execution['credentialPersistence'], 'MEMORY_ONLY', 'executionBinding.credentialPersistence')
  exact(execution['fallback'], 'NONE', 'executionBinding.fallback')
  exact(execution['runtimeIntervention'], 'DISABLED', 'executionBinding.runtimeIntervention')
  exact(
    execution['providerConfigHash'],
    C1_F1_NATIVE32_PROVIDER_CONFIG_HASH,
    'executionBinding.providerConfigHash'
  )

  const budgets = record(root['budgets'], 'budgets')
  const perRun = record(budgets['perRun'], 'budgets.perRun')
  exact(perRun['maxProviderRequests'], 32, 'budgets.perRun.maxProviderRequests')
  exact(perRun['maxToolRequests'], 96, 'budgets.perRun.maxToolRequests')
  exact(perRun['maxWallClockMs'], 600000, 'budgets.perRun.maxWallClockMs')
  exact(perRun['maxOutputTokensPerRequest'], 16384, 'budgets.perRun.maxOutputTokensPerRequest')
  const study = record(budgets['study'], 'budgets.study')
  exact(study['maxProviderRequests'], 1024, 'budgets.study.maxProviderRequests')
  exact(study['maxToolRequests'], 3072, 'budgets.study.maxToolRequests')
  exact(study['maxWallClockMs'], 19200000, 'budgets.study.maxWallClockMs')
  exact(study['maxRuns'], 32, 'budgets.study.maxRuns')
  exact(study['maxConcurrency'], 1, 'budgets.study.maxConcurrency')
  exact(
    study['providerBudgetDerivation'],
    'totalRuns × perRun.maxProviderRequests',
    'budgets.study.providerBudgetDerivation'
  )
  exact(
    study['networkRequestLimiter'],
    'DERIVED_FROM_MAX_PROVIDER_REQUESTS_PER_STUDY',
    'budgets.study.networkRequestLimiter'
  )

  const witness = record(root['surfaceEquivalenceWitness'], 'surfaceEquivalenceWitness')
  assertProjection(
    pick(witness, [
      'schemaVersion',
      'mode',
      'anchorContractId',
      'anchorExecutionRevision',
      'anchorExecutionSurfaceHash',
      'anchorSurfacePathRoots',
      'anchorSurfacePaths',
      'anchorSurfaceInventory',
      'anchorInventoryDigest',
      'hashing',
      'allowedClassifications',
      'budgetOnlyProjectionPaths',
      'budgetOnlyProjectionSurfacePrefixes',
      'exactUnchangedDomains',
      'failClosedOn'
    ]),
    F1_NATIVE32_SURFACE_WITNESS_POLICY,
    'surfaceEquivalenceWitness'
  )
  assertAnchorInventoryBinding()
  exact(
    F1_NATIVE32_SURFACE_WITNESS_POLICY.anchorInventoryDigest,
    F1_NATIVE32_SURFACE_WITNESS_POLICY.anchorExecutionSurfaceHash,
    'surfaceEquivalenceWitness.anchorInventoryDigest'
  )
  exact(witness['phase'], 'PRE_BINDING', 'surfaceEquivalenceWitness.phase')
  assertProjection(
    witness['targetExecutionBinding'],
    {
      codeRevision: C1_F1_NATIVE32_PENDING_BINDING,
      executionSurfaceHash: C1_F1_NATIVE32_PENDING_BINDING
    },
    'surfaceEquivalenceWitness.targetExecutionBinding'
  )
  exact(
    witness['targetInventoryDigest'],
    C1_F1_NATIVE32_PENDING_BINDING,
    'surfaceEquivalenceWitness.targetInventoryDigest'
  )
  exactArray(witness['targetSurfacePaths'], [], 'surfaceEquivalenceWitness.targetSurfacePaths')
  exactArray(witness['entries'], [], 'surfaceEquivalenceWitness.entries')
  exact(
    witness['witnessStatus'],
    'PENDING_IMPLEMENTATION',
    'surfaceEquivalenceWitness.witnessStatus'
  )
  assertProjection(root['frontier'], F1_NATIVE32_FRONTIER, 'frontier')

  assertProjection(
    root['implementationBoundary'],
    {
      historicalRunnerDefault: 'UNCHANGED',
      futureRunnerOptIn: 'C1_F1_NATIVE32_RUNNER',
      credentialFreeE2ERequired: true,
      providerExecution: 'NO_GO_UNTIL_OWNER_AUTHORIZATION'
    },
    'implementationBoundary'
  )

  const identity = record(root['identityPolicy'], 'identityPolicy')
  exact(
    identity['studyIdPattern'],
    '^c1-f1-32-[0-9]{8}-[0-9a-f]{8}$',
    'identityPolicy.studyIdPattern'
  )
  exact(
    identity['runIdPattern'],
    '^c1-f1-32-[0-9]{8}-run-[0-9]{2}-[0-9a-f]{8}$',
    'identityPolicy.runIdPattern'
  )
  exact(identity['studyIdStatus'], 'NOT_CREATED', 'identityPolicy.studyIdStatus')
  exact(identity['oneStudyIdPerStudy'], true, 'identityPolicy.oneStudyIdPerStudy')
  exact(identity['runIdsUnique'], true, 'identityPolicy.runIdsUnique')
  exact(identity['retry'], 'FORBIDDEN', 'identityPolicy.retry')
  exact(identity['resume'], 'FORBIDDEN', 'identityPolicy.resume')
  exact(identity['reuse'], 'FORBIDDEN', 'identityPolicy.reuse')
  exactArray(identity['reservedPointIdentities'], [], 'identityPolicy.reservedPointIdentities')
}

function digest(value: unknown, path: string): string {
  const candidate = string(value, path)
  if (!/^[a-f0-9]{64}$/.test(candidate)) {
    throw new C1F1Native32ContractError(path + ' must be a lowercase SHA-256 digest')
  }
  return candidate
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertNormalizedSurfacePath(path: string, label: string): void {
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path === '.' ||
    path === '..' ||
    path.includes('/./') ||
    path.includes('/../') ||
    path.endsWith('/.') ||
    path.endsWith('/..')
  ) {
    throw new C1F1Native32ContractError(label + ' must be a normalized POSIX repo-relative path')
  }
}

export function computeC1F1Native32SurfaceInventoryHash(
  inventory: readonly C1F1Native32SurfaceInventoryEntry[]
): string {
  if (inventory.length === 0) {
    throw new C1F1Native32ContractError('surface inventory must not be empty')
  }
  const rows = inventory
    .map((entry, index) => {
      const path = string(entry.path, 'surface inventory[' + String(index) + '].path')
      assertNormalizedSurfacePath(path, 'surface inventory[' + String(index) + '].path')
      const hash = digest(entry.sha256, 'surface inventory[' + String(index) + '].sha256')
      return { path, hash }
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1]?.path === rows[index]?.path) {
      throw new C1F1Native32ContractError(
        'surface inventory paths must be unique: ' + rows[index]?.path
      )
    }
  }
  return sha256(rows.map((row) => row.hash + '  ' + row.path).join('\n') + '\n')
}

function assertAnchorInventoryBinding(): void {
  const computed = computeC1F1Native32SurfaceInventoryHash(C1_F1_NATIVE32_ANCHOR_SURFACE_INVENTORY)
  exact(
    computed,
    C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionSurfaceHash,
    'surfaceEquivalenceWitness.anchorInventoryDigest'
  )
}

function validateFinalBoundSurfaceWitness(root: JsonRecord): void {
  const witness = record(root['surfaceEquivalenceWitness'], 'surfaceEquivalenceWitness')
  assertProjection(
    pick(witness, [
      'schemaVersion',
      'mode',
      'anchorContractId',
      'anchorExecutionRevision',
      'anchorExecutionSurfaceHash',
      'anchorSurfacePathRoots',
      'anchorSurfacePaths',
      'anchorSurfaceInventory',
      'anchorInventoryDigest',
      'hashing',
      'allowedClassifications',
      'budgetOnlyProjectionPaths',
      'budgetOnlyProjectionSurfacePrefixes',
      'exactUnchangedDomains',
      'failClosedOn'
    ]),
    F1_NATIVE32_SURFACE_WITNESS_POLICY,
    'surfaceEquivalenceWitness'
  )
  exact(witness['phase'], 'FINAL_BOUND', 'surfaceEquivalenceWitness.phase')
  exact(witness['witnessStatus'], 'COMPLETE', 'surfaceEquivalenceWitness.witnessStatus')

  const execution = record(root['executionBinding'], 'executionBinding')
  const targetBinding = record(
    witness['targetExecutionBinding'],
    'surfaceEquivalenceWitness.targetExecutionBinding'
  )
  const codeRevision = string(execution['codeRevision'], 'executionBinding.codeRevision')
  const executionSurfaceHash = digest(
    execution['executionSurfaceHash'],
    'executionBinding.executionSurfaceHash'
  )
  exact(
    targetBinding['codeRevision'],
    codeRevision,
    'surfaceEquivalenceWitness.targetExecutionBinding.codeRevision'
  )
  exact(
    targetBinding['executionSurfaceHash'],
    executionSurfaceHash,
    'surfaceEquivalenceWitness.targetExecutionBinding.executionSurfaceHash'
  )

  const policy = F1_NATIVE32_SURFACE_WITNESS_POLICY
  assertAnchorInventoryBinding()
  exact(
    policy.anchorInventoryDigest,
    policy.anchorExecutionSurfaceHash,
    'surfaceEquivalenceWitness.anchorInventoryDigest'
  )
  const anchorPaths = policy.anchorSurfacePaths
  const anchorHashByPath = new Map(
    policy.anchorSurfaceInventory.map((entry) => [entry.path, entry.sha256])
  )
  const allowedClassifications = policy.allowedClassifications
  const targetPaths = array(
    witness['targetSurfacePaths'],
    'surfaceEquivalenceWitness.targetSurfacePaths'
  )
  if (targetPaths.length === 0) {
    throw new C1F1Native32ContractError(
      'surfaceEquivalenceWitness.targetSurfacePaths must not be empty in FINAL_BOUND phase'
    )
  }
  const targetPathSet = new Set<string>()
  targetPaths.forEach((value, index) => {
    const path = string(
      value,
      'surfaceEquivalenceWitness.targetSurfacePaths[' + String(index) + ']'
    )
    if (targetPathSet.has(path)) {
      throw new C1F1Native32ContractError(
        'surfaceEquivalenceWitness.targetSurfacePaths must contain unique paths'
      )
    }
    targetPathSet.add(path)
  })

  const entries = array(witness['entries'], 'surfaceEquivalenceWitness.entries')
  if (entries.length !== targetPaths.length) {
    throw new C1F1Native32ContractError(
      'surfaceEquivalenceWitness.entries must account for every target execution-surface path'
    )
  }
  const seenTargetPaths = new Set<string>()
  const seenAnchorPaths = new Set<string>()
  entries.forEach((value, index) => {
    const entry = record(value, 'surfaceEquivalenceWitness.entries[' + String(index) + ']')
    const path = string(
      entry['path'],
      'surfaceEquivalenceWitness.entries[' + String(index) + '].path'
    )
    if (!targetPathSet.has(path) || seenTargetPaths.has(path)) {
      throw new C1F1Native32ContractError(
        'surfaceEquivalenceWitness.entries.' +
          path +
          ' is missing or duplicated in targetSurfacePaths'
      )
    }
    seenTargetPaths.add(path)
    const classification = string(
      entry['classification'],
      'surfaceEquivalenceWitness.entries[' + String(index) + '].classification'
    )
    if (
      !allowedClassifications.includes(classification as (typeof allowedClassifications)[number])
    ) {
      throw new C1F1Native32ContractError(
        'surfaceEquivalenceWitness.entries[' +
          String(index) +
          '].classification must be an allowed classification'
      )
    }
    const targetHash = digest(
      entry['targetHash'],
      'surfaceEquivalenceWitness.entries[' + String(index) + '].targetHash'
    )
    const anchorPathValue = entry['anchorPath']
    if (anchorPathValue === null) {
      if (classification !== 'BUDGET_ONLY_PROJECTION') {
        throw new C1F1Native32ContractError(
          'surfaceEquivalenceWitness.entries[' +
            String(index) +
            '].anchorPath may be null only for BUDGET_ONLY_PROJECTION'
        )
      }
      if (path !== C1_F1_NATIVE32_BUDGET_ONLY_PROJECTION_PATH) {
        throw new C1F1Native32ContractError(
          'surfaceEquivalenceWitness.entries[' +
            String(index) +
            '].path is not the exact frozen F1 budget projection path'
        )
      }
      if (entry['anchorHash'] !== null) {
        throw new C1F1Native32ContractError(
          'surfaceEquivalenceWitness.entries[' +
            String(index) +
            '].anchorHash must be null for target-only paths'
        )
      }
      return
    }

    const anchorPath = string(
      anchorPathValue,
      'surfaceEquivalenceWitness.entries[' + String(index) + '].anchorPath'
    )
    if (!anchorPaths.includes(anchorPath as (typeof anchorPaths)[number])) {
      throw new C1F1Native32ContractError(
        'surfaceEquivalenceWitness.entries[' +
          String(index) +
          '].anchorPath is not in anchorSurfacePaths'
      )
    }
    if (seenAnchorPaths.has(anchorPath)) {
      throw new C1F1Native32ContractError(
        'surfaceEquivalenceWitness.entries.' +
          anchorPath +
          ' accounts for an anchor path more than once'
      )
    }
    seenAnchorPaths.add(anchorPath)
    const anchorHash = digest(
      entry['anchorHash'],
      'surfaceEquivalenceWitness.entries[' + String(index) + '].anchorHash'
    )
    const expectedAnchorHash = anchorHashByPath.get(anchorPath)
    if (expectedAnchorHash === undefined) {
      throw new C1F1Native32ContractError(
        'surfaceEquivalenceWitness.entries[' + String(index) + '].anchorPath has no frozen hash'
      )
    }
    exact(
      anchorHash,
      expectedAnchorHash,
      'surfaceEquivalenceWitness.entries[' + String(index) + '].anchorHash'
    )
    if (classification === 'EXACT_UNCHANGED') {
      if (path !== anchorPath) {
        throw new C1F1Native32ContractError(
          'surfaceEquivalenceWitness.entries[' +
            String(index) +
            '].path must equal anchorPath for EXACT_UNCHANGED'
        )
      }
      exact(
        targetHash,
        anchorHash,
        'surfaceEquivalenceWitness.entries[' + String(index) + '].targetHash'
      )
    } else {
      throw new C1F1Native32ContractError(
        'surfaceEquivalenceWitness.entries[' +
          String(index) +
          '].classification may be BUDGET_ONLY_PROJECTION only for the target-only runner path'
      )
    }
  })

  if (seenTargetPaths.size !== targetPathSet.size) {
    throw new C1F1Native32ContractError(
      'surfaceEquivalenceWitness.entries must account for every target execution-surface path exactly once'
    )
  }
  if (seenAnchorPaths.size !== anchorPaths.length) {
    throw new C1F1Native32ContractError(
      'surfaceEquivalenceWitness.entries must account for every anchor surface path exactly once'
    )
  }
  const targetInventory = entries.map((value, index) => {
    const entry = record(value, 'surfaceEquivalenceWitness.entries[' + String(index) + ']')
    return {
      path: string(entry['path'], 'surfaceEquivalenceWitness.entries[' + String(index) + '].path'),
      sha256: digest(
        entry['targetHash'],
        'surfaceEquivalenceWitness.entries[' + String(index) + '].targetHash'
      )
    }
  })
  const targetInventoryDigest = computeC1F1Native32SurfaceInventoryHash(targetInventory)
  exact(
    witness['targetInventoryDigest'],
    targetInventoryDigest,
    'surfaceEquivalenceWitness.targetInventoryDigest'
  )
  exact(
    targetInventoryDigest,
    executionSurfaceHash,
    'surfaceEquivalenceWitness.targetInventoryDigest'
  )
}

/**
 * Compare the final witness's declared target surface with the checkout inventory.
 * The final-bound contract validator checks the witness's internal join; this helper
 * closes the external join against the actual executable-surface enumeration.
 */
export function assertC1F1Native32SurfaceWitnessMatchesActualInventory(
  raw: unknown,
  actualTargetInventory: readonly C1F1Native32SurfaceInventoryEntry[]
): void {
  const root = record(raw, 'F1-32 final-bound contract')
  validateFinalBoundSurfaceWitness(root)
  const witness = record(root['surfaceEquivalenceWitness'], 'surfaceEquivalenceWitness')
  const declared = array(
    witness['targetSurfacePaths'],
    'surfaceEquivalenceWitness.targetSurfacePaths'
  ).map((value, index) =>
    string(value, 'surfaceEquivalenceWitness.targetSurfacePaths[' + String(index) + ']')
  )
  const actualPaths = actualTargetInventory.map((entry, index) =>
    string(entry.path, 'actual surface inventory[' + String(index) + '].path')
  )
  const actualSet = new Set(actualPaths)
  if (actualSet.size !== actualPaths.length) {
    throw new C1F1Native32ContractError(
      'surfaceEquivalenceWitness actual execution surface contains duplicate paths'
    )
  }
  const declaredSet = new Set(declared)
  if (
    declaredSet.size !== actualSet.size ||
    declared.some((path) => !actualSet.has(path)) ||
    actualPaths.some((path) => !declaredSet.has(path))
  ) {
    throw new C1F1Native32ContractError(
      'surfaceEquivalenceWitness targetSurfacePaths do not match actual execution surface'
    )
  }
  const witnessEntries = array(witness['entries'], 'surfaceEquivalenceWitness.entries')
  const witnessTargetHashes = new Map(
    witnessEntries.map((value, index) => {
      const entry = record(value, 'surfaceEquivalenceWitness.entries[' + String(index) + ']')
      return [
        string(entry['path'], 'surfaceEquivalenceWitness.entries[' + String(index) + '].path'),
        digest(
          entry['targetHash'],
          'surfaceEquivalenceWitness.entries[' + String(index) + '].targetHash'
        )
      ] as const
    })
  )
  const normalizedActual = actualTargetInventory.map((entry, index) => ({
    path: string(entry.path, 'actual surface inventory[' + String(index) + '].path'),
    sha256: digest(entry.sha256, 'actual surface inventory[' + String(index) + '].sha256')
  }))
  normalizedActual.forEach((entry) => {
    exact(
      witnessTargetHashes.get(entry.path),
      entry.sha256,
      'surfaceEquivalenceWitness.entries.' + entry.path + '.targetHash'
    )
  })
  const actualInventoryDigest = computeC1F1Native32SurfaceInventoryHash(normalizedActual)
  const execution = record(root['executionBinding'], 'executionBinding')
  exact(
    actualInventoryDigest,
    execution['executionSurfaceHash'],
    'executionBinding.executionSurfaceHash'
  )
}

export function assertC1F1Native32BindingControlSurfaceMatchesActualInventory(
  raw: unknown,
  actualControlInventory: readonly C1F1Native32SurfaceInventoryEntry[]
): void {
  const root = record(raw, 'F1-32 final-bound contract')
  validateC1F1Native32FinalBoundContract(root)
  const declaredPaths = array(root['bindingControlSurfacePaths'], 'bindingControlSurfacePaths').map(
    (value, index) => string(value, 'bindingControlSurfacePaths[' + String(index) + ']')
  )
  const actualPaths = actualControlInventory.map((entry, index) =>
    string(entry.path, 'actual binding control inventory[' + String(index) + '].path')
  )
  const declaredSet = new Set(declaredPaths)
  const actualSet = new Set(actualPaths)
  if (
    declaredSet.size !== actualSet.size ||
    declaredPaths.some((path) => !actualSet.has(path)) ||
    actualPaths.some((path) => !declaredSet.has(path))
  ) {
    throw new C1F1Native32ContractError(
      'bindingControlSurfacePaths do not match actual control surface inventory'
    )
  }
  const actualByPath = new Map(
    actualControlInventory.map((entry, index) => [
      string(entry.path, 'actual binding control inventory[' + String(index) + '].path'),
      digest(entry.sha256, 'actual binding control inventory[' + String(index) + '].sha256')
    ])
  )
  for (const dependency of C1_F1_NATIVE32_SUPPLEMENTAL_EXECUTION_DEPENDENCIES) {
    exact(
      actualByPath.get(dependency.path),
      dependency.historicalHash,
      'bindingControlSurface supplemental dependency ' + dependency.path
    )
  }
  const expectedHash = string(root['bindingControlSurfaceHash'], 'bindingControlSurfaceHash')
  const actualHash = computeC1F1Native32SurfaceInventoryHash(actualControlInventory)
  exact(actualHash, expectedHash, 'bindingControlSurfaceHash')
}

function validateCandidate(raw: unknown): C1F1Native32Contract {
  const root = record(raw, 'F1-32 contract')
  exact(root['contractId'], C1_F1_NATIVE32_CONTRACT_ID, 'contractId')
  exact(root['schemaVersion'], C1_F1_NATIVE32_CONTRACT_SCHEMA_VERSION, 'schemaVersion')
  exact(root['status'], 'FREEZE_REVIEW', 'status')
  exact(root['designStatus'], 'READY_FOR_CONTRACT_FREEZE_REVIEW', 'designStatus')
  exact(root['runContractHashRole'], 'FREEZE_CANDIDATE', 'runContractHashRole')
  if ('studyId' in root)
    throw new C1F1Native32ContractError('studyId must not exist before authorization')
  if ('effectiveSurfaceParity' in root) {
    throw new C1F1Native32ContractError(
      'effectiveSurfaceParity is final-bound evidence and must not exist in the freeze candidate'
    )
  }
  const hash = string(root['runContractSha256'], 'runContractSha256')
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new C1F1Native32ContractError('runContractSha256 must be a lowercase SHA-256 digest')
  }
  if (computeC1F1Native32RunContractSha256(root) !== hash) {
    throw new C1F1Native32ContractError(
      'runContractSha256 does not match canonical contract content'
    )
  }
  assertC1F1Native32FreezeInvariants(root)
  exact(hash, C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256, 'runContractSha256')
  if ('freezeCandidateRunContractSha256' in root || 'finalBoundRunContractSha256' in root) {
    throw new C1F1Native32ContractError('freeze candidate must not contain final-bound hash fields')
  }
  return Object.freeze(root as C1F1Native32Contract)
}

export function validateC1F1Native32FreezeCandidate(raw: unknown): C1F1Native32Contract {
  return validateCandidate(raw)
}

export function validateC1F1Native32FinalBoundContract(raw: unknown): C1F1Native32Contract {
  const root = record(raw, 'F1-32 final-bound contract')
  exact(root['contractId'], C1_F1_NATIVE32_CONTRACT_ID, 'contractId')
  exact(root['schemaVersion'], C1_F1_NATIVE32_CONTRACT_SCHEMA_VERSION, 'schemaVersion')
  exact(root['status'], 'FROZEN', 'status')
  exact(root['designStatus'], 'FINAL_BOUND', 'designStatus')
  exact(root['runContractHashRole'], 'FINAL_BOUND', 'runContractHashRole')
  if ('studyId' in root)
    throw new C1F1Native32ContractError('studyId must remain outside the final-bound contract')
  const hash = string(root['runContractSha256'], 'runContractSha256')
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new C1F1Native32ContractError('runContractSha256 must be a lowercase SHA-256 digest')
  }
  if (computeC1F1Native32RunContractSha256(root) !== hash) {
    throw new C1F1Native32ContractError(
      'runContractSha256 does not match canonical final-bound content'
    )
  }
  exact(
    root['freezeCandidateRunContractSha256'],
    C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
    'freezeCandidateRunContractSha256'
  )
  exact(root['finalBoundRunContractSha256'], hash, 'finalBoundRunContractSha256')
  const parityEvidence = record(root['effectiveSurfaceParity'], 'effectiveSurfaceParity')
  digest(parityEvidence['parityEvidenceSha256'], 'effectiveSurfaceParity.parityEvidenceSha256')
  assertExactJsonValue(
    parityEvidence,
    C1_F1_NATIVE32_EFFECTIVE_SURFACE_PARITY_POLICY,
    'effectiveSurfaceParity'
  )
  const execution = record(root['executionBinding'], 'executionBinding')
  const revision = string(execution['codeRevision'], 'executionBinding.codeRevision')
  const surfaceHash = string(
    execution['executionSurfaceHash'],
    'executionBinding.executionSurfaceHash'
  )
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new C1F1Native32ContractError(
      'executionBinding.codeRevision must be a 40-character Git SHA'
    )
  if (!/^[a-f0-9]{64}$/.test(surfaceHash))
    throw new C1F1Native32ContractError(
      'executionBinding.executionSurfaceHash must be a 64-character SHA-256 digest'
    )
  const controlHash = string(root['bindingControlSurfaceHash'], 'bindingControlSurfaceHash')
  if (!/^[a-f0-9]{64}$/.test(controlHash))
    throw new C1F1Native32ContractError(
      'bindingControlSurfaceHash must be a 64-character SHA-256 digest'
    )
  const controlPaths = array(root['bindingControlSurfacePaths'], 'bindingControlSurfacePaths').map(
    (value, index) => string(value, 'bindingControlSurfacePaths[' + String(index) + ']')
  )
  if (controlPaths.length === 0 || new Set(controlPaths).size !== controlPaths.length) {
    throw new C1F1Native32ContractError(
      'bindingControlSurfacePaths must contain unique non-empty paths'
    )
  }
  if (
    controlPaths.some(
      (path) =>
        path.startsWith('/') ||
        path.includes('\\') ||
        path.includes('/./') ||
        path.includes('/../') ||
        (!C1_F1_NATIVE32_BINDING_CONTROL_SURFACE_PATH_ROOTS.some(
          (rootPath) => path === rootPath || path.startsWith(rootPath + '/')
        ) &&
          !C1_F1_NATIVE32_SUPPLEMENTAL_EXECUTION_DEPENDENCIES.some(
            (dependency) => dependency.path === path
          ))
    )
  ) {
    throw new C1F1Native32ContractError(
      'bindingControlSurfacePaths contains a path outside declared control roots'
    )
  }
  validateFinalBoundSurfaceWitness(root)
  const candidateLike = JSON.parse(JSON.stringify(root)) as JsonRecord
  candidateLike['status'] = 'FREEZE_REVIEW'
  candidateLike['designStatus'] = 'READY_FOR_CONTRACT_FREEZE_REVIEW'
  candidateLike['runContractHashRole'] = 'FREEZE_CANDIDATE'
  delete candidateLike['freezeCandidateRunContractSha256']
  delete candidateLike['finalBoundRunContractSha256']
  delete candidateLike['bindingControlSurfaceHash']
  delete candidateLike['bindingControlSurfacePaths']
  delete candidateLike['effectiveSurfaceParity']
  const candidateBinding = record(candidateLike['executionBinding'], 'executionBinding')
  candidateBinding['codeRevision'] = C1_F1_NATIVE32_PENDING_BINDING
  candidateBinding['executionSurfaceHash'] = C1_F1_NATIVE32_PENDING_BINDING
  candidateLike['surfaceEquivalenceWitness'] = JSON.parse(
    JSON.stringify(F1_NATIVE32_PRE_BINDING_SURFACE_WITNESS)
  )
  candidateLike['runContractSha256'] = computeC1F1Native32RunContractSha256(candidateLike)
  validateCandidate(candidateLike)
  return Object.freeze(root as C1F1Native32Contract)
}

export function validateC1F1Native32Contract(
  raw: unknown,
  phase: C1F1Native32ContractPhase = 'AUTO'
): C1F1Native32Contract {
  const root = record(raw, 'F1-32 contract')
  const role = root['runContractHashRole']
  if (phase === 'FREEZE_CANDIDATE' || (phase === 'AUTO' && role === 'FREEZE_CANDIDATE')) {
    return validateCandidate(root)
  }
  if (phase === 'FINAL_BOUND' || (phase === 'AUTO' && role === 'FINAL_BOUND')) {
    return validateC1F1Native32FinalBoundContract(root)
  }
  throw new C1F1Native32ContractError('runContractHashRole must select a known contract phase')
}

export async function loadC1F1Native32Contract(
  repoRoot: string,
  phase: C1F1Native32ContractPhase = 'AUTO'
): Promise<C1F1Native32Contract> {
  const path = resolve(repoRoot, C1_F1_NATIVE32_CONTRACT_RELATIVE_PATH)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new C1F1Native32ContractError(
      'unable to read F1-32 contract: ' + (error instanceof Error ? error.message : String(error))
    )
  }
  return validateC1F1Native32Contract(parsed, phase)
}

export function getC1F1Native32FrozenProjection(): JsonRecord {
  return JSON.parse(
    JSON.stringify({
      claims: F1_NATIVE32_CLAIMS,
      estimand: F1_NATIVE32_ESTIMAND,
      inherited: f0InheritedProjection(),
      surfaceEquivalenceWitness: stableClone(F1_NATIVE32_PRE_BINDING_SURFACE_WITNESS),
      frontier: stableClone(F1_NATIVE32_FRONTIER)
    })
  ) as JsonRecord
}

export { C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256 }
