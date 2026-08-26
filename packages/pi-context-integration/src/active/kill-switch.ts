// CR-004 Stage 0 — per-Run kill switch for the offline Active seam.
//
// Semantics (adjudication: "Kill-switch behavior verified by tests"):
//   - One kill switch per Run id; instances are fully isolated (no global /
//     module-level state, no shared registries).
//   - `armed` is true until the switch trips; `trip(reason)` trips it and
//     records the FIRST reason + timestamp. Once tripped it stays tripped for
//     that run: the run falls back to Native context permanently.
//   - The clock is injected (`options.now`), so no time source is read inside
//     this module and tests are deterministic. No fs / network / provider.

export interface KillSwitchTripRecord {
  readonly reason: string
  readonly trippedAt: string
}

export interface RunKillSwitchOptions {
  /** Deterministic clock for trip timestamps. Required: the module reads no clock itself. */
  readonly now: () => string
}

export interface RunKillSwitch {
  readonly runId: string
  /** True until the switch trips (the inverse of `isTripped`). */
  readonly armed: boolean
  /** True once tripped; stays true for the lifetime of this run. */
  readonly isTripped: boolean
  /** The first trip record, or undefined while armed. */
  readonly tripRecord: KillSwitchTripRecord | undefined
  /**
   * Trip the switch. The first call records the reason + timestamp; later calls
   * are no-ops that return the original record (a tripped switch stays tripped).
   */
  trip(reason: string): KillSwitchTripRecord
}

class RunKillSwitchImpl implements RunKillSwitch {
  private record: KillSwitchTripRecord | undefined
  private readonly now: () => string

  constructor(readonly runId: string, now: () => string) {
    this.now = now
  }

  get armed(): boolean {
    return this.record === undefined
  }

  get isTripped(): boolean {
    return this.record !== undefined
  }

  get tripRecord(): KillSwitchTripRecord | undefined {
    return this.record
  }

  trip(reason: string): KillSwitchTripRecord {
    if (this.record === undefined) {
      this.record = { reason, trippedAt: this.now() }
    }
    return this.record
  }
}

/** Create an isolated per-Run kill switch. `now` is injected for determinism. */
export function createRunKillSwitch(runId: string, options: RunKillSwitchOptions): RunKillSwitch {
  if (runId.length === 0) {
    throw new Error('createRunKillSwitch requires a non-empty runId')
  }
  return new RunKillSwitchImpl(runId, options.now)
}
