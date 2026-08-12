import { resolve } from 'node:path'
import {
  applySourceObservations,
  createAvailableObservation,
  createUnavailableObservation,
  seedUniverse,
  sha256Hex
} from '@canvas-agent/context-runtime'
import { describe, expect, it } from 'vitest'
import { loadManifests } from '../src/manifest'
import {
  evaluateReplacementCanaryGate,
  REPLACEMENT_CANARY_CATEGORY,
  selectReplacementCanaryManifests
} from '../src/replacement-canary'
import type { BenchmarkRunRecord, ShadowCallEvidence } from '../src/types'

const researchRoot = resolve(import.meta.dirname, '..')
const SOURCE_KEY = 'repository/file://src/discount.js'
const CONTENT_HASH = sha256Hex('pinned discount implementation')
const T0 = '2026-08-12T00:00:00.000Z'

function unavailableUniverse() {
  const seeded = seedUniverse({
    runtimeSessionId: 'replacement-canary',
    seeds: []
  })
  const available = applySourceObservations({
    previous: seeded,
    observations: [createAvailableObservation(SOURCE_KEY, CONTENT_HASH, T0)],
    sourceDescriptors: [
      {
        sourceKey: SOURCE_KEY,
        sourceKind: 'REPOSITORY_FILE',
        provenance: 'REPOSITORY_OBSERVER'
      }
    ],
    modelCallSequence: 1
  })
  return applySourceObservations({
    previous: available,
    observations: [createUnavailableObservation(SOURCE_KEY, 'REVISION_MISMATCH', T0)],
    sourceDescriptors: [
      {
        sourceKey: SOURCE_KEY,
        sourceKind: 'REPOSITORY_FILE',
        provenance: 'REPOSITORY_OBSERVER'
      }
    ],
    modelCallSequence: 2
  })
}

function shadowCall(materializationFailures: readonly string[] = []): ShadowCallEvidence {
  const universe = unavailableUniverse()
  const admittedVersion = universe.entries[0]?.admittedVersion
  if (admittedVersion === undefined || admittedVersion === null) {
    throw new Error('replacement canary test universe missing admitted version')
  }
  return {
    sequence: 2,
    universeSequence: universe.sequence,
    universeHash: universe.logicalHash,
    workingSetId: 'working-set:replacement-canary:2',
    workingSetHash: sha256Hex('working-set'),
    planningRequestHash: sha256Hex('planning-request'),
    universe,
    planningRequest: {
      runtimeSessionId: universe.runtimeSessionId,
      recompositionSequence: 2,
      taskPhase: 'GENERAL',
      budget: { maxSemanticTokens: 8000 },
      pinnedSourceKeys: [],
      excludedSourceKeys: [],
      currentTargetSourceKeys: [],
      latestVerificationSourceKeys: [],
      recentEvidenceSourceKeys: [],
      previousWorkingSetId: null
    },
    previousWorkingSet: null,
    policyVersion: 'policy-v0',
    transitionHash: sha256Hex('transition'),
    representations: [
      {
        sourceKey: SOURCE_KEY,
        representation: {
          id: sha256Hex('representation'),
          kind: 'FULL',
          sourceVersionIds: [admittedVersion.versionId],
          contentHash: admittedVersion.contentHash,
          tokenEstimate: 8,
          lossiness: 'NONE',
          derivation: { sourceKey: SOURCE_KEY, materialization: 'FULL' }
        }
      }
    ],
    proposedSemanticTokenEstimate: 8,
    itemCount: 1,
    nativeContextEstimate: 40,
    decisions: [],
    representationCounts: { FULL: 1 },
    reasonCodeCounts: { SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP: 1 },
    materializationFailures,
    fileAccesses: [{ toolName: 'read', path: 'src/discount.js', kind: 'READ', sequence: 2 }]
  }
}

function run(
  strategy: 'NATIVE' | 'SHADOW',
  overrides: Partial<BenchmarkRunRecord> = {}
): BenchmarkRunRecord {
  return {
    runId: `replacement-${strategy.toLowerCase()}`,
    taskId: 'cr005-c1-localized-bug-fix',
    category: REPLACEMENT_CANARY_CATEGORY,
    strategy,
    repetition: 1,
    status: 'VALID',
    fixtureIdentity: {
      repositoryRevision: {
        baseCommit: 'b'.repeat(40),
        treeHash: 'c'.repeat(40),
        workingTreePatchHash: null
      },
      initialStateHash: sha256Hex('initial')
    },
    finalRepositoryRevision: null,
    finalStateHash: sha256Hex('final'),
    changedPaths: ['src/discount.js'],
    outOfScopePaths: [],
    writablePathsValid: true,
    modelProfile: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      thinkingLevel: 'medium'
    },
    semanticCallCount: 2,
    toolCallCount: 2,
    toolResultCount: 2,
    fileReadCount: strategy === 'SHADOW' ? 1 : 0,
    searchCount: 0,
    repeatedAccessCount: 0,
    wallClockMs: 100,
    abortReason: null,
    agentDeclaredSuccess: true,
    objectiveOracle: {
      passed: true,
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      durationMs: 1
    },
    regressionOracle: {
      passed: true,
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      durationMs: 1
    },
    acceptanceCriteriaResults: [
      {
        id: 'C1-1',
        description: 'objective oracle',
        check: 'OBJECTIVE_ORACLE',
        passed: true,
        evidence: 'objectiveOracle:passed=true'
      }
    ],
    acceptanceCriteriaPassed: true,
    nativeCalls:
      strategy === 'NATIVE'
        ? [
            {
              sequence: 1,
              observedMessageTokenEstimate: 40,
              categoryCounts: { USER: 1 },
              toolResultCount: 0,
              fileAccesses: []
            }
          ]
        : [],
    shadowCalls: strategy === 'SHADOW' ? [shadowCall()] : [],
    observationFailures:
      strategy === 'SHADOW'
        ? ['repository-observation:src/discount.js:observer_unavailable:REVISION_MISMATCH']
        : [],
    repositoryObservations:
      strategy === 'SHADOW'
        ? [
            {
              path: 'src/discount.js',
              status: 'UNAVAILABLE',
              reasonCode: 'REVISION_MISMATCH'
            }
          ]
        : [],
    originalMessagesUnchanged: true,
    rawProviderPayloadsCaptured: false,
    ...overrides
  }
}

