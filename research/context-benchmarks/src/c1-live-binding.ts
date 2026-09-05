import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  ContextWorkingSet,
  RemovalRecord,
  SourceLifecycleSignal
} from '@canvas-agent/context-runtime'
import type { PiMessageView } from '@canvas-agent/pi-context-integration'
import {
  createRunKillSwitch,
  type RunKillSwitch
} from '@canvas-agent/pi-context-integration/experimental'
import {
  C1_C_ASSIGNMENT_MATRIX_SHA256,
  C1_C_CONTRACT_SHA256,
  C1_C_TASK_MANIFEST_SHA256,
  C1_C_TREATMENT_REVISION,
  runC1TreatmentReadiness
} from './c1-treatment-readiness'
import {
  type C1AgentObservation,
  type C1FrozenStudy,
  C1HardBudgetGuard,
  C1LegExecutor,
  C1PreflightFailure,
  C1PreflightFakeTransport,
  type C1LegExecutionResult,
  type C1PreflightTask,
  type C1ProviderBoundCapture,
  C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE,
  type C1ProviderStructuralEnvelope,
  type C1StrictProviderBinding,
  type C1ProviderTransport,
  C1_NODE_RANGE,
  C1_MODEL_ID,
  C1_PROVIDER_ENDPOINT,
  C1_PROVIDER_ID,
  captureC1PreflightArm,
  computeC1FixtureContentSummary,
  createC1ObservedReadTrace,
  loadC1FrozenStudy,
  materializeFreshC1Fixture,
  nodeVersionSatisfiesC1Range,
  observedC1SourceKeys,
  prepareC1StrictProvider,
  validateC1ProviderUsage,
  type C1ProviderReportedUsage
} from './c1-live-preflight'
import { runProcess } from './fixture-generator'

/**
 * C1 live-execution binding is the last zero-provider layer before a live
 * authorization. It reuses C1LegExecutor and changes only the response source
 * and outbound budget boundary. The readiness source is scripted and never
 * opens a socket; an authorized provider source can be supplied later through
 * the same driver.
 */

export const C1_LIVE_BINDING_ID = 'C1_LIVE_EXECUTION_BINDING_V1'
export const C1_LIVE_BINDING_MODE = 'CREDENTIAL_FREE_SCRIPTED_RESPONSES'
export const C1_LIVE_BINDING_STUDY_ID = 'c1-live-binding-readiness-study-v1'

export type C1LiveResponseSourceKind = 'SCRIPTED_FAKE' | 'AUTHORIZED_PROVIDER'
export type C1LiveTaskOutcome = 'CONTINUE' | 'COMPLETE' | 'FAILED'

export interface C1ScriptedUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly totalTokens: number
  /** SCRIPTED_FAKE is synthetic shape evidence, not provider usage. */
  readonly usageSource: 'SCRIPTED_FAKE'
}

export type C1LiveUsage = C1ScriptedUsage | C1ProviderReportedUsage

export interface C1LiveToolRequest {
  readonly toolCallId: string
  readonly toolName: string
  readonly argumentsJson: string
}

/**
 * Metadata-only representation of a provider tool request. The full
 * arguments remain available in-memory for execution and the next model
 * observation, but are never written to durable evidence.
 */
export interface C1LiveToolRequestEvidence {
  readonly toolCallId: string
  readonly toolName: string
  readonly argumentHash: string
  readonly path?: string
}

export interface C1LiveToolExecution {
  readonly toolCallId: string
  readonly toolName: string
  readonly path?: string
  readonly result: 'SUCCESS' | 'ERROR'
}

export interface C1LiveModelResponse {
  readonly responseId: string
  readonly assistantMessageCount: number
  /** In-memory only; evidence serializers must never persist raw assistant content. */
  readonly assistantContent: string
  readonly usage: C1LiveUsage
  readonly toolRequests: readonly C1LiveToolRequest[]
  readonly toolExecutions: readonly C1LiveToolExecution[]
  readonly outcome: C1LiveTaskOutcome
}

export interface C1LiveOutboundRequest {
  readonly capture: C1ProviderBoundCapture
  /** In-memory only. Evidence serializers must never include this field. */
  readonly providerBoundMessages: readonly PiMessageView[]
  /** Executor-owned structural context; evidence serializers must omit it. */
  readonly structuralEnvelope: C1ProviderStructuralEnvelope
}

export interface C1LiveResponseSource {
  readonly kind: C1LiveResponseSourceKind
  next(
    request: C1LiveOutboundRequest,
    options?: { readonly signal?: AbortSignal }
  ): Promise<C1LiveModelResponse>
}

export interface C1LiveObservationSource {
  readonly initialObservation: C1AgentObservation
  next(input: {
    readonly callOrdinal: number
    readonly previousObservation: C1AgentObservation
    readonly previousExecution: C1LegExecutionResult
    readonly response: C1LiveModelResponse
    /** Actual tool-loop observation, when a C1LiveToolExecutor handled requests. */
    readonly toolObservation?: C1AgentObservation
  }): C1AgentObservation
}

export interface C1LiveToolLoopResult {
  readonly executions: readonly C1LiveToolExecution[]
  /** In-memory only; raw tool result content is never part of durable evidence. */
  readonly observation: C1AgentObservation
}

export interface C1LiveToolExecutor {
  execute(input: {
    readonly previousObservation: C1AgentObservation
    readonly response: C1LiveModelResponse
    readonly observationId: string
  }): Promise<C1LiveToolLoopResult>
}

export class C1ScriptedResponseSource implements C1LiveResponseSource {
  readonly kind = 'SCRIPTED_FAKE' as const
  private cursor = 0

  constructor(private readonly responses: readonly C1LiveModelResponse[]) {}

  get responsesServed(): number {
    return this.cursor
  }

  async next(request: C1LiveOutboundRequest): Promise<C1LiveModelResponse> {
    if (request.capture.modelCallId.length === 0) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'scripted source received an unstable call id'
      )
    }
    const response = this.responses[this.cursor]
    if (response === undefined) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `scripted response source exhausted at ${this.cursor + 1}`
      )
    }
    this.cursor += 1
    return response
  }
}

export class C1ScriptedObservationSource implements C1LiveObservationSource {
  readonly initialObservation: C1AgentObservation

  constructor(private readonly observations: readonly C1AgentObservation[]) {
    const initialObservation = observations[0]
    if (initialObservation === undefined) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'observation source requires an initial observation'
      )
    }
    this.initialObservation = initialObservation
  }

  next(input: {
    readonly callOrdinal: number
    readonly toolObservation?: C1AgentObservation
  }): C1AgentObservation {
    if (input.toolObservation !== undefined) return input.toolObservation
    const observation = this.observations[input.callOrdinal]
    if (observation === undefined) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `observation source exhausted after call ${input.callOrdinal}`
      )
    }
    return observation
  }
}

function validateLiveUsage(value: unknown, sourceKind: C1LiveResponseSourceKind): C1LiveUsage {
  if (sourceKind === 'AUTHORIZED_PROVIDER') return validateC1ProviderUsage(value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new C1PreflightFailure('USAGE_CONTRACT_MISMATCH', 'scripted usage must be an object')
  }
  const record = value as Record<string, unknown>
  if (record['usageSource'] !== 'SCRIPTED_FAKE') {
    throw new C1PreflightFailure(
      'USAGE_CONTRACT_MISMATCH',
      'scripted readiness usage must not claim provider-reported provenance'
    )
  }
  const numbers = [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'totalTokens'
  ]
  for (const key of numbers) {
    const candidate = record[key]
    if (!Number.isInteger(candidate) || (candidate as number) < 0) {
      throw new C1PreflightFailure(
        'USAGE_CONTRACT_MISMATCH',
        `scripted usage ${key} must be a non-negative integer`
      )
    }
  }
  return {
    inputTokens: record['inputTokens'] as number,
    outputTokens: record['outputTokens'] as number,
    cacheReadTokens: record['cacheReadTokens'] as number,
    cacheWriteTokens: record['cacheWriteTokens'] as number,
    totalTokens: record['totalTokens'] as number,
    usageSource: 'SCRIPTED_FAKE'
  }
}

