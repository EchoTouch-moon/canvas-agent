import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  admitWorkingSet,
  commitAdmission,
  createEmptyUniverseRevision,
  createRepresentation,
  planProposedWorkingSet,
  reconcileUniverseRevision,
  type AdmissionAdapter,
  type CommittedWorkingSet,
  type ContextRepresentation,
  type UniverseObservation,
  type UniverseRevision
} from '@canvas-agent/context-runtime'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeIntendedContext,
  canonicalizeObservedContext,
  compareContextParity,
  createPiRequestParityExtension,
  InMemoryModelRequestCapture,
  reconstructModelVisibleContext,
  type CapturedModelRequest,
  type ReconstructedModelVisibleContext
} from '../src'
import {
  PiCommittedContextAdapter,
  PiContextTranslationError,
  type ContextRenderTrace
} from '../src/experimental'

interface FixtureSource {
  readonly sourceId: string
  readonly contentHash: string
  readonly observedAt?: number
}

interface FixtureOptions {
  readonly universe?: UniverseRevision
  readonly previousCommittedWorkingSet?: CommittedWorkingSet | null
  readonly sources: readonly FixtureSource[]
  readonly unavailableSourceIds?: readonly string[]
  readonly absentSourceIds?: readonly string[]
  readonly admissionBudget?: number
  readonly representationKinds?: ReadonlyMap<string, ContextRepresentation['kind']>
  readonly representationContents?: ReadonlyMap<string, string>
  readonly representationContentRefs?: ReadonlyMap<string, string>
  readonly representationTokenEstimate?: number
}

interface FixtureState {
  readonly universe: UniverseRevision
  readonly proposal: ReturnType<typeof planProposedWorkingSet>
  readonly receipt: ReturnType<typeof admitWorkingSet>
  readonly committed: CommittedWorkingSet
}

function kindMap(
  entries: readonly (readonly [string, ContextRepresentation['kind']])[]
): ReadonlyMap<string, ContextRepresentation['kind']> {
  return new Map(entries)
}

function present(source: FixtureSource): UniverseObservation {
  return {
    sourceId: source.sourceId,
    observationState: 'PRESENT',
    contentHash: source.contentHash,
    observedAt: source.observedAt ?? 1,
    providerVersion: 'fixture-provider-v1'
  }
}

function unavailable(sourceId: string, observedAt: number): UniverseObservation {
  return {
    sourceId,
    observationState: 'UNAVAILABLE',
    reason: 'fixture transport unavailable',
    observedAt
  }
}

function absent(sourceId: string, observedAt: number): UniverseObservation {
  return { sourceId, observationState: 'ABSENT', observedAt }
}

function buildUniverse(options: FixtureOptions): UniverseRevision {
  let universe = createEmptyUniverseRevision(0)
  universe = reconcileUniverseRevision(universe, options.sources.map(present))
  if (options.unavailableSourceIds !== undefined && options.unavailableSourceIds.length > 0) {
    universe = reconcileUniverseRevision(
      universe,
      options.unavailableSourceIds.map((sourceId) => unavailable(sourceId, 2))
    )
  }
  if (options.absentSourceIds !== undefined && options.absentSourceIds.length > 0) {
    universe = reconcileUniverseRevision(
      universe,
      options.absentSourceIds.map((sourceId) => absent(sourceId, 3))
    )
  }
  return universe
}

function representationFor(
  sourceId: string,
  versionId: string,
  contentHash: string,
  options: FixtureOptions
): ContextRepresentation {
  const kind = options.representationKinds?.get(sourceId) ?? 'FULL'
  const content = options.representationContents?.get(sourceId) ?? `${sourceId}:${contentHash}:${kind}`
  const contentRef = options.representationContentRefs?.get(sourceId)
  return createRepresentation({
    kind,
    sourceVersionIds: [versionId],
    contentHash: `representation:${sourceId}:${contentHash}:${kind}`,
    tokenEstimate: options.representationTokenEstimate ?? 1,
    lossiness: kind === 'SUMMARY' ? 'LOSSY' : 'NONE',
    derivation: { fixture: true, sourceId },
    ...(contentRef !== undefined ? { contentRef } : { content })
  })
}

