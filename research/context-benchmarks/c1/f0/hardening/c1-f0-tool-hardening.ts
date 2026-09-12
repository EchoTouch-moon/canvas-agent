import { createHash } from 'node:crypto'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  changedC1FixturePaths,
  computeC1FixtureContentSummary,
  snapshotC1Fixture
} from '../../../src/c1-live-preflight'
import { buildSanitizedChildEnvironment, runProcess } from '../../../src/fixture-generator'

export const C1_F0_TOOL_HARDENING_ID = 'C1_F0_TOOL_HARDENING_V1'
export const C1_F0_TOOL_HARDENING_MODE = 'PROSPECTIVE_OPT_IN_ONLY' as const

export type C1F0ToolFailureClass =
  | 'NONE'
  | 'INVALID_ARGUMENT'
  | 'PATH_ESCAPE'
  | 'PATH_NOT_FOUND'
  | 'READ_FAILED'
  | 'EDIT_MATCH_COUNT'
  | 'WRITE_FAILED'
  | 'COMMAND_FAILED'
  | 'COMMAND_TIMEOUT'
  | 'COMMAND_OUTPUT_LIMIT'
  | 'UNSUPPORTED_TOOL'
  | 'REPEATED_FAILURE_BLOCKED'
  | 'UNKNOWN'

export type C1F0ToolCommandClass =
  | 'NOT_APPLICABLE'
  | 'NODE_TEST'
  | 'NODE_VERSION'
  | 'PACKAGE_MANAGER'
  | 'GIT_READONLY'
  | 'GIT_MUTATION'
  | 'SHELL_OTHER'

export type C1F0ToolSideEffectSource = 'NONE' | 'EDIT_TOOL' | 'BASH_TOOL' | 'UNKNOWN'

export type C1F0ToolRecoveryAction =
  | 'NONE'
  | 'REREAD_TARGET'
  | 'REISSUE_CORRECTED_ARGUMENTS'
  | 'INSPECT_COMMAND_RESULT'
  | 'BLOCKED_REPEATED_FAILURE'

export interface C1F0ToolRequest {
  readonly toolCallId: string
  readonly toolName: string
  readonly argumentsJson: string
}

export interface C1F0ToolExecutionProvenance {
  /** Hash of tool name + canonicalized semantic arguments; raw arguments are never persisted. */
  readonly canonicalRequestSignature: string
  readonly failureClass: C1F0ToolFailureClass
  readonly commandClass: C1F0ToolCommandClass
  /** Hash of a bash command; the command text is never persisted. */
  readonly commandHash?: string
  readonly errorDigest?: string
  readonly changedPaths: readonly string[]
  readonly sideEffectSource: C1F0ToolSideEffectSource
  readonly snapshotStatus: 'COMPLETE' | 'UNAVAILABLE'
  readonly beforeSnapshotHash?: string
  readonly afterSnapshotHash?: string
  readonly consecutiveFailureStreak: number
  readonly recoveryAction: C1F0ToolRecoveryAction
  /** Metadata-only link to the immediately preceding failed tool call. */
  readonly recoveryOfToolCallId?: string
  /** One-based ordinal within the linked recovery chain. */
  readonly recoveryAttemptOrdinal?: number
}

export interface C1F0ToolExecution {
  readonly toolCallId: string
  readonly toolName: string
  readonly path?: string
  readonly result: 'SUCCESS' | 'ERROR'
  readonly provenance: C1F0ToolExecutionProvenance
}

export interface C1F0ToolLoopResult {
  readonly executions: readonly C1F0ToolExecution[]
  /** In-memory only; callers must not persist raw result contents. */
  readonly resultContents: ReadonlyMap<string, string>
  readonly recoverySummary: C1F0RecoverySummary
}

export interface C1F0RecoverySummary {
  readonly failedExecutions: number
  readonly recoveredExecutions: number
  readonly blockedRepeatedFailures: number
  readonly uniqueFailureSignatures: number
}