function validateModelResponse(
  response: C1LiveModelResponse,
  sourceKind: C1LiveResponseSourceKind
): C1LiveUsage {
  if (response.responseId.length === 0) {
    throw new C1PreflightFailure(
      'PREFLIGHT_FAILURE',
      'model response is missing a stable response id'
    )
  }
  if (!Number.isInteger(response.assistantMessageCount) || response.assistantMessageCount < 1) {
    throw new C1PreflightFailure(
      'PREFLIGHT_FAILURE',
      'every live model response must contain at least one assistant message'
    )
  }
  if (typeof response.assistantContent !== 'string') {
    throw new C1PreflightFailure(
      'PREFLIGHT_FAILURE',
      'model response assistant content must be a normalized string'
    )
  }
  if (!['CONTINUE', 'COMPLETE', 'FAILED'].includes(response.outcome)) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'model response has an unknown task outcome')
  }
  const requestIds = new Set<string>()
  const requestsById = new Map<string, C1LiveToolRequest>()
  for (const request of response.toolRequests) {
    if (
      request.toolCallId.length === 0 ||
      request.toolName.length === 0 ||
      request.argumentsJson.length === 0 ||
      requestIds.has(request.toolCallId)
    ) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'model response contains an unstable tool request'
      )
    }
    try {
      JSON.parse(request.argumentsJson)
    } catch {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `model response tool request ${request.toolCallId} has invalid JSON arguments`
      )
    }
    requestIds.add(request.toolCallId)
    requestsById.set(request.toolCallId, request)
  }
  const executionIds = new Set<string>()
  for (const execution of response.toolExecutions) {
    const request = requestsById.get(execution.toolCallId)
    if (
      execution.toolCallId.length === 0 ||
      execution.toolName.length === 0 ||
      executionIds.has(execution.toolCallId) ||
      request === undefined ||
      request.toolName !== execution.toolName
    ) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'model response contains an execution without a matching tool request'
      )
    }
    if (execution.result !== 'SUCCESS' && execution.result !== 'ERROR') {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'model response contains an unknown tool execution result'
      )
    }
    executionIds.add(execution.toolCallId)
  }
  return validateLiveUsage(response.usage, sourceKind)
}

function parseToolArguments(argumentsJson: string, toolCallId: string): unknown {
  try {
    return JSON.parse(argumentsJson) as unknown
  } catch {
    throw new C1PreflightFailure(
      'PREFLIGHT_FAILURE',
      `tool request ${toolCallId} has invalid JSON arguments`
    )
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function toolRequestEvidence(request: C1LiveToolRequest): C1LiveToolRequestEvidence {
  const parsed = parseToolArguments(request.argumentsJson, request.toolCallId)
  const pathValue =
    request.toolName === 'read' || request.toolName === 'edit'
      ? parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)['path']
        : undefined
      : undefined
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    argumentHash: sha256(request.argumentsJson),
    ...(typeof pathValue === 'string' && pathValue.length > 0 ? { path: pathValue } : {})
  }
}

/**
 * Add only in-memory messages needed to make the next planning boundary
 * multi-call realistic. Normalized assistant text and tool results are
 * available to the next provider call, but the returned observation is not a
 * durable evidence artifact; callers choose which lifecycle fields to overlay
 * before the next leg boundary.
 */
export function appendC1LiveResponseToObservation(
  observation: C1AgentObservation,
  response: C1LiveModelResponse,
  observationId: string,
  toolResultContents: ReadonlyMap<string, string> = new Map()
): C1AgentObservation {
  const toolBlocks = response.toolRequests.map((tool) => ({
    type: 'toolCall',
    id: tool.toolCallId,
    name: tool.toolName,
    arguments: parseToolArguments(tool.argumentsJson, tool.toolCallId)
  }))
  const messages: PiMessageView[] = [
    ...observation.messages,
    {
      role: 'assistant',
      content: [
        ...(response.assistantContent.length > 0
          ? [{ type: 'text', text: response.assistantContent }]
          : []),
        ...toolBlocks
      ]
    }
  ]
  for (const tool of response.toolExecutions) {
    messages.push({
      role: 'toolResult',
      content: [
        {
          type: 'text',
          text: toolResultContents.get(tool.toolCallId) ?? `scripted result ${tool.toolCallId}`
        }
      ],
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      isError: tool.result === 'ERROR'
    })
  }
  const sourceKeys = observedC1SourceKeys(messages, observationId, messages.length)
  return {
    ...observation,
    observationId,
    messages: Object.freeze(messages),
    currentTargetSourceKeys: sourceKeys,
    excludedSourceKeys: [],
    latestVerificationSourceKeys: [],
    recentEvidenceSourceKeys: [],
    previousWorkingSetId: null
  }
}

const C1_TOOL_COMMAND_TIMEOUT_MS = 30_000
const C1_TOOL_OUTPUT_LIMIT_BYTES = 64 * 1024

function toolArgumentRecord(value: unknown, toolCallId: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`tool ${toolCallId} arguments must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredToolString(
  argumentsRecord: Record<string, unknown>,
  key: string,
  toolCallId: string
): string {
  const value = argumentsRecord[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`tool ${toolCallId} argument ${key} must be a non-empty string`)
  }
  return value
}

function requiredToolText(
  argumentsRecord: Record<string, unknown>,
  key: string,
  toolCallId: string
): string {
  const value = argumentsRecord[key]
  if (typeof value !== 'string') {
    throw new Error(`tool ${toolCallId} argument ${key} must be a string`)
  }
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

interface C1SandboxPath {
  readonly absolutePath: string
  readonly relativePath: string
}

/**
 * Executes the three frozen C1 tools inside one fresh fixture sandbox. Raw
 * results are returned only through the in-memory observation; the driver
 * persists normalized tool metadata instead.
 */
export class C1SandboxToolExecutor implements C1LiveToolExecutor {
  private readonly sandboxRoot: string
  private readonly commandTimeoutMs: number
  private readonly outputLimitBytes: number

  constructor(
    sandboxRoot: string,
    options: {
      readonly commandTimeoutMs?: number
      readonly outputLimitBytes?: number
    } = {}
  ) {
    this.sandboxRoot = resolve(sandboxRoot)
    this.commandTimeoutMs = options.commandTimeoutMs ?? C1_TOOL_COMMAND_TIMEOUT_MS
    this.outputLimitBytes = options.outputLimitBytes ?? C1_TOOL_OUTPUT_LIMIT_BYTES
    if (!Number.isSafeInteger(this.commandTimeoutMs) || this.commandTimeoutMs < 1) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'C1 sandbox tool command timeout must be a positive integer'
      )
    }
    if (!Number.isSafeInteger(this.outputLimitBytes) || this.outputLimitBytes < 1) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'C1 sandbox tool output limit must be a positive integer'
      )
    }
  }

  async execute(input: {
    readonly previousObservation: C1AgentObservation
    readonly response: C1LiveModelResponse
    readonly observationId: string
  }): Promise<C1LiveToolLoopResult> {
    if (input.response.toolExecutions.length > 0) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'tool executor received provider-prepopulated tool executions'
      )
    }
    const executions: C1LiveToolExecution[] = []
    const resultContents = new Map<string, string>()
    for (const request of input.response.toolRequests) {
      try {
        const result = await this.executeRequest(request)
        executions.push({
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          ...(result.path === undefined ? {} : { path: result.path }),
          result: result.result
        })
        resultContents.set(request.toolCallId, result.content)
      } catch (error) {
        executions.push({
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          result: 'ERROR'
        })
        resultContents.set(request.toolCallId, this.errorContent(error))
      }
    }
    const responseWithExecutions: C1LiveModelResponse = {
      ...input.response,
      toolExecutions: Object.freeze(executions)
    }
    return {
      executions: Object.freeze(executions),
      observation: appendC1LiveResponseToObservation(
        input.previousObservation,
        responseWithExecutions,
        input.observationId,
        resultContents
      )
    }
  }

  private async executeRequest(request: C1LiveToolRequest): Promise<{
    readonly result: 'SUCCESS' | 'ERROR'
    readonly content: string
    readonly path?: string
  }> {
    const argumentsRecord = toolArgumentRecord(
      parseToolArguments(request.argumentsJson, request.toolCallId),
      request.toolCallId
    )
    if (request.toolName === 'read') {
      const path = this.sandboxPath(
        requiredToolString(argumentsRecord, 'path', request.toolCallId),
        request.toolCallId
      )
      return {
        result: 'SUCCESS',
        content: await readFile(path.absolutePath, 'utf8'),
        path: path.relativePath
      }
    }
    if (request.toolName === 'edit') {
      const path = this.sandboxPath(
        requiredToolString(argumentsRecord, 'path', request.toolCallId),
        request.toolCallId
      )
      const oldText = requiredToolString(argumentsRecord, 'oldText', request.toolCallId)
      const newText = requiredToolText(argumentsRecord, 'newText', request.toolCallId)
      const existing = await readFile(path.absolutePath, 'utf8')
      const matches = countOccurrences(existing, oldText)
      if (matches !== 1) {
        throw new Error(
          `edit ${path.relativePath} expected one oldText match, received ${String(matches)}`
        )
      }
      await writeFile(path.absolutePath, existing.replace(oldText, newText), 'utf8')
      return {
        result: 'SUCCESS',
        content: `edited ${path.relativePath}`,
        path: path.relativePath
      }
    }
    if (request.toolName === 'bash') {
      const command = requiredToolString(argumentsRecord, 'command', request.toolCallId)
      const processResult = await runProcess('bash', ['-lc', command], {
        cwd: this.sandboxRoot,
        timeoutMs: this.commandTimeoutMs,
        maxOutputBytes: this.outputLimitBytes
      })
      const content = `${processResult.stdout}${processResult.stderr}`
      const succeeded =
        processResult.exitCode === 0 &&
        !processResult.timedOut &&
        !processResult.outputLimitExceeded
      return {
        result: succeeded ? 'SUCCESS' : 'ERROR',
        content: content.length > 0 ? content : `bash exited with ${String(processResult.exitCode)}`
      }
    }
    throw new Error(`unsupported C1 tool ${request.toolName}`)
  }

  private sandboxPath(value: string, toolCallId: string): C1SandboxPath {
    if (isAbsolute(value)) {
      throw new Error(`tool ${toolCallId} path must be relative to the fixture sandbox`)
    }
    const absolutePath = resolve(this.sandboxRoot, value)
    if (
      absolutePath !== this.sandboxRoot &&
      !absolutePath.startsWith(`${this.sandboxRoot}${sep}`)
    ) {
      throw new Error(`tool ${toolCallId} path escapes the fixture sandbox`)
    }
    const relativePath = relative(this.sandboxRoot, absolutePath).split(sep).join('/')
    if (relativePath.length === 0) {
      throw new Error(`tool ${toolCallId} path must identify a file inside the fixture sandbox`)
    }
    return { absolutePath, relativePath }
  }

  private errorContent(error: unknown): string {
    return `tool execution error: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Capture-only transport used by the shared driver before its send permit. */
export class C1LiveBindingTransport implements C1ProviderTransport {
  private pending: {
    readonly capture: C1ProviderBoundCapture
    readonly providerBoundMessages: readonly PiMessageView[]
    readonly structuralEnvelope: C1ProviderStructuralEnvelope | null
  } | null = null
  private readonly validator: C1PreflightFakeTransport
  private readonly sent: C1LiveOutboundRequest[] = []
  private attempts = 0
  private blockedAttempts = 0

  constructor(expectedBinding: {
    readonly provider: C1ProviderBoundCapture['provider']
    readonly model: C1ProviderBoundCapture['model']
    readonly endpoint: C1ProviderBoundCapture['endpoint']
    readonly providerConfigHash: string
  }) {
    this.validator = new C1PreflightFakeTransport(expectedBinding)
  }

  get sentCaptures(): readonly C1ProviderBoundCapture[] {
    return this.sent.map((request) => request.capture)
  }

  get sendAttempts(): number {
    return this.attempts
  }

  get blockedSendAttempts(): number {
    return this.blockedAttempts
  }

  get providerCalls(): 0 {
    return 0
  }

  get networkRequests(): 0 {
    return 0
  }

  capture(request: C1ProviderBoundCapture): void {
    if (this.pending !== null) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'live binding transport has an unsent capture'
      )
    }
    this.validator.capture(request)
    this.pending = {
      capture: request,
      providerBoundMessages: [],
      structuralEnvelope: null
    }
  }

  attachProviderBoundMessages(
    messages: readonly PiMessageView[],
    structuralEnvelope: C1ProviderStructuralEnvelope
  ): void {
    if (this.pending === null) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'provider-bound messages attached without a pending capture'
      )
    }
    if (this.pending.providerBoundMessages.length > 0) {
      throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'provider-bound messages already attached')
    }
    if (this.pending.structuralEnvelope !== null) {
      throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'structural envelope already attached')
    }
    if (
      structuralEnvelope !== C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE ||
      structuralEnvelope.structuralFingerprint !==
        this.pending.capture.systemDeveloperToolStructuresFingerprint
    ) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'executor structural envelope does not match the provider-bound capture fingerprint'
      )
    }
    this.pending = {
      capture: this.pending.capture,
      providerBoundMessages: Object.freeze([...messages]),
      structuralEnvelope
    }
  }

  async send(input: {
    readonly budgetGuard: C1HardBudgetGuard
    readonly responseSource: C1LiveResponseSource
    readonly killSwitch?: RunKillSwitch
    readonly signal?: AbortSignal
    readonly nowMs?: number
    readonly transportSendAttemptOrdinal?: number
    readonly onOutboundPermitted?: (input: {
      readonly request: C1LiveOutboundRequest
      readonly providerCallOrdinal: number
      readonly transportSendAttemptOrdinal: number
    }) => void | Promise<void>
  }): Promise<C1LiveModelResponse> {
    this.attempts += 1
    const pending = this.pending
    this.pending = null
    if (pending === null) {
      this.blockedAttempts += 1
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'live binding transport send has no capture'
      )
    }
    if (pending.providerBoundMessages.length === 0) {
      this.blockedAttempts += 1
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'live binding transport send has no in-memory provider-bound messages'
      )
    }
    if (pending.structuralEnvelope === null) {
      this.blockedAttempts += 1
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'live binding transport send has no executor-owned structural envelope'
      )
    }
    if (input.killSwitch?.isTripped === true) {
      this.blockedAttempts += 1
      throw new C1PreflightFailure(
        'KILL_SWITCH_BLOCKED',
        'kill switch blocked live binding transport send'
      )
    }
    try {
      input.budgetGuard.assertWallClockBudget(input.nowMs)
      input.budgetGuard.recordProviderCall()
    } catch (error) {
      this.blockedAttempts += 1
      throw error
    }
    const request: C1LiveOutboundRequest = {
      capture: pending.capture,
      providerBoundMessages: pending.providerBoundMessages,
      structuralEnvelope: pending.structuralEnvelope
    }
    this.sent.push(request)
    await input.onOutboundPermitted?.({
      request,
      providerCallOrdinal: input.budgetGuard.ledger.providerCalls,
      transportSendAttemptOrdinal: input.transportSendAttemptOrdinal ?? this.attempts
    })
    return input.responseSource.next(request, {
      ...(input.signal === undefined ? {} : { signal: input.signal })
    })
  }
}

