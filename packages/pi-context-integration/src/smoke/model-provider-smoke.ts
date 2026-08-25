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
import { JsonlObservationSink } from '@canvas-agent/context-runtime'
import {
  PiContextShadowObserver,
  createPiContextShadowExtension,
  prepareModelProvider,
  safeProviderSelection
} from '../index'

// Opt-in generic provider smoke. Requires:
//   CANVAS_CONTEXT_LIVE_SMOKE=1
//   STEP_PLAN_API_KEY=<key> (preferred) or DEEPSEEK_API_KEY=<key> (fallback)
//
// Provider selection is completed before the first model call. A provider
// failure after session.prompt() starts is terminal; this smoke never switches
// providers mid-run. Output is metadata-only.

const RESEARCH_DIR = resolve(process.cwd(), '.canvas-agent', 'research', 'context-shadow')

async function run(): Promise<void> {
  if (process.env['CANVAS_CONTEXT_LIVE_SMOKE'] !== '1') {
    console.log('[smoke:provider] CANVAS_CONTEXT_LIVE_SMOKE=1 is required. SKIPPED')
    console.log('SMOKE_STATUS=SKIPPED')
    return
  }

  const runtime = await ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false })
  const prepared = await prepareModelProvider(runtime)
  const safeSelection = safeProviderSelection(prepared.selection)
  const model = prepared.model
  const fixtureDir = await mkdtemp(join(tmpdir(), 'canvas-pi-provider-smoke-'))
  try {
    await writeFile(
      join(fixtureDir, 'notes.md'),
      '# Smoke task\n\nUse the available tools to read this file and report its title.\n',
      'utf8'
    )
    const sessionId = `smoke-provider-${new Date().toISOString().replace(/[:.]/g, '-')}`
    const jsonlSink = new JsonlObservationSink({ directory: RESEARCH_DIR, sessionId })
    const observer = new PiContextShadowObserver({ runtimeSessionId: sessionId })
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 }
    })
    const loader = new DefaultResourceLoader({
      cwd: fixtureDir,
      agentDir: join(fixtureDir, '.pi-agent'),
      settingsManager,
      extensionFactories: [
        {
          name: 'canvas-context-provider-smoke',
          factory: createPiContextShadowExtension({ observer })
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
      tools: ['read']
    })
    await session.prompt('Read notes.md with the available tool and report the title. Be concise.')
    for (const observation of observer.inMemory.observations) jsonlSink.write(observation)
    await jsonlSink.flush()
    console.log(`[smoke:provider] runtimeSessionId=${sessionId}`)
    console.log(`[smoke:provider] selection=${JSON.stringify(safeSelection)}`)
    console.log(
      `[smoke:provider] observed model-call count=${observer.inMemory.observations.length}`
    )
    console.log(`[smoke:provider] jsonl=${jsonlSink.path}`)
    console.log('SMOKE_STATUS=EXECUTED')
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[smoke:provider] FAILED: ${message}`)
    console.error('SMOKE_STATUS=FAILED')
    process.exit(1)
  })
