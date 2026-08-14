import { describe, expect, it } from 'vitest'
import {
  admitWorkingSet,
  applyWorkingSetTransition,
  commitAdmission,
  computeWorkingSetTransition,
  createEmptyUniverseRevision,
  createRepresentation,
  deserializeAdmissionReceipt,
  deserializeCommittedWorkingSet,
  deserializeProposedWorkingSet,
  deserializeUniverseRevision,
  deserializeWorkingSetTransition,
  planProposedWorkingSet,
  reconcileUniverseRevision,
  serializeAdmissionReceipt,
  serializeCommittedWorkingSet,
  serializeProposedWorkingSet,
  serializeUniverseRevision,
  serializeWorkingSetTransition,
  type AdmissionAdapter,
  type ContextRepresentation,
  type ProposedWorkingSet,
  type UniverseObservation,
  type UniverseRevision
} from '../src'
import { CONTEXT_RUNTIME_CORPUS } from '../corpus/cases'

function present(
  sourceId: string,
  contentHash: string,
  observedAt: number,
  providerVersion?: string
): UniverseObservation {
  return {
    sourceId,
    observationState: 'PRESENT',
    contentHash,
    observedAt,
    ...(providerVersion !== undefined ? { providerVersion } : {})
  }
}

function unavailable(sourceId: string, observedAt: number): UniverseObservation {
  return { sourceId, observationState: 'UNAVAILABLE', reason: 'fixture-down', observedAt }
}

function absent(sourceId: string, observedAt: number): UniverseObservation {
  return { sourceId, observationState: 'ABSENT', observedAt }
}

function representationFor(entry: Parameters<NonNullable<Parameters<typeof planProposedWorkingSet>[0]['policy']['represent']>>[0], version: Parameters<NonNullable<Parameters<typeof planProposedWorkingSet>[0]['policy']['represent']>>[1], tokenEstimate = 2): ContextRepresentation {
  return createRepresentation({
    kind: 'FULL',
    sourceVersionIds: [version.versionId],
    contentHash: `representation:${entry.sourceId}:${version.contentHash}`,
    tokenEstimate,
    lossiness: 'NONE',
    derivation: { sourceId: entry.sourceId },
    content: `${entry.sourceId}@${version.contentHash}`
  })
}

function fixtureAdapter(): AdmissionAdapter {
  return {
    adapterId: 'fixture-adapter',
    adapterVersion: '1',
    materialize: ({ proposalEntry }) => {
      if (proposalEntry.sourceId === 'B') {
        return createRepresentation({
          kind: 'SUMMARY',
          sourceVersionIds: [proposalEntry.sourceVersionId],
          contentHash: `summary:${proposalEntry.sourceVersionId}`,
          tokenEstimate: 1,
          lossiness: 'LOSSY',
          derivation: { kind: 'fixture-summary' },
          content: `summary:${proposalEntry.sourceId}`
        })
      }
      return proposalEntry.representation
    },
    render: (representations) =>
      representations.map((representation) => `${representation.kind}:${representation.contentHash}`).join('\n')
  }
}

function fullAdapter(): AdmissionAdapter {
  return {
    adapterId: 'fixture-full-adapter',
    adapterVersion: '1',
    render: (representations) =>
      representations.map((representation) => `${representation.kind}:${representation.contentHash}`).join('\n')
  }
}

function fixtureUniverse(sourceIds: readonly string[], observedAt = 1): UniverseRevision {
  let universe = createEmptyUniverseRevision(0)
  universe = reconcileUniverseRevision(
    universe,
    sourceIds.map((sourceId) => present(sourceId, `hash-${sourceId}`, observedAt, 'provider-1'))
  )
  return universe
}

function fixtureProposal(
  universe: UniverseRevision,
  previousCommittedWorkingSet: Parameters<typeof planProposedWorkingSet>[0]['previousCommittedWorkingSet'] = null,
  budget = 100
): ProposedWorkingSet {
  return planProposedWorkingSet({
    universe,
    previousCommittedWorkingSet,
    policy: {
      version: 'deterministic-v0',
      budget: { maxSemanticTokens: budget },
      represent: (entry, version) => representationFor(entry, version)
    },
    taskHints: {
      mandatorySourceIds: ['A'],
      referencedSourceIds: ['B'],
      dependencySourceIds: ['C']
    },
    createdAt: universe.createdAt
  })
}

