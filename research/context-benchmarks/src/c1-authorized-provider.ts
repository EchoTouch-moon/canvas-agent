import type { PiMessageView } from '@canvas-agent/pi-context-integration'
import type {
  C1LiveModelResponse,
  C1LiveOutboundRequest,
  C1LiveResponseSource
} from './c1-live-binding'
import {
  assertC1StrictProviderBinding,
  C1_MODEL_ID,
  C1_PROVIDER_ENDPOINT,
  C1_PROVIDER_ID,
  C1PreflightFailure,
  type C1StrictProviderBinding
} from './c1-live-preflight'

/** The only provider response source eligible for a future C1 live gate. */
export const C1_AUTHORIZED_PROVIDER_SOURCE_ID = 'C1_AUTHORIZED_PROVIDER_RESPONSE_SOURCE_V1'
export const C1_AUTHORIZED_PROVIDER_MAX_TOKENS = 16_384

export interface C1AuthorizedProviderToolDefinition {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description?: string
    readonly parameters: Record<string, unknown>
  }
}

export interface C1AuthorizedProviderResponseSourceOptions {
  readonly providerBinding: C1StrictProviderBinding
  /** Memory-only credential. It is never included in a C1 evidence object. */
  readonly apiKey: string
  /** Injected in tests; the default is the global fetch used only by live code. */
  readonly fetchImpl?: typeof fetch
  readonly requestTimeoutMs?: number
  readonly tools?: readonly C1AuthorizedProviderToolDefinition[]
}

interface OpenAIMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string | null
  readonly tool_calls?: readonly {
    readonly id: string
    readonly type: 'function'
    readonly function: { readonly name: string; readonly arguments: string }
  }[]
  readonly tool_call_id?: string
}

interface JsonRecord {
  readonly [key: string]: unknown
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', `${label} must be an object`)
  }
  return value as JsonRecord
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', `${label} must be a non-empty string`)
  }
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new C1PreflightFailure(
      'USAGE_CONTRACT_MISMATCH',
      `${label} must be a non-negative integer`
    )
  }
  return value as number
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  return nonNegativeInteger(value, label)
}

function textFromContent(content: PiMessageView['content'], label: string): string {
  if (typeof content === 'string') return content
  if (content === undefined) return ''
  if (!Array.isArray(content)) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', `${label} has unsupported content`)
  }
  const text: string[] = []
  for (const [index, block] of content.entries()) {
    const record = asRecord(block, `${label}[${index}]`)
    if (record['type'] !== 'text' || typeof record['text'] !== 'string') {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `${label}[${index}] is not a text content block`
      )
    }
    text.push(record['text'])
  }
  return text.join('')
}

function toolArguments(value: unknown, label: string): string {
  if (value === undefined) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', `${label} is missing`)
  }
  if (typeof value === 'string') {
    try {
      JSON.parse(value)
    } catch {
      throw new C1PreflightFailure('PREFLIGHT_FAILURE', `${label} is not valid JSON`)
    }
    return value
  }
  const encoded = JSON.stringify(value ?? {})
  if (encoded === undefined) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', `${label} is not JSON serializable`)
  }
  return encoded
}

function assistantMessage(message: PiMessageView): OpenAIMessage {
  const content = message.content
  if (typeof content === 'string' || content === undefined) {
    return { role: 'assistant', content: typeof content === 'string' ? content : null }
  }
  if (!Array.isArray(content)) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'assistant message has unsupported content')
  }
  const text: string[] = []
  const toolCalls: {
    readonly id: string
    readonly type: 'function'
    readonly function: { readonly name: string; readonly arguments: string }
  }[] = []
  for (const [index, block] of content.entries()) {
    const record = asRecord(block, `assistant.content[${index}]`)
    if (record['type'] === 'text') {
      text.push(nonEmptyString(record['text'], `assistant.content[${index}].text`))
      continue
    }
    if (record['type'] !== 'toolCall') {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `assistant.content[${index}] is not text or toolCall`
      )
    }
    toolCalls.push({
      id: nonEmptyString(record['id'], `assistant.content[${index}].id`),
      type: 'function',
      function: {
        name: nonEmptyString(record['name'], `assistant.content[${index}].name`),
        arguments: toolArguments(record['arguments'], `assistant.content[${index}].arguments`)
      }
    })
  }
  return {
    role: 'assistant',
    content: text.length === 0 ? null : text.join(''),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
  }
}

function providerMessage(message: PiMessageView): OpenAIMessage {
  if (message.role === 'assistant') return assistantMessage(message)
  if (message.role === 'toolResult' || message.role === 'tool') {
    return {
      role: 'tool',
      content: textFromContent(message.content, `${message.role}.content`),
      tool_call_id: nonEmptyString(message.toolCallId, `${message.role}.toolCallId`)
    }
  }
  if (message.role === 'system' || message.role === 'user') {
    return {
      role: message.role,
      content: textFromContent(message.content, `${message.role}.content`)
    }
  }
  // Step Plan's frozen compatibility profile does not accept a developer role.
  if (message.role === 'developer') {
    return { role: 'system', content: textFromContent(message.content, 'developer.content') }
  }
  throw new C1PreflightFailure(
    'PREFLIGHT_FAILURE',
    `unsupported Pi message role for OpenAI-compatible provider: ${message.role}`
  )
}

