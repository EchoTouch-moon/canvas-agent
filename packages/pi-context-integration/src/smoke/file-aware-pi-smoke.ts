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
import {
  EnrichedPiShadowObserver,
  PiContextShadowObserver,
  ShadowPlannerObserver,
  createShadowPlannerPiExtension
} from '../index'
import { FileRepresentationProvider, repositorySourceKey } from '@canvas-agent/repository-observer'
import { createAvailableObservation, createSourceVersionId, seedUniverse, sha256Hex } from '@canvas-agent/context-runtime'

// Opt-in CR-003B file-aware Pi + DeepSeek Shadow smoke. Requires DEEPSEEK_API_KEY
// (or Pi auth.json) + CANVAS_CONTEXT_LIVE_SMOKE=1.
//
// The smoke runs a tiny coding task in a temporary Git fixture. The file-aware
// planner observer materializes the authoritative fixture file into a FULL
// representation inside the real Pi `context` seam, records it in a Shadow
// Working Set, and returns the original Pi messages unchanged. Native context is
// never rewritten. Output is metadata-only.
//
// REPLACE proof is carried by the deterministic + temporary-Git smokes; this
// live smoke proves real-seam interoperability with at least one file
// representation.

const DEEPSEEK_PROVIDER = 'deepseek'
const DEEPSEEK_MODEL = process.env['CANVAS_CONTEXT_SMOKE_MODEL'] ?? 'deepseek-v4-flash'
const RESEARCH_DIR = resolve(process.cwd(), '.canvas-agent', 'research', 'context-shadow')

const FILE_CONTENT = 'function greet(name) {\n  return `hello ${name}`\n}\n\nexport { greet }\n'

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { runGitCommand } = await import('@canvas-agent/worker-runtime')
  const result = await runGitCommand(args, {
    cwd,
    timeoutMs: 30_000,
    maxOutputBytes: 2 * 1024 * 1024,
    commandAllowlist: ['git'],
    signal: undefined
  })
  return result.stdout.trim()
}