describe('Context Runtime core contract', () => {
  it('keeps the eight-case corpus provider-free and stable', () => {
    expect(CONTEXT_RUNTIME_CORPUS.map((testCase) => testCase.id)).toEqual([
      'C1',
      'C2',
      'C3',
      'C4',
      'C5',
      'C6',
      'C7',
      'C8'
    ])
    expect(CONTEXT_RUNTIME_CORPUS.every((testCase) => testCase.providerCalls === 0)).toBe(true)
  })

  it('reconciles PRESENT/NO_CHANGE/UPDATE/UNAVAILABLE/RECOVER/ABSENT and preserves last-good', () => {
    let universe = createEmptyUniverseRevision(0)
    universe = reconcileUniverseRevision(universe, [present('A', 'v1', 1, 'provider-1')])
    const v1 = universe.entries.get('A')?.admittedVersionId
    expect(universe.entries.get('A')?.observationState).toBe('PRESENT')
    expect(v1).not.toBeNull()

    universe = reconcileUniverseRevision(universe, [present('A', 'v1', 2, 'provider-1')])
    expect(universe.reconciliationEvents[0]?.action).toBe('NO_CHANGE')
    expect(universe.entries.get('A')?.admittedVersionId).toBe(v1)

    universe = reconcileUniverseRevision(universe, [present('A', 'v2', 3, 'provider-2')])
    const v2 = universe.entries.get('A')?.admittedVersionId
    expect(universe.reconciliationEvents[0]?.action).toBe('UPDATE')
    expect(v2).not.toBe(v1)

    universe = reconcileUniverseRevision(universe, [unavailable('A', 4)])
    expect(universe.entries.get('A')).toMatchObject({
      observationState: 'UNAVAILABLE',
      observedVersionId: null,
      admittedVersionId: v2,
      lastGoodVersionId: v2
    })

    universe = reconcileUniverseRevision(universe, [present('A', 'v3', 5, 'provider-3')])
    const v3 = universe.entries.get('A')?.admittedVersionId
    expect(universe.reconciliationEvents[0]?.action).toBe('RECOVER')
    expect(v3).not.toBe(v2)

    universe = reconcileUniverseRevision(universe, [absent('A', 6)])
    expect(universe.entries.get('A')).toMatchObject({
      observationState: 'ABSENT',
      observedVersionId: null,
      admittedVersionId: null,
      lastGoodVersionId: v3
    })
    expect(() => reconcileUniverseRevision(universe, [present('A', 'v4', 5)])).toThrow(
      'out-of-order observation'
    )
  })

  it('keeps providerVersion separate from content identity', () => {
    let universe = createEmptyUniverseRevision(0)
    universe = reconcileUniverseRevision(universe, [present('A', 'same-content', 1, 'provider-1')])
    const versionId = universe.entries.get('A')?.observedVersionId
    universe = reconcileUniverseRevision(universe, [present('A', 'same-content', 2, 'provider-2')])
    expect(universe.entries.get('A')?.observedVersionId).toBe(versionId)
    expect(universe.entries.get('A')?.providerVersion).toBe('provider-2')
    expect(universe.reconciliationEvents[0]).toMatchObject({
      action: 'NO_CHANGE',
      providerVersionChanged: true,
      contentHashChanged: false
    })
  })

  it('serializes and restores an immutable UniverseRevision', () => {
    const universe = fixtureUniverse(['A', 'B'])
    const restored = deserializeUniverseRevision(serializeUniverseRevision(universe))
    expect(restored).toEqual(universe)
    expect(restored.logicalHash).toBe(universe.logicalHash)
    expect(() => (restored.entries as Map<string, unknown>).set('outside', {})).toThrow()
  })
})

