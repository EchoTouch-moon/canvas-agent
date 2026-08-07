import { FixtureAgentAdapter, createWorker, type AgentAdapter } from '@canvas-agent/worker-runtime'
import type { DispatchResult } from '@canvas-agent/contracts'
import {
  workerHostRequestSchema,
  type WorkerHostRequest,
  type WorkerHostResponse
} from './protocol'

export interface WorkerTransport {
  send(response: WorkerHostResponse): void
}

export interface WorkerServiceOverrides {
  verificationCommands?: readonly (readonly string[])[]
  agent?: AgentAdapter
}

interface ExecutionEntry {
  controller: AbortController
  completion: Promise<void>
}

type WorkerErrorCode = 'NOT_INITIALIZED' | 'INVALID_FRAME' | 'SERVICE_FAILURE'

function frameError(
  messageId: string,
  executionRequestId: string | null,
  code: WorkerErrorCode,
  message: string
): WorkerHostResponse {
  return { protocolVersion: 1, type: 'error', messageId, executionRequestId, code, message }
}

export class WorkerService {
  private worker: ReturnType<typeof createWorker> | null = null
  private readonly executions = new Map<string, ExecutionEntry>()
  private initialized = false
  private readonly overrides: WorkerServiceOverrides

  constructor(
    private readonly transport: WorkerTransport,
    overrides: WorkerServiceOverrides = {}
  ) {
    this.overrides = overrides
  }

  async onRequest(raw: unknown): Promise<void> {
    const parsed = workerHostRequestSchema.safeParse(raw)
    if (!parsed.success) {
      const rawFrame = (typeof raw === 'object' && raw !== null ? raw : {}) as {
        messageId?: unknown
      }
      this.transport.send(
        frameError(
          typeof rawFrame.messageId === 'string' ? rawFrame.messageId : '',
          null,
          'INVALID_FRAME',
          'invalid worker host request'
        )
      )
      return
    }

    const request = parsed.data
    try {
      switch (request.type) {
        case 'init':
          this.init(request)
          break
        case 'dispatch':
          await this.dispatch(request)
          break
        case 'cancel':
          this.cancel(request)
          break
        case 'dispose':
          await this.dispose()
          break
      }
    } catch (error) {
      this.transport.send(
        frameError(
          'messageId' in request ? request.messageId : '',
          'executionRequestId' in request ? request.executionRequestId : null,
          'SERVICE_FAILURE',
          error instanceof Error ? error.message : String(error)
        )
      )
    }
  }

  private init(request: Extract<WorkerHostRequest, { type: 'init' }>): void {
    this.worker = createWorker({
      runtimeDirectory: request.runtimeDirectory,
      sourceRepositoryPath: request.sourceRepositoryPath,
      capabilities: ['git', 'node'],
      commandAllowlist: ['git', 'node'],
      verificationCommands: this.overrides.verificationCommands ?? [
        ['node', '-e', 'process.exit(require("fs").existsSync("docs/phase2.md") ? 0 : 1)']
      ],
      agent:
        this.overrides.agent ??
        new FixtureAgentAdapter({
          steps: [
            {
              kind: 'appendFile',
              file: 'docs/phase2.md',
              lines: ['# phase2', 'written by the utility process']
            }
          ],
          summary: 'phase2: wrote docs/phase2.md'
        })
    })
    this.initialized = true
    this.transport.send({ protocolVersion: 1, type: 'init:ack' })
  }

  private async dispatch(request: Extract<WorkerHostRequest, { type: 'dispatch' }>): Promise<void> {
    if (!this.initialized || this.worker === null) {
      this.transport.send(
        frameError(
          request.messageId,
          request.executionRequestId,
          'NOT_INITIALIZED',
          'worker not initialized'
        )
      )
      return
    }

    const controller = new AbortController()
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })
    this.executions.set(request.executionRequestId, { controller, completion })

    try {
      const result = await this.worker.dispatch({
        request: request.request,
        signal: controller.signal
      })
      this.transport.send({
        protocolVersion: 1,
        type: 'dispatch:result',
        messageId: request.messageId,
        executionRequestId: request.executionRequestId,
        result: result as unknown as DispatchResult
      })
    } catch (error) {
      this.transport.send(
        frameError(
          request.messageId,
          request.executionRequestId,
          'SERVICE_FAILURE',
          error instanceof Error ? error.message : String(error)
        )
      )
    } finally {
      this.executions.delete(request.executionRequestId)
      resolveCompletion()
    }
  }

  private cancel(request: Extract<WorkerHostRequest, { type: 'cancel' }>): void {
    const entry = this.executions.get(request.executionRequestId)
    if (entry !== undefined) {
      entry.controller.abort()
    }
    this.transport.send({
      protocolVersion: 1,
      type: 'cancel:result',
      messageId: request.messageId,
      executionRequestId: request.executionRequestId,
      cancelled: entry !== undefined
    })
  }

  private async dispose(): Promise<void> {
    this.initialized = false
    const completions = [...this.executions.values()].map((entry) => entry.completion)
    for (const entry of this.executions.values()) {
      entry.controller.abort()
    }
    await Promise.allSettled(completions)
    this.executions.clear()
    this.worker = null
    this.transport.send({ protocolVersion: 1, type: 'dispose:ack' })
  }
}
