import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { ExecutionContextItemV2, ExecutionRequestContractV2 } from '@canvas-agent/contracts'
import {
  FixtureAgentAdapter,
  computeExecutionContextBundle,
  computeRequestHash,
  createCodexAgentAdapter,
  createWorker,
  type DispatchResult
} from '../src'
import {
  TEST_ALLOWLIST,
  cleanupTempDirs,
  createTempGitRepo,
  git,
  requestForRepo,
  type TempRepo
} from './helpers'

async function runtimeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ca-runtime-'))
}

function buildV2Request(
  repo: TempRepo,
  agentConfiguration: { provider: string; model: string } = { provider: 'fixture', model: 'deterministic' },
  resourceBudget?: { maxDurationMs: number; maxToolCalls: number; maxDiskBytes: number }
): ExecutionRequestContractV2 {
  const sha = (content: string): string =>
    createHash('sha256').update(content, 'utf8').digest('hex')
  const instruction: ExecutionContextItemV2 = {
    position: 0,
    itemType: 'USER_INPUT',
    sourceRef: 'task://spec_1',
    resolvedContent: 'Make the change',
    contentHash: sha('Make the change'),
    authority: 'TASK_INSTRUCTION',
    priority: 'P0',
    tokenEstimate: 5
  }
  const computed = computeExecutionContextBundle([instruction])
  const base = {
    ...requestForRepo(repo),
    agentConfiguration,
    resourceBudget: resourceBudget ?? { maxDurationMs: 30_000, maxToolCalls: 20, maxDiskBytes: 1_000_000_000 },
    schemaVersion: 2 as const,
    contextBundle: {
      items: [instruction],
      totalBytes: computed.totalBytes,
      contentHash: computed.contentHash
    }
  }
  const { requestHash: _requestHash, ...rest } = base
  void _requestHash
  return { ...rest, requestHash: computeRequestHash(rest) }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readdir(path)
    return true
  } catch {
    return false
  }
}

