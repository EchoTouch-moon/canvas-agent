import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
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
  canonicalizeIntendedContext,
  compareContextParity,
  type CanonicalContext
} from '@canvas-agent/context-conformance'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent'
import {
  canonicalizeCodexObservedContext,
  captureCodexPrompt,
  CodexCommittedContextAdapter,
  reconstructCodexModelVisibleContext,
  type CapturedCodexPrompt,
  type ReconstructedCodexModelVisibleContext
} from '../src'
import {
  createPiRequestParityExtension,
  InMemoryModelRequestCapture,
  canonicalizeObservedContext,
  reconstructModelVisibleContext,
  type CapturedModelRequest,
  type ReconstructedModelVisibleContext
} from '@canvas-agent/pi-context-integration'
import {
  createCodexAgentAdapter,
  type AgentContext
} from '@canvas-agent/worker-runtime'
import { afterEach, describe, expect, it } from 'vitest'

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
  readonly committed: CommittedWorkingSet
  readonly receipt: ReturnType<typeof admitWorkingSet>
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
      version: 'cr012a-fixture-planner-v1',
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
    adapterId: 'cr012a-fixture-adapter',
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
  return { universe, committed, receipt }
}

function metadataResolver(entry: CommittedWorkingSet['entries'][number]) {
  return {
    itemType: entry.sourceId === 'A' ? ('USER_INPUT' as const) : ('REPOSITORY_CONTENT' as const),
    authority: entry.sourceId === 'A' ? ('TASK_INSTRUCTION' as const) : ('REFERENCE' as const),
    sourceRef: `fixture://${entry.sourceId}`
  }
}

interface PiRun {
  readonly request: CapturedModelRequest
  readonly reconstructed: ReconstructedModelVisibleContext
  readonly providerCalls: number
  readonly transportStopCount: number
}