async function run(): Promise<void> {
  if (process.env['CANVAS_CONTEXT_LIVE_SMOKE'] !== '1') {
    console.log('[smoke:cr003b] CANVAS_CONTEXT_LIVE_SMOKE=1 is required. SKIPPED')
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
    console.log('[smoke:cr003b] DeepSeek credentials unavailable (env or Pi auth.json). SKIPPED')
    console.log('SMOKE_STATUS=SKIPPED')
    return
  }
  const model = runtime.getModel(DEEPSEEK_PROVIDER, DEEPSEEK_MODEL)
  if (model === undefined) {
    console.log(`[smoke:cr003b] DeepSeek model ${DEEPSEEK_MODEL} not found in catalog. SKIPPED`)
    console.log('SMOKE_STATUS=SKIPPED')
    return
  }

  const fixtureDir = await mkdtemp(join(tmpdir(), 'canvas-pi-smoke-cr003b-'))
  try {
    await git(fixtureDir, ['init', '-q', '-b', 'main'])
    await git(fixtureDir, ['config', 'user.email', 'observer@canvas.local'])
    await git(fixtureDir, ['config', 'user.name', 'Repository Observer'])
    await mkdir(join(fixtureDir, 'src'), { recursive: true })
    await writeFile(join(fixtureDir, 'src', 'greet.ts'), FILE_CONTENT, 'utf8')
    await git(fixtureDir, ['add', '-A'])
    await git(fixtureDir, ['commit', '-q', '-m', 'fixture'])
    const revision = {
      baseCommit: await git(fixtureDir, ['rev-parse', 'HEAD']),
      treeHash: await git(fixtureDir, ['rev-parse', 'HEAD^{tree}']),
      workingTreePatchHash: null as string | null
    }

    const sessionId = `smoke-cr003b-${new Date().toISOString().replace(/[:.]/g, '-')}`
    const base = new PiContextShadowObserver({ runtimeSessionId: sessionId })
    const sourceKey = repositorySourceKey('src/greet.ts')
    const contentHash = sha256Hex(FILE_CONTENT)
    const versionId = createSourceVersionId(sourceKey, contentHash)
    // Seed the file source into the enriched observer's Universe so the
    // file-aware representation provider has an admitted repository/file
    // SourceVersion to materialize against (authoritative, not a Pi hint).
    const enriched = new EnrichedPiShadowObserver({
      base,
      seeds: [
        {
          sourceKey,
          sourceKind: 'REPOSITORY_FILE',
          contentHash,
          provenance: 'REPOSITORY_OBSERVER',
          observedAt: new Date().toISOString()
        }
      ]
    })
    const provider = new FileRepresentationProvider()

    const planner = new ShadowPlannerObserver({
      enriched,
      policyVersion: 'policy-v0',
      filePathCandidates: ['src/greet.ts'],
      makePlanningRequest: (input) => ({
        runtimeSessionId: input.runtimeSessionId,
        recompositionSequence: input.sequence,
        taskPhase: 'GENERAL',
        budget: { maxSemanticTokens: 8000 },
        pinnedSourceKeys: [],
        excludedSourceKeys: [],
        currentTargetSourceKeys: [sourceKey],
        latestVerificationSourceKeys: [],
        recentEvidenceSourceKeys: input.recentEvidenceSourceKeys,
        previousWorkingSetId: input.previousWorkingSetId
      }),
      representationProvider: async ({ entry, need }) => {
        if (entry.admittedVersion === null) return null
        const result = await provider.materialize({
          repositoryPath: fixtureDir,
          expectedRevision: revision,
          sourceKey: entry.source.sourceKey,
          sourceVersionId: entry.admittedVersion.versionId,
          sourceVersionContentHash: entry.admittedVersion.contentHash,
          need
        })
        return result.kind === 'representation' ? result.representation : null
      }
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
      tools: ['read', 'ls']
    })

    await session.prompt(
      'Read src/greet.ts with the read tool, then briefly describe the greeting function. Be concise.'
    )

    // Admit the fixture file into a Universe revision for metric display.
    const seeded = seedUniverse({ runtimeSessionId: sessionId, seeds: [] })
    const { applySourceObservations } = await import('@canvas-agent/context-runtime')
    const universe = applySourceObservations({
      previous: seeded,
      observations: [createAvailableObservation(sourceKey, contentHash, new Date().toISOString())],
      sourceDescriptors: [{ sourceKey, sourceKind: 'REPOSITORY_FILE', provenance: 'REPOSITORY_OBSERVER' }],
      modelCallSequence: 1
    })
    void universe

    const lines = planner.callResults.map((call, index) =>
      JSON.stringify({
        kind: 'shadow-plan',
        runtimeSessionId: sessionId,
        modelCallSequence: index + 1,
        universeSequence: call.plannerResult.workingSet.plannedFromUniverseSequence,
        workingSetId: call.plannerResult.workingSet.workingSetId,
        nativeContextEstimate: call.metrics.nativeContextEstimate,
        proposedTokenEstimate: call.metrics.proposedSemanticTokenEstimate,
        representationCounts: call.metrics.representationCounts,
        decisions: call.plannerResult.decisions.map((d) => ({ kind: d.kind, sourceKey: d.sourceKey, reasonCodes: d.reasonCodes }))
      })
    )
    const fs = await import('node:fs/promises')
    const path = join(RESEARCH_DIR, `${sessionId}.jsonl`)
    await fs.mkdir(RESEARCH_DIR, { recursive: true })
    await fs.appendFile(path, lines.join('\n') + '\n', 'utf8')

    console.log(`[smoke:cr003b] runtimeSessionId=${sessionId}`)
    console.log(`[smoke:cr003b] provider=${DEEPSEEK_PROVIDER} model=${DEEPSEEK_MODEL}`)
    console.log(`[smoke:cr003b] observed model-call count=${planner.callResults.length}`)
    const last = planner.callResults[planner.callResults.length - 1]
    if (last !== undefined) {
      const m = last.metrics
      console.log(
        `[smoke:cr003b] last plan FULL=${m.representationCounts.full} LINE_RANGE=${m.representationCounts.lineRange} REFERENCE=${m.representationCounts.reference} proposed=${m.proposedSemanticTokenEstimate} native=${m.nativeContextEstimate}`
      )
    }
    console.log(`[smoke:cr003b] jsonl=${path}`)
    console.log('SMOKE_STATUS=EXECUTED')
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[smoke:cr003b] FAILED: ${message}`)
    console.error('SMOKE_STATUS=FAILED')
    process.exit(1)
  })
