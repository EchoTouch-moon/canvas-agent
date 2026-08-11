import { describe, expect, it } from 'vitest'
import {
  OBSERVED_ELEMENT_KINDS,
  elementSemanticHash,
  observationRef,
  reconcileSource,
  seedUniverse,
  applySourceObservations,
  replayUniverse,
  createSourceVersionId,
  computeUniverseLogicalHash,
  summarizeAttribution,
  FixtureSourceObserver,
  UNATTRIBUTED_ATTRIBUTION,
  EXACT_ATTRIBUTION,
  DERIVED_HINT_ATTRIBUTION,
  OPAQUE_ATTRIBUTION,
  type SourceObservation
} from '../src'

const T0 = '2026-08-11T00:00:00.000Z'

function available(sourceKey: string, hash: string): SourceObservation {
  return { sourceKey, status: 'AVAILABLE', observedAt: T0, contentHash: hash }
}

function absent(sourceKey: string): SourceObservation {
  return { sourceKey, status: 'ABSENT', observedAt: T0 }
}

function unavailable(sourceKey: string, reason = 'read-failed'): SourceObservation {
  return { sourceKey, status: 'UNAVAILABLE', observedAt: T0, reasonCode: reason }
}

describe('observed context elements', () => {
  it('kind taxonomy is defined', () => {
    expect(OBSERVED_ELEMENT_KINDS).toContain('TOOL_CALL')
    expect(OBSERVED_ELEMENT_KINDS).toContain('TOOL_RESULT')
    expect(OBSERVED_ELEMENT_KINDS).toContain('USER_TEXT')
  })

  it('observationRef is deterministic and stable', () => {
    expect(observationRef('s', 4, 3)).toBe('s#call-4-m-3')
    expect(observationRef('s', 4, 3, 1)).toBe('s#call-4-m-3-b-1')
    expect(observationRef('s', 4, 3, 1)).toBe(observationRef('s', 4, 3, 1))
  })

  it('elementSemanticHash is deterministic', () => {
    expect(elementSemanticHash(['read', 'a.ts'])).toBe(elementSemanticHash(['read', 'a.ts']))
    expect(elementSemanticHash(['read', 'a.ts'])).not.toBe(elementSemanticHash(['read', 'b.ts']))
  })
})

describe('source version identity', () => {
  it('same source + same content -> same version', () => {
    expect(createSourceVersionId('repository/file://a.ts', 'hashA')).toBe(
      createSourceVersionId('repository/file://a.ts', 'hashA')
    )
  })

  it('same source + changed content -> new version', () => {
    expect(createSourceVersionId('repository/file://a.ts', 'hashA')).not.toBe(
      createSourceVersionId('repository/file://a.ts', 'hashB')
    )
  })

  it('same content + different source -> different version', () => {
    expect(createSourceVersionId('repository/file://a.ts', 'hashA')).not.toBe(
      createSourceVersionId('repository/file://b.ts', 'hashA')
    )
  })
})