export interface C1F0ProspectiveToolExecutorOptions {
  readonly commandTimeoutMs?: number
  readonly outputLimitBytes?: number
  readonly provenanceEnabled?: boolean
  readonly recoveryPolicy?: {
    readonly enabled?: boolean
    readonly maxIdenticalFailureAttempts?: number
  }
}

interface ToolAttempt {
  readonly result: 'SUCCESS' | 'ERROR'
  readonly content: string
  readonly path?: string
  readonly failureClass?: C1F0ToolFailureClass
  readonly commandClass?: C1F0ToolCommandClass
}

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000
const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function snapshotHash(snapshot: ReadonlyMap<string, string> | null): string | undefined {
  if (snapshot === null) return undefined
  return sha256(
    [...snapshot.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, digest]) => `${digest}  ${path}`)
      .join('\n') + '\n'
  )
}

function parseArguments(request: C1F0ToolRequest): Record<string, unknown> {
  const parsed = JSON.parse(request.argumentsJson) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`tool ${request.toolCallId} arguments must be an object`)
  }
  return parsed as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, key: string, toolCallId: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`tool ${toolCallId} argument ${key} must be a non-empty string`)
  }
  return value
}

function requiredText(record: Record<string, unknown>, key: string, toolCallId: string): string {
  const value = record[key]
  if (typeof value !== 'string')
    throw new Error(`tool ${toolCallId} argument ${key} must be a string`)
  return value
}