function buildFixture(options: FixtureOptions): FixtureState {
  const universe = options.universe ?? buildUniverse(options)
  const previousCommittedWorkingSet = options.previousCommittedWorkingSet ?? null
  const proposal = planProposedWorkingSet({
    universe,
    previousCommittedWorkingSet,
    policy: {
      version: 'cr010-fixture-planner-v1',
      budget: { maxSemanticTokens: 100 },
      represent: (entry, version) =>
        representationFor(entry.sourceId, version.versionId, version.contentHash, options)
    },
    taskHints: {
      mandatorySourceIds: ['A'],
      referencedSourceIds: ['B', 'C', 'D']
    },
    createdAt: 10
  })

  const adapter: AdmissionAdapter = {
    adapterId: 'cr010-fixture-adapter',
    adapterVersion: '1',
    render: (representations) =>
      representations
        .map((representation) => representation.content ?? representation.contentRef ?? '')
        .join('\n')
  }
  const receipt = admitWorkingSet({
    universe,
    proposal,
    budget: { maxSemanticTokens: options.admissionBudget ?? 100 },
    adapter,
    createdAt: 11
  })
  const committed = commitAdmission({
    universe,
    proposal,
    receipt,
    previousCommittedWorkingSet
  })
  return { universe, proposal, receipt, committed }
}

interface OfflineRun {
  readonly capture: InMemoryModelRequestCapture
  readonly request: CapturedModelRequest
  readonly reconstructed: ReconstructedModelVisibleContext
  readonly providerCalls: number
  readonly transportStopCount: number
}

async function runOfflineHarness(committed: CommittedWorkingSet): Promise<OfflineRun> {
  const cwd = await mkdtemp(join(tmpdir(), 'canvas-cr010-parity-'))
  const capture = new InMemoryModelRequestCapture()
  let providerCalls = 0
  let transportStopCount = 0
  let session: { dispose(): void } | undefined
  const originalFetch = globalThis.fetch

  class CaptureStop extends Error {
    constructor() {
      super('CR-010 capture transport stop')
      this.name = 'CaptureStop'
    }
  }

  globalThis.fetch = async () => {
    transportStopCount += 1
    throw new CaptureStop()
  }

  try {
    const runtime = await ModelRuntime.create({
      allowModelNetwork: false,
      refreshOnCreate: false,
      modelsPath: null,
      authPath: join(cwd, 'auth.json')
    })
    await runtime.setRuntimeApiKey('deepseek', 'cr010-fake-api-key')
    const model = runtime.getModel('deepseek', 'deepseek-v4-flash')
    if (model === undefined) throw new Error('static DeepSeek model metadata is unavailable')

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 }
    })
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: join(cwd, '.pi-agent'),
      settingsManager,
      extensionFactories: [
        {
          name: 'canvas-cr010-request-parity',
          factory: createPiRequestParityExtension({
            committed,
            capture,
            timestamp: () => 0
          })
        }
      ]
    })
    await loader.reload()
    const created = await createAgentSession({
      cwd,
      model,
      modelRuntime: runtime,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager,
      noTools: 'all'
    })
    session = created.session
    await created.session.prompt('CR-010 parity driver message')

    const request = capture.latest()
    if (request === undefined) {
      throw new Error(`request capture did not produce a payload: ${capture.errors.map((error) => error.message).join('; ')}`)
    }
    const reconstructed = reconstructModelVisibleContext(request)
    return {
      capture,
      request,
      reconstructed,
      providerCalls,
      transportStopCount
    }
  } finally {
    session?.dispose()
    globalThis.fetch = originalFetch
    await rm(cwd, { recursive: true, force: true })
  }
}

