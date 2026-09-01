// CSPV-C0 live-run transport guard.
//
// The C0 contract counts provider calls at the outbound fetch seam. This
// wrapper deliberately lives outside the model-call observer: an observer
// record is evidence about a context boundary, while a transport call is an
// actual request attempt to the bound provider. The distinction matters when
// one prompt yields several boundaries or when the provider fails after a
// request has been attempted.

type C0FetchInput = Parameters<typeof globalThis.fetch>[0]
type C0FetchInit = Parameters<typeof globalThis.fetch>[1]

export class C0ProviderTransportBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'C0ProviderTransportBlockedError'
  }
}

export interface C0ProviderTransportGuardOptions {
  readonly providerBaseUrl: string
  readonly maxCalls: number
  readonly shouldBlock: () => boolean
  readonly onBudgetExhausted: (attemptedCall: number) => void
}

function canonicalBaseUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString().replace(/\/$/, '')
}

function requestUrl(input: C0FetchInput): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function isProviderRequest(input: C0FetchInput, providerBaseUrl: string): boolean {
  let request: URL
  let base: URL
  try {
    request = new URL(requestUrl(input))
    base = new URL(providerBaseUrl)
  } catch {
    return false
  }
  if (request.origin !== base.origin) return false
  const basePath = base.pathname.replace(/\/+$/, '') || '/'
  return basePath === '/'
    ? request.pathname.startsWith('/')
    : request.pathname === basePath || request.pathname.startsWith(`${basePath}/`)
}

/**
 * Counts and bounds actual requests to the selected provider.
 *
 * Install only after explicit live-mode opt-in and strict provider binding.
 * Requests to other origins pass through unchanged. A terminal stop or the
 * next call beyond the hard budget is rejected before the original fetch is
 * reached, so the guard cannot itself create an over-budget outbound call.
 */
export class C0ProviderTransportGuard {
  private readonly options: C0ProviderTransportGuardOptions
  private readonly originalFetch: typeof globalThis.fetch
  private readonly providerBaseUrl: string
  private installedFetch: typeof globalThis.fetch | undefined
  private callCount = 0

  constructor(options: C0ProviderTransportGuardOptions) {
    if (!Number.isInteger(options.maxCalls) || options.maxCalls <= 0) {
      throw new Error(`C0 provider-call budget must be a positive integer: ${options.maxCalls}`)
    }
    if (typeof globalThis.fetch !== 'function') {
      throw new Error('global fetch is unavailable')
    }
    this.options = options
    this.originalFetch = globalThis.fetch
    this.providerBaseUrl = canonicalBaseUrl(options.providerBaseUrl)
  }

  get providerCalls(): number {
    return this.callCount
  }

  install(): void {
    if (this.installedFetch !== undefined) {
      throw new Error('C0 provider transport guard is already installed')
    }

    const guardedFetch: typeof globalThis.fetch = async (
      input: C0FetchInput,
      init?: C0FetchInit
    ) => {
      if (!isProviderRequest(input, this.providerBaseUrl)) {
        return this.originalFetch(input, init)
      }

      if (this.options.shouldBlock()) {
        throw new C0ProviderTransportBlockedError(
          'C0 terminal stop blocked a provider request before outbound transport'
        )
      }

      if (this.callCount >= this.options.maxCalls) {
        const attemptedCall = this.callCount + 1
        this.options.onBudgetExhausted(attemptedCall)
        throw new C0ProviderTransportBlockedError(
          `C0 provider-call budget blocked outbound request ${attemptedCall}; maximum is ${this.options.maxCalls}`
        )
      }

      // Count immediately before invoking the original transport. A rejected
      // fetch still represents an attempted provider call and must be charged
      // to the hard ledger.
      this.callCount += 1
      return this.originalFetch(input, init)
    }

    this.installedFetch = guardedFetch
    globalThis.fetch = guardedFetch
  }

  restore(): void {
    if (this.installedFetch === undefined) return
    // Do not overwrite a replacement installed by another owner after us.
    if (globalThis.fetch === this.installedFetch) {
      globalThis.fetch = this.originalFetch
    }
    this.installedFetch = undefined
  }
}