export interface C1LiveBindingEvidence {
  readonly studyId: string
  readonly taskId: string
  readonly stratum: string
  readonly pairId: string
  readonly arm: 'NATIVE' | 'RUNTIME'
  readonly runId: string
  readonly callOrdinal: number
  readonly turnId: string
  readonly modelCallId: string
  readonly responseId: string
  readonly responseSource: C1LiveResponseSourceKind
  readonly assistantMessages: number
  readonly usage: C1LiveUsage
  readonly toolCalls: number
  readonly toolRequestEvidence: readonly C1LiveToolRequestEvidence[]
  readonly toolEvents: readonly {
    readonly toolCallId: string
    readonly toolName: string
    readonly path?: string
    readonly result: 'SUCCESS' | 'ERROR'
  }[]
  readonly taskOutcome: C1LiveTaskOutcome
  readonly provider: C1ProviderBoundCapture['provider']
  readonly model: C1ProviderBoundCapture['model']
  readonly endpoint: C1ProviderBoundCapture['endpoint']
  readonly providerConfigHash: string
  readonly contextStrategy: C1ProviderBoundCapture['contextStrategy']
  readonly providerBoundSourceKeys: readonly string[]
  readonly modelVisibleSemanticContextFingerprint: string
  readonly systemDeveloperToolStructuresFingerprint: string
  readonly workingSetId: string
  readonly transitionId: string
  readonly transitionDecisionKinds: readonly string[]
  readonly lifecycleEligible: boolean
  readonly runtimeContextChanged: boolean
  readonly fallbackSent: false
  readonly networkSent: boolean
  readonly replayMismatch: 0
}

export type C1LiveBindingCheckpoint =
  | {
      readonly checkpointOrdinal: number
      readonly phase: 'OUTBOUND_PERMITTED'
      readonly callOrdinal: number
      readonly providerCallOrdinal: number
      readonly transportSendAttemptOrdinal: number
      readonly capture: C1ProviderBoundCapture
    }
  | {
      readonly checkpointOrdinal: number
      readonly phase: 'RESPONSE_RECORDED'
      readonly callOrdinal: number
      readonly evidence: C1LiveBindingEvidence
    }

type C1LiveBindingCheckpointInput =
  | Omit<
      Extract<C1LiveBindingCheckpoint, { readonly phase: 'OUTBOUND_PERMITTED' }>,
      'checkpointOrdinal'
    >
  | Omit<
      Extract<C1LiveBindingCheckpoint, { readonly phase: 'RESPONSE_RECORDED' }>,
      'checkpointOrdinal'
    >

/**
 * Metadata-only checkpoint sink. A live implementation can replace this with
 * a durable writer; provider-bound messages and raw response payloads are not
 * part of this interface.
 */
export interface C1LiveBindingEvidenceSink {
  append(checkpoint: C1LiveBindingCheckpoint): void | Promise<void>
}

export class C1JsonlLiveBindingEvidenceSink implements C1LiveBindingEvidenceSink {
  private readonly entries: C1LiveBindingCheckpoint[] = []

  constructor(readonly checkpointPath: string) {}

