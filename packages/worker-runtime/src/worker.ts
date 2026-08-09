import { performance } from 'node:perf_hooks'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClaimStore } from './claim'
import { createInMemoryClaimStore } from './claim'
import type { AgentAdapter } from './agent-adapter'
import { BudgetExceededError, CancelledError, RevisionMismatchError } from './errors'
import { runCommand } from './process-runner'
import { ISOLATED_GIT_ENV, verifyRepositoryRevision, type GitRunOptions } from './revision'
import { sha256Hex, validateExecutionRequest } from './validation'
import { createIsolatedWorktree, exportWorktreePatch, removeWorktree } from './worktree'
import type {
  ArtifactDescriptor,
  DispatchOutcome,
  DispatchResult,
  RecoveryMetadata,
  RevisionMismatchDetail,
  VerificationCommandResult
} from './types'

export interface WorkerConfig {
  runtimeDirectory: string
  sourceRepositoryPath: string
  capabilities: readonly string[]
  claimStore?: ClaimStore
  commandAllowlist: readonly string[]
  verificationCommands: readonly (readonly string[])[]
  agent: AgentAdapter
  now?: () => string
  maxOutputBytes?: number
  gitTimeoutMs?: number
}

export interface DispatchOptions {
  request: unknown
  signal?: AbortSignal
}

export interface Worker {
  dispatch(options: DispatchOptions): Promise<DispatchResult>
  cancel(): void
  isCancelled(): boolean
}

