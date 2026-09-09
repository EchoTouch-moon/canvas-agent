import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { C1_AUTHORIZED_PROVIDER_MAX_TOKENS } from './c1-authorized-provider'
import { C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE } from './c1-live-preflight'

export const C1_E0_ENROLLMENT_MANIFEST_ID = 'C1_EFFECTIVENESS_E0_ENROLLMENT_V1'
export const C1_E0_ENROLLMENT_MANIFEST_RELATIVE_PATH =
  'research/context-benchmarks/c1/e0/manifests/c1-effectiveness-e0-enrollment-v1.json'
export const C1_E0_RUN_CONTRACT_ID = 'C1_EFFECTIVENESS_E0_RUN_V1'
export const C1_E0_RUN_CONTRACT_RELATIVE_PATH =
  'research/context-benchmarks/c1/e0/contracts/c1-effectiveness-e0-run-v1.json'
export const C1_E0_TASK_MANIFEST_RELATIVE_PATH =
  'research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json'
export const C1_E0_ENROLLMENT_COHORT = 'HISTORICAL_OPPORTUNITY_ENRICHED' as const
export const C1_E0_SELECTION_ALGORITHM_ID = 'C1_E0_STRATIFIED_SHA256_V1'
export const C1_E0_SELECTION_SEED = 'c1-e0-enrollment-selection-20260909'
export const C1_E0_DOSE_SCHEMA_ID = 'C1_EFFECTIVENESS_DOSE_V1'
export const C1_E0_POLICY_ID = 'C1_SUPERSEDED_VERSION_POLICY_V1'
export const C1_E0_PROVIDER = 'step-plan'
export const C1_E0_MODEL = 'step-3.7-flash'
export const C1_E0_ENDPOINT = 'https://api.stepfun.com/step_plan/v1/chat/completions'
export const C1_E0_NODE_RANGE = '>=24.0.0 <25.0.0'
export const C1_E0_PAIR_COUNT = 4
export const C1_E0_TOTAL_LEG_COUNT = C1_E0_PAIR_COUNT * 2
export const C1_E0_MIN_NON_ZERO_TREATMENT_PAIRS = 2
export const C1_E0_MIN_NON_ZERO_DISTINCT_TASKS = 2

const hash64Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'expected a SHA-256 hash')
const gitHashSchema = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i, 'expected a Git object hash')

/** Canonical JSON used by every E0 binding digest. */
export function canonicalC1E0Json(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error('value is not JSON serializable')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalC1E0Json(item)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalC1E0Json(record[key])}`)
      .join(',')}}`
  }
  throw new Error(`unsupported JSON value type: ${typeof value}`)
}

export function sha256C1E0(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function hashCanonicalC1E0(value: unknown): string {
  return sha256C1E0(canonicalC1E0Json(value))
}

/**
 * Credential-free digest of the actual outbound request configuration used by
 * the authorized provider source. Optional wire fields are represented as
 * null when omitted from the request body; no credential or response data is
 * part of this binding.
 */
export const C1_E0_PROVIDER_REQUEST_CONFIG = Object.freeze({
  provider: C1_E0_PROVIDER,
  endpoint: C1_E0_ENDPOINT,
  request: {
    model: C1_E0_MODEL,
    max_tokens: C1_AUTHORIZED_PROVIDER_MAX_TOKENS,
    temperature: null,
    top_p: null,
    stream: C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE.providerNativeMetadata.streaming,
    tool_choice: null,
    tools: {
      structuralFingerprint: C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE.structuralFingerprint,
      definitions: C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE.tools
    }
  },
  providerNativeOptions: C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE.providerNativeMetadata
} as const)

export const C1_E0_PROVIDER_CONFIG_HASH = hashCanonicalC1E0(C1_E0_PROVIDER_REQUEST_CONFIG)

const c1E0EnrollmentRuleSchema = z
  .object({
    ruleId: z.string().min(1),
    definition: z.string().min(1),
    generalWorkloadPrevalenceSource: z.string().min(1),
    runtimeInterpretation: z.string().min(1)
  })
  .strict()

const c1E0CandidateSchema = z
  .object({
    taskId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._-]+$/),
    stratum: z.string().min(1),
    taskManifestPath: z.literal(C1_E0_TASK_MANIFEST_RELATIVE_PATH),
    fixtureTreeObjectId: gitHashSchema,
    fixtureContentSha256: hash64Schema,
    promptSha256: hash64Schema,
    objectiveOracleSha256: hash64Schema,
    regressionOracleSha256: hash64Schema,
    historicalEvidenceRef: z.string().min(1),
    evidenceScope: z.enum(['EXACT_LOWER_BOUND', 'LEG_UPPER_BOUND', 'OBSERVATIONAL']),
    evidenceSummary: z.string().min(1)
  })
  .strict()

