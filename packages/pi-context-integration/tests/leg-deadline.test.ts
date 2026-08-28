import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LEG_DEADLINE_GRACE_MS,
  LEG_DEADLINE_SETTLE_GRACE_MS,
  LEG_DEADLINE_STOP_REASON,
  legDeadlineOf,
  runPromptWithDeadline,
  type PromptDeadlineSession
} from '../src/experimental'

// CR-004 hardening — in-flight leg deadline unit tests. Fake sessions only:
// a resolving prompt, a rejecting prompt, and a never-settling prompt with an
// abort spy. Provider calls: 0.

afterEach(() => {
  vi.useRealTimers()
})

function fakeSession(behavior: {
  readonly prompt: () => Promise<string>
}): PromptDeadlineSession<string> & { readonly abortCalls: number } {
  const session = {
    abortCalls: 0,
    prompt: (_promptText: string) => behavior.prompt(),
    abort: async () => {
      session.abortCalls += 1
    }
  }
  return session
}

describe('runPromptWithDeadline', () => {
  it('returns COMPLETED with the result when the prompt settles first', async () => {
    vi.useFakeTimers()
    const session = fakeSession({ prompt: async () => 'done' })
    const outcomePromise = runPromptWithDeadline(session, 'do the task', 5_000)
    // Let microtasks drain; the prompt resolves well before the deadline.
    const outcome = await outcomePromise
    expect(outcome).toEqual({ status: 'COMPLETED', result: 'done' })
    expect(session.abortCalls).toBe(0)
  })

  it('propagates a prompt rejection (a provider failure is not a timeout)', async () => {
    const session = fakeSession({
      prompt: () => Promise.reject(new Error('provider transport failed'))
    })
    await expect(runPromptWithDeadline(session, 'do the task', 5_000)).rejects.toThrow(
      'provider transport failed'
    )
    expect(session.abortCalls).toBe(0)
  })

  it('aborts the session in flight and reports TIMED_OUT when the prompt never settles', async () => {
    vi.useFakeTimers()
    const session = fakeSession({ prompt: () => new Promise<string>(() => {}) })
    const outcomePromise = runPromptWithDeadline(session, 'do the task', 1_000, {
      settleGraceMs: 10_000
    })
    await vi.advanceTimersByTimeAsync(1_000) // deadline fires; abort runs
    await vi.advanceTimersByTimeAsync(10_000) // settle grace expires unsettled
    const outcome = await outcomePromise
    expect(outcome.status).toBe('TIMED_OUT')
    if (outcome.status === 'TIMED_OUT') {
      expect(outcome.deadlineMs).toBe(1_000)
      expect(outcome.settledWithinGrace).toBe(false)
      expect(outcome.abortErrorMessage).toBeUndefined()
    }
    expect(session.abortCalls).toBe(1)
  })

  it('records settle-within-grace when the aborted prompt finishes shortly after abort', async () => {
    vi.useFakeTimers()
    let settlePrompt: ((value: string) => void) | undefined
    const session = fakeSession({
      prompt: () =>
        new Promise<string>((resolve) => {
          settlePrompt = resolve
        })
    })
    const outcomePromise = runPromptWithDeadline(session, 'do the task', 1_000, {
      settleGraceMs: 10_000
    })
    await vi.advanceTimersByTimeAsync(1_000) // deadline; abort() called
    settlePrompt!('late') // the aborted prompt settles within the grace
    const outcome = await outcomePromise
    expect(outcome.status).toBe('TIMED_OUT')
    if (outcome.status === 'TIMED_OUT') {
      expect(outcome.settledWithinGrace).toBe(true)
    }
    expect(session.abortCalls).toBe(1)
  })

  it('reports a bounded abortErrorMessage when session.abort() itself rejects', async () => {
    vi.useFakeTimers()
    const session: PromptDeadlineSession<string> = {
      prompt: () => new Promise<string>(() => {}),
      abort: () => Promise.reject(new Error('abort channel broken'))
    }
    const outcomePromise = runPromptWithDeadline(session, 'do the task', 1_000, {
      settleGraceMs: 10
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(10)
    const outcome = await outcomePromise
    expect(outcome.status).toBe('TIMED_OUT')
    if (outcome.status === 'TIMED_OUT') {
      expect(outcome.abortErrorMessage).toBe('abort channel broken')
    }
  })

  it('deadline constants and legDeadlineOf match the contract (wallClockMs + 60s)', () => {
    expect(LEG_DEADLINE_GRACE_MS).toBe(60_000)
    expect(LEG_DEADLINE_SETTLE_GRACE_MS).toBe(10_000)
    expect(legDeadlineOf(600_000)).toBe(660_000)
    expect(LEG_DEADLINE_STOP_REASON).toBe('leg deadline exceeded; session aborted in-flight')
  })
})
