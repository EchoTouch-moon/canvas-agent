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

function truncate(text: string, maxBytes: number): { content: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { content: text, truncated: false }
  }
  let content = ''
  for (const chunk of text) {
    if (Buffer.byteLength(content + chunk, 'utf8') > maxBytes) {
      break
    }
    content += chunk
  }
  return { content, truncated: true }
}

/**
 * Provider-neutral local CLI process boundary (PROPOSAL-028). Uses argv arrays
 * and `shell: false` only, confines cwd to the isolated worktree, writes the
 * prompt via stdin (never interpolated into a shell string), applies the caller's
 * explicit environment allowlist verbatim, bounds stdout/stderr independently,
 * and terminates the whole process tree on AbortSignal or deadline, returning a
 * distinguishable cancelled/timedOut evidence for the adapter.
 */
export async function runLocalCli(invocation: LocalCliInvocation): Promise<LocalCliResult> {
  const startedAt = new Date().toISOString()
  const child = spawn(invocation.executable, [...invocation.argv], {
    cwd: invocation.cwd,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: { ...invocation.environment },
    signal: invocation.signal
  })

  return new Promise<LocalCliResult>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let settled = false
    let wroteStdin = false

    const finish = (result: LocalCliResult): void => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
    }
    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(error)
      }
    }

    const onStdout = (buffer: Buffer): void => {
      if (stdoutTruncated) return
      const piece = truncate(stdout + buffer.toString('utf8'), invocation.maxStdoutBytes)
      stdout = piece.content
      stdoutTruncated = piece.truncated
    }
    const onStderr = (buffer: Buffer): void => {
      if (stderrTruncated) return
      const piece = truncate(stderr + buffer.toString('utf8'), invocation.maxStderrBytes)
      stderr = piece.content
      stderrTruncated = piece.truncated
    }

    const timer = setTimeout(() => {
      killProcessTree(child.pid)
      finish({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        startedAt,
        finishedAt: new Date().toISOString(),
        timedOut: true,
        cancelled: invocation.signal?.aborted ?? false
      })
    }, invocation.timeoutMs)

    child.stdout.on('data', onStdout)
    child.stderr.on('data', onStderr)

    child.on('error', (error) => {
      if (invocation.signal?.aborted) {
        finish({
          exitCode: null,
          signal: null,
          stdout,
          stderr,
          stdoutTruncated,
          stderrTruncated,
          startedAt,
          finishedAt: new Date().toISOString(),
          timedOut: false,
          cancelled: true
        })
        return
      }
      fail(
        new LocalCliSpawnError(
          (error as NodeJS.ErrnoException).code ?? 'SPAWN_ERROR',
          error.message,
          error
        )
      )
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
      const cancelled = invocation.signal?.aborted ?? false
      finish({
        exitCode: code,
        signal,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        startedAt,
        finishedAt: new Date().toISOString(),
        timedOut: false,
        cancelled
      })
    })
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