  async append(checkpoint: C1LiveBindingCheckpoint): Promise<void> {
    const serialized = JSON.stringify(checkpoint)
    if (/providerBoundMessages|argumentsJson/.test(serialized)) {
      throw new C1PreflightFailure(
        'EVIDENCE_WRITE_FAILURE',
        'metadata-only checkpoint unexpectedly contains provider-bound messages or raw tool arguments'
      )
    }
    await mkdir(dirname(this.checkpointPath), { recursive: true })
    const handle = await open(this.checkpointPath, 'a')
    try {
      await handle.write(`${serialized}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    this.entries.push(checkpoint)
  }

  get checkpoints(): readonly C1LiveBindingCheckpoint[] {
    return [...this.entries]
  }
}

export function validateC1LiveBindingEvidence(
  evidence: readonly C1LiveBindingEvidence[],
  expected: {
    readonly arm: 'NATIVE' | 'RUNTIME'
    readonly responseSource: C1LiveResponseSourceKind
    readonly providerConfigHash: string
  }
): void {
  if (evidence.length === 0) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'live binding evidence is empty')
  }
  const turns = new Set<string>()
  const modelCalls = new Set<string>()
  const expectedNetworkSent = expected.responseSource === 'AUTHORIZED_PROVIDER'
  for (const [index, row] of evidence.entries()) {
    if (
      row.callOrdinal !== index + 1 ||
      row.arm !== expected.arm ||
      row.responseSource !== expected.responseSource ||
      row.providerConfigHash !== expected.providerConfigHash ||
      row.providerBoundSourceKeys.length === 0 ||
      row.modelVisibleSemanticContextFingerprint.length === 0 ||
      row.workingSetId.length === 0 ||
      row.transitionId.length === 0 ||
      row.fallbackSent ||
      row.networkSent !== expectedNetworkSent ||
      row.replayMismatch !== 0 ||
      row.toolCalls !== row.toolRequestEvidence.length ||
      row.assistantMessages < 1
    ) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `live binding evidence failed stable-join validation at call ${row.callOrdinal}`
      )
    }
    if (turns.has(row.turnId) || modelCalls.has(row.modelCallId)) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `live binding evidence reused a turn or model call id at ${row.callOrdinal}`
      )
    }
    turns.add(row.turnId)
    modelCalls.add(row.modelCallId)
    const requestNames = new Map<string, string>()
    for (const request of row.toolRequestEvidence) {
      if (
        request.toolCallId.length === 0 ||
        request.toolName.length === 0 ||
        !/^[a-f0-9]{64}$/.test(request.argumentHash) ||
        (request.path !== undefined &&
          (typeof request.path !== 'string' || request.path.length === 0)) ||
        requestNames.has(request.toolCallId)
      ) {
        throw new C1PreflightFailure(
          'PREFLIGHT_FAILURE',
          'live binding evidence has an unstable tool request'
        )
      }
      requestNames.set(request.toolCallId, request.toolName)
    }
    const executionIds = new Set<string>()
    for (const tool of row.toolEvents) {
      if (
        tool.toolCallId.length === 0 ||
        tool.toolName.length === 0 ||
        executionIds.has(tool.toolCallId) ||
        requestNames.get(tool.toolCallId) !== tool.toolName
      ) {
        throw new C1PreflightFailure(
          'PREFLIGHT_FAILURE',
          'live binding evidence has an execution without a matching tool request'
        )
      }
      executionIds.add(tool.toolCallId)
    }
    validateLiveUsage(row.usage, expected.responseSource)
  }
}

export interface C1LiveBindingLegInput {
  readonly studyId: string
  readonly task: C1PreflightTask
  readonly stratum: string
  readonly pairId: string
  readonly arm: 'NATIVE' | 'RUNTIME'
  readonly runId: string
  readonly fixtureContentSha256: string
  readonly fixtureTreeObjectId: string
  readonly runtimeSessionId: string
  readonly observationSource: C1LiveObservationSource
  readonly responseSource: C1LiveResponseSource
  /** Executes provider-requested tools before the next observation boundary. */
  readonly toolExecutor?: C1LiveToolExecutor
  readonly requireRuntimeDifferenceForCall?: (callOrdinal: number) => boolean
  readonly maxCalls?: number
  readonly startedAtMs?: number
  readonly nowMs?: number
  readonly wallClockMs?: number
  /** Aborts an in-flight provider request when the study operator stops. */
  readonly responseAbortSignal?: AbortSignal
  readonly killSwitch?: RunKillSwitch
}

export interface C1LiveBindingLegResult {
  readonly status: 'COMPLETED'
  readonly evidence: readonly C1LiveBindingEvidence[]
  readonly finalOutcome: C1LiveTaskOutcome
  readonly providerCallPermits: number
  readonly toolCalls: number
  readonly transportSendAttempts: number
  readonly blockedProviderCallAttempts: number
  readonly budget: Readonly<{
    readonly completedLegs: number
    readonly providerCalls: number
    readonly toolCalls: number
    readonly wallClockMs: number
  }>
}

function withPreviousWorkingSet(
  observation: C1AgentObservation,
  arm: 'NATIVE' | 'RUNTIME',
  previousWorkingSet: ContextWorkingSet | null
): C1AgentObservation {
  if (
    arm === 'RUNTIME' &&
    previousWorkingSet !== null &&
    observation.previousWorkingSetId === null
  ) {
    return {
      ...observation,
      previousWorkingSetId: previousWorkingSet.workingSetId
    }
  }
  return observation
}

export class C1LiveBindingDriver {
  private readonly executor: C1LegExecutor
  private checkpointOrdinal = 0
  private studyTerminalReason: string | null = null

  constructor(
    private readonly options: {
      readonly providerBinding: C1StrictProviderBinding
      readonly budgetGuard: C1HardBudgetGuard
      readonly evidenceSink: C1LiveBindingEvidenceSink
    }
  ) {
    this.executor = new C1LegExecutor({
      providerBinding: options.providerBinding
    })
  }

  get isStudyTerminal(): boolean {
    return this.studyTerminalReason !== null
  }

  get terminalReason(): string | null {
    return this.studyTerminalReason
  }

  private tripStudyTerminal(error: unknown): void {
    if (
      error instanceof C1PreflightFailure &&
      (error.code === 'BUDGET_BREACH' || error.code === 'EVIDENCE_WRITE_FAILURE')
    ) {
      this.studyTerminalReason ??= error.message
    }
  }

  private async appendCheckpoint(checkpoint: C1LiveBindingCheckpointInput): Promise<void> {
    const next = Object.freeze({
      checkpointOrdinal: ++this.checkpointOrdinal,
      ...checkpoint
    }) as C1LiveBindingCheckpoint
    try {
      await this.options.evidenceSink.append(next)
    } catch (error) {
      if (error instanceof C1PreflightFailure && error.code === 'EVIDENCE_WRITE_FAILURE') {
        throw error
      }
      throw new C1PreflightFailure(
        'EVIDENCE_WRITE_FAILURE',
        `live binding evidence checkpoint ${next.checkpointOrdinal} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  async runLeg(input: C1LiveBindingLegInput): Promise<C1LiveBindingLegResult> {
    if (this.studyTerminalReason !== null) {
      throw new C1PreflightFailure(
        'BUDGET_BREACH',
        `C1 study is terminal; next leg is forbidden (${this.studyTerminalReason})`
      )
    }
    const maxCalls = input.maxCalls ?? 24
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 24) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'live binding maxCalls must be in the 1..24 range'
      )
    }
    const startedAtMs = input.startedAtMs ?? Date.now()
    try {
      this.options.budgetGuard.beginLeg(startedAtMs)
    } catch (error) {
      this.tripStudyTerminal(error)
      throw error
    }
    let legEnded = false
    const killSwitch =
      input.killSwitch ??
      createRunKillSwitch(input.runId, {
        now: () => '2026-09-03T00:00:00.000Z'
      })
    let observation = input.observationSource.initialObservation
    let previousObservation = observation
    let previousWorkingSet: ContextWorkingSet | null = null
    let previousExecution: C1LegExecutionResult | null = null
    const evidence: C1LiveBindingEvidence[] = []
    let finalOutcome: C1LiveTaskOutcome | undefined
    let transportSendAttempts = 0
    let blockedProviderCallAttempts = 0
    try {
      for (let callOrdinal = 1; callOrdinal <= maxCalls; callOrdinal += 1) {
        const currentObservation = withPreviousWorkingSet(
          observation,
          input.arm,
          previousWorkingSet
        )
        const transport = new C1LiveBindingTransport({
          provider: C1_PROVIDER_ID,
          model: C1_MODEL_ID,
          endpoint: C1_PROVIDER_ENDPOINT,
          providerConfigHash: this.options.providerBinding.providerConfigHash
        })
        let execution: C1LegExecutionResult
        try {
          execution = this.executor.execute({
            studyId: input.studyId,
            task: input.task,
            stratum: input.stratum,
            pairId: input.pairId,
            arm: input.arm,
            runId: input.runId,
            turnId: `${input.runId}-turn-${String(callOrdinal).padStart(2, '0')}`,
            modelCallId: `${input.runId}-model-call-${String(callOrdinal).padStart(2, '0')}`,
            fixtureContentSha256: input.fixtureContentSha256,
            fixtureTreeObjectId: input.fixtureTreeObjectId,
            observation: currentObservation,
            providerBinding: this.options.providerBinding,
            transport,
            treatmentReady: true,
            killSwitch,
            previousWorkingSet,
            recompositionSequence: callOrdinal - 1,
            runtimeSessionId: input.runtimeSessionId,
            requireRuntimeDifference: input.requireRuntimeDifferenceForCall?.(callOrdinal) ?? false
          })
        } catch (error) {
          if (error instanceof C1PreflightFailure) {
            throw new C1PreflightFailure(
              error.code,
              `live binding call ${callOrdinal} (${input.arm}) failed: ${error.message}`
            )
          }
          throw error
        }
        transport.attachProviderBoundMessages(
          execution.providerBoundMessages,
          execution.structuralEnvelope
        )
        let response: C1LiveModelResponse
        try {
          response = await transport.send({
            budgetGuard: this.options.budgetGuard,
            responseSource: input.responseSource,
            killSwitch,
            ...(input.responseAbortSignal === undefined
              ? {}
              : { signal: input.responseAbortSignal }),
            ...(input.nowMs !== undefined ? { nowMs: input.nowMs } : {}),
            transportSendAttemptOrdinal: transportSendAttempts + 1,
            onOutboundPermitted: ({ request, providerCallOrdinal, transportSendAttemptOrdinal }) =>
              this.appendCheckpoint({
                phase: 'OUTBOUND_PERMITTED',
                callOrdinal,
                providerCallOrdinal,
                transportSendAttemptOrdinal,
                capture: request.capture
              })
          })
        } catch (error) {
          transportSendAttempts += transport.sendAttempts
          blockedProviderCallAttempts += transport.blockedSendAttempts
          throw error
        }
        transportSendAttempts += transport.sendAttempts
        blockedProviderCallAttempts += transport.blockedSendAttempts
        validateModelResponse(response, input.responseSource.kind)
        if (
          response.toolRequests.length > 0 &&
          input.responseSource.kind === 'AUTHORIZED_PROVIDER'
        ) {
          if (input.toolExecutor === undefined) {
            const error = new C1PreflightFailure(
              'PREFLIGHT_FAILURE',
              'authorized provider tool requests require a tool executor'
            )
            this.studyTerminalReason ??= error.message
            throw error
          }
        }
        this.options.budgetGuard.reserveToolCalls(response.toolRequests.length)
        let effectiveResponse = response
        let toolObservation: C1AgentObservation | undefined
        if (input.toolExecutor !== undefined && response.toolRequests.length > 0) {
          if (response.toolExecutions.length > 0) {
            throw new C1PreflightFailure(
              'PREFLIGHT_FAILURE',
              'authorized provider response must not prepopulate tool executions'
            )
          }
          const toolLoop = await input.toolExecutor.execute({
            previousObservation: currentObservation,
            response,
            observationId: `${input.runId}-observation-after-call-${String(callOrdinal).padStart(2, '0')}`
          })
          if (toolLoop.executions.length !== response.toolRequests.length) {
            throw new C1PreflightFailure(
              'PREFLIGHT_FAILURE',
              `tool executor returned ${toolLoop.executions.length} executions for ${response.toolRequests.length} requests`
            )
          }
          effectiveResponse = Object.freeze({
            ...response,
            toolExecutions: Object.freeze([...toolLoop.executions])
          })
          toolObservation = toolLoop.observation
        }
        const usage = validateModelResponse(effectiveResponse, input.responseSource.kind)
        const row: C1LiveBindingEvidence = {
          studyId: execution.capture.studyId,
          taskId: execution.capture.taskId,
          stratum: execution.capture.stratum,
          pairId: execution.capture.pairId,
          arm: execution.capture.arm,
          runId: execution.capture.runId,
          callOrdinal,
          turnId: execution.capture.turnId,
          modelCallId: execution.capture.modelCallId,
          responseId: effectiveResponse.responseId,
          responseSource: input.responseSource.kind,
          assistantMessages: effectiveResponse.assistantMessageCount,
          usage,
          toolCalls: effectiveResponse.toolRequests.length,
          toolRequestEvidence: Object.freeze(
            effectiveResponse.toolRequests.map((request) => ({
              ...toolRequestEvidence(request)
            }))
          ),
          toolEvents: Object.freeze(
            effectiveResponse.toolExecutions.map((execution) => ({
              toolCallId: execution.toolCallId,
              toolName: execution.toolName,
              ...(execution.path === undefined ? {} : { path: execution.path }),
              result: execution.result
            }))
          ),
          taskOutcome: effectiveResponse.outcome,
          provider: execution.capture.provider,
          model: execution.capture.model,
          endpoint: execution.capture.endpoint,
          providerConfigHash: execution.capture.providerConfigHash,
          contextStrategy: execution.capture.contextStrategy,
          providerBoundSourceKeys: execution.capture.providerBoundSourceKeys,
          modelVisibleSemanticContextFingerprint:
            execution.capture.modelVisibleSemanticContextFingerprint,
          systemDeveloperToolStructuresFingerprint:
            execution.capture.systemDeveloperToolStructuresFingerprint,
          workingSetId: execution.capture.workingSetId,
          transitionId: execution.capture.transitionId,
          transitionDecisionKinds: Object.freeze(
            execution.transition?.orderedDecisions.map((decision) => decision.kind) ?? []
          ),
          lifecycleEligible: execution.capture.lifecycleEligible,
          runtimeContextChanged: execution.capture.runtimeContextChanged,
          fallbackSent: false,
          networkSent: input.responseSource.kind === 'AUTHORIZED_PROVIDER',
          replayMismatch: execution.replayMismatch
        }
        await this.appendCheckpoint({
          phase: 'RESPONSE_RECORDED',
          callOrdinal,
          evidence: row
        })
        evidence.push(row)
        previousObservation = currentObservation
        previousExecution = execution
        finalOutcome = effectiveResponse.outcome
        if (effectiveResponse.outcome !== 'CONTINUE') break
        if (callOrdinal === maxCalls) {
          throw new C1PreflightFailure(
            'PREFLIGHT_FAILURE',
            `live binding leg reached maxCalls=${maxCalls} without a terminal outcome`
          )
        }
        observation = input.observationSource.next({
          callOrdinal,
          previousObservation,
          previousExecution,
          response: effectiveResponse,
          ...(toolObservation === undefined ? {} : { toolObservation })
        })
        previousWorkingSet = input.arm === 'RUNTIME' ? execution.workingSet : null
      }
      if (finalOutcome === undefined) {
        throw new C1PreflightFailure(
          'PREFLIGHT_FAILURE',
          'live binding leg produced no terminal outcome'
        )
      }
      this.options.budgetGuard.endLeg({
        wallClockMs: input.wallClockMs ?? Math.max(0, Date.now() - startedAtMs)
      })
      legEnded = true
      validateC1LiveBindingEvidence(evidence, {
        arm: input.arm,
        responseSource: input.responseSource.kind,
        providerConfigHash: this.options.providerBinding.providerConfigHash
      })
      return {
        status: 'COMPLETED',
        evidence: Object.freeze(evidence),
        finalOutcome,
        providerCallPermits: evidence.length,
        toolCalls: evidence.reduce((sum, row) => sum + row.toolCalls, 0),
        transportSendAttempts,
        blockedProviderCallAttempts,
        budget: this.options.budgetGuard.ledger
      }
    } catch (error) {
      this.tripStudyTerminal(error)
      throw error
    } finally {
      if (!legEnded) {
        if (this.studyTerminalReason !== null) {
          this.options.budgetGuard.abortLeg()
        } else {
          try {
            this.options.budgetGuard.endLeg({
              wallClockMs: input.wallClockMs ?? Math.max(0, Date.now() - startedAtMs)
            })
          } catch {
            // The original terminal failure is authoritative; the guard is best
            // effort closed so the single-use driver cannot accidentally reuse
            // an active leg after an exception.
          }
        }
      }
    }
  }
}

