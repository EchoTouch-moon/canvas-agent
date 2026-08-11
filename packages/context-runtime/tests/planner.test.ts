import { describe, expect, it } from 'vitest'
import {
  PlanningConflictError,
  createRepresentation,
  isRepresentationFresh,
  planWorkingSet,
  planningRequestHash,
  seedUniverse,
  applySourceObservations,
  createAvailableObservation,
  type ContextPlanningRequest,
  type ContextUniverseEntry,
  type ContextUniverseRevision
} from '../src'
import type { ContextRepresentation } from '../src'

const T0 = '2026-08-11T00:00:00.000Z'
const POLICY = 'policy-v0-test'

function availableObservation(sourceKey: string, contentHash: string) {
  return createAvailableObservation(sourceKey, contentHash, T0)
}

function universeWithEntries(
  runtimeSessionId: string,
  entries: readonly {
    sourceKey: string
    sourceKind: string
    provenance: string
    authority?: string
    priority?: string
    contentHash: string
  }[]
): ContextUniverseRevision {
  const seeds = entries.map((entry) => ({
    sourceKey: entry.sourceKey,
    sourceKind: entry.sourceKind,
    contentHash: entry.contentHash,
    ...(entry.authority !== undefined ? { authority: entry.authority } : {}),
    ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
    provenance: entry.provenance,
    observedAt: T0
  }))
  return seedUniverse({ runtimeSessionId, seeds })
}

function representEvery(entry: ContextUniverseEntry): ContextRepresentation | null {
  const version = entry.admittedVersion
  if (version === null) return null
  return createRepresentation({
    kind: 'REFERENCE',
    sourceVersionIds: [version.versionId],
    contentHash: version.contentHash,
    tokenEstimate: Math.max(1, Math.ceil(version.contentHash.length / 2)),
    lossiness: 'NONE',
    derivation: { sourceKey: entry.source.sourceKey }
  })
}

function planningRequest(overrides: Partial<ContextPlanningRequest> = {}): ContextPlanningRequest {
  return {
    runtimeSessionId: 's',
    recompositionSequence: 1,
    budget: { maxSemanticTokens: 1000 },
    pinnedSourceKeys: [],
    excludedSourceKeys: [],
    currentTargetSourceKeys: [],
    latestVerificationSourceKeys: [],
    previousWorkingSetId: null,
    ...overrides
  }
}

describe('deterministic identity and normalization', () => {
  it('1) same normalized inputs + policy version => same Working Set logical hash', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'run/tool-result://call-1', sourceKind: 'RUN_TOOL_RESULT', provenance: 'PI_CONTEXT_EVENT', contentHash: 'hash-A' }
    ])
    const request = planningRequest()
    const opts = { policyVersion: POLICY, createdAt: T0, represent: representEvery }
    const a = planWorkingSet({ universe, request, previousWorkingSet: null, options: opts })
    const b = planWorkingSet({ universe, request, previousWorkingSet: null, options: opts })
    expect(a.workingSet.logicalHash).toBe(b.workingSet.logicalHash)
    expect(a.transition.logicalHash).toBe(b.transition.logicalHash)
  })

  it('2) deterministic tie-breaking for equal-ranked candidates', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'run/tool-result://b', sourceKind: 'RUN_TOOL_RESULT', provenance: 'PI_CONTEXT_EVENT', contentHash: 'B' },
      { sourceKey: 'run/tool-result://a', sourceKind: 'RUN_TOOL_RESULT', provenance: 'PI_CONTEXT_EVENT', contentHash: 'A' }
    ])
    const request = planningRequest({ budget: { maxSemanticTokens: 1 } })
    const a = planWorkingSet({ universe, request, previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    const b = planWorkingSet({ universe, request, previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    expect(a.workingSet.items.map((i) => i.sourceKeys[0])).toEqual(b.workingSet.items.map((i) => i.sourceKeys[0]))
    expect(a.workingSet.logicalHash).toBe(b.workingSet.logicalHash)
  })

  it('19) policy version change produces a distinguishable plan identity', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'run/tool-result://call-1', sourceKind: 'RUN_TOOL_RESULT', provenance: 'PI_CONTEXT_EVENT', contentHash: 'hash-A' }
    ])
    const request = planningRequest()
    const v1 = planWorkingSet({ universe, request, previousWorkingSet: null, options: { policyVersion: 'v1', createdAt: T0, represent: representEvery } })
    const v2 = planWorkingSet({ universe, request, previousWorkingSet: null, options: { policyVersion: 'v2', createdAt: T0, represent: representEvery } })
    expect(v1.workingSet.logicalHash).not.toBe(v2.workingSet.logicalHash)
    expect(v1.workingSet.planningRequestHash).toBe(v2.workingSet.planningRequestHash)
  })

  it('planningRequestHash is deterministic and ignores ordering of lists', () => {
    const a = planningRequest({ pinnedSourceKeys: ['x', 'y'] })
    const b = planningRequest({ pinnedSourceKeys: ['y', 'x'] })
    expect(planningRequestHash(a)).toBe(planningRequestHash(b))
  })
})