function countOccurrences(value: string, needle: string): number {
  let count = 0
  let offset = 0
  while (offset < value.length) {
    const index = value.indexOf(needle, offset)
    if (index < 0) break
    count += 1
    offset = index + needle.length
  }
  return count
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? 'null' : serialized
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => {
    if (left === right) return 0
    return left < right ? -1 : 1
  })
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`
}

function canonicalRequestSignature(request: C1F0ToolRequest): string {
  let argumentsKey: string
  try {
    argumentsKey = canonicalJson(JSON.parse(request.argumentsJson) as unknown)
  } catch {
    // Invalid argument payloads cannot be semantically canonicalized. Hashing the
    // invalid text still avoids retaining it while keeping distinct malformed
    // requests distinguishable for diagnostics.
    argumentsKey = `invalid:${sha256(request.argumentsJson)}`
  }
  return sha256(`${request.toolName}\u0000${argumentsKey}`)
}

function commandClass(command: string): C1F0ToolCommandClass {
  const normalized = command.trim()
  if (/^node\s+(?:--test\b|.*\s--test\b)/.test(normalized)) return 'NODE_TEST'
  if (/^node\s+--version\b/.test(normalized)) return 'NODE_VERSION'
  if (/^(?:npm|pnpm|yarn|bun)\b/.test(normalized)) return 'PACKAGE_MANAGER'
  if (/^git\s+(?:status|diff|log|show|rev-parse|ls-files|cat-file)\b/.test(normalized)) {
    return 'GIT_READONLY'
  }
  if (/^git\s+(?:add|commit|reset|checkout|clean|rm|mv)\b/.test(normalized)) {
    return 'GIT_MUTATION'
  }
  return 'SHELL_OTHER'
}

function commandFromArguments(request: C1F0ToolRequest): string | undefined {
  if (request.toolName !== 'bash') return undefined
  try {
    const parsed = parseArguments(request)
    return typeof parsed['command'] === 'string' && parsed['command'].length > 0
      ? parsed['command']
      : undefined
  } catch {
    return undefined
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { readonly code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function classifyFailure(request: C1F0ToolRequest, error: unknown): C1F0ToolFailureClass {
  const message = error instanceof Error ? error.message : String(error)
  const code = errorCode(error)
  if (/unsupported C1 tool/i.test(message)) return 'UNSUPPORTED_TOOL'
  if (/argument|invalid JSON|must be an object|must be a string/i.test(message)) {
    return 'INVALID_ARGUMENT'
  }
  if (/must be relative|escapes the fixture/i.test(message)) return 'PATH_ESCAPE'
  if (code === 'ENOENT' || /no such file|cannot find/i.test(message)) return 'PATH_NOT_FOUND'
  if (request.toolName === 'read') return 'READ_FAILED'
  if (request.toolName === 'edit' && /expected one oldText match/i.test(message)) {
    return 'EDIT_MATCH_COUNT'
  }
  if (request.toolName === 'edit') return 'WRITE_FAILED'
  if (request.toolName === 'bash') return 'COMMAND_FAILED'
  return 'UNKNOWN'
}

function recoveryAction(failureClass: C1F0ToolFailureClass): C1F0ToolRecoveryAction {
  if (
    failureClass === 'PATH_NOT_FOUND' ||
    failureClass === 'READ_FAILED' ||
    failureClass === 'PATH_ESCAPE'
  ) {
    return 'REREAD_TARGET'
  }
  if (failureClass === 'EDIT_MATCH_COUNT' || failureClass === 'INVALID_ARGUMENT') {
    return 'REISSUE_CORRECTED_ARGUMENTS'
  }
  if (
    failureClass === 'COMMAND_FAILED' ||
    failureClass === 'COMMAND_TIMEOUT' ||
    failureClass === 'COMMAND_OUTPUT_LIMIT'
  ) {
    return 'INSPECT_COMMAND_RESULT'
  }
  if (failureClass === 'UNSUPPORTED_TOOL' || failureClass === 'UNKNOWN') {
    return 'REISSUE_CORRECTED_ARGUMENTS'
  }
  return 'NONE'
}

function recoveryHint(failureClass: C1F0ToolFailureClass): string {
  if (
    failureClass === 'PATH_NOT_FOUND' ||
    failureClass === 'READ_FAILED' ||
    failureClass === 'PATH_ESCAPE'
  ) {
    return 'REREAD_TARGET_OR_USE_A_SAFE_RELATIVE_PATH'
  }
  if (failureClass === 'EDIT_MATCH_COUNT') return 'REREAD_TARGET_AND_REISSUE_A_SINGLE_MATCH_EDIT'
  if (failureClass === 'INVALID_ARGUMENT') return 'CORRECT_ARGUMENT_SHAPE_BEFORE_RETRY'
  if (
    failureClass === 'COMMAND_FAILED' ||
    failureClass === 'COMMAND_TIMEOUT' ||
    failureClass === 'COMMAND_OUTPUT_LIMIT'
  ) {
    return 'INSPECT_COMMAND_RESULT_BEFORE_RETRYING'
  }
  if (failureClass === 'REPEATED_FAILURE_BLOCKED') {
    return 'CHANGE_TOOL_ARGUMENTS_OR_SWITCH_TO_A_DIFFERENT_RECOVERY_STEP'
  }
  return 'INSPECT_TOOL_ERROR_AND_CHOOSE_A_NEW_ACTION'
}

function recoveryContent(
  content: string,
  failureClass: C1F0ToolFailureClass,
  action: C1F0ToolRecoveryAction,
  consecutiveFailureStreak: number
): string {
  return `${content}\n[C1_F0_RECOVERY] class=${failureClass}; action=${action}; consecutiveFailureStreak=${String(
    consecutiveFailureStreak
  )}; hint=${recoveryHint(failureClass)}`
}

function safePath(
  root: string,
  value: string,
  toolCallId: string
): {
  readonly absolutePath: string
  readonly relativePath: string
} {
  if (isAbsolute(value))
    throw new Error(`tool ${toolCallId} path must be relative to the fixture sandbox`)
  const absolutePath = resolve(root, value)
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    throw new Error(`tool ${toolCallId} path escapes the fixture sandbox`)
  }
  const relativePath = relative(root, absolutePath).split(sep).join('/')
  if (relativePath.length === 0) throw new Error(`tool ${toolCallId} path must identify a file`)
  return { absolutePath, relativePath }
}

/**
 * Prospective tool executor for F0-v2. It is deliberately separate from the
 * frozen F0/E0 executor so enabling richer provenance cannot mutate a prior
 * execution surface or alter a consumed study's evidence semantics.
 */
export class C1F0ProspectiveToolExecutor {
  private readonly sandboxRoot: string
  private readonly commandTimeoutMs: number
  private readonly outputLimitBytes: number
  private readonly provenanceEnabled: boolean
  private readonly recoveryEnabled: boolean
  private readonly maxIdenticalFailureAttempts: number
  private readonly failureSignatures = new Set<string>()
  private lastFailureSignature: string | undefined
  private consecutiveFailureStreak = 0
  private pendingRecovery:
    { readonly toolCallId: string; readonly nextAttemptOrdinal: number } | undefined

  constructor(root: string, options: C1F0ProspectiveToolExecutorOptions = {}) {
    this.sandboxRoot = resolve(root)
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    this.outputLimitBytes = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES
    this.provenanceEnabled =
      options.provenanceEnabled === true || options.recoveryPolicy !== undefined
    this.recoveryEnabled =
      options.recoveryPolicy?.enabled !== false && options.recoveryPolicy !== undefined
    this.maxIdenticalFailureAttempts = options.recoveryPolicy?.maxIdenticalFailureAttempts ?? 2
    if (
      !Number.isSafeInteger(this.commandTimeoutMs) ||
      this.commandTimeoutMs < 1 ||
      !Number.isSafeInteger(this.outputLimitBytes) ||
      this.outputLimitBytes < 1 ||
      !Number.isSafeInteger(this.maxIdenticalFailureAttempts) ||
      this.maxIdenticalFailureAttempts < 1 ||
      this.maxIdenticalFailureAttempts > 10
    ) {
      throw new Error('invalid prospective tool hardening limits')
    }
  }

  async execute(requests: readonly C1F0ToolRequest[]): Promise<C1F0ToolLoopResult> {
    const executions: C1F0ToolExecution[] = []
    const resultContents = new Map<string, string>()
    let failedExecutions = 0
    let recoveredExecutions = 0
    let blockedRepeatedFailures = 0
    for (const request of requests) {
      const requestSignature = canonicalRequestSignature(request)
      const sameAsLastFailure = this.lastFailureSignature === requestSignature
      if (!sameAsLastFailure) {
        this.lastFailureSignature = undefined
        this.consecutiveFailureStreak = 0
      }
      const priorFailureStreak = sameAsLastFailure ? this.consecutiveFailureStreak : 0
      const recoveryLink = this.pendingRecovery
      const beforeSnapshot = await this.snapshotOrNull()
      let attempt: ToolAttempt
      let consecutiveFailureStreak = 0
      let action: C1F0ToolRecoveryAction = 'NONE'
      if (
        this.recoveryEnabled &&
        sameAsLastFailure &&
        priorFailureStreak >= this.maxIdenticalFailureAttempts
      ) {
        consecutiveFailureStreak = priorFailureStreak + 1
        action = 'BLOCKED_REPEATED_FAILURE'
        blockedRepeatedFailures += 1
        failedExecutions += 1
        this.recordFailure(requestSignature, request.toolCallId, recoveryLink)
        attempt = {
          result: 'ERROR',
          content: recoveryContent(
            'tool execution was blocked after repeated identical failures',
            'REPEATED_FAILURE_BLOCKED',
            action,
            consecutiveFailureStreak
          ),
          failureClass: 'REPEATED_FAILURE_BLOCKED',
          commandClass:
            request.toolName === 'bash'
              ? commandClass(commandFromArguments(request) ?? '')
              : 'NOT_APPLICABLE'
        }
      } else {
        try {
          attempt = await this.executeOne(request)
          if (attempt.result === 'ERROR') {
            const failureClass = attempt.failureClass ?? 'UNKNOWN'
            consecutiveFailureStreak = this.recordFailure(
              requestSignature,
              request.toolCallId,
              recoveryLink
            )
            action = recoveryAction(failureClass)
            failedExecutions += 1
            attempt = {
              ...attempt,
              failureClass,
              content: recoveryContent(
                attempt.content,
                failureClass,
                action,
                consecutiveFailureStreak
              )
            }
          } else {
            if (recoveryLink !== undefined) recoveredExecutions += 1
            this.recordSuccess()
          }
        } catch (error) {
          const failureClass = classifyFailure(request, error)
          consecutiveFailureStreak = this.recordFailure(
            requestSignature,
            request.toolCallId,
            recoveryLink
          )
          action = recoveryAction(failureClass)
          failedExecutions += 1
          attempt = {
            result: 'ERROR',
            content: recoveryContent(
              this.errorContent(error),
              failureClass,
              action,
              consecutiveFailureStreak
            ),
            failureClass,
            commandClass:
              request.toolName === 'bash'
                ? commandClass(commandFromArguments(request) ?? '')
                : 'NOT_APPLICABLE'
          }
        }
      }
      const afterSnapshot = await this.snapshotOrNull()
      const changedPaths =
        this.provenanceEnabled && beforeSnapshot !== null && afterSnapshot !== null
          ? changedC1FixturePaths(beforeSnapshot, afterSnapshot)
          : []
      const command = commandFromArguments(request)
      const failureClass = attempt.failureClass ?? 'NONE'
      const beforeSnapshotHash = snapshotHash(beforeSnapshot)
      const afterSnapshotHash = snapshotHash(afterSnapshot)
      const provenance: C1F0ToolExecutionProvenance = {
        canonicalRequestSignature: requestSignature,
        failureClass,
        commandClass:
          attempt.commandClass ??
          (command === undefined ? 'NOT_APPLICABLE' : commandClass(command)),
        ...(command === undefined ? {} : { commandHash: sha256(command) }),
        ...(failureClass === 'NONE' ? {} : { errorDigest: sha256(attempt.content) }),
        changedPaths,
        sideEffectSource:
          changedPaths.length === 0
            ? 'NONE'
            : request.toolName === 'edit'
              ? 'EDIT_TOOL'
              : request.toolName === 'bash'
                ? 'BASH_TOOL'
                : 'UNKNOWN',
        snapshotStatus:
          beforeSnapshot !== null && afterSnapshot !== null ? 'COMPLETE' : 'UNAVAILABLE',
        ...(beforeSnapshotHash === undefined ? {} : { beforeSnapshotHash }),
        ...(afterSnapshotHash === undefined ? {} : { afterSnapshotHash }),
        consecutiveFailureStreak,
        recoveryAction: action,
        ...(recoveryLink === undefined
          ? {}
          : {
              recoveryOfToolCallId: recoveryLink.toolCallId,
              recoveryAttemptOrdinal: recoveryLink.nextAttemptOrdinal
            })
      }
      const execution: C1F0ToolExecution = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        ...(attempt.path === undefined ? {} : { path: attempt.path }),
        result: attempt.result,
        provenance
      }
      executions.push(execution)
      resultContents.set(request.toolCallId, attempt.content)
    }
    return {
      executions: Object.freeze(executions),
      resultContents,
      recoverySummary: {
        failedExecutions,
        recoveredExecutions,
        blockedRepeatedFailures,
        uniqueFailureSignatures: this.failureSignatures.size
      }
    }
  }

  private recordFailure(
    requestSignature: string,
    toolCallId: string,
    recoveryLink: { readonly toolCallId: string; readonly nextAttemptOrdinal: number } | undefined
  ): number {
    const nextStreak =
      this.lastFailureSignature === requestSignature ? this.consecutiveFailureStreak + 1 : 1
    this.lastFailureSignature = requestSignature
    this.consecutiveFailureStreak = nextStreak
    this.failureSignatures.add(requestSignature)
    this.pendingRecovery = {
      toolCallId,
      nextAttemptOrdinal: (recoveryLink?.nextAttemptOrdinal ?? 0) + 1
    }
    return nextStreak
  }

  private recordSuccess(): void {
    this.lastFailureSignature = undefined
    this.consecutiveFailureStreak = 0
    this.pendingRecovery = undefined
  }

  private async snapshotOrNull(): Promise<ReadonlyMap<string, string> | null> {
    if (!this.provenanceEnabled) return null
    try {
      return await snapshotC1Fixture(this.sandboxRoot)
    } catch {
      return null
    }
  }

  private async executeOne(request: C1F0ToolRequest): Promise<ToolAttempt> {
    const argumentsRecord = parseArguments(request)
    if (request.toolName === 'read') {
      const path = safePath(
        this.sandboxRoot,
        requiredString(argumentsRecord, 'path', request.toolCallId),
        request.toolCallId
      )
      try {
        return {
          result: 'SUCCESS',
          content: await readFile(path.absolutePath, 'utf8'),
          path: path.relativePath
        }
      } catch (error) {
        throw error
      }
    }
    if (request.toolName === 'edit') {
      const path = safePath(
        this.sandboxRoot,
        requiredString(argumentsRecord, 'path', request.toolCallId),
        request.toolCallId
      )
      const oldText = requiredString(argumentsRecord, 'oldText', request.toolCallId)
      const newText = requiredText(argumentsRecord, 'newText', request.toolCallId)
      const existing = await readFile(path.absolutePath, 'utf8')
      const matches = countOccurrences(existing, oldText)
      if (matches !== 1) {
        throw new Error(
          `edit ${path.relativePath} expected one oldText match, received ${String(matches)}`
        )
      }
      await mkdir(resolve(path.absolutePath, '..'), { recursive: true })
      await writeFile(
        path.absolutePath,
        existing.replace(oldText, () => newText),
        'utf8'
      )
      return { result: 'SUCCESS', content: `edited ${path.relativePath}`, path: path.relativePath }
    }
    if (request.toolName === 'bash') {
      const command = requiredString(argumentsRecord, 'command', request.toolCallId)
      const processResult = await runProcess('bash', ['-lc', command], {
        cwd: this.sandboxRoot,
        timeoutMs: this.commandTimeoutMs,
        maxOutputBytes: this.outputLimitBytes,
        env: buildSanitizedChildEnvironment()
      })
      const content = `${processResult.stdout}${processResult.stderr}`
      const succeeded =
        processResult.exitCode === 0 &&
        !processResult.timedOut &&
        !processResult.outputLimitExceeded
      return {
        result: succeeded ? 'SUCCESS' : 'ERROR',
        content:
          content.length > 0 ? content : `bash exited with ${String(processResult.exitCode)}`,
        ...(succeeded
          ? {}
          : {
              failureClass: processResult.timedOut
                ? 'COMMAND_TIMEOUT'
                : processResult.outputLimitExceeded
                  ? 'COMMAND_OUTPUT_LIMIT'
                  : 'COMMAND_FAILED'
            }),
        commandClass: commandClass(command)
      }
    }
    throw new Error(`unsupported C1 tool ${request.toolName}`)
  }

  private errorContent(error: unknown): string {
    return `tool execution error: ${error instanceof Error ? error.message : String(error)}`
  }
}

export async function computeC1F0ToolSnapshotSummary(root: string): Promise<{
  readonly contentSha256: string
  readonly fileCount: number
  readonly files: readonly string[]
}> {
  const summary = await computeC1FixtureContentSummary(root)
  return {
    contentSha256: summary.sha256,
    fileCount: summary.fileCount,
    files: summary.files
  }
}