describe('worker dispatch against a temporary git repository', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('executes in an isolated worktree and returns patch, verification data and summary hashes', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const request = requestForRepo(repo)
    const agent = new FixtureAgentAdapter({
      steps: [{ kind: 'appendFile', file: 'docs/change.md', lines: ['# Change', 'made by fixture'] }],
      summary: 'wrote docs/change.md'
    })
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [
        ['node', '-e', 'process.exit(require("fs").existsSync("docs/change.md") ? 0 : 1)']
      ],
      agent
    })

    const result = await worker.dispatch({ request })

    expect(result.outcome).toBe('SUCCEEDED')
    expect(result.claimGranted).toBe(true)
    expect(result.patch).toBeDefined()
    expect(result.patch).toContain('docs/change.md')
    expect(result.patchHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.verificationResults).toHaveLength(2)
    expect(result.verificationResults?.[0]).toMatchObject({
      argv: ['git', 'diff', '--cached', '--check'],
      exitCode: 0
    })
    expect(result.verificationResults?.[1]?.exitCode).toBe(0)
    expect(result.agentSummary).toBe('wrote docs/change.md')
    expect(result.artifacts?.some((artifact) => artifact.kind === 'PATCH')).toBe(true)
    expect(result.artifacts?.some((artifact) => artifact.kind === 'TEST_RESULT')).toBe(true)

    const patchArtifact = result.artifacts?.find((artifact) => artifact.kind === 'PATCH')
    if (patchArtifact === undefined) {
      throw new Error('expected a PATCH artifact')
    }
    const written = await readFile(
      join(runtime, 'artifacts', request.executionRequestId, patchArtifact.fileName),
      'utf8'
    )
    expect(written).toContain('docs/change.md')

    expect(await pathExists(join(runtime, 'worktrees', request.executionRequestId))).toBe(false)
    expect(existsSync(join(repo.dir, 'docs', 'change.md'))).toBe(false)
  })

  it('only one claim succeeds for the same execution request', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const agent = new FixtureAgentAdapter({ steps: [], summary: 'idle' })
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent
    })
    const request = requestForRepo(repo)

    const first = await worker.dispatch({ request })
    const second = await worker.dispatch({ request })

    expect(first.outcome).toBe('SUCCEEDED')
    expect(second.outcome).toBe('CLAIM_REJECTED')
    expect(second.claimGranted).toBe(false)
  })

  it('reports a repository revision mismatch without touching the original repository', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
    })
    const staleRequest = requestForRepo(repo)

    await writeFile(join(repo.dir, 'README.md'), '# test repository\nchanged by another author\n')
    await git(repo.dir, ['commit', '-am', 'external change'])

    const result = await worker.dispatch({ request: staleRequest })
    expect(result.outcome).toBe('REVISION_MISMATCH')
    expect(result.revisionMismatch?.field).toBe('baseCommit')
    expect(await pathExists(join(runtime, 'worktrees'))).toBe(false)
  })

  it('stops a timed-out verification process tree and returns bounded partial evidence', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [['node', '-e', 'setTimeout(() => {}, 30_000)']],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' }),
      gitTimeoutMs: 30_000
    })
    const started = Date.now()

    const result = await worker.dispatch({
      request: requestForRepo(repo, {
        resourceBudget: { maxDurationMs: 600, maxToolCalls: 5, maxDiskBytes: 100_000_000 }
      })
    })

    expect(result.outcome).toBe('PARTIAL')
    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(result.verificationResults?.[0]).toMatchObject({
      argv: ['git', 'diff', '--cached', '--check']
    })
    expect(result.verificationResults?.[1]?.timedOut).toBe(true)
    expect(result.artifacts?.some((artifact) => artifact.kind === 'AGENT_PARTIAL')).toBe(true)
    expect(result.recovery?.state).toBe('interrupted')
  })

  it('returns explicit partial evidence when an adapter action is denied', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const agent = new FixtureAgentAdapter({
      steps: [{ kind: 'appendFile', file: '../escape.txt', lines: ['nope'] }],
      summary: 'attempting escape'
    })
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent
    })

    const result = await worker.dispatch({ request: requestForRepo(repo) })

    expect(result.outcome).toBe('PARTIAL')
    expect(result.rejectionReason).toContain('denied')
    expect(result.artifacts?.some((artifact) => artifact.kind === 'AGENT_PARTIAL')).toBe(true)
    expect(result.recovery?.state).toBe('interrupted')
  })

  it('a frozen logical wall clock cannot freeze the elapsed budget', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [['true']],
      now: () => '2030-01-01T00:00:00.000Z',
      agent: new FixtureAgentAdapter({
        steps: [{ kind: 'runCommand', argv: ['node', '-e', 'setTimeout(() => {}, 100)'] }],
        summary: 'busy'
      })
    })

    const result = await worker.dispatch({
      request: requestForRepo(repo, {
        expiresAt: '2099-01-01T00:00:00.000Z',
        resourceBudget: { maxDurationMs: 1, maxToolCalls: 5, maxDiskBytes: 100_000_000 }
      })
    })

    expect(result.outcome).toBe('PARTIAL')
    expect(result.rejectionReason).toBe('budget exceeded: maxDurationMs')
    expect(result.recovery?.state).toBe('interrupted')
  })

  it('cancels a running dispatch and returns a bounded partial result', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const agent = new FixtureAgentAdapter({
      steps: [{ kind: 'runCommand', argv: ['node', '-e', 'setTimeout(() => {}, 30_000)'] }],
      summary: 'busy'
    })
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent,
      gitTimeoutMs: 30_000
    })
    const controller = new AbortController()
    const dispatchPromise = worker.dispatch({
      request: requestForRepo(repo, {
        resourceBudget: { maxDurationMs: 30_000, maxToolCalls: 5, maxDiskBytes: 100_000_000 }
      }),
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 300)

    const result = await dispatchPromise
    expect(result.outcome).toBe('CANCELLED')
    expect(result.artifacts?.some((artifact) => artifact.kind === 'AGENT_PARTIAL')).toBe(true)
  })

  it('converges a preflight cancellation to CANCELLED regardless of phase', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
    })
    const controller = new AbortController()
    controller.abort()

    const result = await worker.dispatch({
      request: requestForRepo(repo, {
        resourceBudget: { maxDurationMs: 30_000, maxToolCalls: 5, maxDiskBytes: 100_000_000 }
      }),
      signal: controller.signal
    })

    expect(result.outcome).toBe('CANCELLED')
    expect(result.claimGranted).toBe(true)
    expect(await pathExists(join(runtime, 'worktrees'))).toBe(false)
  })

  it('rejects a dirty expected revision before any claim or worktree', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
    })

    const result = await worker.dispatch({
      request: requestForRepo(repo, {
        expectedRepositoryRevision: {
          baseCommit: repo.baseCommit,
          treeHash: repo.treeHash,
          workingTreePatchHash: 'c'.repeat(64)
        }
      })
    })

    expect(result.outcome).toBe('VALIDATION_REJECTED')
    expect(result.claimGranted).toBe(false)
    expect(result.rejectionReason).toContain('DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED')
    expect(await pathExists(join(runtime, 'worktrees'))).toBe(false)
  })

  it('dispatches a valid v2 request with a context bundle through the fixture', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
    })

    const v2 = buildV2Request(repo)
    const result = await worker.dispatch({ request: v2 })
    expect(result.outcome).toBe('SUCCEEDED')
    expect(result.claimGranted).toBe(true)
  })
})

