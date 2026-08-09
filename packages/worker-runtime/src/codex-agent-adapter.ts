import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ExecutionContextItemV2 } from '@canvas-agent/contracts'
import { isSupportedCodexVersion } from './codex-version'
import { CODEX_FINAL_RESPONSE_SCHEMA_JSON, codexFinalResponseSchema } from './codex-output-schema'
import {
  AGENT_AUTH_REQUIRED,
  AGENT_EXECUTABLE_NOT_FOUND,
  AGENT_INTERPRETER_MISSING,
  AGENT_OUTPUT_INVALID,
  AGENT_OUTPUT_LIMIT_EXCEEDED,
  AGENT_PROCESS_FAILED,
  AGENT_TIMED_OUT,
  AGENT_VERSION_UNSUPPORTED,
  BudgetExceededError,
  CancelledError,
  LocalCliError,
  LocalCliOutputInvalidError,
  LocalCliSpawnError
} from './errors'
import { runLocalCli, type LocalCliResult } from './local-cli-runner'
import type { AgentAdapter, AgentArtifact, AgentContext, AgentSummary } from './agent-adapter'

export interface CodexAgentAdapterOptions {
  executable: string
  environment: { PATH: string; HOME: string }
  runtimeDirectory: string
}

const VERSION_PROBE_TIMEOUT_MS = 5_000
const VERSION_PROBE_OUTPUT_BYTES = 16 * 1024

const KNOWN_NON_TOOL_ITEM_TYPES = new Set(['agent_message', 'reasoning', 'todo_list', 'error'])

export interface CodexTransportDiagnostics {
  version: string | null
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  cancelled: boolean
  stdoutTruncated: boolean
  stderrTruncated: boolean
  eventCounts: {
    turnStarted: number
    turnCompleted: number
    turnFailed: number
    topLevelError: number
    agentMessage: number
  }
  toolCallCount: number
  usage: { input_tokens: number; output_tokens: number; reasoning_output_tokens: number } | null
  stderrClass: 'empty' | 'warning' | 'auth' | 'other'
}

function toStderrClass(stderr: string): CodexTransportDiagnostics['stderrClass'] {
  if (stderr.trim().length === 0) return 'empty'
  if (/not logged in|authentication required|api key|unauthorized|401/i.test(stderr)) return 'auth'
  if (/warning|error codex_models_manager/i.test(stderr)) return 'warning'
  return 'other'
}

function describeSpawnError(error: LocalCliSpawnError): LocalCliError {
  if (error.errno === 'ENOENT') {
    return new LocalCliError(AGENT_EXECUTABLE_NOT_FOUND, `executable not found`)
  }
  return new LocalCliError(AGENT_INTERPRETER_MISSING, `launcher interpreter missing`)
}

