import {
  defaultServices,
  getSnapshot,
  requireRepositoryRevision,
  requireTaskSpecVersion,
  ValidationError,
  type Persistence,
  type SystemServices
} from '@canvas-agent/persistence'
import type {
  CommandInput,
  DispatchResult,
  ExecutionRequestContract
} from '@canvas-agent/contracts'
import { computeRequestHash } from '@canvas-agent/worker-runtime'
import type { WorkerHost } from './worker-host'

const EXPIRY_OFFSET_MS = 24 * 60 * 60 * 1000

export class ExecutionCoordinator {
  private readonly services: SystemServices

  constructor(
    private readonly p: Persistence,
    private readonly worker: WorkerHost,
    services: SystemServices = defaultServices
  ) {
    this.services = services
  }

  async dispatch(payload: CommandInput<'execution.dispatch'>): Promise<DispatchResult> {
    const snapshot = getSnapshot(this.p, payload.contextSnapshotId)
    if (snapshot.status !== 'FROZEN') {
      throw new ValidationError(`ContextSnapshot ${snapshot.id} is not FROZEN`)
    }
    requireTaskSpecVersion(this.p, snapshot.taskSpecVersionId)
    const revision = requireRepositoryRevision(this.p, snapshot.expectedRepositoryRevisionId)

    const base: Omit<ExecutionRequestContract, 'requestHash'> = {
      executionRequestId: payload.executionRequestId,
      runId: this.services.nextId('run_'),
      workerAttemptNumber: 1,
      taskSpecVersionId: snapshot.taskSpecVersionId,
      contextSnapshotId: snapshot.id,
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
        deniedPaths: [],
        allowNetwork: false,
        allowShell: true
      },
      workspaceStrategy: 'ISOLATED_WORKTREE',
      resourceBudget: { maxDurationMs: 30_000, maxToolCalls: 20, maxDiskBytes: 1_000_000_000 },
      schemaVersion: 1,
      expiresAt: new Date(Date.parse(this.services.now()) + EXPIRY_OFFSET_MS).toISOString()
    }
    const request: ExecutionRequestContract = { ...base, requestHash: computeRequestHash(base) }
    return this.worker.dispatch(request)
  }

  async cancel(payload: CommandInput<'execution.cancel'>): Promise<{ cancelled: boolean }> {
    return { cancelled: await this.worker.cancel(payload.executionRequestId) }
  }
}
