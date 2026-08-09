import { spawn } from 'node:child_process'
import { LocalCliSpawnError } from './errors'

export interface LocalCliInvocation {
  executable: string
  argv: readonly string[]
  cwd: string
  stdin?: string
  timeoutMs: number
  maxStdoutBytes: number
  maxStderrBytes: number
  environment: Readonly<Record<string, string>>
  signal?: AbortSignal
}

export interface LocalCliResult {
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  startedAt: string
  finishedAt: string
  timedOut: boolean
  cancelled: boolean
}

const GRACE_KILL_MS = 250
const TERMINATE_BOUND_MS = GRACE_KILL_MS + 250

interface OutputAccumulator {
  chunks: Buffer[]
  bytes: number
  truncated: boolean
}

function appendChunk(chunk: Buffer, cap: number, acc: OutputAccumulator): void {
  if (acc.truncated) {
    return
  }
  const remaining = cap - acc.bytes
  if (remaining <= 0) {
    acc.truncated = true
    return
  }
  if (chunk.length > remaining) {
    acc.chunks.push(chunk.subarray(0, remaining))
    acc.bytes += remaining
    acc.truncated = true
    return
  }
  acc.chunks.push(chunk)
  acc.bytes += chunk.length
}

/**
 * Provider-neutral local CLI process boundary (PROPOSAL-028). Uses argv arrays
 * and `shell: false` only, confines cwd to the isolated worktree, writes the
 * prompt via stdin (never interpolated into a shell string), applies the caller's
 * explicit environment allowlist verbatim, bounds stdout/stderr independently by
 * byte while buffering and decoding UTF-8 once at the end (multi-byte characters
 * split across pipe chunks are preserved), and routes abort and deadline through
 * one explicit process-group shutdown state machine that kills the whole tree and
 * resolves only after `close` or a bounded forced termination.
 *
 * First termination reason wins: `timedOut` and `cancelled` are mutually
 * exclusive. A pre-aborted signal returns a cancelled result without spawning.
 */
export async function runLocalCli(invocation: LocalCliInvocation): Promise<LocalCliResult> {
  if (invocation.signal?.aborted) {
    return {
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      timedOut: false,
      cancelled: true
    }
  }

  const startedAt = new Date().toISOString()
  const stdoutAcc: OutputAccumulator = { chunks: [], bytes: 0, truncated: false }
  const stderrAcc: OutputAccumulator = { chunks: [], bytes: 0, truncated: false }

  // The runner owns process-group termination; AbortSignal is handled through
  // the explicit shutdown state machine rather than passed to spawn.
  const child = spawn(invocation.executable, [...invocation.argv], {
    cwd: invocation.cwd,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: { ...invocation.environment }
  })

  return new Promise<LocalCliResult>((resolve, reject) => {
    type Termination = { cancelled: boolean; timedOut: boolean } | null
    let state: 'running' | 'terminating' | 'settled' = 'running'
    let termination: Termination = null
    let settled = false
    let wroteStdin = false
    let forcedTimer: NodeJS.Timeout | null = null

    const decodeStdout = (): string => Buffer.concat(stdoutAcc.chunks).toString('utf8')
    const decodeStderr = (): string => Buffer.concat(stderrAcc.chunks).toString('utf8')

    const finish = (result: LocalCliResult): void => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        if (forcedTimer !== null) {
          clearTimeout(forcedTimer)
          forcedTimer = null
        }
        resolve(result)
      }
    }
    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        if (forcedTimer !== null) {
          clearTimeout(forcedTimer)
          forcedTimer = null
        }
        reject(error)
      }
    }

    const baseResult = (exitCode: number | null, signal: string | null): Omit<LocalCliResult, 'timedOut' | 'cancelled'> => ({
      exitCode,
      signal,
      stdout: decodeStdout(),
      stderr: decodeStderr(),
      stdoutTruncated: stdoutAcc.truncated,
      stderrTruncated: stderrAcc.truncated,
      startedAt,
      finishedAt: new Date().toISOString()
    })

    const terminate = (reason: { cancelled: boolean; timedOut: boolean }): void => {
      // First termination reason wins.
      if (state !== 'running') {
        return
      }
      state = 'terminating'
      termination = reason
      killProcessTree(child.pid)
      // Resolve once the SIGTERM -> SIGKILL grace has completed if the child has
      // not already emitted `close` (bounded forced termination).
      forcedTimer = setTimeout(() => {
        if (!settled) {
          finish({
            ...baseResult(null, null),
            timedOut: reason.timedOut,
            cancelled: reason.cancelled
          })
        }
      }, TERMINATE_BOUND_MS)
    }

    const timer = setTimeout(() => {
      terminate({ cancelled: false, timedOut: true })
    }, invocation.timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      appendChunk(chunk, invocation.maxStdoutBytes, stdoutAcc)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      appendChunk(chunk, invocation.maxStderrBytes, stderrAcc)
    })

    child.on('error', (error) => {
      if (state === 'terminating') {
        finish({
          ...baseResult(null, null),
          timedOut: termination?.timedOut ?? false,
          cancelled: termination?.cancelled ?? false
        })
        return
      }
      fail(new LocalCliSpawnError((error as NodeJS.ErrnoException).code ?? 'SPAWN_ERROR', error.message, error))
    })

    child.on('spawn', () => {
      if (invocation.stdin !== undefined) {
        wroteStdin = true
        child.stdin.on('error', () => {
          // stdin may be closed early by a CLI that never reads it
        })
        child.stdin.write(invocation.stdin, 'utf8', () => {
          child.stdin.end()
        })
      }
    })

    child.on('close', (code, signal) => {
      if (wroteStdin) {
        try {
          child.stdin.end()
        } catch {
          // already closed
        }
      }
      if (state === 'terminating') {
        finish({
          ...baseResult(code, signal),
          timedOut: termination?.timedOut ?? false,
          cancelled: termination?.cancelled ?? false
        })
        return
      }
      state = 'settled'
      finish({ ...baseResult(code, signal), timedOut: false, cancelled: false })
    })

    if (invocation.signal !== undefined) {
      invocation.signal.addEventListener(
        'abort',
        () => {
          terminate({ cancelled: true, timedOut: false })
        },
        { once: true }
      )
    }
  })
}

function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) {
    return
  }
  if (process.platform === 'win32') {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // process already gone
    }
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    // process group already gone
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // process group already gone
    }
  }, GRACE_KILL_MS).unref()
}
