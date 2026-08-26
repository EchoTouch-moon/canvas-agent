import { performance } from 'node:perf_hooks'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExecutionRequestContract } from '@canvas-agent/contracts'
import type { ClaimStore } from './claim'
import { createInMemoryClaimStore } from './claim'
import type { AgentAdapter, AgentArtifact } from './agent-adapter'
import {
  AGENT_CANCELLED,
  AGENT_EXECUTABLE_NOT_FOUND,
  AGENT_POLICY_REJECTED,
  AGENT_TIMED_OUT,
  BudgetExceededError,
  CancelledError,
  EXECUTION_CONTEXT_REQUIRED,
  LocalCliError,
  RevisionMismatchError
} from './errors'
import { runCommand } from './process-runner'
import { ISOLATED_GIT_ENV, runGitCommand, verifyRepositoryRevision, type GitRunOptions } from './revision'
import { sha256Hex, validateExecutionRequest, DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED } from './validation'
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
  agent?: AgentAdapter
  codexAdapter?: AgentAdapter
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

  function selectAdapter(request: ExecutionRequestContract): AgentAdapter | null {
    const provider = request.agentConfiguration.provider
    if (provider === 'codex-cli') {
      return config.codexAdapter ?? null
    }
    if (provider === 'fixture') {
      return config.agent ?? null
    }
    return null
  }

  function adapterRejectionReason(request: ExecutionRequestContract): string {
    const provider = request.agentConfiguration.provider
    if (provider === 'codex-cli') {
      return AGENT_EXECUTABLE_NOT_FOUND
    }
    return AGENT_POLICY_REJECTED
  }

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

    if (request.expectedRepositoryRevision.workingTreePatchHash !== null) {
      return {
        outcome: 'VALIDATION_REJECTED',
        claimGranted: false,
        rejectionReason: DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED
      }
    }

    if (request.agentConfiguration.provider === 'codex-cli' && request.schemaVersion !== 2) {
      return {
        outcome: 'VALIDATION_REJECTED',
        claimGranted: false,
        rejectionReason: EXECUTION_CONTEXT_REQUIRED
      }
    }

    const adapter = selectAdapter(request)
    if (adapter === null) {
      return {
        outcome: 'VALIDATION_REJECTED',
        claimGranted: false,
        rejectionReason: adapterRejectionReason(request)
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
          claimGranted: true,
          rejectionReason: AGENT_CANCELLED
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
          claimGranted: true,
          rejectionReason: AGENT_CANCELLED
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
      agentArtifacts?: readonly AgentArtifact[]
      verificationResults: VerificationCommandResult[]
      patch?: string
    } = { verificationResults: [] }

    let agentSummary: string | undefined
    let outcome: DispatchOutcome = 'SUCCEEDED'
    let reason: string | undefined
    const markCancelled = (): void => {
      outcome = 'CANCELLED'
      reason = AGENT_CANCELLED
    }

    try {
      const agentResult = await adapter.run({
        cwd: worktreePath,
        toolPolicy: request.toolPolicy,
        maxToolCalls: budget.maxToolCalls,
        maxDurationMs: budget.maxDurationMs,
        commandAllowlist: config.commandAllowlist,
        signal,
        env: ISOLATED_GIT_ENV,
        executionRequestId: request.executionRequestId,
        agentConfiguration: request.agentConfiguration,
        ...(request.schemaVersion === 2 ? { contextBundle: request.contextBundle } : {})
      })
      agentSummary = agentResult.text
      partial.agentSummary = agentResult.text
      partial.agentArtifacts = agentResult.artifacts
    } catch (error) {
      if (error instanceof LocalCliError) {
        // Preserve the stable adapter code in rejectionReason; keep only the
        // bounded message as diagnostic evidence and carry bounded transport on
        // failure so AGENT_PARTIAL retains the failure diagnostics.
        outcome = error.code === AGENT_CANCELLED ? 'CANCELLED' : 'PARTIAL'
        reason = error.code
        if (error.transport !== undefined) {
          partial.agentArtifacts = [
            { fileName: 'transport.json', content: JSON.stringify(error.transport, null, 2) }
          ]
        }
      } else if (error instanceof CancelledError || signal.aborted) {
        outcome = 'CANCELLED'
        reason = AGENT_CANCELLED
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
      markCancelled()
    }

    // Repository-state guard: the detached worktree must still point at the
    // requested base with no branch acquired. Runs after the agent succeeds OR
    // fails; on violation skip the trusted verification and patch export and
    // keep only bounded partial evidence.
    let repositoryStateViolation = false
    if (outcome !== 'CANCELLED') {
      const violation = await verifyWorktreeRepositoryState(
        request.expectedRepositoryRevision.baseCommit,
        gitOptions(worktreePath, signal)
      )
      if (violation !== null) {
        repositoryStateViolation = true
        outcome = 'PARTIAL'
        reason = violation
      }
    }

    let stagingFailed = false
    if (outcome !== 'CANCELLED' && !repositoryStateViolation) {
      const stage = await runGitCommand(['add', '-A'], gitOptions(worktreePath, signal))
      if (stage.exitCode !== 0) {
        stagingFailed = true
        outcome = 'PARTIAL'
        reason = 'git add failed'
      }
    }
    const skipPostAgent = repositoryStateViolation || stagingFailed

    if (outcome !== 'CANCELLED' && !skipPostAgent) {
      // Worker-owned universal integrity check after staging the isolated patch
      // (non-closeable; injected verificationCommands only append below).
      const check = await runGitCommand(['diff', '--cached', '--check'], gitOptions(worktreePath, signal))
      partial.verificationResults.push({
        argv: ['git', 'diff', '--cached', '--check'],
        exitCode: check.exitCode,
        signal: check.signal,
        stdout: check.stdout,
        stderr: check.stderr,
        timedOut: check.timedOut,
        cancelled: check.cancelled,
        outputTruncated: check.outputTruncated,
        durationMs: check.durationMs
      })
      if (check.exitCode !== 0) {
        outcome = 'PARTIAL'
        reason = 'git diff --cached --check failed'
      }

      for (const argv of config.verificationCommands) {
        if (signal.aborted) {
          markCancelled()
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
        markCancelled()
      }
    }

    let patch: string | undefined
    let patchHash: string | undefined
    if (outcome !== 'CANCELLED' && !skipPostAgent) {
      try {
        patch = await exportWorktreePatch({ ...gitOptions(worktreePath, signal), worktreePath })
        if (patch.length > 0) {
          patchHash = sha256Hex(patch)
        }
        partial.patch = patch
        // An unstageable worktree entry (e.g. a FIFO) makes `git add` silently
        // skip it, leaving an empty staged diff. If the agent claimed changes
        // but git could not stage anything, never report an empty success.
        if (patch.length === 0 && summaryClaimsChanges(partial.agentSummary)) {
          outcome = 'PARTIAL'
          reason = 'agent claimed changes but produced an empty patch'
        }
      } catch (error) {
        outcome = 'PARTIAL'
        reason = `patch export failed: ${describe(error)}`
      }
    }

    if (signal.aborted) {
      markCancelled()
    }

    let cleanupSucceeded = false
    try {
      // The dispatch signal may already be aborted here (cancel path); passing
      // it would abort the cleanup git calls themselves and leak the worktree,
      // so cleanup always runs detached from the dispatch signal.
      cleanupSucceeded = await removeWorktree({
        ...gitOptions(config.sourceRepositoryPath, undefined),
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
      if (reason === 'verification command timed out' || reason === AGENT_TIMED_OUT) {
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
    partial: {
      verificationResults: VerificationCommandResult[]
      agentArtifacts?: readonly AgentArtifact[]
    },
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
    for (const artifact of partial.agentArtifacts ?? []) {
      descriptors.push(await persistArtifact(dir, 'AGENT_SUMMARY', artifact.fileName, artifact.content))
    }
    return descriptors
  }

  async function writePartialArtifacts(
    executionRequestId: string,
    patch: string | undefined,
    partial: {
      verificationResults: VerificationCommandResult[]
      agentEvidence?: string
      agentArtifacts?: readonly AgentArtifact[]
    },
    agentSummary: string | undefined,
    reason: string | undefined
  ): Promise<ArtifactDescriptor[]> {
    const dir = join(config.runtimeDirectory, 'artifacts', executionRequestId)
    await mkdir(dir, { recursive: true })
    const descriptors: ArtifactDescriptor[] = []

    if (patch !== undefined) {
      descriptors.push(await persistArtifact(dir, 'PATCH', 'patch.partial.diff', patch))
    }
    const transport: Record<string, unknown> = {}
    for (const artifact of partial.agentArtifacts ?? []) {
      try {
        transport[artifact.fileName] = JSON.parse(artifact.content)
      } catch {
        transport[artifact.fileName] = artifact.content
      }
    }
    const partialEvidence = {
      reason,
      agentEvidence: partial.agentEvidence,
      verificationResults: partial.verificationResults,
      transport: Object.keys(transport).length > 0 ? transport : undefined
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

function summaryClaimsChanges(text: string | undefined): boolean {
  if (text === undefined) {
    return false
  }
  try {
    const parsed = JSON.parse(text) as { changes?: readonly unknown[] }
    return Array.isArray(parsed.changes) && parsed.changes.length > 0
  } catch {
    return false
  }
}

async function verifyWorktreeRepositoryState(
  baseCommit: string,
  gitOptions: GitRunOptions
): Promise<string | null> {
  const head = await runGitCommand(['rev-parse', 'HEAD'], gitOptions)
  if (head.exitCode !== 0 || head.stdout.trim() !== baseCommit) {
    return 'AGENT_REPOSITORY_STATE_VIOLATION'
  }
  const branch = await runGitCommand(['symbolic-ref', '--quiet', 'HEAD'], gitOptions)
  if (branch.exitCode === 0 && branch.stdout.trim().length > 0) {
    return 'AGENT_REPOSITORY_STATE_VIOLATION'
  }
  return null
}

function toMismatchDetail(error: RevisionMismatchError): RevisionMismatchDetail {
  return {
    field: error.field,
    expected: error.expected,
    actual: error.actual
  }
}
