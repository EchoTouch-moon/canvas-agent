import { afterEach, describe, expect, it } from 'vitest'
import {
  C0ProviderTransportBlockedError,
  C0ProviderTransportGuard
} from '../src/smoke/c0-provider-transport'

// Credential-free transport tests. The original fetch is always restored and
// all requests are handled by an in-memory fake; provider calls: 0.
const processFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = processFetch
})

function installFakeFetch(
  options: {
    readonly reject?: boolean
  } = {}
): { readonly requests: string[]; readonly fetch: typeof globalThis.fetch } {
  const requests: string[] = []
  const fakeFetch = (async (input) => {
    requests.push(
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    )
    if (options.reject) throw new Error('transport unavailable')
    return new Response('ok')
  }) as typeof globalThis.fetch
  globalThis.fetch = fakeFetch
  return { requests, fetch: fakeFetch }
}

const STEP_PLAN_URL = 'https://api.stepfun.com/step_plan/v1'
const COMPLETIONS_URL = `${STEP_PLAN_URL}/chat/completions`

describe('C0ProviderTransportGuard', () => {
  it('counts only matching provider requests and restores the prior fetch', async () => {
    const fake = installFakeFetch()
    const guard = new C0ProviderTransportGuard({
      providerBaseUrl: `${STEP_PLAN_URL}/`,
      maxCalls: 4,
      shouldBlock: () => false,
      onBudgetExhausted: () => undefined
    })

    guard.install()
    await fetch(COMPLETIONS_URL)
    await fetch(new URL(`${COMPLETIONS_URL}?stream=true`))
    await fetch(new Request(`${COMPLETIONS_URL}?stream=true`))
    await fetch('https://api.stepfun.com/step_plan/v10/chat/completions')
    await fetch(`${STEP_PLAN_URL}?health=1`)
    await fetch('https://example.test/health')

    expect(guard.providerCalls).toBe(4)
    expect(fake.requests).toEqual([
      COMPLETIONS_URL,
      `${COMPLETIONS_URL}?stream=true`,
      `${COMPLETIONS_URL}?stream=true`,
      'https://api.stepfun.com/step_plan/v10/chat/completions',
      `${STEP_PLAN_URL}?health=1`,
      'https://example.test/health'
    ])

    guard.restore()
    expect(globalThis.fetch).toBe(fake.fetch)
    // The fake remains installed until afterEach, proving the guard restored
    // the exact fetch implementation it captured at construction time.
    expect(await fetch('https://example.test/restored')).toBeInstanceOf(Response)
  })

  it('charges a provider request before a transport rejection', async () => {
    installFakeFetch({ reject: true })
    const guard = new C0ProviderTransportGuard({
      providerBaseUrl: STEP_PLAN_URL,
      maxCalls: 4,
      shouldBlock: () => false,
      onBudgetExhausted: () => undefined
    })
    guard.install()

    await expect(fetch(COMPLETIONS_URL)).rejects.toThrow('transport unavailable')
    expect(guard.providerCalls).toBe(1)
    guard.restore()
  })

  it('blocks the next provider request before outbound transport at the hard budget', async () => {
    const fake = installFakeFetch()
    const budgetEvents: number[] = []
    const guard = new C0ProviderTransportGuard({
      providerBaseUrl: STEP_PLAN_URL,
      maxCalls: 1,
      shouldBlock: () => false,
      onBudgetExhausted: (attemptedCall) => budgetEvents.push(attemptedCall)
    })
    guard.install()

    await fetch(COMPLETIONS_URL)
    await expect(fetch(COMPLETIONS_URL)).rejects.toBeInstanceOf(C0ProviderTransportBlockedError)

    expect(guard.providerCalls).toBe(1)
    expect(fake.requests).toEqual([COMPLETIONS_URL])
    expect(budgetEvents).toEqual([2])
    guard.restore()
  })

  it('blocks a provider request after a terminal stop without invoking fetch', async () => {
    const fake = installFakeFetch()
    let terminal = true
    const guard = new C0ProviderTransportGuard({
      providerBaseUrl: STEP_PLAN_URL,
      maxCalls: 4,
      shouldBlock: () => terminal,
      onBudgetExhausted: () => undefined
    })
    guard.install()

    await expect(fetch(COMPLETIONS_URL)).rejects.toBeInstanceOf(C0ProviderTransportBlockedError)
    expect(guard.providerCalls).toBe(0)
    expect(fake.requests).toEqual([])

    terminal = false
    await fetch(COMPLETIONS_URL)
    expect(guard.providerCalls).toBe(1)
    expect(fake.requests).toEqual([COMPLETIONS_URL])
    guard.restore()
  })

  it('rejects invalid budgets and duplicate installation', () => {
    installFakeFetch()
    expect(
      () =>
        new C0ProviderTransportGuard({
          providerBaseUrl: STEP_PLAN_URL,
          maxCalls: 0,
          shouldBlock: () => false,
          onBudgetExhausted: () => undefined
        })
    ).toThrow('positive integer')

    const guard = new C0ProviderTransportGuard({
      providerBaseUrl: STEP_PLAN_URL,
      maxCalls: 1,
      shouldBlock: () => false,
      onBudgetExhausted: () => undefined
    })
    guard.install()
    expect(() => guard.install()).toThrow('already installed')
    guard.restore()
  })
})
