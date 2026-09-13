import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_F1_NATIVE32_CONTRACT_RELATIVE_PATH,
  C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
  C1_F1_NATIVE32_HISTORICAL_ANCHOR,
  C1_F1_NATIVE32_PENDING_BINDING,
  computeC1F1Native32RunContractSha256,
  loadC1F1Native32Contract,
  validateC1F1Native32Contract,
  validateC1F1Native32FinalBoundContract
} from '../c1/f1/contract/c1-f1-native-feasibility-32-contract'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const CONTRACT_PATH = resolve(REPO_ROOT, C1_F1_NATIVE32_CONTRACT_RELATIVE_PATH)

async function readContract(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(CONTRACT_PATH, 'utf8')) as Record<string, unknown>
}

describe('C1 F1 native feasibility 32-call point contract', () => {
  it('loads a 32-call candidate without creating an identity or enabling Runtime', async () => {
    const contract = await loadC1F1Native32Contract(REPO_ROOT)
    expect(contract.contractId).toBe('C1_F1_NATIVE_FEASIBILITY_32')
    expect(contract.schemaVersion).toBe(1)
    expect(contract.status).toBe('FREEZE_REVIEW')
    expect(contract.designStatus).toBe('READY_FOR_CONTRACT_FREEZE_REVIEW')
    expect(contract.runContractHashRole).toBe('FREEZE_CANDIDATE')
    expect(contract.runContractSha256).toBe(C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256)
    expect(contract['executionBinding']).toMatchObject({
      codeRevision: C1_F1_NATIVE32_PENDING_BINDING,
      executionSurfaceHash: C1_F1_NATIVE32_PENDING_BINDING,
      providerConfigHash: 'bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a'
    })
    expect(contract['budgets']).toMatchObject({
      perRun: { maxProviderRequests: 32 },
      study: {
        maxProviderRequests: 1024,
        providerBudgetDerivation: 'totalRuns × perRun.maxProviderRequests'
      }
    })
    expect(contract['frontier']).toMatchObject({
      pointBudget: 32,
      historicalAnchorBudget: 24,
      continuationPolicy: {
        allowedNextBudgets: [40, 48],
        requires: 'FRONTIER_DRIVING_GATE=PASS'
      }
    })
    expect(contract['identityPolicy']).toMatchObject({
      studyIdStatus: 'NOT_CREATED',
      retry: 'FORBIDDEN',
      resume: 'FORBIDDEN',
      reuse: 'FORBIDDEN',
      reservedPointIdentities: []
    })
    expect(contract).not.toHaveProperty('studyId')
    expect(contract['executionBinding']).toMatchObject({ runtimeIntervention: 'DISABLED' })
  })

  it('keeps the consumed F0-v2 study as a descriptive historical anchor', async () => {
    const contract = await loadC1F1Native32Contract(REPO_ROOT)
    expect(contract['studyRelation']).toEqual({
      priorContractId: C1_F1_NATIVE32_HISTORICAL_ANCHOR.contractId,
      priorStudyId: C1_F1_NATIVE32_HISTORICAL_ANCHOR.studyId,
      priorArtifactPolicy: 'IMMUTABLE_CONSUMED_NO_RESUME_RETRY_REUSE_REBIND',
      comparisonPolicy: 'DESCRIPTIVE_F0_V2_ANCHOR_ONLY_NOT_POOLED'
    })
    expect(contract['surfaceEquivalenceWitness']).toMatchObject({
      anchorExecutionRevision: C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionRevision,
      anchorExecutionSurfaceHash: C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionSurfaceHash,
      allowedClassifications: ['EXACT_UNCHANGED', 'BUDGET_ONLY_PROJECTION'],
      witnessStatus: 'REQUIRED_BEFORE_EXECUTION'
    })
  })

  it('derives the study Provider ceiling from the 32-run shape', async () => {
    const raw = await readContract()
    const budgets = raw['budgets'] as Record<string, unknown>
    const perRun = budgets['perRun'] as Record<string, unknown>
    const study = budgets['study'] as Record<string, unknown>
    expect(study['maxProviderRequests']).toBe(
      ((raw['design'] as Record<string, unknown>)['totalRuns'] as number) *
        (perRun['maxProviderRequests'] as number)
    )
    expect(study['maxProviderRequests']).toBe(1024)
  })

  it.each([
    {
      name: 'study ceiling drift',
      mutate: (contract: Record<string, unknown>) => {
        const budgets = contract['budgets'] as Record<string, unknown>
        const study = budgets['study'] as Record<string, unknown>
        study['maxProviderRequests'] = 768
      },
      expectedPath: 'budgets.study.maxProviderRequests'
    },
    {
      name: 'outcome semantics drift',
      mutate: (contract: Record<string, unknown>) => {
        const outcomes = contract['outcomes'] as Record<string, unknown>
        const unknownRules = [...(outcomes['feasibilityUnknown'] as string[])]
        unknownRules[0] = 'unknown-is-a-failure'
        outcomes['feasibilityUnknown'] = unknownRules
      },
      expectedPath: 'outcomes.feasibilityUnknown.0'
    },
    {
      name: 'surface witness drift',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        witness['allowedClassifications'] = ['EXACT_UNCHANGED']
      },
      expectedPath: 'surfaceEquivalenceWitness.allowedClassifications'
    }
  ])(
    'fails closed on $name after a valid self-hash recomputation',
    async ({ mutate, expectedPath }) => {
      const mutated = await readContract()
      mutate(mutated)
      const rehashed = {
        ...mutated,
        runContractSha256: computeC1F1Native32RunContractSha256(mutated)
      }
      expect(() => validateC1F1Native32Contract(rehashed)).toThrow(
        'SEMANTIC_FREEZE_MISMATCH: ' + expectedPath
      )
    }
  )

  it('accepts a final-bound shape only when candidate semantics remain unchanged', async () => {
    const candidate = await readContract()
    const finalBound = JSON.parse(JSON.stringify(candidate)) as Record<string, unknown>
    finalBound['status'] = 'FROZEN'
    finalBound['designStatus'] = 'FINAL_BOUND'
    finalBound['runContractHashRole'] = 'FINAL_BOUND'
    finalBound['freezeCandidateRunContractSha256'] = candidate['runContractSha256']
    finalBound['finalBoundRunContractSha256'] = 'PENDING_F1_32_FINAL_HASH'
    const execution = finalBound['executionBinding'] as Record<string, unknown>
    execution['codeRevision'] = 'a'.repeat(40)
    execution['executionSurfaceHash'] = 'b'.repeat(64)
    const finalHash = computeC1F1Native32RunContractSha256(finalBound)
    finalBound['runContractSha256'] = finalHash
    finalBound['finalBoundRunContractSha256'] = finalHash

    const validated = validateC1F1Native32FinalBoundContract(finalBound)
    expect(validated['runContractHashRole']).toBe('FINAL_BOUND')
    expect(validated['runContractSha256']).toBe(finalHash)
  })
})
