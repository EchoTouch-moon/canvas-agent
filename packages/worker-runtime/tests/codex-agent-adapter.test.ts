import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecutionContextBundleV2, ExecutionContextItemV2 } from '@canvas-agent/contracts'
import {
  AGENT_AUTH_REQUIRED,
  AGENT_EXECUTABLE_NOT_FOUND,
  AGENT_OUTPUT_INVALID,
  AGENT_OUTPUT_LIMIT_EXCEEDED,
  AGENT_PROCESS_FAILED,
  AGENT_TIMED_OUT,
  AGENT_VERSION_UNSUPPORTED,
  BudgetExceededError,
  CancelledError,
  LocalCliError,
  buildPrompt,
  createCodexAgentAdapter,
  computeExecutionContextBundle,
  type AgentContext
} from '../src'

const NODE_DIR = dirname(process.execPath)

async function makeScript(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ca-codex-adapter-'))
  const file = join(dir, 'codex')
  await writeFile(file, `#!/usr/bin/env node\n${body}`, 'utf8')
  await chmod(file, 0o755)
  return file
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function bundle(): ExecutionContextBundleV2 {
  const instruction: ExecutionContextItemV2 = {
    position: 0,
    itemType: 'USER_INPUT',
    sourceRef: 'task://spec_1',
    resolvedContent: 'Add a feature file',
    contentHash: sha256('Add a feature file'),
    authority: 'TASK_INSTRUCTION',
    priority: 'P0',
    tokenEstimate: 5
  }
  const computed = computeExecutionContextBundle([instruction])
  return { items: [instruction], totalBytes: computed.totalBytes, contentHash: computed.contentHash }
}

function makeContext(
  cwd: string,
  runtimeDir: string,
  overrides: Partial<AgentContext> = {}
): AgentContext {
  return {
    cwd,
    toolPolicy: {
      allowedTools: ['write_file', 'run_command'],
      deniedPaths: [],
      allowNetwork: false,
      allowShell: true
    },
    maxToolCalls: 100,
    maxDurationMs: 30_000,
    commandAllowlist: ['git', 'node'],
    executionRequestId: 'exec-1',
    agentConfiguration: { provider: 'codex-cli', model: 'configured-by-user' },
    contextBundle: bundle(),
    ...overrides
  }
}

function adapter(executable: string, runtimeDir: string) {
  return createCodexAgentAdapter({
    executable,
    environment: { PATH: `${NODE_DIR}:/usr/bin:/bin`, HOME: tmpdir() },
    runtimeDirectory: runtimeDir
  })
}

const SUCCESS_SCRIPT = `
if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
const fs=require('node:fs');const path=require('node:path')
const cdIdx=process.argv.indexOf('--cd');const cwd=process.argv[cdIdx+1]
fs.writeFileSync(path.join(cwd,'feature.txt'),'added\\n')
const summary={summary:'added feature.txt',changes:[{file:'feature.txt',change_type:'created',description:'add'}],tool_calls_observed:1,tests_run:[],success:true}
const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n')
out({type:'thread.started',thread_id:'thr_1'})
out({type:'turn.started'})
out({type:'item.completed',item:{id:'item_1',type:'command_execution',command:'touch',aggregated_output:'',exit_code:0,status:'completed'}})
out({type:'item.completed',item:{id:'item_2',type:'agent_message',text:JSON.stringify(summary)}})
out({type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:5,reasoning_output_tokens:0}})
`

const clean: string[] = []
afterEach(async () => {
  await Promise.all(
    clean.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined))
  )
})

