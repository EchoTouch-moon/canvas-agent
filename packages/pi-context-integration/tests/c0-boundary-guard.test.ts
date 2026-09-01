import { describe, expect, it } from 'vitest'
import type { ContextEvent } from '@earendil-works/pi-coding-agent'
import {
  handleC0ContextBoundary,
  type C0BoundaryGuardExecutor
} from '../src/smoke/c0-boundary-guard'

describe('C0 context boundary guard', () => {
  it('aborts the active Pi loop when the current boundary trips a safety stop', () => {
    let aborts = 0
    const stops: Array<{ condition: string; reason: string }> = []
    const executor: C0BoundaryGuardExecutor = {
      observeBoundary: () => undefined,
      currentSafetyStop: () => ({
        stop: true,
        condition: 'S-4',
        reason: 'mandatory/pinned eviction count 1 > 0'
      })
    }
    let terminal = false

    handleC0ContextBoundary(
      executor,
      [],
      {
        abort: () => {
          aborts += 1
        }
      },
      (condition, reason) => {
        terminal = true
        stops.push({ condition, reason })
      },
      () => terminal
    )

    expect(stops).toEqual([{ condition: 'S-4', reason: 'mandatory/pinned eviction count 1 > 0' }])
    expect(aborts).toBe(1)
  })

  it('converts an observation error into S-2 and aborts instead of throwing', () => {
    let aborts = 0
    const stops: Array<{ condition: string; reason: string }> = []
    const executor: C0BoundaryGuardExecutor = {
      observeBoundary: () => {
        throw new Error('invalid observation')
      },
      currentSafetyStop: () => ({ stop: false })
    }
    let terminal = false

    expect(() =>
      handleC0ContextBoundary(
        executor,
        [],
        {
          abort: () => {
            aborts += 1
          }
        },
        (condition, reason) => {
          terminal = true
          stops.push({ condition, reason })
        },
        () => terminal
      )
    ).not.toThrow()

    expect(stops).toEqual([
      { condition: 'S-2', reason: 'C0 boundary failure: invalid observation' }
    ])
    expect(aborts).toBe(1)
  })

  it('converts a safety-evaluator error into S-2 and aborts instead of throwing', () => {
    let aborts = 0
    const stops: Array<{ condition: string; reason: string }> = []
    const executor: C0BoundaryGuardExecutor = {
      observeBoundary: () => undefined,
      currentSafetyStop: () => {
        throw new Error('evaluator unavailable')
      }
    }
    let terminal = false

    expect(() =>
      handleC0ContextBoundary(
        executor,
        [],
        {
          abort: () => {
            aborts += 1
          }
        },
        (condition, reason) => {
          terminal = true
          stops.push({ condition, reason })
        },
        () => terminal
      )
    ).not.toThrow()

    expect(stops).toEqual([
      { condition: 'S-2', reason: 'C0 safety evaluation failure: evaluator unavailable' }
    ])
    expect(aborts).toBe(1)
  })

  it('preserves the original messages when no stop is active', () => {
    const messages: ContextEvent['messages'] = []
    let observed = 0
    const executor: C0BoundaryGuardExecutor = {
      observeBoundary: (received) => {
        observed = received.length
      },
      currentSafetyStop: () => ({ stop: false })
    }
    const result = handleC0ContextBoundary(
      executor,
      messages,
      {
        abort: () => {
          throw new Error('must not abort')
        }
      },
      () => {
        throw new Error('must not stop')
      },
      () => false
    )

    expect(observed).toBe(0)
    expect(result.messages).toBe(messages)
  })
})
