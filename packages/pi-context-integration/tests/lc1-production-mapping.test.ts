import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '@canvas-agent/context-runtime'
import { EnrichedPiShadowObserver, PiContextShadowObserver, type PiMessageView } from '../src'
import { Lc1ProductionRepositoryMapper } from '../src/experimental'
import { RepositoryObserver } from '@canvas-agent/repository-observer'
import {
  readRepositoryRevision,
  runGitCommand,
  type GitRunOptions
} from '@canvas-agent/worker-runtime'
import {
  type Lc1ExternalObservationSink,
  type Lc1RepositoryMappingRequest,
  type Lc1RepositoryRevision
} from '../src/experimental'

const PATH = 'src/reopen-a.ts'
const FILE_KEY = `repository/file://${PATH}`
const CONTENT_V3 = 'export const value = "reopen-a:v3"\n'
const CONTENT_V4 = 'export const value = "reopen-a:v4"\n'
const T0 = '2026-08-30T00:00:00.000Z'

interface TempRepository {
  readonly directory: string
  readonly git: (args: readonly string[]) => Promise<string>
  readonly revision: () => Promise<Lc1RepositoryRevision>
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
  const directory = await mkdtemp(join(tmpdir(), 'canvas-lc1-production-mapper-'))
  const git = async (args: readonly string[]): Promise<string> => {
    const result = await runGitCommand(args, gitOptions(directory))
    if (result.exitCode !== 0) {
      throw new Error(`git failed: ${args.join(' ')}\n${result.stderr}`)
    }
    return result.stdout.trim()
  }
  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 'lc1@canvas.local'])
  await git(['config', 'user.name', 'LC1 Production Mapper'])
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

function readMessages(
  callId: string,
  path = PATH,
  content = CONTENT_V3,
  toolName = 'read',
  resultToolName = toolName
): PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: callId, name: toolName, arguments: { path } }]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: content }],
      toolCallId: callId,
      toolName: resultToolName,
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
  sequence: number,
  options: {
    readonly runtimeSessionId?: string
    readonly repositoryId?: string
    readonly namespace?: string
    readonly streamId?: string
    readonly modelCallSequence?: number
    readonly observedAt?: string
  } = {}
): Lc1RepositoryMappingRequest {
  return {
    messages,
    runtimeSessionId: options.runtimeSessionId ?? 'mapper-session',
    modelCallSequence: options.modelCallSequence ?? sequence,
    repositoryId: options.repositoryId ?? 'repo-a',
    namespace: options.namespace ?? 'workspace',
    expectedRevision: revision,
    authorityOrder: {
      streamId: options.streamId ?? 'authority-stream-a',
      sequence
    },
    observedAt: options.observedAt ?? T0
  }
}

function runtimeObserver(runtimeSessionId = 'mapper-session') {
  return new EnrichedPiShadowObserver({
    base: new PiContextShadowObserver({ runtimeSessionId, now: () => T0 })
  })
}

function repositoryEntry(result: ReturnType<EnrichedPiShadowObserver['observeModelCall']>) {
  return result.universeRevision.entries.find((entry) => entry.source.sourceKey === FILE_KEY)
}

function repositoryEvent(result: ReturnType<EnrichedPiShadowObserver['observeModelCall']>) {
  return result.universeRevision.reconciliationEvents.find((event) => event.sourceKey === FILE_KEY)
}

function boundMapper(
  repository: TempRepository,
  repositoryObserver?: Pick<RepositoryObserver, 'observe'>
) {
  return new Lc1ProductionRepositoryMapper({
    pathResolver: {
      resolve: ({ repositoryId, namespace }) =>
        repositoryId === 'repo-a' && namespace === 'workspace' ? repository.directory : undefined
    },
    ...(repositoryObserver === undefined ? {} : { repositoryObserver })
  })
}

