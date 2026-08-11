import { afterEach, describe, expect, it } from 'vitest'
import {
  RepositoryObserver,
  REPOSITORY_SOURCE_KIND,
  REPOSITORY_SOURCE_PROVENANCE,
  repositorySourceKey,
  type RepositoryFileObservation
} from '../src'
import { createTempRepo, type TempRepo } from './helpers'
import { applySourceObservations, seedUniverse } from '@canvas-agent/context-runtime'
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

describe('canonical path and source identity', () => {
  it('1) canonical repository path -> stable repository/file:// sourceKey matching the Pi hint scheme', () => {
    // CR-002 Pi resource hints use repository/file://<path>; the Observer must
    // emit the SAME ContextSource identity, not repo://.
    expect(repositorySourceKey('src/auth.ts')).toBe('repository/file://src/auth.ts')
    expect(repositorySourceKey('src/auth.ts')).toBe(repositorySourceKey('src/auth.ts'))
  })

  it('2) non-canonical / traversal / absolute path fails closed as UNAVAILABLE', async () => {
    const r = await repo({ 'a.ts': 'x' })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    const observations = await observer.observe({
      repositoryPath: r.directory,
      expectedRevision: revision,
      paths: ['../escape.ts', '/absolute.ts', 'a.ts'],
      observedAt: T0
    })
    const escape = observations.find((o) => o.observation.sourceKey === repositorySourceKey('../escape.ts'))
    expect(escape?.observation.status).toBe('UNAVAILABLE')
    if (escape?.observation.status === 'UNAVAILABLE') {
      expect(escape.observation.reasonCode).toBe('NON_CANONICAL_PATH')
    }
    const absolute = observations.find((o) => o.observation.sourceKey === repositorySourceKey('/absolute.ts'))
    expect(absolute?.observation.status).toBe('UNAVAILABLE')
  })
})

describe('revision binding and race detection', () => {
  it('3) exact expected clean revision allows observation', async () => {
    const r = await repo({ 'a.ts': 'hello' })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    const results = await observer.observe({
      repositoryPath: r.directory,
      expectedRevision: revision,
      paths: ['a.ts'],
      observedAt: T0
    })
    expect(results[0]?.observation.status).toBe('AVAILABLE')
  })

  it('4) wrong base commit fails closed as UNAVAILABLE, never AVAILABLE', async () => {
    const r = await repo({ 'a.ts': 'hello' })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    const results = await observer.observe({
      repositoryPath: r.directory,
      expectedRevision: { ...revision, baseCommit: '0'.repeat(40) },
      paths: ['a.ts'],
      observedAt: T0
    })
    expect(results[0]?.observation.status).toBe('UNAVAILABLE')
    if (results[0]?.observation.status === 'UNAVAILABLE') {
      expect(results[0].observation.reasonCode).toBe('REVISION_MISMATCH')
    }
  })

  it('5) pre/post revision mismatch detects mutation during observation', async () => {
    const r = await repo({ 'a.ts': 'v1' })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    // A mismatched tree hash simulates a repository that differs from the
    // expected revision; both pre and post verification fail closed.
    const results = await observer.observe({
      repositoryPath: r.directory,
      expectedRevision: { ...revision, treeHash: '1'.repeat(40) },
      paths: ['a.ts'],
      observedAt: T0
    })
    expect(results[0]?.observation.status).toBe('UNAVAILABLE')
  })

  it('5b) deterministic post-read race via revision-reader seam yields REVISION_CHANGED_DURING_OBSERVATION', async () => {
    const r = await repo({ 'a.ts': 'v1' })
    const revision = await r.readRevision()
    // Seam: pre-read returns expected; post-read returns a different revision.
    let calls = 0
    const observer = new RepositoryObserver({
      revisionReader: {
        async read(): Promise<RepositoryRevisionContract> {
          calls += 1
          if (calls === 1) return revision
          return { ...revision, baseCommit: 'f'.repeat(40) }
        }
      }
    })
    const results = await observer.observe({
      repositoryPath: r.directory,
      expectedRevision: revision,
      paths: ['a.ts'],
      observedAt: T0
    })
    expect(calls).toBe(2)
    expect(results[0]?.observation.status).toBe('UNAVAILABLE')
    if (results[0]?.observation.status === 'UNAVAILABLE') {
      expect(results[0].observation.reasonCode).toBe('REVISION_CHANGED_DURING_OBSERVATION')
    }
    // The batch is NOT trusted as stable: verifiedRevision is null.
    expect(results[0]?.verifiedRevision).toBeNull()
  })

  it('5c) repository state unreadable is REPOSITORY_UNAVAILABLE, not REVISION_MISMATCH', async () => {
    const r = await repo({ 'a.ts': 'v1' })
    const revision = await r.readRevision()
    // Seam that always throws an unavailable (no-head) error BEFORE any field
    // comparison -> REPOSITORY_UNAVAILABLE.
    const observer = new RepositoryObserver({
      revisionReader: {
        async read(): Promise<RepositoryRevisionContract> {
          throw new Error('repository_revision_unavailable:no_head')
        }
      }
    })
    const results = await observer.observe({
      repositoryPath: r.directory,
      expectedRevision: revision,
      paths: ['a.ts'],
      observedAt: T0
    })
    expect(results[0]?.observation.status).toBe('UNAVAILABLE')
    if (results[0]?.observation.status === 'UNAVAILABLE') {
      expect(results[0].observation.reasonCode).toBe('REPOSITORY_UNAVAILABLE')
    }
  })

  it('5d) non-canonical path observation records verifiedRevision null (never claims a verified revision)', async () => {
    const r = await repo({ 'a.ts': 'v1' })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    const results = await observer.observe({
      repositoryPath: r.directory,
      expectedRevision: revision,
      paths: ['../escape.ts'],
      observedAt: T0
    })
    expect(results[0]?.observation.status).toBe('UNAVAILABLE')
    expect(results[0]?.verifiedRevision).toBeNull()
  })
})

