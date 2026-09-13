import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_F0_V2_MAX_UNKNOWN_RUN_RATE,
  C1_F0_V2_MIN_ADJUDICABLE_RUNS_PER_TASK,
  C1_F0_V2_PENDING_BINDING,
  C1_F0_V2_PROVIDER_CONFIG_HASH,
  C1_F0_V2_CONTRACT_RELATIVE_PATH,
  computeC1F0V2RunContractSha256,
  loadC1F0V2Contract,
  validateC1F0V2Contract
} from '../c1/f0/contract/c1-f0-v2-contract'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('C1 F0-v2 contract freeze candidate', () => {
  it('loads the self-hashed contract without creating an identity or binding execution', async () => {
    const contract = await loadC1F0V2Contract(REPO_ROOT)
    expect(contract.contractId).toBe('C1_F0_EXECUTION_FEASIBILITY_V2')
    expect(contract.schemaVersion).toBe(2)
    expect(contract.status).toBe('FREEZE_REVIEW')
    expect(contract['runContractHashRole']).toBe('FREEZE_CANDIDATE')
    expect(contract['executionBinding']).toMatchObject({
      codeRevision: C1_F0_V2_PENDING_BINDING,
      executionSurfaceHash: C1_F0_V2_PENDING_BINDING,
      providerConfigHash: C1_F0_V2_PROVIDER_CONFIG_HASH
    })
    expect(contract['identityPolicy']).toMatchObject({
      studyIdStatus: 'NOT_CREATED',
      retry: 'FORBIDDEN',
      resume: 'FORBIDDEN',
      reuse: 'FORBIDDEN'
    })
    expect(contract['gates']).toMatchObject({
      precision: {
        maxUnknownRunRate: C1_F0_V2_MAX_UNKNOWN_RUN_RATE,
        minAdjudicableRunsPerTask: C1_F0_V2_MIN_ADJUDICABLE_RUNS_PER_TASK,
        unknownIsNotFailure: true
      }
    })
    expect(contract).not.toHaveProperty('studyId')
  })

  it('uses canonical object ordering for the contract hash', async () => {
    const raw = JSON.parse(
      await readFile(resolve(REPO_ROOT, C1_F0_V2_CONTRACT_RELATIVE_PATH), 'utf8')
    ) as Record<string, unknown>
    const reordered = Object.fromEntries(Object.entries(raw).reverse())
    expect(computeC1F0V2RunContractSha256(reordered)).toBe(raw['runContractSha256'])
  })

  it('fails closed when freeze fields are tampered', async () => {
    const raw = JSON.parse(
      await readFile(resolve(REPO_ROOT, C1_F0_V2_CONTRACT_RELATIVE_PATH), 'utf8')
    ) as Record<string, unknown>
    const gates = raw['gates'] as Record<string, unknown>
    const precision = gates['precision'] as Record<string, unknown>
    expect(() =>
      validateC1F0V2Contract({
        ...raw,
        gates: {
          ...gates,
          precision: {
            ...precision,
            minAdjudicableRunsPerTask: 13
          }
        }
      })
    ).toThrow(/runContractSha256/)
  })

  it('rejects writable-scope drift even when the attacker recomputes the self hash', async () => {
    const raw = JSON.parse(
      await readFile(resolve(REPO_ROOT, C1_F0_V2_CONTRACT_RELATIVE_PATH), 'utf8')
    ) as Record<string, unknown>
    const taskPanel = JSON.parse(JSON.stringify(raw['taskPanel'])) as Array<Record<string, unknown>>
    const firstTask = taskPanel[0]
    if (firstTask === undefined) throw new Error('missing first task')
    firstTask['expectedWritablePaths'] = ['src/other.js']
    const mutated = { ...raw, taskPanel }
    const rehashed = {
      ...mutated,
      runContractSha256: computeC1F0V2RunContractSha256(mutated)
    }
    expect(() => validateC1F0V2Contract(rehashed)).toThrow(
      'SEMANTIC_FREEZE_MISMATCH: taskPanel.0.expectedWritablePaths'
    )
  })

  it('rejects prompt or fixture identity drift after a valid self-hash recomputation', async () => {
    const raw = JSON.parse(
      await readFile(resolve(REPO_ROOT, C1_F0_V2_CONTRACT_RELATIVE_PATH), 'utf8')
    ) as Record<string, unknown>
    const taskPanel = JSON.parse(JSON.stringify(raw['taskPanel'])) as Array<Record<string, unknown>>
    const firstTask = taskPanel[0]
    if (firstTask === undefined) throw new Error('missing first task')
    firstTask['promptSha256'] = '0'.repeat(64)
    const mutated = { ...raw, taskPanel }
    const rehashed = {
      ...mutated,
      runContractSha256: computeC1F0V2RunContractSha256(mutated)
    }
    expect(() => validateC1F0V2Contract(rehashed)).toThrow(
      'SEMANTIC_FREEZE_MISMATCH: taskPanel.0.promptSha256'
    )
  })
})