function expectParity(run: OfflineRun, committed: CommittedWorkingSet): void {
  const intended = canonicalizeIntendedContext(committed)
  const observed = canonicalizeObservedContext(run.reconstructed)
  const result = compareContextParity(intended, observed)
  expect(result.status).toBe('PASS')
  expect(result.mismatches).toHaveLength(0)
  expect(run.capture.errors).toHaveLength(0)
  expect(run.request.captureStage).toBe('before_provider_request')
  expect(run.request.api).toBe('openai-completions')
  expect(run.request.provider).toBe('deepseek')
  expect(run.request.model).toBe('deepseek-v4-flash')
  expect(run.providerCalls).toBe(0)
  expect(run.transportStopCount).toBeGreaterThan(0)
}

function traceWith(
  trace: ContextRenderTrace,
  changes: Partial<ContextRenderTrace>
): ContextRenderTrace {
  return { ...trace, ...changes }
}

function reconstructedWith(
  reconstructed: ReconstructedModelVisibleContext,
  entryIndex: number,
  changes: { readonly trace?: Partial<ContextRenderTrace>; readonly content?: string }
): ReconstructedModelVisibleContext {
  const entries = reconstructed.entries.map((entry, index) =>
    index === entryIndex
      ? {
          ...entry,
          ...(changes.content !== undefined ? { content: changes.content } : {}),
          ...(changes.trace !== undefined ? { trace: traceWith(entry.trace, changes.trace) } : {})
        }
      : entry
  )
  return { ...reconstructed, entries }
}

