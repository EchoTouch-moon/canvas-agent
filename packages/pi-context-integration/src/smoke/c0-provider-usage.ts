/**
 * Provider usage evidence for the CSPV-C0 live runner.
 *
 * This module deliberately accepts an unknown assistant message instead of a
 * provider-specific response shape. The Pi session is the only approved seam
 * here. It exposes normalized usage without requiring the runner to persist
 * prompts, responses, credentials, or raw provider payloads.
 */

export type C0UsageSource = 'PROVIDER_REPORTED' | 'UNAVAILABLE'
export type C0CostSource = 'PROVIDER_REPORTED' | 'UNAVAILABLE'
export type C0UsageEvidenceStatus = 'COMPLETE' | 'INCOMPLETE' | 'NOT_APPLICABLE'
export type C0L1ObservabilityVerdict = 'PASS' | 'INCOMPLETE' | 'NOT_APPLICABLE'

export interface C0ProviderReportedCost {
  readonly amount: number
  readonly currency: string
}

export interface C0ProviderUsageRecord {
  readonly runId: string
  readonly scenarioId: string
  readonly turnLabel: string
  readonly assistantMessageSequence: number
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly totalTokens: number | null
  readonly usageSource: C0UsageSource
  readonly reportedCost: number | null
  readonly costCurrency: string | null
  readonly costSource: C0CostSource
}

export interface C0ProviderUsageTotals {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly totalTokens: number
}

export interface C0ProviderUsageSummary {
  readonly status: C0UsageEvidenceStatus
  readonly assistantMessages: number
  readonly providerReportedMessages: number
  readonly unavailableMessages: number
  /** Totals include only rows whose usageSource is PROVIDER_REPORTED. */
  readonly reportedTotals: C0ProviderUsageTotals
  readonly costSource: C0CostSource
  readonly reportedCostTotal: number | null
  readonly costCurrency: string | null
}

export function c0L1ObservabilityVerdict(
  mode: 'LIVE' | 'DRY_RUN',
  summary: Pick<C0ProviderUsageSummary, 'status' | 'assistantMessages'>
): C0L1ObservabilityVerdict {
  if (mode === 'DRY_RUN') return 'NOT_APPLICABLE'
  return summary.status === 'COMPLETE' && summary.assistantMessages > 0 ? 'PASS' : 'INCOMPLETE'
}

interface UsageShape {
  readonly input?: unknown
  readonly output?: unknown
  readonly cacheRead?: unknown
  readonly cacheWrite?: unknown
  readonly totalTokens?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function usageFromMessage(message: unknown): UsageShape | null {
  const record = asRecord(message)
  if (record === null || record['role'] !== 'assistant') return null
  const usage = asRecord(record['usage'])
  if (usage === null) return null
  return usage
}

function normalizeTokens(usage: UsageShape | null): {
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly totalTokens: number | null
  readonly available: boolean
} {
  const inputTokens = finiteNonNegative(usage?.input)
  const outputTokens = finiteNonNegative(usage?.output)
  const cacheReadTokens = finiteNonNegative(usage?.cacheRead)
  const cacheWriteTokens = finiteNonNegative(usage?.cacheWrite)
  const totalTokens = finiteNonNegative(usage?.totalTokens)
  const available =
    inputTokens !== null &&
    outputTokens !== null &&
    cacheReadTokens !== null &&
    cacheWriteTokens !== null &&
    totalTokens !== null &&
    totalTokens > 0

  return available
    ? {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        available
      }
    : {
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        totalTokens: null,
        available: false
      }
}

function normalizeCost(cost: C0ProviderReportedCost | undefined): {
  readonly reportedCost: number | null
  readonly costCurrency: string | null
  readonly costSource: C0CostSource
} {
  if (
    cost !== undefined &&
    typeof cost.currency === 'string' &&
    Number.isFinite(cost.amount) &&
    cost.amount >= 0 &&
    cost.currency.length > 0
  ) {
    return {
      reportedCost: cost.amount,
      costCurrency: cost.currency,
      costSource: 'PROVIDER_REPORTED'
    }
  }
  return { reportedCost: null, costCurrency: null, costSource: 'UNAVAILABLE' }
}

export interface C0ProviderUsageRecordInput {
  readonly runId: string
  readonly scenarioId: string
  readonly turnLabel: string
  readonly assistantMessageSequence: number
  readonly message: unknown
  /** Only pass this when a provider explicitly reports a monetary amount. */
  readonly reportedCost?: C0ProviderReportedCost
}

export function normalizeC0ProviderUsage(input: C0ProviderUsageRecordInput): C0ProviderUsageRecord {
  const usage = normalizeTokens(usageFromMessage(input.message))
  const cost = normalizeCost(input.reportedCost)
  return {
    runId: input.runId,
    scenarioId: input.scenarioId,
    turnLabel: input.turnLabel,
    assistantMessageSequence: input.assistantMessageSequence,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    usageSource: usage.available ? 'PROVIDER_REPORTED' : 'UNAVAILABLE',
    ...cost
  }
}

export class C0ProviderUsageLedger {
  private readonly entries: C0ProviderUsageRecord[] = []

  recordAssistantMessage(
    input: Omit<C0ProviderUsageRecordInput, 'assistantMessageSequence'>
  ): C0ProviderUsageRecord {
    const record = normalizeC0ProviderUsage({
      ...input,
      assistantMessageSequence: this.entries.length + 1
    })
    this.entries.push(record)
    return record
  }

  get records(): readonly C0ProviderUsageRecord[] {
    return this.entries
  }

  summary(): C0ProviderUsageSummary {
    const reported = this.entries.filter((entry) => entry.usageSource === 'PROVIDER_REPORTED')
    const unavailableMessages = this.entries.length - reported.length
    const reportedTotals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0
    }
    for (const entry of reported) {
      reportedTotals.inputTokens += entry.inputTokens ?? 0
      reportedTotals.outputTokens += entry.outputTokens ?? 0
      reportedTotals.cacheReadTokens += entry.cacheReadTokens ?? 0
      reportedTotals.cacheWriteTokens += entry.cacheWriteTokens ?? 0
      reportedTotals.totalTokens += entry.totalTokens ?? 0
    }

    const costs = this.entries.filter((entry) => entry.costSource === 'PROVIDER_REPORTED')
    const currencies = new Set(costs.map((entry) => entry.costCurrency).filter(Boolean))
    const costCurrency = currencies.size === 1 ? ([...currencies][0] ?? null) : null

    const costComplete =
      this.entries.length > 0 && costs.length === this.entries.length && currencies.size === 1

    return {
      status: this.entries.length > 0 && unavailableMessages === 0 ? 'COMPLETE' : 'INCOMPLETE',
      assistantMessages: this.entries.length,
      providerReportedMessages: reported.length,
      unavailableMessages,
      reportedTotals,
      costSource: costComplete ? 'PROVIDER_REPORTED' : 'UNAVAILABLE',
      reportedCostTotal: costComplete
        ? costs.reduce((sum, entry) => sum + (entry.reportedCost ?? 0), 0)
        : null,
      costCurrency: costComplete ? costCurrency : null
    }
  }
}
