import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  createPiContextShadowExtension
} from '../index'

// Opt-in live Pi + DeepSeek smoke (CR-001). Requires:
//   DEEPSEEK_API_KEY=<key>  (environment or Pi auth.json)
//   CANVAS_CONTEXT_LIVE_SMOKE=1
// It runs one tiny coding task in a temporary fixture workspace, observes every
// Pi `context` event with the shadow extension, records a metadata-only JSONL
// trace under .canvas-agent/research/context-shadow/, and reports the real
// observed model-call count. Credentials never leave the environment and never
// appear in committed output.

const DEEPSEEK_PROVIDER = 'deepseek'
const DEEPSEEK_MODEL = process.env['CANVAS_CONTEXT_SMOKE_MODEL'] ?? 'deepseek-v4-flash'
const RESEARCH_DIR = resolve(process.cwd(), '.canvas-agent', 'research', 'context-shadow')

type SmokeStatus = 'EXECUTED' | 'SKIPPED' | 'FAILED'

async function writeFileIfFresh(directory: string, name: string, content: string): Promise<string> {
  const path = join(directory, name)
  await writeFile(path, content, 'utf8')
  return path
}

async function run(): Promise<void> {
  if (process.env['CANVAS_CONTEXT_LIVE_SMOKE'] !== '1') {
    console.log('[smoke] CANVAS_CONTEXT_LIVE_SMOKE=1 is required. SKIPPED')
    console.log('SMOKE_STATUS=SKIPPED')
    return
  }

  const runtime = await ModelRuntime.create()
  const apiKey = process.env['DEEPSEEK_API_KEY']
  // Credentials come from the environment or Pi's official auth.json store. If
  // the env var is absent we fall back to whatever Pi resolves (auth.json), and
  // only run when Pi reports the DeepSeek provider configured.
  if (apiKey !== undefined && apiKey.length > 0) {
    await runtime.setRuntimeApiKey(DEEPSEEK_PROVIDER, apiKey)
  }
  const auth = await runtime.checkAuth(DEEPSEEK_PROVIDER)
  if (auth === undefined) {
    console.log('[smoke] DeepSeek credentials unavailable (env or Pi auth.json). SKIPPED')
    console.log('SMOKE_STATUS=SKIPPED')
    return
  }

  const model = runtime.getModel(DEEPSEEK_PROVIDER, DEEPSEEK_MODEL)
  if (model === undefined) {
    console.log(`[smoke] DeepSeek model ${DEEPSEEK_MODEL} not found in catalog. SKIPPED`)
    console.log('SMOKE_STATUS=SKIPPED')
    return
  }

  const fixtureDir = await mkdtemp(join(tmpdir(), 'canvas-pi-smoke-'))
  try {
    const notesPath = await writeFileIfFresh(
      fixtureDir,
      'notes.md',
      '# Smoke task\n\n- Step 1: list the repository files with the ls tool.\n- Step 2: read notes.md with the read tool.\n- Step 3: write the content of notes.md into copied.txt with the write tool.\n- Step 4: report how many files exist in the fixture directory.\n'
    )
    void notesPath

    const sessionId = `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`
    const jsonlSink = new JsonlObservationSink({ directory: RESEARCH_DIR, sessionId })
    const observer = new PiContextShadowObserver({
      runtimeSessionId: sessionId
    })

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
          name: 'canvas-context-shadow',
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
      tools: ['ls', 'read', 'write']
    })

    const prompt =
      'Complete the small smoke task in this fixture. Use the available tools. Be concise.'
    await session.prompt(prompt)

    const observations = observer.inMemory.observations
    for (const observation of observations) {
      jsonlSink.write(observation)
    }
    await jsonlSink.flush()

    console.log(`[smoke] runtimeSessionId=${sessionId}`)
    console.log(`[smoke] provider=${DEEPSEEK_PROVIDER} model=${DEEPSEEK_MODEL}`)
    console.log(`[smoke] observed model-call count=${observations.length}`)
    console.log(`[smoke] jsonl=${jsonlSink.path}`)
    console.log('SMOKE_STATUS=EXECUTED')
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[smoke] FAILED: ${message}`)
    console.error('SMOKE_STATUS=FAILED')
    process.exit(1)
  })