const c1E0ExcludedCandidateSchema = z
  .object({
    taskId: z.string().min(1),
    reason: z.string().min(1)
  })
  .strict()

const c1E0SelectedTaskInstanceSchema = z
  .object({
    selectionOrdinal: z.number().int().min(1).max(C1_E0_PAIR_COUNT),
    taskId: z.string().min(1),
    selectionRank: z.number().int().min(1)
  })
  .strict()

export const c1E0EnrollmentManifestSchema = z
  .object({
    manifestId: z.literal(C1_E0_ENROLLMENT_MANIFEST_ID),
    schemaVersion: z.literal(1),
    status: z.literal('PREPARED'),
    enrollmentCohort: z.literal(C1_E0_ENROLLMENT_COHORT),
    sourceObservationalStudy: z.string().min(1),
    sourceEvidenceRef: z.string().min(1),
    taskManifestPath: z.literal(C1_E0_TASK_MANIFEST_RELATIVE_PATH),
    taskManifestSha256: hash64Schema,
    enrollmentRule: c1E0EnrollmentRuleSchema,
    candidatePoolHash: hash64Schema,
    candidateCount: z.number().int().nonnegative(),
    candidates: z.array(c1E0CandidateSchema).min(1),
    selectionAlgorithmId: z.literal(C1_E0_SELECTION_ALGORITHM_ID),
    selectionSeed: z.string().min(1),
    selectedTaskIds: z.array(z.string().min(1)).min(1),
    selectedTaskInstances: z.array(c1E0SelectedTaskInstanceSchema).length(C1_E0_PAIR_COUNT),
    excludedCandidates: z.array(c1E0ExcludedCandidateSchema),
    manifestSha256: hash64Schema
  })
  .strict()

export type C1E0EnrollmentManifest = z.infer<typeof c1E0EnrollmentManifestSchema>
export type C1E0EnrollmentCandidate = z.infer<typeof c1E0CandidateSchema>
export type C1E0SelectedTaskInstance = z.infer<typeof c1E0SelectedTaskInstanceSchema>

function replaceSelfHash(value: unknown, key: string): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  clone[key] = 'SELF'
  return clone
}

export function computeC1E0CandidatePoolHash(
  candidates: readonly C1E0EnrollmentCandidate[]
): string {
  return hashCanonicalC1E0(candidates)
}

export function computeC1E0EnrollmentManifestSha256(manifest: unknown): string {
  return hashCanonicalC1E0(replaceSelfHash(manifest, 'manifestSha256'))
}

function candidateDigest(
  manifest: Pick<C1E0EnrollmentManifest, 'selectionSeed'>,
  candidate: Pick<C1E0EnrollmentCandidate, 'stratum' | 'taskId'>
): string {
  return sha256C1E0(`${manifest.selectionSeed}:${candidate.stratum}:${candidate.taskId}`)
}

function rankedCandidates(
  manifest: Pick<C1E0EnrollmentManifest, 'selectionSeed' | 'candidates'>
): readonly { readonly candidate: C1E0EnrollmentCandidate; readonly digest: string }[] {
  return manifest.candidates
    .map((candidate) => ({ candidate, digest: candidateDigest(manifest, candidate) }))
    .sort((left, right) =>
      left.digest === right.digest
        ? left.candidate.taskId.localeCompare(right.candidate.taskId)
        : left.digest.localeCompare(right.digest)
    )
}

/**
 * Select up to four unique candidates deterministically. The first pass gives
 * each stratum one slot when possible; remaining slots follow the global
 * SHA-256 ranking. Manual candidate selection is never consulted.
 */