function providerMessages(messages: readonly PiMessageView[]): readonly OpenAIMessage[] {
  if (messages.length === 0) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'authorized provider request has no messages')
  }
  return Object.freeze(messages.map(providerMessage))
}

function usageValue(
  usage: JsonRecord,
  keys: readonly string[],
  label: string
): number {
  for (const key of keys) {
    const value = usage[key]
    if (value !== undefined) return nonNegativeInteger(value, label)
  }
  throw new C1PreflightFailure('USAGE_CONTRACT_MISMATCH', `provider usage is missing ${label}`)
}

function nestedUsageValue(
  usage: JsonRecord,
  detailsKey: string,
  keys: readonly string[],
  label: string
): number | undefined {
  const detailsValue = usage[detailsKey]
  if (detailsValue !== undefined) {
    const details = asRecord(detailsValue, `provider usage.${detailsKey}`)
    for (const key of keys) {
      const value = optionalNonNegativeInteger(details[key], label)
      if (value !== undefined) return value
    }
  }
  return undefined
}

function providerUsage(value: unknown): C1LiveModelResponse['usage'] {
  const usage = asRecord(value, 'provider response.usage')
  // C1 requires every normalized token counter. Provider-specific aliases are
  // accepted, but an omitted cache counter is incomplete evidence, not zero.
  const cacheRead =
    usageValueIfPresent(usage, ['cached_tokens', 'prompt_cache_hit_tokens', 'cacheReadTokens']) ??
    nestedUsageValue(usage, 'prompt_tokens_details', ['cached_tokens'], 'cacheReadTokens')
  if (cacheRead === undefined) {
    throw new C1PreflightFailure(
      'USAGE_CONTRACT_MISMATCH',
      'provider usage is missing cacheReadTokens'
    )
  }
  const cacheWrite =
    usageValueIfPresent(usage, ['cache_write_tokens', 'cacheWriteTokens']) ??
    nestedUsageValue(
      usage,
      'prompt_tokens_details',
      ['cache_write_tokens'],
      'cacheWriteTokens'
    )
  if (cacheWrite === undefined) {
    throw new C1PreflightFailure(
      'USAGE_CONTRACT_MISMATCH',
      'provider usage is missing cacheWriteTokens'
    )
  }
  return {
    inputTokens: usageValue(usage, ['prompt_tokens', 'input_tokens', 'inputTokens'], 'inputTokens'),
    outputTokens: usageValue(
      usage,
      ['completion_tokens', 'output_tokens', 'outputTokens'],
      'outputTokens'
    ),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: usageValue(usage, ['total_tokens', 'totalTokens'], 'totalTokens'),
    usageSource: 'PROVIDER_REPORTED'
  }
}

function usageValueIfPresent(usage: JsonRecord, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = usage[key]
    if (value !== undefined) return nonNegativeInteger(value, key)
  }
  return undefined
}

function extractToolPath(argumentsText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(argumentsText)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const path = (parsed as Record<string, unknown>)['path']
    return typeof path === 'string' ? path : undefined
  } catch {
    return undefined
  }
}

function providerResponse(value: unknown): C1LiveModelResponse {
  const payload = asRecord(value, 'provider response')
  const responseId = nonEmptyString(payload['id'], 'provider response.id')
  const choices = payload['choices']
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'provider response has no choices')
  }
  const choice = asRecord(choices[0], 'provider response.choices[0]')
  const message = asRecord(choice['message'], 'provider response.choices[0].message')
  if (message['role'] !== 'assistant') {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'provider response message is not assistant')
  }
  const rawToolCalls = message['tool_calls']
  if (rawToolCalls !== undefined && !Array.isArray(rawToolCalls)) {
    throw new C1PreflightFailure('PREFLIGHT_FAILURE', 'provider tool_calls is not an array')
  }
  const toolCalls = (rawToolCalls ?? []).map((raw, index) => {
    const toolCall = asRecord(raw, `provider tool_calls[${index}]`)
    if (toolCall['type'] !== 'function') {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `provider tool_calls[${index}] is not a function call`
      )
    }
    const functionCall = asRecord(toolCall['function'], `provider tool_calls[${index}].function`)
    const argumentsText = toolArguments(
      functionCall['arguments'],
      `provider tool_calls[${index}].function.arguments`
    )
    const path = extractToolPath(argumentsText)
    return {
      toolCallId: nonEmptyString(toolCall['id'], `provider tool_calls[${index}].id`),
      toolName: nonEmptyString(functionCall['name'], `provider tool_calls[${index}].function.name`),
      ...(path === undefined ? {} : { path }),
      // The C1 observation source executes/observes the requested tool next;
      // SUCCESS here means the provider emitted a valid tool request.
      result: 'SUCCESS' as const
    }
  })
  const finishReason = choice['finish_reason']
  if (
    (finishReason === 'tool_calls' || finishReason === 'function_call') &&
    toolCalls.length === 0
  ) {
    throw new C1PreflightFailure(
      'PREFLIGHT_FAILURE',
      'provider indicated a tool call but returned no tool calls'
    )
  }
  const outcome =
    toolCalls.length > 0 || finishReason === 'tool_calls' || finishReason === 'function_call'
      ? 'CONTINUE'
      : finishReason === 'stop'
        ? 'COMPLETE'
        : finishReason === 'length'
          ? 'FAILED'
          : (() => {
              throw new C1PreflightFailure(
                'PREFLIGHT_FAILURE',
                `unsupported provider finish_reason: ${String(finishReason)}`
              )
            })()
  return {
    responseId,
    assistantMessageCount: 1,
    usage: providerUsage(payload['usage']),
    toolCalls,
    outcome
  }
}