async function makeCodexScript(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ca-worker-codex-'))
  const file = join(dir, 'codex')
  await writeFile(file, `#!/usr/bin/env node\n${body}`, 'utf8')
  await chmod(file, 0o755)
  return file
}

const FAKE_CODEX_SUCCESS = `
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
out({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}})
`

describe('worker provider selection (DS-005B)', () => {
  it('rejects codex-cli with a v1 request as EXECUTION_CONTEXT_REQUIRED before claim', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
    })

    const result = await worker.dispatch({
      request: requestForRepo(repo, { agentConfiguration: { provider: 'codex-cli', model: 'x' } })
    })
    expect(result.outcome).toBe('VALIDATION_REJECTED')
    expect(result.claimGranted).toBe(false)
    expect(result.rejectionReason).toContain('EXECUTION_CONTEXT_REQUIRED')
    expect(await pathExists(join(runtime, 'worktrees'))).toBe(false)
  })

  it('rejects codex-cli with no launch plan as AGENT_EXECUTABLE_NOT_FOUND before claim', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
    })

    const result = await worker.dispatch({ request: buildV2Request(repo, { provider: 'codex-cli', model: 'configured-by-user' }) })
    expect(result.outcome).toBe('VALIDATION_REJECTED')
    expect(result.claimGranted).toBe(false)
    expect(result.rejectionReason).toContain('AGENT_EXECUTABLE_NOT_FOUND')
    expect(await pathExists(join(runtime, 'worktrees'))).toBe(false)
  })

  it('rejects an unknown provider as AGENT_POLICY_REJECTED before claim', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
    })

    const result = await worker.dispatch({
      request: requestForRepo(repo, { agentConfiguration: { provider: 'claude', model: 'x' } })
    })
    expect(result.outcome).toBe('VALIDATION_REJECTED')
    expect(result.claimGranted).toBe(false)
    expect(result.rejectionReason).toContain('AGENT_POLICY_REJECTED')
    expect(await pathExists(join(runtime, 'worktrees'))).toBe(false)
  })

  it('rejects fixture provider without an injected agent as AGENT_POLICY_REJECTED', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: []
    })

    const result = await worker.dispatch({ request: requestForRepo(repo) })
    expect(result.outcome).toBe('VALIDATION_REJECTED')
    expect(result.claimGranted).toBe(false)
    expect(result.rejectionReason).toContain('AGENT_POLICY_REJECTED')
  })

  it('dispatches codex-cli v2 through a fake codex with the universal check and transport evidence', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const script = await makeCodexScript(FAKE_CODEX_SUCCESS)
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      codexAdapter: createCodexAgentAdapter({
        executable: script,
        environment: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmpdir() },
        runtimeDirectory: runtime
      })
    })

    const result = await worker.dispatch({
      request: buildV2Request(repo, { provider: 'codex-cli', model: 'configured-by-user' })
    })
    expect(result.outcome).toBe('SUCCEEDED')
    expect(result.claimGranted).toBe(true)
    expect(result.patch).toBeDefined()
    expect(result.patch).toContain('feature.txt')
    expect(result.verificationResults?.[0]).toMatchObject({
      argv: ['git', 'diff', '--cached', '--check'],
      exitCode: 0
    })
    const transport = result.artifacts?.find((a) => a.fileName === 'transport.json')
    expect(transport?.kind).toBe('AGENT_SUMMARY')
    expect(result.artifacts?.some((a) => a.kind === 'PATCH')).toBe(true)
  })

  it('rejects an agent-authored commit with AGENT_REPOSITORY_STATE_VIOLATION and no patch', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const script = await makeCodexScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
const fs=require('node:fs');const path=require('node:path');const{execSync}=require('node:child_process')
const cdIdx=process.argv.indexOf('--cd');const cwd=process.argv[cdIdx+1]
fs.writeFileSync(path.join(cwd,'rogue.txt'),'x\\n')
execSync('git add -A && git -c user.name=rogue -c user.email=rogue@x commit -m rogue',{cwd})
const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n')
out({type:'thread.started',thread_id:'thr_1'})
out({type:'turn.started'})
out({type:'item.completed',item:{id:'item_1',type:'agent_message',text:'{"summary":"committed","changes":[],"tool_calls_observed":0,"tests_run":[],"success":true}'}})
out({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}})`
    )
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      codexAdapter: createCodexAgentAdapter({
        executable: script,
        environment: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmpdir() },
        runtimeDirectory: runtime
      })
    })

    const result = await worker.dispatch({
      request: buildV2Request(repo, { provider: 'codex-cli', model: 'configured-by-user' })
    })
    expect(result.outcome).toBe('PARTIAL')
    expect(result.rejectionReason).toContain('AGENT_REPOSITORY_STATE_VIOLATION')
    expect(result.patch).toBeUndefined()
    expect(result.artifacts?.some((a) => a.kind === 'AGENT_PARTIAL')).toBe(true)
  })

  it('persists the stable adapter code as rejectionReason (not provider prose)', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const script = await makeCodexScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n')
out({type:'thread.started',thread_id:'thr_1'})
out({type:'turn.started'})
out({type:'item.completed',item:{id:'item_1',type:'agent_message',text:'{"summary":"x","changes":[],"tool_calls_observed":0,"tests_run":[],"success":false}'}})
process.exit(1)`
    )
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      codexAdapter: createCodexAgentAdapter({
        executable: script,
        environment: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmpdir() },
        runtimeDirectory: runtime
      })
    })

    const result = await worker.dispatch({
      request: buildV2Request(repo, { provider: 'codex-cli', model: 'configured-by-user' })
    })
    expect(result.outcome).toBe('PARTIAL')
    expect(result.rejectionReason).toBe('AGENT_PROCESS_FAILED')
  })

  it('persists AGENT_VERSION_UNSUPPORTED from the dispatch-time version probe', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const script = await makeCodexScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.147.0\\n'); process.exit(0) }`
    )
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      codexAdapter: createCodexAgentAdapter({
        executable: script,
        environment: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmpdir() },
        runtimeDirectory: runtime
      })
    })

    const result = await worker.dispatch({
      request: buildV2Request(repo, { provider: 'codex-cli', model: 'configured-by-user' })
    })
    expect(result.outcome).toBe('PARTIAL')
    expect(result.rejectionReason).toBe('AGENT_VERSION_UNSUPPORTED')
  })

  it('records AGENT_CANCELLED and timedOut correctly for timeout / cancellation', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const script = await makeCodexScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
setTimeout(()=>{},60000)`
    )
    const adapter = createCodexAgentAdapter({
      executable: script,
      environment: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmpdir() },
      runtimeDirectory: runtime
    })

    const timeoutWorker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      codexAdapter: adapter
    })
    const timedOut = await timeoutWorker.dispatch({
      request: buildV2Request(
        repo,
        { provider: 'codex-cli', model: 'configured-by-user' },
        { maxDurationMs: 300, maxToolCalls: 5, maxDiskBytes: 100_000_000 }
      )
    })
    expect(timedOut.outcome).toBe('PARTIAL')
    expect(timedOut.rejectionReason).toBe('AGENT_TIMED_OUT')
    expect(timedOut.timedOut).toBe(true)

    const cancelWorker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      codexAdapter: adapter
    })
    const controller = new AbortController()
    const cancelRequest = buildV2Request(repo, { provider: 'codex-cli', model: 'configured-by-user' })
    const cancelPromise = cancelWorker.dispatch({
      request: cancelRequest,
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 150)
    const cancelled = await cancelPromise
    expect(cancelled.outcome).toBe('CANCELLED')
    expect(cancelled.rejectionReason).toBe('AGENT_CANCELLED')
    expect(cancelled.timedOut).not.toBe(true)
  })

  it('carries bounded transport diagnostics into AGENT_PARTIAL on failure', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const script = await makeCodexScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
process.stderr.write('not logged in: run codex login\\n'); process.exit(1)`
    )
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      codexAdapter: createCodexAgentAdapter({
        executable: script,
        environment: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmpdir() },
        runtimeDirectory: runtime
      })
    })

    const result = await worker.dispatch({
      request: buildV2Request(repo, { provider: 'codex-cli', model: 'configured-by-user' })
    })
    expect(result.outcome).toBe('PARTIAL')
    expect(result.rejectionReason).toBe('AGENT_AUTH_REQUIRED')
    const artifactDir = join(runtime, 'artifacts', (await readdir(join(runtime, 'artifacts')))[0] as string)
    const evidence = JSON.parse(
      await readFile(join(artifactDir, 'partial-evidence.json'), 'utf8')
    ) as { transport?: Record<string, { stderrClass?: string; exitCode?: number | null }> }
    const diagnostics = evidence.transport?.['transport.json']
    expect(diagnostics).toBeDefined()
    expect(diagnostics?.stderrClass).toBe('auth')
    expect('stderr' in (diagnostics ?? {})).toBe(false)
  })

  it('a worktree entry that git cannot stage produces PARTIAL, never an empty success', async () => {
    const repo = await createTempGitRepo()
    const runtime = await runtimeDir()
    const script = await makeCodexScript(
      `if (process.argv[2] === '--version') { process.stdout.write('codex-cli 0.146.0\\n'); process.exit(0) }
const path=require('node:path');const{execSync}=require('node:child_process')
const cdIdx=process.argv.indexOf('--cd');const cwd=process.argv[cdIdx+1]
execSync('mkfifo ' + path.join(cwd,'pipe.fifo'))
const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n')
out({type:'thread.started',thread_id:'thr_1'})
out({type:'turn.started'})
out({type:'item.completed',item:{id:'item_1',type:'agent_message',text:'{"summary":"done","changes":[{"file":"pipe.fifo","change_type":"created","description":"x"}],"tool_calls_observed":0,"tests_run":[],"success":true}'}})
out({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}})`
    )
    const worker = createWorker({
      runtimeDirectory: runtime,
      sourceRepositoryPath: repo.dir,
      capabilities: ['git', 'node'],
      commandAllowlist: TEST_ALLOWLIST,
      verificationCommands: [],
      codexAdapter: createCodexAgentAdapter({
        executable: script,
        environment: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmpdir() },
        runtimeDirectory: runtime
      })
    })

    const result = await worker.dispatch({
      request: buildV2Request(repo, { provider: 'codex-cli', model: 'configured-by-user' })
    })
    expect(result.outcome).toBe('PARTIAL')
    expect(result.rejectionReason).toBe('agent claimed changes but produced an empty patch')
    expect(result.patch).toBe('')
    expect(result.artifacts?.some((a) => a.kind === 'AGENT_PARTIAL')).toBe(true)
  })
})
