import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type { RepositoryRevisionContract } from '@canvas-agent/contracts'
import type { BenchmarkManifest, FixtureIdentity, OracleResult } from './types'

export const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024
export const C2_CONTRACT_PROBE_TIMEOUT_MS = 1_000
const MAX_C2_PROTOCOL_BYTES = 4 * 1024

const SANITIZED_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SHELL',
  'ComSpec',
  'SystemRoot',
  'WINDIR',
  'PATHEXT',
  'CI',
  'NODE_ENV',
  'GIT_TERMINAL_PROMPT',
  'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_DATE'
])

/**
 * Build the only environment that benchmark-owned child processes may see.
 * Provider credentials, Node preload hooks, and shell startup hooks are
 * intentionally excluded by construction rather than removed one by one.
 */
export function buildSanitizedChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of SANITIZED_ENV_KEYS) {
    const value = source[key]
    if (value !== undefined) environment[key] = value
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (SANITIZED_ENV_KEYS.has(key) && value !== undefined) environment[key] = value
  }
  environment['CI'] = '1'
  environment['NODE_ENV'] = 'test'
  environment['GIT_TERMINAL_PROMPT'] = '0'
  return environment
}

export interface ProcessResult {
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly outputLimitExceeded: boolean
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

export interface MaterializedFixture {
  readonly path: string
  readonly identity: FixtureIdentity
  readonly cleanup: () => Promise<void>
}

const IGNORED_FIXTURE_ENTRIES = new Set(['.git', '.pi-agent'])

interface BoundedOutput {
  readonly chunks: string[]
  bytes: number
  exceeded: boolean
}

function appendBoundedOutput(output: BoundedOutput, chunk: string | Buffer, maxBytes: number): void {
  const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
  if (output.bytes >= maxBytes) {
    output.exceeded = true
    return
  }
  const remaining = maxBytes - output.bytes
  const accepted = buffer.subarray(0, remaining)
  output.chunks.push(accepted.toString('utf8'))
  output.bytes += accepted.byteLength
  if (accepted.byteLength < buffer.byteLength) output.exceeded = true
}

function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined) {
    child.kill('SIGKILL')
    return
  }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true
    })
    killer.unref()
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

function processResultFailure(error: unknown, startedAt: number): ProcessResult {
  return {
    exitCode: null,
    timedOut: false,
    outputLimitExceeded: false,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    durationMs: Date.now() - startedAt
  }
}

function safeResolve(root: string, child: string): string {
  const absoluteRoot = resolve(root)
  const absoluteChild = resolve(absoluteRoot, child)
  if (absoluteChild !== absoluteRoot && !absoluteChild.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`path escapes root: ${child}`)
  }
  return absoluteChild
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string
    readonly timeoutMs: number
    readonly env?: NodeJS.ProcessEnv
    readonly maxOutputBytes?: number
  }
): Promise<ProcessResult> {
  return new Promise((resolveResult) => {
    const startedAt = Date.now()
    const maxOutputBytes = options.maxOutputBytes ?? MAX_PROCESS_OUTPUT_BYTES
    const stdout: BoundedOutput = { chunks: [], bytes: 0, exceeded: false }
    const stderr: BoundedOutput = { chunks: [], bytes: 0, exceeded: false }
    let timedOut = false
    let outputLimitExceeded = false
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let child: ChildProcess

    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env ?? buildSanitizedChildEnvironment(),
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (error) {
      resolveResult(processResultFailure(error, startedAt))
      return
    }

    const terminateForOutputLimit = (): void => {
      if (outputLimitExceeded || settled) return
      outputLimitExceeded = true
      terminateProcessTree(child)
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      appendBoundedOutput(stdout, chunk, maxOutputBytes)
      if (stdout.exceeded) terminateForOutputLimit()
    })
    child.stderr?.on('data', (chunk: string) => {
      appendBoundedOutput(stderr, chunk, maxOutputBytes)
      if (stderr.exceeded) terminateForOutputLimit()
    })
    const finish = (result: ProcessResult): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolveResult(result)
    }
    child.on('error', (error: Error) => {
      finish({
        exitCode: null,
        timedOut,
        outputLimitExceeded,
        stdout: stdout.chunks.join(''),
        stderr: `${stderr.chunks.join('')}${error.message}`.slice(0, maxOutputBytes),
        durationMs: Date.now() - startedAt
      })
    })
    child.on('close', (exitCode: number | null) => {
      finish({
        exitCode,
        timedOut,
        outputLimitExceeded,
        stdout: stdout.chunks.join(''),
        stderr: stderr.chunks.join(''),
        durationMs: Date.now() - startedAt
      })
    })
    timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      terminateProcessTree(child)
    }, options.timeoutMs)
  })
}

