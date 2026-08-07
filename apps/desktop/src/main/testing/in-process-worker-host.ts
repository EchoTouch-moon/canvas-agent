import { FixtureAgentAdapter, createWorker } from '@canvas-agent/worker-runtime'
import type { DispatchResult, ExecutionRequestContract } from '@canvas-agent/contracts'
import type { AppConfig } from '../config'
import type { WorkerHost } from '../worker-host'

export class InProcessWorkerHost implements WorkerHost {
  private readonly controllers = new Map<string, AbortController>()
  private readonly workers = new Map<string, ReturnType<typeof createWorker>>()

  constructor(private readonly appConfig: AppConfig) {}

  async dispatch(request: ExecutionRequestContract): Promise<DispatchResult> {
    const controller = new AbortController()
    const worker = createWorker({
      runtimeDirectory: this.appConfig.runtimeDirectory,
      sourceRepositoryPath: this.appConfig.sourceRepositoryPath,
      capabilities: ['git', 'node'],
      commandAllowlist: ['git', 'node'],
      verificationCommands: [],
      agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' })
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
