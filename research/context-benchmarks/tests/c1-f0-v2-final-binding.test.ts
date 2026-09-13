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
      '5fd83c5b7651551541025f09752350c77aa86843e3138c643b07f786e7229677'
    )
    expect(validated['executionBinding']).toMatchObject({
      codeRevision: '4218be167ea6f1f10434fd01d498cdf06e6156bc',
      executionSurfaceHash: 'f8ef241c343fdd7341a3572caf780f7cc447906f58ea80fe886749cac4028731'
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