export interface C2ContractProbeResult {
  readonly configRuntime: boolean
  readonly greetingRuntime: boolean
  readonly indexForwarding: boolean
  readonly timedOut: boolean
  readonly outputLimitExceeded: boolean
  readonly protocolValid: boolean
}

interface C2ContractProbePayload {
  readonly version: 1
  readonly type: 'cr005-c2-contract-result'
  readonly configRuntime: boolean
  readonly greetingRuntime: boolean
  readonly indexForwarding: boolean
}

function parseC2ContractProbePayload(value: unknown): C2ContractProbePayload | null {
  if (typeof value !== 'string') return null
  if (Buffer.byteLength(value) > MAX_C2_PROTOCOL_BYTES) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const entries = Object.entries(parsed)
  const keys = entries.map(([key]) => key).sort()
  if (keys.join(',') !== 'configRuntime,greetingRuntime,indexForwarding,type,version') return null
  const read = (key: string): unknown => entries.find(([candidate]) => candidate === key)?.[1]
  const version = read('version')
  const type = read('type')
  const configRuntime = read('configRuntime')
  const greetingRuntime = read('greetingRuntime')
  const indexForwarding = read('indexForwarding')
  if (
    version !== 1 ||
    type !== 'cr005-c2-contract-result' ||
    typeof configRuntime !== 'boolean' ||
    typeof greetingRuntime !== 'boolean' ||
    typeof indexForwarding !== 'boolean'
  ) {
    return null
  }
  return { version, type, configRuntime, greetingRuntime, indexForwarding }
}

export function runC2ContractProbe(fixturePath: string): Promise<C2ContractProbeResult> {
  return new Promise((resolveResult) => {
    const absoluteFixturePath = resolve(fixturePath)
    const childScript = join(import.meta.dirname, 'c2-contract-probe-child.mjs')
    let child: ChildProcess
    try {
      child = spawn(process.execPath, [childScript, absoluteFixturePath], {
        cwd: absoluteFixturePath,
        env: buildSanitizedChildEnvironment(),
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        windowsHide: true
      })
    } catch {
      resolveResult({
        configRuntime: false,
        greetingRuntime: false,
        indexForwarding: false,
        timedOut: false,
        outputLimitExceeded: false,
        protocolValid: false
      })
      return
    }

    let timedOut = false
    let outputLimitExceeded = false
    let settled = false
    let messageCount = 0
    let payload: C2ContractProbePayload | null = null
    let outputBytes = 0
    let timer: NodeJS.Timeout | undefined

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      const protocolValid =
        exitCode === 0 &&
        !timedOut &&
        !outputLimitExceeded &&
        messageCount === 1 &&
        payload !== null
      resolveResult({
        configRuntime: protocolValid && payload !== null ? payload.configRuntime : false,
        greetingRuntime: protocolValid && payload !== null ? payload.greetingRuntime : false,
        indexForwarding: protocolValid && payload !== null ? payload.indexForwarding : false,
        timedOut,
        outputLimitExceeded,
        protocolValid
      })
    }
    const terminateForSafety = (): void => {
      if (settled) return
      terminateProcessTree(child)
    }
    const recordOutput = (chunk: string | Buffer): void => {
      outputBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        outputLimitExceeded = true
        terminateForSafety()
      }
    }

    child.stdout?.on('data', recordOutput)
    child.stderr?.on('data', recordOutput)
    child.on('message', (message: unknown) => {
      messageCount += 1
      if (messageCount > 1) {
        terminateForSafety()
        return
      }
      const parsed = parseC2ContractProbePayload(message)
      if (parsed !== null) payload = parsed
    })
    child.on('error', () => finish(null))
    child.on('close', (exitCode: number | null) => finish(exitCode))
    timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      terminateForSafety()
    }, C2_CONTRACT_PROBE_TIMEOUT_MS)

  })
}

async function runGit(cwd: string, args: readonly string[], timeoutMs = 30_000): Promise<string> {
  const result = await runProcess('git', args, {
    cwd,
    timeoutMs,
    env: buildSanitizedChildEnvironment()
  })
  if (result.exitCode !== 0 || result.timedOut || result.outputLimitExceeded) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  const entries = (await readdir(source, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    if (IGNORED_FIXTURE_ENTRIES.has(entry.name)) continue
    const sourcePath = join(source, entry.name)
    const destinationPath = join(destination, entry.name)
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath)
    } else if (entry.isFile()) {
      await mkdir(join(destinationPath, '..'), { recursive: true })
      await copyFile(sourcePath, destinationPath)
    } else {
      throw new Error(`unsupported fixture entry: ${sourcePath}`)
    }
  }
}

