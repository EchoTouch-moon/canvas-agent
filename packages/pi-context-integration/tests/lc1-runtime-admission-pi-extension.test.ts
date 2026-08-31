import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '@canvas-agent/context-runtime'
import {
  readRepositoryRevision,
  runGitCommand,
  type GitRunOptions
} from '@canvas-agent/worker-runtime'
import type {
  ContextEvent,
  ExtensionAPI,
  ExtensionFactory,
  Extension,
  SessionShutdownEvent
} from '@earendil-works/pi-coding-agent'
import {
  createExtensionRuntime,
  ExtensionRunner
} from '@earendil-works/pi-coding-agent'
import type { PiMessageView } from '../src'
import {
  createLc1RuntimeAdmissionComposition,
  createLc1RuntimeAdmissionExtension,
  createLc1RuntimeAdmissionPiExtension,
  createRunKillSwitch,
  Lc1ProductionRepositoryMapper,
  type Lc1RuntimeAdmissionComposition,
  Lc1RuntimeRepositoryAdmissionHost,
  type Lc1RuntimeAdmissionPiExtensionOptions,
  type Lc1RepositoryRevision
} from '../src/experimental'

const PATH = 'src/reopen-a.ts'
const FILE_KEY = `repository/file://${PATH}`
const CONTENT_V3 = 'export const value = "reopen-a:v3"\n'
const CONTENT_V4 = 'export const value = "reopen-a:v4"\n'
const T0 = '2026-08-31T00:00:00.000Z'

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

async function createRepository(): Promise<TempRepository> {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-lc1-pi-composition-'))
  const git = async (args: readonly string[]): Promise<string> => {
    const result = await runGitCommand(args, gitOptions(directory))
    if (result.exitCode !== 0) {
      throw new Error(`git failed: ${args.join(' ')}\n${result.stderr}`)
    }
    return result.stdout.trim()
  }
  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 'lc1-pi-composition@canvas.local'])
  await git(['config', 'user.name', 'LC1 Pi Composition'])
  await mkdir(join(directory, 'src'), { recursive: true })
  await writeFile(join(directory, PATH), CONTENT_V3, 'utf8')
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'fixture-v3'])
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

async function commitRepository(
  repository: TempRepository,
  content: string,
  message: string
): Promise<Lc1RepositoryRevision> {
  await writeFile(join(repository.directory, PATH), content, 'utf8')
  await repository.git(['add', '-A'])
  await repository.git(['commit', '-q', '-m', message])
  return repository.revision()
}

afterEach(async () => {
  await Promise.all(
    repositories
      .splice(0)
      .map((repository) => rm(repository.directory, { recursive: true, force: true }))
  )
})

function readMessages(callId: string): PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: callId, name: 'read', arguments: { path: PATH } }]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: 'forged result content' }],
      toolCallId: callId,
      toolName: 'read',
      isError: false
    }
  ]
}

function userMessages(text: string): PiMessageView[] {
  return [{ role: 'user', content: [{ type: 'text', text }] }]
}

function register(factory: ExtensionFactory): (
  messages: readonly PiMessageView[]
) => Promise<{ readonly messages: readonly PiMessageView[] }> {
  let handler:
    | ((event: ContextEvent) => Promise<{ messages: ContextEvent['messages'] } | undefined>)
    | undefined
  const pi = {
    on: (
      event: 'context',
      registered: (event: ContextEvent) =>
        Promise<{ messages: ContextEvent['messages'] } | undefined>
    ) => {
      if (event === 'context') handler = registered
    }
  } as unknown as ExtensionAPI
  factory(pi)
  if (handler === undefined) throw new Error('factory registered no context handler')
  return async (messages) => {
    const result = await handler!({
      type: 'context',
      messages: messages as ContextEvent['messages']
    })
    if (result === undefined) throw new Error('context handler returned no result')
    return { messages: result.messages as readonly PiMessageView[] }
  }
}

