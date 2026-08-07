import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecutionRequestContract } from '@canvas-agent/contracts'
import {
  activateBaseline,
  applyMigrations,
  closeDatabase,
  createBaselineDraft,
  createNode,
  createProject,
  createTask,
  freezeContextSnapshot,
  openDatabase,
  publishNodeVersion,
  publishTaskSpecVersion,
  upsertRepositoryRevision
} from '@canvas-agent/persistence'
import {
  FixtureAgentAdapter,
  ISOLATED_GIT_ENV,
  computeRequestHash,
  createInMemoryClaimStore,
  createWorker,
  readRepositoryRevision,
  runCommand
} from '../src'

const ALLOWLIST = ['git', 'node']

const FUTURE = '2099-01-01T00:00:00.000Z'

function fail(message: string): never {
  console.error(`\n✗ SMOKE FAILED: ${message}`)
  process.exit(1)
}

function check(condition: boolean, message: string): void {
  if (!condition) fail(message)
  console.log(`  ✓ ${message}`)
}

async function git(repoPath: string, args: readonly string[]): Promise<string> {
  const result = await runCommand({
    argv: ['git', ...args],
    cwd: repoPath,
    timeoutMs: 30_000,
    maxOutputBytes: 2 * 1024 * 1024,
    commandAllowlist: ['git'],
    signal: undefined,
    env: ISOLATED_GIT_ENV
  })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.exitCode}): ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

