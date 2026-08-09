import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntimeLocator, type ExecutablePicker } from './agent-runtime-locator'

const NODE_DIR = dirname(process.execPath)

async function makeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ca-agent-'))
}

async function writeScript(dir: string, name: string, body: string): Promise<string> {
  const file = join(dir, name)
  await writeFile(file, `#!/usr/bin/env node\n${body}`, 'utf8')
  await chmod(file, 0o755)
  return file
}

const REAL_CODEX = `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n') }
else if (process.argv[2] === 'login' && process.argv[3] === 'status') { process.stdout.write('Logged in using ChatGPT\\n') }
else { process.exit(1) }
`

const UNSUPPORTED = `process.stdout.write('unknown tool v1\\n')`

const AUTH_FAIL = `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n') }
else { process.stderr.write('not logged in\\n'); process.exit(1) }
`

interface Fixture {
  userData: string
  home: string
  paths: string[]
  picker: ExecutablePicker
  blocked: () => boolean
}

interface LocatorFixture {
  locator: AgentRuntimeLocator
  userData: string
  home: string
  paths: string[]
}

async function makeLocator(overrides: Partial<Fixture> = {}): Promise<LocatorFixture> {
  const userData = overrides.userData ?? (await makeDir())
  const home = overrides.home ?? (await makeDir())
  const paths = overrides.paths ?? [NODE_DIR]
  const environment = { PATH: paths.join(':'), HOME: home }
  const picker =
    overrides.picker ??
    ({
      pick: async (): Promise<{ cancelled: boolean; path: string | null }> => ({
        cancelled: true,
        path: null
      })
    } as ExecutablePicker)
  const locator = new AgentRuntimeLocator({
    userData,
    homePath: home,
    environment,
    picker,
    knownLocations: [],
    isChangeBlocked: overrides.blocked ?? ((): boolean => false)
  })
  return { locator, userData, home, paths }
}

function clean(dirs: string[]): void {
  void Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined))
  )
}