describe('Universe binding and representation freshness', () => {
  it('3) Working Set binds the exact Universe sequence/hash', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'run/tool-result://call-1', sourceKind: 'RUN_TOOL_RESULT', provenance: 'PI_CONTEXT_EVENT', contentHash: 'hash-A' }
    ])
    const result = planWorkingSet({ universe, request: planningRequest(), previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    expect(result.workingSet.plannedFromUniverseSequence).toBe(universe.sequence)
    expect(result.workingSet.plannedFromUniverseHash).toBe(universe.logicalHash)
  })

  it('14) changed SourceVersion stales a representation derived from the old version', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'repository/file://a.ts', sourceKind: 'repository-file', provenance: 'snapshot-seed', contentHash: 'v1' }
    ])
    const entry = universe.entries.find((e) => e.source.sourceKey === 'repository/file://a.ts')!
    const repr = representEvery(entry)!
    expect(isRepresentationFresh(repr, [entry.admittedVersion!])).toBe(true)
    // Advance the source to v2; the old representation becomes stale.
    const next = applySourceObservations({
      previous: universe,
      observations: [availableObservation('repository/file://a.ts', 'v2')],
      modelCallSequence: 1
    })
    const nextEntry = next.entries.find((e) => e.source.sourceKey === 'repository/file://a.ts')!
    expect(nextEntry.admittedVersion?.contentHash).toBe('v2')
    expect(isRepresentationFresh(repr, [nextEntry.admittedVersion!])).toBe(false)
  })

  it('15) representation provenance references exact SourceVersion ids', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'run/tool-result://call-1', sourceKind: 'RUN_TOOL_RESULT', provenance: 'PI_CONTEXT_EVENT', contentHash: 'hash-A' }
    ])
    const entry = universe.entries[0]!
    const repr = representEvery(entry)!
    expect(repr.sourceVersionIds).toEqual([entry.admittedVersion!.versionId])
  })
})

describe('protection / pin / exclude semantics', () => {
  it('4) mandatory item survives severe budget pressure', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'task-spec://task-1', sourceKind: 'task-spec', provenance: 'snapshot-seed', priority: 'P0', contentHash: 'big-content-hash-long-enough' }
    ])
    const request = planningRequest({ budget: { maxSemanticTokens: 1 } })
    const result = planWorkingSet({ universe, request, previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    expect(result.workingSet.items.map((i) => i.sourceKeys[0])).toContain('task-spec://task-1')
  })

  it('5) pinned item survives normal eviction', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'repository/file://pinned.ts', sourceKind: 'repository-file', provenance: 'snapshot-seed', contentHash: 'x'.repeat(50) },
      { sourceKey: 'run/tool-result://call-1', sourceKind: 'RUN_TOOL_RESULT', provenance: 'PI_CONTEXT_EVENT', contentHash: 'y'.repeat(50) }
    ])
    const request = planningRequest({
      pinnedSourceKeys: ['repository/file://pinned.ts'],
      budget: { maxSemanticTokens: 30 }
    })
    const result = planWorkingSet({ universe, request, previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    const keys = result.workingSet.items.map((i) => i.sourceKeys[0])
    expect(keys).toContain('repository/file://pinned.ts')
    expect(keys).not.toContain('run/tool-result://call-1')
  })

  it('6) exclude removes an ordinary eligible candidate', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'run/tool-result://call-1', sourceKind: 'RUN_TOOL_RESULT', provenance: 'PI_CONTEXT_EVENT', contentHash: 'hash-A' }
    ])
    const request = planningRequest({ excludedSourceKeys: ['run/tool-result://call-1'] })
    const result = planWorkingSet({ universe, request, previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    expect(result.workingSet.items).toHaveLength(0)
  })

  it('7) mandatory + exclude conflict is explicit and deterministic', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'task-spec://task-1', sourceKind: 'task-spec', provenance: 'snapshot-seed', priority: 'P0', contentHash: 'hash-A' }
    ])
    const request = planningRequest({ excludedSourceKeys: ['task-spec://task-1'] })
    expect(() =>
      planWorkingSet({ universe, request, previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    ).toThrow(PlanningConflictError)
  })
})

