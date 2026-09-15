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
const F1_32_EXECUTION_REVISION = 'f3c799247aaf80f5fc3794d7ca5b09e5bcad4ef2'
const F1_32_EXECUTION_SURFACE_HASH =
  '8a41669a3b7266b3d396db2b9cbb156003f2e85a9ec4892288edd61572ec1d3f'
const F1_32_BINDING_CONTROL_SURFACE_HASH =
  'ab04d899781c4673ae35b3b10f8025bcd32d2d4c00182ab6bc6b4f0c0c697609'

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
      'd20fd0f7a231a6d3a810018e9a180545d49730629873ed7c4a3e78f978dffbc8'
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
