import type { ModelCallObservation } from '../observation/types'

export interface ObservationSink {
  write(observation: ModelCallObservation): void
  close?(): void
}

// In-memory research sink for deterministic unit/integration tests. No
// filesystem, no network.
export class InMemoryObservationSink implements ObservationSink {
  readonly observations: ModelCallObservation[] = []

  write(observation: ModelCallObservation): void {
    this.observations.push(observation)
  }

  get count(): number {
    return this.observations.length
  }

  last(): ModelCallObservation | undefined {
    return this.observations[this.observations.length - 1]
  }

  clear(): void {
    this.observations.length = 0
  }
}
