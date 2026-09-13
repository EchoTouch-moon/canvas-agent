import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_F0_V2_CONTRACT_RELATIVE_PATH,
  C1_F0_V2_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
  validateC1F0V2FinalBoundContract
} from '../c1/f0/contract/c1-f0-v2-contract'
import { C1_F0_V2_EXECUTION_SURFACE_PATHS } from '../c1/f0/v2/runner/c1-f0-v2-execution-runner'

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
      '609629226bc0657db7e1f4318e41a901b288af1260e01a78cd46b9b0019b3d0c'
    )
    expect(validated['executionBinding']).toMatchObject({
      codeRevision: '164a3e101238116024e1e4eb98d97ff74faeffdb',
      executionSurfaceHash: '7f540b59755231f0e3319a641f6e3139493fab04f3a3a2ffbeb015a0531e14ed'
    })
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
