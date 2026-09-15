import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertC1F1Native32BindingControlSurfaceMatchesActualInventory,
  assertC1F1Native32SurfaceWitnessMatchesActualInventory,
  computeC1F1Native32RunContractSha256,
  validateC1F1Native32FinalBoundContract
} from '../c1/f1/contract/c1-f1-native-feasibility-32-contract'
import { computeC1F1Native32ExecutionBinding } from '../c1/f1/runner/c1-f1-32-execution-runner'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const FINAL_BOUND_PATH = resolve(
  REPO_ROOT,
  'research/context-benchmarks/c1/f1/bindings/c1-f1-native-feasibility-32-final-bound.json'
)
const STABLE_MAIN_REVISION = '51a409cb61ebb917b6584aaac1e746d123e7f6a0'

describe('C1 F1-32 final-bound binding on stable main', () => {
  it('validates the published tuple against the actual execution and control inventories', async () => {
    const parsed = JSON.parse(await readFile(FINAL_BOUND_PATH, 'utf8')) as Record<string, unknown>
    const contract = validateC1F1Native32FinalBoundContract(parsed)
    const binding = await computeC1F1Native32ExecutionBinding(REPO_ROOT)
    const execution = contract['executionBinding'] as Record<string, unknown>

    expect(contract['status']).toBe('FROZEN')
    expect(contract['designStatus']).toBe('FINAL_BOUND')
    expect(contract['runContractHashRole']).toBe('FINAL_BOUND')
    expect(contract['freezeCandidateRunContractSha256']).toBe(
      '053fa42d540e3955b8228303036191ffd985292ddd9665d87397b232570885da'
    )
    expect(contract['runContractSha256']).toBe(
      'c4725887cac211a7d17a930e1349f93d9e9c6510a3db1257bd30402a129938a8'
    )
    expect(computeC1F1Native32RunContractSha256(contract)).toBe(contract['runContractSha256'])
    expect(execution['codeRevision']).toBe(STABLE_MAIN_REVISION)
    expect(contract['studyId']).toBeUndefined()
    expect((contract['identityPolicy'] as Record<string, unknown>)['studyIdStatus']).toBe(
      'NOT_CREATED'
    )

    expect(binding.executionSurfaceHash).toBe(execution['executionSurfaceHash'])
    expect(binding.bindingControlSurfaceHash).toBe(contract['bindingControlSurfaceHash'])
    expect(binding.inventory).toHaveLength(282)
    expect(binding.bindingControlInventory).toHaveLength(4)
    assertC1F1Native32SurfaceWitnessMatchesActualInventory(contract, binding.inventory)
    assertC1F1Native32BindingControlSurfaceMatchesActualInventory(
      contract,
      binding.bindingControlInventory
    )
  })
})
