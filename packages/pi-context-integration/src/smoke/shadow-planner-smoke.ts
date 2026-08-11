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
  computeShadowMetrics,
  createRepresentation,
  planWorkingSet,
  type ContextPlanningRequest,
  type ContextUniverseEntry,
  type ContextUniverseRevision,
  type ShadowPlanningMetrics
} from '@canvas-agent/context-runtime'
import {
  EnrichedPiShadowObserver,
  PiContextShadowObserver,
  createEnrichedPiContextShadowExtension
} from '../index'

// Opt-in CR-003A Shadow Planner smoke. Requires DEEPSEEK_API_KEY (or Pi
// auth.json) + CANVAS_CONTEXT_LIVE_SMOKE=1. Runs a tiny coding task, observes
// each Pi `context` event, advances the Shadow Universe, and produces one
// deterministic Shadow Working Set + Transition + metrics per model call.
// Pi messages are returned unchanged. Output is metadata-only.

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
          factory: createEnrichedPiContextShadowExtension({ observer: enriched })
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

    // Produce one deterministic Shadow plan per observed model call over the
    // Universe revision as it stood at that call. Conservative planning
    // request: GENERAL phase, empty targets, no prose parsing.
    const plannedResults = enriched.callResults.map((call, index) =>
      planOverUniverse(sessionId, call.universeRevision, index + 1)
    )

    const lines = plannedResults.map((call, index) =>
      JSON.stringify({
        kind: 'shadow-plan',
        runtimeSessionId: sessionId,
        modelCallSequence: index + 1,
        universeSequence: call.workingSet.plannedFromUniverseSequence,
        universeHash: call.workingSet.plannedFromUniverseHash.slice(0, 16),
        workingSetId: call.workingSet.workingSetId,
        policyVersion: call.workingSet.policyVersion,
        proposedTokenEstimate: call.workingSet.totalTokenEstimate,
        decisions: call.decisions.map((d) => ({
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
    console.log(`[smoke:cr003] observed model-call count=${enriched.callResults.length}`)
    console.log(`[smoke:cr003] shadow plans produced=${plannedResults.length}`)
    const last = plannedResults[plannedResults.length - 1]
    if (last !== undefined) {
      const m = last.metrics
      console.log(
        `[smoke:cr003] last plan ADD=${m.add} KEEP=${m.keep} REMOVE=${m.remove} REHYDRATE=${m.rehydrate} churn=${m.churn} proposed=${m.proposedSemanticTokenEstimate}`
      )
    }
    console.log(`[smoke:cr003] jsonl=${path}`)
    console.log('SMOKE_STATUS=EXECUTED')
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
}

// One deterministic Shadow plan over a given Universe revision + planning
// request. Stateless per call for the smoke; uses the same Policy V0 core.
function planOverUniverse(
  runtimeSessionId: string,
  universe: ContextUniverseRevision,
  sequence: number
): {
  readonly workingSet: ReturnType<typeof planWorkingSet>['workingSet']
  readonly decisions: ReturnType<typeof planWorkingSet>['decisions']
  readonly metrics: ShadowPlanningMetrics
} {
  const request: ContextPlanningRequest = {
    runtimeSessionId,
    recompositionSequence: sequence,
    taskPhase: 'GENERAL',
    budget: { maxSemanticTokens: 8000 },
    pinnedSourceKeys: [],
    excludedSourceKeys: [],
    currentTargetSourceKeys: [],
    latestVerificationSourceKeys: [],
    previousWorkingSetId: null
  }
  const result = planWorkingSet({
    universe,
    request,
    previousWorkingSet: null,
    options: {
      policyVersion: 'policy-v0',
      createdAt: new Date().toISOString(),
      represent: (entry: ContextUniverseEntry) => {
        const version = entry.admittedVersion
        if (version === null) return null
        return createRepresentation({
          kind: 'REFERENCE',
          sourceVersionIds: [version.versionId],
          contentHash: version.contentHash,
          tokenEstimate: 1,
          lossiness: 'NONE',
          derivation: { sourceKey: entry.source.sourceKey }
        })
      }
    }
  })
  const metrics = computeShadowMetrics({
    modelCallSequence: sequence,
    universeSequence: universe.sequence,
    universeHash: universe.logicalHash,
    nativeContextEstimate: 0,
    workingSet: result.workingSet,
    decisions: result.decisions
  })
  return { workingSet: result.workingSet, decisions: result.decisions, metrics }
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