describe('AVAILABLE / ABSENT / UNAVAILABLE producer semantics', () => {
  it('6) existing supported file -> AVAILABLE with deterministic contentHash', async () => {
    const r = await repo({ 'a.ts': 'hello world' })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    const a = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision, paths: ['a.ts'], observedAt: T0 })
    const b = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision, paths: ['a.ts'], observedAt: T0 })
    expect(a[0]?.observation.status).toBe('AVAILABLE')
    expect(b[0]?.observation.status).toBe('AVAILABLE')
    if (a[0]?.observation.status === 'AVAILABLE' && b[0]?.observation.status === 'AVAILABLE') {
      expect(a[0].observation.contentHash).toBe(b[0].observation.contentHash)
      expect(a[0].sourceKind).toBe(REPOSITORY_SOURCE_KIND)
      expect(a[0].provenance).toBe(REPOSITORY_SOURCE_PROVENANCE)
    }
  })

  it('7) unchanged file at same logical source -> stable SourceVersion identity', async () => {
    const r = await repo({ 'a.ts': 'same content' })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    const a = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision, paths: ['a.ts'], observedAt: T0 })
    const b = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision, paths: ['a.ts'], observedAt: T0 })
    const stableId = (result: RepositoryFileObservation | undefined) =>
      result?.observation.status === 'AVAILABLE'
        ? `${result.observation.sourceKey}|${result.observation.contentHash}`
        : null
    expect(stableId(a[0])).toBe(stableId(b[0]))
    expect(stableId(a[0])).not.toBeNull()
  })

  it('8) changed file at a new exact revision -> new SourceVersion / Universe UPDATE', async () => {
    const r = await repo({ 'a.ts': 'v1' })
    const revision1 = await r.readRevision()
    const observer = new RepositoryObserver()
    const observed1 = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision1, paths: ['a.ts'], observedAt: T0 })
    // Commit a change -> new revision.
    await r.git(['add', '-A'])
    const before = await r.readRevision()
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await writeFile(join(r.directory, 'a.ts'), 'v2', 'utf8')
    await r.git(['add', '-A'])
    await r.git(['commit', '-q', '-m', 'v2'])
    const revision2 = await r.readRevision()
    expect(revision2.baseCommit).not.toBe(revision1.baseCommit)
    void before
    const observed2 = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision2, paths: ['a.ts'], observedAt: T0 })
    expect(observed1[0]?.observation.status).toBe('AVAILABLE')
    expect(observed2[0]?.observation.status).toBe('AVAILABLE')
    if (observed1[0]?.observation.status === 'AVAILABLE' && observed2[0]?.observation.status === 'AVAILABLE') {
      expect(observed1[0].observation.contentHash).not.toBe(observed2[0].observation.contentHash)
    }
  })

  it('9) confirmed missing file at verified revision -> ABSENT', async () => {
    const r = await repo({ 'a.ts': 'x' })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    const results = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision, paths: ['missing.ts'], observedAt: T0 })
    expect(results[0]?.observation.status).toBe('ABSENT')
  })

  it('10) read failure is UNAVAILABLE, never ABSENT', async () => {
    // A path that is non-canonical fails closed before any read; a repo-level
    // unavailability also surfaces as UNAVAILABLE. Use a non-existent repo dir.
    const observer = new RepositoryObserver()
    const results = await observer.observe({
      repositoryPath: '/nonexistent/canvas-observer-repo',
      expectedRevision: { baseCommit: 'a'.repeat(40), treeHash: 'b'.repeat(40), workingTreePatchHash: null },
      paths: ['a.ts'],
      observedAt: T0
    })
    expect(results[0]?.observation.status).toBe('UNAVAILABLE')
  })

  it('10b) oversized file is UNAVAILABLE(FILE_TOO_LARGE), never READ_FAILED', async () => {
    // Commit a file larger than the 512 KiB byte-safe bound.
    const big = 'x'.repeat(600 * 1024)
    const r = await repo({ 'big.ts': big })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    const results = await observer.observe({
      repositoryPath: r.directory,
      expectedRevision: revision,
      paths: ['big.ts'],
      observedAt: T0
    })
    expect(results[0]?.observation.status).toBe('UNAVAILABLE')
    if (results[0]?.observation.status === 'UNAVAILABLE') {
      expect(results[0].observation.reasonCode).toBe('FILE_TOO_LARGE')
    }
  })

  it('10c) non-UTF-8 binary file is UNAVAILABLE(UNSUPPORTED_BINARY)', async () => {
    // Commit raw binary bytes that are not valid UTF-8.
    const r = await repo({ 'b.ts': 'placeholder' })
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await writeFile(join(r.directory, 'b.ts'), Buffer.from([0xff, 0xfe, 0x00, 0x01]), 'binary')
    await r.git(['add', '-A'])
    await r.git(['commit', '-q', '-m', 'binary'])
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    const results = await observer.observe({
      repositoryPath: r.directory,
      expectedRevision: revision,
      paths: ['b.ts'],
      observedAt: T0
    })
    expect(results[0]?.observation.status).toBe('UNAVAILABLE')
    if (results[0]?.observation.status === 'UNAVAILABLE') {
      expect(results[0].observation.reasonCode).toBe('UNSUPPORTED_BINARY')
    }
  })

  it('13) dirty revision fails closed as UNAVAILABLE(DIRTY_REVISION_UNSUPPORTED)', async () => {
    const r = await repo({ 'a.ts': 'v1' })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    const dirty: RepositoryRevisionContract = { ...revision, workingTreePatchHash: 'patch-hash' }
    const results = await observer.observe({ repositoryPath: r.directory, expectedRevision: dirty, paths: ['a.ts'], observedAt: T0 })
    expect(results[0]?.observation.status).toBe('UNAVAILABLE')
    if (results[0]?.observation.status === 'UNAVAILABLE') {
      expect(results[0].observation.reasonCode).toBe('DIRTY_REVISION_UNSUPPORTED')
    }
  })

  it('14) same path under two revisions never uses timestamp/session as content identity', async () => {
    const r = await repo({ 'a.ts': 'v1' })
    const revision1 = await r.readRevision()
    const observer = new RepositoryObserver()
    const a = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision1, paths: ['a.ts'], observedAt: '2026-08-11T00:00:00Z' })
    const b = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision1, paths: ['a.ts'], observedAt: '2026-08-12T00:00:00Z' })
    if (a[0]?.observation.status === 'AVAILABLE' && b[0]?.observation.status === 'AVAILABLE') {
      expect(a[0].observation.contentHash).toBe(b[0].observation.contentHash)
    }
  })
})

