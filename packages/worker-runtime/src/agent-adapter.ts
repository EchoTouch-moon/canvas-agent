import { mkdir, appendFile, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import type { ExecutionContextBundleV2 } from '@canvas-agent/contracts'
import { BudgetExceededError, CancelledError, PathDeniedError, WorkerError } from './errors'
import { runCommand, type RunCommandResult } from './process-runner'

export interface ToolPolicyContract {
  allowedTools: readonly string[]
  deniedPaths: readonly string[]
  allowNetwork: boolean
  allowShell: boolean
}

export interface AgentContext {
  cwd: string
  toolPolicy: ToolPolicyContract
  maxToolCalls: number
  maxDurationMs: number
  commandAllowlist: readonly string[]
  signal?: AbortSignal
  env?: Record<string, string>
  executionRequestId: string
  agentConfiguration: { provider: string; model: string; temperature?: number | undefined }
  contextBundle?: ExecutionContextBundleV2 | undefined
}

export interface AgentArtifact {
  fileName: string
  content: string
}

export interface AgentSummary {
  text: string
  artifacts: readonly AgentArtifact[]
}

export interface AgentAdapter {
  run(context: AgentContext): Promise<AgentSummary>
}

export type FixtureStep =
  | { kind: 'appendFile'; file: string; lines: readonly string[] }
  | { kind: 'runCommand'; argv: readonly string[]; failOnNonZero?: boolean }

export interface FixtureAgentAdapterOptions {
  steps: readonly FixtureStep[]
  summary: string
}

export interface FixtureStepEvidence {
  step: number
  kind: FixtureStep['kind']
  ok: boolean
  detail?: string
  result?: RunCommandResult
}

export class FixtureAgentAdapter implements AgentAdapter {
  private readonly steps: readonly FixtureStep[]
  private readonly summary: string

  constructor(options: FixtureAgentAdapterOptions) {
    this.steps = options.steps
    this.summary = options.summary
  }

  async run(context: AgentContext): Promise<AgentSummary> {
    const startedAt = Date.now()
    let toolCalls = 0
    const evidence: FixtureStepEvidence[] = []
    const artifacts: AgentArtifact[] = []

    for (const [index, step] of this.steps.entries()) {
      if (context.signal?.aborted) {
        throw new CancelledError()
      }
      if (toolCalls >= context.maxToolCalls) {
        throw new BudgetExceededError('maxToolCalls', context.maxToolCalls)
      }
      if (Date.now() - startedAt >= context.maxDurationMs) {
        throw new BudgetExceededError('maxDurationMs', context.maxDurationMs)
      }

      try {
        if (step.kind === 'appendFile') {
          this.validateWritePath(context.cwd, context.toolPolicy.deniedPaths, step.file)
          const filePath = resolve(context.cwd, step.file)
          await mkdir(dirname(filePath), { recursive: true })
          await appendFile(filePath, step.lines.join('\n') + '\n', 'utf8')
          evidence.push({ step: index, kind: 'appendFile', ok: true })
        } else {
          this.validateCommandPolicy(context.toolPolicy, step.argv)
          const result = await runCommand({
            argv: step.argv,
            cwd: context.cwd,
            timeoutMs: Math.max(1, context.maxDurationMs - (Date.now() - startedAt)),
            maxOutputBytes: 64 * 1024,
            commandAllowlist: context.commandAllowlist,
            signal: context.signal,
            env: context.env
          })
          if (result.cancelled) {
            throw new CancelledError()
          }
          evidence.push({
            step: index,
            kind: 'runCommand',
            ok: !step.failOnNonZero || result.exitCode === 0,
            result
          })
        }
        toolCalls += 1
      } catch (error) {
        if (error instanceof CancelledError || error instanceof BudgetExceededError) {
          throw error
        }
        evidence.push({ step: index, kind: step.kind, ok: false, detail: describeError(error) })
        artifacts.push({
          fileName: 'partial-evidence.json',
          content: JSON.stringify({ evidence }, null, 2)
        })
        throw error
      }
    }

    artifacts.push({
      fileName: 'agent-summary.txt',
      content: this.summary
    })

    return { text: this.summary, artifacts }
  }

  private validateWritePath(cwd: string, deniedPaths: readonly string[], file: string): void {
    if (isAbsolute(file)) {
      throw new PathDeniedError(file)
    }
    const resolved = resolve(cwd, file)
    const root = resolve(cwd)
    if (!resolved.startsWith(root + sep)) {
      throw new PathDeniedError(file)
    }
    for (const denied of deniedPaths) {
      const deniedResolved = resolve(cwd, denied)
      if (resolved === deniedResolved || resolved.startsWith(deniedResolved + sep)) {
        throw new PathDeniedError(file)
      }
    }
  }

  private validateCommandPolicy(toolPolicy: ToolPolicyContract, argv: readonly string[]): void {
    if (!toolPolicy.allowedTools.includes('run_command')) {
      throw new WorkerError(`Tool policy does not allow the "run_command" tool`)
    }
    if (!toolPolicy.allowShell) {
      throw new WorkerError(`Tool policy forbids running commands`)
    }
    if (argv[0] === undefined) {
      throw new WorkerError('Command argv must not be empty')
    }
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export async function readArtifactContent(path: string): Promise<string> {
  return readFile(path, 'utf8')
}