describe('source reconciliation', () => {
  it('AVAILABLE first -> INITIALIZE', () => {
    const result = reconcileSource(null, available('repository/file://a.ts', 'h1'), 1)
    expect(result.event.action).toBe('INITIALIZE')
    expect(result.state.observationStatus).toBe('AVAILABLE')
    expect(result.state.admittedVersionId).toBeTruthy()
    expect(result.admittedVersion?.contentHash).toBe('h1')
  })

  it('AVAILABLE same hash -> NO_CHANGE (no new version)', () => {
    const first = reconcileSource(null, available('repository/file://a.ts', 'h1'), 1)
    const second = reconcileSource(first.state, available('repository/file://a.ts', 'h1'), 2)
    expect(second.event.action).toBe('NO_CHANGE')
    expect(second.state.admittedVersionId).toBe(first.state.admittedVersionId)
    expect(second.admittedVersion).toBeNull()
  })

  it('AVAILABLE changed -> UPDATE (new version, old retained as lastAvailable)', () => {
    const first = reconcileSource(null, available('repository/file://a.ts', 'h1'), 1)
    const second = reconcileSource(first.state, available('repository/file://a.ts', 'h2'), 2)
    expect(second.event.action).toBe('UPDATE')
    expect(second.event.previousVersionId).toBe(first.state.admittedVersionId)
    expect(second.state.admittedVersionId).not.toBe(first.state.admittedVersionId)
    expect(second.admittedVersion?.contentHash).toBe('h2')
  })

  it('ABSENT -> REMOVE (clears admitted, lastAvailable retained)', () => {
    const first = reconcileSource(null, available('repository/file://a.ts', 'h1'), 1)
    const removed = reconcileSource(first.state, absent('repository/file://a.ts'), 2)
    expect(removed.event.action).toBe('REMOVE')
    expect(removed.state.observationStatus).toBe('ABSENT')
    expect(removed.state.admittedVersionId).toBeNull()
    expect(removed.state.lastAvailableVersionId).toBe(first.state.admittedVersionId)
  })

  it('UNAVAILABLE -> RETAIN_LAST_KNOWN (never clears admitted)', () => {
    const first = reconcileSource(null, available('repository/file://a.ts', 'h1'), 1)
    const unavailableResult = reconcileSource(
      first.state,
      unavailable('repository/file://a.ts'),
      2
    )
    expect(unavailableResult.event.action).toBe('RETAIN_LAST_KNOWN')
    expect(unavailableResult.state.observationStatus).toBe('UNAVAILABLE')
    expect(unavailableResult.state.admittedVersionId).toBe(first.state.admittedVersionId)
    expect(unavailableResult.state.lastAvailableVersionId).toBe(first.state.admittedVersionId)
  })

  it('UNAVAILABLE retains last available version and is not ABSENT', () => {
    const first = reconcileSource(null, available('repository/file://a.ts', 'h1'), 1)
    const second = reconcileSource(first.state, available('repository/file://a.ts', 'h2'), 2)
    const unavailableResult = reconcileSource(
      second.state,
      unavailable('repository/file://a.ts'),
      3
    )
    expect(unavailableResult.state.admittedVersionId).toBe(second.state.admittedVersionId)
    expect(unavailableResult.state.observationStatus).toBe('UNAVAILABLE')
    expect(unavailableResult.state.lastAvailableVersionId).toBe(second.state.admittedVersionId)
  })

  it('message disappearance is NOT ABSENT (only explicit fixture observation is)', () => {
    // Simulating "the message vanished from a later AgentMessage[]": we never
    // call reconcileSource with ABSENT. The observer with no entry returns null.
    const observer = new FixtureSourceObserver([])
    expect(observer.observe('repository/file://a.ts', T0)).toBeNull()
  })

  it('UNAVAILABLE via fixture observer carries reasonCode', () => {
    const observer = new FixtureSourceObserver([
      { sourceKey: 'repository/file://a.ts', status: 'UNAVAILABLE', reasonCode: 'adapter-down' }
    ])
    const observation = observer.observe('repository/file://a.ts', T0)
    expect(observation?.status).toBe('UNAVAILABLE')
    expect(observation?.reasonCode).toBe('adapter-down')
  })
})

