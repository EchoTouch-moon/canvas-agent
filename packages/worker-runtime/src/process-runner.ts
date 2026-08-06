import { spawn } from 'node:child_process'
import { CommandDeniedError } from './errors'

export interface RunCommandOptions {
  argv: readonly string[]
  cwd: string
  timeoutMs: number
  maxOutputBytes: number
  commandAllowlist: readonly string[]
  signal: AbortSignal | undefined
  env: Record<string, string> | undefined
}

export interface RunCommandResult {
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  timedOut: boolean
  cancelled: boolean
  outputTruncated: boolean
  durationMs: number
}

const GRACE_KILL_MS = 250

export async function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  const command = options.argv[0]
  if (command === undefined) {
    throw new CommandDeniedError('<empty argv>')
  }
  if (!options.commandAllowlist.includes(command)) {
    throw new CommandDeniedError(command)
  }

  const args = options.argv.slice(1)
  const child = spawn(command, args, {
    cwd: options.cwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: { ...process.env, ...options.env },
    signal: options.signal
  })

  return new Promise<RunCommandResult>((resolve, reject) => {
    const startedAt = Date.now()
    let stdout = ''
    let stderr = ''
    let outputTruncated = false
    let settled = false

    const finish = (result: RunCommandResult): void => {
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
      if (outputTruncated) {
        return
      }
      const text = buffer.toString('utf8')
      const remaining = options.maxOutputBytes - stdout.length
      if (text.length > remaining) {
        stdout += text.slice(0, Math.max(0, remaining))
        outputTruncated = true
      } else {
        stdout += text
      }
    }

    const onStderr = (buffer: Buffer): void => {
      if (outputTruncated) {
        return
      }
      const text = buffer.toString('utf8')
      const remaining = options.maxOutputBytes - stderr.length
      if (text.length > remaining) {
        stderr += text.slice(0, Math.max(0, remaining))
        outputTruncated = true
      } else {
        stderr += text
      }
    }

    const timer = setTimeout(() => {
      killProcessTree(child.pid)
      finish({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut: true,
        cancelled: options.signal?.aborted ?? false,
        outputTruncated,
        durationMs: Date.now() - startedAt
      })
    }, options.timeoutMs)

    child.stdout.on('data', onStdout)
    child.stderr.on('data', onStderr)

    child.on('error', (error) => {
      if (options.signal?.aborted) {
        finish({
          exitCode: null,
          signal: null,
          stdout,
          stderr,
          timedOut: false,
          cancelled: true,
          outputTruncated,
          durationMs: Date.now() - startedAt
        })
        return
      }
      fail(error)
    })

    child.on('close', (code, signal) => {
      if (options.signal?.aborted && !settled) {
        finish({
          exitCode: code,
          signal,
          stdout,
          stderr,
          timedOut: false,
          cancelled: true,
          outputTruncated,
          durationMs: Date.now() - startedAt
        })
        return
      }
      finish({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut: false,
        cancelled: options.signal?.aborted ?? false,
        outputTruncated,
        durationMs: Date.now() - startedAt
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