function assertRequestBinding(
  request: C1LiveOutboundRequest,
  providerBinding: C1StrictProviderBinding
): void {
  if (
    request.capture.provider !== C1_PROVIDER_ID ||
    request.capture.model !== C1_MODEL_ID ||
    request.capture.endpoint !== C1_PROVIDER_ENDPOINT ||
    request.capture.providerConfigHash !== providerBinding.providerConfigHash ||
    providerBinding.providerConfigHash !== providerBinding.experimentBinding.providerConfigHash
  ) {
    throw new C1PreflightFailure(
      'PROVIDER_BINDING_MISMATCH',
      'authorized provider request does not match the frozen C1 binding'
    )
  }
}

export class C1AuthorizedProviderResponseSource implements C1LiveResponseSource {
  readonly kind = 'AUTHORIZED_PROVIDER' as const
  #apiKey: string
  private readonly providerBinding: C1StrictProviderBinding
  private readonly fetchImpl: typeof fetch
  private readonly requestTimeoutMs: number
  private readonly tools: readonly C1AuthorizedProviderToolDefinition[] | undefined
  private requests = 0

  constructor(options: C1AuthorizedProviderResponseSourceOptions) {
    assertC1StrictProviderBinding(options.providerBinding.experimentBinding)
    if (
      options.providerBinding.providerConfigHash !==
      options.providerBinding.experimentBinding.providerConfigHash
    ) {
      throw new C1PreflightFailure(
        'PROVIDER_BINDING_MISMATCH',
        'provider config hash is inconsistent with the strict experiment binding'
      )
    }
    if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
      throw new C1PreflightFailure(
        'PROVIDER_PREPARATION_FAILURE',
        'authorized provider source requires an in-memory API key'
      )
    }
    this.providerBinding = options.providerBinding
    this.#apiKey = options.apiKey
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    if (typeof this.fetchImpl !== 'function') {
      throw new C1PreflightFailure('PROVIDER_PREPARATION_FAILURE', 'global fetch is unavailable')
    }
    this.requestTimeoutMs = options.requestTimeoutMs ?? 600_000
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1) {
      throw new C1PreflightFailure(
        'PROVIDER_PREPARATION_FAILURE',
        'authorized provider request timeout must be a positive integer'
      )
    }
    this.tools = options.tools === undefined ? undefined : Object.freeze([...options.tools])
  }

  get requestCount(): number {
    return this.requests
  }

  async next(request: C1LiveOutboundRequest): Promise<C1LiveModelResponse> {
    assertRequestBinding(request, this.providerBinding)
    const messages = providerMessages(request.providerBoundMessages)
    const body = {
      model: C1_MODEL_ID,
      messages,
      stream: false,
      max_tokens: C1_AUTHORIZED_PROVIDER_MAX_TOKENS,
      ...(this.tools !== undefined ? { tools: [...this.tools] } : {})
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    this.requests += 1
    let response: Response
    try {
      response = await this.fetchImpl(C1_PROVIDER_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.#apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new C1PreflightFailure(
          'DEADLINE_EXCEEDED',
          `authorized provider request exceeded ${this.requestTimeoutMs}ms`
        )
      }
      throw new C1PreflightFailure(
        'PROVIDER_PREPARATION_FAILURE',
        `authorized provider request failed: ${error instanceof Error ? error.name : 'unknown error'}`
      )
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) {
      throw new C1PreflightFailure(
        'PROVIDER_PREPARATION_FAILURE',
        `authorized provider returned HTTP ${String(response.status)}`
      )
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        'authorized provider response was not valid JSON'
      )
    }
    return providerResponse(payload)
  }
}