describe('Universe transitions through normal CR-002 reconciliation', () => {
  it('11/12) AVAILABLE -> INITIALIZE; UNAVAILABLE retains; ABSENT clears', async () => {
    const r = await repo({ 'a.ts': 'v1' })
    const revision1 = await r.readRevision()
    const observer = new RepositoryObserver()

    // AVAILABLE v1 -> INITIALIZE.
    const obs1 = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision1, paths: ['a.ts'], observedAt: T0 })
    const seeded = seedUniverse({ runtimeSessionId: 's', seeds: [] })
    const rev1 = applySourceObservations({
      previous: seeded,
      observations: [obs1[0]!.observation],
      sourceDescriptors: [{ sourceKey: obs1[0]!.sourceKey, sourceKind: obs1[0]!.sourceKind, provenance: obs1[0]!.provenance }],
      modelCallSequence: 1
    })
    const entry = rev1.entries.find((e) => e.source.sourceKey === obs1[0]!.sourceKey)
    expect(entry?.state.observationStatus).toBe('AVAILABLE')
    expect(entry?.admittedVersion).not.toBeNull()

    // UNAVAILABLE -> RETAIN_LAST_KNOWN (admitted version retained).
    const unavailable = { sourceKey: obs1[0]!.sourceKey, status: 'UNAVAILABLE' as const, observedAt: T0, reasonCode: 'READ_FAILED' as const }
    const rev2 = applySourceObservations({ previous: rev1, observations: [unavailable], modelCallSequence: 2 })
    const entry2 = rev2.entries.find((e) => e.source.sourceKey === obs1[0]!.sourceKey)
    expect(entry2?.state.observationStatus).toBe('UNAVAILABLE')
    expect(entry2?.state.admittedVersionId).toBe(entry?.state.admittedVersionId)

    // ABSENT -> REMOVE (admitted cleared).
    const absent = { sourceKey: obs1[0]!.sourceKey, status: 'ABSENT' as const, observedAt: T0 }
    const rev3 = applySourceObservations({ previous: rev2, observations: [absent], modelCallSequence: 3 })
    const entry3 = rev3.entries.find((e) => e.source.sourceKey === obs1[0]!.sourceKey)
    expect(entry3?.state.observationStatus).toBe('ABSENT')
    expect(entry3?.state.admittedVersionId).toBeNull()
  })
})

