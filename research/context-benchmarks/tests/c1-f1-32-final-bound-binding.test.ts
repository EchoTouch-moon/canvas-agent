import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertC1F1Native32BindingControlSurfaceMatchesActualInventory,
  assertC1F1Native32SurfaceWitnessMatchesActualInventory,
  computeC1F1Native32RunContractSha256,
  loadC1F1Native32Contract,
  validateC1F1Native32FinalBoundContract
} from '../c1/f1/contract/c1-f1-native-feasibility-32-contract'
import {
  buildFinalBoundF1Contract,
  computeC1F1Native32ExecutionBinding
} from '../c1/f1/runner/c1-f1-32-execution-runner'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const FINAL_BOUND_PATH = resolve(
  REPO_ROOT,
  'research/context-benchmarks/c1/f1/bindings/c1-f1-native-feasibility-32-final-bound.json'
)
const F1_32_CHECKOUT_REVISION = 'a61c34a6a67159841d4dc4d88f6fa037b66ae34e'
const F1_32_EXECUTION_SURFACE_REVISION = 'a61c34a6a67159841d4dc4d88f6fa037b66ae34e'
const F1_32_EXECUTION_SURFACE_HASH =
  'b298fb34c9dcb035a804c8165fe42aa5a4dcaef6004191f4db78f14e3f9f7be9'
const F1_32_BINDING_CONTROL_SURFACE_HASH =
  '672661b74e4a223434c19269bf2dab8f7b6e136e7b606bcb1d4532e5e3b6de07'

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
      '7ee5a88954fbf60d57447a5f2c2e1a98e64d2d875e0594ded13dad05dde4130c'
    )
    expect(computeC1F1Native32RunContractSha256(contract)).toBe(contract['runContractSha256'])
    expect(execution['checkoutRevision']).toBe(F1_32_CHECKOUT_REVISION)
    expect(execution['executionSurfaceRevision']).toBe(F1_32_EXECUTION_SURFACE_REVISION)
    expect(execution['executionSurfaceHash']).toBe(F1_32_EXECUTION_SURFACE_HASH)
    expect(contract['bindingControlSurfaceHash']).toBe(F1_32_BINDING_CONTROL_SURFACE_HASH)
    expect(contract['studyId']).toBeUndefined()
    expect((contract['identityPolicy'] as Record<string, unknown>)['studyIdStatus']).toBe(
      'NOT_CREATED'
    )

    expect(binding.checkoutRevision).not.toBe(execution['checkoutRevision'])
    expect(binding.executionSurfaceRevision).toBe(execution['executionSurfaceRevision'])
    expect(binding.executionSurfaceHash).toBe(execution['executionSurfaceHash'])
    expect(binding.bindingControlSurfaceHash).toBe(contract['bindingControlSurfaceHash'])
    expect(binding.inventory).toHaveLength(282)
    expect(binding.bindingControlInventory).toHaveLength(4)
    const candidate = await loadC1F1Native32Contract(REPO_ROOT, 'FREEZE_CANDIDATE')
    const dynamicFinalBound = buildFinalBoundF1Contract({ candidate, binding }).contract
    const dynamicExecution = dynamicFinalBound['executionBinding'] as Record<string, unknown>
    expect(dynamicExecution['checkoutRevision']).toBe(binding.checkoutRevision)
    expect(dynamicExecution['executionSurfaceRevision']).toBe(binding.executionSurfaceRevision)
    expect(dynamicFinalBound.runContractSha256).toBe(contract['runContractSha256'])
    assertC1F1Native32SurfaceWitnessMatchesActualInventory(contract, binding.inventory)
    assertC1F1Native32BindingControlSurfaceMatchesActualInventory(
      contract,
      binding.bindingControlInventory
    )
  })
})
