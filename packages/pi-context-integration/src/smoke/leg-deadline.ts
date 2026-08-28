// CR-004 hardening — IN-FLIGHT LEG DEADLINE.
//
// The M3/M4 matrix runs hit a real stall hazard: a hung session.prompt with
// no in-flight timeout could only be resolved by killing the process
// externally (M3 precedent: identity recorded as aborted, matrix relaunched
// under a fresh identity). This module replaces that operational mitigation
// with an in-process bound: every live leg prompt races a wall-clock deadline
// (the leg's manifest wallClockMs + a fixed grace). When the deadline fires
// the session is aborted IN FLIGHT via AgentSession.abort() (a real cancel,
// not a process kill), the prompt promise is given a short settle window, and
// a TIMED_OUT outcome is returned. Runners map TIMED_OUT to a FAILED leg with
// stop condition S-9 ('leg deadline exceeded; session aborted in-flight'),
// flush the evidence collected so far, and CONTINUE to the next leg.
//
// No provider, no network, no fs: pure promise orchestration.

/** Deadline grace added to the leg's manifest wallClockMs (contract S-9). */
export const LEG_DEADLINE_GRACE_MS = 60_000
/** How long a TIMED_OUT prompt gets to settle after abort() before we return. */
export const LEG_DEADLINE_SETTLE_GRACE_MS = 10_000

/** Structural slice of Pi's AgentSession the deadline helper needs. */
export interface PromptDeadlineSession<TPromptResult = unknown> {
  prompt(promptText: string): Promise<TPromptResult>
  abort(): Promise<void>
}

export type LegDeadlineOutcome<TPromptResult> =
  | { readonly status: 'COMPLETED'; readonly result: TPromptResult }
  | {
      readonly status: 'TIMED_OUT'
      readonly deadlineMs: number
      /** True when the aborted prompt promise settled within the grace. */
      readonly settledWithinGrace: boolean
      /** Bounded message when session.abort() itself rejected. */
      readonly abortErrorMessage?: string
    }

/**
 * Run one live-leg prompt under a wall-clock deadline.
 *
 * - The prompt promise racing the timer settles first => COMPLETED with its
 *   result (a prompt REJECTION propagates to the caller: that is a provider
 *   failure, not a timeout).
 * - The deadline fires first => `await session.abort()` (in flight), a brief
 *   wait for the prompt to settle (result/errors swallowed — the leg is
 *   already lost), and a TIMED_OUT outcome.
 */
export async function runPromptWithDeadline<TPromptResult>(
  session: PromptDeadlineSession<TPromptResult>,
  promptText: string,
  deadlineMs: number,
  options: { readonly settleGraceMs?: number } = {}
): Promise<LegDeadlineOutcome<TPromptResult>> {
  const settleGraceMs = options.settleGraceMs ?? LEG_DEADLINE_SETTLE_GRACE_MS
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  const deadlineFired = new Promise<true>((resolve) => {
    deadlineTimer = setTimeout(() => resolve(true), deadlineMs)
  })
  const promptSettled = session.prompt(promptText).then(
    (result) => ({ settled: true as const, result: result as TPromptResult }),
    (error: unknown) => ({ settled: true as const, error })
  )
  const winner = await Promise.race([promptSettled.then(() => false), deadlineFired])
  if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
  if (!winner) {
    const settled = await promptSettled
    if ('error' in settled) throw settled.error
    return { status: 'COMPLETED', result: settled.result }
  }
  // Deadline: abort IN FLIGHT, then give the aborted prompt a settle window.
  let abortErrorMessage: string | undefined
  try {
    await session.abort()
  } catch (error) {
    abortErrorMessage = error instanceof Error ? error.message : String(error)
  }
  const settledWithinGrace = await Promise.race([
    promptSettled.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), settleGraceMs)
    })
  ])
  return {
    status: 'TIMED_OUT',
    deadlineMs,
    settledWithinGrace,
    ...(abortErrorMessage !== undefined ? { abortErrorMessage } : {})
  }
}

/** The deadline a leg's prompt runs under: manifest wallClockMs + grace. */
export function legDeadlineOf(manifestWallClockMs: number): number {
  return manifestWallClockMs + LEG_DEADLINE_GRACE_MS
}

/** Canonical S-9 reason recorded for a TIMED_OUT leg (matrix + Stage 1). */
export const LEG_DEADLINE_STOP_REASON = 'leg deadline exceeded; session aborted in-flight'
