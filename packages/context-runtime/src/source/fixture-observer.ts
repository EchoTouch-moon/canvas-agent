import type { SourceObservation, SourceObservationStatus } from '../source/source-types'

// EXPERIMENTAL fixture-backed source observer. It answers "what is the current
// state of this source?" from an explicit, in-memory fixture table. This is the
// only legitimate way to produce ABSENT (confirmed absence) or UNAVAILABLE
// (failed observation) in CR-002; message disappearance alone is never ABSENT.

export interface FixtureSourceEntry {
  readonly sourceKey: string
  readonly status: SourceObservationStatus
  readonly contentHash?: string
  readonly reasonCode?: string
}

export class FixtureSourceObserver {
  private readonly table = new Map<string, FixtureSourceEntry>()

  constructor(entries: readonly FixtureSourceEntry[] = []) {
    for (const entry of entries) {
      this.table.set(entry.sourceKey, entry)
    }
  }

  observe(sourceKey: string, observedAt: string): SourceObservation | null {
    const entry = this.table.get(sourceKey)
    if (entry === undefined) {
      // No fixture entry: the observer has no configured opinion. Returning
      // null means "not observed by this observer", never ABSENT.
      return null
    }
    const base: SourceObservation = {
      sourceKey,
      status: entry.status,
      observedAt
    }
    if (entry.status === 'AVAILABLE' && entry.contentHash !== undefined) {
      return { ...base, contentHash: entry.contentHash }
    }
    if (entry.status === 'UNAVAILABLE' && entry.reasonCode !== undefined) {
      return { ...base, reasonCode: entry.reasonCode }
    }
    return base
  }

  upsert(entry: FixtureSourceEntry): void {
    this.table.set(entry.sourceKey, entry)
  }
}