export interface C1LiveBudgetBoundaryProbe {
  readonly status: 'PASS' | 'FAIL'
  readonly attemptedProviderCalls: number
  readonly permittedProviderCalls: number
  readonly blockedProviderCallAttempts: number
  readonly fakeResponseCalls: number
  readonly networkRequests: 0
}

export async function runC1LiveBudgetBoundaryProbe(input: {
  readonly providerBinding: C1StrictProviderBinding
  readonly task: C1PreflightTask
}): Promise<C1LiveBudgetBoundaryProbe> {
  const budgetGuard = new C1HardBudgetGuard({
    perLeg: { maxProviderCalls: 24, maxToolCalls: 96, maxWallClockMs: 600000 },
    study: {
      maxProviderCalls: 24,
      maxToolCalls: 96,
      maxWallClockMs: 600000,
      maxLegs: 1
    }
  })
  const responses = Array.from({ length: 24 }, (_, index) => ({
    responseId: `boundary-response-${String(index + 1).padStart(2, '0')}`,
    assistantMessageCount: 1,
    assistantContent: `boundary response ${String(index + 1).padStart(2, '0')}`,
    usage: {
      inputTokens: 10,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 11,
      usageSource: 'SCRIPTED_FAKE' as const
    },
    toolRequests: [],
    toolExecutions: [],
    outcome: 'COMPLETE' as const
  }))
  const responseSource = new C1ScriptedResponseSource(responses)
  const transport = new C1LiveBindingTransport({
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    providerConfigHash: input.providerBinding.providerConfigHash
  })
  const messages: readonly PiMessageView[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'synthetic budget boundary' }]
    }
  ]
  budgetGuard.beginLeg(100)
  let blocked = 0
  try {
    for (let ordinal = 1; ordinal <= 25; ordinal += 1) {
      const capture = captureC1PreflightArm({
        task: input.task,
        stratum: input.task.stratum,
        pairId: 'c1-live-binding-budget-p01',
        arm: 'NATIVE',
        runId: 'c1-20260903-budget-boundary-NATIVE-aaaaaaaa',
        fixtureContentSha256: input.task.fixtureRevision.fixtureContentSha256,
        treatmentReady: true,
        studyId: C1_LIVE_BINDING_STUDY_ID,
        turnId: `budget-turn-${String(ordinal).padStart(2, '0')}`,
        modelCallId: `budget-model-call-${String(ordinal).padStart(2, '0')}`,
        providerConfigHash: input.providerBinding.providerConfigHash,
        providerBoundSourceKeys: ['run/tool-call://c1-budget-boundary'],
        modelVisibleSemanticContextFingerprint: 'c1-budget-boundary-fingerprint',
        systemDeveloperToolStructuresFingerprint:
          C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE.structuralFingerprint
      })
      transport.capture(capture)
      transport.attachProviderBoundMessages(messages, C1_FROZEN_PROVIDER_STRUCTURAL_ENVELOPE)
      try {
        await transport.send({
          budgetGuard,
          responseSource,
          nowMs: 100
        })
      } catch (error) {
        if (
          ordinal !== 25 ||
          !(error instanceof C1PreflightFailure) ||
          error.code !== 'BUDGET_BREACH'
        ) {
          throw error
        }
        blocked += 1
      }
    }
  } finally {
    budgetGuard.endLeg({ wallClockMs: 0 })
  }
  const ledger = budgetGuard.ledger
  const pass =
    transport.sendAttempts === 25 &&
    transport.sentCaptures.length === 24 &&
    blocked === 1 &&
    responseSource.responsesServed === 24 &&
    ledger.providerCalls === 24 &&
    transport.providerCalls === 0 &&
    transport.networkRequests === 0
  return {
    status: pass ? 'PASS' : 'FAIL',
    attemptedProviderCalls: 25,
    permittedProviderCalls: ledger.providerCalls,
    blockedProviderCallAttempts: blocked,
    fakeResponseCalls: responseSource.responsesServed,
    networkRequests: transport.networkRequests
  }
}