function registerWithSessionShutdown(factory: ExtensionFactory): {
  readonly dispatch: (
    messages: readonly PiMessageView[]
  ) => Promise<{ readonly messages: readonly PiMessageView[] }>
  readonly shutdown: (reason: SessionShutdownEvent['reason']) => Promise<void>
} {
  let contextHandler:
    | ((event: ContextEvent) => Promise<{ messages: ContextEvent['messages'] } | undefined>)
    | undefined
  let shutdownHandler: ((event: SessionShutdownEvent) => Promise<void> | void) | undefined
  const pi = {
    on: (event: 'context' | 'session_shutdown', registered: unknown) => {
      if (event === 'context') {
        contextHandler = registered as typeof contextHandler
      } else {
        shutdownHandler = registered as typeof shutdownHandler
      }
    }
  } as unknown as ExtensionAPI
  factory(pi)
  if (contextHandler === undefined || shutdownHandler === undefined) {
    throw new Error('factory did not register context and shutdown handlers')
  }
  return {
    dispatch: async (messages) => {
      const result = await contextHandler!({
        type: 'context',
        messages: messages as ContextEvent['messages']
      })
      if (result === undefined) throw new Error('context handler returned no result')
      return { messages: result.messages as readonly PiMessageView[] }
    },
    shutdown: async (reason) => {
      await shutdownHandler!({ type: 'session_shutdown', reason })
    }
  }
}

async function loadRealPiRunner(factory: ExtensionFactory): Promise<ExtensionRunner> {
  const runtime = createExtensionRuntime()
  const handlers = new Map<string, unknown[]>()
  const pi = {
    on: (event: string, handler: unknown) => {
      const registered = handlers.get(event) ?? []
      registered.push(handler)
      handlers.set(event, registered)
    }
  } as unknown as ExtensionAPI
  await factory(pi)
  const extension = {
    path: '<lc1-pi-hook-test>',
    resolvedPath: '<lc1-pi-hook-test>',
    sourceInfo: {} as Extension['sourceInfo'],
    handlers,
    tools: new Map(),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map()
  } as unknown as Extension
  return new ExtensionRunner(
    [extension],
    runtime,
    process.cwd(),
    undefined as never,
    undefined as never
  )
}

function mapperFor(
  repository: TempRepository,
  repositoryId = 'repo-a',
  pathResolver: 'BOUND' | 'UNBOUND' = 'BOUND'
): Lc1ProductionRepositoryMapper {
  return new Lc1ProductionRepositoryMapper({
    pathResolver: {
      resolve: ({ repositoryId: requestRepositoryId, namespace }) =>
        pathResolver === 'BOUND' &&
        requestRepositoryId === repositoryId &&
        namespace === 'workspace'
          ? repository.directory
          : undefined
    }
  })
}

function mappingOptions(
  runtimeSessionId: string,
  repositoryId = 'repo-a'
): Pick<Lc1RuntimeAdmissionPiExtensionOptions, 'runtimeSessionId' | 'repositoryId'> {
  return { runtimeSessionId, repositoryId }
}

