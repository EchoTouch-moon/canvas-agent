import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CommandDeniedError, runCommand } from '../src'
import { TEST_ALLOWLIST, cleanupTempDirs } from './helpers'

async function cwd(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ca-cwd-'))
}

describe('safe process runner', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('runs an allowlisted command with argv only and captures output', async () => {
    const dir = await cwd()
    const result = await runCommand({
      argv: ['node', '-e', 'process.stdout.write("hello")'],
      cwd: dir,
      timeoutMs: 5000,
      maxOutputBytes: 64 * 1024,
      commandAllowlist: TEST_ALLOWLIST,
      signal: undefined,
      env: undefined
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello')
    expect(result.timedOut).toBe(false)
  })

  it('refuses a command that is not on the allowlist', async () => {
    const dir = await cwd()
    await expect(
      runCommand({
        argv: ['unknown-binary-xyz', '--flag'],
        cwd: dir,
        timeoutMs: 5000,
        maxOutputBytes: 64 * 1024,
        commandAllowlist: TEST_ALLOWLIST,
        signal: undefined,
        env: undefined
      })
    ).rejects.toThrow(CommandDeniedError)
  })

  it('times out, kills the process tree and reports bounded timing', async () => {
    const dir = await cwd()
    const started = Date.now()
    const result = await runCommand({
      argv: ['node', '-e', 'setTimeout(() => {}, 30_000)'],
      cwd: dir,
      timeoutMs: 400,
      maxOutputBytes: 64 * 1024,
      commandAllowlist: TEST_ALLOWLIST,
      signal: undefined,
      env: undefined
    })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('stops a cancelled process and reports cancellation', async () => {
    const dir = await cwd()
    const controller = new AbortController()
    const promise = runCommand({
      argv: ['node', '-e', 'setTimeout(() => {}, 30_000)'],
      cwd: dir,
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
      commandAllowlist: TEST_ALLOWLIST,
      signal: controller.signal,
      env: undefined
    })
    setTimeout(() => controller.abort(), 200)
    const result = await promise
    expect(result.cancelled).toBe(true)
  })

  it('bounds captured output and marks it truncated', async () => {
    const dir = await cwd()
    const result = await runCommand({
      argv: ['node', '-e', 'process.stdout.write("x".repeat(200_000))'],
      cwd: dir,
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      commandAllowlist: TEST_ALLOWLIST,
      signal: undefined,
      env: undefined
    })
    expect(result.outputTruncated).toBe(true)
    expect(result.stdout.length).toBe(1024)
  })
})