export interface C1LiveBudgetTerminationProbe {
  readonly status: 'PASS' | 'FAIL'
  readonly firstLegErrorCode: string | null
  readonly secondLegErrorCode: string | null
  readonly preservedOutboundCheckpoints: number
  readonly preservedResponseCheckpoints: number
  readonly firstResponseCalls: number
  readonly secondResponseCalls: number
  readonly providerCalls: number
  readonly studyTerminal: boolean
  readonly nextLegBlockedBeforeResponse: boolean
  readonly persistedCheckpointCount: number
}

/**
 * Adversarially exercise the frozen breach action. The first response is
 * checkpointed, the second outbound permit is denied, and a new leg is
 * rejected by the same study-level latch before its response source runs.
 */
export async function runC1LiveBudgetTerminationProbe(input: {
  readonly providerBinding: C1StrictProviderBinding
  readonly task: C1PreflightTask
}): Promise<C1LiveBudgetTerminationProbe> {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-live-binding-termination-'))
  const checkpointPath = join(checkpointRoot, 'checkpoints.jsonl')
  try {
    const budgetGuard = new C1HardBudgetGuard({
      perLeg: { maxProviderCalls: 1, maxToolCalls: 96, maxWallClockMs: 600000 },
      study: {
        maxProviderCalls: 1,
        maxToolCalls: 96,
        maxWallClockMs: 600000,
        maxLegs: 2
      }
    })
    const checkpointSink = new C1JsonlLiveBindingEvidenceSink(checkpointPath)
    const driver = new C1LiveBindingDriver({
      providerBinding: input.providerBinding,
      budgetGuard,
      evidenceSink: checkpointSink
    })
    const firstResponses = new C1ScriptedResponseSource(scriptedResponses('termination'))
    const firstObservations = createBindingObservationSource(
      input.task,
      'NATIVE',
      scriptedResponses('termination')
    )
    let firstLegErrorCode: string | null = null
    try {
      await driver.runLeg({
        studyId: C1_LIVE_BINDING_STUDY_ID,
        task: input.task,
        stratum: input.task.stratum,
        pairId: 'c1-live-binding-termination-p01',
        arm: 'NATIVE',
        runId: 'c1-20260903-termination-p01-native-aaaaaaaa',
        fixtureContentSha256: input.task.fixtureRevision.fixtureContentSha256,
        fixtureTreeObjectId: input.task.fixtureRevision.fixtureTreeObjectId,
        runtimeSessionId: 'c1-live-binding-termination-session-v1',
        observationSource: firstObservations,
        responseSource: firstResponses,
        maxCalls: 2,
        startedAtMs: 100,
        nowMs: 100,
        wallClockMs: 0
      })
    } catch (error) {
      firstLegErrorCode = error instanceof C1PreflightFailure ? error.code : 'PREFLIGHT_FAILURE'
    }

    const secondResponses = new C1ScriptedResponseSource([])
    const secondObservations = createBindingObservationSource(
      input.task,
      'NATIVE',
      scriptedResponses('next-leg')
    )
    let secondLegErrorCode: string | null = null
    try {
      await driver.runLeg({
        studyId: C1_LIVE_BINDING_STUDY_ID,
        task: input.task,
        stratum: input.task.stratum,
        pairId: 'c1-live-binding-termination-p02',
        arm: 'NATIVE',
        runId: 'c1-20260903-termination-p02-native-bbbbbbbb',
        fixtureContentSha256: input.task.fixtureRevision.fixtureContentSha256,
        fixtureTreeObjectId: input.task.fixtureRevision.fixtureTreeObjectId,
        runtimeSessionId: 'c1-live-binding-termination-session-v2',
        observationSource: secondObservations,
        responseSource: secondResponses,
        maxCalls: 1,
        startedAtMs: 100,
        nowMs: 100,
        wallClockMs: 0
      })
    } catch (error) {
      secondLegErrorCode = error instanceof C1PreflightFailure ? error.code : 'PREFLIGHT_FAILURE'
    }

    const checkpoints = checkpointSink.checkpoints
    const preservedOutboundCheckpoints = checkpoints.filter(
      (checkpoint) => checkpoint.phase === 'OUTBOUND_PERMITTED'
    ).length
    const preservedResponseCheckpoints = checkpoints.filter(
      (checkpoint) => checkpoint.phase === 'RESPONSE_RECORDED'
    ).length
    const persistedCheckpoints = (await readFile(checkpointPath, 'utf8'))
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as C1LiveBindingCheckpoint)
    const persistedOutboundCheckpoints = persistedCheckpoints.filter(
      (checkpoint) => checkpoint.phase === 'OUTBOUND_PERMITTED'
    ).length
    const persistedResponseCheckpoints = persistedCheckpoints.filter(
      (checkpoint) => checkpoint.phase === 'RESPONSE_RECORDED'
    ).length
    const nextLegBlockedBeforeResponse =
      secondLegErrorCode === 'BUDGET_BREACH' && secondResponses.responsesServed === 0
    const pass =
      firstLegErrorCode === 'BUDGET_BREACH' &&
      secondLegErrorCode === 'BUDGET_BREACH' &&
      preservedOutboundCheckpoints === 1 &&
      preservedResponseCheckpoints === 1 &&
      persistedOutboundCheckpoints === 1 &&
      persistedResponseCheckpoints === 1 &&
      firstResponses.responsesServed === 1 &&
      secondResponses.responsesServed === 0 &&
      budgetGuard.ledger.providerCalls === 1 &&
      driver.isStudyTerminal &&
      nextLegBlockedBeforeResponse
    return {
      status: pass ? 'PASS' : 'FAIL',
      firstLegErrorCode,
      secondLegErrorCode,
      preservedOutboundCheckpoints,
      preservedResponseCheckpoints,
      firstResponseCalls: firstResponses.responsesServed,
      secondResponseCalls: secondResponses.responsesServed,
      providerCalls: budgetGuard.ledger.providerCalls,
      studyTerminal: driver.isStudyTerminal,
      nextLegBlockedBeforeResponse,
      persistedCheckpointCount: persistedCheckpoints.length
    }
  } finally {
    await rm(checkpointRoot, { recursive: true, force: true })
  }
}

function scriptedResponses(
  prefix: string,
  includeFirstToolCall = true
): readonly C1LiveModelResponse[] {
  return [
    {
      responseId: `${prefix}-response-01`,
      assistantMessageCount: 1,
      assistantContent: `${prefix} assistant response 01`,
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 110,
        usageSource: 'SCRIPTED_FAKE'
      },
      toolRequests: includeFirstToolCall
        ? [
            {
              toolCallId: `${prefix}-read-01`,
              toolName: 'read',
              argumentsJson: JSON.stringify({ path: 'src/observed-extra.js' })
            }
          ]
        : [],
      toolExecutions: includeFirstToolCall
        ? [
            {
              toolCallId: `${prefix}-read-01`,
              toolName: 'read',
              path: 'src/observed-extra.js',
              result: 'SUCCESS'
            }
          ]
        : [],
      outcome: 'CONTINUE'
    },
    {
      responseId: `${prefix}-response-02`,
      assistantMessageCount: 1,
      assistantContent: `${prefix} assistant response 02`,
      usage: {
        inputTokens: 120,
        outputTokens: 12,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 132,
        usageSource: 'SCRIPTED_FAKE'
      },
      toolRequests: [
        {
          toolCallId: `${prefix}-bash-02`,
          toolName: 'bash',
          argumentsJson: JSON.stringify({ command: 'pnpm test' })
        }
      ],
      toolExecutions: [
        {
          toolCallId: `${prefix}-bash-02`,
          toolName: 'bash',
          result: 'SUCCESS'
        }
      ],
      outcome: 'CONTINUE'
    },
    {
      responseId: `${prefix}-response-03`,
      assistantMessageCount: 1,
      assistantContent: `${prefix} assistant response 03`,
      usage: {
        inputTokens: 140,
        outputTokens: 14,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 154,
        usageSource: 'SCRIPTED_FAKE'
      },
      toolRequests: [],
      toolExecutions: [],
      outcome: 'COMPLETE'
    }
  ]
}

