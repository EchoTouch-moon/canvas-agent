import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAvailableObservation,
  sha256Hex,
  type ContextSourceDescriptor
} from '@canvas-agent/context-runtime'
import {
  RepositoryObserver,
  type RepositoryFileObservation
} from '@canvas-agent/repository-observer'
import {
  readRepositoryRevision,
  runGitCommand,
  type GitRunOptions
} from '@canvas-agent/worker-runtime'
import { EnrichedPiShadowObserver, PiContextShadowObserver, type PiMessageView } from '../src'
import { createLc1MapperAuthorityCandidate } from '../src/active/lc1-runtime-repository-admission'
import {
  Lc1ProductionRepositoryMapper,
  Lc1RuntimeRepositoryAdmissionHost,
  type Lc1RuntimeRepositoryAdmissionCandidate,
  type Lc1RepositoryMappingRequest,
  type Lc1RepositoryRevision
} from '../src/experimental'

const PATH = 'src/reopen-a.ts'
const FILE_KEY = `repository/file://${PATH}`
const CONTENT_V3 = 'export const value = "reopen-a:v3"\n'
const CONTENT_V4 = 'export const value = "reopen-a:v4"\n'
const CONTENT_REPOSITORY_B = 'export const value = "repository-b:v1"\n'
const T0 = '2026-08-31T00:00:00.000Z'

interface TempRepository {
  readonly directory: string
  readonly git: (args: readonly string[]) => Promise<string>
  readonly revision: () => Promise<Lc1RepositoryRevision>
}

interface CapturedRevision {
  readonly revision: Lc1RepositoryRevision
  readonly observations: RepositoryFileObservation[]
}

interface Deferred<Value> {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value) => void
}

const repositories: TempRepository[] = []

function gitOptions(cwd: string): GitRunOptions {
  return {
    cwd,
    timeoutMs: 30_000,
    maxOutputBytes: 2 * 1024 * 1024,
    commandAllowlist: ['git'],
    signal: undefined
  }
}

async function createRepository(content: string): Promise<TempRepository> {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-lc1-mapper-instance-audit-'))
  const git = async (args: readonly string[]): Promise<string> => {
    const result = await runGitCommand(args, gitOptions(directory))
    if (result.exitCode !== 0) {
      throw new Error(`git failed: ${args.join(' ')}\n${result.stderr}`)
    }
    return result.stdout.trim()
  }
  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 'lc1-audit@canvas.local'])
  await git(['config', 'user.name', 'LC1 Mapper Instance Audit'])
  await mkdir(join(directory, 'src'), { recursive: true })
  await writeFile(join(directory, PATH), content, 'utf8')
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'fixture'])

  const repository: TempRepository = {
    directory,
    git,
    revision: async () => {
      const revision = await readRepositoryRevision(directory, gitOptions(directory))
      if (revision.baseCommit === null || revision.treeHash === null) {
        throw new Error('expected committed repository revision')
      }
      return {
        baseCommit: revision.baseCommit,
        treeHash: revision.treeHash,
        workingTreePatchHash: revision.workingTreePatchHash
      }
    }
  }
  repositories.push(repository)
  return repository
}

afterEach(async () => {
  await Promise.all(
    repositories
      .splice(0)
      .map((repository) => rm(repository.directory, { recursive: true, force: true }))
  )
})

function deferred<Value>(): Deferred<Value> {
  let resolveValue: ((value: Value) => void) | undefined
  const promise = new Promise<Value>((resolve) => {
    resolveValue = resolve
  })
  return {
    promise,
    resolve: (value) => {
      if (resolveValue === undefined) throw new Error('deferred resolver unavailable')
      resolveValue(value)
    }
  }
}

function readMessages(callId: string, content: string): PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: callId,
          name: 'read',
          arguments: { path: PATH }
        }
      ]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: content }],
      toolCallId: callId,
      toolName: 'read',
      isError: false
    }
  ]
}

function userMessages(text: string): PiMessageView[] {
  return [{ role: 'user', content: [{ type: 'text', text }] }]
}

function request(
  messages: readonly PiMessageView[],
  revision: Lc1RepositoryRevision,
  authoritySequence: number,
  options: {
    readonly runtimeSessionId?: string
    readonly repositoryId?: string
    readonly namespace?: string
    readonly modelCallSequence?: number
    readonly streamId?: string
  } = {}
): Lc1RepositoryMappingRequest {
  return {
    messages,
    runtimeSessionId: options.runtimeSessionId ?? 'mapper-instance-audit',
    modelCallSequence: options.modelCallSequence ?? authoritySequence,
    repositoryId: options.repositoryId ?? 'repo-a',
    namespace: options.namespace ?? 'workspace',
    expectedRevision: revision,
    authorityOrder: {
      streamId: options.streamId ?? 'authority-stream-a',
      sequence: authoritySequence
    },
    observedAt: T0
  }
}

function runtimeObserver(runtimeSessionId = 'mapper-instance-audit') {
  return new EnrichedPiShadowObserver({
    base: new PiContextShadowObserver({ runtimeSessionId, now: () => T0 })
  })
}

function guardedRuntime(runtimeSessionId = 'mapper-instance-audit') {
  return new Lc1RuntimeRepositoryAdmissionHost({
    observer: { runtimeSessionId, now: () => T0 }
  })
}

function repositoryEntry(result: ReturnType<EnrichedPiShadowObserver['observeModelCall']>) {
  return result.universeRevision.entries.find((entry) => entry.source.sourceKey === FILE_KEY)
}

function mapperFor(
  bindings: ReadonlyMap<string, TempRepository>,
  repositoryObserver?: Pick<RepositoryObserver, 'observe'>
) {
  return new Lc1ProductionRepositoryMapper({
    pathResolver: {
      resolve: ({ repositoryId, namespace }) =>
        namespace === 'workspace' ? bindings.get(repositoryId)?.directory : undefined
    },
    ...(repositoryObserver === undefined ? {} : { repositoryObserver })
  })
}

async function capture(
  repository: TempRepository,
  observer = new RepositoryObserver()
): Promise<CapturedRevision> {
  const revision = await repository.revision()
  return {
    revision,
    observations: await observer.observe({
      repositoryPath: repository.directory,
      expectedRevision: revision,
      paths: [PATH],
      observedAt: T0
    })
  }
}