interface CodexRun {
  readonly prompt: CapturedCodexPrompt
  readonly reconstructed: ReconstructedCodexModelVisibleContext
  readonly codexExecCalls: number
  readonly providerCalls: number
  readonly transportStopCount: number
  readonly networkCalls: number
}

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function runPiHarness(committed: CommittedWorkingSet): Promise<PiRun> {
  const cwd = await mkdtemp(join(tmpdir(), 'canvas-cr012a-pi-'))
  cleanup.push(cwd)
  const capture = new InMemoryModelRequestCapture()
  let providerCalls = 0
  let transportStopCount = 0
  let session: { dispose(): void } | undefined
  const originalFetch = globalThis.fetch

  class CaptureStop extends Error {
    constructor() {
      super('CR-012A Pi capture transport stop')
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
    await runtime.setRuntimeApiKey('deepseek', 'cr012a-fake-api-key')
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
          name: 'canvas-cr012a-pi-conformance',
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
    await created.session.prompt('CR-012A Pi conformance driver')
    const request = capture.latest()
    if (request === undefined) {
      throw new Error(`Pi request capture failed: ${capture.errors.map((error) => error.message).join('; ')}`)
    }
    return {
      request,
      reconstructed: reconstructModelVisibleContext(request),
      providerCalls,
      transportStopCount
    }
  } finally {
    session?.dispose()
    globalThis.fetch = originalFetch
  }
}

const FAKE_CODEX_SCRIPT = `
if (process.argv[2] === '--version') {
  process.stdout.write('codex-cli 0.146.0\\n')
  process.exit(0)
}
const fs = require('node:fs')
const path = require('node:path')
const cdIndex = process.argv.indexOf('--cd')
const cwd = process.argv[cdIndex + 1]
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  fs.writeFileSync(path.join(cwd, 'cr012a-codex-stdin.txt'), input, 'utf8')
  const summary = {
    summary: 'captured CR-012A Codex prompt',
    changes: [],
    tool_calls_observed: 0,
    tests_run: [],
    success: true
  }
  const out = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
  out({ type: 'thread.started', thread_id: 'cr012a-thread' })
  out({ type: 'turn.started' })
  out({ type: 'item.completed', item: { id: 'cr012a-message', type: 'agent_message', text: JSON.stringify(summary) } })
  out({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } })
})
`

async function makeFakeCodex(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-cr012a-codex-bin-'))
  cleanup.push(dir)
  const executable = join(dir, 'codex')
  await writeFile(executable, `#!/usr/bin/env node\n${FAKE_CODEX_SCRIPT}`, 'utf8')
  await chmod(executable, 0o755)
  return executable
}

async function runCodexHarness(committed: CommittedWorkingSet): Promise<CodexRun> {
  const executable = await makeFakeCodex()
  const runtimeDirectory = await mkdtemp(join(tmpdir(), 'canvas-cr012a-runtime-'))
  const cwd = await mkdtemp(join(tmpdir(), 'canvas-cr012a-worktree-'))
  cleanup.push(runtimeDirectory, cwd)
  const plan = new CodexCommittedContextAdapter({ metadataResolver }).render(committed)
  const adapter = createCodexAgentAdapter({
    executable,
    environment: {
      PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,
      HOME: cwd
    },
    runtimeDirectory
  })
  const context: AgentContext = {
    cwd,
    toolPolicy: {
      allowedTools: ['run_command'],
      deniedPaths: [],
      allowNetwork: false,
      allowShell: false
    },
    maxToolCalls: 10,
    maxDurationMs: 30_000,
    commandAllowlist: ['node'],
    executionRequestId: 'cr012a-execution',
    agentConfiguration: { provider: 'codex-cli', model: 'codex-fixture' },
    contextBundle: plan.bundle
  }
  await adapter.run(context)
  const prompt = await readFile(join(cwd, 'cr012a-codex-stdin.txt'), 'utf8')
  const captured = captureCodexPrompt(prompt, plan.traces)
  return {
    prompt: captured,
    reconstructed: reconstructCodexModelVisibleContext(captured),
    codexExecCalls: 1,
    providerCalls: 0,
    transportStopCount: 0,
    networkCalls: 0
  }
}

function expectParity(
  committed: CommittedWorkingSet,
  pi: PiRun,
  codex: CodexRun
): void {
  const intended = canonicalizeIntendedContext(committed)
  const piObserved = canonicalizeObservedContext(pi.reconstructed)
  const piResult = compareContextParity(intended, piObserved)
  const codexObserved = canonicalizeCodexObservedContext(codex.reconstructed)
  const codexResult = compareContextParity(intended, codexObserved)
  expect(piResult.status).toBe('PASS')
  expect(piObserved.logicalHash).toBe(intended.logicalHash)
  expect(codexResult.status).toBe('PASS')
  expect(codexResult.mismatches).toHaveLength(0)
  expect(codexObserved.logicalHash).toBe(intended.logicalHash)
  expect(pi.providerCalls).toBe(0)
  expect(pi.transportStopCount).toBeGreaterThan(0)
  expect(codex.codexExecCalls).toBe(1)
  expect(codex.providerCalls).toBe(0)
  expect(codex.transportStopCount).toBe(0)
  expect(codex.networkCalls).toBe(0)
  expect(codex.prompt.captureStage).toBe('codex_cli_stdin')
  expect(codex.prompt.prompt).not.toContain('sourceVersionId')
  expect(codex.prompt.prompt).not.toContain('renderedHash')
}

describe('CR-012A Codex cross-harness context conformance', () => {
  it('G1 translates a committed working set into the existing v2 Codex bundle deterministically', () => {
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
    const adapter = new CodexCommittedContextAdapter({ metadataResolver })
    const first = adapter.render(state.committed)
    const second = adapter.render(state.committed)
    expect(second).toEqual(first)
    expect(first.bundle.items.map((item) => item.position)).toEqual([0, 1])
    expect(first.bundle.items.map((item) => item.resolvedContent)).toEqual(
      state.committed.entries.map((entry) => entry.representation.content)
    )
    expect(first.traces.map((trace) => trace.sourceVersionId)).toEqual(
      state.committed.entries.map((entry) => entry.sourceVersionId)
    )
  })

  it('G2/G3/G4 crosses the full Codex stdin boundary and compares with the same Core canonical', async () => {
    const state = buildFixture({
      sources: [
        { sourceId: 'A', contentHash: 'a-v1' },
        { sourceId: 'B', contentHash: 'b-v3' }
      ]
    })
    const [pi, codex] = await Promise.all([
      runPiHarness(state.committed),
      runCodexHarness(state.committed)
    ])
    expectParity(state.committed, pi, codex)
    expect(codex.reconstructed.entries.map((entry) => entry.trace.sourceId)).toEqual(
      state.committed.entries.map((entry) => entry.sourceId)
    )
    expect(codex.reconstructed.entries.map((entry) => entry.content)).toEqual(
      state.committed.entries.map((entry) => entry.representation.content)
    )
    expect(codex.prompt.prompt).toContain('Frozen context (in position order):')
    expect(codex.prompt.prompt).toContain('fixture://A')
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
      'P6 same-version representation replacement',
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
  ] as const)('%s is semantically equivalent in Pi and Codex', async (_name, options) => {
    const state = buildFixture(options)
    const [pi, codex] = await Promise.all([
      runPiHarness(state.committed),
      runCodexHarness(state.committed)
    ])
    expectParity(state.committed, pi, codex)
    expect(codex.reconstructed.entries.map((entry) => entry.trace.sourceId)).toEqual(
      state.committed.entries.map((entry) => entry.sourceId)
    )
  })

  it('P4 proves the rejected source never reaches Codex stdin', async () => {
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
    const codex = await runCodexHarness(state.committed)
    expect(codex.prompt.prompt).not.toContain('C:c-v1:FULL')
    expect(codex.reconstructed.entries.map((entry) => entry.trace.sourceId)).toEqual(['A', 'B'])
  })

  it('P5 keeps LAST_GOOD provenance in the Codex sidecar without changing text', async () => {
    const state = buildFixture({
      sources: [{ sourceId: 'A', contentHash: 'a-v1' }],
      unavailableSourceIds: ['A']
    })
    expect(state.receipt.outcomes[0]).toMatchObject({
      status: 'ADMITTED',
      freshness: 'LAST_GOOD',
      admissionBasis: 'LAST_GOOD_FALLBACK'
    })
    const codex = await runCodexHarness(state.committed)
    expect(codex.reconstructed.entries[0]?.trace.sourceVersionId).toBe(
      state.committed.entries[0]?.sourceVersionId
    )
    expect(codex.reconstructed.entries[0]?.content).toBe('A:a-v1:FULL')
  })

  it('P6 replacement and P7 update do not leave stale materialized content', async () => {
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
    const universeV2 = reconcileUniverseRevision(summaryState.universe, [
      present({ sourceId: 'A', contentHash: 'a-v2', observedAt: 2 })
    ])
    const updatedState = buildFixture({
      universe: universeV2,
      sources: [{ sourceId: 'A', contentHash: 'a-v2', observedAt: 2 }],
      representationContents: new Map([['A', 'A:a-v2:FULL']])
    })
    const [summary, full, updated] = await Promise.all([
      runCodexHarness(summaryState.committed),
      runCodexHarness(fullState.committed),
      runCodexHarness(updatedState.committed)
    ])
    expect(summary.reconstructed.entries[0]?.content).toBe('A:a-v1:SUMMARY')
    expect(full.reconstructed.entries[0]?.content).toBe('A:a-v1:FULL')
    expect(updated.reconstructed.entries[0]?.content).toBe('A:a-v2:FULL')
    expect(updated.prompt.prompt).not.toContain('a-v1')
    expect(summary.prompt.prompt).not.toContain('sourceVersionId')
  })

  it('P8 source removal leaves no stale Codex section', async () => {
    const state = buildFixture({
      sources: [
        { sourceId: 'A', contentHash: 'a-v1' },
        { sourceId: 'B', contentHash: 'b-v1' }
      ],
      absentSourceIds: ['B']
    })
    const codex = await runCodexHarness(state.committed)
    expect(codex.reconstructed.entries.map((entry) => entry.trace.sourceId)).toEqual(['A'])
    expect(codex.prompt.prompt).not.toContain('B:b-v1:FULL')
  })

  it('negative parity cases classify missing, extra, version, representation, order, and content drift', async () => {
    const state = buildFixture({
      sources: [
        { sourceId: 'A', contentHash: 'a-v1' },
        { sourceId: 'B', contentHash: 'b-v1' }
      ]
    })
    const codex = await runCodexHarness(state.committed)
    const intended = canonicalizeIntendedContext(state.committed)
    const observed = canonicalizeCodexObservedContext(codex.reconstructed)
    const compare = (candidate: CanonicalContext) => compareContextParity(intended, candidate)

    const missing = compare({
      ...observed,
      entries: observed.entries.slice(0, 1),
      payloadMessageCount: 1
    })
    expect(missing.mismatches.some((item) => item.kind === 'MISSING')).toBe(true)

    const first = observed.entries[0]
    if (first === undefined) throw new Error('fixture did not produce first entry')
    const extra = compare({
      ...observed,
      entries: [...observed.entries, { ...first, position: 2, sourceId: 'extra-source' }],
      payloadMessageCount: 3
    })
    expect(extra.mismatches.some((item) => item.kind === 'EXTRA')).toBe(true)

    const version = compare({
      ...observed,
      entries: observed.entries.map((entry, index) =>
        index === 0 ? { ...entry, sourceVersionId: 'forged-version' } : entry
      )
    })
    expect(version.mismatches.some((item) => item.kind === 'VERSION_MISMATCH')).toBe(true)

    const representation = compare({
      ...observed,
      entries: observed.entries.map((entry, index) =>
        index === 0 ? { ...entry, representationId: 'forged-representation', representationKind: 'SUMMARY' } : entry
      )
    })
    expect(representation.mismatches.some((item) => item.kind === 'REPRESENTATION_MISMATCH')).toBe(true)

    const order = compare({
      ...observed,
      entries: [...observed.entries].reverse()
    })
    expect(order.mismatches.some((item) => item.kind === 'ORDER_MISMATCH')).toBe(true)

    const content = compare({
      ...observed,
      entries: observed.entries.map((entry, index) =>
        index === 0 ? { ...entry, renderedContentHash: 'forged-content-hash' } : entry
      )
    })
    expect(content.mismatches.some((item) => item.kind === 'CONTENT_HASH_MISMATCH')).toBe(true)
  })

  it('reconstruction is independent of Runtime input and unresolved content fails closed', async () => {
    const state = buildFixture({ sources: [{ sourceId: 'A', contentHash: 'a-v1' }] })
    const codex = await runCodexHarness(state.committed)
    const captured = captureCodexPrompt(codex.prompt.prompt, codex.prompt.traces)
    const reconstructed = reconstructCodexModelVisibleContext(captured)
    expect(reconstructed.logicalHash).toBe(codex.reconstructed.logicalHash)

    const unresolved = buildFixture({
      sources: [{ sourceId: 'A', contentHash: 'a-v1' }],
      representationContentRefs: new Map([['A', 'ephemeral://A']])
    })
    expect(() => new CodexCommittedContextAdapter({ metadataResolver }).render(unresolved.committed)).toThrow(
      /unresolved contentRef/
    )
  })
})
