import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type SessionShutdownEvent
} from '@earendil-works/pi-coding-agent'
import { sha256Hex } from '@canvas-agent/context-runtime'
import {
  readRepositoryRevision,
  runGitCommand,
  type GitRunOptions
} from '@canvas-agent/worker-runtime'
import type { PiMessageView } from '../src'
import {
  createLc1RuntimeAdmissionComposition,
  createLc1RuntimeAdmissionPiExtension,
  createRunKillSwitch,
  Lc1ProductionRepositoryMapper,
  Lc1RuntimeRepositoryAdmissionHost,
  type Lc1RepositoryRevision
} from '../src/experimental'

const PATH = 'src/reopen-a.ts'
const FILE_KEY = `repository/file://${PATH}`
const CONTENT_V3 = 'export const value = "reopen-a:v3"\n'
const T0 = '2026-08-31T00:00:00.000Z'

interface TempRepository {
  readonly directory: string
  readonly revision: () => Promise<Lc1RepositoryRevision>
}

const temporaryDirectories: string[] = []

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
  const directory = await mkdtemp(join(tmpdir(), 'canvas-lc1-agent-session-repo-'))
  temporaryDirectories.push(directory)
  const git = async (args: readonly string[]): Promise<string> => {
    const result = await runGitCommand(args, gitOptions(directory))
    if (result.exitCode !== 0) {
      throw new Error(`git failed: ${args.join(' ')}\n${result.stderr}`)
    }
    return result.stdout.trim()
  }

  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 'lc1-agent-session@canvas.local'])
  await git(['config', 'user.name', 'LC1 Agent Session'])
  await mkdir(join(directory, 'src'), { recursive: true })
  await writeFile(join(directory, PATH), CONTENT_V3, 'utf8')
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'fixture-v3'])

  return {
    directory,
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
}

function readMessages(callId: string): PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: callId, name: 'read', arguments: { path: PATH } }]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: 'fixture result content' }],
      toolCallId: callId,
      toolName: 'read',
      isError: false
    }
  ]
}

function mapperFor(repository: TempRepository): Lc1ProductionRepositoryMapper {
  return new Lc1ProductionRepositoryMapper({
    pathResolver: {
      resolve: ({ repositoryId, namespace }) =>
        repositoryId === 'repo-a' && namespace === 'workspace' ? repository.directory : undefined
    }
  })
}

class ProviderTransportBlocked extends Error {
  constructor() {
    super('credential-free AgentSession transport blocked')
    this.name = 'ProviderTransportBlocked'
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('LC1 runtime admission through a real Pi AgentSession', () => {
  it('loads the hook through DefaultResourceLoader, dispatches through AgentSession, and stops on shutdown', async () => {
    const repository = await createRepository()
    const cwd = await mkdtemp(join(tmpdir(), 'canvas-lc1-agent-session-cwd-'))
    temporaryDirectories.push(cwd)
    const revision = await repository.revision()
    const runtimeSessionId = 'pi-agent-session-integration-session'
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId, now: () => T0 }
    })
    const killSwitch = createRunKillSwitch('pi-agent-session-integration-run', { now: () => T0 })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host,
      killSwitch
    })
    const extensionFactory = createLc1RuntimeAdmissionPiExtension({
      composition,
      mapper: mapperFor(repository),
      runtimeSessionId,
      repositoryId: 'repo-a',
      namespace: 'workspace',
      authorityStreamId: 'pi-agent-session-integration-stream',
      getExpectedRevision: () => revision,
      observedAt: () => T0
    })
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 }
    })
    const originalFetch = globalThis.fetch
    let blockedTransportAttempts = 0
    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined

    globalThis.fetch = async () => {
      blockedTransportAttempts += 1
      throw new ProviderTransportBlocked()
    }

    try {
      const modelRuntime = await ModelRuntime.create({
        allowModelNetwork: false,
        refreshOnCreate: false,
        modelsPath: null,
        authPath: join(cwd, 'auth.json')
      })
      await modelRuntime.setRuntimeApiKey('deepseek', 'pi-agent-session-fake-key')
      const model = modelRuntime.getModel('deepseek', 'deepseek-v4-flash')
      if (model === undefined) throw new Error('static DeepSeek model metadata is unavailable')

      const loader = new DefaultResourceLoader({
        cwd,
        agentDir: join(cwd, '.pi-agent'),
        settingsManager,
        extensionFactories: [
          {
            name: 'canvas-cr004-lc1-agent-session',
            factory: extensionFactory
          }
        ]
      })
      await loader.reload()
      const created = await createAgentSession({
        cwd,
        model,
        modelRuntime,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager,
        noTools: 'all'
      })
      session = created.session

      expect(created.extensionsResult.errors).toHaveLength(0)
      expect(created.extensionsResult.extensions.map((extension) => extension.path)).toContain(
        '<inline:canvas-cr004-lc1-agent-session>'
      )
      expect(session.extensionRunner.hasHandlers('context')).toBe(true)
      expect(session.extensionRunner.hasHandlers('session_shutdown')).toBe(true)

      const messages = readMessages('pi-agent-session-read')
      const dispatched = await session.extensionRunner.emitContext(
        messages as unknown as Parameters<typeof session.extensionRunner.emitContext>[0]
      )
      expect(dispatched).toEqual(messages)
      expect(dispatched).not.toBe(messages)
      expect(host.callCount).toBe(1)
      expect(killSwitch.isTripped).toBe(false)
      expect(
        host.universeRevision?.entries.find((entry) => entry.source.sourceKey === FILE_KEY)
          ?.admittedVersion?.contentHash
      ).toBe(sha256Hex(CONTENT_V3))

      // This uses AgentSession's actual model transformContext callback. The
      // transport is deliberately intercepted before any provider request.
      await session.prompt('credential-free LC1 AgentSession integration')
      expect(host.callCount).toBe(2)
      expect(blockedTransportAttempts).toBeGreaterThan(0)
      expect(killSwitch.isTripped).toBe(false)

      await session.extensionRunner.emit({
        type: 'session_shutdown',
        reason: 'reload' satisfies SessionShutdownEvent['reason']
      })
      expect(killSwitch.tripRecord).toEqual({
        reason: 'LC1_RUNTIME_ADMISSION_PI_SESSION_SHUTDOWN:reload',
        trippedAt: T0
      })

      const lateMessages = readMessages('pi-agent-session-after-shutdown')
      const lateDispatched = await session.extensionRunner.emitContext(
        lateMessages as unknown as Parameters<typeof session.extensionRunner.emitContext>[0]
      )
      expect(lateDispatched).toEqual(lateMessages)
      expect(host.callCount).toBe(2)
    } finally {
      session?.dispose()
      globalThis.fetch = originalFetch
    }
  })
})