describe('CR-005 replacement canary gate', () => {
  it('selects exactly the C1 manifest and rejects an ambiguous corpus', async () => {
    const manifests = await loadManifests(researchRoot)
    const selected = selectReplacementCanaryManifests(manifests)
    const selectedManifest = selected[0]
    if (selectedManifest === undefined) throw new Error('missing selected C1 manifest')
    expect(selected).toHaveLength(1)
    expect(selectedManifest.category).toBe(REPLACEMENT_CANARY_CATEGORY)
    expect(() => selectReplacementCanaryManifests([...manifests, selectedManifest])).toThrow(
      'replacement_canary_manifest_count_invalid'
    )
  })

  it('passes only the exact valid Native/Shadow pair with retained pinned evidence', () => {
    const gate = evaluateReplacementCanaryGate([run('NATIVE'), run('SHADOW')])
    expect(gate.status).toBe('PASS')
    expect(Object.values(gate.checks).every(Boolean)).toBe(true)
  })

  it('fails closed for an over-broad or duplicate-strategy run set', () => {
    const gate = evaluateReplacementCanaryGate([
      run('NATIVE'),
      run('SHADOW'),
      run('SHADOW', { runId: 'unexpected-third-run' })
    ])
    expect(gate.status).toBe('FAIL')
    expect(gate.checks.exactRecordCount).toBe(false)
    expect(gate.checks.exactStrategyPair).toBe(false)
  })

  it('fails when post-edit materialization still reports revision ambiguity', () => {
    const degradedShadow = run('SHADOW', {
      shadowCalls: [shadowCall([`${SOURCE_KEY}:REVISION_MISMATCH`])]
    })
    const gate = evaluateReplacementCanaryGate([run('NATIVE'), degradedShadow])
    expect(gate.status).toBe('FAIL')
    expect(gate.checks.revisionMismatchMaterializationAbsent).toBe(false)
  })

  it('fails when UNAVAILABLE does not preserve and rematerialize the last-known version', () => {
    const noShadowEvidence = run('SHADOW', { shadowCalls: [] })
    const gate = evaluateReplacementCanaryGate([run('NATIVE'), noShadowEvidence])
    expect(gate.status).toBe('FAIL')
    expect(gate.checks.lastKnownVersionPreserved).toBe(false)
    expect(gate.checks.pinnedRepresentationRecovered).toBe(false)
  })

  it('binds retained-version proof to the exact UNAVAILABLE repository path', () => {
    const mismatchedObservation = run('SHADOW', {
      repositoryObservations: [
        {
          path: 'src/unrelated.js',
          status: 'UNAVAILABLE',
          reasonCode: 'REVISION_MISMATCH'
        }
      ]
    })
    const gate = evaluateReplacementCanaryGate([run('NATIVE'), mismatchedObservation])
    expect(gate.status).toBe('FAIL')
    expect(gate.checks.lastKnownVersionPreserved).toBe(false)
    expect(gate.checks.pinnedRepresentationRecovered).toBe(false)
  })

  it('fails if retained evidence contains a credential value or machine path', () => {
    const credential = 'replacement-canary-secret-value'
    const unsafeShadow = run('SHADOW', {
      abortReason: credential,
      observationFailures: ['/private/tmp/canvas-fixture/src/discount.js']
    })
    const gate = evaluateReplacementCanaryGate([run('NATIVE'), unsafeShadow], credential)
    expect(gate.status).toBe('FAIL')
    expect(gate.checks.credentialValueAbsent).toBe(false)
    expect(gate.checks.retainedEvidenceSanitized).toBe(false)
  })

  it('fails when retained evidence contains credential-shaped text', () => {
    const unsafeShadow = run('SHADOW', {
      observationFailures: ['transport:Bearer secret-token-value-12345']
    })
    const gate = evaluateReplacementCanaryGate([run('NATIVE'), unsafeShadow])
    expect(gate.status).toBe('FAIL')
    expect(gate.checks.secretPatternsAbsent).toBe(false)
  })

  it('rejects Windows absolute paths without confusing repository/file source keys', () => {
    const safe = evaluateReplacementCanaryGate([run('NATIVE'), run('SHADOW')])
    expect(safe.checks.retainedEvidenceSanitized).toBe(true)

    const unsafeShadow = run('SHADOW', {
      observationFailures: ['repository-observation:C:\\fixture\\src\\discount.js']
    })
    const unsafe = evaluateReplacementCanaryGate([run('NATIVE'), unsafeShadow])
    expect(unsafe.checks.retainedEvidenceSanitized).toBe(false)
  })
})
