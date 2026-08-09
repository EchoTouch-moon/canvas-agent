import {
  defaultServices,
  getSnapshot,
  listSnapshotItems,
  requireRepositoryRevision,
  requireTaskSpecVersion,
  ValidationError,
  createDispatchedRun,
  finalizeRun,
  interruptRun,
  type DispatchResultMetadata,
  type Persistence,
  type SystemServices
} from '@canvas-agent/persistence'
import type {
  CommandInput,
  DispatchResult,
  ExecutionContextBundleV2,
  ExecutionContextItemV2,
  ExecutionRequestContractV2
} from '@canvas-agent/contracts'
import {
  assertValidExecutionContextBundle,
  computeExecutionContextBundle,
  computeRequestHash,
  stableStringify,
  DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED
} from '@canvas-agent/worker-runtime'
import { PHASE3_EXECUTION_PROFILE } from './execution-profile'
import { ArtifactIngestor } from './artifact-ingestor'
import type { WorkerHost } from './worker-host'

const EXPIRY_OFFSET_MS = 24 * 60 * 60 * 1000

function toDispatchMetadata(result: DispatchResult): DispatchResultMetadata {
  return {
    dispatchOutcome: result.outcome,
    claimGranted: result.claimGranted,
    rejectionReason: result.rejectionReason ?? null,
    revisionMismatchField: result.revisionMismatch?.field ?? null,
    revisionMismatchExpected: result.revisionMismatch?.expected ?? null,
    revisionMismatchActual: result.revisionMismatch?.actual ?? null,
    patchHash: result.patchHash ?? null,
    timedOut: result.timedOut ?? null,
    recoveryJson: result.recovery ? stableStringify(result.recovery) : null
  }
}

export interface ExecutionDispatchResponse {
  runId: string
  executionRequestId: string
  result: DispatchResult
}

export class ExecutionCoordinator {
  private readonly services: SystemServices
  private readonly artifactIngestor: ArtifactIngestor

  constructor(
    private readonly p: Persistence,
    private readonly worker: WorkerHost,
    runtimeDirectory: string,
    services: SystemServices = defaultServices
  ) {
    this.services = services
    this.artifactIngestor = new ArtifactIngestor(runtimeDirectory)
  }

