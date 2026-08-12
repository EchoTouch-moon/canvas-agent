import { afterEach, describe, expect, it } from 'vitest'
import { FileRepresentationProvider, repositorySourceKey } from '../src'
import { createTempRepo, type TempRepo } from './helpers'
import { createAvailableObservation, sha256Hex } from '@canvas-agent/context-runtime'
import { createSourceVersionId, applySourceObservations, seedUniverse } from '@canvas-agent/context-runtime'
import type { RepositoryRevisionContract } from '@canvas-agent/contracts'

const T0 = '2026-08-11T00:00:00.000Z'
const repos: TempRepo[] = []

async function repo(files: Record<string, string>): Promise<TempRepo> {
  const created = await createTempRepo(files)
  repos.push(created)
  return created
}

afterEach(async () => {
  await Promise.all(repos.splice(0).map((r) => r.cleanup()))
})

const FILE_CONTENT = 'line one\nline two\nline three\nline four\nline five\n'

function fullNeed(sourceKey: string) {
  return { sourceKey, preferredKind: 'FULL' as const, reasonCode: 'DETAIL_REQUIRED' }
}
function rangeNeed(sourceKey: string, startLine: number, endLine: number) {
  return { sourceKey, preferredKind: 'LINE_RANGE' as const, lineRange: { startLine, endLine }, reasonCode: 'REPRESENTATION_NARROWED' }
}
function refNeed(sourceKey: string) {
  return { sourceKey, preferredKind: 'REFERENCE' as const, reasonCode: 'REPRESENTATION_NARROWED' }
}

async function admitVersion(r: TempRepo, path: string, content: string) {
  const revision = await r.readRevision()
  const sourceKey = repositorySourceKey(path)
  const contentHash = sha256Hex(content)
  const versionId = createSourceVersionId(sourceKey, contentHash)
  const seeded = seedUniverse({ runtimeSessionId: 's', seeds: [] })
  const universe = applySourceObservations({
    previous: seeded,
    observations: [createAvailableObservation(sourceKey, contentHash, T0)],
    sourceDescriptors: [{ sourceKey, sourceKind: 'REPOSITORY_FILE', provenance: 'REPOSITORY_OBSERVER' }],
    modelCallSequence: 1
  })
  return { revision, sourceKey, contentHash, versionId, universe }
}

describe('A. representation materialization', () => {
  it('1/2/3) authoritative AVAILABLE SourceVersion -> FULL representation bound to exact version', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: fullNeed(sourceKey)
    })
    expect(result.kind).toBe('representation')
    if (result.kind === 'representation') {
      expect(result.representation.kind).toBe('FULL')
      expect(result.representation.sourceVersionIds).toEqual([versionId])
      expect(result.representation.lossiness).toBe('NONE')
      expect(result.representation.contentHash).toBe(sha256Hex(FILE_CONTENT))
      // The FULL representation is model-usable: it carries the exact content.
      expect(result.representation.content).toBe(FILE_CONTENT)
    }
  })

  it('4) materialized content hash mismatch vs admitted SourceVersion fails closed', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    const provider = new FileRepresentationProvider()
    // Admit a DIFFERENT contentHash than what the repo actually holds.
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: sha256Hex('completely different content'),
      need: fullNeed(sourceKey)
    })
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.reason).toBe('CONTENT_HASH_MISMATCH')
    }
  })

  it('5) missing pinned commit fails closed (REPOSITORY_UNAVAILABLE)', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: { baseCommit: '0'.repeat(40), treeHash: '1'.repeat(40), workingTreePatchHash: null },
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: fullNeed(sourceKey)
    })
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.reason).toBe('REPOSITORY_UNAVAILABLE')
    }
  })

  it('5b) wrong expected tree hash for an existing pinned commit fails closed (REVISION_MISMATCH)', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: { ...revision, treeHash: 'f'.repeat(40) },
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: fullNeed(sourceKey)
    })
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.reason).toBe('REVISION_MISMATCH')
    }
  })

  it('5c) clean source admitted then worktree edited -> old FULL still materializes exact old bytes (DS-014)', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    // The Agent later edits the worktree without committing. The pinned commit
    // object and admitted SourceVersion remain immutable and exact.
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await writeFile(join(r.directory, 'a.ts'), 'edited new content\n', 'utf8')
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: fullNeed(sourceKey)
    })
    expect(result.kind).toBe('representation')
    if (result.kind === 'representation') {
      expect(result.representation.kind).toBe('FULL')
      // Exact OLD bytes from the pinned blob, NOT the edited worktree file.
      expect(result.representation.content).toBe(FILE_CONTENT)
    }
  })

  it('5d) untracked file elsewhere does not block exact old blob materialization (DS-014)', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    // An unrelated untracked file appears in the worktree (never committed).
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await writeFile(join(r.directory, 'untracked.js'), 'module.exports = 1\n', 'utf8')
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: fullNeed(sourceKey)
    })
    expect(result.kind).toBe('representation')
    if (result.kind === 'representation') {
      expect(result.representation.content).toBe(FILE_CONTENT)
    }
  })

  it('7) dirty revision remains unsupported/fail-closed', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const revision = await r.readRevision()
    const { sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: { ...revision, workingTreePatchHash: 'patch' },
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: fullNeed(sourceKey)
    })
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.reason).toBe('DIRTY_REVISION_UNSUPPORTED')
    }
  })

  it('8) oversized source cannot become FULL', async () => {
    const big = 'x'.repeat(600 * 1024)
    const r = await repo({ 'big.ts': big })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'big.ts', big)
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: fullNeed(sourceKey)
    })
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.reason).toBe('FILE_TOO_LARGE')
    }
  })

  it('8b) binary (non-UTF-8) source cannot become FULL/LINE_RANGE', async () => {
    const r = await repo({ 'b.ts': 'placeholder' })
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await writeFile(join(r.directory, 'b.ts'), Buffer.from([0xff, 0xfe, 0x00, 0x01]), 'binary')
    await r.git(['add', '-A'])
    await r.git(['commit', '-q', '-m', 'binary'])
    const revision = await r.readRevision()
    const sourceKey = repositorySourceKey('b.ts')
    const contentHash = sha256Hex('binary-bytes')
    const versionId = createSourceVersionId(sourceKey, contentHash)
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: fullNeed(sourceKey)
    })
    // The binary file cannot decode as UTF-8, so materialization fails closed
    // (either UNSUPPORTED_BINARY or READ_FAILED) - never a FULL representation.
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(['UNSUPPORTED_BINARY', 'READ_FAILED']).toContain(result.reason)
    }
  })

  it('6b) post-materialization pinned-tree change fails closed via pinned-tree-reader seam', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    // Seam: pre-read returns the expected tree; post-read returns a different
    // pinned tree (destructive repository mutation during the read window).
    let calls = 0
    const provider = new FileRepresentationProvider({
      pinnedTreeReader: {
        async readTreeHash(): Promise<{ readonly kind: 'tree-hash'; readonly treeHash: string }> {
          calls += 1
          if (calls === 1) return { kind: 'tree-hash', treeHash: revision.treeHash }
          return { kind: 'tree-hash', treeHash: 'f'.repeat(40) }
        }
      }
    })
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: fullNeed(sourceKey)
    })
    expect(calls).toBe(2)
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.reason).toBe('REVISION_CHANGED_DURING_OBSERVATION')
    }
  })

  it('9) REFERENCE is possible without claiming file text', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: refNeed(sourceKey)
    })
    expect(result.kind).toBe('representation')
    if (result.kind === 'representation') {
      expect(result.representation.kind).toBe('REFERENCE')
      expect(result.representation.sourceVersionIds).toEqual([versionId])
    }
  })
})

