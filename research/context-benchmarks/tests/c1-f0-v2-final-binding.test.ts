import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_F0_V2_CONTRACT_RELATIVE_PATH,
  C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
  validateC1F0V2FinalBoundContract
} from '../c1/f0/contract/c1-f0-v2-contract'
import {
  C1_F0_V2_EXECUTION_SURFACE_PATHS,
  computeC1F0V2ExecutionBinding
} from '../c1/f0/v2/runner/c1-f0-v2-execution-runner'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const FINAL_CONTRACT_PATH = resolve(
  REPO_ROOT,
  'research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v2-final-bound.json'
)

describe('C1 F0-v2 final-bound contract candidate', () => {
  it('validates the final binding against the frozen candidate semantics', async () => {
    const finalBound = JSON.parse(await readFile(FINAL_CONTRACT_PATH, 'utf8')) as Record<
      string,
      unknown
    >
    const validated = validateC1F0V2FinalBoundContract(finalBound)
    expect(validated['runContractHashRole']).toBe('FINAL_BOUND')
    expect(validated['freezeCandidateRunContractSha256']).toBe(
      C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256
    )
    expect(validated['runContractSha256']).toBe(
      '4120e8d4c5c029ce224fb1341989cdc208d96799f1c399e736ee77aa36ea0611'
    )
    expect(validated['executionBinding']).toMatchObject({
      codeRevision: '6d0189a998772e8d9e379f8ec56bc7f429546a2a',
      executionSurfaceHash: '583f6c974c207eb3e338b89aa345ab1aadd894fb25d83455b06ee59af13fbe0a'
    })
    const computedBinding = await computeC1F0V2ExecutionBinding(REPO_ROOT)
    const executionBinding = validated['executionBinding'] as Record<string, unknown>
    expect(computedBinding.executionRevision).toBe(executionBinding['codeRevision'])
    expect(computedBinding.executionSurfaceHash).toBe(executionBinding['executionSurfaceHash'])
    expect(validated['identityPolicy']).toMatchObject({
      studyIdStatus: 'NOT_CREATED',
      retry: 'FORBIDDEN',
      resume: 'FORBIDDEN',
      reuse: 'FORBIDDEN'
    })
  })

  it('keeps candidate and final contract data outside the runner execution surface', async () => {
    const candidate = JSON.parse(
      await readFile(resolve(REPO_ROOT, C1_F0_V2_CONTRACT_RELATIVE_PATH), 'utf8')
    ) as Record<string, unknown>
    expect(candidate['runContractSha256']).toBe(C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256)
    expect(FINAL_CONTRACT_PATH).toContain('/c1/f0/contracts/')
    expect(C1_F0_V2_EXECUTION_SURFACE_PATHS).not.toContain(
      'research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v2-final-bound.json'
    )
  })
})
