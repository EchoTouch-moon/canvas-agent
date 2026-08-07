import type { DispatchResult, ExecutionRequestContract } from '@canvas-agent/contracts'
import { HostUnavailableError } from './command-errors'

export interface WorkerHost {
  dispatch(request: ExecutionRequestContract): Promise<DispatchResult>
  cancel(executionRequestId: string): Promise<boolean>
  dispose(): Promise<void>
}

export class UnavailableWorkerHost implements WorkerHost {
  async dispatch(request: ExecutionRequestContract): Promise<DispatchResult> {
    void request
    throw new HostUnavailableError(
      'Worker host is not available (Phase 2 wires the Utility Process)'
    )
  }

  async cancel(executionRequestId: string): Promise<boolean> {
    void executionRequestId
    return false
  }

  async dispose(): Promise<void> {
    return
  }
}