describe('AgentRuntimeLocator', () => {
  const created: string[] = []
  afterEach(async () => {
    clean(created.splice(0))
  })

  it('discovers a fake codex on PATH and reaches READY', async () => {
    const bin = await makeDir()
    created.push(bin)
    await writeScript(bin, 'codex', REAL_CODEX)
    const { locator } = await makeLocator({ paths: [NODE_DIR, bin] })
    const status = await locator.status()
    expect(status.state).toBe('READY')
    expect(status.source).toBe('PATH')
    expect(status.version).toBe('codex-cli 0.146.0')
    expect(status.lastError).toBeNull()
  })

  it('returns NOT_FOUND when no candidate exists', async () => {
    const { locator } = await makeLocator()
    const status = await locator.status()
    expect(status.state).toBe('NOT_FOUND')
    expect(status.version).toBeNull()
    expect(status.displayPath).toBeNull()
    expect(status.lastError?.reasonCode).toBe('EXECUTABLE_NOT_FOUND')
  })

  it('prefers a saved user-selected launcher over PATH discovery', async () => {
    const bin = await makeDir()
    created.push(bin)
    const saved = await writeScript(bin, 'saved-codex', REAL_CODEX)
    const userData = await makeDir()
    created.push(userData)
    await mkdir(userData, { recursive: true })
    await writeFile(
      join(userData, 'agent-settings-v1.json'),
      JSON.stringify({ schemaVersion: 1, codexCliLauncherPath: saved }),
      'utf8'
    )
    const { locator } = await makeLocator({ userData })
    const status = await locator.status()
    expect(status.state).toBe('READY')
    expect(status.source).toBe('USER_SELECTED')
    expect(status.displayPath).toBe(saved)
  })

  it('falls back to discovery when settings are corrupt', async () => {
    const userData = await makeDir()
    created.push(userData)
    await writeFile(join(userData, 'agent-settings-v1.json'), '{ not json', 'utf8')
    const { locator } = await makeLocator({ userData })
    const status = await locator.status()
    expect(status.state).toBe('NOT_FOUND')
  })

  it('validates a symlink launcher and records the chosen path', async () => {
    const bin = await makeDir()
    created.push(bin)
    const target = await writeScript(bin, 'real-codex', REAL_CODEX)
    const link = join(bin, 'codex-link')
    await symlink(target, link)
    const { locator, userData } = await makeLocator({
      picker: { pick: async () => ({ cancelled: false, path: link }) }
    })
    const chosen = await locator.chooseExecutable(undefined)
    expect(chosen.cancelled).toBe(false)
    expect(chosen.status.state).toBe('READY')
    expect(chosen.status.source).toBe('USER_SELECTED')
    const settings = JSON.parse(
      await (
        await import('node:fs/promises')
      ).readFile(join(userData, 'agent-settings-v1.json'), 'utf8')
    ) as { codexCliLauncherPath: string }
    expect(await realpath(settings.codexCliLauncherPath)).toBe(await realpath(target))
  })

  it('rejects an unsupported version with UNSUPPORTED_VERSION', async () => {
    const bin = await makeDir()
    created.push(bin)
    await writeScript(bin, 'codex', UNSUPPORTED)
    const { locator } = await makeLocator({ paths: [NODE_DIR, bin] })
    const status = await locator.status()
    expect(status.state).toBe('UNSUPPORTED_VERSION')
    expect(status.lastError?.reasonCode).toBe('EXECUTABLE_NOT_SUPPORTED')
  })

  it('maps a missing auth to AUTH_REQUIRED', async () => {
    const bin = await makeDir()
    created.push(bin)
    await writeScript(bin, 'codex', AUTH_FAIL)
    const { locator } = await makeLocator({ paths: [NODE_DIR, bin] })
    const status = await locator.status()
    expect(status.state).toBe('AUTH_REQUIRED')
    expect(status.lastError?.reasonCode).toBe('AUTH_REQUIRED')
  })

  it('maps a missing shebang interpreter to INTERPRETER_MISSING', async () => {
    const bin = await makeDir()
    created.push(bin)
    const file = join(bin, 'codex')
    await writeFile(file, '#!/usr/bin/env definitely-missing-interpreter\nconsole.log(1)\n', 'utf8')
    await chmod(file, 0o755)
    const { locator } = await makeLocator({ paths: [NODE_DIR, bin] })
    const status = await locator.status()
    expect(status.state).toBe('INTERPRETER_MISSING')
    expect(status.lastError?.reasonCode).toBe('INTERPRETER_MISSING')
  })

  it('blocks choose/clear while an execution is active', async () => {
    const bin = await makeDir()
    created.push(bin)
    await writeScript(bin, 'codex', REAL_CODEX)
    const { locator } = await makeLocator({
      paths: [NODE_DIR, bin],
      blocked: () => true,
      picker: { pick: async () => ({ cancelled: false, path: join(bin, 'codex') }) }
    })
    const chosen = await locator.chooseExecutable(undefined)
    expect(chosen.cancelled).toBe(false)
    expect(chosen.status.lastError?.reasonCode).toBe('ACTIVE_RUN_BLOCKS_CHANGE')
    const cleared = await locator.clearExecutable()
    expect(cleared.lastError?.reasonCode).toBe('ACTIVE_RUN_BLOCKS_CHANGE')
  })

  it('picker cancellation preserves the prior status', async () => {
    const bin = await makeDir()
    created.push(bin)
    await writeScript(bin, 'codex', REAL_CODEX)
    let mode: 'pick' | 'cancel' = 'pick'
    const { locator } = await makeLocator({
      paths: [NODE_DIR, bin],
      picker: {
        pick: async () =>
          mode === 'pick'
            ? { cancelled: false, path: join(bin, 'codex') }
            : { cancelled: true, path: null }
      }
    })
    await locator.chooseExecutable(undefined)
    const before = await locator.status()
    mode = 'cancel'
    const cancelled = await locator.chooseExecutable(undefined)
    expect(cancelled.cancelled).toBe(true)
    expect(cancelled.status).toEqual(before)
  })

  it('clearExecutable drops the saved choice and rediscovers', async () => {
    const bin = await makeDir()
    created.push(bin)
    const saved = await writeScript(bin, 'saved-codex', REAL_CODEX)
    const userData = await makeDir()
    created.push(userData)
    await writeFile(
      join(userData, 'agent-settings-v1.json'),
      JSON.stringify({ schemaVersion: 1, codexCliLauncherPath: saved }),
      'utf8'
    )
    const { locator, userData: ud } = await makeLocator({ userData })
    await locator.clearExecutable()
    const settings = JSON.parse(
      await (await import('node:fs/promises')).readFile(join(ud, 'agent-settings-v1.json'), 'utf8')
    ) as { codexCliLauncherPath: string | null }
    expect(settings.codexCliLauncherPath).toBeNull()
    const status = await locator.status()
    expect(status.state).toBe('NOT_FOUND')
  })
})
