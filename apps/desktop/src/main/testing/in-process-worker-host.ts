import {
  FixtureAgentAdapter,
  createCodexAgentAdapter,
  createWorker
} from '@canvas-agent/worker-runtime'
import type { DispatchResult, ExecutionRequestContract } from '@canvas-agent/contracts'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import type { AppConfig } from '../config'
import type { WorkerHost } from '../worker-host'

export class InProcessWorkerHost implements WorkerHost {
  private readonly controllers = new Map<string, AbortController>()
  private readonly workers = new Map<string, ReturnType<typeof createWorker>>()
  private readonly now: () => string
  private readonly codexExecutable: string | null

  constructor(
    private readonly appConfig: AppConfig,
    now?: () => string,
    codexExecutable?: string
  ) {
    this.now = now ?? (() => new Date().toISOString())
    this.codexExecutable = codexExecutable ?? null
  }

  async dispatch(request: ExecutionRequestContract): Promise<DispatchResult> {
    const controller = new AbortController()
    const worker = createWorker({
      runtimeDirectory: this.appConfig.runtimeDirectory,
      sourceRepositoryPath: this.appConfig.sourceRepositoryPath,
      capabilities: ['git', 'node'],
      commandAllowlist: ['git', 'node'],
      verificationCommands: [],
      now: this.now,
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' }),
      ...(this.codexExecutable !== null
        ? {
            codexAdapter: createCodexAgentAdapter({
              executable: this.codexExecutable,
              environment: {
                PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
                HOME: tmpdir()
              },
              runtimeDirectory: this.appConfig.runtimeDirectory
            })
          }
        : {})
    })
    this.controllers.set(request.executionRequestId, controller)
    this.workers.set(request.executionRequestId, worker)
    try {
      const result = await worker.dispatch({ request, signal: controller.signal })
      return result as unknown as DispatchResult
    } finally {
      this.controllers.delete(request.executionRequestId)
      this.workers.delete(request.executionRequestId)
    }
  }

  async cancel(executionRequestId: string): Promise<boolean> {
    const controller = this.controllers.get(executionRequestId)
    if (!controller) return false
    controller.abort()
    return true
  }

  async dispose(): Promise<void> {
    for (const controller of this.controllers.values()) {
      controller.abort()
    }
    this.controllers.clear()
    this.workers.clear()
  }
}
