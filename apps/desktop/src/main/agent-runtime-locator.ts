import { dialog, type BrowserWindow } from 'electron'
import { access, constants, realpath, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  AgentRuntimeError,
  AgentRuntimeSource,
  AgentRuntimeStatus
} from '@canvas-agent/contracts'
import {
  isSupportedCodexVersion,
  LocalCliSpawnError,
  runLocalCli
} from '@canvas-agent/worker-runtime'
import { AgentSettingsStore } from './agent-settings'

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

export type ConfigurationChangeResult<T> =
  { ok: true; value: T } | { ok: false; reason: 'ACTIVE_RUN_BLOCKS_CHANGE' }

export type ConfigurationChangeGate = <T>(
  fn: () => Promise<T>
) => Promise<ConfigurationChangeResult<T>>

export interface AgentRuntimeLocatorOptions {
  userData: string
  homePath: string
  environment: Readonly<Record<string, string>>
  picker: ExecutablePicker
  isChangeBlocked: () => boolean
  configurationGate: ConfigurationChangeGate
  knownLocations?: readonly string[]
}

/**
 * Main-internal trusted launch plan (never derived from the renderer-facing
 * displayPath): the absolute validated launcher path plus the bounded
 * PATH/HOME allowlist used by the Worker to spawn the Codex adapter.
 */
export interface AgentLaunchPlan {
  schemaVersion: 1
  provider: 'codex-cli'
  executable: string
  environment: { PATH: string; HOME: string }
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
  private launchPlan: AgentLaunchPlan | null = null
  private readonly settings: AgentSettingsStore

  constructor(private readonly options: AgentRuntimeLocatorOptions) {
    this.settings = new AgentSettingsStore(options.userData)
  }

  getLaunchPlan(): AgentLaunchPlan | null {
    return this.launchPlan
  }

  async status(): Promise<AgentRuntimeStatus> {
    return this.committedStatus()
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
    const path = picked.path
    const gated = await this.options.configurationGate(async (): Promise<AgentRuntimeStatus> => {
      // Prime the committed status FIRST (restart-safe): a fresh Locator with a
      // previously saved READY launcher must protect it even when statusCache is
      // still null. Only a prior READY state is protected; AUTH_REQUIRED is a
      // candidate awaiting external login, never a carrier for other errors.
      const committed = await this.committedStatus()
      const priorReady = committed.state === 'READY'
      const candidate = await this.probeCandidate(path, 'USER_SELECTED')
      const commit =
        candidate.state === 'READY' || (candidate.state === 'AUTH_REQUIRED' && !priorReady)
      if (!commit) {
        if (priorReady) {
          return {
            ...committed,
            lastError:
              candidate.lastError ??
              ({ reasonCode: 'UNKNOWN', recoverable: true } as AgentRuntimeError)
          }
        }
        return candidate
      }
      try {
        await this.settings.writeLauncher(path)
      } catch {
        if (priorReady) {
          return {
            ...committed,
            lastError: { reasonCode: 'SETTINGS_INVALID', recoverable: true } as AgentRuntimeError
          }
        }
        return {
          provider: 'codex-cli',
          state: 'ERROR',
          version: null,
          source: null,
          displayPath: null,
          lastError: { reasonCode: 'SETTINGS_INVALID', recoverable: true }
        }
      }
      this.statusCache = candidate
      this.syncLaunchPlan(candidate)
      return candidate
    })
    if (!gated.ok) {
      return { cancelled: false, status: await this.blockedStatus() }
    }
    return { cancelled: false, status: gated.value }
  }

  async clearExecutable(): Promise<AgentRuntimeStatus> {
    if (this.options.isChangeBlocked()) {
      return this.blockedStatus()
    }
    const gated = await this.options.configurationGate(async (): Promise<AgentRuntimeStatus> => {
      try {
        await this.settings.writeLauncher(null)
      } catch {
        const committed = await this.committedStatus()
        if (committed.state === 'READY') {
          return {
            ...committed,
            lastError: { reasonCode: 'SETTINGS_INVALID', recoverable: true } as AgentRuntimeError
          }
        }
        return {
          provider: 'codex-cli',
          state: 'ERROR',
          version: null,
          source: null,
          displayPath: null,
          lastError: { reasonCode: 'SETTINGS_INVALID', recoverable: true }
        }
      }
      this.statusCache = null
      return this.discover()
    })
    if (!gated.ok) {
      return this.blockedStatus()
    }
    return gated.value
  }

  private async committedStatus(): Promise<AgentRuntimeStatus> {
    if (this.statusCache === null) {
      this.statusCache = await this.discover()
    }
    return this.statusCache
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
        this.syncLaunchPlan(status)
        return status
      }
      if (
        status.state !== 'NOT_FOUND' &&
        (best === null || informativeScore(status) < informativeScore(best))
      ) {
        best = status
      }
    }
    this.launchPlan = null
    return best ?? errorStatus('EXECUTABLE_NOT_FOUND', null, null, null)
  }

  private syncLaunchPlan(status: AgentRuntimeStatus): void {
    if (status.state === 'READY' && status.displayPath !== null) {
      this.launchPlan = {
        schemaVersion: 1,
        provider: 'codex-cli',
        executable: status.displayPath,
        environment: {
          PATH: this.options.environment['PATH'] ?? '',
          HOME: this.options.environment['HOME'] ?? ''
        }
      }
    } else {
      // AUTH_REQUIRED / NOT_FOUND / errors never produce a dispatchable plan.
      this.launchPlan = null
    }
  }

  private async probeCandidate(
    launcherPath: string,
    source: AgentRuntimeSource
  ): Promise<AgentRuntimeStatus> {
    let canonical: string
    try {
      canonical = await realpath(launcherPath)
    } catch {
      return errorStatus('EXECUTABLE_NOT_FOUND', null, null, null)
    }
    try {
      const info = await stat(canonical)
      if (!info.isFile()) {
        return errorStatus('EXECUTABLE_NOT_READABLE', source, null, launcherPath)
      }
      await access(canonical, constants.X_OK)
    } catch {
      return errorStatus('EXECUTABLE_NOT_READABLE', source, null, launcherPath)
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
    if (!isSupportedCodexVersion(versionText)) {
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