describe('CR-010 Pi model-visible request parity', () => {
  it('G1 translates committed entries deterministically and fails closed for unresolved content', () => {
    const state = buildFixture({
      sources: [
        { sourceId: 'A', contentHash: 'a-v1' },
        { sourceId: 'B', contentHash: 'b-v1' }
      ],
      representationKinds: kindMap([
        ['A', 'FULL'],
        ['B', 'SUMMARY']
      ])
    })
    const adapter = new PiCommittedContextAdapter()
    const first = adapter.render(state.committed, { timestamp: 0 })
    const second = adapter.render(state.committed, { timestamp: 0 })
    expect(second).toEqual(first)
    expect(first.messages.map((message) => message.role)).toEqual(['custom', 'custom'])
    expect(first.messages.map((message) => message.display)).toEqual([false, false])
    expect(first.messages.map((message) => message.content)).toEqual(
      state.committed.entries.map((entry) => entry.representation.content)
    )
    expect(first.traces.map((trace) => trace.sourceVersionId)).toEqual(
      state.committed.entries.map((entry) => entry.sourceVersionId)
    )

    const unresolved = buildFixture({
      sources: [{ sourceId: 'A', contentHash: 'a-v1' }],
      representationContentRefs: new Map([['A', 'ephemeral://A']])
    })
    let translationError: unknown
    try {
      adapter.render(unresolved.committed)
    } catch (error) {
      translationError = error
    }
    expect(translationError).toBeInstanceOf(PiContextTranslationError)
    expect(translationError).toMatchObject({
      category: 'TRANSLATION_FAILURE',
      code: 'UNRESOLVED_CONTENT_REF'
    })
  })

  it('G2 preserves source/version/representation/rendered identity in sidecar trace', async () => {
    const state = buildFixture({
      sources: [
        { sourceId: 'A', contentHash: 'a-v1' },
        { sourceId: 'B', contentHash: 'b-v3' }
      ]
    })
    const run = await runOfflineHarness(state.committed)
    expectParity(run, state.committed)
    expect(run.request.trace.map((trace) => trace.sourceId)).toEqual(
      state.committed.entries.map((entry) => entry.sourceId)
    )
    expect(run.request.trace.map((trace) => trace.sourceVersionId)).toEqual(
      state.committed.entries.map((entry) => entry.sourceVersionId)
    )
    expect(run.request.trace.map((trace) => trace.representationId)).toEqual(
      state.committed.entries.map((entry) => entry.representation.id)
    )
    expect(JSON.stringify(run.request.payload)).not.toContain('sourceVersionId')
    expect(JSON.stringify(run.request.payload)).not.toContain('renderedHash')
  })

  it('G3 reconstructs from the captured payload rather than the Runtime object', async () => {
    const state = buildFixture({ sources: [{ sourceId: 'A', contentHash: 'a-v1' }] })
    const run = await runOfflineHarness(state.committed)
    const reconstructed = reconstructModelVisibleContext(run.request)
    expect(reconstructed.entries[0]?.content).toBe('A:a-v1:FULL')
    expect(reconstructed.entries[0]?.role).toBe('user')
    expect(reconstructed.entries[0]?.trace.sourceId).toBe('A')
    expect(reconstructed.logicalHash).toBe(run.reconstructed.logicalHash)
    expectParity(run, state.committed)
  })

  it('G4 compares canonical intended and observed context', async () => {
    const state = buildFixture({
      sources: [
        { sourceId: 'A', contentHash: 'a-v1' },
        { sourceId: 'B', contentHash: 'b-v1' }
      ]
    })
    const run = await runOfflineHarness(state.committed)
    expectParity(run, state.committed)
    expect(canonicalizeObservedContext(run.reconstructed).logicalHash).toBe(
      canonicalizeIntendedContext(state.committed).logicalHash
    )
  })

  it.each([
    ['P1 Basic single source', { sources: [{ sourceId: 'A', contentHash: 'a-v1' }] }],
    [
      'P2 Multiple ordered sources',
      {
        sources: [
          { sourceId: 'A', contentHash: 'a-v1' },
          { sourceId: 'B', contentHash: 'b-v1' },
          { sourceId: 'C', contentHash: 'c-v1' }
        ]
      }
    ],
    [
      'P3 FULL plus SUMMARY',
      {
        sources: [
          { sourceId: 'A', contentHash: 'a-v1' },
          { sourceId: 'B', contentHash: 'b-v1' }
        ],
        representationKinds: kindMap([
          ['A', 'FULL'],
          ['B', 'SUMMARY']
        ])
      }
    ],
    [
      'P4 budget rejected source absent',
      {
        sources: [
          { sourceId: 'A', contentHash: 'a-v1' },
          { sourceId: 'B', contentHash: 'b-v1' },
          { sourceId: 'C', contentHash: 'c-v1' }
        ],
        admissionBudget: 2
      }
    ],
    [
      'P5 LAST_GOOD admitted source',
      {
        sources: [{ sourceId: 'A', contentHash: 'a-v1' }],
        unavailableSourceIds: ['A']
      }
    ],
    [
      'P6 same-version SUMMARY to FULL replacement',
      {
        sources: [{ sourceId: 'A', contentHash: 'a-v1' }],
        representationKinds: kindMap([['A', 'FULL']])
      }
    ],
    [
      'P7 source update V1 to V2',
      {
        sources: [{ sourceId: 'A', contentHash: 'a-v2', observedAt: 2 }],
        representationContents: new Map([['A', 'A:a-v2:FULL']])
      }
    ],
    [
      'P8 source removal',
      {
        sources: [
          { sourceId: 'A', contentHash: 'a-v1' },
          { sourceId: 'B', contentHash: 'b-v1' }
        ],
        absentSourceIds: ['B']
      }
    ]
  ] as const)('%s parity passes with zero provider calls', async (_name, options) => {
    const state = buildFixture(options)
    const run = await runOfflineHarness(state.committed)
    expectParity(run, state.committed)
    expect(run.reconstructed.entries.map((entry) => entry.trace.sourceId)).toEqual(
      state.committed.entries.map((entry) => entry.sourceId)
    )
    expect(run.reconstructed.entries.map((entry) => entry.content)).toEqual(
      state.committed.entries.map((entry) => entry.representation.content)
    )
  })

  it('P4 evidence proves rejected C never enters the outbound payload', async () => {
    const state = buildFixture({
      sources: [
        { sourceId: 'A', contentHash: 'a-v1' },
        { sourceId: 'B', contentHash: 'b-v1' },
        { sourceId: 'C', contentHash: 'c-v1' }
      ],
      admissionBudget: 2
    })
    expect(state.receipt.outcomes.find((outcome) => outcome.sourceId === 'C')).toMatchObject({
      status: 'REJECTED',
      reason: 'BUDGET'
    })
    expect(state.committed.entries.map((entry) => entry.sourceId)).toEqual(['A', 'B'])
    const run = await runOfflineHarness(state.committed)
    expectParity(run, state.committed)
    expect(run.reconstructed.entries.map((entry) => entry.trace.sourceId)).not.toContain('C')
    expect(JSON.stringify(run.request.payload)).not.toContain('C:c-v1:FULL')
  })

  it('P5 evidence preserves LAST_GOOD/LAST_GOOD_FALLBACK provenance', async () => {
    const state = buildFixture({
      sources: [{ sourceId: 'A', contentHash: 'a-v1' }],
      unavailableSourceIds: ['A']
    })
    expect(state.receipt.outcomes[0]).toMatchObject({
      status: 'ADMITTED',
      freshness: 'LAST_GOOD',
      admissionBasis: 'LAST_GOOD_FALLBACK'
    })
    const run = await runOfflineHarness(state.committed)
    expectParity(run, state.committed)
    expect(run.request.trace[0]?.sourceVersionId).toBe(state.committed.entries[0]?.sourceVersionId)
  })

  it('P6 materialized representation replacement is what the model sees', async () => {
    const summaryState = buildFixture({
      sources: [{ sourceId: 'A', contentHash: 'a-v1' }],
      representationKinds: kindMap([['A', 'SUMMARY']]),
      representationContents: new Map([['A', 'A:a-v1:SUMMARY']])
    })
    const fullState = buildFixture({
      universe: summaryState.universe,
      previousCommittedWorkingSet: summaryState.committed,
      sources: [{ sourceId: 'A', contentHash: 'a-v1' }],
      representationKinds: kindMap([['A', 'FULL']]),
      representationContents: new Map([['A', 'A:a-v1:FULL']])
    })
    const summaryRun = await runOfflineHarness(summaryState.committed)
    const fullRun = await runOfflineHarness(fullState.committed)
    expectParity(summaryRun, summaryState.committed)
    expectParity(fullRun, fullState.committed)
    expect(summaryRun.reconstructed.entries[0]?.content).toBe('A:a-v1:SUMMARY')
    expect(fullRun.reconstructed.entries[0]?.content).toBe('A:a-v1:FULL')
    expect(summaryState.committed.entries[0]?.sourceVersionId).toBe(
      fullState.committed.entries[0]?.sourceVersionId
    )
    expect(fullState.committed.previousCommittedWorkingSetId).toBe(summaryState.committed.id)
    expect(summaryRun.request.trace[0]?.sourceVersionId).toBe(fullRun.request.trace[0]?.sourceVersionId)
    expect(summaryRun.request.trace[0]?.representationId).not.toBe(fullRun.request.trace[0]?.representationId)
  })

  it('P7 source update emits V2 and never retains V1', async () => {
    const universeV1 = buildUniverse({ sources: [{ sourceId: 'A', contentHash: 'a-v1' }] })
    const universeV2 = reconcileUniverseRevision(universeV1, [
      present({ sourceId: 'A', contentHash: 'a-v2', observedAt: 2 })
    ])
    const state = buildFixture({
      universe: universeV2,
      sources: [{ sourceId: 'A', contentHash: 'a-v2', observedAt: 2 }],
      representationContents: new Map([['A', 'A:a-v2:FULL']])
    })
    const v1 = universeV1.entries.get('A')?.observedVersionId
    expect(v1).toBeDefined()
    expect(state.universe.parentRevisionId).toBe(universeV1.revisionId)
    expect(state.committed.entries[0]?.sourceVersionId).not.toBe(v1)
    const run = await runOfflineHarness(state.committed)
    expectParity(run, state.committed)
    expect(run.reconstructed.entries[0]?.content).toBe('A:a-v2:FULL')
    expect(run.reconstructed.entries[0]?.content).not.toContain('a-v1')
  })

  it('P8 source removal leaves no stale request segment', async () => {
    const state = buildFixture({
      sources: [
        { sourceId: 'A', contentHash: 'a-v1' },
        { sourceId: 'B', contentHash: 'b-v1' }
      ],
      absentSourceIds: ['B']
    })
    const run = await runOfflineHarness(state.committed)
    expectParity(run, state.committed)
    expect(run.reconstructed.entries.map((entry) => entry.trace.sourceId)).toEqual(['A'])
    expect(JSON.stringify(run.request.payload)).not.toContain('B:b-v1:FULL')
  })

  it('negative request mutations classify missing and extra content', async () => {
    const state = buildFixture({ sources: [{ sourceId: 'A', contentHash: 'a-v1' }] })
    const run = await runOfflineHarness(state.committed)
    const payload = run.request.payload as { messages: unknown[] }
    const missingRequest: CapturedModelRequest = {
      ...run.request,
      payload: { ...payload, messages: payload.messages.slice(0, -1) }
    }
    const missing = compareContextParity(
      canonicalizeIntendedContext(state.committed),
      canonicalizeObservedContext(reconstructModelVisibleContext(missingRequest))
    )
    expect(missing.status).toBe('FAIL')
    expect(missing.mismatches.some((item) => item.kind === 'MISSING')).toBe(true)

    const extraRequest: CapturedModelRequest = {
      ...run.request,
      payload: {
        ...payload,
        messages: [
          ...payload.messages,
          { role: 'user', content: [{ type: 'text', text: 'unexpected extra context' }] }
        ]
      }
    }
    const extra = compareContextParity(
      canonicalizeIntendedContext(state.committed),
      canonicalizeObservedContext(reconstructModelVisibleContext(extraRequest))
    )
    expect(extra.status).toBe('FAIL')
    expect(extra.mismatches.some((item) => item.kind === 'EXTRA')).toBe(true)
  })

  it('negative identity, representation, ordering, and content mutations fail closed', async () => {
    const state = buildFixture({
      sources: [
        { sourceId: 'A', contentHash: 'a-v1' },
        { sourceId: 'B', contentHash: 'b-v1' }
      ]
    })
    const run = await runOfflineHarness(state.committed)
    const intended = canonicalizeIntendedContext(state.committed)

    const versionMismatch = compareContextParity(
      intended,
      canonicalizeObservedContext(
        reconstructedWith(run.reconstructed, 0, { trace: { sourceVersionId: 'forged-version' } })
      )
    )
    expect(versionMismatch.mismatches.some((item) => item.kind === 'VERSION_MISMATCH')).toBe(true)

    const representationMismatch = compareContextParity(
      intended,
      canonicalizeObservedContext(
        reconstructedWith(run.reconstructed, 0, {
          trace: { representationId: 'forged-representation', representationKind: 'SUMMARY' }
        })
      )
    )
    expect(representationMismatch.mismatches.some((item) => item.kind === 'REPRESENTATION_MISMATCH')).toBe(true)

    const firstPosition = run.reconstructed.entries[0]?.trace.position
    const secondPosition = run.reconstructed.entries[1]?.trace.position
    if (firstPosition === undefined || secondPosition === undefined) {
      throw new Error('ordering fixture did not produce two entries')
    }
    const reordered = {
      ...run.reconstructed,
      entries: run.reconstructed.entries.map((entry, index) =>
        index === 0
          ? { ...entry, trace: { ...entry.trace, position: secondPosition } }
          : index === 1
            ? { ...entry, trace: { ...entry.trace, position: firstPosition } }
            : entry
      )
    }
    const orderMismatch = compareContextParity(intended, canonicalizeObservedContext(reordered))
    expect(orderMismatch.mismatches.some((item) => item.kind === 'ORDER_MISMATCH')).toBe(true)

    const contentMismatch = compareContextParity(
      intended,
      canonicalizeObservedContext(reconstructedWith(run.reconstructed, 0, { content: 'tampered text' }))
    )
    expect(contentMismatch.mismatches.some((item) => item.kind === 'CONTENT_HASH_MISMATCH')).toBe(true)
  })
})
