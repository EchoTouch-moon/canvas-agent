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
  type UniverseObservation
} from '@canvas-agent/context-runtime'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent'
import {
  canonicalizeIntendedContext,
  canonicalizeObservedContext,
  compareContextParity,
  createPiRequestParityExtension,
  InMemoryModelRequestCapture,
  reconstructModelVisibleContext
} from '../index'

const DEEPSEEK_PROVIDER = 'deepseek'
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'
const OPT_IN_VARIABLE = 'CANVAS_CONTEXT_REAL_SMOKE'
const API_KEY_VARIABLE = 'DEEPSEEK_API_KEY'

type SmokeStatus = 'EXECUTED' | 'SKIPPED' | 'FAILED'

interface SmokeSummary {
  readonly status: SmokeStatus
  readonly provider: string
  readonly model: string
  readonly providerCalls: number
  readonly transportStopCount: number
  readonly capturedRequests: number
  readonly parity: 'PASS' | 'FAIL' | 'NOT_RUN'
  readonly intendedHash?: string
  readonly observedHash?: string
}

function logSummary(summary: SmokeSummary): void {
  console.log(`[cr-011] provider=${summary.provider} model=${summary.model}`)
  console.log(`[cr-011] providerCalls=${String(summary.providerCalls)}`)
  console.log(`[cr-011] transportStopCount=${String(summary.transportStopCount)}`)
  console.log(`[cr-011] capturedRequests=${String(summary.capturedRequests)}`)
  console.log(`[cr-011] parity=${summary.parity}`)
  if (summary.intendedHash !== undefined) {
    console.log(`[cr-011] intendedHash=${summary.intendedHash}`)
  }
  if (summary.observedHash !== undefined) {
    console.log(`[cr-011] observedHash=${summary.observedHash}`)
  }
  console.log(`SMOKE_STATUS=${summary.status}`)
}

function redactSecret(message: string, secret: string): string {
  return secret.length === 0 ? message : message.split(secret).join('[redacted]')
}

function buildCommittedFixture(): CommittedWorkingSet {
  const sourceId = 'cr011/fixture'
  const observation: UniverseObservation = {
    sourceId,
    observationState: 'PRESENT',
    contentHash: 'cr011-fixture-content-v1',
    observedAt: 1,
    providerVersion: 'cr011-fixture-provider-v1'
  }
  const universe = reconcileUniverseRevision(
    createEmptyUniverseRevision(0),
    [observation]
  )
  const proposal = planProposedWorkingSet({
    universe,
    previousCommittedWorkingSet: null,
    policy: {
      version: 'cr011-fixture-planner-v1',
      budget: { maxSemanticTokens: 8 },
      represent: (_entry, version) =>
        createRepresentation({
          kind: 'FULL',
          sourceVersionIds: [version.versionId],
          contentHash: 'cr011-fixture-representation-v1',
          tokenEstimate: 1,
          lossiness: 'NONE',
          derivation: { fixture: 'cr-011' },
          content: 'CR-011 parity fixture: deterministic marker visible to the model.'
        })
    },
    taskHints: { mandatorySourceIds: [sourceId] },
    createdAt: 2
  })
  const adapter: AdmissionAdapter = {
    adapterId: 'cr011-fixture-adapter',
    adapterVersion: '1',
    render: (representations) =>
      representations.map((representation) => representation.content ?? '').join('\n')
  }
  const receipt = admitWorkingSet({
    universe,
    proposal,
    budget: { maxSemanticTokens: 8 },
    adapter,
    createdAt: 3
  })
  return commitAdmission({
    universe,
    proposal,
    receipt,
    previousCommittedWorkingSet: null
  })
}

async function run(): Promise<void> {
  const modelId = process.env['CANVAS_CONTEXT_REAL_SMOKE_MODEL'] ?? DEFAULT_DEEPSEEK_MODEL
  const apiKey = process.env[API_KEY_VARIABLE]

  if (process.env[OPT_IN_VARIABLE] !== '1') {
    logSummary({
      status: 'SKIPPED',
      provider: DEEPSEEK_PROVIDER,
      model: modelId,
      providerCalls: 0,
      transportStopCount: 0,
      capturedRequests: 0,
      parity: 'NOT_RUN'
    })
    return
  }
  if (apiKey === undefined || apiKey.length === 0) {
    console.log(`[cr-011] ${API_KEY_VARIABLE} is required when ${OPT_IN_VARIABLE}=1`)
    logSummary({
      status: 'SKIPPED',
      provider: DEEPSEEK_PROVIDER,
      model: modelId,
      providerCalls: 0,
      transportStopCount: 0,
      capturedRequests: 0,
      parity: 'NOT_RUN'
    })
    return
  }

  const committed = buildCommittedFixture()
  const cwd = await mkdtemp(join(tmpdir(), 'canvas-cr011-parity-'))
  const capture = new InMemoryModelRequestCapture()
  const originalFetch = globalThis.fetch
  let providerCalls = 0
  let transportStopCount = 0
  let session: { dispose(): void } | undefined

  try {
    const runtime = await ModelRuntime.create({
      allowModelNetwork: false,
      refreshOnCreate: false,
      modelsPath: null,
      authPath: join(cwd, 'auth.json')
    })
    await runtime.setRuntimeApiKey(DEEPSEEK_PROVIDER, apiKey)
    const model = runtime.getModel(DEEPSEEK_PROVIDER, modelId)
    if (model === undefined) {
      throw new Error(`static DeepSeek model metadata is unavailable for ${modelId}`)
    }
    if (model.api !== 'openai-completions') {
      throw new Error(`CR-011 supports openai-completions only; received ${model.api}`)
    }

    if (typeof originalFetch !== 'function') {
      throw new Error('global fetch is unavailable')
    }
    globalThis.fetch = async (input, init) => {
      providerCalls += 1
      return originalFetch(input, init)
    }

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
          name: 'canvas-cr011-request-parity',
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
    await created.session.prompt(
      'Return exactly one short sentence confirming the parity fixture is visible. Do not call tools.'
    )

    const request = capture.latest()
    if (request === undefined) {
      throw new Error(
        `request capture did not produce a payload: ${capture.errors.map((error) => error.code).join(',')}`
      )
    }
    if (capture.requests.length !== 1) {
      throw new Error(`expected exactly one captured request, received ${capture.requests.length}`)
    }
    if (providerCalls !== 1) {
      throw new Error(`expected exactly one provider call, received ${providerCalls}`)
    }
    const reconstructed = reconstructModelVisibleContext(request)
    const intended = canonicalizeIntendedContext(committed)
    const observed = canonicalizeObservedContext(reconstructed)
    const parity = compareContextParity(intended, observed)
    if (parity.status !== 'PASS') {
      throw new Error(`parity failed: ${parity.mismatches.map((mismatch) => mismatch.kind).join(',')}`)
    }
    if (capture.errors.length > 0) {
      throw new Error(`request capture reported ${capture.errors.length} error(s)`)
    }

    logSummary({
      status: 'EXECUTED',
      provider: request.provider,
      model: request.model,
      providerCalls,
      transportStopCount,
      capturedRequests: capture.requests.length,
      parity: parity.status,
      intendedHash: intended.logicalHash,
      observedHash: observed.logicalHash
    })
  } finally {
    session?.dispose()
    globalThis.fetch = originalFetch
    await rm(cwd, { recursive: true, force: true })
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const apiKey = process.env[API_KEY_VARIABLE] ?? ''
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[cr-011] FAILED: ${redactSecret(message, apiKey)}`)
    console.error('SMOKE_STATUS=FAILED')
    process.exit(1)
  })
