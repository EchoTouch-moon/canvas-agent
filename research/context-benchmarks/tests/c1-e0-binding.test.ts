import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_E0_ENROLLMENT_COHORT,
  C1_E0_ENROLLMENT_MANIFEST_ID,
  C1_E0_PAIR_COUNT,
  C1_E0_PROVIDER_CONFIG_HASH,
  C1_E0_PROVIDER_REQUEST_CONFIG,
  C1_E0_RUN_CONTRACT_ID,
  C1_E0_SELECTION_ALGORITHM_ID,
  assertC1E0RunContract,
  canonicalC1E0Json,
  computeC1E0CandidatePoolHash,
  computeC1E0EnrollmentManifestSha256,
  computeC1E0RunContractSha256,
  hashCanonicalC1E0,
  loadC1E0EnrollmentManifest,
  loadC1E0RunContract,
  selectC1E0CandidateTaskIds,
  type C1E0EnrollmentCandidate
} from '../src'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')

function candidate(taskId: string, stratum: string): C1E0EnrollmentCandidate {
  return {
    taskId,
    stratum,
    taskManifestPath: 'research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json',
    fixtureTreeObjectId: 'a'.repeat(40),
    fixtureContentSha256: 'b'.repeat(64),
    promptSha256: 'c'.repeat(64),
    objectiveOracleSha256: 'd'.repeat(64),
    regressionOracleSha256: 'e'.repeat(64),
    historicalEvidenceRef: 'docs/research/c1-superseded-version-prevalence-2026-09-08.zh-CN.md',
    evidenceScope: 'OBSERVATIONAL',
    evidenceSummary: 'synthetic selection test candidate'
  }
}

describe('C1 E0 enrollment and run binding', () => {
  it('loads the prepared enrollment manifest and deterministic four-pair run contract', async () => {
    const enrollment = await loadC1E0EnrollmentManifest(REPO_ROOT)
    const contract = await loadC1E0RunContract(REPO_ROOT)

    expect(enrollment.manifestId).toBe(C1_E0_ENROLLMENT_MANIFEST_ID)
    expect(enrollment.enrollmentCohort).toBe(C1_E0_ENROLLMENT_COHORT)
    expect(enrollment.selectionAlgorithmId).toBe(C1_E0_SELECTION_ALGORITHM_ID)
    expect(enrollment.candidateCount).toBe(2)
    expect(enrollment.selectedTaskIds).toEqual([
      'c1-t2-multi-file-migration-v1',
      'c1-t1-localized-distractor-v1'
    ])
    expect(enrollment.selectedTaskInstances).toHaveLength(C1_E0_PAIR_COUNT)
    expect(contract.contractId).toBe(C1_E0_RUN_CONTRACT_ID)
    expect(contract.design.pairCount).toBe(4)
    expect(contract.design.totalLegs).toBe(8)
    expect(contract.design.armOrderQuota).toEqual({ nativeThenRuntime: 2, runtimeThenNative: 2 })
    expect(contract.design.qualificationGate).toEqual({
      minNonZeroTreatmentPairs: 2,
      minNonZeroDistinctTasks: 2
    })
    expect(contract.executionBinding.providerConfigHash).toBe(C1_E0_PROVIDER_CONFIG_HASH)
    expect(
      contract.pairAssignments.filter((assignment) => assignment.order === 'NATIVE_THEN_RUNTIME')
    ).toHaveLength(2)
    expect(
      contract.pairAssignments.filter((assignment) => assignment.order === 'RUNTIME_THEN_NATIVE')
    ).toHaveLength(2)
    expect(contract.pairAssignments.map((assignment) => assignment.taskId)).toEqual([
      'c1-t2-multi-file-migration-v1',
      'c1-t1-localized-distractor-v1',
      'c1-t2-multi-file-migration-v1',
      'c1-t1-localized-distractor-v1'
    ])
  })

  it('recomputes self hashes and detects mutations', async () => {
    const enrollment = await loadC1E0EnrollmentManifest(REPO_ROOT)
    const contract = await loadC1E0RunContract(REPO_ROOT)

    expect(computeC1E0CandidatePoolHash(enrollment.candidates)).toBe(enrollment.candidatePoolHash)
    expect(computeC1E0EnrollmentManifestSha256(enrollment)).toBe(enrollment.manifestSha256)
    expect(computeC1E0RunContractSha256(contract)).toBe(contract.runContractSha256)
    const mutated = JSON.parse(JSON.stringify(contract)) as typeof contract
    mutated.design.pairCount = 3 as never
    expect(computeC1E0RunContractSha256(mutated)).not.toBe(contract.runContractSha256)
  })

  it('selects over-sized candidate pools deterministically by stratum and seed', () => {
    const candidates = [
      candidate('task-a', 'alpha'),
      candidate('task-b', 'beta'),
      candidate('task-c', 'gamma'),
      candidate('task-d', 'delta'),
      candidate('task-e', 'epsilon'),
      candidate('task-f', 'zeta')
    ]
    const first = selectC1E0CandidateTaskIds({
      selectionSeed: 'selection-test',
      candidates
    })
    const reordered = selectC1E0CandidateTaskIds({
      selectionSeed: 'selection-test',
      candidates: [...candidates].reverse()
    })
    expect(first).toHaveLength(4)
    expect(first).toEqual(reordered)
    expect(new Set(first).size).toBe(4)
  })

  it('rejects a run contract whose enrollment or assignment binding drifts', async () => {
    const enrollment = await loadC1E0EnrollmentManifest(REPO_ROOT)
    const contract = await loadC1E0RunContract(REPO_ROOT)
    const mutated = JSON.parse(JSON.stringify(contract)) as typeof contract
    mutated.enrollmentBinding.selectionSeed = 'different-seed'
    expect(() => assertC1E0RunContract(mutated, enrollment)).toThrow(/run contract hash mismatch/)

    const mutatedAssignment = JSON.parse(JSON.stringify(contract)) as typeof contract
    const first = mutatedAssignment.pairAssignments[0]!
    mutatedAssignment.pairAssignments[0] = {
      ...first,
      taskId: 'c1-t1-localized-distractor-v1'
    }
    expect(() => assertC1E0RunContract(mutatedAssignment, enrollment)).toThrow(
      /run contract hash mismatch/
    )
  })

  it('uses canonical object-key ordering while preserving array order', () => {
    expect(canonicalC1E0Json({ b: 1, a: [2, 3] })).toBe('{"a":[2,3],"b":1}')
    expect(canonicalC1E0Json([2, 1])).toBe('[2,1]')
  })

  it('binds the credential-free outbound request configuration', () => {
    expect(hashCanonicalC1E0(C1_E0_PROVIDER_REQUEST_CONFIG)).toBe(C1_E0_PROVIDER_CONFIG_HASH)
    expect(JSON.stringify(C1_E0_PROVIDER_REQUEST_CONFIG)).not.toMatch(/api[_-]?key|credential/i)
    expect(C1_E0_PROVIDER_REQUEST_CONFIG.request).toMatchObject({
      model: 'step-3.7-flash',
      max_tokens: 16_384,
      temperature: null,
      top_p: null,
      stream: false,
      tool_choice: null
    })
  })
})
