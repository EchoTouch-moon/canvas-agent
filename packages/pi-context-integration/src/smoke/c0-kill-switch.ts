import { C0_ABORT_GRACE_MS } from './c0-prompt-deadline'

export const C0_OPERATOR_SIGNALS = ['SIGINT', 'SIGTERM'] as const
export type C0OperatorSignal = (typeof C0_OPERATOR_SIGNALS)[number]

export interface C0OperatorSignalSource {
  on(signal: C0OperatorSignal, listener: () => void): unknown
  off(signal: C0OperatorSignal, listener: () => void): unknown
}

export interface C0OperatorKillSwitch {
  readonly killed: boolean
  readonly signal: C0OperatorSignal | null
  readonly whenKilled: Promise<C0OperatorSignal>
  dispose(): void
}

export interface C0AbortableSession {
  abort(): Promise<void>
}

export type C0AbortOutcome =
  | { readonly status: 'SETTLED' }
  | { readonly status: 'REJECTED'; readonly errorMessage: string }
  | { readonly status: 'TIMED_OUT'; readonly errorMessage: string }

/**
 * Abort an active C0 session without allowing a broken abort channel to keep
 * operator termination unbounded. The underlying abort promise is observed so
 * a late rejection cannot become an unhandled process error.
 */
export async function abortC0SessionWithinGrace(
  session: C0AbortableSession,
  graceMs: number = C0_ABORT_GRACE_MS
): Promise<C0AbortOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const abortOutcome = Promise.resolve()
    .then(() => session.abort())
    .then(
      () => ({ status: 'SETTLED' as const }),
      (error: unknown) => ({
        status: 'REJECTED' as const,
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    )
  try {
    return await Promise.race([
      abortOutcome,
      new Promise<C0AbortOutcome>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              status: 'TIMED_OUT',
              errorMessage: `C0 operator abort exceeded ${graceMs}ms`
            }),
          graceMs
        )
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Bind operator termination to the C0 terminal path. SIGKILL is intentionally
 * not included: the operating system cannot deliver it to a user handler.
 */
export function installC0OperatorKillSwitch(
  onKill: (signal: C0OperatorSignal) => void,
  source: C0OperatorSignalSource = process
): C0OperatorKillSwitch {
  let killedSignal: C0OperatorSignal | null = null
  let resolveWhenKilled: ((signal: C0OperatorSignal) => void) | undefined
  const whenKilled = new Promise<C0OperatorSignal>((resolve) => {
    resolveWhenKilled = resolve
  })

  const handlers = new Map<C0OperatorSignal, () => void>()
  for (const signal of C0_OPERATOR_SIGNALS) {
    const handler = (): void => {
      if (killedSignal !== null) return
      killedSignal = signal
      resolveWhenKilled?.(signal)
      onKill(signal)
    }
    handlers.set(signal, handler)
    source.on(signal, handler)
  }

  return {
    get killed(): boolean {
      return killedSignal !== null
    },
    get signal(): C0OperatorSignal | null {
      return killedSignal
    },
    whenKilled,
    dispose(): void {
      for (const [signal, handler] of handlers) source.off(signal, handler)
      handlers.clear()
    }
  }
}