describe('createCodexAgentAdapter', () => {
  it('runs a fake codex and returns the schema-conforming summary with transport diagnostics', async () => {
    const script = await makeScript(SUCCESS_SCRIPT)
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    const result = await adapter(script, runtime).run(makeContext(cwd, runtime))

    const parsed = JSON.parse(result.text) as { summary: string }
    expect(parsed.summary).toBe('added feature.txt')
    const transport = JSON.parse(
      (result.artifacts.find((a) => a.fileName === 'transport.json') as { content: string }).content
    ) as { version: string; exitCode: number; toolCallCount: number }
    expect(transport.version).toBe('codex-cli 0.146.0')
    expect(transport.exitCode).toBe(0)
    expect(transport.toolCallCount).toBe(1)
  })

  it('maps an unsupported version to AGENT_VERSION_UNSUPPORTED', async () => {
    const script = await makeScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.147.0\\n'); process.exit(0) }`
    )
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    await expect(adapter(script, runtime).run(makeContext(cwd, runtime))).rejects.toMatchObject({
      code: AGENT_VERSION_UNSUPPORTED
    })
  })

  it('maps a missing executable to AGENT_EXECUTABLE_NOT_FOUND', async () => {
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    await expect(
      adapter(join(tmpdir(), 'ca-missing-codex-bin'), runtime).run(makeContext(cwd, runtime))
    ).rejects.toMatchObject({ code: AGENT_EXECUTABLE_NOT_FOUND })
  })

  it('maps a non-zero exit without turn.completed to AGENT_PROCESS_FAILED', async () => {
    const script = await makeScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n')
out({type:'thread.started',thread_id:'thr_1'})
out({type:'turn.started'})
out({type:'item.completed',item:{id:'item_1',type:'agent_message',text:'{"summary":"partial","changes":[],"tool_calls_observed":0,"tests_run":[],"success":false}'}})
process.exit(1)`
    )
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    await expect(adapter(script, runtime).run(makeContext(cwd, runtime))).rejects.toMatchObject({
      code: AGENT_PROCESS_FAILED
    })
  })

  it('maps a turn.failed / top-level error to a stable failure', async () => {
    const script = await makeScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n')
out({type:'thread.started',thread_id:'thr_1'})
out({type:'turn.started'})
out({type:'error',message:'boom'})
out({type:'turn.failed',error:{message:'boom'}})`
    )
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    await expect(adapter(script, runtime).run(makeContext(cwd, runtime))).rejects.toMatchObject({
      code: AGENT_PROCESS_FAILED
    })
  })

  it('maps auth-classified stderr to AGENT_AUTH_REQUIRED', async () => {
    const script = await makeScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
process.stderr.write('not logged in: run codex login\\n'); process.exit(1)`
    )
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    await expect(adapter(script, runtime).run(makeContext(cwd, runtime))).rejects.toMatchObject({
      code: AGENT_AUTH_REQUIRED
    })
  })

  it('maps a malformed JSONL line to AGENT_OUTPUT_INVALID', async () => {
    const script = await makeScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
process.stdout.write('{"type":"turn.started"}\\nnot json at all\\n')`
    )
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    await expect(adapter(script, runtime).run(makeContext(cwd, runtime))).rejects.toMatchObject({
      code: AGENT_OUTPUT_INVALID
    })
  })

  it('maps an oversized output to AGENT_OUTPUT_LIMIT_EXCEEDED', async () => {
    const script = await makeScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
process.stdout.write('x'.repeat(300000))`
    )
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    await expect(adapter(script, runtime).run(makeContext(cwd, runtime))).rejects.toMatchObject({
      code: AGENT_OUTPUT_LIMIT_EXCEEDED
    })
  })

  it('maps a timeout to AGENT_TIMED_OUT', async () => {
    const script = await makeScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
setTimeout(()=>{},60000)`
    )
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    await expect(
      adapter(script, runtime).run(makeContext(cwd, runtime, { maxDurationMs: 300 }))
    ).rejects.toMatchObject({ code: AGENT_TIMED_OUT })
  })

  it('maps a worker cancellation to CancelledError', async () => {
    const script = await makeScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
setTimeout(()=>{},60000)`
    )
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)
    const controller = new AbortController()

    const promise = adapter(script, runtime).run(
      makeContext(cwd, runtime, { signal: controller.signal, maxDurationMs: 60_000 })
    )
    setTimeout(() => controller.abort(), 200)
    await expect(promise).rejects.toThrow(CancelledError)
  })

  it('terminates the process tree immediately when the tool budget is exceeded', async () => {
    const script = await makeScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n')
out({type:'thread.started',thread_id:'thr_1'})
out({type:'turn.started'})
for(let i=0;i<50;i++){ out({type:'item.completed',item:{id:'item_'+i,type:'command_execution',command:'c',aggregated_output:'',exit_code:0,status:'completed'}}) }
setTimeout(()=>{},60000)`
    )
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    await expect(
      adapter(script, runtime).run(makeContext(cwd, runtime, { maxToolCalls: 3 }))
    ).rejects.toThrow(BudgetExceededError)
  })

  it('skips known non-tool item types and counts unknown ones conservatively', async () => {
    const script = await makeScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n')
out({type:'turn.started'})
out({type:'item.completed',item:{id:'msg_1',type:'agent_message',text:'{"summary":"x","changes":[],"tool_calls_observed":0,"tests_run":[],"success":true}'}})
out({type:'item.completed',item:{id:'reason_1',type:'reasoning',text:'thinking'}})
out({type:'item.completed',item:{id:'future_1',type:'future_tool_v9',payload:{}}})
out({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}})`
    )
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    const result = await adapter(script, runtime).run(
      makeContext(cwd, runtime, { maxToolCalls: 1 })
    )
    const transport = JSON.parse(
      (result.artifacts.find((a) => a.fileName === 'transport.json') as { content: string }).content
    ) as { toolCallCount: number }
    // unknown future_tool_v9 counts once; agent_message + reasoning do not.
    expect(transport.toolCallCount).toBe(1)
    expect(JSON.parse(result.text).summary).toBe('x')
  })

  it('selects the last qualified agent_message as the final response', async () => {
    const script = await makeScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n')
out({type:'turn.started'})
out({type:'item.completed',item:{id:'m1',type:'agent_message',text:'{"summary":"first","changes":[],"tool_calls_observed":0,"tests_run":[],"success":true}'}})
out({type:'item.completed',item:{id:'m2',type:'agent_message',text:'{"summary":"second","changes":[],"tool_calls_observed":0,"tests_run":[],"success":true}'}})
out({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}})`
    )
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    const result = await adapter(script, runtime).run(makeContext(cwd, runtime))
    expect(JSON.parse(result.text).summary).toBe('second')
  })

  it('builds a prompt that preserves bundle position order', () => {
    const b = bundle()
    const prompt = buildPrompt('exec-1', b.items, '/wt')
    expect(prompt).toContain('position=0')
    expect(prompt.indexOf('position=0')).toBeLessThan(prompt.indexOf('Final output requirements'))
  })

  it('rejects when no context bundle is provided', async () => {
    const script = await makeScript(SUCCESS_SCRIPT)
    clean.push(dirname(script))
    const runtime = await mkdtemp(join(tmpdir(), 'ca-ca-runtime-'))
    clean.push(runtime)
    const cwd = await mkdtemp(join(tmpdir(), 'ca-ca-worktree-'))
    clean.push(cwd)

    await expect(
      adapter(script, runtime).run(makeContext(cwd, runtime, { contextBundle: undefined }))
    ).rejects.toMatchObject({ code: AGENT_OUTPUT_INVALID })
  })
})