export function createCodexAgentAdapter(options: CodexAgentAdapterOptions): AgentAdapter {
  return {
    async run(context: AgentContext): Promise<AgentSummary> {
      const bundle = context.contextBundle
      if (bundle === undefined) {
        throw new LocalCliError(AGENT_OUTPUT_INVALID, 'codex adapter requires a v2 context bundle')
      }

      const controller = new AbortController()
      let budgetExceeded = false
      if (context.signal !== undefined) {
        context.signal.addEventListener('abort', () => controller.abort(), { once: true })
      }

      const version = await probeVersion(options)
      const schemaPath = await writeSchemaFile(options, context.executionRequestId)

      if (context.signal?.aborted) {
        throw new CancelledError()
      }

      const toolIds = new Set<string>()
      let streamToolCalls = 0
      const onLine = (line: string): void => {
        let parsed: { item?: { id?: unknown; type?: unknown } } | null = null
        try {
          parsed = JSON.parse(line) as { item?: { id?: unknown; type?: unknown } }
        } catch {
          return
        }
        const item = parsed?.item
        if (item === undefined || typeof item.id !== 'string' || toolIds.has(item.id)) {
          return
        }
        const type = typeof item.type === 'string' ? item.type : undefined
        if (!KNOWN_NON_TOOL_ITEM_TYPES.has(type ?? '')) {
          toolIds.add(item.id)
          streamToolCalls += 1
          if (streamToolCalls > context.maxToolCalls) {
            budgetExceeded = true
            controller.abort()
          }
        }
      }

      const prompt = buildPrompt(context.executionRequestId, bundle.items, context.cwd)

      const result = await runLocalCli({
        executable: options.executable,
        argv: [
          'exec',
          '--json',
          '--cd',
          context.cwd,
          '--sandbox',
          'workspace-write',
          '--color',
          'never',
          '--ephemeral',
          '--ignore-user-config',
          '--ignore-rules',
          '-c',
          'project_doc_max_bytes=0',
          '--output-schema',
          schemaPath,
          '-'
        ],
        cwd: context.cwd,
        stdin: prompt,
        timeoutMs: context.maxDurationMs,
        maxStdoutBytes: 4 * 1024 * 1024,
        maxStderrBytes: 1024 * 1024,
        environment: { PATH: options.environment.PATH, HOME: options.environment.HOME },
        signal: controller.signal,
        onLine
      })

      const stderrClass = toStderrClass(result.stderr)

      if (budgetExceeded) {
        throw new BudgetExceededError('maxToolCalls', context.maxToolCalls)
      }
      if (result.cancelled) {
        if (context.signal?.aborted) {
          throw new CancelledError()
        }
        throw new LocalCliError(AGENT_TIMED_OUT, 'codex process cancelled without a worker abort')
      }
      if (result.timedOut) {
        throw new LocalCliError(AGENT_TIMED_OUT, 'codex process exceeded maxDurationMs')
      }
      if (result.stdoutTruncated || result.stderrTruncated) {
        throw new LocalCliError(AGENT_OUTPUT_LIMIT_EXCEEDED, 'codex output exceeded its limit')
      }

      const events = parseCodexEvents(result.stdout)
      const transport: CodexTransportDiagnostics = {
        version,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
        eventCounts: {
          turnStarted: events.turnStarted,
          turnCompleted: events.turnCompleted ? 1 : 0,
          turnFailed: events.turnFailed !== null ? 1 : 0,
          topLevelError: events.topLevelError !== null ? 1 : 0,
          agentMessage: events.agentMessageCount
        },
        toolCallCount: events.toolCallCount,
        usage: events.usage,
        stderrClass
      }

      const succeeded =
        events.topLevelError === null &&
        events.turnFailed === null &&
        events.turnCompleted &&
        result.exitCode === 0
      if (!succeeded) {
        // Auth is classified from a failed run; a successful run with an
        // auth-looking warning on stderr is not an auth failure.
        if (stderrClass === 'auth') {
          throw new LocalCliError(AGENT_AUTH_REQUIRED, 'codex requires authentication')
        }
        throw new LocalCliError(AGENT_PROCESS_FAILED, 'codex turn did not complete successfully')
      }
      if (events.lastAgentMessage === null) {
        throw new LocalCliError(AGENT_OUTPUT_INVALID, 'codex produced no final agent message')
      }

      let final: ReturnType<typeof codexFinalResponseSchema.safeParse>
      try {
        final = codexFinalResponseSchema.safeParse(JSON.parse(events.lastAgentMessage))
      } catch {
        throw new LocalCliOutputInvalidError('final agent message is not valid JSON')
      }
      if (!final.success) {
        throw new LocalCliOutputInvalidError('final agent message does not match the output schema')
      }

      const artifacts: AgentArtifact[] = [
        {
          fileName: 'transport.json',
          content: JSON.stringify(transport, null, 2)
        }
      ]
      return { text: events.lastAgentMessage, artifacts }
    }
  }
}

async function probeVersion(options: CodexAgentAdapterOptions): Promise<string> {
  let result: LocalCliResult
  try {
    result = await runLocalCli({
      executable: options.executable,
      argv: ['--version'],
      cwd: dirname(options.executable),
      timeoutMs: VERSION_PROBE_TIMEOUT_MS,
      maxStdoutBytes: VERSION_PROBE_OUTPUT_BYTES,
      maxStderrBytes: VERSION_PROBE_OUTPUT_BYTES,
      environment: { PATH: options.environment.PATH, HOME: options.environment.HOME }
    })
  } catch (error) {
    if (error instanceof LocalCliSpawnError) {
      throw describeSpawnError(error)
    }
    throw new LocalCliError(AGENT_EXECUTABLE_NOT_FOUND, 'codex version probe failed')
  }
  if (result.timedOut) {
    throw new LocalCliError(AGENT_TIMED_OUT, 'codex version probe timed out')
  }
  const version = result.stdout.trim()
  if (!isSupportedCodexVersion(version)) {
    throw new LocalCliError(AGENT_VERSION_UNSUPPORTED, `unsupported codex version: ${version}`)
  }
  return version
}

