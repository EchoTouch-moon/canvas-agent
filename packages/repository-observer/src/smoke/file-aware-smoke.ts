import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGitCommand } from '@canvas-agent/worker-runtime'
import {
  createAvailableObservation,
  createRepresentation,
  createSourceVersionId,
  seedUniverse,
  sha256Hex,
  applySourceObservations,
  planWorkingSet,
  type ContextUniverseEntry
} from '@canvas-agent/context-runtime'
import { FileRepresentationProvider, repositorySourceKey } from '../index'

// Credential-free temporary-Git smoke for DS-012 / CR-003B. Proves the
// deterministic sequence: Source v1 observed -> FULL -> LINE_RANGE -> FULL ->
// file changes / Source v2 -> fresh representation for v2. No model/API
// credentials involved.

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

function representForKind(kind: 'FULL' | 'LINE_RANGE', tokenEstimate: number) {
  return (entry: ContextUniverseEntry) => {
    const version = entry.admittedVersion
    if (version === null) return null
    return createRepresentation({
      kind,
      sourceVersionIds: [version.versionId],
      contentHash: kind === 'FULL' ? version.contentHash : `range:${version.contentHash}`,
      tokenEstimate,
      lossiness: kind === 'FULL' ? 'NONE' : 'BOUNDED',
      derivation: { sourceKey: entry.source.sourceKey }
    })
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

    const revision = {
      baseCommit: await git(directory, ['rev-parse', 'HEAD']),
      treeHash: await git(directory, ['rev-parse', 'HEAD^{tree}']),
      workingTreePatchHash: null as string | null
    }
    const sourceKey = repositorySourceKey('src/auth.ts')
    const provider = new FileRepresentationProvider()

    // Admit Source v1 into the Universe.
    const contentHashV1 = sha256Hex(FILE_V1)
    const versionIdV1 = createSourceVersionId(sourceKey, contentHashV1)
    const seeded = seedUniverse({ runtimeSessionId: 'smoke', seeds: [] })
    const universeV1 = applySourceObservations({
      previous: seeded,
      observations: [createAvailableObservation(sourceKey, contentHashV1, new Date().toISOString())],
      sourceDescriptors: [{ sourceKey, sourceKind: 'REPOSITORY_FILE', provenance: 'REPOSITORY_OBSERVER' }],
      modelCallSequence: 1
    })

    // FULL representation.
    const full = await provider.materialize({
      repositoryPath: directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionIdV1,
      sourceVersionContentHash: contentHashV1,
      need: { sourceKey, preferredKind: 'FULL', reasonCode: 'DETAIL_REQUIRED' }
    })
    console.log(`[smoke] FULL=${full.kind === 'representation' ? full.representation.contentHash.slice(0, 12) : full.kind}`)

    // LINE_RANGE representation (2-4).
    const lineRange = await provider.materialize({
      repositoryPath: directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionIdV1,
      sourceVersionContentHash: contentHashV1,
      need: { sourceKey, preferredKind: 'LINE_RANGE', lineRange: { startLine: 2, endLine: 4 }, reasonCode: 'REPRESENTATION_NARROWED' }
    })
    console.log(`[smoke] LINE_RANGE=${lineRange.kind === 'representation' ? lineRange.representation.contentHash.slice(0, 12) : lineRange.kind}`)

    // FULL -> LINE_RANGE REPLACE through Policy V0.
    const wsFull = planWorkingSet({
      universe: universeV1,
      request: { runtimeSessionId: 'smoke', recompositionSequence: 1, taskPhase: 'GENERAL', budget: { maxSemanticTokens: 8000 }, pinnedSourceKeys: [], excludedSourceKeys: [], currentTargetSourceKeys: [sourceKey], latestVerificationSourceKeys: [], recentEvidenceSourceKeys: [sourceKey], previousWorkingSetId: null },
      previousWorkingSet: null,
      options: { policyVersion: 'policy-v0', createdAt: new Date().toISOString(), represent: representForKind('FULL', 28) }
    })
    const wsRange = planWorkingSet({
      universe: universeV1,
      request: { runtimeSessionId: 'smoke', recompositionSequence: 2, taskPhase: 'GENERAL', budget: { maxSemanticTokens: 8000 }, pinnedSourceKeys: [], excludedSourceKeys: [], currentTargetSourceKeys: [sourceKey], latestVerificationSourceKeys: [], recentEvidenceSourceKeys: [sourceKey], representationNeeds: [{ sourceKey, preferredKind: 'LINE_RANGE', lineRange: { startLine: 2, endLine: 4 }, reasonCode: 'REPRESENTATION_NARROWED' }], previousWorkingSetId: wsFull.workingSet.workingSetId },
      previousWorkingSet: wsFull.workingSet,
      options: { policyVersion: 'policy-v0', createdAt: new Date().toISOString(), represent: representForKind('LINE_RANGE', 12) }
    })
    const replaceDecision = wsRange.decisions.find((d) => d.kind === 'REPLACE')
    console.log(`[smoke] FULL->LINE_RANGE replace=${replaceDecision !== undefined ? 'REPLACE' : 'none'}`)

    // Commit Source v2 and materialize a fresh representation.
    await writeFile(join(directory, 'src', 'auth.ts'), FILE_V1 + 'line eight\n', 'utf8')
    await git(directory, ['add', '-A'])
    await git(directory, ['commit', '-q', '-m', 'v2'])
    const revision2 = {
      baseCommit: await git(directory, ['rev-parse', 'HEAD']),
      treeHash: await git(directory, ['rev-parse', 'HEAD^{tree}']),
      workingTreePatchHash: null as string | null
    }
    const contentHashV2 = sha256Hex(FILE_V1 + 'line eight\n')
    const versionIdV2 = createSourceVersionId(sourceKey, contentHashV2)
    const freshFull = await provider.materialize({
      repositoryPath: directory,
      expectedRevision: revision2,
      sourceKey,
      sourceVersionId: versionIdV2,
      sourceVersionContentHash: contentHashV2,
      need: { sourceKey, preferredKind: 'FULL', reasonCode: 'DETAIL_REQUIRED' }
    })
    console.log(`[smoke] v2 FULL=${freshFull.kind === 'representation' ? freshFull.representation.contentHash.slice(0, 12) : freshFull.kind} (source v2)`)

    const ok =
      full.kind === 'representation' &&
      lineRange.kind === 'representation' &&
      replaceDecision !== undefined &&
      freshFull.kind === 'representation' &&
      freshFull.representation.sourceVersionIds.includes(versionIdV2)
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