export function selectC1E0CandidateTaskIds(
  manifest: Pick<C1E0EnrollmentManifest, 'selectionSeed' | 'candidates'>
): readonly string[] {
  const byStratum = new Map<string, ReturnType<typeof rankedCandidates>[number]>()
  for (const entry of rankedCandidates(manifest)) {
    const current = byStratum.get(entry.candidate.stratum)
    if (current === undefined || entry.digest < current.digest)
      byStratum.set(entry.candidate.stratum, entry)
  }
  const selected = [...byStratum.values()].sort((left, right) =>
    left.digest.localeCompare(right.digest)
  )
  const selectedIds = new Set(
    selected.slice(0, C1_E0_PAIR_COUNT).map((entry) => entry.candidate.taskId)
  )
  for (const entry of rankedCandidates(manifest)) {
    if (selectedIds.size >= C1_E0_PAIR_COUNT) break
    selectedIds.add(entry.candidate.taskId)
  }
  return [...rankedCandidates(manifest)]
    .filter((entry) => selectedIds.has(entry.candidate.taskId))
    .sort((left, right) => left.digest.localeCompare(right.digest))
    .map((entry) => entry.candidate.taskId)
}

function expectedArmOrder(
  seed: string,
  pairOrdinal: number
): 'NATIVE_THEN_RUNTIME' | 'RUNTIME_THEN_NATIVE' {
  const orderRanks = [1, 2, 3, 4].sort((left, right) =>
    sha256C1E0(`${seed}:arm:${left}`).localeCompare(sha256C1E0(`${seed}:arm:${right}`))
  )
  return orderRanks.indexOf(pairOrdinal) < 2 ? 'NATIVE_THEN_RUNTIME' : 'RUNTIME_THEN_NATIVE'
}

export function selectC1E0TaskInstances(
  manifest: C1E0EnrollmentManifest
): readonly C1E0SelectedTaskInstance[] {
  const expectedIds = selectC1E0CandidateTaskIds(manifest)
  if (JSON.stringify(expectedIds) !== JSON.stringify(manifest.selectedTaskIds)) {
    throw new Error('E0 selectedTaskIds do not match deterministic enrollment selection')
  }
  const rankedSelected = rankedCandidates({
    selectionSeed: manifest.selectionSeed,
    candidates: manifest.candidates.filter((candidate) => expectedIds.includes(candidate.taskId))
  })
  if (rankedSelected.length === 0) throw new Error('E0 enrollment selected no candidates')
  return Array.from({ length: C1_E0_PAIR_COUNT }, (_, index) => {
    const candidate = rankedSelected[index % rankedSelected.length]!.candidate
    return {
      selectionOrdinal: index + 1,
      taskId: candidate.taskId,
      selectionRank: expectedIds.indexOf(candidate.taskId) + 1
    }
  })
}