async function writeSchemaFile(options: CodexAgentAdapterOptions, executionRequestId: string): Promise<string> {
  const dir = join(options.runtimeDirectory, 'agent-schemas')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${executionRequestId}.schema.json`)
  await writeFile(path, CODEX_FINAL_RESPONSE_SCHEMA_JSON, 'utf8')
  return path
}

function labelFor(item: ExecutionContextItemV2): string {
  return `position=${item.position} itemType=${item.itemType} authority=${item.authority} priority=${item.priority} source=${item.sourceRef}`
}

export function buildPrompt(
  executionRequestId: string,
  items: readonly ExecutionContextItemV2[],
  cwd: string
): string {
  const sections: string[] = []
  sections.push(
    `Canvas Agent execution request ${executionRequestId}.`,
    `You are working in an isolated Git worktree at ${cwd}.`,
    'Safety policy: work only inside the current directory; do not commit, push, create or switch branches, or leave this directory; never use sandbox/approval bypass flags.',
    'Respond with exactly one JSON object conforming to the provided output schema as your final message.',
    '',
    'Frozen context (in position order):'
  )
  for (const item of items) {
    sections.push(`--- ${labelFor(item)} ---`)
    sections.push(JSON.stringify(item.resolvedContent))
  }
  sections.push(
    '',
    'Final output requirements:',
    '- Output exactly one JSON object matching the provided output schema.',
    '- summary: a short description of what you did.',
    '- changes: list of files you changed (created/modified/deleted).',
    '- tool_calls_observed: the number of tool calls you performed.',
    '- tests_run: the commands you ran as verification.',
    '- success: true only if the change is complete and independently verifiable.'
  )
  return sections.join('\n')
}

function parseCodexEvents(stdout: string): {
  turnStarted: number
  turnCompleted: boolean
  turnFailed: string | null
  topLevelError: string | null
  agentMessageCount: number
  lastAgentMessage: string | null
  toolCallCount: number
  usage: { input_tokens: number; output_tokens: number; reasoning_output_tokens: number } | null
} {
  const toolIds = new Set<string>()
  let turnStarted = 0
  let turnCompleted = false
  let turnFailed: string | null = null
  let topLevelError: string | null = null
  let agentMessageCount = 0
  let lastAgentMessage: string | null = null
  let usage: { input_tokens: number; output_tokens: number; reasoning_output_tokens: number } | null =
    null

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    let parsed: {
      type?: unknown
      item?: { id?: unknown; type?: unknown; text?: unknown }
      usage?: { input_tokens?: unknown; output_tokens?: unknown; reasoning_output_tokens?: unknown }
      error?: { message?: unknown }
      message?: unknown
    }
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new LocalCliOutputInvalidError('malformed JSONL line in codex output')
    }
    if (parsed.type === 'turn.started') turnStarted += 1
    else if (parsed.type === 'turn.completed') {
      turnCompleted = true
      usage = toUsage(parsed.usage)
    } else if (parsed.type === 'turn.failed') {
      turnFailed = typeof parsed.error?.message === 'string' ? parsed.error.message : 'turn failed'
    } else if (parsed.type === 'error') {
      topLevelError = typeof parsed.message === 'string' ? parsed.message : 'error'
    } else if (parsed.type === 'item.completed' || parsed.type === 'item.updated') {
      const item = parsed.item
      if (typeof item?.id === 'string') {
        const type = typeof item.type === 'string' ? item.type : undefined
        if (!KNOWN_NON_TOOL_ITEM_TYPES.has(type ?? '')) {
          toolIds.add(item.id)
        }
      }
      if (item?.type === 'agent_message' && typeof item.text === 'string' && item.text.trim() !== '') {
        agentMessageCount += 1
        lastAgentMessage = item.text
      }
    }
  }
  return {
    turnStarted,
    turnCompleted,
    turnFailed,
    topLevelError,
    agentMessageCount,
    lastAgentMessage,
    toolCallCount: toolIds.size,
    usage
  }
}

function toUsage(
  usage: { input_tokens?: unknown; output_tokens?: unknown; reasoning_output_tokens?: unknown } | undefined
): { input_tokens: number; output_tokens: number; reasoning_output_tokens: number } | null {
  if (usage === undefined) return null
  return {
    input_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
    output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    reasoning_output_tokens:
      typeof usage.reasoning_output_tokens === 'number' ? usage.reasoning_output_tokens : 0
  }
}