describe('LC1 production read-only mapping candidate', () => {
  it('maps a real Pi read to authoritative Git content and queues it without rewriting messages', async () => {
    const repository = await createRepository(CONTENT_V3)
    const messages = readMessages('mapper-call-1', PATH, 'forged Pi result text')
    const before = structuredClone(messages)
    const revision = await repository.revision()
    const runtime = runtimeObserver()
    const result = await boundMapper(repository).observeAndQueue(
      request(messages, revision, 1),
      runtime
    )

    expect(result.rejected).toEqual([])
    expect(result.quarantined).toEqual([])
    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0]).toMatchObject({
      sourceKey: FILE_KEY,
      canonicalPath: PATH,
      callIds: ['mapper-call-1'],
      namespacedCallIds: ['pi-evidence:v1:mapper-session:mapper-call-1'],
      representationKind: 'FULL',
      observation: {
        status: 'AVAILABLE',
        contentHash: sha256Hex(CONTENT_V3)
      }
    })
    expect(messages).toEqual(before)

    const observed = runtime.observeModelCall(messages)
    expect(repositoryEntry(observed)?.source).toMatchObject({
      sourceKey: FILE_KEY,
      sourceKind: 'REPOSITORY_FILE',
      provenance: 'REPOSITORY_OBSERVER',
      authority: expect.stringMatching(/^repository-scope:v1:/)
    })
    expect(repositoryEntry(observed)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V3))
    expect(observed.recentEvidenceSourceKeys).toContain(FILE_KEY)
  })

  it('rejects a stale real-authority result after a newer version was admitted', async () => {
    const repository = await createRepository(CONTENT_V3)
    const realObserver = new RepositoryObserver()
    const runtime = runtimeObserver('stale-session')
    const revisionV3 = await repository.revision()
    const messagesV3 = readMessages('stale-call-1')
    const capturedV3 = await realObserver.observe({
      repositoryPath: repository.directory,
      expectedRevision: revisionV3,
      paths: [PATH],
      observedAt: T0
    })
    let authorityCallCount = 0
    const sequencedObserver: Pick<RepositoryObserver, 'observe'> = {
      observe: async (input) => {
        authorityCallCount += 1
        if (authorityCallCount === 3) return capturedV3
        return realObserver.observe(input)
      }
    }
    const mapper = boundMapper(repository, sequencedObserver)

    const first = await mapper.observeAndQueue(
      request(messagesV3, revisionV3, 1, { runtimeSessionId: 'stale-session' }),
      runtime
    )
    expect(first.accepted).toHaveLength(1)
    runtime.observeModelCall(messagesV3)

    await writeFile(join(repository.directory, PATH), CONTENT_V4, 'utf8')
    await repository.git(['add', '-A'])
    await repository.git(['commit', '-q', '-m', 'v4'])
    const revisionV4 = await repository.revision()
    const messagesV4 = readMessages('stale-call-2', PATH, CONTENT_V4)
    const second = await mapper.observeAndQueue(
      request(messagesV4, revisionV4, 2, { runtimeSessionId: 'stale-session' }),
      runtime
    )
    expect(second.accepted).toHaveLength(1)
    const current = runtime.observeModelCall(messagesV4)
    const currentVersion = repositoryEntry(current)?.state.admittedVersionId
    expect(repositoryEntry(current)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V4))

    // The same mapper has already accepted sequence 2. The injected observer
    // now returns the real v3 result captured before the v4 commit, simulating
    // an older authority read that completed late.
    const stale = await mapper.observeAndQueue(
      request(messagesV3, revisionV3, 1, { runtimeSessionId: 'stale-session' }),
      runtime
    )
    expect(stale.accepted).toEqual([])
    expect(stale.rejected).toEqual([
      expect.objectContaining({
        sourceKey: FILE_KEY,
        reason: 'STALE_AUTHORITY'
      })
    ])

    const afterStale = runtime.observeModelCall(userMessages('no stale queue'))
    expect(repositoryEntry(afterStale)?.state.admittedVersionId).toBe(currentVersion)
    expect(repositoryEntry(afterStale)?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V4))
  })

  it('carries dirty UNAVAILABLE, committed UPDATE, and explicit ABSENT through the queue', async () => {
    const repository = await createRepository(CONTENT_V3)
    const mapper = boundMapper(repository)
    const runtime = runtimeObserver('status-session')
    const revisionV3 = await repository.revision()
    const messagesV3 = readMessages('status-call-1')

    await mapper.observeAndQueue(
      request(messagesV3, revisionV3, 1, {
        runtimeSessionId: 'status-session'
      }),
      runtime
    )
    const first = runtime.observeModelCall(messagesV3)
    const firstVersionId = repositoryEntry(first)?.state.admittedVersionId
    expect(repositoryEvent(first)).toMatchObject({ action: 'INITIALIZE' })

    await writeFile(join(repository.directory, PATH), CONTENT_V4, 'utf8')
    const dirty = await mapper.observeAndQueue(
      request(readMessages('status-call-2', PATH, CONTENT_V4), revisionV3, 2, {
        runtimeSessionId: 'status-session'
      }),
      runtime
    )
    expect(dirty.accepted[0]?.observation).toMatchObject({
      sourceKey: FILE_KEY,
      status: 'UNAVAILABLE'
    })
    const dirtyResult = runtime.observeModelCall(readMessages('status-call-2', PATH, CONTENT_V4))
    expect(repositoryEntry(dirtyResult)?.state).toMatchObject({
      observationStatus: 'UNAVAILABLE',
      admittedVersionId: firstVersionId,
      lastAvailableVersionId: firstVersionId
    })
    expect(repositoryEvent(dirtyResult)).toMatchObject({
      action: 'RETAIN_LAST_KNOWN',
      previousVersionId: firstVersionId,
      nextVersionId: firstVersionId
    })

    await repository.git(['add', '-A'])
    await repository.git(['commit', '-q', '-m', 'v4'])
    const revisionV4 = await repository.revision()
    const messagesV4 = readMessages('status-call-3', PATH, CONTENT_V4)
    const updated = await mapper.observeAndQueue(
      request(messagesV4, revisionV4, 3, {
        runtimeSessionId: 'status-session'
      }),
      runtime
    )
    expect(updated.accepted[0]?.observation).toMatchObject({
      status: 'AVAILABLE',
      contentHash: sha256Hex(CONTENT_V4)
    })
    const updatedResult = runtime.observeModelCall(messagesV4)
    const updatedVersionId = repositoryEntry(updatedResult)?.state.admittedVersionId
    expect(updatedVersionId).not.toBe(firstVersionId)
    expect(repositoryEvent(updatedResult)).toMatchObject({
      action: 'UPDATE',
      previousVersionId: firstVersionId,
      nextVersionId: updatedVersionId
    })

    await repository.git(['rm', '-q', PATH])
    await repository.git(['commit', '-q', '-m', 'delete'])
    const revisionAbsent = await repository.revision()
    const messagesAbsent = readMessages('status-call-4', PATH, '')
    const absent = await mapper.observeAndQueue(
      request(messagesAbsent, revisionAbsent, 4, {
        runtimeSessionId: 'status-session'
      }),
      runtime
    )
    expect(absent.accepted[0]?.observation).toMatchObject({ status: 'ABSENT' })
    const absentResult = runtime.observeModelCall(messagesAbsent)
    expect(repositoryEntry(absentResult)?.state).toMatchObject({
      observationStatus: 'ABSENT',
      admittedVersionId: null
    })
    expect(repositoryEntry(absentResult)?.admittedVersion).toBeNull()
    expect(repositoryEvent(absentResult)).toMatchObject({
      action: 'REMOVE',
      previousVersionId: updatedVersionId,
      nextVersionId: null
    })
  })

  it('fails closed for malformed Pi reads and unbound repository scope without invoking authority', async () => {
    const repository = await createRepository(CONTENT_V3)
    let authorityCalls = 0
    const countingObserver: Pick<RepositoryObserver, 'observe'> = {
      observe: async (...args) => {
        authorityCalls += 1
        return new RepositoryObserver().observe(...args)
      }
    }
    const mapper = boundMapper(repository, countingObserver)
    const revision = await repository.revision()
    const runtime = runtimeObserver()

    const missingPath = await mapper.observeAndQueue(
      request(
        [
          {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'missing-path',
                name: 'read',
                arguments: {}
              }
            ]
          },
          {
            role: 'toolResult',
            content: [{ type: 'text', text: 'opaque' }],
            toolCallId: 'missing-path',
            toolName: 'read',
            isError: false
          }
        ],
        revision,
        1
      ),
      runtime
    )
    expect(missingPath.accepted).toEqual([])
    expect(missingPath.rejected).toEqual([expect.objectContaining({ reason: 'MISSING_PATH_HINT' })])
    expect(authorityCalls).toBe(0)

    const ignoredNonRead = await mapper.observeAndQueue(
      request(readMessages('grep-call', PATH, CONTENT_V3, 'grep'), revision, 2),
      runtime
    )
    expect(ignoredNonRead).toEqual({
      accepted: [],
      rejected: [],
      quarantined: [],
      authoritativeObservations: []
    })
    expect(authorityCalls).toBe(0)

    const ignoredEdit = await mapper.observeAndQueue(
      request(readMessages('edit-call', PATH, CONTENT_V3, 'edit'), revision, 2),
      runtime
    )
    const ignoredBash = await mapper.observeAndQueue(
      request(readMessages('bash-call', PATH, CONTENT_V3, 'bash'), revision, 2),
      runtime
    )
    expect(ignoredEdit.rejected).toEqual([])
    expect(ignoredEdit.accepted).toEqual([])
    expect(ignoredBash.rejected).toEqual([])
    expect(ignoredBash.accepted).toEqual([])
    expect(authorityCalls).toBe(0)

    // A non-read call is outside the projection, but reusing an id that was
    // previously bound to a read must remain a strict identity failure.
    const readCall = readMessages('read-id-reused-for-edit')[0]!
    const editPair = readMessages(
      'read-id-reused-for-edit',
      PATH,
      CONTENT_V3,
      'edit',
      'edit'
    )
    const remappedReadId = await mapper.observeAndQueue(
      request([readCall, editPair[0]!, editPair[1]!], revision, 2),
      runtime
    )
    expect(remappedReadId.accepted).toEqual([])
    expect(remappedReadId.rejected).toEqual([
      expect.objectContaining({ reason: 'CALL_ID_REMAP', callIds: ['read-id-reused-for-edit'] })
    ])
    expect(authorityCalls).toBe(0)

    const traversal = await mapper.observeAndQueue(
      request(readMessages('traversal-call', '../secret'), revision, 3),
      runtime
    )
    expect(traversal.accepted).toEqual([])
    expect(traversal.rejected).toEqual([expect.objectContaining({ reason: 'MISSING_PATH_HINT' })])
    expect(authorityCalls).toBe(0)

    const invalidRequest = await mapper.observeAndQueue(
      {
        ...request(readMessages('invalid-request'), revision, 5),
        expectedRevision: null
      } as unknown as Lc1RepositoryMappingRequest,
      runtime
    )
    expect(invalidRequest).toEqual({
      accepted: [],
      rejected: [expect.objectContaining({ reason: 'INVALID_REQUEST' })],
      quarantined: [],
      authoritativeObservations: []
    })

    const unbound = new Lc1ProductionRepositoryMapper({
      pathResolver: { resolve: () => undefined },
      repositoryObserver: countingObserver
    })
    const unboundResult = await unbound.observeAndQueue(
      request(readMessages('unbound-call'), revision, 3),
      runtime
    )
    expect(unboundResult.quarantined).toEqual([
      expect.objectContaining({ reason: 'REPOSITORY_SCOPE_UNBOUND' })
    ])
    expect(authorityCalls).toBe(0)

    const throwingResolver = new Lc1ProductionRepositoryMapper({
      pathResolver: {
        resolve: () => {
          throw new Error('resolver failure')
        }
      },
      repositoryObserver: countingObserver
    })
    const resolverFailure = await throwingResolver.observeAndQueue(
      request(readMessages('resolver-failure'), revision, 4),
      runtime
    )
    expect(resolverFailure.quarantined).toEqual([
      expect.objectContaining({ reason: 'REPOSITORY_SCOPE_UNBOUND' })
    ])
    expect(authorityCalls).toBe(0)
  })

  it('binds call ids to one logical source and rejects cross-scope source-key collisions', async () => {
    const repositoryA = await createRepository(CONTENT_V3)
    const repositoryB = await createRepository(CONTENT_V3)
    const revisionA = await repositoryA.revision()
    const revisionB = await repositoryB.revision()
    const runtime = runtimeObserver()
    const mapper = new Lc1ProductionRepositoryMapper({
      pathResolver: {
        resolve: ({ repositoryId, namespace }) => {
          if (namespace !== 'workspace') return undefined
          if (repositoryId === 'repo-a') return repositoryA.directory
          if (repositoryId === 'repo-b') return repositoryB.directory
          return undefined
        }
      }
    })

    const first = await mapper.observeAndQueue(
      request(readMessages('bound-call'), revisionA, 1),
      runtime
    )
    expect(first.accepted).toHaveLength(1)

    await writeFile(join(repositoryA.directory, 'src/other.ts'), CONTENT_V3, 'utf8')
    await repositoryA.git(['add', '-A'])
    await repositoryA.git(['commit', '-q', '-m', 'other file'])
    const revisionWithOther = await repositoryA.revision()
    const remapped = await mapper.observeAndQueue(
      request(readMessages('bound-call', 'src/other.ts'), revisionWithOther, 2),
      runtime
    )
    expect(remapped.accepted).toEqual([])
    expect(remapped.rejected).toEqual([
      expect.objectContaining({ reason: 'CALL_ID_REMAP', callIds: ['bound-call'] })
    ])

    const crossScope = await mapper.observeAndQueue(
      request(readMessages('other-repo-call'), revisionB, 2, { repositoryId: 'repo-b' }),
      runtime
    )
    expect(crossScope.accepted).toEqual([])
    expect(crossScope.quarantined).toEqual([
      expect.objectContaining({ reason: 'CROSS_SCOPE_COLLISION', sourceKey: FILE_KEY })
    ])
  })

  it('rejects a Pi tool-result whose declared tool name does not match its call', async () => {
    const repository = await createRepository(CONTENT_V3)
    const revision = await repository.revision()
    let authorityCalls = 0
    const mapper = boundMapper(repository, {
      observe: async (input) => {
        authorityCalls += 1
        return new RepositoryObserver().observe(input)
      }
    })
    const result = await mapper.observeAndQueue(
      request(readMessages('tool-name-mismatch', PATH, CONTENT_V3, 'read', 'grep'), revision, 1),
      runtimeObserver()
    )

    expect(result.accepted).toEqual([])
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'CALL_TOOL_NAME_MISMATCH' })
    ])
    expect(authorityCalls).toBe(0)
  })

  it('quarantines unverified authority and observer failures without queueing', async () => {
    const repository = await createRepository(CONTENT_V3)
    const revision = await repository.revision()
    let queueCalls = 0
    const sink: Lc1ExternalObservationSink = {
      queueExternalObservations: () => {
        queueCalls += 1
      }
    }
    const realObserver = new RepositoryObserver()
    const unverifiedObserver: Pick<RepositoryObserver, 'observe'> = {
      observe: async (input) =>
        (await realObserver.observe(input)).map((item) => ({
          ...item,
          verifiedRevision: null
        }))
    }
    const unverified = await boundMapper(repository, unverifiedObserver).observeAndQueue(
      request(readMessages('unverified-authority'), revision, 1),
      sink
    )
    expect(unverified.accepted).toEqual([])
    expect(unverified.quarantined).toEqual([
      expect.objectContaining({ reason: 'UNVERIFIED_AUTHORITY' })
    ])
    expect(queueCalls).toBe(0)

    const failedObserver: Pick<RepositoryObserver, 'observe'> = {
      observe: async () => {
        throw new Error('authority unavailable')
      }
    }
    const failed = await boundMapper(repository, failedObserver).observeAndQueue(
      request(readMessages('authority-failure'), revision, 1),
      sink
    )
    expect(failed.accepted).toEqual([])
    expect(failed.quarantined).toEqual([
      expect.objectContaining({ reason: 'AUTHORITY_OBSERVATION_FAILED' })
    ])
    expect(queueCalls).toBe(0)
  })

  it('treats equal authority as idempotent, rejects incomparable streams, and does not commit queue failure', async () => {
    const repository = await createRepository(CONTENT_V3)
    const revision = await repository.revision()
    const mapper = boundMapper(repository)
    const runtime = runtimeObserver()
    const first = await mapper.observeAndQueue(
      request(readMessages('idempotent-1'), revision, 1),
      runtime
    )
    expect(first.accepted).toHaveLength(1)
    runtime.observeModelCall(readMessages('idempotent-1'))

    const duplicate = await mapper.observeAndQueue(
      request(readMessages('idempotent-1'), revision, 1),
      runtime
    )
    expect(duplicate.rejected).toEqual([
      expect.objectContaining({ reason: 'IDEMPOTENT_DUPLICATE' })
    ])

    const conflicting = await mapper.observeAndQueue(
      request(readMessages('conflicting-call'), revision, 1),
      runtime
    )
    expect(conflicting.accepted).toEqual([])
    expect(conflicting.quarantined).toEqual([
      expect.objectContaining({ reason: 'CONFLICTING_AUTHORITY' })
    ])

    const incomparable = await mapper.observeAndQueue(
      request(readMessages('incomparable'), revision, 2, {
        streamId: 'other-stream'
      }),
      runtime
    )
    expect(incomparable.quarantined).toEqual([
      expect.objectContaining({ reason: 'INCOMPARABLE_AUTHORITY' })
    ])

    const failingSink: Lc1ExternalObservationSink = {
      queueExternalObservations: () => {
        throw new Error('synthetic queue failure')
      }
    }
    const mapperAfterQueueFailure = boundMapper(repository)
    const failed = await mapperAfterQueueFailure.observeAndQueue(
      request(readMessages('queue-failure'), revision, 1),
      failingSink
    )
    expect(failed.accepted).toEqual([])
    expect(failed.quarantined).toEqual([expect.objectContaining({ reason: 'QUEUE_REJECTED' })])
    const retry = await mapperAfterQueueFailure.observeAndQueue(
      request(readMessages('queue-failure-retry'), revision, 1),
      runtime
    )
    expect(retry.accepted).toHaveLength(1)
  })

  it('restores mapper state with the runtime so a rolled-back mapping requeues deterministically', async () => {
    const repository = await createRepository(CONTENT_V3)
    const revision = await repository.revision()
    const mapper = boundMapper(repository)
    const runtime = runtimeObserver()
    const messages = readMessages('transactional-call')
    const mappingSnapshot = mapper.snapshotForTransaction()
    const runtimeSnapshot = runtime.snapshotForTransaction()

    const firstMapping = await mapper.observeAndQueue(request(messages, revision, 1), runtime)
    expect(firstMapping.accepted).toHaveLength(1)
    const firstObserved = runtime.observeModelCall(messages)

    runtime.restoreTransaction(runtimeSnapshot)
    mapper.restoreTransaction(mappingSnapshot)

    const replayMapping = await mapper.observeAndQueue(request(messages, revision, 1), runtime)
    expect(replayMapping.accepted).toHaveLength(1)
    const replayObserved = runtime.observeModelCall(messages)
    expect(replayObserved.universeRevision.logicalHash).toBe(
      firstObserved.universeRevision.logicalHash
    )
  })
})