describe('deterministic Proposal -> Admission -> Commit', () => {
  it('orders P0/P1/P2/P3 deterministically and respects planning budget', () => {
    const universe = fixtureUniverse(['A', 'B', 'C', 'D'])
    const proposal = planProposedWorkingSet({
      universe,
      previousCommittedWorkingSet: null,
      policy: {
        version: 'deterministic-v0',
        budget: { maxSemanticTokens: 6 },
        represent: (entry, version) => representationFor(entry, version)
      },
      taskHints: {
        mandatorySourceIds: ['A'],
        referencedSourceIds: ['B'],
        dependencySourceIds: ['C']
      },
      createdAt: 10
    })
    expect(proposal.entries.map((entry) => entry.sourceId)).toEqual(['A', 'B', 'C'])
    expect(proposal.entries[0]?.priority).toBe('P0')
    expect(proposal.entries[1]?.reason).toContain('CURRENT_TASK_REFERENCE')
    expect(proposal.entries[2]?.priority).toBe('P2')
    expect(proposal.entries.some((entry) => entry.sourceId === 'D')).toBe(false)
  })

  it('admits a materialized summary, rejects budget overflow, and commits only admitted entries', () => {
    const universe = fixtureUniverse(['A', 'B', 'C'])
    const proposal = fixtureProposal(universe, null, 20)
    const receipt = admitWorkingSet({
      universe,
      proposal,
      budget: { maxSemanticTokens: 3 },
      adapter: fixtureAdapter(),
      createdAt: 11
    })
    expect(receipt.outcomes.map((outcome) => outcome.status)).toEqual([
      'ADMITTED',
      'ADMITTED',
      'REJECTED'
    ])
    const b = receipt.outcomes.find((outcome) => outcome.sourceId === 'B')
    expect(b?.status === 'ADMITTED' ? b.representation.kind : null).toBe('SUMMARY')
    expect(receipt.outcomes.find((outcome) => outcome.sourceId === 'C')).toMatchObject({
      status: 'REJECTED',
      reason: 'BUDGET'
    })

    const committed = commitAdmission({
      universe,
      proposal,
      receipt,
      previousCommittedWorkingSet: null
    })
    expect(committed.entries.map((entry) => entry.sourceId)).toEqual(['A', 'B'])
    expect(committed.entries.find((entry) => entry.sourceId === 'B')?.representation.kind).toBe('SUMMARY')
    expect(universe.entries.has('C')).toBe(true)

    const proposalRoundTrip = deserializeProposedWorkingSet(
      serializeProposedWorkingSet(proposal),
      universe
    )
    const receiptRoundTrip = deserializeAdmissionReceipt(
      serializeAdmissionReceipt(receipt),
      proposalRoundTrip
    )
    const committedRoundTrip = deserializeCommittedWorkingSet(
      serializeCommittedWorkingSet(committed),
      universe,
      proposalRoundTrip,
      receiptRoundTrip
    )
    expect(committedRoundTrip.logicalHash).toBe(committed.logicalHash)
  })

  it('records last-good provenance when admitting through UNAVAILABLE', () => {
    const presentUniverse = fixtureUniverse(['A'])
    const unavailableUniverse = reconcileUniverseRevision(presentUniverse, [unavailable('A', 2)])
    const proposal = fixtureProposal(unavailableUniverse)
    const receipt = admitWorkingSet({
      universe: unavailableUniverse,
      proposal,
      budget: { maxSemanticTokens: 100 },
      adapter: fullAdapter(),
      createdAt: 3
    })

    expect(receipt.outcomes[0]).toMatchObject({
      status: 'ADMITTED',
      freshness: 'LAST_GOOD',
      admissionBasis: 'LAST_GOOD_FALLBACK'
    })
  })

  it('rejects Receipt serialization tampering across proposal and representation versions', () => {
    const universe = fixtureUniverse(['A'])
    const proposal = fixtureProposal(universe)
    const receipt = admitWorkingSet({
      universe,
      proposal,
      budget: { maxSemanticTokens: 100 },
      adapter: fullAdapter(),
      createdAt: 13
    })

    const tamperedVersion = JSON.parse(serializeAdmissionReceipt(receipt)) as {
      outcomes: Array<{ sourceVersionId: string }>
    }
    tamperedVersion.outcomes[0]!.sourceVersionId = 'tampered-version'
    expect(() => deserializeAdmissionReceipt(JSON.stringify(tamperedVersion), proposal)).toThrow(
      'sourceVersionId does not match proposal'
    )

    const tamperedRepresentation = JSON.parse(serializeAdmissionReceipt(receipt)) as {
      outcomes: Array<{ representation: { sourceVersionIds: string[] } }>
    }
    tamperedRepresentation.outcomes[0]!.representation.sourceVersionIds = []
    expect(() =>
      deserializeAdmissionReceipt(JSON.stringify(tamperedRepresentation), proposal)
    ).toThrow('representation does not contain outcome sourceVersionId')
  })

  it('returns STALE when a proposal is admitted against a newer UniverseRevision', () => {
    const universeV1 = fixtureUniverse(['A'])
    const proposal = fixtureProposal(universeV1)
    const universeV2 = reconcileUniverseRevision(
      universeV1,
      [present('A', 'hash-A-v2', 2, 'provider-2')]
    )
    const receipt = admitWorkingSet({
      universe: universeV2,
      proposal,
      budget: { maxSemanticTokens: 100 },
      adapter: fixtureAdapter(),
      createdAt: 12
    })
    expect(receipt.universeRevisionId).toBe(universeV2.revisionId)
    expect(receipt.outcomes[0]).toMatchObject({ status: 'REJECTED', reason: 'STALE' })
    const committed = commitAdmission({
      universe: universeV2,
      proposal,
      receipt,
      previousCommittedWorkingSet: null
    })
    expect(committed.entries).toHaveLength(0)
  })
})

