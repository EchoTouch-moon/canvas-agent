import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGitCommand } from '@canvas-agent/worker-runtime'
import {
  createAvailableObservation,
  createSourceVersionId,
  seedUniverse,
  sha256Hex,
  applySourceObservations,
  planWorkingSet,
  type ContextUniverseEntry,
  type ContextRepresentation
} from '@canvas-agent/context-runtime'
import { FileRepresentationProvider, RepositoryObserver, repositorySourceKey } from '../index'

// Credential-free temporary-Git smoke for DS-012 / CR-003B. Proves the REAL
// chain: RepositoryObserver -> Universe reconciliation -> materializer ->
// Planner -> REPLACE, using the actual materialized representations (not fake
// ones). No model/API credentials involved.

const GIT_OPTIONS = {
  timeoutMs: 30_000,
  maxOutputBytes: 2 * 1024 * 1024,
  commandAllowlist: ['git'] as readonly string[],
  signal: undefined as AbortSignal | undefined
}

const FILE_V1 = 'line one\nline two\nline three\nline four\nline five\nline six\nline seven\n'

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitCommand(args, { ...GIT_OPTIONS, cwd })
  return result.stdout.trim()
}

// Planner `represent` resolver built from a Map of REAL materialized
// representations (sourceKey -> representation).
function representFromMap(map: Map<string, ContextRepresentation>) {
  return (entry: ContextUniverseEntry) => {
    const prepared = map.get(entry.source.sourceKey)
    if (prepared !== undefined) return prepared
    const version = entry.admittedVersion
    if (version === null) return null
    return {
      id: `ref:${version.versionId}`,
      kind: 'REFERENCE' as const,
      sourceVersionIds: [version.versionId],
      contentHash: version.contentHash,
      tokenEstimate: 1,
      lossiness: 'NONE' as const,
      derivation: { sourceKey: entry.source.sourceKey }
    }
  }
}