async function collectFixtureFiles(root: string, current = root): Promise<readonly string[]> {
  const entries = (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))
  const files: string[] = []
  for (const entry of entries) {
    if (IGNORED_FIXTURE_ENTRIES.has(entry.name)) continue
    const path = join(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFixtureFiles(root, path)))
    } else if (entry.isFile()) {
      files.push(relative(root, path).split(sep).join('/'))
    } else {
      throw new Error(`unsupported fixture entry: ${path}`)
    }
  }
  return files.sort()
}

export async function computeInitialStateHash(root: string): Promise<string> {
  const digest = createHash('sha256')
  const files = await collectFixtureFiles(root)
  for (const path of files) {
    const absolutePath = safeResolve(root, path)
    const fileStat = await stat(absolutePath)
    digest.update(`${path}\0${(fileStat.mode & 0o777).toString(8)}\0`)
    digest.update(await readFile(absolutePath))
    digest.update('\n')
  }
  return digest.digest('hex')
}

export async function initializeFixtureRepository(root: string, taskId: string): Promise<RepositoryRevisionContract> {
  await runGit(root, ['init', '-q', '-b', 'main'])
  await runGit(root, ['config', 'user.email', 'cr-005-fixtures@canvas.local'])
  await runGit(root, ['config', 'user.name', 'CR-005 Fixture Builder'])
  await runGit(root, ['config', 'commit.gpgSign', 'false'])
  await runGit(root, ['add', '--all'])
  const fixedDate = '2026-01-01T00:00:00Z'
  const commit = await runProcess('git', ['commit', '--quiet', '--no-gpg-sign', '--message', `CR-005 fixture ${taskId}`], {
    cwd: root,
    timeoutMs: 30_000,
    env: buildSanitizedChildEnvironment(process.env, {
      GIT_AUTHOR_DATE: fixedDate,
      GIT_COMMITTER_DATE: fixedDate
    })
  })
  if (commit.exitCode !== 0 || commit.timedOut || commit.outputLimitExceeded) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`)
  }
  return {
    baseCommit: await runGit(root, ['rev-parse', 'HEAD']),
    treeHash: await runGit(root, ['rev-parse', 'HEAD^{tree}']),
    workingTreePatchHash: null
  }
}

export async function materializeFixture(
  researchRoot: string,
  manifest: BenchmarkManifest,
  kind: 'fixture' | 'reference' = 'fixture'
): Promise<MaterializedFixture> {
  const templatePath = safeResolve(researchRoot, kind === 'fixture' ? manifest.fixturePath : manifest.referencePath)
  const path = await mkdtemp(join(tmpdir(), `canvas-cr005-${manifest.taskId}-${kind}-`))
  try {
    await copyDirectory(templatePath, path)
    const repositoryRevision = await initializeFixtureRepository(path, manifest.taskId)
    const initialStateHash = await computeInitialStateHash(path)
    const identity: FixtureIdentity = { repositoryRevision, initialStateHash }
    if (kind === 'fixture') {
      if (repositoryRevision.baseCommit !== manifest.repositoryRevision.baseCommit) {
        throw new Error(`${manifest.taskId} baseCommit mismatch: ${repositoryRevision.baseCommit}`)
      }
      if (repositoryRevision.treeHash !== manifest.repositoryRevision.treeHash) {
        throw new Error(`${manifest.taskId} treeHash mismatch: ${repositoryRevision.treeHash}`)
      }
      if (initialStateHash !== manifest.initialStateHash) {
        throw new Error(`${manifest.taskId} initialStateHash mismatch: ${initialStateHash}`)
      }
    }
    return {
      path,
      identity,
      cleanup: async () => rm(path, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(path, { recursive: true, force: true })
    throw error
  }
}

export async function runOracle(
  manifest: BenchmarkManifest,
  cwd: string,
  oracle: BenchmarkManifest['oracle'] = manifest.oracle
): Promise<OracleResult> {
  const processResult = await runProcess(process.execPath, oracle.args, {
    cwd,
    timeoutMs: oracle.timeoutMs,
    env: buildSanitizedChildEnvironment()
  })
  return {
    passed:
      !processResult.timedOut &&
      !processResult.outputLimitExceeded &&
      processResult.exitCode === oracle.expectedExitCode,
    exitCode: processResult.exitCode,
    timedOut: processResult.timedOut,
    outputLimitExceeded: processResult.outputLimitExceeded,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    durationMs: processResult.durationMs
  }
}

export async function materializeAndRunOracle(
  researchRoot: string,
  manifest: BenchmarkManifest
): Promise<{ readonly fixture: OracleResult; readonly reference: OracleResult }> {
  const fixture = await materializeFixture(researchRoot, manifest, 'fixture')
  const reference = await materializeFixture(researchRoot, manifest, 'reference')
  try {
    return {
      fixture: await runOracle(manifest, fixture.path),
      reference: await runOracle(manifest, reference.path)
    }
  } finally {
    await fixture.cleanup()
    await reference.cleanup()
  }
}
