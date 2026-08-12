import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type { RepositoryRevisionContract } from '@canvas-agent/contracts'
import type { BenchmarkManifest, FixtureIdentity, OracleResult } from './types'

export interface ProcessResult {
  readonly exitCode: number | null
  readonly timedOut: boolean
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
  options: { readonly cwd: string; readonly timeoutMs: number; readonly env?: NodeJS.ProcessEnv }
): Promise<ProcessResult> {
  return new Promise((resolveResult) => {
    const startedAt = Date.now()
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout: string[] = []
    const stderr: string[] = []
    let timedOut = false
    let settled = false

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => stdout.push(chunk))
    child.stderr.on('data', (chunk: string) => stderr.push(chunk))
    child.on('error', (error: Error) => {
      if (settled) return
      settled = true
      resolveResult({
        exitCode: null,
        timedOut,
        stdout: stdout.join(''),
        stderr: `${stderr.join('')}${error.message}`,
        durationMs: Date.now() - startedAt
      })
    })
    child.on('close', (exitCode: number | null) => {
      if (settled) return
      settled = true
      resolveResult({
        exitCode,
        timedOut,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        durationMs: Date.now() - startedAt
      })
    })
    const timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs)
    child.once('close', () => clearTimeout(timer))
  })
}

async function runGit(cwd: string, args: readonly string[], timeoutMs = 30_000): Promise<string> {
  const result = await runProcess('git', args, {
    cwd,
    timeoutMs,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })
  if (result.exitCode !== 0 || result.timedOut) {
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
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_DATE: fixedDate,
      GIT_COMMITTER_DATE: fixedDate
    }
  })
  if (commit.exitCode !== 0 || commit.timedOut) {
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
    env: { ...process.env, CI: '1', NODE_ENV: 'test' }
  })
  return {
    passed: !processResult.timedOut && processResult.exitCode === oracle.expectedExitCode,
    exitCode: processResult.exitCode,
    timedOut: processResult.timedOut,
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
