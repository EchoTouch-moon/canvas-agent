import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
  C1_F0_V2_FREEZE_INVARIANTS,
  computeC1F0V2RunContractSha256
} from '../../f0/contract/c1-f0-v2-contract'

export const C1_F1_NATIVE32_CONTRACT_RELATIVE_PATH =
  'research/context-benchmarks/c1/f1/contracts/c1-f1-native-feasibility-32.json'
export const C1_F1_NATIVE32_CONTRACT_ID = 'C1_F1_NATIVE_FEASIBILITY_32' as const
export const C1_F1_NATIVE32_CONTRACT_SCHEMA_VERSION = 1 as const
export const C1_F1_NATIVE32_PENDING_BINDING = 'PENDING_F1_32_IMPLEMENTATION' as const
export const C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256 =
  '7b5c1a45ebf020cba88930f7c8f200e322081d63e7ca1feb1c034eb0014c1eda' as const
export const C1_F1_NATIVE32_PROVIDER_CONFIG_HASH =
  'bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a'
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

const F1_NATIVE32_SURFACE_WITNESS = Object.freeze({
  schemaVersion: 1,
  mode: 'PRE_BINDING_PER_PATH_CLASSIFICATION',
  anchorContractId: C1_F1_NATIVE32_HISTORICAL_ANCHOR.contractId,
  anchorExecutionRevision: C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionRevision,
  anchorExecutionSurfaceHash: C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionSurfaceHash,
  anchorSurfacePaths: [
    'research/context-benchmarks/c1/f0/v2',
    'research/context-benchmarks/c1/f0/hardening',
    'research/context-benchmarks/c1/f0/contract',
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
  ],
  targetExecutionBinding: {
    codeRevision: C1_F1_NATIVE32_PENDING_BINDING,
    executionSurfaceHash: C1_F1_NATIVE32_PENDING_BINDING
  },
  allowedClassifications: ['EXACT_UNCHANGED', 'BUDGET_ONLY_PROJECTION'],
  budgetOnlyProjectionPaths: [
    'budgets.perRun.maxProviderRequests',
    'budgets.study.maxProviderRequests'
  ],
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
    'identityPolicy',
    'terminationBehavior'
  ],
  failClosedOn: ['OTHER_CHANGE', 'MISSING_PATH', 'UNRESOLVED_PATH'],
  witnessStatus: 'REQUIRED_BEFORE_EXECUTION'
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

  assertProjection(
    root['surfaceEquivalenceWitness'],
    F1_NATIVE32_SURFACE_WITNESS,
    'surfaceEquivalenceWitness'
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

function validateCandidate(raw: unknown): C1F1Native32Contract {
  const root = record(raw, 'F1-32 contract')
  exact(root['contractId'], C1_F1_NATIVE32_CONTRACT_ID, 'contractId')
  exact(root['schemaVersion'], C1_F1_NATIVE32_CONTRACT_SCHEMA_VERSION, 'schemaVersion')
  exact(root['status'], 'FREEZE_REVIEW', 'status')
  exact(root['designStatus'], 'READY_FOR_CONTRACT_FREEZE_REVIEW', 'designStatus')
  exact(root['runContractHashRole'], 'FREEZE_CANDIDATE', 'runContractHashRole')
  if ('studyId' in root)
    throw new C1F1Native32ContractError('studyId must not exist before authorization')
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
  const candidateLike = JSON.parse(JSON.stringify(root)) as JsonRecord
  candidateLike['status'] = 'FREEZE_REVIEW'
  candidateLike['designStatus'] = 'READY_FOR_CONTRACT_FREEZE_REVIEW'
  candidateLike['runContractHashRole'] = 'FREEZE_CANDIDATE'
  delete candidateLike['freezeCandidateRunContractSha256']
  delete candidateLike['finalBoundRunContractSha256']
  const candidateBinding = record(candidateLike['executionBinding'], 'executionBinding')
  candidateBinding['codeRevision'] = C1_F1_NATIVE32_PENDING_BINDING
  candidateBinding['executionSurfaceHash'] = C1_F1_NATIVE32_PENDING_BINDING
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
      surfaceEquivalenceWitness: stableClone(F1_NATIVE32_SURFACE_WITNESS),
      frontier: stableClone(F1_NATIVE32_FRONTIER)
    })
  ) as JsonRecord
}

export { C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256 }