describe('LC1 runtime-owned Pi composition extension', () => {
  it('rejects construction with a disabled composition', () => {
    const composition = createLc1RuntimeAdmissionComposition()
    expect(() =>
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: {} as Lc1ProductionRepositoryMapper,
        runtimeSessionId: 'pi-disabled-session',
        repositoryId: 'repo-a',
        namespace: 'workspace',
        authorityStreamId: 'pi-disabled-stream',
        getExpectedRevision: async () => ({
          baseCommit: 'a'.repeat(40),
          treeHash: 'b'.repeat(40),
          workingTreePatchHash: null
        })
      })
    ).toThrow('lc1_runtime_admission_pi_extension_requires_runtime_owned')
  })

  it('rejects malformed adapter configuration before registering a Pi hook', () => {
    expect(() =>
      createLc1RuntimeAdmissionPiExtension(
        undefined as unknown as Lc1RuntimeAdmissionPiExtensionOptions
      )
    ).toThrow('LC1_RUNTIME_ADMISSION_PI_EXTENSION_CONFIGURATION_INVALID')

    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host: new Lc1RuntimeRepositoryAdmissionHost({
        observer: { runtimeSessionId: 'pi-invalid-mapper-session', now: () => T0 }
      }),
      killSwitch: createRunKillSwitch('pi-invalid-mapper-run', { now: () => T0 })
    })
    expect(() =>
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: {} as Lc1ProductionRepositoryMapper,
        runtimeSessionId: 'pi-invalid-mapper-session',
        repositoryId: 'repo-a',
        namespace: 'workspace',
        authorityStreamId: 'pi-invalid-mapper-stream',
        getExpectedRevision: async () => ({
          baseCommit: 'a'.repeat(40),
          treeHash: 'b'.repeat(40),
          workingTreePatchHash: null
        })
      })
    ).toThrow('LC1_RUNTIME_ADMISSION_PI_EXTENSION_CONFIGURATION_INVALID')
  })

  it('rejects a structurally matching composition that is not first-party', () => {
    const killSwitch = createRunKillSwitch('pi-forged-composition-run', { now: () => T0 })
    const forgedComposition = {
      mode: 'RUNTIME_OWNED' as const,
      enabled: true,
      repositoryAdmissionSink: null,
      killSwitch,
      mapRepositoryObservations: async () => ({
        accepted: [],
        rejected: [],
        quarantined: [],
        authoritativeObservations: []
      }),
      handleContext: (messages: readonly PiMessageView[]) => ({ messages })
    } as unknown as Lc1RuntimeAdmissionComposition

    expect(() =>
      createLc1RuntimeAdmissionPiExtension({
        composition: forgedComposition,
        mapper: {} as Lc1ProductionRepositoryMapper,
        runtimeSessionId: 'pi-forged-composition-session',
        repositoryId: 'repo-a',
        namespace: 'workspace',
        authorityStreamId: 'pi-forged-composition-stream',
        getExpectedRevision: () => ({
          baseCommit: 'a'.repeat(40),
          treeHash: 'b'.repeat(40),
          workingTreePatchHash: null
        })
      })
    ).toThrow('lc1_runtime_admission_pi_extension_requires_first_party_runtime_owned')
    expect(() => createLc1RuntimeAdmissionExtension(forgedComposition)).toThrow(
      'lc1_runtime_admission_extension_requires_first_party_runtime_owned'
    )
  })

  it('freezes first-party composition state after construction', () => {
    const sessionId = 'pi-frozen-composition-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch: createRunKillSwitch('pi-frozen-composition-run', { now: () => T0 })
    })

    expect(Object.isFrozen(composition)).toBe(true)
  })

  it('keeps the legacy context-only factory lifecycle-guarded', async () => {
    const sessionId = 'pi-legacy-factory-lifecycle-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-legacy-factory-lifecycle-run', { now: () => T0 })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const { dispatch, shutdown } = registerWithSessionShutdown(
      createLc1RuntimeAdmissionExtension(composition)
    )
    const firstMessages = userMessages('legacy factory before shutdown')

    expect((await dispatch(firstMessages)).messages).toBe(firstMessages)
    expect(host.callCount).toBe(1)

    await shutdown('reload')
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_PI_SESSION_SHUTDOWN:reload',
      trippedAt: T0
    })

    const lateMessages = userMessages('legacy factory after shutdown')
    expect((await dispatch(lateMessages)).messages).toBe(lateMessages)
    expect(host.callCount).toBe(1)
  })

  it('maps authority before the Pi boundary and returns the exact original messages', async () => {
    const repository = await createRepository()
    const revision = await repository.revision()
    const sessionId = 'pi-composition-success-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-success-run', { now: () => T0 })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const messages = readMessages('pi-success')
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository),
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-success-stream',
        getExpectedRevision: () => revision,
        observedAt: () => T0
      })
    )

    const result = await dispatch(messages)

    expect(result.messages).toBe(messages)
    expect(killSwitch.isTripped).toBe(false)
    expect(host.callCount).toBe(1)
    const entry = host.universeRevision?.entries.find(
      (candidate) => candidate.source.sourceKey === FILE_KEY
    )
    expect(entry?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V3))
  })

  it('runs through the real Pi ExtensionRunner context dispatcher without rewriting input', async () => {
    const repository = await createRepository()
    const revision = await repository.revision()
    const sessionId = 'pi-composition-real-runner-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-real-runner-run', { now: () => T0 })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const runner = await loadRealPiRunner(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository),
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-real-runner-stream',
        getExpectedRevision: () => revision,
        observedAt: () => T0
      })
    )
    const messages = readMessages('pi-real-runner')

    const result = await runner.emitContext(
      messages as unknown as Parameters<ExtensionRunner['emitContext']>[0]
    )

    expect(result).toEqual(messages)
    expect(result).not.toBe(messages)
    expect(killSwitch.isTripped).toBe(false)
    expect(host.callCount).toBe(1)
    const entry = host.universeRevision?.entries.find(
      (candidate) => candidate.source.sourceKey === FILE_KEY
    )
    expect(entry?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V3))

    await runner.emit({ type: 'session_shutdown', reason: 'fork' })
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_PI_SESSION_SHUTDOWN:fork',
      trippedAt: T0
    })
    const lateMessages = readMessages('pi-real-runner-after-shutdown')
    const lateResult = await runner.emitContext(
      lateMessages as unknown as Parameters<ExtensionRunner['emitContext']>[0]
    )
    expect(lateResult).toEqual(lateMessages)
    expect(host.callCount).toBe(1)
  })

  it('binds a fresh revision and monotonic authority order for each context event', async () => {
    const repository = await createRepository()
    let revision = await repository.revision()
    const sessionId = 'pi-composition-lifecycle-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-lifecycle-run', { now: () => T0 })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository),
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-lifecycle-stream',
        getExpectedRevision: () => revision,
        observedAt: () => T0
      })
    )

    const firstMessages = readMessages('pi-lifecycle-v3')
    expect((await dispatch(firstMessages)).messages).toBe(firstMessages)
    revision = await commitRepository(repository, CONTENT_V4, 'fixture-v4')
    const secondMessages = readMessages('pi-lifecycle-v4')
    expect((await dispatch(secondMessages)).messages).toBe(secondMessages)

    expect(host.callCount).toBe(2)
    expect(killSwitch.isTripped).toBe(false)
    const entry = host.universeRevision?.entries.find(
      (candidate) => candidate.source.sourceKey === FILE_KEY
    )
    expect(entry?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V4))
  })

  it('fails closed when concurrent Pi events complete out of order', async () => {
    const repository = await createRepository()
    const revision = await repository.revision()
    const sessionId = 'pi-composition-out-of-order-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-out-of-order-run', {
      now: () => T0
    })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    let revisionCalls = 0
    let releaseFirstRevision!: (value: Lc1RepositoryRevision) => void
    const firstRevision = new Promise<Lc1RepositoryRevision>((resolve) => {
      releaseFirstRevision = resolve
    })
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository),
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-out-of-order-stream',
        getExpectedRevision: () => {
          revisionCalls += 1
          return revisionCalls === 1 ? firstRevision : revision
        },
        observedAt: () => T0
      })
    )

    const firstMessages = readMessages('pi-out-of-order-first')
    const firstResultPromise = dispatch(firstMessages)
    await Promise.resolve()
    expect(revisionCalls).toBe(1)

    const secondMessages = readMessages('pi-out-of-order-second')
    expect((await dispatch(secondMessages)).messages).toBe(secondMessages)
    expect(host.callCount).toBe(1)
    expect(killSwitch.isTripped).toBe(false)

    releaseFirstRevision(revision)
    expect((await firstResultPromise).messages).toBe(firstMessages)
    expect(host.callCount).toBe(1)
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_GUARD_REJECTED',
      trippedAt: T0
    })
  })

  it('trips before mapping or observation when the revision supplier fails', async () => {
    const repository = await createRepository()
    const sessionId = 'pi-composition-revision-failure-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-revision-failure-run', {
      now: () => T0
    })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    let mapperCalls = 0
    const mapper = {
      observeAndQueue: async () => {
        mapperCalls += 1
        throw new Error('mapper must not be called')
      }
    } as unknown as Lc1ProductionRepositoryMapper
    const messages = readMessages('pi-revision-failure')
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper,
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-revision-failure-stream',
        getExpectedRevision: async () => {
          throw new Error('repository revision unavailable')
        },
        observedAt: () => T0
      })
    )

    expect((await dispatch(messages)).messages).toBe(messages)
    expect(mapperCalls).toBe(0)
    expect(host.callCount).toBe(0)
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_REVISION_READ_FAILURE',
      trippedAt: T0
    })
    const afterFailureMessages = userMessages('after revision failure')
    expect((await dispatch(afterFailureMessages)).messages).toBe(afterFailureMessages)
    expect(host.callCount).toBe(0)
  })

  it('trips before mapping or observation when the timestamp supplier fails', async () => {
    const repository = await createRepository()
    const revision = await repository.revision()
    const sessionId = 'pi-composition-timestamp-failure-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-timestamp-failure-run', {
      now: () => T0
    })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    let revisionCalls = 0
    const messages = readMessages('pi-timestamp-failure')
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository),
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-timestamp-failure-stream',
        getExpectedRevision: () => {
          revisionCalls += 1
          return revision
        },
        observedAt: () => {
          throw new Error('clock unavailable')
        }
      })
    )

    expect((await dispatch(messages)).messages).toBe(messages)
    expect(revisionCalls).toBe(1)
    expect(host.callCount).toBe(0)
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_TIMESTAMP_FAILURE',
      trippedAt: T0
    })

    const afterFailureMessages = userMessages('after timestamp failure')
    expect((await dispatch(afterFailureMessages)).messages).toBe(afterFailureMessages)
    expect(revisionCalls).toBe(1)
    expect(host.callCount).toBe(0)
  })

  it('trips before mapping or observation when the timestamp supplier returns an empty value', async () => {
    const repository = await createRepository()
    const revision = await repository.revision()
    const sessionId = 'pi-composition-empty-timestamp-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-empty-timestamp-run', {
      now: () => T0
    })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const messages = readMessages('pi-empty-timestamp')
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository),
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-empty-timestamp-stream',
        getExpectedRevision: () => revision,
        observedAt: () => '   '
      })
    )

    expect((await dispatch(messages)).messages).toBe(messages)
    expect(host.callCount).toBe(0)
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_TIMESTAMP_FAILURE',
      trippedAt: T0
    })
  })

  it('bypasses all suppliers and boundaries after a pre-existing kill-switch trip', async () => {
    const repository = await createRepository()
    const sessionId = 'pi-composition-pretrip-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-pretrip-run', { now: () => T0 })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    killSwitch.trip('operator stop')
    let revisionCalls = 0
    let timestampCalls = 0
    const messages = readMessages('pi-pretrip')
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository),
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-pretrip-stream',
        getExpectedRevision: async () => {
          revisionCalls += 1
          throw new Error('must not read revision')
        },
        observedAt: () => {
          timestampCalls += 1
          throw new Error('must not read time')
        }
      })
    )

    expect((await dispatch(messages)).messages).toBe(messages)
    expect(revisionCalls).toBe(0)
    expect(timestampCalls).toBe(0)
    expect(host.callCount).toBe(0)
    expect(killSwitch.tripRecord).toEqual({ reason: 'operator stop', trippedAt: T0 })
  })

  it('stops the old runtime when Pi shuts down the session for replacement', async () => {
    const repository = await createRepository()
    const revision = await repository.revision()
    const sessionId = 'pi-composition-session-shutdown-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-session-shutdown-run', {
      now: () => T0
    })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    let revisionCalls = 0
    const { dispatch, shutdown } = registerWithSessionShutdown(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository),
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-session-shutdown-stream',
        getExpectedRevision: () => {
          revisionCalls += 1
          return revision
        },
        observedAt: () => T0
      })
    )

    const firstMessages = readMessages('pi-session-shutdown-before')
    expect((await dispatch(firstMessages)).messages).toBe(firstMessages)
    expect(revisionCalls).toBe(1)
    expect(host.callCount).toBe(1)

    await shutdown('fork')
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_PI_SESSION_SHUTDOWN:fork',
      trippedAt: T0
    })

    const lateMessages = readMessages('pi-session-shutdown-after')
    expect((await dispatch(lateMessages)).messages).toBe(lateMessages)
    expect(revisionCalls).toBe(1)
    expect(host.callCount).toBe(1)
  })

  it('trips and bypasses observation when mapping cannot bind repository scope', async () => {
    const repository = await createRepository()
    const revision = await repository.revision()
    const sessionId = 'pi-composition-unbound-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-unbound-run', { now: () => T0 })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const messages = readMessages('pi-unbound')
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository, 'repo-a', 'UNBOUND'),
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-unbound-stream',
        getExpectedRevision: () => revision,
        observedAt: () => T0
      })
    )

    expect((await dispatch(messages)).messages).toBe(messages)
    expect(host.callCount).toBe(0)
    expect(host.universeRevision).toBeNull()
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_MAPPING_GUARD_REJECTED',
      trippedAt: T0
    })
  })

  it('fails closed when the extension runtime session does not match the host', async () => {
    const repository = await createRepository()
    const revision = await repository.revision()
    const hostSessionId = 'pi-composition-host-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: hostSessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-session-mismatch-run', {
      now: () => T0
    })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const messages = readMessages('pi-session-mismatch')
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository),
        ...mappingOptions('pi-composition-wrong-session'),
        namespace: 'workspace',
        authorityStreamId: 'pi-session-mismatch-stream',
        getExpectedRevision: () => revision,
        observedAt: () => T0
      })
    )

    expect((await dispatch(messages)).messages).toBe(messages)
    expect(host.callCount).toBe(0)
    expect(host.universeRevision).toBeNull()
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_GUARD_REJECTED',
      trippedAt: T0
    })
  })

  it('does not observe when a composition reports a mapping rejection', async () => {
    const sessionId = 'pi-composition-map-rejection-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-map-rejection-run', { now: () => T0 })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const mapper = {
      observeAndQueue: async () => ({
        accepted: [],
        rejected: [{ callIds: ['pi-map-rejection'], reason: 'INVALID_REQUEST' as const }],
        quarantined: [],
        authoritativeObservations: []
      })
    } as unknown as Lc1ProductionRepositoryMapper
    const messages = readMessages('pi-map-rejection')
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper,
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-map-rejection-stream',
        getExpectedRevision: async () => ({
          baseCommit: 'a'.repeat(40),
          treeHash: 'b'.repeat(40),
          workingTreePatchHash: null
        }),
        observedAt: () => T0
      })
    )

    expect((await dispatch(messages)).messages).toBe(messages)
    expect(host.callCount).toBe(0)
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_MAPPING_GUARD_REJECTED',
      trippedAt: T0
    })
  })

  it('fails closed when the composition boundary itself throws', async () => {
    const sessionId = 'pi-composition-boundary-failure-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-boundary-failure-run', { now: () => T0 })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const mapper = {
      observeAndQueue: async () => {
        throw new Error('mapper failure')
      }
    } as unknown as Lc1ProductionRepositoryMapper
    const messages = readMessages('pi-composition-boundary-failure')
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper,
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-composition-boundary-failure-stream',
        getExpectedRevision: async () => ({
          baseCommit: 'a'.repeat(40),
          treeHash: 'b'.repeat(40),
          workingTreePatchHash: null
        }),
        observedAt: () => T0
      })
    )

    expect((await dispatch(messages)).messages).toBe(messages)
    expect(host.callCount).toBe(0)
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_MAPPING_FAILURE',
      trippedAt: T0
    })
  })

  it('uses the validated dependency snapshot after caller configuration mutates', async () => {
    const repository = await createRepository()
    const revision = await repository.revision()
    const sessionId = 'pi-composition-config-snapshot-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-composition-config-snapshot-run', {
      now: () => T0
    })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const options = {
      composition,
      mapper: mapperFor(repository),
      ...mappingOptions(sessionId),
      namespace: 'workspace',
      authorityStreamId: 'pi-config-snapshot-stream',
      getExpectedRevision: () => revision,
      observedAt: () => T0
    }
    const factory = createLc1RuntimeAdmissionPiExtension(options)
    const forgedComposition = {
      mode: 'RUNTIME_OWNED' as const,
      enabled: true,
      repositoryAdmissionSink: null,
      killSwitch: createRunKillSwitch('pi-forged-replacement-run', { now: () => T0 }),
      mapRepositoryObservations: async () => ({
        accepted: [],
        rejected: [],
        quarantined: [],
        authoritativeObservations: []
      }),
      handleContext: () => ({ messages: userMessages('forged replacement') })
    } as unknown as Lc1RuntimeAdmissionComposition
    const replacementMapper = {
      observeAndQueue: async () => {
        throw new Error('replacement mapper must not run')
      }
    } as unknown as Lc1ProductionRepositoryMapper
    const mutableOptions = options as unknown as {
      -readonly [K in keyof Lc1RuntimeAdmissionPiExtensionOptions]:
        Lc1RuntimeAdmissionPiExtensionOptions[K]
    }
    mutableOptions.composition = forgedComposition
    mutableOptions.mapper = replacementMapper
    mutableOptions.runtimeSessionId = 'pi-config-snapshot-wrong-session'
    mutableOptions.repositoryId = 'repo-wrong'
    mutableOptions.namespace = 'wrong-namespace'
    mutableOptions.authorityStreamId = 'wrong-stream'
    mutableOptions.getExpectedRevision = () => {
      throw new Error('replacement revision supplier must not run')
    }
    mutableOptions.observedAt = () => {
      throw new Error('replacement timestamp supplier must not run')
    }

    const messages = readMessages('pi-config-snapshot')
    const dispatch = register(factory)

    expect((await dispatch(messages)).messages).toBe(messages)
    expect(killSwitch.isTripped).toBe(false)
    expect(host.callCount).toBe(1)
    const entry = host.universeRevision?.entries.find(
      (candidate) => candidate.source.sourceKey === FILE_KEY
    )
    expect(entry?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V3))
  })

  it('rolls back an admitted pending observation when the observer boundary fails', async () => {
    const repository = await createRepository()
    const revision = await repository.revision()
    const sessionId = 'pi-composition-observer-failure-session'
    let failClock = false
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: {
        runtimeSessionId: sessionId,
        now: () => {
          if (failClock) throw new Error('observer clock failure')
          return T0
        }
      }
    })
    const killSwitch = createRunKillSwitch('pi-composition-observer-failure-run', {
      now: () => T0
    })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const messages = readMessages('pi-observer-failure')
    const dispatch = register(
      createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository),
        ...mappingOptions(sessionId),
        namespace: 'workspace',
        authorityStreamId: 'pi-observer-failure-stream',
        getExpectedRevision: () => revision,
        observedAt: () => T0
      })
    )

    failClock = true
    expect((await dispatch(messages)).messages).toBe(messages)
    expect(host.callCount).toBe(0)
    expect(host.universeRevision).toBeNull()
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_OBSERVER_FAILURE',
      trippedAt: T0
    })
  })
})