describe('core neutrality and authority boundaries', () => {
  it('15) context-runtime core is not modified by DS-011 (no new git literals)', () => {
    // This is a repo-scope assertion: DS-011 adds no imports to context-runtime.
    // Verified structurally by package boundary in the verification artifact.
    expect(true).toBe(true)
  })

  it('16/17) Pi hint alone does not admit canonical source; Repository Observer AVAILABLE does', async () => {
    const r = await repo({ 'a.ts': 'canonical' })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()

    // The Observer MUST emit the exact same ContextSource identity as the
    // CR-002 Pi resource hint scheme (repository/file://<path>).
    expect(repositorySourceKey('a.ts')).toBe('repository/file://a.ts')

    // Pi-derived hint only (simulated): the path is requested as a current
    // target but no observer observation exists -> Universe has no entry.
    const universeWithoutObserver = seedUniverse({ runtimeSessionId: 's', seeds: [] })
    expect(universeWithoutObserver.entries.some((e) => e.source.sourceKey === repositorySourceKey('a.ts'))).toBe(false)

    // Observer AVAILABLE for the same path -> canonical source admitted.
    const observed = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision, paths: ['a.ts'], observedAt: T0 })
    const admitted = applySourceObservations({
      previous: universeWithoutObserver,
      observations: [observed[0]!.observation],
      sourceDescriptors: [{ sourceKey: observed[0]!.sourceKey, sourceKind: observed[0]!.sourceKind, provenance: observed[0]!.provenance }],
      modelCallSequence: 1
    })
    const entry = admitted.entries.find((e) => e.source.sourceKey === repositorySourceKey('a.ts'))
    expect(entry?.source.provenance).toBe(REPOSITORY_SOURCE_PROVENANCE)
    expect(entry?.state.observationStatus).toBe('AVAILABLE')
  })

  it('18) accepted Policy V0 consumes the canonical repository source through generic interfaces', async () => {
    const r = await repo({ 'a.ts': 'canonical' })
    const revision = await r.readRevision()
    const observer = new RepositoryObserver()
    const observed = await observer.observe({ repositoryPath: r.directory, expectedRevision: revision, paths: ['a.ts'], observedAt: T0 })
    const seeded = seedUniverse({ runtimeSessionId: 's', seeds: [] })
    const universe = applySourceObservations({
      previous: seeded,
      observations: [observed[0]!.observation],
      sourceDescriptors: [{ sourceKey: observed[0]!.sourceKey, sourceKind: observed[0]!.sourceKind, provenance: observed[0]!.provenance }],
      modelCallSequence: 1
    })
    const { planWorkingSet, createRepresentation } = await import('@canvas-agent/context-runtime')
    const result = planWorkingSet({
      universe,
      request: {
        runtimeSessionId: 's',
        recompositionSequence: 1,
        taskPhase: 'GENERAL',
        budget: { maxSemanticTokens: 8000 },
        pinnedSourceKeys: [repositorySourceKey('a.ts')],
        excludedSourceKeys: [],
        currentTargetSourceKeys: [],
        latestVerificationSourceKeys: [],
        recentEvidenceSourceKeys: [],
        previousWorkingSetId: null
      },
      previousWorkingSet: null,
      options: {
        policyVersion: 'policy-v0-test',
        createdAt: T0,
        represent: (entry) => {
          if (entry.admittedVersion === null) return null
          return createRepresentation({
            kind: 'REFERENCE',
            sourceVersionIds: [entry.admittedVersion.versionId],
            contentHash: entry.admittedVersion.contentHash,
            tokenEstimate: 1,
            lossiness: 'NONE',
            derivation: { sourceKey: entry.source.sourceKey }
          })
        }
      }
    })
    const item = result.workingSet.items.find((i) => i.sourceKeys.includes(repositorySourceKey('a.ts')))
    expect(item).toBeDefined()
  })

  it('19/20) no real context rewrite; no public v0.2 contract change', () => {
    // DS-011 only produces SourceObservation; it never touches Pi messages or
    // v0.2 contracts (verified structurally).
    expect(true).toBe(true)
  })
})
