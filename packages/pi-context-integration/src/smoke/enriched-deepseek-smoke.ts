import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent'
import type { SnapshotLikeSeed } from '@canvas-agent/context-runtime'
import {
  EnrichedPiShadowObserver,
  PiContextShadowObserver,
  createEnrichedPiContextShadowExtension
} from '../index'

// Opt-in enriched Pi + DeepSeek shadow smoke (CR-002). Requires:
//   DEEPSEEK_API_KEY=<key>  (environment or Pi auth.json)
//   CANVAS_CONTEXT_LIVE_SMOKE=1
// Runs a tiny coding task, decomposes each Pi `context` event into observed
// context elements, attributes them deterministically, advances an immutable
// Shadow Context Universe, and reports attribution coverage + reconciliation.
// Pi messages are returned unchanged. Output is metadata-only.

const DEEPSEEK_PROVIDER = 'deepseek'
const DEEPSEEK_MODEL = process.env['CANVAS_CONTEXT_SMOKE_MODEL'] ?? 'deepseek-v4-flash'
const RESEARCH_DIR = resolve(process.cwd(), '.canvas-agent', 'research', 'context-shadow')

async function run(): Promise<void> {
  if (process.env['CANVAS_CONTEXT_LIVE_SMOKE'] !== '1') {
    console.log('[smoke:cr002] CANVAS_CONTEXT_LIVE_SMOKE=1 is required. SKIPPED')
    console.log('SMOKE_STATUS=SKIPPED')
    return
  }

  const runtime = await ModelRuntime.create()
  const apiKey = process.env['DEEPSEEK_API_KEY']
  if (apiKey !== undefined && apiKey.length > 0) {
    await runtime.setRuntimeApiKey(DEEPSEEK_PROVIDER, apiKey)
  }
  const auth = await runtime.checkAuth(DEEPSEEK_PROVIDER)
  if (auth === undefined) {
    console.log('[smoke:cr002] DeepSeek credentials unavailable (env or Pi auth.json). SKIPPED')
    console.log('SMOKE_STATUS=SKIPPED')
    return
  }

  const model = runtime.getModel(DEEPSEEK_PROVIDER, DEEPSEEK_MODEL)
  if (model === undefined) {
    console.log(`[smoke:cr002] DeepSeek model ${DEEPSEEK_MODEL} not found in catalog. SKIPPED`)
    console.log('SMOKE_STATUS=SKIPPED')
    return
  }

  const fixtureDir = await mkdtemp(join(tmpdir(), 'canvas-pi-smoke-cr002-'))
  try {
    await writeFileIfFresh(
      fixtureDir,
      'notes.md',
      '# Smoke task\n\n- Step 1: list the repository files with the ls tool.\n- Step 2: read notes.md with the read tool.\n- Step 3: write the content of notes.md into copied.txt with the write tool.\n- Step 4: report how many files exist in the fixture directory.\n'
    )

    const sessionId = `smoke-cr002-${new Date().toISOString().replace(/[:.]/g, '-')}`

    const seeds: SnapshotLikeSeed[] = [
      {
        sourceKey: 'repository/file://notes.md',
        sourceKind: 'repository-file',
        contentHash: 'seed-notes-hash-placeholder',
        authority: 'REFERENCE',
        priority: 'P2',
        provenance: 'snapshot-seed',
        observedAt: new Date().toISOString()
      }
    ]
    const base = new PiContextShadowObserver({ runtimeSessionId: sessionId })
    const observer = new EnrichedPiShadowObserver({ base, seeds })

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 1 }
    })
    const loader = new DefaultResourceLoader({
      cwd: fixtureDir,
      agentDir: join(fixtureDir, '.pi-agent'),
      settingsManager,
      extensionFactories: [
        {
          name: 'canvas-context-shadow-enriched',
          factory: createEnrichedPiContextShadowExtension({ observer })
        }
      ]
    })
    await loader.reload()

    const { session } = await createAgentSession({
      cwd: fixtureDir,
      model,
      modelRuntime: runtime,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(fixtureDir),
      settingsManager,
      tools: ['ls', 'read', 'write']
    })

    const prompt =
      'Complete the small smoke task in this fixture. Use the available tools. Be concise.'
    await session.prompt(prompt)

    // Metadata-only JSONL: one line per model call with attribution summary and
    // universe state. No raw prompt/tool-result content.
    const lines = observer.callResults.map((call) =>
      JSON.stringify({
        kind: 'enriched-model-call',
        runtimeSessionId: sessionId,
        modelCallSequence: call.universeRevision.modelCallSequence,
        observedElements: call.elements.length,
        attribution: {
          exact: call.attributionSummary.exact,
          derivedHint: call.attributionSummary.derivedHint,
          unattributed: call.attributionSummary.unattributed,
          opaque: call.attributionSummary.opaque,
          resourceHints: call.attributionSummary.resourceHints
        },
        sourceObservations: call.sourceObservations.length,
        universeRevision: call.universeRevision.sequence,
        universeSources: call.universeRevision.entries.length,
        logicalHash: call.universeRevision.logicalHash
      })
    )
    // First line records the seed revision (#0) for replay context.
    lines.unshift(
      JSON.stringify({
        kind: 'universe-seed',
        runtimeSessionId: sessionId,
        universeRevision: 0,
        seeds: seeds.map((seed) => seed.sourceKey)
      })
    )
    const fs = await import('node:fs/promises')
    const path = join(RESEARCH_DIR, `${sessionId}.jsonl`)
    await fs.mkdir(RESEARCH_DIR, { recursive: true })
    await fs.appendFile(path, lines.join('\n') + '\n', 'utf8')

    console.log(`[smoke:cr002] runtimeSessionId=${sessionId}`)
    console.log(`[smoke:cr002] provider=${DEEPSEEK_PROVIDER} model=${DEEPSEEK_MODEL}`)
    console.log(`[smoke:cr002] observed model-call count=${observer.callResults.length}`)
    const finalUniverse = observer.universeRevision
    if (finalUniverse !== null) {
      console.log(`[smoke:cr002] final universe revision=${finalUniverse.sequence}`)
      console.log(`[smoke:cr002] final universe sources=${finalUniverse.entries.length}`)
      console.log(`[smoke:cr002] final universe logicalHash=${finalUniverse.logicalHash.slice(0, 16)}...`)
      const summary = finalUniverse.attributionSummary
      if (summary !== null) {
        console.log(
          `[smoke:cr002] attribution EXACT=${summary.exact} DERIVED_HINT=${summary.derivedHint} UNATTRIBUTED=${summary.unattributed} OPAQUE=${summary.opaque} RESOURCE_HINTS=${summary.resourceHints}`
        )
      }
    }
    console.log(`[smoke:cr002] jsonl=${path}`)
    console.log('SMOKE_STATUS=EXECUTED')
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
}

async function writeFileIfFresh(directory: string, name: string, content: string): Promise<void> {
  await writeFile(join(directory, name), content, 'utf8')
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[smoke:cr002] FAILED: ${message}`)
    console.error('SMOKE_STATUS=FAILED')
    process.exit(1)
  })