describe('ABSENT / UNAVAILABLE semantics', () => {
  it('8) ABSENT source is not treated as currently active ordinary evidence', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'run/tool-result://call-1', sourceKind: 'RUN_TOOL_RESULT', provenance: 'PI_CONTEXT_EVENT', contentHash: 'hash-A' }
    ])
    const absentUniverse = applySourceObservations({
      previous: universe,
      observations: [{ sourceKey: 'run/tool-result://call-1', status: 'ABSENT' as const, observedAt: T0 }],
      modelCallSequence: 1
    })
    const result = planWorkingSet({ universe: absentUniverse, request: planningRequest(), previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    expect(result.workingSet.items).toHaveLength(0)
  })

  it('9) UNAVAILABLE preserves conservative last-known semantics with explicit reason', () => {
    const universe = universeWithEntries('s', [
      { sourceKey: 'repository/file://a.ts', sourceKind: 'repository-file', provenance: 'snapshot-seed', contentHash: 'hash-A' }
    ])
    const unavailableUniverse = applySourceObservations({
      previous: universe,
      observations: [{ sourceKey: 'repository/file://a.ts', status: 'UNAVAILABLE' as const, observedAt: T0, reasonCode: 'adapter-down' }],
      modelCallSequence: 1
    })
    const result = planWorkingSet({ universe: unavailableUniverse, request: planningRequest(), previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    const keys = result.workingSet.items.map((i) => i.sourceKeys[0])
    expect(keys).toContain('repository/file://a.ts')
    const decision = result.decisions.find((d) => d.sourceKey === 'repository/file://a.ts')
    expect(decision?.reasonCodes).toContain('SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP')
  })
})

describe('continuity, KEEP, REHYDRATE and reason codes', () => {
  const makeUniverse = () =>
    universeWithEntries('s', [
      { sourceKey: 'run/tool-result://call-1', sourceKind: 'RUN_TOOL_RESULT', provenance: 'PI_CONTEXT_EVENT', contentHash: 'hash-A' }
    ])

  it('10) previous active item receives KEEP when still selected', () => {
    const universe = makeUniverse()
    const opts = { policyVersion: POLICY, createdAt: T0, represent: representEvery }
    const first = planWorkingSet({ universe, request: planningRequest({ recompositionSequence: 1 }), previousWorkingSet: null, options: opts })
    const second = planWorkingSet({ universe, request: planningRequest({ recompositionSequence: 2, previousWorkingSetId: first.workingSet.workingSetId }), previousWorkingSet: first.workingSet, options: opts })
    expect(second.decisions.map((d) => d.kind)).toContain('KEEP')
  })

  it('11) active -> removed -> relevant again produces REHYDRATE, not a first ADD', () => {
    const universe = makeUniverse()
    const opts = { policyVersion: POLICY, createdAt: T0, represent: representEvery }
    const first = planWorkingSet({ universe, request: planningRequest({ recompositionSequence: 1 }), previousWorkingSet: null, options: opts })
    // Remove via explicit exclusion.
    const excluded = planWorkingSet({
      universe,
      request: planningRequest({ recompositionSequence: 2, previousWorkingSetId: first.workingSet.workingSetId, excludedSourceKeys: ['run/tool-result://call-1'] }),
      previousWorkingSet: first.workingSet,
      options: opts
    })
    expect(excluded.workingSet.items).toHaveLength(0)
    // Now pinned/current-target again => REHYDRATE.
    const rehydrated = planWorkingSet({
      universe,
      request: planningRequest({ recompositionSequence: 3, previousWorkingSetId: excluded.workingSet.workingSetId, pinnedSourceKeys: ['run/tool-result://call-1'] }),
      previousWorkingSet: excluded.workingSet,
      options: opts
    })
    const decision = rehydrated.decisions.find((d) => d.sourceKey === 'run/tool-result://call-1')
    expect(decision?.kind).toBe('REHYDRATE')
    expect(decision?.reasonCodes).toContain('REHYDRATION_TRIGGERED')
  })

  it('12) every membership change has a machine-readable decision reason', () => {
    const universe = makeUniverse()
    const result = planWorkingSet({ universe, request: planningRequest(), previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    for (const decision of result.decisions) {
      expect(decision.reasonCodes.length).toBeGreaterThan(0)
    }
  })

  it('13) token estimates/deltas match selected representations', () => {
    const universe = makeUniverse()
    const result = planWorkingSet({ universe, request: planningRequest(), previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    const total = result.workingSet.items.reduce((sum, item) => sum + item.tokenEstimate, 0)
    expect(result.workingSet.totalTokenEstimate).toBe(total)
  })
})

describe('trust boundary', () => {
  it('17) Planner cannot select a non-admitted DERIVED_HINT as canonical source input', () => {
    // A DERIVED_HINT that was never admitted into the Universe is simply absent
    // from entries; the planner only iterates admitted entries.
    const universe = universeWithEntries('s', [
      { sourceKey: 'run/tool-result://call-1', sourceKind: 'RUN_TOOL_RESULT', provenance: 'PI_CONTEXT_EVENT', contentHash: 'hash-A' }
    ])
    const result = planWorkingSet({ universe, request: planningRequest({ currentTargetSourceKeys: ['repository/file://src/auth.ts'] }), previousWorkingSet: null, options: { policyVersion: POLICY, createdAt: T0, represent: representEvery } })
    const keys = result.workingSet.items.map((i) => i.sourceKeys[0])
    expect(keys).not.toContain('repository/file://src/auth.ts')
  })
})
