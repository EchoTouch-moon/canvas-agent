// Runtime Session owns a stable session identity and the monotonic sequence
// counter. Call #1, #2, #3 ... are numbered within one Runtime Session.
export class RuntimeSession {
  readonly runtimeSessionId: string
  private readonly startingSequence: number
  private claimed = 0

  constructor(runtimeSessionId?: string, startingSequence = 1) {
    this.runtimeSessionId = runtimeSessionId ?? createRuntimeSessionId()
    this.startingSequence = startingSequence
  }

  // Last claimed sequence, or `startingSequence - 1` when nothing is claimed yet.
  currentSequence(): number {
    return this.startingSequence + this.claimed - 1
  }

  // Claims the next model-call sequence (monotonic, never repeated within a
  // Runtime Session). The first claim returns `startingSequence`.
  nextSequence(): number {
    this.claimed += 1
    return this.currentSequence()
  }

  // All claimed sequences, oldest first.
  sequenceTimeline(): readonly number[] {
    return Array.from({ length: this.claimed }, (_, index) => this.startingSequence + index)
  }
}

// Deterministic, collision-resistant-enough research session id. It is a
// timestamp+random suffix; it is not a persisted domain identity.
export function createRuntimeSessionId(): string {
  const now = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `session-${now}-${random}`
}