export function createWorker(config: WorkerConfig): Worker {
  const claimStore = config.claimStore ?? createInMemoryClaimStore()
  const controller = new AbortController()
  const maxOutputBytes = config.maxOutputBytes ?? 256 * 1024
  const gitTimeoutMs = config.gitTimeoutMs ?? 60_000
  const now = config.now ?? (() => new Date().toISOString())

  const gitOptions = (cwd: string, signal?: AbortSignal): GitRunOptions => ({
    cwd,
    timeoutMs: gitTimeoutMs,
    maxOutputBytes,
    commandAllowlist: config.commandAllowlist,
    signal
  })

  async function dispatch(options: DispatchOptions): Promise<DispatchResult> {
    const signal = options.signal ?? controller.signal

    let request
    try {
      request = validateExecutionRequest(options.request, {
        capabilities: config.capabilities,
        now: Date.parse(now())
      })
    } catch (error) {
      return {
        outcome: 'VALIDATION_REJECTED',
        claimGranted: false,
        rejectionReason: describe(error)
      }
    }

    if (!claimStore.claim(request.executionRequestId)) {
      return {
        outcome: 'CLAIM_REJECTED',
        claimGranted: false,
        rejectionReason: `ExecutionRequest ${request.executionRequestId} has already been claimed`
      }
    }

    try {
      await verifyRepositoryRevision(
        config.sourceRepositoryPath,
        request.expectedRepositoryRevision,
        gitOptions(config.sourceRepositoryPath, signal),
        request.executionRequestId
      )
    } catch (error) {
      if (signal.aborted) {
        return {
          outcome: 'CANCELLED',
          claimGranted: true
        }
      }
      if (error instanceof RevisionMismatchError) {
        return {
          outcome: 'REVISION_MISMATCH',
          claimGranted: true,
          revisionMismatch: toMismatchDetail(error)
        }
      }
      return {
        outcome: 'PARTIAL',
        claimGranted: true,
        rejectionReason: `revision verification failed: ${describe(error)}`
      }
    }

    const worktreePath = join(config.runtimeDirectory, 'worktrees', request.executionRequestId)
    try {
      await createIsolatedWorktree({
        ...gitOptions(config.sourceRepositoryPath, signal),
        sourceRepoPath: config.sourceRepositoryPath,
        runtimeDirectory: config.runtimeDirectory,
        executionRequestId: request.executionRequestId,
        baseCommit: request.expectedRepositoryRevision.baseCommit
      })
    } catch (error) {
      if (signal.aborted) {
        try {
          await removeWorktree({
            ...gitOptions(config.sourceRepositoryPath, undefined),
            sourceRepoPath: config.sourceRepositoryPath,
            worktreePath
          })
        } catch {
          // best-effort cleanup: never mask the cancellation outcome
        }
        return {
          outcome: 'CANCELLED',
          claimGranted: true
        }
      }
      return {
        outcome: 'PARTIAL',
        claimGranted: true,
        rejectionReason: `worktree creation failed: ${describe(error)}`
      }
    }

    const recovery = await writeRecovery({
      executionRequestId: request.executionRequestId,
      worktreePath,
      state: 'running',
      startedAt: now(),
      cleanupSucceeded: false
    })

    const budget = {
      maxDurationMs: request.resourceBudget.maxDurationMs,
      maxToolCalls: request.resourceBudget.maxToolCalls
    }
    const startedAt = performance.now()
    const partial: {
      agentSummary?: string
      agentEvidence?: string
      verificationResults: VerificationCommandResult[]
      patch?: string
    } = { verificationResults: [] }

    let agentSummary: string | undefined
    let outcome: DispatchOutcome = 'SUCCEEDED'
    let reason: string | undefined

    try {
      const agentResult = await config.agent.run({
        cwd: worktreePath,
        toolPolicy: request.toolPolicy,
        maxToolCalls: budget.maxToolCalls,
        maxDurationMs: budget.maxDurationMs,
        commandAllowlist: config.commandAllowlist,
        signal,
        env: ISOLATED_GIT_ENV
      })
      agentSummary = agentResult.text
      partial.agentSummary = agentResult.text
    } catch (error) {
      if (error instanceof CancelledError || signal.aborted) {
        outcome = 'CANCELLED'
      } else if (error instanceof BudgetExceededError) {
        outcome = 'PARTIAL'
        reason = error.message
      } else {
        outcome = 'PARTIAL'
        reason = `agent step failed: ${describe(error)}`
      }
      partial.agentEvidence = describe(error)
    }

    if (signal.aborted) {
      outcome = 'CANCELLED'
    }

    if (outcome !== 'CANCELLED') {
      for (const argv of config.verificationCommands) {
        if (signal.aborted) {
          outcome = 'CANCELLED'
          break
        }
        const remaining = budget.maxDurationMs - (performance.now() - startedAt)
        if (remaining <= 0) {
          outcome = 'PARTIAL'
          reason = 'budget exceeded: maxDurationMs'
          break
        }
        const result = await runCommand({
          argv,
          cwd: worktreePath,
          timeoutMs: Math.min(gitTimeoutMs, remaining),
          maxOutputBytes,
          commandAllowlist: config.commandAllowlist,
          signal,
          env: ISOLATED_GIT_ENV
        })
        partial.verificationResults.push({
          argv,
          exitCode: result.exitCode,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut,
          cancelled: result.cancelled,
          outputTruncated: result.outputTruncated,
          durationMs: result.durationMs
        })
        if (result.timedOut) {
          outcome = 'PARTIAL'
          reason = 'verification command timed out'
        }
      }

      if (signal.aborted) {
        outcome = 'CANCELLED'
      }
    }

    let patch: string | undefined
    let patchHash: string | undefined
    if (outcome !== 'CANCELLED') {
      try {
        patch = await exportWorktreePatch({ ...gitOptions(worktreePath, signal), worktreePath })
        patchHash = patch.length > 0 ? sha256Hex(patch) : undefined
        partial.patch = patch
      } catch (error) {
        outcome = 'PARTIAL'
        reason = `patch export failed: ${describe(error)}`
      }
    }

    if (signal.aborted) {
      outcome = 'CANCELLED'
    }

    let cleanupSucceeded = false
    try {
      cleanupSucceeded = await removeWorktree({
        ...gitOptions(config.sourceRepositoryPath, signal),
        sourceRepoPath: config.sourceRepositoryPath,
        worktreePath
      })
    } catch {
      cleanupSucceeded = false
    }

    const interrupted = outcome !== 'SUCCEEDED'
    if (interrupted) {
      await writeRecovery({
        executionRequestId: request.executionRequestId,
        worktreePath,
        state: 'interrupted',
        startedAt: recovery.startedAt,
        interruptedAt: now(),
        cleanupSucceeded
      })
    } else {
      await removeRecovery(request.executionRequestId)
    }

    const artifacts = interrupted
      ? await writePartialArtifacts(request.executionRequestId, patch, partial, agentSummary, reason)
      : await writeSuccessArtifacts(request.executionRequestId, patch, partial, agentSummary)

    const result: DispatchResult = {
      outcome,
      claimGranted: true,
      verificationResults: partial.verificationResults,
      artifacts
    }
    if (patch !== undefined) {
      result.patch = patch
    }
    if (patchHash !== undefined) {
      result.patchHash = patchHash
    }
    if (agentSummary !== undefined) {
      result.agentSummary = agentSummary
    }
    if (reason !== undefined) {
      result.rejectionReason = reason
      if (reason === 'verification command timed out') {
        result.timedOut = true
      }
    }
    if (interrupted) {
      result.recovery = {
        executionRequestId: request.executionRequestId,
        worktreePath,
        state: 'interrupted',
        startedAt: recovery.startedAt,
        interruptedAt: now(),
        cleanupSucceeded
      }
    }
    return result
  }

  async function writeRecovery(metadata: RecoveryMetadata): Promise<RecoveryMetadata> {
    const dir = join(config.runtimeDirectory, 'recovery')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${metadata.executionRequestId}.json`), JSON.stringify(metadata, null, 2), 'utf8')
    return metadata
  }

  async function removeRecovery(executionRequestId: string): Promise<void> {
    await rm(join(config.runtimeDirectory, 'recovery', `${executionRequestId}.json`), { force: true })
  }

  async function writeSuccessArtifacts(
    executionRequestId: string,
    patch: string | undefined,
    partial: { verificationResults: VerificationCommandResult[] },
    agentSummary: string | undefined
  ): Promise<ArtifactDescriptor[]> {
    const dir = join(config.runtimeDirectory, 'artifacts', executionRequestId)
    await mkdir(dir, { recursive: true })
    const descriptors: ArtifactDescriptor[] = []

    if (patch !== undefined) {
      descriptors.push(await persistArtifact(dir, 'PATCH', 'patch.diff', patch))
    }
    const verificationJson = JSON.stringify(partial.verificationResults, null, 2)
    descriptors.push(await persistArtifact(dir, 'TEST_RESULT', 'verification.json', verificationJson))
    if (agentSummary !== undefined) {
      descriptors.push(await persistArtifact(dir, 'AGENT_SUMMARY', 'agent-summary.txt', agentSummary))
    }
    return descriptors
  }

  async function writePartialArtifacts(
    executionRequestId: string,
    patch: string | undefined,
    partial: { verificationResults: VerificationCommandResult[]; agentEvidence?: string },
    agentSummary: string | undefined,
    reason: string | undefined
  ): Promise<ArtifactDescriptor[]> {
    const dir = join(config.runtimeDirectory, 'artifacts', executionRequestId)
    await mkdir(dir, { recursive: true })
    const descriptors: ArtifactDescriptor[] = []

    if (patch !== undefined) {
      descriptors.push(await persistArtifact(dir, 'PATCH', 'patch.partial.diff', patch))
    }
    const partialEvidence = {
      reason,
      agentEvidence: partial.agentEvidence,
      verificationResults: partial.verificationResults
    }
    descriptors.push(
      await persistArtifact(dir, 'AGENT_PARTIAL', 'partial-evidence.json', JSON.stringify(partialEvidence, null, 2))
    )
    if (agentSummary !== undefined) {
      descriptors.push(await persistArtifact(dir, 'AGENT_SUMMARY', 'agent-summary.txt', agentSummary))
    }
    return descriptors
  }

  async function persistArtifact(
    dir: string,
    kind: ArtifactDescriptor['kind'],
    fileName: string,
    content: string
  ): Promise<ArtifactDescriptor> {
    await writeFile(join(dir, fileName), content, 'utf8')
    return {
      kind,
      fileName,
      contentHash: sha256Hex(content),
      sizeBytes: Buffer.byteLength(content, 'utf8')
    }
  }

  return {
    dispatch,
    cancel: () => controller.abort(),
    isCancelled: () => controller.signal.aborted
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function toMismatchDetail(error: RevisionMismatchError): RevisionMismatchDetail {
  return {
    field: error.field,
    expected: error.expected,
    actual: error.actual
  }
}
