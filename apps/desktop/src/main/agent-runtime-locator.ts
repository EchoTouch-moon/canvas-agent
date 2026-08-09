import { dialog, type BrowserWindow } from 'electron'
import { access, constants, realpath, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  AgentRuntimeError,
  AgentRuntimeSource,
  AgentRuntimeStatus
} from '@canvas-agent/contracts'
import { LocalCliSpawnError, runLocalCli } from '@canvas-agent/worker-runtime'
import { AgentSettingsStore } from './agent-settings'

const CODEX_VERSION_PREFIX = 'codex-cli '
const PROBE_TIMEOUT_MS = 5_000
const PROBE_OUTPUT_BYTES = 16 * 1024

export interface ExecutablePicker {
  pick(window: BrowserWindow | undefined): Promise<{ cancelled: boolean; path: string | null }>
}

export class NativeExecutablePicker implements ExecutablePicker {
  async pick(
    window: BrowserWindow | undefined
  ): Promise<{ cancelled: boolean; path: string | null }> {
    const result =
      window === undefined
        ? await dialog.showOpenDialog({ properties: ['openFile'] })
        : await dialog.showOpenDialog(window, { properties: ['openFile'] })
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true, path: null }
    }
    return { cancelled: false, path: result.filePaths[0] }
  }
}

export const EXECUTABLE_PICKER_CANCEL = '__CANCEL__'

export class EnvExecutablePicker implements ExecutablePicker {
  async pick(
    _window: BrowserWindow | undefined
  ): Promise<{ cancelled: boolean; path: string | null }> {
    void _window
    const value = process.env['CANVAS_AGENT_TEST_EXECUTABLE']
    if (value === undefined || value === '' || value === EXECUTABLE_PICKER_CANCEL) {
      return { cancelled: true, path: null }
    }
    return { cancelled: false, path: value }
  }
}

export function executablePickerFromEnvironment(): ExecutablePicker | null {
  const e2eEnabled = process.env['CANVAS_AGENT_E2E'] === '1'
  const isolatedUserData = Boolean(process.env['CANVAS_AGENT_USER_DATA'])
  if (!e2eEnabled || !isolatedUserData) {
    return null
  }
  return new EnvExecutablePicker()
}

export interface AgentRuntimeLocatorOptions {
  userData: string
  homePath: string
  environment: Readonly<Record<string, string>>
  picker: ExecutablePicker
  isChangeBlocked: () => boolean
  knownLocations?: readonly string[]
}

type ProbeOutcome =
  | { kind: 'ok'; exitCode: number | null; stdout: string; stderr: string }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }
  | { kind: 'spawn-error' }
  | { kind: 'unknown-error' }

function errorStatus(
  reasonCode: AgentRuntimeError['reasonCode'],
  source: AgentRuntimeSource | null,
  version: string | null,
  displayPath: string | null,
  recoverable = true
): AgentRuntimeStatus {
  const state =
    reasonCode === 'EXECUTABLE_NOT_FOUND'
      ? 'NOT_FOUND'
      : reasonCode === 'EXECUTABLE_NOT_SUPPORTED'
        ? 'UNSUPPORTED_VERSION'
        : reasonCode === 'INTERPRETER_MISSING'
          ? 'INTERPRETER_MISSING'
          : 'ERROR'
  return {
    provider: 'codex-cli',
    state,
    version,
    source,
    displayPath,
    lastError: { reasonCode, recoverable }
  }
}

// Lower is more informative; discovery prefers a concrete candidate error over
// a bare NOT_FOUND (e.g. INTERPRETER_MISSING beats "no candidate at all").
function informativeScore(status: AgentRuntimeStatus): number {
  switch (status.lastError?.reasonCode) {
    case 'INTERPRETER_MISSING':
      return 1
    case 'EXECUTABLE_NOT_SUPPORTED':
      return 2
    case 'PROBE_TIMED_OUT':
      return 3
    case 'EXECUTABLE_NOT_READABLE':
      return 4
    default:
      return 5
  }
}

export class AgentRuntimeLocator {
  private statusCache: AgentRuntimeStatus | null = null
  private readonly settings: AgentSettingsStore

  constructor(private readonly options: AgentRuntimeLocatorOptions) {
    this.settings = new AgentSettingsStore(options.userData)
  }

  async status(): Promise<AgentRuntimeStatus> {
    if (this.statusCache === null) {
      this.statusCache = await this.discover()
    }
    return this.statusCache
  }

  async chooseExecutable(
    window: BrowserWindow | undefined
  ): Promise<{ cancelled: boolean; status: AgentRuntimeStatus }> {
    if (this.options.isChangeBlocked()) {
      return { cancelled: false, status: await this.blockedStatus() }
    }
    const picked = await this.options.picker.pick(window)
    if (picked.cancelled || picked.path === null) {
      return { cancelled: true, status: await this.status() }
    }
    const status = await this.probeCandidate(picked.path, 'USER_SELECTED')
    if (status.state === 'READY' || status.state === 'AUTH_REQUIRED') {
      await this.settings.writeLauncher(picked.path).catch(() => undefined)
    }
    this.statusCache = status
    return { cancelled: false, status }
  }

  async clearExecutable(): Promise<AgentRuntimeStatus> {
    if (this.options.isChangeBlocked()) {
      return this.blockedStatus()
    }
    await this.settings.writeLauncher(null)
    this.statusCache = null
    return this.discover()
  }