describe('shadow context universe', () => {
  const seeds = [
    {
      sourceKey: 'repository/file://src/auth.ts',
      sourceKind: 'repository-file',
      contentHash: 'hash-A',
      provenance: 'snapshot-seed',
      observedAt: T0
    },
    {
      sourceKey: 'task-spec://task-1',
      sourceKind: 'task-spec',
      contentHash: 'hash-B',
      provenance: 'snapshot-seed',
      observedAt: T0
    }
  ]

  it('seed produces immutable revision #0 with snapshot versions addressable', () => {
    const revision = seedUniverse({ runtimeSessionId: 's', seeds })
    expect(revision.sequence).toBe(0)
    expect(revision.modelCallSequence).toBeNull()
    expect(revision.entries).toHaveLength(2)
    const auth = revision.entries.find((e) => e.sourceKey === 'repository/file://src/auth.ts')
    expect(auth?.admittedVersion?.contentHash).toBe('hash-A')
    expect(auth?.state.observationStatus).toBe('AVAILABLE')
  })

  it('applying a runtime observation advances admitted head while seed stays addressable', () => {
    const seed = seedUniverse({ runtimeSessionId: 's', seeds })
    const next = applySourceObservations({
      previous: seed,
      observations: [available('repository/file://src/auth.ts', 'hash-C')],
      modelCallSequence: 1
    })
    expect(next.sequence).toBe(1)
    expect(next.modelCallSequence).toBe(1)
    expect(next.previousRevisionId).toBe(seed.revisionId)
    const auth = next.entries.find((e) => e.sourceKey === 'repository/file://src/auth.ts')
    expect(auth?.admittedVersion?.contentHash).toBe('hash-C')
    // The seed revision is immutable and still carries hash-A.
    const seedAuth = seed.entries.find((e) => e.sourceKey === 'repository/file://src/auth.ts')
    expect(seedAuth?.admittedVersion?.contentHash).toBe('hash-A')
  })

  it('Universe revisions are immutable (revision object unchanged by later calls)', () => {
    const seed = seedUniverse({ runtimeSessionId: 's', seeds })
    const before = seed.logicalHash
    void applySourceObservations({
      previous: seed,
      observations: [available('repository/file://src/auth.ts', 'hash-C')],
      modelCallSequence: 1
    })
    expect(seed.logicalHash).toBe(before)
    expect(seed.entries).toHaveLength(2)
  })

  it('logical hash is deterministic', () => {
    const revision = seedUniverse({ runtimeSessionId: 's', seeds })
    const hash = computeUniverseLogicalHash(
      revision.runtimeSessionId,
      revision.sequence,
      revision.modelCallSequence,
      revision.entries,
      revision.reconciliationEvents
    )
    expect(hash).toBe(revision.logicalHash)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('replay from seed + ordered observations reconstructs the same final state', () => {
    const batches = [
      {
        modelCallSequence: 1,
        observations: [available('repository/file://src/auth.ts', 'hash-C')]
      },
      {
        modelCallSequence: 2,
        observations: [unavailable('repository/file://src/auth.ts')]
      },
      {
        modelCallSequence: 3,
        observations: [absent('task-spec://task-1')]
      }
    ]
    const direct = applySourceObservations({
      previous: applySourceObservations({
        previous: seedUniverse({ runtimeSessionId: 's', seeds }),
        observations: batches[0]!.observations,
        modelCallSequence: 1
      }),
      observations: batches[1]!.observations,
      modelCallSequence: 2
    })
    const final = applySourceObservations({
      previous: direct,
      observations: batches[2]!.observations,
      modelCallSequence: 3
    })
    const replayed = replayUniverse({ runtimeSessionId: 's', seeds, observationBatches: batches })
    expect(replayed.sequence).toBe(3)
    expect(replayed.logicalHash).toBe(final.logicalHash)
    const auth = replayed.entries.find((e) => e.sourceKey === 'repository/file://src/auth.ts')
    expect(auth?.state.observationStatus).toBe('UNAVAILABLE')
    expect(auth?.state.admittedVersionId).not.toBeNull()
    const task = replayed.entries.find((e) => e.sourceKey === 'task-spec://task-1')
    expect(task?.state.observationStatus).toBe('ABSENT')
  })

  it('replay is deterministic across two independent replays', () => {
    const batches = [
      {
        modelCallSequence: 1,
        observations: [available('repository/file://src/auth.ts', 'hash-C')]
      }
    ]
    const a = replayUniverse({ runtimeSessionId: 's', seeds, observationBatches: batches })
    const b = replayUniverse({ runtimeSessionId: 's', seeds, observationBatches: batches })
    expect(a.logicalHash).toBe(b.logicalHash)
    expect(a.entries).toEqual(b.entries)
  })
})

describe('attribution', () => {
  it('EXACT attribution carries method + evidence', () => {
    const attribution = EXACT_ATTRIBUTION(
      ['modelCall=4', 'messageIndex=3', 'toolCallId=call-7'],
      'run/tool-result://call-7',
      'PI_TOOL_RESULT_ID_EXACT'
    )
    expect(attribution.confidence).toBe('EXACT')
    expect(attribution.sourceKey).toBe('run/tool-result://call-7')
    expect(attribution.method).toBe('PI_TOOL_RESULT_ID_EXACT')
    expect(attribution.evidenceRefs).toContain('toolCallId=call-7')
  })

  it('DERIVED_HINT attribution for structured tool argument path', () => {
    const attribution = DERIVED_HINT_ATTRIBUTION(
      ['tool=read', 'argumentField=path'],
      'repository/file://src/auth.ts',
      'PI_TOOL_ARGUMENT_PATH_HINT'
    )
    expect(attribution.confidence).toBe('DERIVED_HINT')
    expect(attribution.method).toBe('PI_TOOL_ARGUMENT_PATH_HINT')
  })

  it('UNATTRIBUTED for assistant prose (no source invented)', () => {
    const attribution = UNATTRIBUTED_ATTRIBUTION(['messageIndex=1', 'elementKind=ASSISTANT_TEXT'])
    expect(attribution.confidence).toBe('UNATTRIBUTED')
    expect(attribution.sourceKey).toBeUndefined()
    expect(attribution.method).toBe('NO_TRUSTWORTHY_IDENTITY')
  })

  it('OPAQUE for origin-unavailable blocks', () => {
    const attribution = OPAQUE_ATTRIBUTION(['elementKind=IMAGE'])
    expect(attribution.confidence).toBe('OPAQUE')
    expect(attribution.method).toBe('ORIGIN_OPAQUE')
  })

  it('attribution summary counts are honest', () => {
    const summary = summarizeAttribution(['EXACT', 'EXACT', 'DERIVED_HINT', 'UNATTRIBUTED', 'OPAQUE'])
    expect(summary.total).toBe(5)
    expect(summary.exact).toBe(2)
    expect(summary.derivedHint).toBe(1)
    expect(summary.unattributed).toBe(1)
    expect(summary.opaque).toBe(1)
  })
})