function assertEnrollmentManifestShape(manifest: C1E0EnrollmentManifest): void {
  if (manifest.candidateCount !== manifest.candidates.length) {
    throw new Error('E0 candidateCount does not match candidates.length')
  }
  if (computeC1E0CandidatePoolHash(manifest.candidates) !== manifest.candidatePoolHash) {
    throw new Error('E0 candidatePoolHash mismatch')
  }
  if (computeC1E0EnrollmentManifestSha256(manifest) !== manifest.manifestSha256) {
    throw new Error('E0 enrollment manifest hash mismatch')
  }
  const candidateIds = new Set(manifest.candidates.map((candidate) => candidate.taskId))
  if (candidateIds.size !== manifest.candidates.length)
    throw new Error('E0 candidate taskId is duplicated')
  if (new Set(manifest.selectedTaskIds).size !== manifest.selectedTaskIds.length) {
    throw new Error('E0 selectedTaskIds contains duplicates')
  }
  if (manifest.selectedTaskIds.some((taskId) => !candidateIds.has(taskId))) {
    throw new Error('E0 selectedTaskIds contains an unknown candidate')
  }
  const selectedInstances = selectC1E0TaskInstances(manifest)
  if (JSON.stringify(selectedInstances) !== JSON.stringify(manifest.selectedTaskInstances)) {
    throw new Error('E0 selectedTaskInstances do not match deterministic selection')
  }
  const excludedIds = new Set(manifest.excludedCandidates.map((entry) => entry.taskId))
  if (excludedIds.size !== manifest.excludedCandidates.length) {
    throw new Error('E0 excludedCandidates contains duplicates')
  }
  for (const taskId of excludedIds) {
    if (candidateIds.has(taskId) === false || manifest.selectedTaskIds.includes(taskId)) {
      throw new Error(`E0 excluded candidate is not a non-selected candidate: ${taskId}`)
    }
  }
  if (
    manifest.candidates.some(
      (candidate) =>
        !manifest.selectedTaskIds.includes(candidate.taskId) && !excludedIds.has(candidate.taskId)
    )
  ) {
    throw new Error('E0 candidate is neither selected nor explicitly excluded')
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected JSON object at ${path}`)
  }
  return value as Record<string, unknown>
}

function objectField(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`${label} must be a non-empty string`)
  return value
}

function assertCandidateReferences(
  taskManifest: Record<string, unknown>,
  enrollment: C1E0EnrollmentManifest
): void {
  const tasks = taskManifest['tasks']
  if (!Array.isArray(tasks)) throw new Error('C1 task manifest tasks must be an array')
  const byId = new Map<string, Record<string, unknown>>()
  for (const rawTask of tasks) {
    const task = objectField(rawTask, 'C1 task manifest task')
    const taskId = stringField(task['taskId'], 'C1 task manifest taskId')
    byId.set(taskId, task)
  }
  for (const candidate of enrollment.candidates) {
    const task = byId.get(candidate.taskId)
    if (task === undefined)
      throw new Error(`E0 candidate task is absent from C1 manifest: ${candidate.taskId}`)
    if (stringField(task['stratum'], `${candidate.taskId}.stratum`) !== candidate.stratum) {
      throw new Error(`E0 candidate stratum mismatch: ${candidate.taskId}`)
    }
    const fixtureRevision = objectField(
      task['fixtureRevision'],
      `${candidate.taskId}.fixtureRevision`
    )
    if (
      stringField(
        fixtureRevision['fixtureTreeObjectId'],
        `${candidate.taskId}.fixtureTreeObjectId`
      ) !== candidate.fixtureTreeObjectId
    ) {
      throw new Error(`E0 candidate fixture tree mismatch: ${candidate.taskId}`)
    }
    if (
      stringField(
        fixtureRevision['fixtureContentSha256'],
        `${candidate.taskId}.fixtureContentSha256`
      ) !== candidate.fixtureContentSha256
    ) {
      throw new Error(`E0 candidate fixture content hash mismatch: ${candidate.taskId}`)
    }
    if (
      stringField(task['promptSha256'], `${candidate.taskId}.promptSha256`) !==
      candidate.promptSha256
    ) {
      throw new Error(`E0 candidate prompt hash mismatch: ${candidate.taskId}`)
    }
    if (hashCanonicalC1E0(task['objectiveOracle']) !== candidate.objectiveOracleSha256) {
      throw new Error(`E0 candidate objective oracle hash mismatch: ${candidate.taskId}`)
    }
    if (hashCanonicalC1E0(task['regressionOracle']) !== candidate.regressionOracleSha256) {
      throw new Error(`E0 candidate regression oracle hash mismatch: ${candidate.taskId}`)
    }
  }
}

export async function loadC1E0EnrollmentManifest(
  repoRoot: string
): Promise<C1E0EnrollmentManifest> {
  const manifestPath = resolve(repoRoot, C1_E0_ENROLLMENT_MANIFEST_RELATIVE_PATH)
  const raw = await readJson(manifestPath)
  const manifest = c1E0EnrollmentManifestSchema.parse(raw)
  assertEnrollmentManifestShape(manifest)
  const taskManifestPath = resolve(repoRoot, C1_E0_TASK_MANIFEST_RELATIVE_PATH)
  const taskManifestText = await readFile(taskManifestPath, 'utf8')
  if (sha256C1E0(taskManifestText) !== manifest.taskManifestSha256) {
    throw new Error('E0 task manifest file hash mismatch')
  }
  assertCandidateReferences(JSON.parse(taskManifestText) as Record<string, unknown>, manifest)
  return manifest
}

const c1E0PairAssignmentSchema = z
  .object({
    pairOrdinal: z.number().int().min(1).max(C1_E0_PAIR_COUNT),
    pairId: z.string().min(1),
    taskId: z.string().min(1),
    stratum: z.string().min(1),
    order: z.enum(['NATIVE_THEN_RUNTIME', 'RUNTIME_THEN_NATIVE']),
    armSequence: z.tuple([z.enum(['NATIVE', 'RUNTIME']), z.enum(['NATIVE', 'RUNTIME'])]),
    repetition: z.number().int().min(1)
  })
  .strict()

const c1E0BudgetSchema = z
  .object({
    maxProviderRequests: z.number().int().positive(),
    maxProviderToolRequests: z.number().int().nonnegative(),
    maxWallClockMs: z.number().int().positive(),
    maxOutputTokensPerRequest: z.number().int().positive()
  })
  .strict()

export const c1E0RunContractSchema = z
  .object({
    contractId: z.literal(C1_E0_RUN_CONTRACT_ID),
    schemaVersion: z.literal(1),
    status: z.literal('PREPARED'),
    design: z
      .object({
        kind: z.literal('QUALIFICATION_NOT_CONFIRMATORY'),
        pairCount: z.literal(C1_E0_PAIR_COUNT),
        totalLegs: z.literal(C1_E0_TOTAL_LEG_COUNT),
        maxConcurrency: z.literal(1),
        adaptiveSampling: z.literal(false),
        pairCountFrozenBeforeFirstResponse: z.literal(true),
        armOrderQuota: z
          .object({ nativeThenRuntime: z.literal(2), runtimeThenNative: z.literal(2) })
          .strict(),
        enrollmentCohort: z.literal(C1_E0_ENROLLMENT_COHORT),
        qualificationGate: z
          .object({
            minNonZeroTreatmentPairs: z.literal(C1_E0_MIN_NON_ZERO_TREATMENT_PAIRS),
            minNonZeroDistinctTasks: z.literal(C1_E0_MIN_NON_ZERO_DISTINCT_TASKS)
          })
          .strict()
      })
      .strict(),
    enrollmentBinding: z
      .object({
        manifestId: z.literal(C1_E0_ENROLLMENT_MANIFEST_ID),
        manifestPath: z.literal(C1_E0_ENROLLMENT_MANIFEST_RELATIVE_PATH),
        manifestSha256: hash64Schema,
        taskManifestPath: z.literal(C1_E0_TASK_MANIFEST_RELATIVE_PATH),
        taskManifestSha256: hash64Schema,
        enrollmentCohort: z.literal(C1_E0_ENROLLMENT_COHORT),
        candidatePoolHash: hash64Schema,
        candidateCount: z.number().int().nonnegative(),
        selectionAlgorithmId: z.literal(C1_E0_SELECTION_ALGORITHM_ID),
        selectionSeed: z.string().min(1),
        selectedTaskIds: z.array(z.string().min(1)).min(1)
      })
      .strict(),
    policyBinding: z
      .object({
        policyId: z.literal(C1_E0_POLICY_ID),
        pureEviction: z.literal(true),
        proactiveReread: z.literal(false),
        rehydrateAllowed: z.literal(false),
        runtimeForbiddenInputs: z.array(z.string().min(1)).min(1),
        runtimeAllowedInputs: z.array(z.string().min(1)).min(1)
      })
      .strict(),
    doseBinding: z
      .object({ schemaId: z.literal(C1_E0_DOSE_SCHEMA_ID), schemaVersion: z.literal(1) })
      .strict(),
    executionBinding: z
      .object({
        provider: z.literal(C1_E0_PROVIDER),
        model: z.literal(C1_E0_MODEL),
        endpoint: z.literal(C1_E0_ENDPOINT),
        nodeRange: z.literal(C1_E0_NODE_RANGE),
        codeRevision: z.string().min(1),
        credentialEnv: z.literal('STEP_PLAN_API_KEY'),
        credentialPersistence: z.literal('MEMORY_ONLY'),
        fallback: z.literal('NONE'),
        executionMode: z.literal('E0_STRICT'),
        providerConfigHash: hash64Schema
      })
      .strict(),
    budgets: z
      .object({
        perLeg: c1E0BudgetSchema,
        study: c1E0BudgetSchema.extend({ maxLegs: z.literal(C1_E0_TOTAL_LEG_COUNT) })
      })
      .strict(),
    pairAssignments: z.array(c1E0PairAssignmentSchema).length(C1_E0_PAIR_COUNT),
    claims: z.literal('E0_DIRECTIONAL_QUALIFICATION_ONLY'),
    estimand: z.literal('NOT_CONFIRMATORY'),
    noResumeRetryReuse: z.literal(true),
    runContractSha256: hash64Schema
  })
  .strict()

export type C1E0RunContract = z.infer<typeof c1E0RunContractSchema>
export type C1E0PairAssignment = z.infer<typeof c1E0PairAssignmentSchema>

export function computeC1E0RunContractSha256(contract: unknown): string {
  return hashCanonicalC1E0(replaceSelfHash(contract, 'runContractSha256'))
}

export function buildC1E0PairAssignments(
  manifest: C1E0EnrollmentManifest
): readonly C1E0PairAssignment[] {
  const selected = selectC1E0TaskInstances(manifest)
  const candidates = new Map(manifest.candidates.map((candidate) => [candidate.taskId, candidate]))
  return selected.map((instance) => {
    const candidate = candidates.get(instance.taskId)
    if (candidate === undefined) throw new Error(`missing selected candidate ${instance.taskId}`)
    const order = expectedArmOrder(manifest.selectionSeed, instance.selectionOrdinal)
    return {
      pairOrdinal: instance.selectionOrdinal,
      pairId: `c1-e0-${String(instance.selectionOrdinal).padStart(2, '0')}`,
      taskId: instance.taskId,
      stratum: candidate.stratum,
      order,
      armSequence: order === 'NATIVE_THEN_RUNTIME' ? ['NATIVE', 'RUNTIME'] : ['RUNTIME', 'NATIVE'],
      repetition: Math.floor((instance.selectionOrdinal - 1) / manifest.selectedTaskIds.length) + 1
    }
  })
}

export function assertC1E0RunContract(
  contract: C1E0RunContract,
  enrollment: C1E0EnrollmentManifest
): void {
  if (computeC1E0RunContractSha256(contract) !== contract.runContractSha256) {
    throw new Error('E0 run contract hash mismatch')
  }
  if (contract.executionBinding.providerConfigHash !== C1_E0_PROVIDER_CONFIG_HASH) {
    throw new Error('E0 provider configuration binding mismatch')
  }
  const binding = contract.enrollmentBinding
  if (
    binding.manifestSha256 !== enrollment.manifestSha256 ||
    binding.taskManifestSha256 !== enrollment.taskManifestSha256 ||
    binding.candidatePoolHash !== enrollment.candidatePoolHash ||
    binding.selectionSeed !== enrollment.selectionSeed ||
    JSON.stringify(binding.selectedTaskIds) !== JSON.stringify(enrollment.selectedTaskIds)
  ) {
    throw new Error('E0 run contract enrollment binding mismatch')
  }
  const expected = buildC1E0PairAssignments(enrollment)
  if (JSON.stringify(contract.pairAssignments) !== JSON.stringify(expected)) {
    throw new Error('E0 pair assignment matrix is not deterministic')
  }
  const nativeThenRuntime = contract.pairAssignments.filter(
    (assignment) => assignment.order === 'NATIVE_THEN_RUNTIME'
  ).length
  const runtimeThenNative = contract.pairAssignments.filter(
    (assignment) => assignment.order === 'RUNTIME_THEN_NATIVE'
  ).length
  if (nativeThenRuntime !== 2 || runtimeThenNative !== 2) {
    throw new Error('E0 arm-order quota is not 2:2')
  }
}

export async function loadC1E0RunContract(repoRoot: string): Promise<C1E0RunContract> {
  const enrollment = await loadC1E0EnrollmentManifest(repoRoot)
  const contractPath = resolve(repoRoot, C1_E0_RUN_CONTRACT_RELATIVE_PATH)
  const contract = c1E0RunContractSchema.parse(await readJson(contractPath))
  assertC1E0RunContract(contract, enrollment)
  return contract
}