describe('B. LINE_RANGE semantics', () => {
  it('10/13) explicit line range produces exact deterministic content + metadata', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: rangeNeed(sourceKey, 2, 4)
    })
    expect(result.kind).toBe('representation')
    if (result.kind === 'representation') {
      const repr = result.representation
      expect(repr.kind).toBe('LINE_RANGE')
      expect(repr.lossiness).toBe('BOUNDED')
      expect(repr.sourceVersionIds).toEqual([versionId])
      // B-10: the representation carries the EXACT deterministic content.
      expect(repr.content).toBe('line two\nline three\nline four')
      const derivation = repr.derivation as { requestedRange: { startLine: number; endLine: number } }
      expect(derivation.requestedRange).toEqual({ startLine: 2, endLine: 4 })
    }
  })

  it('11) same range + same SourceVersion -> same representation id/hash', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    const provider = new FileRepresentationProvider()
    const a = await provider.materialize({ repositoryPath: r.directory, expectedRevision: revision, sourceKey, sourceVersionId: versionId, sourceVersionContentHash: contentHash, need: rangeNeed(sourceKey, 2, 4) })
    const b = await provider.materialize({ repositoryPath: r.directory, expectedRevision: revision, sourceKey, sourceVersionId: versionId, sourceVersionContentHash: contentHash, need: rangeNeed(sourceKey, 2, 4) })
    expect(a.kind).toBe('representation')
    expect(b.kind).toBe('representation')
    if (a.kind === 'representation' && b.kind === 'representation') {
      expect(a.representation.id).toBe(b.representation.id)
      expect(a.representation.contentHash).toBe(b.representation.contentHash)
    }
  })

  it('12) different range -> different representation id/hash', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    const provider = new FileRepresentationProvider()
    const a = await provider.materialize({ repositoryPath: r.directory, expectedRevision: revision, sourceKey, sourceVersionId: versionId, sourceVersionContentHash: contentHash, need: rangeNeed(sourceKey, 1, 2) })
    const b = await provider.materialize({ repositoryPath: r.directory, expectedRevision: revision, sourceKey, sourceVersionId: versionId, sourceVersionContentHash: contentHash, need: rangeNeed(sourceKey, 3, 4) })
    expect(a.kind).toBe('representation')
    expect(b.kind).toBe('representation')
    if (a.kind === 'representation' && b.kind === 'representation') {
      expect(a.representation.id).not.toBe(b.representation.id)
    }
  })

  it('14) invalid/out-of-range line range fails closed', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({
      repositoryPath: r.directory,
      expectedRevision: revision,
      sourceKey,
      sourceVersionId: versionId,
      sourceVersionContentHash: contentHash,
      need: rangeNeed(sourceKey, 1, 999)
    })
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.reason).toBe('LINE_RANGE_OUT_OF_BOUNDS')
    }
  })

  it('15) LINE_RANGE retains the full file SourceVersion provenance', async () => {
    const r = await repo({ 'a.ts': FILE_CONTENT })
    const { revision, sourceKey, contentHash, versionId } = await admitVersion(r, 'a.ts', FILE_CONTENT)
    const provider = new FileRepresentationProvider()
    const result = await provider.materialize({ repositoryPath: r.directory, expectedRevision: revision, sourceKey, sourceVersionId: versionId, sourceVersionContentHash: contentHash, need: rangeNeed(sourceKey, 2, 4) })
    expect(result.kind).toBe('representation')
    if (result.kind === 'representation') {
      expect(result.representation.sourceVersionIds).toEqual([versionId])
    }
  })
})
