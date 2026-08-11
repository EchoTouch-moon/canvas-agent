import {
  buildObservation,
  InMemoryObservationSink,
  RuntimeSession,
  type NormalizedMessageInput
} from '@canvas-agent/context-runtime'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { mapPiMessages, type PiMessageView } from '../pi-message-mapper'

export interface ShadowObservationSinks {
  readonly inMemory: InMemoryObservationSink
}

export interface PiShadowObserverOptions {
  readonly runtimeSessionId?: string
  // Provider/Agent-neutral harness identifier. `'PI'` is the Pi integration's
  // own value; the core never constrains this to Pi.
  readonly harness?: string
  readonly sinks?: ShadowObservationSinks
  readonly now?: () => string
}

// Shadow-only Pi context observer. It maps the Pi `context` event messages to
// provider-neutral observations, records bounded metadata, and returns the
// ORIGINAL messages unchanged. Canvas observes context; it never rewrites it.
export class PiContextShadowObserver {
  readonly runtimeSession: RuntimeSession
  readonly inMemory: InMemoryObservationSink
  private readonly harness: string
  private readonly now: () => string

  constructor(options: PiShadowObserverOptions = {}) {
    this.runtimeSession = new RuntimeSession(options.runtimeSessionId)
    this.harness = options.harness ?? 'PI'
    this.now = options.now ?? (() => new Date().toISOString())
    this.inMemory = options.sinks?.inMemory ?? new InMemoryObservationSink()
  }

  // Claims the next sequence for a new model call. Call exactly once per Pi
  // `context` event; sequence is monotonic within this Runtime Session.
  beginModelCall(): number {
    return this.runtimeSession.nextSequence()
  }

  // Observe a model-call boundary. Returns the observation (test/debug use);
  // the Pi handler must return the original messages, not this observation.
  observe(messages: readonly PiMessageView[], sequence: number): unknown {
    const normalized: NormalizedMessageInput[] = mapPiMessages(messages)
    const observation = buildObservation({
      runtimeSessionId: this.runtimeSession.runtimeSessionId,
      sequence,
      observedAt: this.now(),
      harness: this.harness,
      messages: normalized
    })
    this.inMemory.write(observation)
    return observation
  }

  // Full shadow pipeline for one `context` event: observe + return original.
  handleContextEvent(messages: readonly PiMessageView[]): { messages: readonly PiMessageView[] } {
    const sequence = this.beginModelCall()
    this.observe(messages, sequence)
    return { messages }
  }
}

export interface PiContextShadowExtensionOptions {
  readonly observer?: PiContextShadowObserver
}

// Pi extension factory: registers the `context` hook. `pi.on("context", ...)`
// is the authoritative pre-LLM semantic model-call seam (per DS-008). The
// handler returns the original messages, preserving Pi's actual context.
export function createPiContextShadowExtension(
  options: PiContextShadowExtensionOptions = {}
): ExtensionFactory {
  const observer = options.observer ?? new PiContextShadowObserver()
  return (pi: ExtensionAPI) => {
    pi.on('context', async (event: ContextEvent) => {
      const result = observer.handleContextEvent(event.messages)
      return { messages: result.messages as ContextEvent['messages'] }
    })
  }
}