async function commitContent(repository: TempRepository, content: string, message: string) {
  await writeFile(join(repository.directory, PATH), content, 'utf8')
  await repository.git(['add', '-A'])
  await repository.git(['commit', '-q', '-m', message])
}

function descriptor(
  authority: string,
  provenance = 'REPOSITORY_OBSERVER'
): ContextSourceDescriptor {
  return {
    sourceKey: FILE_KEY,
    sourceKind: 'REPOSITORY_FILE',
    provenance,
    authority
  }
}

describe('LC1 production mapper instance-safety audit', () => {
  it('records a stale rollback admitted through two independent mapper instances', async () => {
    const repository = await createRepository(CONTENT_V3)
    const realObserver = new RepositoryObserver()
    const capturedV3 = await capture(repository, realObserver)
    await commitContent(repository, CONTENT_V4, 'v4')
    const capturedV4 = await capture(repository, realObserver)
    const bindings = new Map([['repo-a', repository]])
    const runtime = runtimeObserver('multi-mapper-session')

    const newerMapper = mapperFor(bindings, {
      observe: async () => capturedV4.observations
    })
    const newerMessages = readMessages('multi-mapper-v4', CONTENT_V4)
    const newer = await newerMapper.observeAndQueue(
      request(newerMessages, capturedV4.revision, 2, {
        runtimeSessionId: 'multi-mapper-session'
      }),
      runtime
    )
    expect(newer.accepted).toHaveLength(1)
    runtime.observeModelCall(newerMessages)

    const olderMapper = mapperFor(bindings, {
      observe: async () => capturedV3.observations
    })
    const olderMessages = readMessages('multi-mapper-v3', CONTENT_V3)
    const older = await olderMapper.observeAndQueue(
      request(olderMessages, capturedV3.revision, 1, {
        runtimeSessionId: 'multi-mapper-session'
      }),
      runtime
    )
    expect(older.accepted).toHaveLength(1)
    const rolledBack = runtime.observeModelCall(olderMessages)

    expect(repositoryEntry(rolledBack)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V3))
    expect({
      finding: 'MULTI_MAPPER_STALE_ROLLBACK',
      classification:
        repositoryEntry(rolledBack)?.admittedVersion?.contentHash === sha256Hex(CONTENT_V3)
          ? 'OPEN_SAFETY_GAP'
          : 'PASS'
    }).toEqual({
      finding: 'MULTI_MAPPER_STALE_ROLLBACK',
      classification: 'OPEN_SAFETY_GAP'
    })
  })

  it('records a cross-scope collision admitted after mapper restart without state transfer', async () => {
    const repositoryA = await createRepository(CONTENT_V3)
    const repositoryB = await createRepository(CONTENT_REPOSITORY_B)
    const revisionA = await repositoryA.revision()
    const revisionB = await repositoryB.revision()
    const runtime = runtimeObserver('restart-scope-session')

    const mapperA = mapperFor(new Map([['repo-a', repositoryA]]))
    const messagesA = readMessages('restart-repo-a', CONTENT_V3)
    const first = await mapperA.observeAndQueue(
      request(messagesA, revisionA, 1, {
        runtimeSessionId: 'restart-scope-session'
      }),
      runtime
    )
    expect(first.accepted).toHaveLength(1)
    const beforeRestart = runtime.observeModelCall(messagesA)
    const authorityA = repositoryEntry(beforeRestart)?.source.authority

    const mapperB = mapperFor(new Map([['repo-b', repositoryB]]))
    const messagesB = readMessages('restart-repo-b', CONTENT_REPOSITORY_B)
    const second = await mapperB.observeAndQueue(
      request(messagesB, revisionB, 1, {
        runtimeSessionId: 'restart-scope-session',
        repositoryId: 'repo-b',
        streamId: 'authority-stream-b'
      }),
      runtime
    )
    expect(second.accepted).toHaveLength(1)
    const afterRestart = runtime.observeModelCall(messagesB)
    const entry = repositoryEntry(afterRestart)

    expect(entry?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_REPOSITORY_B))
    expect(entry?.source.authority).not.toBe(authorityA)
    expect({
      finding: 'RESTART_CROSS_SCOPE_COLLISION',
      classification:
        entry?.admittedVersion?.contentHash === sha256Hex(CONTENT_REPOSITORY_B)
          ? 'OPEN_SAFETY_GAP'
          : 'PASS'
    }).toEqual({
      finding: 'RESTART_CROSS_SCOPE_COLLISION',
      classification: 'OPEN_SAFETY_GAP'
    })
  })

  it('records direct external-queue rollback and descriptor drift around the mapper', async () => {
    const repository = await createRepository(CONTENT_V4)
    const revision = await repository.revision()
    const runtime = runtimeObserver('direct-bypass-session')
    const mapper = mapperFor(new Map([['repo-a', repository]]))
    const currentMessages = readMessages('direct-bypass-v4', CONTENT_V4)

    const currentMapping = await mapper.observeAndQueue(
      request(currentMessages, revision, 2, {
        runtimeSessionId: 'direct-bypass-session'
      }),
      runtime
    )
    expect(currentMapping.accepted).toHaveLength(1)
    runtime.observeModelCall(currentMessages)

    runtime.queueExternalObservations([
      {
        observation: createAvailableObservation(FILE_KEY, sha256Hex(CONTENT_V3), T0),
        descriptor: descriptor('forged:older-scope', 'UNTRUSTED_ADAPTER')
      }
    ])
    const bypassed = runtime.observeModelCall(userMessages('consume direct bypass'))
    const entry = repositoryEntry(bypassed)

    expect(entry?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V3))
    expect(entry?.source).toMatchObject({
      authority: 'forged:older-scope',
      provenance: 'UNTRUSTED_ADAPTER'
    })
    expect({
      finding: 'DIRECT_QUEUE_BYPASSES_MAPPER_ADMISSION',
      classification: entry?.source.provenance === 'UNTRUSTED_ADAPTER' ? 'OPEN_SAFETY_GAP' : 'PASS'
    }).toEqual({
      finding: 'DIRECT_QUEUE_BYPASSES_MAPPER_ADMISSION',
      classification: 'OPEN_SAFETY_GAP'
    })
  })

  it('rejects an older completion when concurrent calls share one mapper instance', async () => {
    const repository = await createRepository(CONTENT_V3)
    const realObserver = new RepositoryObserver()
    const capturedV3 = await capture(repository, realObserver)
    await commitContent(repository, CONTENT_V4, 'v4')
    const capturedV4 = await capture(repository, realObserver)
    const delayedV3 = deferred<RepositoryFileObservation[]>()
    const delayedV4 = deferred<RepositoryFileObservation[]>()
    const observer: Pick<RepositoryObserver, 'observe'> = {
      observe: async (input) =>
        input.expectedRevision.baseCommit === capturedV3.revision.baseCommit
          ? delayedV3.promise
          : delayedV4.promise
    }
    const mapper = mapperFor(new Map([['repo-a', repository]]), observer)
    const runtime = runtimeObserver('concurrent-session')
    const olderMessages = readMessages('concurrent-v3', CONTENT_V3)
    const newerMessages = readMessages('concurrent-v4', CONTENT_V4)

    const olderPending = mapper.observeAndQueue(
      request(olderMessages, capturedV3.revision, 1, {
        runtimeSessionId: 'concurrent-session'
      }),
      runtime
    )
    const newerPending = mapper.observeAndQueue(
      request(newerMessages, capturedV4.revision, 2, {
        runtimeSessionId: 'concurrent-session'
      }),
      runtime
    )

    delayedV4.resolve(capturedV4.observations)
    const newer = await newerPending
    expect(newer.accepted).toHaveLength(1)
    runtime.observeModelCall(newerMessages)

    delayedV3.resolve(capturedV3.observations)
    const older = await olderPending
    expect(older.accepted).toEqual([])
    expect(older.rejected).toEqual([
      expect.objectContaining({
        sourceKey: FILE_KEY,
        reason: 'STALE_AUTHORITY'
      })
    ])
    const final = runtime.observeModelCall(userMessages('no stale queue'))
    expect(repositoryEntry(final)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V4))
  })

  it('preserves stale-order and cross-scope guards when mapper state is explicitly restored', async () => {
    const repositoryA = await createRepository(CONTENT_V3)
    const repositoryB = await createRepository(CONTENT_REPOSITORY_B)
    const realObserver = new RepositoryObserver()
    const capturedV3 = await capture(repositoryA, realObserver)
    await commitContent(repositoryA, CONTENT_V4, 'v4')
    const capturedV4 = await capture(repositoryA, realObserver)
    const capturedB = await capture(repositoryB, realObserver)
    const bindings = new Map([
      ['repo-a', repositoryA],
      ['repo-b', repositoryB]
    ])
    const runtime = runtimeObserver('restored-session')
    const mapperA = mapperFor(bindings, {
      observe: async () => capturedV4.observations
    })
    const currentMessages = readMessages('restored-v4', CONTENT_V4)
    const current = await mapperA.observeAndQueue(
      request(currentMessages, capturedV4.revision, 2, {
        runtimeSessionId: 'restored-session'
      }),
      runtime
    )
    expect(current.accepted).toHaveLength(1)
    runtime.observeModelCall(currentMessages)

    const mapperB = mapperFor(bindings, {
      observe: async (input) =>
        input.repositoryPath === repositoryB.directory
          ? capturedB.observations
          : capturedV3.observations
    })
    mapperB.restoreTransaction(mapperA.snapshotForTransaction())

    const stale = await mapperB.observeAndQueue(
      request(readMessages('restored-v3', CONTENT_V3), capturedV3.revision, 1, {
        runtimeSessionId: 'restored-session'
      }),
      runtime
    )
    expect(stale.accepted).toEqual([])
    expect(stale.rejected).toEqual([
      expect.objectContaining({
        sourceKey: FILE_KEY,
        reason: 'STALE_AUTHORITY'
      })
    ])

    const crossScope = await mapperB.observeAndQueue(
      request(readMessages('restored-repo-b', CONTENT_REPOSITORY_B), capturedB.revision, 3, {
        runtimeSessionId: 'restored-session',
        repositoryId: 'repo-b'
      }),
      runtime
    )
    expect(crossScope.accepted).toEqual([])
    expect(crossScope.quarantined).toEqual([
      expect.objectContaining({
        sourceKey: FILE_KEY,
        reason: 'CROSS_SCOPE_COLLISION'
      })
    ])
    const final = runtime.observeModelCall(userMessages('no rejected queue'))
    expect(repositoryEntry(final)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V4))
  })
})

