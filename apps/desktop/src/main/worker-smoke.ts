import type { ExecutionRequestContract } from '@canvas-agent/contracts'
import { computeRequestHash } from '@canvas-agent/worker-runtime'
import type { AppConfig } from './config'
import { GitRevisionReader } from './git-revision-reader'
import type { WorkerHost } from './worker-host'

const FUTURE = '2099-01-01T00:00:00.000Z'

export async function runWorkerSmoke(appConfig: AppConfig, workerHost: WorkerHost): Promise<void> {
  const revisions = new GitRevisionReader(appConfig)
  const revision = await revisions.current()

  const base: Omit<ExecutionRequestContract, 'requestHash'> = {
    executionRequestId: 'smoke-exec-1',
    runId: 'smoke-run-1',
    workerAttemptNumber: 1,
    taskSpecVersionId: 'smoke-spec',
    contextSnapshotId: 'smoke-snap',
    expectedRepositoryRevision: revision,
    checkpointId: null,
    requiredCapabilities: ['git', 'node'],
    agentConfiguration: { provider: 'fixture', model: 'deterministic' },
    toolPolicy: {
      allowedTools: ['write_file', 'run_command'],
      deniedPaths: [],
      allowNetwork: false,
      allowShell: true
    },
    workspaceStrategy: 'ISOLATED_WORKTREE',
    resourceBudget: { maxDurationMs: 30_000, maxToolCalls: 20, maxDiskBytes: 1_000_000_000 },
    schemaVersion: 1,
    expiresAt: FUTURE
  }
  const request: ExecutionRequestContract = { ...base, requestHash: computeRequestHash(base) }

  const result = await workerHost.dispatch(request)
  console.error(`[worker-smoke] outcome=${result.outcome}`)
  if (result.outcome !== 'SUCCEEDED') {
    throw new Error(`worker smoke dispatch failed with outcome ${result.outcome}`)
  }
  if (!(result.patch ?? '').includes('docs/phase2.md')) {
    throw new Error('worker smoke patch did not contain the fixture file')
  }
  if (result.verificationResults?.[0]?.exitCode !== 0) {
    throw new Error('worker smoke verification did not exit 0')
  }
  console.error(
    '[worker-smoke] PASSED (real patch/verification evidence produced in the Utility Process)'
  )
}
