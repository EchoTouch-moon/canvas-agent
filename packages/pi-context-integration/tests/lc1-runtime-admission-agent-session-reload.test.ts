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
  type ExtensionFactory
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
  type Lc1RepositoryRevision,
  type Lc1RuntimeAdmissionComposition
} from '../src/experimental'

const PATH = 'src/reopen-a.ts'
const FILE_KEY = `repository/file://${PATH}`
const CONTENT_V3 = 'export const value = "reopen-a:v3"\n'
const T0 = '2026-08-31T00:00:00.000Z'

interface TempRepository {
  readonly directory: string
  readonly revision: () => Promise<Lc1RepositoryRevision>
}

interface RunState {
  readonly host: Lc1RuntimeRepositoryAdmissionHost
  readonly killSwitch: ReturnType<typeof createRunKillSwitch>
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
  const directory = await mkdtemp(join(tmpdir(), 'canvas-lc1-agent-session-reload-repo-'))
  temporaryDirectories.push(directory)
  const git = async (args: readonly string[]): Promise<string> => {
    const result = await runGitCommand(args, gitOptions(directory))
    if (result.exitCode !== 0) {
      throw new Error(`git failed: ${args.join(' ')}\n${result.stderr}`)
    }
    return result.stdout.trim()
  }

  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 'lc1-agent-session-reload@canvas.local'])
  await git(['config', 'user.name', 'LC1 Agent Session Reload'])
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('LC1 runtime admission across a real AgentSession reload', () => {
  it('stops the replaced run and creates fresh composition state for the new run', async () => {
    const repository = await createRepository()
    const cwd = await mkdtemp(join(tmpdir(), 'canvas-lc1-agent-session-reload-cwd-'))
    temporaryDirectories.push(cwd)
    const revision = await repository.revision()
    const runs: RunState[] = []
    const extensionFactory: ExtensionFactory = async (pi) => {
      const runNumber = runs.length + 1
      const runtimeSessionId = `pi-agent-session-reload-session-${runNumber}`
      const host = new Lc1RuntimeRepositoryAdmissionHost({
        observer: { runtimeSessionId, now: () => T0 }
      })
      const killSwitch = createRunKillSwitch(`pi-agent-session-reload-run-${runNumber}`, {
        now: () => T0
      })
      const composition: Lc1RuntimeAdmissionComposition =
        createLc1RuntimeAdmissionComposition({
          mode: 'RUNTIME_OWNED',
          host,
          killSwitch
        })
      runs.push({ host, killSwitch })
      const registered = createLc1RuntimeAdmissionPiExtension({
        composition,
        mapper: mapperFor(repository),
        runtimeSessionId,
        repositoryId: 'repo-a',
        namespace: 'workspace',
        authorityStreamId: `pi-agent-session-reload-stream-${runNumber}`,
        getExpectedRevision: () => revision,
        observedAt: () => T0
      })
      await registered(pi)
    }
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 }
    })

    const modelRuntime = await ModelRuntime.create({
      allowModelNetwork: false,
      refreshOnCreate: false,
      modelsPath: null,
      authPath: join(cwd, 'auth.json')
    })
    await modelRuntime.setRuntimeApiKey('deepseek', 'pi-agent-session-reload-fake-key')
    const model = modelRuntime.getModel('deepseek', 'deepseek-v4-flash')
    if (model === undefined) throw new Error('static DeepSeek model metadata is unavailable')

    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: join(cwd, '.pi-agent'),
      settingsManager,
      extensionFactories: [{ name: 'canvas-cr004-lc1-agent-session-reload', factory: extensionFactory }]
    })
    await loader.reload()

    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined
    try {
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
      expect(runs).toHaveLength(1)
      const firstRun = runs[0]
      if (firstRun === undefined) throw new Error('initial LC1 run was not created')
      expect(session.extensionRunner.hasHandlers('context')).toBe(true)
      expect(session.extensionRunner.hasHandlers('session_shutdown')).toBe(true)

      const firstMessages = readMessages('pi-agent-session-reload-first')
      const firstResult = await session.extensionRunner.emitContext(
        firstMessages as unknown as Parameters<typeof session.extensionRunner.emitContext>[0]
      )
      expect(firstResult).toEqual(firstMessages)
      expect(firstRun.host.callCount).toBe(1)
      expect(firstRun.killSwitch.isTripped).toBe(false)
      expect(
        firstRun.host.universeRevision?.entries.find((entry) => entry.source.sourceKey === FILE_KEY)
          ?.admittedVersion?.contentHash
      ).toBe(sha256Hex(CONTENT_V3))

      const oldRunner = session.extensionRunner
      await session.reload()

      expect(runs).toHaveLength(2)
      const secondRun = runs[1]
      if (secondRun === undefined) throw new Error('replacement LC1 run was not created')
      expect(session.extensionRunner).not.toBe(oldRunner)
      expect(firstRun.killSwitch.tripRecord).toEqual({
        reason: 'LC1_RUNTIME_ADMISSION_PI_SESSION_SHUTDOWN:reload',
        trippedAt: T0
      })
      expect(firstRun.host.callCount).toBe(1)
      expect(secondRun.killSwitch.isTripped).toBe(false)
      expect(session.extensionRunner.hasHandlers('context')).toBe(true)

      const secondMessages = readMessages('pi-agent-session-reload-second')
      const secondResult = await session.extensionRunner.emitContext(
        secondMessages as unknown as Parameters<typeof session.extensionRunner.emitContext>[0]
      )
      expect(secondResult).toEqual(secondMessages)
      expect(secondRun.host.callCount).toBe(1)
      expect(secondRun.killSwitch.isTripped).toBe(false)
      expect(
        secondRun.host.universeRevision?.entries.find((entry) => entry.source.sourceKey === FILE_KEY)
          ?.admittedVersion?.contentHash
      ).toBe(sha256Hex(CONTENT_V3))

      const lateMessages = readMessages('pi-agent-session-reload-old-run')
      const lateResult = await oldRunner.emitContext(
        lateMessages as unknown as Parameters<typeof oldRunner.emitContext>[0]
      )
      expect(lateResult).toEqual(lateMessages)
      expect(firstRun.host.callCount).toBe(1)
      expect(secondRun.host.callCount).toBe(1)
    } finally {
      session?.dispose()
    }
  })
})
