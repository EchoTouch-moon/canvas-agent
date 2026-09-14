import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_F1_NATIVE32_CONTRACT_RELATIVE_PATH,
  C1_F1_NATIVE32_FREEZE_CANDIDATE_RUN_CONTRACT_SHA256,
  C1_F1_NATIVE32_HISTORICAL_ANCHOR,
  C1_F1_NATIVE32_PENDING_BINDING,
  assertC1F1Native32SurfaceWitnessMatchesActualInventory,
  computeC1F1Native32SurfaceInventoryHash,
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

function buildFinalBoundContract(candidate: Record<string, unknown>): Record<string, unknown> {
  const finalBound = JSON.parse(JSON.stringify(candidate)) as Record<string, unknown>
  finalBound['status'] = 'FROZEN'
  finalBound['designStatus'] = 'FINAL_BOUND'
  finalBound['runContractHashRole'] = 'FINAL_BOUND'
  finalBound['freezeCandidateRunContractSha256'] = candidate['runContractSha256']
  finalBound['finalBoundRunContractSha256'] = 'PENDING_F1_32_FINAL_HASH'

  const execution = finalBound['executionBinding'] as Record<string, unknown>
  execution['codeRevision'] = 'a'.repeat(40)
  execution['executionSurfaceHash'] = 'PENDING_F1_32_SURFACE_HASH'

  const witness = finalBound['surfaceEquivalenceWitness'] as Record<string, unknown>
  const anchorInventory = witness['anchorSurfaceInventory'] as Array<{
    path: string
    sha256: string
  }>
  const anchorPaths = anchorInventory.map((entry) => entry.path)
  const targetOnlyPath = 'research/context-benchmarks/c1/f1/runner/c1-f1-32-budget-projection.ts'
  witness['phase'] = 'FINAL_BOUND'
  witness['targetSurfacePaths'] = [...anchorPaths, targetOnlyPath]
  witness['entries'] = [
    ...anchorInventory.map((entry) => ({
      path: entry.path,
      anchorPath: entry.path,
      anchorHash: entry.sha256,
      targetHash: entry.sha256,
      classification: 'EXACT_UNCHANGED'
    })),
    {
      path: targetOnlyPath,
      anchorPath: null,
      anchorHash: null,
      targetHash: 'd'.repeat(64),
      classification: 'BUDGET_ONLY_PROJECTION'
    }
  ]
  const targetInventoryDigest = computeC1F1Native32SurfaceInventoryHash(
    (witness['entries'] as Array<Record<string, unknown>>).map((entry) => ({
      path: entry['path'] as string,
      sha256: entry['targetHash'] as string
    }))
  )
  execution['executionSurfaceHash'] = targetInventoryDigest
  witness['targetExecutionBinding'] = {
    codeRevision: execution['codeRevision'],
    executionSurfaceHash: execution['executionSurfaceHash']
  }
  witness['targetInventoryDigest'] = targetInventoryDigest
  witness['witnessStatus'] = 'COMPLETE'

  const finalHash = computeC1F1Native32RunContractSha256(finalBound)
  finalBound['runContractSha256'] = finalHash
  finalBound['finalBoundRunContractSha256'] = finalHash
  return finalBound
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
    expect(contract['historicalAnchor']).toEqual(C1_F1_NATIVE32_HISTORICAL_ANCHOR)
    const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
    expect(
      computeC1F1Native32SurfaceInventoryHash(
        witness['anchorSurfaceInventory'] as Array<{ path: string; sha256: string }>
      )
    ).toBe(C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionSurfaceHash)
    expect(contract['surfaceEquivalenceWitness']).toMatchObject({
      phase: 'PRE_BINDING',
      anchorExecutionRevision: C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionRevision,
      anchorExecutionSurfaceHash: C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionSurfaceHash,
      allowedClassifications: ['EXACT_UNCHANGED', 'BUDGET_ONLY_PROJECTION'],
      witnessStatus: 'PENDING_IMPLEMENTATION'
    })
    expect(contract['surfaceEquivalenceWitness']).toMatchObject({
      anchorInventoryDigest: C1_F1_NATIVE32_HISTORICAL_ANCHOR.executionSurfaceHash,
      hashing: {
        perPathHash: 'SHA256_RAW_FILE_BYTES',
        inventoryHash: 'SHA256_UTF8_CANONICAL_ROWS_V1',
        rowFormat: '<lowercase_sha256>  <posix_repo_relative_path><LF>',
        pathNormalization: 'REPO_RELATIVE_POSIX',
        pathOrdering: 'LEXICOGRAPHIC_CODE_UNIT',
        directoryExpansion: 'RECURSIVE_GIT_TRACKED_FILES_AT_REVISION',
        emptyDirectory: 'FORBIDDEN'
      }
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
    },
    {
      name: 'anchor per-path hash drift',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        const inventory = witness['anchorSurfaceInventory'] as Array<Record<string, unknown>>
        const firstEntry = inventory[0]
        if (firstEntry === undefined) throw new Error('missing anchor inventory entry')
        firstEntry['sha256'] = '0'.repeat(64)
      },
      expectedPath: 'surfaceEquivalenceWitness.anchorSurfaceInventory.0.sha256'
    },
    {
      name: 'hashing algorithm drift',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        const hashing = witness['hashing'] as Record<string, unknown>
        hashing['pathOrdering'] = 'GIT_TREE_ORDER'
      },
      expectedPath: 'surfaceEquivalenceWitness.hashing.pathOrdering'
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

  it('accepts a final-bound shape with complete per-path witness evidence', async () => {
    const finalBound = buildFinalBoundContract(await readContract())
    const validated = validateC1F1Native32FinalBoundContract(finalBound)
    expect(validated['runContractHashRole']).toBe('FINAL_BOUND')
    expect(validated['runContractSha256']).toBe(finalBound['runContractSha256'])
    expect(
      (validated['surfaceEquivalenceWitness'] as Record<string, unknown>)['witnessStatus']
    ).toBe('COMPLETE')
  })

  it('joins final witness paths to an actual executable-surface inventory', async () => {
    const finalBound = buildFinalBoundContract(await readContract())
    const witness = finalBound['surfaceEquivalenceWitness'] as Record<string, unknown>
    const witnessEntries = witness['entries'] as Array<Record<string, unknown>>
    const actualInventory = witnessEntries.map((entry) => ({
      path: entry['path'] as string,
      sha256: entry['targetHash'] as string
    }))
    expect(() =>
      assertC1F1Native32SurfaceWitnessMatchesActualInventory(finalBound, actualInventory)
    ).not.toThrow()

    const actualPaths = actualInventory.map((entry) => entry.path)
    expect(() =>
      assertC1F1Native32SurfaceWitnessMatchesActualInventory(finalBound, [
        ...actualInventory,
        {
          path: 'research/context-benchmarks/c1/f1/runner/unknown.ts',
          sha256: 'e'.repeat(64)
        }
      ])
    ).toThrow('surfaceEquivalenceWitness targetSurfacePaths do not match actual execution surface')

    const mismatchedHashInventory = actualInventory.map((entry, index) =>
      index === 0 ? { ...entry, sha256: 'f'.repeat(64) } : entry
    )
    expect(() =>
      assertC1F1Native32SurfaceWitnessMatchesActualInventory(finalBound, mismatchedHashInventory)
    ).toThrow('surfaceEquivalenceWitness.entries.' + actualPaths[0] + '.targetHash')
  })

  it.each([
    {
      name: 'pending witness',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        witness['phase'] = 'PRE_BINDING'
      },
      expected: 'surfaceEquivalenceWitness.phase'
    },
    {
      name: 'binding mismatch',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        const target = witness['targetExecutionBinding'] as Record<string, unknown>
        target['codeRevision'] = 'e'.repeat(40)
      },
      expected: 'surfaceEquivalenceWitness.targetExecutionBinding.codeRevision'
    },
    {
      name: 'anchor hash mismatch',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        const entries = witness['entries'] as Array<Record<string, unknown>>
        const firstEntry = entries[0]
        if (firstEntry === undefined) throw new Error('missing witness entry')
        firstEntry['anchorHash'] = 'e'.repeat(64)
      },
      expected: 'surfaceEquivalenceWitness.entries[0].anchorHash'
    },
    {
      name: 'target aggregate hash mismatch',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        witness['targetInventoryDigest'] = '0'.repeat(64)
      },
      expected: 'surfaceEquivalenceWitness.targetInventoryDigest'
    },
    {
      name: 'missing anchor path',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        const missingAnchorPath = 'research/context-benchmarks/c1/f1/runner/missing-anchor.ts'
        const targetPaths = witness['targetSurfacePaths'] as string[]
        const entries = witness['entries'] as Array<Record<string, unknown>>
        targetPaths[0] = missingAnchorPath
        entries[0] = {
          path: missingAnchorPath,
          anchorPath: null,
          anchorHash: null,
          targetHash: 'd'.repeat(64),
          classification: 'BUDGET_ONLY_PROJECTION'
        }
      },
      expected: 'surfaceEquivalenceWitness.entries must account for every anchor surface path'
    },
    {
      name: 'other change classification',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        const entries = witness['entries'] as Array<Record<string, unknown>>
        const firstEntry = entries[0]
        if (firstEntry === undefined) throw new Error('missing witness entry')
        firstEntry['classification'] = 'OTHER_CHANGE'
      },
      expected: 'surfaceEquivalenceWitness.entries[0].classification'
    },
    {
      name: 'exact unchanged path drift',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        const targetPath = 'research/context-benchmarks/c1/f1/runner/renamed.ts'
        const targetPaths = witness['targetSurfacePaths'] as string[]
        const entries = witness['entries'] as Array<Record<string, unknown>>
        targetPaths[0] = targetPath
        const firstEntry = entries[0]
        if (firstEntry === undefined) throw new Error('missing witness entry')
        firstEntry['path'] = targetPath
      },
      expected: 'surfaceEquivalenceWitness.entries[0].path must equal anchorPath'
    },
    {
      name: 'unresolved classification',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        const entries = witness['entries'] as Array<Record<string, unknown>>
        const firstEntry = entries[0]
        if (firstEntry === undefined) throw new Error('missing witness entry')
        firstEntry['classification'] = 'UNRESOLVED_PATH'
      },
      expected: 'surfaceEquivalenceWitness.entries[0].classification'
    },
    {
      name: 'unaccounted target path',
      mutate: (contract: Record<string, unknown>) => {
        const witness = contract['surfaceEquivalenceWitness'] as Record<string, unknown>
        ;(witness['targetSurfacePaths'] as string[]).push(
          'research/context-benchmarks/c1/f1/runner/unaccounted.ts'
        )
      },
      expected:
        'surfaceEquivalenceWitness.entries must account for every target execution-surface path'
    }
  ])('rejects final-bound $name', async ({ mutate, expected }) => {
    const finalBound = buildFinalBoundContract(await readContract())
    mutate(finalBound)
    finalBound['runContractSha256'] = computeC1F1Native32RunContractSha256(finalBound)
    finalBound['finalBoundRunContractSha256'] = finalBound['runContractSha256']
    expect(() => validateC1F1Native32FinalBoundContract(finalBound)).toThrow(expected)
  })

  it('does not classify the F1 identity namespace as an exact unchanged surface domain', async () => {
    const candidate = await readContract()
    const witness = candidate['surfaceEquivalenceWitness'] as Record<string, unknown>
    witness['exactUnchangedDomains'] = [
      ...(witness['exactUnchangedDomains'] as string[]),
      'identityPolicy'
    ]
    candidate['runContractSha256'] = computeC1F1Native32RunContractSha256(candidate)
    expect(() => validateC1F1Native32Contract(candidate)).toThrow(
      'SEMANTIC_FREEZE_MISMATCH: surfaceEquivalenceWitness.exactUnchangedDomains'
    )
  })
})
