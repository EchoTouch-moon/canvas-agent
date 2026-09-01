import type { ContextEvent } from '@earendil-works/pi-coding-agent'
import type { C0StopConditionId, C0StopDecision } from './c0-scenarios'

export interface C0BoundaryGuardExecutor {
  observeBoundary(messages: ContextEvent['messages']): unknown
  currentSafetyStop(): C0StopDecision
}

export interface C0BoundaryAbortContext {
  abort(): void
}

/**
 * Handle one Pi context boundary and abort the current agent loop on a
 * fail-closed C0 condition.
 *
 * Pi's extension runner catches handler exceptions and continues, so this
 * function intentionally reports the stop through the runner-owned callback
 * and calls ExtensionContext.abort() explicitly. It is kept separate from the
 * live process runner so the abort behavior can be verified without a model or
 * network.
 */
export function handleC0ContextBoundary(
  executor: C0BoundaryGuardExecutor,
  messages: ContextEvent['messages'],
  context: C0BoundaryAbortContext,
  fireStop: (condition: C0StopConditionId, reason: string) => void,
  shouldStop: () => boolean
): { readonly messages: ContextEvent['messages'] } {
  try {
    executor.observeBoundary(messages)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fireStop('S-2', `C0 boundary failure: ${message}`)
  }
  if (!shouldStop()) {
    try {
      const stop = executor.currentSafetyStop()
      if (stop.stop) {
        fireStop(stop.condition, stop.reason)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      fireStop('S-2', `C0 safety evaluation failure: ${message}`)
    }
  }
  if (shouldStop()) {
    context.abort()
  }
  return { messages }
}
