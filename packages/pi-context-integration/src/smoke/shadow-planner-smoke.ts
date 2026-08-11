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
import {
  EnrichedPiShadowObserver,
  PiContextShadowObserver,
  ShadowPlannerObserver,
  createShadowPlannerPiExtension
} from '../index'

// Opt-in CR-003A Shadow Planner smoke. Requires DEEPSEEK_API_KEY (or Pi
// auth.json) + CANVAS_CONTEXT_LIVE_SMOKE=1.
//
// This smoke exercises the REAL planning seam: the Pi `context` extension
// factory invokes ShadowPlannerObserver.observeModelCall inside the callback
// (observe -> advance Universe -> plan -> record Shadow plan), then returns the
// ORIGINAL messages unchanged. Continuity is real: the observer passes the
// actual previous Shadow Working Set to Policy V0, so unchanged history yields
// KEEP instead of repeated ADD. The native estimate is the real CR-001
// ModelCallObservation.observedMessageTokenEstimate, not a placeholder.
//
// Output is metadata-only.

const DEEPSEEK_PROVIDER = 'deepseek'
const DEEPSEEK_MODEL = process.env['CANVAS_CONTEXT_SMOKE_MODEL'] ?? 'deepseek-v4-flash'
const RESEARCH_DIR = resolve(process.cwd(), '.canvas-agent', 'research', 'context-shadow')

async function run(): Promise<void> {
  if (process.env['CANVAS_CONTEXT_LIVE_SMOKE'] !== '1') {
    console.log('[smoke:cr003] CANVAS_CONTEXT_LIVE_SMOKE=1 is required. SKIPPED')
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
    console.log('[smoke:cr003] DeepSeek credentials unavailable (env or Pi auth.json). SKIPPED')
    console.log('SMOKE_STATUS=SKIPPED')
    return
  }
  const model = runtime.getModel(DEEPSEEK_PROVIDER, DEEPSEEK_MODEL)
  if (model === undefined) {
    console.log(`[smoke:cr003] DeepSeek model ${DEEPSEEK_MODEL} not found in catalog. SKIPPED`)
    console.log('SMOKE_STATUS=SKIPPED')
    return
  }

  const fixtureDir = await mkdtemp(join(tmpdir(), 'canvas-pi-smoke-cr003-'))
  try {
    await writeFileIfFresh(
      fixtureDir,
      'notes.md',
      '# Smoke task\n\n- Step 1: list the repository files with the ls tool.\n- Step 2: read notes.md with the read tool.\n- Step 3: write the content of notes.md into copied.txt with the write tool.\n- Step 4: report how many files exist in the fixture directory.\n'
    )

    const sessionId = `smoke-cr003-${new Date().toISOString().replace(/[:.]/g, '-')}`
    const base = new PiContextShadowObserver({ runtimeSessionId: sessionId })
    const enriched = new EnrichedPiShadowObserver({ base })
    const planner = new ShadowPlannerObserver({ enriched, policyVersion: 'policy-v0' })

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
          name: 'canvas-context-shadow-planner',
          factory: createShadowPlannerPiExtension({ observer: planner })
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

    const lines = planner.callResults.map((call, index) =>
      JSON.stringify({
        kind: 'shadow-plan',
        runtimeSessionId: sessionId,
        modelCallSequence: index + 1,
        universeSequence: call.plannerResult.workingSet.plannedFromUniverseSequence,
        universeHash: call.plannerResult.workingSet.plannedFromUniverseHash.slice(0, 16),
        workingSetId: call.plannerResult.workingSet.workingSetId,
        previousWorkingSetId: call.plannerResult.workingSet.previousWorkingSetId,
        policyVersion: call.plannerResult.workingSet.policyVersion,
        proposedTokenEstimate: call.plannerResult.workingSet.totalTokenEstimate,
        nativeContextEstimate: call.metrics.nativeContextEstimate,
        nativeEstimateScope: call.metrics.nativeEstimateScope,
        decisions: call.plannerResult.decisions.map((d) => ({
          kind: d.kind,
          sourceKey: d.sourceKey,
          reasonCodes: d.reasonCodes
        })),
        metrics: call.metrics
      })
    )
    const fs = await import('node:fs/promises')
    const path = join(RESEARCH_DIR, `${sessionId}.jsonl`)
    await fs.mkdir(RESEARCH_DIR, { recursive: true })
    await fs.appendFile(path, lines.join('\n') + '\n', 'utf8')

    console.log(`[smoke:cr003] runtimeSessionId=${sessionId}`)
    console.log(`[smoke:cr003] provider=${DEEPSEEK_PROVIDER} model=${DEEPSEEK_MODEL}`)
    console.log(`[smoke:cr003] observed model-call count=${planner.callResults.length}`)
    console.log(`[smoke:cr003] shadow plans produced (real seam) =${planner.callResults.length}`)
    for (let index = 0; index < planner.callResults.length; index += 1) {
      const call = planner.callResults[index]!
      const m = call.metrics
      console.log(
        `[smoke:cr003]   call=${index + 1} native=${m.nativeContextEstimate} proposed=${m.proposedSemanticTokenEstimate} ADD=${m.add} KEEP=${m.keep} REMOVE=${m.remove} REHYDRATE=${m.rehydrate}`
      )
    }
    console.log(`[smoke:cr003] jsonl=${path}`)
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
    console.error(`[smoke:cr003] FAILED: ${message}`)
    console.error('SMOKE_STATUS=FAILED')
    process.exit(1)
  })