function createBindingObservationSource(
  task: C1PreflightTask,
  arm: 'NATIVE' | 'RUNTIME',
  responses: readonly C1LiveModelResponse[]
): C1LiveObservationSource {
  const base = createC1ObservedReadTrace({
    observationId: `c1-live-binding-${arm.toLowerCase()}-initial`,
    prompt: task.prompt,
    fixtureFiles: ['src/target.js', 'src/distractor.js']
  })
  const afterFirst = appendC1LiveResponseToObservation(
    base,
    responses[0]!,
    `c1-live-binding-${arm.toLowerCase()}-after-first`
  )
  if (arm === 'NATIVE') {
    const afterSecond = appendC1LiveResponseToObservation(
      afterFirst,
      responses[1]!,
      `c1-live-binding-${arm.toLowerCase()}-after-second`
    )
    return new C1ScriptedObservationSource([base, afterFirst, afterSecond])
  }

  const secondCallId = `c1-observation-${base.observationId}-2`
  const removedSourceKeys = base.currentTargetSourceKeys.filter((key) => key.endsWith(secondCallId))
  const retainedSourceKeys = base.currentTargetSourceKeys.filter(
    (key) => !removedSourceKeys.includes(key)
  )
  const ruledOutSignals: readonly SourceLifecycleSignal[] = removedSourceKeys.map((sourceKey) => ({
    sourceKey,
    kind: 'RULED_OUT',
    evidenceRef: 'c1-live-binding-scripted-triage'
  }))
  const changed = {
    ...afterFirst,
    observationId: 'c1-live-binding-runtime-removed',
    currentTargetSourceKeys: retainedSourceKeys,
    excludedSourceKeys: removedSourceKeys,
    sourceLifecycleSignals: ruledOutSignals
  }
  const afterSecond = appendC1LiveResponseToObservation(
    changed,
    responses[1]!,
    'c1-live-binding-runtime-before-rehydrate'
  )
  const removalHistory: readonly RemovalRecord[] = removedSourceKeys.map((sourceKey) => ({
    sourceKey,
    originalRemovalReasonCodes: ['RULED_OUT'],
    removedAtSequence: 1,
    removedFromWorkingSetId: null
  }))
  const restored = {
    ...afterSecond,
    observationId: 'c1-live-binding-runtime-rehydrated',
    currentTargetSourceKeys: afterSecond.currentTargetSourceKeys,
    excludedSourceKeys: [],
    // The removalHistory + representationNeed pair is sufficient to produce
    // REHYDRATE. Do not add a lifecycle signal here: the restored set is
    // intentionally equal to the current Native observation, so requiring a
    // second semantic fingerprint difference would misclassify a successful
    // restoration as an unchanged-treatment failure.
    sourceLifecycleSignals: [],
    removalHistory,
    representationNeeds: removedSourceKeys.map((sourceKey) => ({
      sourceKey,
      preferredKind: 'FULL' as const,
      reasonCode: 'DETAIL_REQUIRED'
    }))
  }
  return new C1ScriptedObservationSource([base, changed, restored])
}

export interface C1LiveBindingArmSummary {
  readonly arm: 'NATIVE' | 'RUNTIME'
  readonly status: 'PASS'
  readonly calls: number
  readonly toolCalls: number
  readonly usageSource: 'SCRIPTED_FAKE'
  readonly transitionDecisionKinds: readonly (readonly string[])[]
}

export interface C1LiveBindingReadinessReport {
  readonly bindingId: typeof C1_LIVE_BINDING_ID
  readonly executionMode: typeof C1_LIVE_BINDING_MODE
  readonly status: 'PASS' | 'FAIL'
  readonly nodeVersion: string
  readonly provider: 'step-plan'
  readonly model: 'step-3.7-flash'
  readonly endpoint: 'https://api.stepfun.com/step_plan/v1/chat/completions'
  readonly providerConfigHash: string | null
  readonly providerCalls: 0
  readonly networkRequests: 0
  readonly fakeResponseCalls: number
  readonly budgetedProviderCallPermits: number
  readonly transportSendAttempts: number
  readonly blockedProviderCallAttempts: number
  readonly fixtureSandboxesCreated: number
  readonly fixtureSandboxesCleaned: number
  readonly contractSha256: typeof C1_C_CONTRACT_SHA256
  readonly assignmentMatrixSha256: typeof C1_C_ASSIGNMENT_MATRIX_SHA256
  readonly taskManifestSha256: typeof C1_C_TASK_MANIFEST_SHA256
  readonly treatmentRevision: typeof C1_C_TREATMENT_REVISION
  readonly gates: readonly {
    readonly gateId: string
    readonly verdict: 'PASS' | 'FAIL'
    readonly observed: string
  }[]
  readonly arms: readonly C1LiveBindingArmSummary[]
  readonly budgetTerminationProbe: C1LiveBudgetTerminationProbe | null
  readonly failures: readonly {
    readonly code: string
    readonly message: string
  }[]
}

function bindingGate(
  gateId: string,
  pass: boolean,
  observed: string
): {
  readonly gateId: string
  readonly verdict: 'PASS' | 'FAIL'
  readonly observed: string
} {
  return { gateId, verdict: pass ? 'PASS' : 'FAIL', observed }
}

async function runFreshFixtureLeg<T>(input: {
  readonly repoRoot: string
  readonly task: C1PreflightTask
  readonly onReady: (fixture: {
    readonly contentSha256: string
    readonly treeObjectId: string
  }) => Promise<T>
}): Promise<{ readonly result: T; readonly created: 1; readonly cleaned: 1 }> {
  const source = resolve(input.repoRoot, input.task.fixturePath)
  const fixture = await materializeFreshC1Fixture(source)
  try {
    const copied = await computeC1FixtureContentSummary(fixture.path)
    if (copied.sha256 !== input.task.fixtureRevision.fixtureContentSha256) {
      throw new C1PreflightFailure(
        'FIXTURE_BINDING_MISMATCH',
        `fresh fixture hash mismatch for ${input.task.taskId}`
      )
    }
    const result = await input.onReady({
      contentSha256: copied.sha256,
      treeObjectId: input.task.fixtureRevision.fixtureTreeObjectId
    })
    return { result, created: 1, cleaned: 1 }
  } finally {
    await fixture.cleanup()
  }
}

