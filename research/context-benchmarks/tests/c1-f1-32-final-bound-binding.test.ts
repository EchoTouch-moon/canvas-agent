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
const F1_32_EXECUTION_REVISION = '0e55a36f3a2c47bef9d90611df1c75a389a9263d'
const F1_32_EXECUTION_SURFACE_HASH =
  'f5b5f10c463014d951b0983f2c01c9668cd94aa54ff63024ca247e739e28ec51'
const F1_32_BINDING_CONTROL_SURFACE_HASH =
  '8ac49f85392dd09a4637ff9d78649a86c28c0ee9d00baaa8341e64e17b198e00'

describe('C1 F1-32 final-bound binding for the authorized runner', () => {
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
      'bbb7db4fd5a5ffdfb58ca9242e456c9e48de3a2577d97bb98241647439dcc1cf'
    )
    expect(computeC1F1Native32RunContractSha256(contract)).toBe(contract['runContractSha256'])
    expect(execution['codeRevision']).toBe(F1_32_EXECUTION_REVISION)
    expect(execution['executionSurfaceHash']).toBe(F1_32_EXECUTION_SURFACE_HASH)
    expect(contract['bindingControlSurfaceHash']).toBe(F1_32_BINDING_CONTROL_SURFACE_HASH)
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