  private async blockedStatus(): Promise<AgentRuntimeStatus> {
    const current = await this.status()
    return {
      ...current,
      lastError: { reasonCode: 'ACTIVE_RUN_BLOCKS_CHANGE', recoverable: true }
    }
  }

  private async discover(): Promise<AgentRuntimeStatus> {
    const candidates: Array<() => Promise<AgentRuntimeStatus>> = []
    const saved = await this.settings.read()
    const savedPath = saved.codexCliLauncherPath
    if (savedPath !== null) {
      candidates.push(() => this.probeCandidate(savedPath, 'USER_SELECTED'))
    }
    const onPath = await this.findExecutableOnPath()
    if (onPath !== null) {
      candidates.push(() => this.probeCandidate(onPath, 'PATH'))
    }
    for (const known of this.knownLocations()) {
      candidates.push(() => this.probeCandidate(known, 'KNOWN_LOCATION'))
    }

    let best: AgentRuntimeStatus | null = null
    for (const candidate of candidates) {
      const status = await candidate()
      if (status.state === 'READY' || status.state === 'AUTH_REQUIRED') {
        return status
      }
      if (
        status.state !== 'NOT_FOUND' &&
        (best === null || informativeScore(status) < informativeScore(best))
      ) {
        best = status
      }
    }
    return best ?? errorStatus('EXECUTABLE_NOT_FOUND', null, null, null)
  }

  private async probeCandidate(
    launcherPath: string,
    source: AgentRuntimeSource
  ): Promise<AgentRuntimeStatus> {
    let canonical: string
    try {
      canonical = await realpath(launcherPath)
      const info = await stat(canonical)
      if (!info.isFile()) {
        return errorStatus('EXECUTABLE_NOT_READABLE', source, null, launcherPath)
      }
      await access(canonical, constants.X_OK)
    } catch {
      // the launcher path itself does not resolve to an executable regular file
      return errorStatus('EXECUTABLE_NOT_FOUND', null, null, null)
    }

    const version = await this.probe(['--version'], launcherPath)
    if (version.kind === 'spawn-error') {
      return errorStatus('INTERPRETER_MISSING', source, null, launcherPath)
    }
    if (version.kind === 'timeout') {
      return errorStatus('PROBE_TIMED_OUT', source, null, launcherPath)
    }
    if (version.kind !== 'ok') {
      return errorStatus('EXECUTABLE_NOT_SUPPORTED', source, null, launcherPath)
    }
    // An npm launcher whose shebang interpreter cannot be resolved surfaces as
    // a 127 exit from `env` (or a spawn ENOENT handled above).
    if (version.exitCode === 127) {
      return errorStatus('INTERPRETER_MISSING', source, null, launcherPath)
    }
    if (version.exitCode !== 0) {
      return errorStatus('EXECUTABLE_NOT_SUPPORTED', source, null, launcherPath)
    }
    const versionText = version.stdout.trim()
    if (!versionText.startsWith(CODEX_VERSION_PREFIX)) {
      return errorStatus('EXECUTABLE_NOT_SUPPORTED', source, versionText, launcherPath)
    }

    const auth = await this.probe(['login', 'status'], launcherPath)
    if (auth.kind === 'timeout') {
      return errorStatus('PROBE_TIMED_OUT', source, versionText, launcherPath)
    }
    if (auth.kind === 'spawn-error') {
      return errorStatus('INTERPRETER_MISSING', source, versionText, launcherPath)
    }
    if (auth.kind !== 'ok' || auth.exitCode !== 0) {
      return {
        provider: 'codex-cli',
        state: 'AUTH_REQUIRED',
        version: versionText,
        source,
        displayPath: launcherPath,
        lastError: { reasonCode: 'AUTH_REQUIRED', recoverable: true }
      }
    }
    return {
      provider: 'codex-cli',
      state: 'READY',
      version: versionText,
      source,
      displayPath: launcherPath,
      lastError: null
    }
  }

  private async probe(argv: readonly string[], launcherPath: string): Promise<ProbeOutcome> {
    try {
      const result = await runLocalCli({
        executable: launcherPath,
        argv,
        cwd: dirname(launcherPath),
        timeoutMs: PROBE_TIMEOUT_MS,
        maxStdoutBytes: PROBE_OUTPUT_BYTES,
        maxStderrBytes: PROBE_OUTPUT_BYTES,
        environment: this.options.environment
      })
      if (result.timedOut) {
        return { kind: 'timeout' }
      }
      if (result.cancelled) {
        return { kind: 'cancelled' }
      }
      return {
        kind: 'ok',
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      }
    } catch (error) {
      if (error instanceof LocalCliSpawnError) {
        return { kind: 'spawn-error' }
      }
      return { kind: 'unknown-error' }
    }
  }

  private async findExecutableOnPath(): Promise<string | null> {
    const pathValue = this.options.environment['PATH'] ?? ''
    for (const dir of pathValue.split(':')) {
      if (dir.length === 0) continue
      const candidate = join(dir, 'codex')
      try {
        const info = await stat(candidate)
        if (info.isFile()) {
          await access(candidate, constants.X_OK)
          return candidate
        }
      } catch {
        // try next dir
      }
    }
    return null
  }

  private knownLocations(): readonly string[] {
    if (this.options.knownLocations !== undefined) {
      return this.options.knownLocations
    }
    return [
      join(this.options.homePath, '.local', 'bin', 'codex'),
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      '/usr/bin/codex'
    ]
  }
}