async function run(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-repo-observer-file-smoke-'))
  try {
    await git(directory, ['init', '-q', '-b', 'main'])
    await git(directory, ['config', 'user.email', 'observer@canvas.local'])
    await git(directory, ['config', 'user.name', 'Repository Observer'])
    await mkdir(join(directory, 'src'), { recursive: true })
    await writeFile(join(directory, 'src', 'auth.ts'), FILE_V1, 'utf8')
    await git(directory, ['add', '-A'])
    await git(directory, ['commit', '-q', '-m', 'v1'])

    const observer = new RepositoryObserver()
    const provider = new FileRepresentationProvider()
    const sourceKey = repositorySourceKey('src/auth.ts')

    // --- Source v1: REAL RepositoryObserver -> Universe ---
    const revision1 = {
      baseCommit: await git(directory, ['rev-parse', 'HEAD']),
      treeHash: await git(directory, ['rev-parse', 'HEAD^{tree}']),
      workingTreePatchHash: null as string | null
    }
    const observed1 = await observer.observe({
      repositoryPath: directory,
      expectedRevision: revision1,
      paths: ['src/auth.ts'],
      observedAt: new Date().toISOString()
    })
    if (observed1[0]?.observation.status !== 'AVAILABLE') {
      throw new Error(`unexpected v1 observation ${JSON.stringify(observed1[0])}`)
    }
    const contentHashV1 = observed1[0].observation.contentHash
    const versionIdV1 = createSourceVersionId(sourceKey, contentHashV1)
    const seeded = seedUniverse({ runtimeSessionId: 'smoke', seeds: [] })
    const universeV1 = applySourceObservations({
      previous: seeded,
      observations: [observed1[0].observation],
      sourceDescriptors: [{ sourceKey, sourceKind: 'REPOSITORY_FILE', provenance: 'REPOSITORY_OBSERVER' }],
      modelCallSequence: 1
    })

    // --- Materialize REAL FULL + REAL LINE_RANGE from the admitted v1 ---
    const full = await provider.materialize({
      repositoryPath: directory,
      expectedRevision: revision1,
      sourceKey,
      sourceVersionId: versionIdV1,
      sourceVersionContentHash: contentHashV1,
      need: { sourceKey, preferredKind: 'FULL', reasonCode: 'DETAIL_REQUIRED' }
    })
    const range = await provider.materialize({
      repositoryPath: directory,
      expectedRevision: revision1,
      sourceKey,
      sourceVersionId: versionIdV1,
      sourceVersionContentHash: contentHashV1,
      need: { sourceKey, preferredKind: 'LINE_RANGE', lineRange: { startLine: 2, endLine: 4 }, reasonCode: 'REPRESENTATION_NARROWED' }
    })
    if (full.kind !== 'representation' || range.kind !== 'representation') {
      throw new Error(`materialization failed full=${full.kind} range=${range.kind}`)
    }
    console.log(`[smoke] v1 FULL=${full.representation.contentHash.slice(0, 12)}`)
    console.log(`[smoke] v1 LINE_RANGE=${range.representation.contentHash.slice(0, 12)}`)

    // --- Planner 1: REAL FULL representation -> ADD ---
    const wsFull = planWorkingSet({
      universe: universeV1,
      request: { runtimeSessionId: 'smoke', recompositionSequence: 1, taskPhase: 'GENERAL', budget: { maxSemanticTokens: 8000 }, pinnedSourceKeys: [], excludedSourceKeys: [], currentTargetSourceKeys: [sourceKey], latestVerificationSourceKeys: [], recentEvidenceSourceKeys: [sourceKey], previousWorkingSetId: null },
      previousWorkingSet: null,
      options: { policyVersion: 'policy-v0', createdAt: new Date().toISOString(), represent: representFromMap(new Map([[sourceKey, full.representation]])) }
    })

    // --- Planner 2: REAL LINE_RANGE representation -> REPLACE(NARROWED) ---
    const wsRange = planWorkingSet({
      universe: universeV1,
      request: { runtimeSessionId: 'smoke', recompositionSequence: 2, taskPhase: 'GENERAL', budget: { maxSemanticTokens: 8000 }, pinnedSourceKeys: [], excludedSourceKeys: [], currentTargetSourceKeys: [sourceKey], latestVerificationSourceKeys: [], recentEvidenceSourceKeys: [sourceKey], representationNeeds: [{ sourceKey, preferredKind: 'LINE_RANGE', lineRange: { startLine: 2, endLine: 4 }, reasonCode: 'REPRESENTATION_NARROWED' }], previousWorkingSetId: wsFull.workingSet.workingSetId },
      previousWorkingSet: wsFull.workingSet,
      options: { policyVersion: 'policy-v0', createdAt: new Date().toISOString(), represent: representFromMap(new Map([[sourceKey, range.representation]])) }
    })
    const replaceDecision = wsRange.decisions.find((d) => d.kind === 'REPLACE')
    console.log(`[smoke] FULL->LINE_RANGE replace=${replaceDecision !== undefined ? 'REPLACE' : 'none'}`)

    // --- Commit v2: REAL RepositoryObserver -> Universe UPDATE -> fresh repr ---
    await writeFile(join(directory, 'src', 'auth.ts'), FILE_V1 + 'line eight\n', 'utf8')
    await git(directory, ['add', '-A'])
    await git(directory, ['commit', '-q', '-m', 'v2'])
    const revision2 = {
      baseCommit: await git(directory, ['rev-parse', 'HEAD']),
      treeHash: await git(directory, ['rev-parse', 'HEAD^{tree}']),
      workingTreePatchHash: null as string | null
    }
    const observed2 = await observer.observe({
      repositoryPath: directory,
      expectedRevision: revision2,
      paths: ['src/auth.ts'],
      observedAt: new Date().toISOString()
    })
    if (observed2[0]?.observation.status !== 'AVAILABLE') {
      throw new Error(`unexpected v2 observation ${JSON.stringify(observed2[0])}`)
    }
    const contentHashV2 = observed2[0].observation.contentHash
    const versionIdV2 = createSourceVersionId(sourceKey, contentHashV2)
    const universeV2 = applySourceObservations({
      previous: universeV1,
      observations: [observed2[0].observation],
      sourceDescriptors: [{ sourceKey, sourceKind: 'REPOSITORY_FILE', provenance: 'REPOSITORY_OBSERVER' }],
      modelCallSequence: 2
    })
    const freshFull = await provider.materialize({
      repositoryPath: directory,
      expectedRevision: revision2,
      sourceKey,
      sourceVersionId: versionIdV2,
      sourceVersionContentHash: contentHashV2,
      need: { sourceKey, preferredKind: 'FULL', reasonCode: 'DETAIL_REQUIRED' }
    })
    if (freshFull.kind !== 'representation') {
      throw new Error(`v2 materialization failed ${freshFull.kind}`)
    }
    console.log(`[smoke] v2 FULL=${freshFull.representation.contentHash.slice(0, 12)} (source v2)`)

    // --- Planner 3: SourceVersion advanced -> REPLACE(SOURCE_VERSION_ADVANCED) ---
    const wsV2 = planWorkingSet({
      universe: universeV2,
      request: { runtimeSessionId: 'smoke', recompositionSequence: 3, taskPhase: 'GENERAL', budget: { maxSemanticTokens: 8000 }, pinnedSourceKeys: [], excludedSourceKeys: [], currentTargetSourceKeys: [sourceKey], latestVerificationSourceKeys: [], recentEvidenceSourceKeys: [sourceKey], representationNeeds: [{ sourceKey, preferredKind: 'FULL', reasonCode: 'DETAIL_REQUIRED' }], previousWorkingSetId: wsRange.workingSet.workingSetId },
      previousWorkingSet: wsRange.workingSet,
      options: { policyVersion: 'policy-v0', createdAt: new Date().toISOString(), represent: representFromMap(new Map([[sourceKey, freshFull.representation]])) }
    })
    const advanceDecision = wsV2.decisions.find((d) => d.sourceKey === sourceKey)
    console.log(`[smoke] v1->v2 decision=${advanceDecision?.kind ?? 'none'} reasons=${advanceDecision?.reasonCodes.join(',') ?? '-'}`)

    const ok =
      full.kind === 'representation' &&
      range.kind === 'representation' &&
      replaceDecision !== undefined &&
      replaceDecision.reasonCodes.includes('REPRESENTATION_NARROWED') &&
      advanceDecision?.kind === 'REPLACE' &&
      advanceDecision.reasonCodes.includes('SOURCE_VERSION_ADVANCED')
    console.log(ok ? 'SMOKE_STATUS=EXECUTED' : 'SMOKE_STATUS=FAILED')
    if (!ok) process.exitCode = 1
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

run().catch((error: unknown) => {
  console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  console.error('SMOKE_STATUS=FAILED')
  process.exit(1)
})