describe('LC1 runtime-owned repository admission', () => {
  it('retains the newer head when independent mappers submit a stale completion', async () => {
    const repository = await createRepository(CONTENT_V3)
    const realObserver = new RepositoryObserver()
    const capturedV3 = await capture(repository, realObserver)
    await commitContent(repository, CONTENT_V4, 'v4')
    const capturedV4 = await capture(repository, realObserver)
    const bindings = new Map([['repo-a', repository]])
    const runtime = guardedRuntime('guarded-multi-mapper')

    const newerMessages = readMessages('guarded-v4', CONTENT_V4)
    const newer = await mapperFor(bindings, {
      observe: async () => capturedV4.observations
    }).observeAndQueue(
      request(newerMessages, capturedV4.revision, 2, {
        runtimeSessionId: 'guarded-multi-mapper'
      }),
      runtime
    )
    expect(newer.accepted).toHaveLength(1)
    runtime.observeModelCall(newerMessages)

    const olderMessages = readMessages('guarded-v3', CONTENT_V3)
    const older = await mapperFor(bindings, {
      observe: async () => capturedV3.observations
    }).observeAndQueue(
      request(olderMessages, capturedV3.revision, 1, {
        runtimeSessionId: 'guarded-multi-mapper'
      }),
      runtime
    )
    expect(older.accepted).toEqual([])
    expect(older.rejected).toEqual([
      expect.objectContaining({
        sourceKey: FILE_KEY,
        reason: 'STALE_AUTHORITY'
      })
    ])
    const final = runtime.observeModelCall(userMessages('stale candidate was not queued'))
    expect(repositoryEntry(final)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V4))
  })

  it('serializes concurrent out-of-order completions across mapper instances', async () => {
    const repository = await createRepository(CONTENT_V3)
    const realObserver = new RepositoryObserver()
    const capturedV3 = await capture(repository, realObserver)
    await commitContent(repository, CONTENT_V4, 'v4')
    const capturedV4 = await capture(repository, realObserver)
    const delayedV3 = deferred<RepositoryFileObservation[]>()
    const delayedV4 = deferred<RepositoryFileObservation[]>()
    const bindings = new Map([['repo-a', repository]])
    const runtime = guardedRuntime('guarded-concurrent')
    const olderMessages = readMessages('guarded-concurrent-v3', CONTENT_V3)
    const newerMessages = readMessages('guarded-concurrent-v4', CONTENT_V4)

    const olderPending = mapperFor(bindings, {
      observe: async () => delayedV3.promise
    }).observeAndQueue(
      request(olderMessages, capturedV3.revision, 1, {
        runtimeSessionId: 'guarded-concurrent'
      }),
      runtime
    )
    const newerPending = mapperFor(bindings, {
      observe: async () => delayedV4.promise
    }).observeAndQueue(
      request(newerMessages, capturedV4.revision, 2, {
        runtimeSessionId: 'guarded-concurrent'
      }),
      runtime
    )

    delayedV4.resolve(capturedV4.observations)
    expect((await newerPending).accepted).toHaveLength(1)
    runtime.observeModelCall(newerMessages)
    delayedV3.resolve(capturedV3.observations)
    expect((await olderPending).rejected).toEqual([
      expect.objectContaining({
        sourceKey: FILE_KEY,
        reason: 'STALE_AUTHORITY'
      })
    ])
    const final = runtime.observeModelCall(userMessages('concurrent stale candidate rejected'))
    expect(repositoryEntry(final)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V4))
  })

  it('preserves same-scope history across mapper replacement', async () => {
    const repository = await createRepository(CONTENT_V3)
    const bindings = new Map([['repo-a', repository]])
    const runtime = guardedRuntime('guarded-restart')
    const revisionV3 = await repository.revision()
    const messagesV3 = readMessages('guarded-restart-v3', CONTENT_V3)
    expect(
      (
        await mapperFor(bindings).observeAndQueue(
          request(messagesV3, revisionV3, 1, {
            runtimeSessionId: 'guarded-restart'
          }),
          runtime
        )
      ).accepted
    ).toHaveLength(1)
    runtime.observeModelCall(messagesV3)

    await commitContent(repository, CONTENT_V4, 'v4')
    const revisionV4 = await repository.revision()
    const messagesV4 = readMessages('guarded-restart-v4', CONTENT_V4)
    const replacedMapperResult = await mapperFor(bindings).observeAndQueue(
      request(messagesV4, revisionV4, 2, {
        runtimeSessionId: 'guarded-restart'
      }),
      runtime
    )
    expect(replacedMapperResult.accepted).toHaveLength(1)
    const final = runtime.observeModelCall(messagesV4)
    expect(repositoryEntry(final)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V4))
  })

  it('quarantines a different repository scope after mapper replacement', async () => {
    const repositoryA = await createRepository(CONTENT_V3)
    const repositoryB = await createRepository(CONTENT_REPOSITORY_B)
    const runtime = guardedRuntime('guarded-cross-scope')
    const messagesA = readMessages('guarded-scope-a', CONTENT_V3)
    const first = await mapperFor(new Map([['repo-a', repositoryA]])).observeAndQueue(
      request(messagesA, await repositoryA.revision(), 1, {
        runtimeSessionId: 'guarded-cross-scope'
      }),
      runtime
    )
    expect(first.accepted).toHaveLength(1)
    runtime.observeModelCall(messagesA)

    const messagesB = readMessages('guarded-scope-b', CONTENT_REPOSITORY_B)
    const crossScope = await mapperFor(new Map([['repo-b', repositoryB]])).observeAndQueue(
      request(messagesB, await repositoryB.revision(), 2, {
        runtimeSessionId: 'guarded-cross-scope',
        repositoryId: 'repo-b'
      }),
      runtime
    )
    expect(crossScope.accepted).toEqual([])
    expect(crossScope.quarantined).toEqual([
      expect.objectContaining({
        sourceKey: FILE_KEY,
        reason: 'CROSS_SCOPE_COLLISION'
      })
    ])
    const final = runtime.observeModelCall(userMessages('cross-scope candidate rejected'))
    expect(repositoryEntry(final)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V3))
  })

  it('does not expose the legacy external-observation queue or inner observer', () => {
    const runtime = guardedRuntime('guarded-no-bypass')
    expect('queueExternalObservations' in runtime).toBe(false)
    expect('enriched' in runtime).toBe(false)

    const attemptedBypass = runtime as unknown as {
      queueExternalObservations(observations: readonly unknown[]): void
    }
    expect(() =>
      attemptedBypass.queueExternalObservations([
        {
          observation: createAvailableObservation(FILE_KEY, sha256Hex(CONTENT_V3), T0),
          descriptor: descriptor('forged')
        }
      ])
    ).toThrow(TypeError)

    const result = runtime.observeModelCall(userMessages('no bypassed observation'))
    expect(repositoryEntry(result)).toBeUndefined()
  })

  it('rejects repository seeds while preserving non-repository seed compatibility', () => {
    const repositorySeedSignals = [
      { sourceKey: FILE_KEY, sourceKind: 'OTHER', provenance: 'OTHER' },
      { sourceKey: 'other:v1', sourceKind: 'REPOSITORY_FILE', provenance: 'OTHER' },
      { sourceKey: 'other:v1', sourceKind: 'OTHER', provenance: 'REPOSITORY_OBSERVER' }
    ]
    for (const [index, signal] of repositorySeedSignals.entries()) {
      expect(
        () =>
          new Lc1RuntimeRepositoryAdmissionHost({
            observer: { runtimeSessionId: `guarded-repository-seed-${index}`, now: () => T0 },
            seeds: [
              {
                ...signal,
                contentHash: sha256Hex(CONTENT_V3),
                observedAt: T0
              }
            ]
          })
      ).toThrow('lc1_repository_seed_bypasses_runtime_admission')
    }

    const runtime = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: 'guarded-non-repository-seed', now: () => T0 },
      seeds: [
        {
          sourceKey: 'task/spec:v1',
          sourceKind: 'TASK_SPEC',
          provenance: 'FROZEN_FIXTURE',
          contentHash: sha256Hex('task spec'),
          observedAt: T0
        }
      ]
    })
    const result = runtime.observeModelCall(userMessages('consume allowed seed'))
    expect(result.universeRevision.entries).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ sourceKey: 'task/spec:v1', sourceKind: 'TASK_SPEC' })
      })
    ])
  })

  it('rejects unregistered candidates even when a copied object retains the brand', async () => {
    const repository = await createRepository(CONTENT_V3)
    const sessionId = 'guarded-unbranded'
    const messages = readMessages('guarded-unbranded-call', CONTENT_V3)
    const mapping = await mapperFor(new Map([['repo-a', repository]])).observeAndQueue(
      request(messages, await repository.revision(), 1, {
        runtimeSessionId: sessionId
      }),
      { queueExternalObservations: () => undefined }
    )
    const branded = mapping.accepted[0]
    if (branded === undefined) throw new Error('expected branded mapper candidate')
    const copiedBrand = { ...branded } as Lc1RuntimeRepositoryAdmissionCandidate
    const unbranded = Object.fromEntries(
      Object.entries(branded)
    ) as unknown as Lc1RuntimeRepositoryAdmissionCandidate
    const runtime = guardedRuntime(sessionId)

    const result = runtime.admitLc1RepositoryObservations([copiedBrand, unbranded])
    expect(result.accepted).toEqual([])
    expect(result.rejected).toHaveLength(2)
    expect(
      result.rejected.every(
        (issue) => issue.sourceKey === FILE_KEY && issue.reason === 'INVALID_REQUEST'
      )
    ).toBe(true)
    expect(
      repositoryEntry(runtime.observeModelCall(userMessages('unbranded rejected')))
    ).toBeUndefined()
  })

  it('rejects branded candidates with corrupted revision or observation structure', async () => {
    const repository = await createRepository(CONTENT_V3)
    const sessionId = 'guarded-structural-validation'
    const messages = readMessages('guarded-structural-call', CONTENT_V3)
    const mapping = await mapperFor(new Map([['repo-a', repository]])).observeAndQueue(
      request(messages, await repository.revision(), 1, {
        runtimeSessionId: sessionId
      }),
      { queueExternalObservations: () => undefined }
    )
    const candidate = mapping.accepted[0]
    if (candidate === undefined) throw new Error('expected structural-validation candidate')
    const runtime = guardedRuntime(sessionId)
    const invalidRevision: Lc1RuntimeRepositoryAdmissionCandidate = {
      ...candidate,
      authorityRevision: {
        ...candidate.authorityRevision,
        baseCommit: 'not-a-git-object'
      }
    }
    const invalidObservation: Lc1RuntimeRepositoryAdmissionCandidate = {
      ...candidate,
      callIds: ['guarded-invalid-observation'],
      namespacedCallIds: [
        'pi-evidence:v1:guarded-structural-validation:guarded-invalid-observation'
      ],
      observation: createAvailableObservation(FILE_KEY, 'not-a-content-hash', T0)
    }

    const result = runtime.admitLc1RepositoryObservations([invalidRevision, invalidObservation])
    expect(result.accepted).toEqual([])
    expect(result.rejected).toHaveLength(2)
    expect(result.rejected.every((issue) => issue.reason === 'INVALID_REQUEST')).toBe(true)
    expect(
      repositoryEntry(runtime.observeModelCall(userMessages('invalid structures rejected')))
    ).toBeUndefined()
  })

  it('returns typed invalid-request outcomes for malformed JavaScript inputs', () => {
    const runtime = guardedRuntime('guarded-malformed-input')
    const malformedCandidate = runtime.admitLc1RepositoryObservations([
      null as unknown as Lc1RuntimeRepositoryAdmissionCandidate
    ])
    expect(malformedCandidate.accepted).toEqual([])
    expect(malformedCandidate.rejected).toEqual([
      expect.objectContaining({ callIds: [], reason: 'INVALID_REQUEST' })
    ])

    const malformedBatch = runtime.admitLc1RepositoryObservations(
      null as unknown as readonly Lc1RuntimeRepositoryAdmissionCandidate[]
    )
    expect(malformedBatch.accepted).toEqual([])
    expect(malformedBatch.rejected).toEqual([
      expect.objectContaining({
        callIds: [],
        reason: 'INVALID_REQUEST',
        detail: 'candidate batch is not an array'
      })
    ])
    expect(
      repositoryEntry(runtime.observeModelCall(userMessages('malformed inputs rejected')))
    ).toBeUndefined()
  })

  it('distinguishes idempotent, conflicting, and incomparable authority', async () => {
    const repository = await createRepository(CONTENT_V3)
    const captured = await capture(repository)
    const bindings = new Map([['repo-a', repository]])
    const runtime = guardedRuntime('guarded-authority-cases')
    const originalMessages = readMessages('guarded-authority-original', CONTENT_V3)

    const original = await mapperFor(bindings, {
      observe: async () => captured.observations
    }).observeAndQueue(
      request(originalMessages, captured.revision, 1, {
        runtimeSessionId: 'guarded-authority-cases'
      }),
      runtime
    )
    expect(original.accepted).toHaveLength(1)
    runtime.observeModelCall(originalMessages)

    const duplicate = await mapperFor(bindings, {
      observe: async () => captured.observations
    }).observeAndQueue(
      request(originalMessages, captured.revision, 1, {
        runtimeSessionId: 'guarded-authority-cases'
      }),
      runtime
    )
    expect(duplicate.rejected).toEqual([
      expect.objectContaining({ reason: 'IDEMPOTENT_DUPLICATE' })
    ])

    const conflictingMessages = readMessages('guarded-authority-conflict', CONTENT_V3)
    const conflicting = await mapperFor(bindings, {
      observe: async () => captured.observations
    }).observeAndQueue(
      request(conflictingMessages, captured.revision, 1, {
        runtimeSessionId: 'guarded-authority-cases'
      }),
      runtime
    )
    expect(conflicting.quarantined).toEqual([
      expect.objectContaining({ reason: 'CONFLICTING_AUTHORITY' })
    ])

    const incomparable = await mapperFor(bindings, {
      observe: async () => captured.observations
    }).observeAndQueue(
      request(readMessages('guarded-authority-stream', CONTENT_V3), captured.revision, 2, {
        runtimeSessionId: 'guarded-authority-cases',
        streamId: 'other-stream'
      }),
      runtime
    )
    expect(incomparable.quarantined).toEqual([
      expect.objectContaining({ reason: 'INCOMPARABLE_AUTHORITY' })
    ])
  })

  it('freezes descriptor metadata at the runtime owner', async () => {
    const repository = await createRepository(CONTENT_V3)
    const runtime = guardedRuntime('guarded-descriptor')
    const messages = readMessages('guarded-descriptor-original', CONTENT_V3)
    const original = await mapperFor(new Map([['repo-a', repository]])).observeAndQueue(
      request(messages, await repository.revision(), 1, {
        runtimeSessionId: 'guarded-descriptor'
      }),
      runtime
    )
    const candidate = original.accepted[0]
    if (candidate === undefined) throw new Error('expected admitted descriptor candidate')
    runtime.observeModelCall(messages)

    const drifted = createLc1MapperAuthorityCandidate({
      ...candidate,
      callIds: ['guarded-descriptor-drift'],
      namespacedCallIds: ['pi-evidence:v1:guarded-descriptor:guarded-descriptor-drift'],
      authorityOrder: { ...candidate.authorityOrder, sequence: 2 },
      descriptor: { ...candidate.descriptor, priority: 'DRIFTED' }
    })
    const result = runtime.admitLc1RepositoryObservations([drifted])
    expect(result.accepted).toEqual([])
    expect(result.quarantined).toEqual([
      expect.objectContaining({
        sourceKey: FILE_KEY,
        reason: 'DESCRIPTOR_DRIFT'
      })
    ])
    const final = runtime.observeModelCall(userMessages('descriptor drift rejected'))
    expect(repositoryEntry(final)?.source.priority).toBeUndefined()
  })

  it('copies and freezes accepted envelopes before pending admission', async () => {
    const repository = await createRepository(CONTENT_V3)
    const runtime = guardedRuntime('guarded-envelope-ownership')
    const messages = readMessages('guarded-envelope-ownership', CONTENT_V3)
    const mapping = await mapperFor(new Map([['repo-a', repository]])).observeAndQueue(
      request(messages, await repository.revision(), 1, {
        runtimeSessionId: 'guarded-envelope-ownership'
      }),
      runtime
    )
    const accepted = mapping.accepted[0]
    if (accepted === undefined) throw new Error('expected immutable accepted envelope')

    expect(Object.isFrozen(accepted)).toBe(true)
    expect(Object.isFrozen(accepted.observation)).toBe(true)
    expect(Object.isFrozen(accepted.descriptor)).toBe(true)
    expect(
      Reflect.set(
        accepted.descriptor as unknown as Record<string, unknown>,
        'provenance',
        'UNTRUSTED_ADAPTER'
      )
    ).toBe(false)
    expect(
      Reflect.set(
        accepted.observation as unknown as Record<string, unknown>,
        'contentHash',
        sha256Hex('forged')
      )
    ).toBe(false)

    const admitted = runtime.observeModelCall(messages)
    expect(repositoryEntry(admitted)?.source.provenance).toBe('REPOSITORY_OBSERVER')
    expect(repositoryEntry(admitted)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V3))
  })

  it('rejects a call id remap even when the mapper instance is replaced', async () => {
    const repository = await createRepository(CONTENT_V3)
    const runtime = guardedRuntime('guarded-call-binding')
    const messages = readMessages('guarded-call-binding-id', CONTENT_V3)
    const mapping = await mapperFor(new Map([['repo-a', repository]])).observeAndQueue(
      request(messages, await repository.revision(), 1, {
        runtimeSessionId: 'guarded-call-binding'
      }),
      runtime
    )
    const accepted = mapping.accepted[0]
    if (accepted === undefined) throw new Error('expected call-binding candidate')
    runtime.observeModelCall(messages)

    const otherKey = 'repository/file://src/other.ts'
    const remapped = createLc1MapperAuthorityCandidate({
      ...accepted,
      sourceKey: otherKey,
      canonicalPath: 'src/other.ts',
      observation: createAvailableObservation(otherKey, sha256Hex('other'), T0),
      descriptor: { ...accepted.descriptor, sourceKey: otherKey },
      authorityOrder: { ...accepted.authorityOrder, sequence: 2 }
    })
    const result = runtime.admitLc1RepositoryObservations([remapped])
    expect(result.accepted).toEqual([])
    expect(result.rejected).toEqual([
      expect.objectContaining({ sourceKey: otherKey, reason: 'CALL_ID_REMAP' })
    ])
    expect(
      repositoryEntry(runtime.observeModelCall(userMessages('call remap rejected')))
    ).toMatchObject({
      admittedVersion: { contentHash: sha256Hex(CONTENT_V3) }
    })
  })

  it('keeps an invalid mixed batch failure-atomic', async () => {
    const repository = await createRepository(CONTENT_V3)
    const sessionId = 'guarded-batch'
    const messages = readMessages('guarded-batch-valid', CONTENT_V3)
    const capturedCandidates: Lc1RuntimeRepositoryAdmissionCandidate[] = []
    const mapping = await mapperFor(new Map([['repo-a', repository]])).observeAndQueue(
      request(messages, await repository.revision(), 1, {
        runtimeSessionId: sessionId
      }),
      {
        queueExternalObservations: () => undefined
      }
    )
    capturedCandidates.push(...mapping.accepted)
    const valid = capturedCandidates[0]
    if (valid === undefined) throw new Error('expected valid batch candidate')

    const otherKey = 'repository/file://src/other.ts'
    const invalid: Lc1RuntimeRepositoryAdmissionCandidate = {
      ...valid,
      sourceKey: otherKey,
      canonicalPath: 'src/other.ts',
      callIds: ['guarded-batch-invalid'],
      namespacedCallIds: ['pi-evidence:v1:guarded-batch:guarded-batch-invalid'],
      observation: createAvailableObservation(FILE_KEY, sha256Hex('other'), T0),
      descriptor: { ...valid.descriptor, sourceKey: otherKey }
    }
    const runtime = guardedRuntime(sessionId)
    const failedBatch = runtime.admitLc1RepositoryObservations([valid, invalid])
    expect(failedBatch.accepted).toEqual([])
    expect(failedBatch.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: otherKey,
          reason: 'INVALID_REQUEST'
        }),
        expect.objectContaining({
          sourceKey: FILE_KEY,
          reason: 'BATCH_REJECTED'
        })
      ])
    )
    expect(
      repositoryEntry(runtime.observeModelCall(userMessages('empty after failed batch')))
    ).toBeUndefined()

    expect(runtime.admitLc1RepositoryObservations([valid]).accepted).toHaveLength(1)
    const admitted = runtime.observeModelCall(messages)
    expect(repositoryEntry(admitted)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V3))
  })

  it('keeps mapper validation and runtime admission failure-atomic as one batch', async () => {
    const repository = await createRepository(CONTENT_V3)
    const runtime = guardedRuntime('guarded-mapper-batch')
    const validMessages = readMessages('guarded-mapper-batch-valid', CONTENT_V3)
    const mixedMessages: PiMessageView[] = [
      ...validMessages,
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'guarded-mapper-batch-invalid',
            name: 'read',
            arguments: {}
          }
        ]
      },
      {
        role: 'toolResult',
        content: [{ type: 'text', text: 'missing path' }],
        toolCallId: 'guarded-mapper-batch-invalid',
        toolName: 'read',
        isError: false
      }
    ]
    const revision = await repository.revision()
    const bindings = new Map([['repo-a', repository]])

    const failed = await mapperFor(bindings).observeAndQueue(
      request(mixedMessages, revision, 1, { runtimeSessionId: 'guarded-mapper-batch' }),
      runtime
    )
    expect(failed.accepted).toEqual([])
    expect(failed.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callIds: ['guarded-mapper-batch-invalid'],
          reason: 'MISSING_PATH_HINT'
        }),
        expect.objectContaining({
          callIds: ['guarded-mapper-batch-valid'],
          sourceKey: FILE_KEY,
          reason: 'BATCH_REJECTED'
        })
      ])
    )
    expect(
      repositoryEntry(runtime.observeModelCall(userMessages('failed mapper batch stayed empty')))
    ).toBeUndefined()

    const retry = await mapperFor(bindings).observeAndQueue(
      request(validMessages, revision, 1, { runtimeSessionId: 'guarded-mapper-batch' }),
      runtime
    )
    expect(retry.accepted).toHaveLength(1)
    expect(
      repositoryEntry(runtime.observeModelCall(validMessages))?.admittedVersion?.contentHash
    ).toBe(sha256Hex(CONTENT_V3))
  })

  it('preserves AVAILABLE, dirty UNAVAILABLE, UPDATE, and ABSENT lifecycle semantics', async () => {
    const repository = await createRepository(CONTENT_V3)
    const bindings = new Map([['repo-a', repository]])
    const runtime = guardedRuntime('guarded-lifecycle')
    const revisionV3 = await repository.revision()
    const messagesV3 = readMessages('guarded-lifecycle-v3', CONTENT_V3)

    expect(
      (
        await mapperFor(bindings).observeAndQueue(
          request(messagesV3, revisionV3, 1, {
            runtimeSessionId: 'guarded-lifecycle'
          }),
          runtime
        )
      ).accepted
    ).toHaveLength(1)
    const available = runtime.observeModelCall(messagesV3)
    const versionV3 = repositoryEntry(available)?.state.admittedVersionId
    expect(versionV3).toBeDefined()

    await writeFile(join(repository.directory, PATH), CONTENT_V4, 'utf8')
    const dirtyMessages = readMessages('guarded-lifecycle-dirty', CONTENT_V4)
    const dirty = await mapperFor(bindings).observeAndQueue(
      request(dirtyMessages, revisionV3, 2, {
        runtimeSessionId: 'guarded-lifecycle'
      }),
      runtime
    )
    expect(dirty.accepted[0]?.observation).toMatchObject({
      sourceKey: FILE_KEY,
      status: 'UNAVAILABLE',
      reasonCode: 'REVISION_MISMATCH'
    })
    const unavailable = runtime.observeModelCall(dirtyMessages)
    expect(repositoryEntry(unavailable)?.state).toMatchObject({
      observationStatus: 'UNAVAILABLE',
      admittedVersionId: versionV3,
      lastAvailableVersionId: versionV3
    })

    await repository.git(['add', '-A'])
    await repository.git(['commit', '-q', '-m', 'v4'])
    const revisionV4 = await repository.revision()
    const messagesV4 = readMessages('guarded-lifecycle-v4', CONTENT_V4)
    expect(
      (
        await mapperFor(bindings).observeAndQueue(
          request(messagesV4, revisionV4, 3, {
            runtimeSessionId: 'guarded-lifecycle'
          }),
          runtime
        )
      ).accepted
    ).toHaveLength(1)
    const updated = runtime.observeModelCall(messagesV4)
    const versionV4 = repositoryEntry(updated)?.state.admittedVersionId
    expect(versionV4).not.toBe(versionV3)
    expect(repositoryEntry(updated)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V4))

    await repository.git(['rm', '-q', PATH])
    await repository.git(['commit', '-q', '-m', 'delete'])
    const absentMessages = readMessages('guarded-lifecycle-absent', '')
    const absent = await mapperFor(bindings).observeAndQueue(
      request(absentMessages, await repository.revision(), 4, {
        runtimeSessionId: 'guarded-lifecycle'
      }),
      runtime
    )
    expect(absent.accepted[0]?.observation).toMatchObject({ status: 'ABSENT' })
    expect(repositoryEntry(runtime.observeModelCall(absentMessages))?.state).toMatchObject({
      observationStatus: 'ABSENT',
      admittedVersionId: null,
      lastAvailableVersionId: versionV4
    })
  })

  it('restores runtime admission and observation state without mapper state', async () => {
    const repository = await createRepository(CONTENT_V3)
    const bindings = new Map([['repo-a', repository]])
    const revision = await repository.revision()
    const messages = readMessages('guarded-transaction', CONTENT_V3)
    const runtime = guardedRuntime('guarded-transaction')
    const snapshot = runtime.snapshotForTransaction()

    const firstMapping = await mapperFor(bindings).observeAndQueue(
      request(messages, revision, 1, {
        runtimeSessionId: 'guarded-transaction'
      }),
      runtime
    )
    expect(firstMapping.accepted).toHaveLength(1)
    const first = runtime.observeModelCall(messages)

    runtime.restoreTransaction(snapshot)
    const replayMapping = await mapperFor(bindings).observeAndQueue(
      request(messages, revision, 1, {
        runtimeSessionId: 'guarded-transaction'
      }),
      runtime
    )
    expect(replayMapping.accepted).toHaveLength(1)
    const replay = runtime.observeModelCall(messages)
    expect(replay.universeRevision.logicalHash).toBe(first.universeRevision.logicalHash)
    expect(replay.sourceObservations).toEqual(first.sourceObservations)
  })

  it('rejects a corrupted admission snapshot before changing observer state', async () => {
    const repository = await createRepository(CONTENT_V3)
    const runtime = guardedRuntime('guarded-snapshot-integrity')
    const messages = readMessages('guarded-snapshot-integrity', CONTENT_V3)
    const mapping = await mapperFor(new Map([['repo-a', repository]])).observeAndQueue(
      request(messages, await repository.revision(), 1, {
        runtimeSessionId: 'guarded-snapshot-integrity'
      }),
      runtime
    )
    expect(mapping.accepted).toHaveLength(1)
    runtime.observeModelCall(messages)
    const snapshot = runtime.snapshotForTransaction()
    runtime.observeModelCall(userMessages('advance after snapshot'))
    const callCountBeforeRestore = runtime.callCount

    const corrupted = {
      ...snapshot,
      admission: { ...snapshot.admission, acceptedBySource: [] }
    }
    expect(() => runtime.restoreTransaction(corrupted)).toThrow(
      'lc1_admission_snapshot_integrity_mismatch'
    )
    expect(runtime.callCount).toBe(callCountBeforeRestore)
  })

  it('rejects a corrupted observer snapshot before changing either runtime state', async () => {
    const repository = await createRepository(CONTENT_V3)
    const runtime = guardedRuntime('guarded-host-snapshot-integrity')
    const messages = readMessages('guarded-host-snapshot-integrity', CONTENT_V3)
    expect(
      (
        await mapperFor(new Map([['repo-a', repository]])).observeAndQueue(
          request(messages, await repository.revision(), 1, {
            runtimeSessionId: 'guarded-host-snapshot-integrity'
          }),
          runtime
        )
      ).accepted
    ).toHaveLength(1)
    runtime.observeModelCall(messages)
    const snapshot = runtime.snapshotForTransaction()
    runtime.observeModelCall(userMessages('advance after host snapshot'))
    const callCountBeforeRestore = runtime.callCount

    const corrupted = {
      ...snapshot,
      enriched: {
        ...snapshot.enriched,
        callResultCount: snapshot.enriched.callResultCount + 1
      }
    }
    expect(() => runtime.restoreTransaction(corrupted)).toThrow(
      'lc1_admission_host_snapshot_integrity_mismatch'
    )
    expect(runtime.callCount).toBe(callCountBeforeRestore)
  })

  it('refuses a second in-process host that reuses a claimed runtime session id', () => {
    const source = guardedRuntime('same-session-different-host')

    expect(() => guardedRuntime('same-session-different-host')).toThrow(
      'lc1_runtime_session_already_claimed'
    )
    expect(source.callCount).toBe(0)
    expect(source.universeRevision).toBeNull()
  })

  it('rejects a transaction snapshot from another runtime session', () => {
    const source = guardedRuntime('snapshot-source-session')
    const target = guardedRuntime('snapshot-target-session')
    const sourceSnapshot = source.snapshotForTransaction()
    const targetSnapshot = target.snapshotForTransaction()

    expect(() => target.restoreTransaction(sourceSnapshot)).toThrow(
      'lc1_admission_snapshot_host_mismatch'
    )
    const snapshot = {
      ...sourceSnapshot,
      transactionOwner: targetSnapshot.transactionOwner
    }

    expect(() => target.restoreTransaction(snapshot)).toThrow(
      'lc1_admission_snapshot_runtime_session_mismatch'
    )
    expect(target.callCount).toBe(0)
    expect(target.universeRevision).toBeNull()
  })

  it('allows a new repository scope only under a new runtime session identity', async () => {
    const repositoryA = await createRepository(CONTENT_V3)
    const repositoryB = await createRepository(CONTENT_REPOSITORY_B)
    const runtimeA = guardedRuntime('scope-runtime-a')
    const runtimeB = guardedRuntime('scope-runtime-b')
    const messagesA = readMessages('new-runtime-a', CONTENT_V3)
    const messagesB = readMessages('new-runtime-b', CONTENT_REPOSITORY_B)

    expect(
      (
        await mapperFor(new Map([['repo-a', repositoryA]])).observeAndQueue(
          request(messagesA, await repositoryA.revision(), 1, {
            runtimeSessionId: 'scope-runtime-a'
          }),
          runtimeA
        )
      ).accepted
    ).toHaveLength(1)
    expect(
      (
        await mapperFor(new Map([['repo-b', repositoryB]])).observeAndQueue(
          request(messagesB, await repositoryB.revision(), 1, {
            runtimeSessionId: 'scope-runtime-b',
            repositoryId: 'repo-b'
          }),
          runtimeB
        )
      ).accepted
    ).toHaveLength(1)
    expect(
      repositoryEntry(runtimeA.observeModelCall(messagesA))?.admittedVersion?.contentHash
    ).toBe(sha256Hex(CONTENT_V3))
    expect(
      repositoryEntry(runtimeB.observeModelCall(messagesB))?.admittedVersion?.contentHash
    ).toBe(sha256Hex(CONTENT_REPOSITORY_B))
  })
})