describe('replayable WorkingSet transitions', () => {
  it('classifies a same-version representation change as REPLACE', () => {
    const universe = fixtureUniverse(['B'])
    const proposal = planProposedWorkingSet({
      universe,
      previousCommittedWorkingSet: null,
      policy: {
        version: 'deterministic-v0',
        budget: { maxSemanticTokens: 100 },
        represent: (entry, version) => representationFor(entry, version)
      },
      taskHints: { referencedSourceIds: ['B'] },
      createdAt: 30
    })
    const summaryReceipt = admitWorkingSet({
      universe,
      proposal,
      budget: { maxSemanticTokens: 100 },
      adapter: fixtureAdapter(),
      createdAt: 31
    })
    const summaryCommitted = commitAdmission({
      universe,
      proposal,
      receipt: summaryReceipt,
      previousCommittedWorkingSet: null
    })
    const nextProposal = planProposedWorkingSet({
      universe,
      previousCommittedWorkingSet: summaryCommitted,
      policy: {
        version: 'deterministic-v0',
        budget: { maxSemanticTokens: 100 },
        represent: (entry, version) => representationFor(entry, version)
      },
      taskHints: { referencedSourceIds: ['B'] },
      createdAt: 32
    })
    const fullReceipt = admitWorkingSet({
      universe,
      proposal: nextProposal,
      budget: { maxSemanticTokens: 100 },
      adapter: fullAdapter(),
      createdAt: 33
    })
    const fullCommitted = commitAdmission({
      universe,
      proposal: nextProposal,
      receipt: fullReceipt,
      previousCommittedWorkingSet: summaryCommitted
    })
    const transition = computeWorkingSetTransition(summaryCommitted, fullCommitted)
    expect(transition.actions).toHaveLength(1)
    expect(transition.actions[0]?.action).toBe('REPLACE')
  })

  it('replays ADD, KEEP, REPLACE and REMOVE from immutable committed states', () => {
    const universeV1 = fixtureUniverse(['A', 'B'])
    const proposalV1 = fixtureProposal(universeV1)
    const receiptV1 = admitWorkingSet({
      universe: universeV1,
      proposal: proposalV1,
      budget: { maxSemanticTokens: 100 },
      adapter: fixtureAdapter(),
      createdAt: 20
    })
    const committedV1 = commitAdmission({
      universe: universeV1,
      proposal: proposalV1,
      receipt: receiptV1,
      previousCommittedWorkingSet: null
    })

    const universeV2 = reconcileUniverseRevision(universeV1, [
      present('A', 'hash-A-v2', 2, 'provider-2'),
      absent('B', 2)
    ])
    const proposalV2 = fixtureProposal(universeV2, committedV1)
    const receiptV2 = admitWorkingSet({
      universe: universeV2,
      proposal: proposalV2,
      budget: { maxSemanticTokens: 100 },
      adapter: fixtureAdapter(),
      createdAt: 21
    })
    const committedV2 = commitAdmission({
      universe: universeV2,
      proposal: proposalV2,
      receipt: receiptV2,
      previousCommittedWorkingSet: committedV1
    })
    const transition = computeWorkingSetTransition(committedV1, committedV2)
    expect(transition.actions.map((action) => action.action)).toEqual(['REPLACE', 'REMOVE'])
    const replayed = applyWorkingSetTransition(committedV1, transition)
    expect(replayed.logicalHash).toBe(committedV2.logicalHash)
    expect(replayed.entries).toEqual(committedV2.entries)

    const restoredTransition = deserializeWorkingSetTransition(
      serializeWorkingSetTransition(transition)
    )
    expect(applyWorkingSetTransition(committedV1, restoredTransition).logicalHash).toBe(
      committedV2.logicalHash
    )
  })
})