export async function runC1LiveBindingReadiness(
  options: {
    readonly repoRoot?: string
  } = {}
): Promise<C1LiveBindingReadinessReport> {
  const repoRoot = options.repoRoot ?? resolve(import.meta.dirname, '..', '..', '..')
  const nodeVersion = process.versions.node
  const gates: {
    readonly gateId: string
    readonly verdict: 'PASS' | 'FAIL'
    readonly observed: string
  }[] = []
  const failures: { code: string; message: string }[] = []
  const arms: C1LiveBindingArmSummary[] = []
  let providerBinding: C1StrictProviderBinding | null = null
  let fakeResponseCalls = 0
  let budgetedProviderCallPermits = 0
  let transportSendAttempts = 0
  let blockedProviderCallAttempts = 0
  let fixtureSandboxesCreated = 0
  let fixtureSandboxesCleaned = 0
  let study: C1FrozenStudy | null = null
  let checkpointRoot: string | null = null
  let budgetTerminationProbe: C1LiveBudgetTerminationProbe | null = null
  try {
    if (!nodeVersionSatisfiesC1Range(nodeVersion)) {
      throw new C1PreflightFailure(
        'NODE_RANGE_MISMATCH',
        `Node ${nodeVersion} is outside ${C1_NODE_RANGE}`
      )
    }
    study = await loadC1FrozenStudy(repoRoot)
    gates.push(
      bindingGate(
        'frozen_binding',
        true,
        'C1 protocol, task manifest, run contract, readiness, and hashes match'
      )
    )
    const treatmentReadiness = runC1TreatmentReadiness()
    gates.push(
      bindingGate(
        'c1c_treatment_readiness',
        treatmentReadiness.overallVerdict === 'PASS' && treatmentReadiness.providerCalls === 0,
        `C1-C verdict=${treatmentReadiness.overallVerdict}, providerCalls=${treatmentReadiness.providerCalls}`
      )
    )
    if (treatmentReadiness.overallVerdict !== 'PASS' || treatmentReadiness.providerCalls !== 0) {
      throw new C1PreflightFailure(
        'TREATMENT_INACTIVE',
        'C1-C treatment readiness did not pass zero-provider'
      )
    }
    providerBinding = await prepareC1StrictProvider({
      runIdentity: 'c1-20260903-live-binding-preflight-aaaaaaaa'
    })
    const task = study.tasks[0]
    if (task === undefined)
      throw new C1PreflightFailure('MANIFEST_BINDING_MISMATCH', 'C1 study has no task')
    const budgetGuard = new C1HardBudgetGuard({
      perLeg: study.perLegBudgets,
      study: { ...study.studyBudgets, maxLegs: 2 }
    })
    checkpointRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-live-binding-preflight-'))
    const evidenceSink = new C1JsonlLiveBindingEvidenceSink(
      join(checkpointRoot, 'checkpoints.jsonl')
    )
    const driver = new C1LiveBindingDriver({
      providerBinding,
      budgetGuard,
      evidenceSink
    })
    const nativeResponses = new C1ScriptedResponseSource(scriptedResponses('native'))
    const nativeObservations = createBindingObservationSource(
      task,
      'NATIVE',
      scriptedResponses('native')
    )
    const native = await runFreshFixtureLeg({
      repoRoot,
      task,
      onReady: (fixture) =>
        driver.runLeg({
          studyId: C1_LIVE_BINDING_STUDY_ID,
          task,
          stratum: task.stratum,
          pairId: 'c1-live-binding-p01',
          arm: 'NATIVE',
          runId: 'c1-20260903-c1-live-binding-p01-native-aaaaaaaa',
          fixtureContentSha256: fixture.contentSha256,
          fixtureTreeObjectId: fixture.treeObjectId,
          runtimeSessionId: 'c1-live-binding-native-session-v1',
          observationSource: nativeObservations,
          responseSource: nativeResponses,
          wallClockMs: 30
        })
    })
    fixtureSandboxesCreated += native.created
    fixtureSandboxesCleaned += native.cleaned
    fakeResponseCalls += nativeResponses.responsesServed
    budgetedProviderCallPermits += native.result.providerCallPermits
    transportSendAttempts += native.result.transportSendAttempts
    blockedProviderCallAttempts += native.result.blockedProviderCallAttempts
    arms.push({
      arm: 'NATIVE',
      status: 'PASS',
      calls: native.result.evidence.length,
      toolCalls: native.result.toolCalls,
      usageSource: 'SCRIPTED_FAKE',
      transitionDecisionKinds: native.result.evidence.map((row) => row.transitionDecisionKinds)
    })

    const runtimeResponses = new C1ScriptedResponseSource(scriptedResponses('runtime', false))
    const runtimeObservations = createBindingObservationSource(
      task,
      'RUNTIME',
      scriptedResponses('runtime', false)
    )
    const runtime = await runFreshFixtureLeg({
      repoRoot,
      task,
      onReady: (fixture) =>
        driver.runLeg({
          studyId: C1_LIVE_BINDING_STUDY_ID,
          task,
          stratum: task.stratum,
          pairId: 'c1-live-binding-p01',
          arm: 'RUNTIME',
          runId: 'c1-20260903-c1-live-binding-p01-runtime-bbbbbbbb',
          fixtureContentSha256: fixture.contentSha256,
          fixtureTreeObjectId: fixture.treeObjectId,
          runtimeSessionId: 'c1-live-binding-runtime-session-v1',
          observationSource: runtimeObservations,
          responseSource: runtimeResponses,
          requireRuntimeDifferenceForCall: (callOrdinal) => callOrdinal === 2,
          wallClockMs: 30
        })
    })
    fixtureSandboxesCreated += runtime.created
    fixtureSandboxesCleaned += runtime.cleaned
    fakeResponseCalls += runtimeResponses.responsesServed
    budgetedProviderCallPermits += runtime.result.providerCallPermits
    transportSendAttempts += runtime.result.transportSendAttempts
    blockedProviderCallAttempts += runtime.result.blockedProviderCallAttempts
    const runtimeHasRemove = runtime.result.evidence.some((row) =>
      row.transitionDecisionKinds.includes('REMOVE')
    )
    const runtimeHasRehydrate = runtime.result.evidence.some((row) =>
      row.transitionDecisionKinds.includes('REHYDRATE')
    )
    const runtimeChanged = runtime.result.evidence.some(
      (row) => row.lifecycleEligible && row.runtimeContextChanged
    )
    gates.push(
      bindingGate(
        'runtime_lifecycle_chain',
        runtimeHasRemove && runtimeHasRehydrate && runtimeChanged,
        `REMOVE=${String(runtimeHasRemove)}, REHYDRATE=${String(runtimeHasRehydrate)}, changed=${String(runtimeChanged)}`
      )
    )
    arms.push({
      arm: 'RUNTIME',
      status: 'PASS',
      calls: runtime.result.evidence.length,
      toolCalls: runtime.result.toolCalls,
      usageSource: 'SCRIPTED_FAKE',
      transitionDecisionKinds: runtime.result.evidence.map((row) => row.transitionDecisionKinds)
    })
    gates.push(
      bindingGate(
        'multi_call_evidence_join',
        native.result.evidence.length === 3 &&
          runtime.result.evidence.length === 3 &&
          native.result.evidence.every((row) => row.usage.usageSource === 'SCRIPTED_FAKE') &&
          runtime.result.evidence.every((row) => row.usage.usageSource === 'SCRIPTED_FAKE'),
        'Native and Runtime each produced three fresh model-call rows with usage, tool, outcome, and context joins'
      )
    )
    const boundary = await runC1LiveBudgetBoundaryProbe({
      providerBinding,
      task
    })
    fakeResponseCalls += boundary.fakeResponseCalls
    budgetedProviderCallPermits += boundary.permittedProviderCalls
    transportSendAttempts += boundary.attemptedProviderCalls
    blockedProviderCallAttempts += boundary.blockedProviderCallAttempts
    gates.push(
      bindingGate(
        'outbound_budget_boundary',
        boundary.status === 'PASS' &&
          boundary.permittedProviderCalls === 24 &&
          boundary.blockedProviderCallAttempts === 1,
        `24th permitted, 25th blocked, fakeResponses=${boundary.fakeResponseCalls}`
      )
    )
    gates.push(
      bindingGate(
        'provider_boundary',
        fakeResponseCalls === 30 && budgetedProviderCallPermits === 30,
        `providerCalls=0, networkRequests=0, fakeResponseCalls=${fakeResponseCalls}, budgetPermits=${budgetedProviderCallPermits}`
      )
    )
    gates.push(
      bindingGate(
        'fresh_fixture_isolation',
        fixtureSandboxesCreated === 2 && fixtureSandboxesCleaned === 2,
        `fresh sandboxes=${fixtureSandboxesCreated}, cleaned=${fixtureSandboxesCleaned}`
      )
    )
    gates.push(
      bindingGate(
        'evidence_is_metadata_only',
        !JSON.stringify([
          ...native.result.evidence,
          ...runtime.result.evidence,
          ...evidenceSink.checkpoints
        ]).match(/providerBoundMessages|argumentsJson/),
        'evidence checkpoints contain no provider-bound messages or raw tool arguments'
      )
    )
    budgetTerminationProbe = await runC1LiveBudgetTerminationProbe({
      providerBinding,
      task
    })
    gates.push(
      bindingGate(
        'terminal_breach_preservation',
        budgetTerminationProbe.status === 'PASS',
        `call1 evidence preserved=${String(budgetTerminationProbe.preservedResponseCheckpoints === 1)}, ` +
          `call2 blocked=${String(budgetTerminationProbe.firstLegErrorCode === 'BUDGET_BREACH')}, ` +
          `nextLegBlocked=${String(budgetTerminationProbe.nextLegBlockedBeforeResponse)}`
      )
    )
  } catch (error) {
    const failure =
      error instanceof C1PreflightFailure
        ? { code: error.code, message: error.message }
        : {
            code: 'PREFLIGHT_FAILURE',
            message: error instanceof Error ? error.message : String(error)
          }
    failures.push(failure)
  } finally {
    providerBinding?.dispose()
    if (checkpointRoot !== null) {
      await rm(checkpointRoot, { recursive: true, force: true })
    }
  }
  const status =
    failures.length === 0 && gates.length > 0 && gates.every((gate) => gate.verdict === 'PASS')
      ? 'PASS'
      : 'FAIL'
  return {
    bindingId: C1_LIVE_BINDING_ID,
    executionMode: C1_LIVE_BINDING_MODE,
    status,
    nodeVersion,
    provider: 'step-plan',
    model: 'step-3.7-flash',
    endpoint: 'https://api.stepfun.com/step_plan/v1/chat/completions',
    providerConfigHash: providerBinding?.providerConfigHash ?? null,
    providerCalls: 0,
    networkRequests: 0,
    fakeResponseCalls,
    budgetedProviderCallPermits,
    transportSendAttempts,
    blockedProviderCallAttempts,
    fixtureSandboxesCreated,
    fixtureSandboxesCleaned,
    contractSha256: C1_C_CONTRACT_SHA256,
    assignmentMatrixSha256: C1_C_ASSIGNMENT_MATRIX_SHA256,
    taskManifestSha256: C1_C_TASK_MANIFEST_SHA256,
    treatmentRevision: C1_C_TREATMENT_REVISION,
    gates,
    arms,
    budgetTerminationProbe,
    failures
  }
}
