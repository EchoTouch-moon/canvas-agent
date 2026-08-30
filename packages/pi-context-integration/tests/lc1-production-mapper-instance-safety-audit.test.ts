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
import {
  Lc1ProductionRepositoryMapper,
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
      content: [{ type: 'toolCall', id: callId, name: 'read', arguments: { path: PATH } }]
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

    const newerMapper = mapperFor(bindings, { observe: async () => capturedV4.observations })
    const newerMessages = readMessages('multi-mapper-v4', CONTENT_V4)
    const newer = await newerMapper.observeAndQueue(
      request(newerMessages, capturedV4.revision, 2, {
        runtimeSessionId: 'multi-mapper-session'
      }),
      runtime
    )
    expect(newer.accepted).toHaveLength(1)
    runtime.observeModelCall(newerMessages)

    const olderMapper = mapperFor(bindings, { observe: async () => capturedV3.observations })
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
      request(messagesA, revisionA, 1, { runtimeSessionId: 'restart-scope-session' }),
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
      request(currentMessages, revision, 2, { runtimeSessionId: 'direct-bypass-session' }),
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
      request(olderMessages, capturedV3.revision, 1, { runtimeSessionId: 'concurrent-session' }),
      runtime
    )
    const newerPending = mapper.observeAndQueue(
      request(newerMessages, capturedV4.revision, 2, { runtimeSessionId: 'concurrent-session' }),
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
      expect.objectContaining({ sourceKey: FILE_KEY, reason: 'STALE_AUTHORITY' })
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
    const mapperA = mapperFor(bindings, { observe: async () => capturedV4.observations })
    const currentMessages = readMessages('restored-v4', CONTENT_V4)
    const current = await mapperA.observeAndQueue(
      request(currentMessages, capturedV4.revision, 2, { runtimeSessionId: 'restored-session' }),
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
      expect.objectContaining({ sourceKey: FILE_KEY, reason: 'STALE_AUTHORITY' })
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
      expect.objectContaining({ sourceKey: FILE_KEY, reason: 'CROSS_SCOPE_COLLISION' })
    ])
    const final = runtime.observeModelCall(userMessages('no rejected queue'))
    expect(repositoryEntry(final)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V4))
  })
})
