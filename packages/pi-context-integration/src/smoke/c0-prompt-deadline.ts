import {
  runPromptWithDeadline,
  type LegDeadlineOutcome,
  type PromptDeadlineSession
} from './leg-deadline'

/** Maximum time spent awaiting AgentSession.abort() after a C0 deadline. */
export const C0_ABORT_GRACE_MS = 1_000

async function abortWithinC0Grace<TPromptResult>(
  session: PromptDeadlineSession<TPromptResult>
): Promise<void> {
  let abortTimer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      session.abort(),
      new Promise<never>((_, reject) => {
        abortTimer = setTimeout(
          () => reject(new Error(`C0 session.abort() exceeded ${C0_ABORT_GRACE_MS}ms`)),
          C0_ABORT_GRACE_MS
        )
      })
    ])
  } finally {
    if (abortTimer !== undefined) clearTimeout(abortTimer)
  }
}

/**
 * Run a C0 prompt under the remaining run-wide wall-clock budget.
 *
 * The callback fires before AgentSession.abort(), closing the C0 terminal state
 * before an in-flight abort can schedule or expose another provider request.
 * A zero settle grace keeps the C0 runner's 60-minute budget hard; the generic
 * helper still preserves whether the prompt settled after abort and any bounded
 * abort error for logging.
 */
export function runC0PromptWithDeadline<TPromptResult>(
  session: PromptDeadlineSession<TPromptResult>,
  promptText: string,
  deadlineMs: number,
  onDeadline: () => void
): Promise<LegDeadlineOutcome<TPromptResult>> {
  return runPromptWithDeadline(
    {
      prompt: (text) => session.prompt(text),
      abort: async () => {
        onDeadline()
        await abortWithinC0Grace(session)
      }
    },
    promptText,
    deadlineMs,
    { settleGraceMs: 0 }
  )
}
