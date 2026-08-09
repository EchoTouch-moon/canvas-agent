import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LocalCliSpawnError,
  runLocalCli,
  type LocalCliInvocation
} from '../src'

async function makeScript(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ca-cli-'))
  const file = join(dir, 'agent.js')
  await writeFile(file, `#!/usr/bin/env node\n${body}`, 'utf8')
  await chmod(file, 0o755)
  return file
}

function invoke(script: string, overrides: Partial<LocalCliInvocation> = {}): LocalCliInvocation {
  return {
    executable: script,
    argv: [],
    cwd: tmpdir(),
    timeoutMs: 5_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024,
    environment: { HOME: tmpdir(), PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
    ...overrides
  }
}

describe('runLocalCli (provider-neutral boundary)', () => {
  afterEach(async () => {
    await rm(join(tmpdir(), 'ca-cli-*'), { recursive: true, force: true }).catch(() => undefined)
  })

  it('passes argv verbatim and records exit/stdout', async () => {
    const script = await makeScript(
      `process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n')`
    )
    const result = await runLocalCli(
      invoke(script, { argv: ['--cd', '/tmp/wt', '--json', '--sandbox', 'workspace-write'] })
    )
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([
      '--cd',
      '/tmp/wt',
      '--json',
      '--sandbox',
      'workspace-write'
    ])
    expect(result.signal).toBeNull()
  })

  it('writes the prompt via stdin without shell interpolation', async () => {
    const script = await makeScript(
      `let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({len:s.length})))`
    )
    const prompt = 'do it now; rm -rf / $(boom) `touch pwn`\nline2'
    const result = await runLocalCli(invoke(script, { stdin: prompt }))
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout) as { len: number }
    expect(parsed.len).toBe(Buffer.byteLength(prompt, 'utf8'))
  })

  it('argv shell operators cannot create a second command', async () => {
    const script = await makeScript(
      `process.stdout.write(String(process.argv.slice(2).length) + ':' + JSON.stringify(process.argv.slice(2)))`
    )
    const malicious = ['--prompt', 'a; touch pwn $() `id` "quote"', '--flag=2']
    const result = await runLocalCli(invoke(script, { argv: malicious }))
    expect(result.exitCode).toBe(0)
    const [count, argsJson] = result.stdout.split(':')
    expect(Number(count)).toBe(malicious.length)
    expect(JSON.parse(argsJson as string)).toEqual(malicious)
  })

  it('rejects a missing executable with a typed spawn error', async () => {
    await expect(
      runLocalCli(invoke(join(tmpdir(), 'ca-does-not-exist-agent'), {}))
    ).rejects.toThrow(LocalCliSpawnError)
  })

  it('bounds stdout and stderr independently and marks truncation', async () => {
    const script = await makeScript(
      `process.stdout.write('x'.repeat(200000));process.stderr.write('y'.repeat(200000))`
    )
    const result = await runLocalCli(
      invoke(script, { maxStdoutBytes: 1024, maxStderrBytes: 512 })
    )
    expect(result.stdoutTruncated).toBe(true)
    expect(result.stderrTruncated).toBe(true)
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(1024)
    expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThanOrEqual(512)
    expect(result.stdout.startsWith('xxx')).toBe(true)
  })

  it('uses only the explicit environment allowlist, never process.env', async () => {
    const script = await makeScript(
      `process.stdout.write(JSON.stringify({ marker: process.env.CANVAS_AGENT_MARKER ?? null, allowed: process.env.CANVAS_AGENT_ALLOWED ?? null }))`
    )
    process.env['CANVAS_AGENT_MARKER'] = 'SECRET_VALUE'
    try {
      const result = await runLocalCli(
        invoke(script, {
          environment: { CANVAS_AGENT_ALLOWED: 'yes', PATH: process.env['PATH'] ?? '/usr/bin:/bin' }
        })
      )
      const parsed = JSON.parse(result.stdout) as { marker: string | null; allowed: string | null }
      expect(parsed.marker).toBeNull()
      expect(parsed.allowed).toBe('yes')
    } finally {
      delete process.env['CANVAS_AGENT_MARKER']
    }
  })

  it('times out, kills the process tree and reports timedOut (not cancelled)', async () => {
    const script = await makeScript(
      `const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setTimeout(()=>{},60000)']);c.on('exit',()=>process.exit(0));`
    )
    const started = Date.now()
    const result = await runLocalCli(invoke(script, { timeoutMs: 400 }))
    expect(result.timedOut).toBe(true)
    expect(result.cancelled).toBe(false)
    expect(result.exitCode).toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('cancels on AbortSignal and reports cancelled (not timedOut)', async () => {
    const script = await makeScript(`setTimeout(()=>{},60000)`)
    const controller = new AbortController()
    const promise = runLocalCli(invoke(script, { signal: controller.signal, timeoutMs: 30_000 }))
    setTimeout(() => controller.abort(), 300)
    const result = await promise
    expect(result.cancelled).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBeNull()
  })
})