  async dispatch(payload: CommandInput<'execution.dispatch'>): Promise<ExecutionDispatchResponse> {
    const snapshot = getSnapshot(this.p, payload.contextSnapshotId)
    if (snapshot.status !== 'FROZEN') {
      throw new ValidationError(`ContextSnapshot ${snapshot.id} is not FROZEN`)
    }
    requireTaskSpecVersion(this.p, snapshot.taskSpecVersionId)
    const revision = requireRepositoryRevision(this.p, snapshot.expectedRepositoryRevisionId)

    if (revision.workingTreePatchHash !== null) {
      throw new ValidationError(
        `${DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED}: the repository has uncommitted changes and v0.2 does not materialize dirty source state`
      )
    }

    const contextBundle = this.materializeContextBundle(snapshot.id)

    const runId = this.services.nextId('run_')
    const now = this.services.now()
    const executionRequestId = payload.executionRequestId

    const base: Omit<ExecutionRequestContractV2, 'requestHash'> = {
      executionRequestId,
      runId,
      workerAttemptNumber: 1,
      taskSpecVersionId: snapshot.taskSpecVersionId,
      contextSnapshotId: snapshot.id,
      expectedRepositoryRevision: {
        baseCommit: revision.baseCommit,
        treeHash: revision.treeHash,
        workingTreePatchHash: revision.workingTreePatchHash
      },
      checkpointId: null,
      requiredCapabilities: PHASE3_EXECUTION_PROFILE.requiredCapabilities,
      agentConfiguration: PHASE3_EXECUTION_PROFILE.agentConfiguration,
      toolPolicy: PHASE3_EXECUTION_PROFILE.toolPolicy,
      workspaceStrategy: PHASE3_EXECUTION_PROFILE.workspaceStrategy,
      resourceBudget: PHASE3_EXECUTION_PROFILE.resourceBudget,
      contextBundle,
      schemaVersion: 2,
      expiresAt: new Date(Date.parse(now) + EXPIRY_OFFSET_MS).toISOString()
    }
    const request: ExecutionRequestContractV2 = {
      ...base,
      requestHash: computeRequestHash(base)
    }

    // Durable Run + request record + DISPATCHED BEFORE the worker starts. If
    // this throws, the worker must never be dispatched.
    createDispatchedRun(this.p, {
      runId,
      projectId: snapshot.projectId,
      taskId: snapshot.taskId,
      taskSpecVersionId: snapshot.taskSpecVersionId,
      contextSnapshotId: snapshot.id,
      repositoryRevisionId: snapshot.expectedRepositoryRevisionId,
      startedAt: now,
      now,
      request: {
        executionRequestId,
        workerAttemptNumber: request.workerAttemptNumber,
        checkpointId: request.checkpointId,
        requestHash: request.requestHash,
        schemaVersion: request.schemaVersion,
        requestJson: stableStringify(request),
        dispatchedAt: now
      }
    })

    let result: DispatchResult
    try {
      result = await this.worker.dispatch(request)
    } catch (error) {
      // WorkerHost threw / child crashed: no terminal DispatchResult was
      // received, so the request record stays incomplete.
      await this.interrupt(runId, executionRequestId, 'worker_host_failure', null, null)
      throw error
    }
    const completedAt = this.services.now()

    let artifacts
    try {
      artifacts = await this.artifactIngestor.ingest(executionRequestId, result.artifacts ?? [])
    } catch (error) {
      await this.interrupt(
        runId,
        executionRequestId,
        'artifact_integrity_failure',
        result,
        completedAt
      )
      throw error
    }
    try {
      finalizeRun(this.p, {
        runId,
        executionRequestId,
        metadata: toDispatchMetadata(result),
        completedAt,
        now: completedAt,
        artifacts
      })
    } catch (error) {
      await this.interrupt(
        runId,
        executionRequestId,
        'durable_finalize_failure',
        result,
        completedAt
      )
      throw error
    }
    return { runId, executionRequestId, result }
  }

  async cancel(payload: CommandInput<'execution.cancel'>): Promise<{ cancelled: boolean }> {
    return { cancelled: await this.worker.cancel(payload.executionRequestId) }
  }

  private materializeContextBundle(snapshotId: string): ExecutionContextBundleV2 {
    const rows = listSnapshotItems(this.p, snapshotId)
    const items: ExecutionContextItemV2[] = rows.map((row) => ({
      position: row.position,
      itemType: row.itemType,
      sourceRef: row.sourceRef,
      resolvedContent: row.resolvedContent,
      contentHash: row.contentHash,
      authority: row.authority,
      priority: row.priority,
      tokenEstimate: row.tokenEstimate
    }))
    if (items.length === 0) {
      throw new ValidationError(
        `ContextSnapshot ${snapshotId} has no materialized context items; dispatch is blocked`
      )
    }
    const computed = computeExecutionContextBundle(items)
    const bundle: ExecutionContextBundleV2 = {
      items,
      totalBytes: computed.totalBytes,
      contentHash: computed.contentHash
    }
    try {
      assertValidExecutionContextBundle(bundle)
    } catch (error) {
      throw new ValidationError(
        `ContextSnapshot ${snapshotId} failed bundle validation: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    return bundle
  }

  private async interrupt(
    runId: string,
    executionRequestId: string,
    reasonCode: string,
    terminalResult: DispatchResult | null,
    terminalCompletedAt: string | null
  ): Promise<void> {
    try {
      interruptRun(this.p, {
        runId,
        executionRequestId,
        reasonCode,
        now: this.services.now(),
        terminalMetadata: terminalResult === null ? null : toDispatchMetadata(terminalResult),
        terminalCompletedAt
      })
    } catch (error) {
      console.error(`[run] interrupt failed for ${runId}:`, error)
    }
  }
}