async function main(): Promise<void> {
  console.log('Canvas Agent — core-loop smoke (persistence + worker-runtime)\n')

  const repoDir = await mkdtemp(join(tmpdir(), 'ca-smoke-repo-'))
  const runtimeDir = await mkdtemp(join(tmpdir(), 'ca-smoke-runtime-'))
  try {
    await git(repoDir, ['init', '-b', 'main'])
    await git(repoDir, ['config', 'user.name', 'Smoke'])
    await git(repoDir, ['config', 'user.email', 'smoke@canvas-agent.local'])
    await writeFile(join(repoDir, 'README.md'), '# smoke repository\n')
    await git(repoDir, ['add', '-A'])
    await git(repoDir, ['commit', '-m', 'initial commit'])
    const baseCommit = await git(repoDir, ['rev-parse', 'HEAD'])
    console.log(`[1/6] 创建临时 git 仓库          ${baseCommit.slice(0, 8)}`)

    const p = openDatabase({ path: ':memory:' })
    applyMigrations(p)

    createProject(p, { id: 'proj_smoke', name: 'Smoke Project' })
    createNode(p, { id: 'node_smoke', projectId: 'proj_smoke', type: 'REQUIREMENT' })
    const version = publishNodeVersion(p, {
      id: 'nv_smoke',
      nodeId: 'node_smoke',
      title: 'Smoke requirement',
      body: 'Enable one worker run from a frozen snapshot.'
    })
    createTask(p, { id: 'task_smoke', projectId: 'proj_smoke', type: 'IMPLEMENT_CHANGE', title: 'Smoke task' })
    const spec = publishTaskSpecVersion(p, {
      id: 'spec_smoke',
      taskId: 'task_smoke',
      description: 'Run the worker against the smoke repository.',
      scope: 'packages/worker-runtime',
      criteria: [{ description: 'worker returns a patch', position: 0 }]
    }).spec
    console.log(`[2/6] 持久化：Project/Node/Task/Spec   spec=${spec.id}`)

    const actual = await readRepositoryRevision(repoDir, {
      cwd: repoDir,
      timeoutMs: 30_000,
      maxOutputBytes: 2 * 1024 * 1024,
      commandAllowlist: ALLOWLIST,
      signal: undefined
    })
    const revision = upsertRepositoryRevision(p, {
      id: 'rev_smoke',
      baseCommit: actual.baseCommit,
      treeHash: actual.treeHash,
      workingTreePatchHash: actual.workingTreePatchHash
    })

    createBaselineDraft(p, {
      id: 'baseline_smoke',
      projectId: 'proj_smoke',
      name: 'Smoke 0.1',
      nodeVersionIds: [version.id]
    })
    activateBaseline(p, { baselineId: 'baseline_smoke' })
    const frozen = freezeContextSnapshot(p, {
      id: 'snap_smoke',
      projectId: 'proj_smoke',
      taskId: 'task_smoke',
      taskSpecVersionId: spec.id,
      baseBaselineId: 'baseline_smoke',
      expectedRepositoryRevisionId: revision.id,
      items: [
        {
          itemType: 'NODE_VERSION',
          sourceRef: 'node://nv_smoke',
          resolvedContent: version.body,
          authority: 'TASK_INSTRUCTION',
          priority: 'P0',
          tokenEstimate: 120,
          position: 0
        }
      ]
    })
    console.log(`[3/6] 冻结上下文快照               ${frozen.snapshot.id} @ ${revision.id}`)

    const requestWithoutHash: Omit<ExecutionRequestContract, 'requestHash'> = {
      executionRequestId: 'req_smoke_001',
      runId: 'run_smoke_001',
      workerAttemptNumber: 1,
      taskSpecVersionId: spec.id,
      contextSnapshotId: frozen.snapshot.id,
      expectedRepositoryRevision: {
        baseCommit: revision.baseCommit,
        treeHash: revision.treeHash,
        workingTreePatchHash: revision.workingTreePatchHash
      },
      checkpointId: null,
      requiredCapabilities: ['git', 'node'],
      agentConfiguration: { provider: 'fixture', model: 'deterministic' },
      toolPolicy: {
        allowedTools: ['write_file', 'run_command'],
        deniedPaths: ['secrets.env'],
        allowNetwork: false,
        allowShell: true
      },
      workspaceStrategy: 'ISOLATED_WORKTREE',
      resourceBudget: {
        maxDurationMs: 30_000,
        maxToolCalls: 20,
        maxDiskBytes: 1_000_000_000
      },
      schemaVersion: 1,
      expiresAt: FUTURE
    }
    const request: ExecutionRequestContract = {
      ...requestWithoutHash,
      requestHash: computeRequestHash(requestWithoutHash)
    }
    console.log(`[4/6] ExecutionRequest               requestHash=${request.requestHash.slice(0, 16)}…`)

    const worker = createWorker({
      runtimeDirectory: runtimeDir,
      sourceRepositoryPath: repoDir,
      capabilities: ['git', 'node'],
      claimStore: createInMemoryClaimStore(),
      commandAllowlist: ALLOWLIST,
      verificationCommands: [
        ['node', '-e', 'process.exit(require("fs").existsSync("docs/smoke.md") ? 0 : 1)']
      ],
      agent: new FixtureAgentAdapter({
        steps: [
          { kind: 'appendFile', file: 'docs/smoke.md', lines: ['# smoke', 'written by fixture'] }
        ],
        summary: 'smoke: wrote docs/smoke.md'
      })
    })

    const result = await worker.dispatch({ request })
    console.log(`[5/6] Worker 执行                   outcome=${result.outcome}`)

    check(result.outcome === 'SUCCEEDED', '运行成功（SUCCEEDED）')
    check(result.patch !== undefined && result.patch.includes('docs/smoke.md'), 'patch 包含 docs/smoke.md')
    check(result.patchHash !== undefined && /^[a-f0-9]{64}$/.test(result.patchHash), 'patchHash 为 SHA-256')
    check(result.verificationResults?.[0]?.exitCode === 0, '验证命令退出码为 0')
    console.log(`[6/6] 产物：${(result.artifacts ?? []).map((a) => `${a.kind}(${a.sizeBytes}B)`).join(', ')}`)

    console.log('\n✓ CORE LOOP SMOKE PASSED — persistence froze the contract, the isolated worker executed it.')
    closeDatabase(p)
  } catch (error) {
    console.error('\n✗ SMOKE FAILED:', error instanceof Error ? error.message : error)
    process.exit(1)
  } finally {
    await rm(repoDir, { recursive: true, force: true }).catch(() => undefined)
    await rm(runtimeDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

void main()
