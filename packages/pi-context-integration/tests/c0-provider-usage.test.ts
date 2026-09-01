import { describe, expect, it } from 'vitest'
import { C0ProviderUsageLedger, normalizeC0ProviderUsage } from '../src/smoke/c0-provider-usage'

const base = {
  runId: 'c0-20260901-1234abcd',
  scenarioId: 'E2',
  turnLabel: 'recover',
  assistantMessageSequence: 1
} as const

function assistantMessage(usage: unknown): unknown {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'private provider response must not be persisted' }],
    usage
  }
}

describe('CSPV-C0 provider usage evidence', () => {
  it('preserves valid normalized token usage without message content', () => {
    const record = normalizeC0ProviderUsage({
      ...base,
      message: assistantMessage({
        input: 120,
        output: 30,
        cacheRead: 4,
        cacheWrite: 2,
        totalTokens: 156
      })
    })

    expect(record).toMatchObject({
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 4,
      cacheWriteTokens: 2,
      totalTokens: 156,
      usageSource: 'PROVIDER_REPORTED',
      reportedCost: null,
      costCurrency: null,
      costSource: 'UNAVAILABLE'
    })
    expect(JSON.stringify(record)).not.toContain('private provider response')
  })

  it('marks absent usage unavailable instead of estimating it', () => {
    const record = normalizeC0ProviderUsage({
      ...base,
      message: assistantMessage(undefined)
    })

    expect(record.usageSource).toBe('UNAVAILABLE')
    expect(record.inputTokens).toBeNull()
    expect(record.outputTokens).toBeNull()
    expect(record.totalTokens).toBeNull()
  })

  it('rejects malformed token fields and does not synthesize totals', () => {
    const record = normalizeC0ProviderUsage({
      ...base,
      message: assistantMessage({
        input: 100,
        output: Number.NaN,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 100
      })
    })

    expect(record.usageSource).toBe('UNAVAILABLE')
    expect(record.inputTokens).toBeNull()
    expect(record.totalTokens).toBeNull()
  })

  it('accepts explicitly supplied provider cost but never derives it from zero pricing', () => {
    const withCost = normalizeC0ProviderUsage({
      ...base,
      message: assistantMessage({
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15
      }),
      reportedCost: { amount: 0.012, currency: 'USD' }
    })
    const withoutCost = normalizeC0ProviderUsage({
      ...base,
      message: assistantMessage({
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15
      })
    })

    expect(withCost).toMatchObject({
      reportedCost: 0.012,
      costCurrency: 'USD',
      costSource: 'PROVIDER_REPORTED'
    })
    expect(withoutCost).toMatchObject({
      reportedCost: null,
      costCurrency: null,
      costSource: 'UNAVAILABLE'
    })
  })

  it('summarizes reported rows separately from unavailable rows', () => {
    const ledger = new C0ProviderUsageLedger()
    const first = ledger.recordAssistantMessage({
      runId: base.runId,
      scenarioId: base.scenarioId,
      turnLabel: base.turnLabel,
      message: assistantMessage({
        input: 20,
        output: 10,
        cacheRead: 1,
        cacheWrite: 0,
        totalTokens: 31
      })
    })
    const second = ledger.recordAssistantMessage({
      runId: base.runId,
      scenarioId: base.scenarioId,
      turnLabel: 'follow-up',
      message: assistantMessage(null)
    })

    expect(first.assistantMessageSequence).toBe(1)
    expect(second.assistantMessageSequence).toBe(2)
    expect(ledger.summary()).toEqual({
      status: 'INCOMPLETE',
      assistantMessages: 2,
      providerReportedMessages: 1,
      unavailableMessages: 1,
      reportedTotals: {
        inputTokens: 20,
        outputTokens: 10,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        totalTokens: 31
      },
      costSource: 'UNAVAILABLE',
      reportedCostTotal: null,
      costCurrency: null
    })
  })

  it('does not present a partial cost total as complete cost evidence', () => {
    const ledger = new C0ProviderUsageLedger()
    const usage = {
      input: 20,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30
    }

    ledger.recordAssistantMessage({
      ...base,
      message: assistantMessage(usage),
      reportedCost: { amount: 0.01, currency: 'USD' }
    })
    ledger.recordAssistantMessage({
      ...base,
      turnLabel: 'follow-up',
      message: assistantMessage(usage)
    })

    expect(ledger.summary()).toMatchObject({
      costSource: 'UNAVAILABLE',
      reportedCostTotal: null,
      costCurrency: null
    })
  })
})
