import { afterEach, describe, expect, it, vi } from 'vitest'
import { C0_ABORT_GRACE_MS, runC0PromptWithDeadline } from '../src/smoke/c0-prompt-deadline'
import type { PromptDeadlineSession } from '../src/smoke/leg-deadline'

afterEach(() => {
  vi.useRealTimers()
})

describe('runC0PromptWithDeadline', () => {
  it('fires the terminal callback before aborting an overdue prompt', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const session: PromptDeadlineSession<string> = {
      prompt: () => new Promise<string>(() => undefined),
      abort: async () => {
        order.push('abort')
      }
    }

    const outcomePromise = runC0PromptWithDeadline(session, 'bounded prompt', 1000, () =>
      order.push('deadline')
    )
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runAllTimersAsync()
    const outcome = await outcomePromise

    expect(outcome.status).toBe('TIMED_OUT')
    expect(order).toEqual(['deadline', 'abort'])
  })

  it('does not fire the deadline callback when the prompt completes first', async () => {
    const order: string[] = []
    const session: PromptDeadlineSession<string> = {
      prompt: async () => 'done',
      abort: async () => {
        order.push('abort')
      }
    }

    const outcome = await runC0PromptWithDeadline(session, 'fast prompt', 1000, () =>
      order.push('deadline')
    )

    expect(outcome).toEqual({ status: 'COMPLETED', result: 'done' })
    expect(order).toEqual([])
  })

  it('returns after the bounded abort grace when session.abort() itself hangs', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const session: PromptDeadlineSession<string> = {
      prompt: () => new Promise<string>(() => undefined),
      abort: () => {
        order.push('abort')
        return new Promise<void>(() => undefined)
      }
    }

    const outcomePromise = runC0PromptWithDeadline(session, 'stalled abort', 1000, () =>
      order.push('deadline')
    )
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(C0_ABORT_GRACE_MS)
    await vi.runAllTimersAsync()
    const outcome = await outcomePromise

    expect(outcome.status).toBe('TIMED_OUT')
    if (outcome.status === 'TIMED_OUT') {
      expect(outcome.abortErrorMessage).toBe(`C0 session.abort() exceeded ${C0_ABORT_GRACE_MS}ms`)
    }
    expect(order).toEqual(['deadline', 'abort'])
  })
})
