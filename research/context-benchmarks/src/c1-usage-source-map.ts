export const C1_USAGE_SOURCE_MAP_RELATIVE_PATH =
  'research/context-benchmarks/c1/contracts/c1-provider-usage-source-map-v1.json'

export interface C1UsageSourceMap {
  readonly sourceMapId: 'C1_PROVIDER_USAGE_SOURCE_MAP_V1'
  readonly schemaVersion: 1
  readonly status: 'DRAFT_ZERO_PROVIDER_EVIDENCE_CANDIDATE'
  readonly providerExecution: 'NOT_AUTHORIZED'
  readonly ledgers: Readonly<Record<'c0' | 'c1', Readonly<Record<string, unknown>>>>
  readonly fieldMap: readonly Readonly<Record<string, unknown>>[]
  readonly endpointEligibility: readonly Readonly<Record<string, unknown>>[]
  readonly nonCombinationRules: readonly string[]
  readonly verification: Readonly<Record<string, unknown>>
}

export class C1UsageSourceMapFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'C1UsageSourceMapFailure'
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new C1UsageSourceMapFailure(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new C1UsageSourceMapFailure(`${label} must be an array`)
  return value
}

function exact(value: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new C1UsageSourceMapFailure(`${label} does not match the frozen source-map rule`)
  }
}

function includes(value: readonly unknown[], expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new C1UsageSourceMapFailure(`${label} is missing ${expected}`)
  }
}

/**
 * Validate the zero-provider source map's semantic boundary. This is not a
 * provider parser and does not merge C0/C1 records; it only validates the
 * committed, machine-readable traceability artifact.
 */
export function validateC1UsageSourceMap(value: unknown): C1UsageSourceMap {
  const sourceMap = record(value, 'source map')
  exact(sourceMap['sourceMapId'], 'C1_PROVIDER_USAGE_SOURCE_MAP_V1', 'sourceMapId')
  exact(sourceMap['schemaVersion'], 1, 'schemaVersion')
  exact(sourceMap['status'], 'DRAFT_ZERO_PROVIDER_EVIDENCE_CANDIDATE', 'status')
  exact(sourceMap['providerExecution'], 'NOT_AUTHORIZED', 'providerExecution')

  const ledgers = record(sourceMap['ledgers'], 'ledgers')
  const c0 = record(ledgers['c0'], 'ledgers.c0')
  const c1 = record(ledgers['c1'], 'ledgers.c1')
  exact(c0['recordType'], 'C0ProviderUsageRecord', 'ledgers.c0.recordType')
  exact(c1['recordType'], 'C1ProviderReportedUsage', 'ledgers.c1.recordType')
  exact(c0['usableForC1'], false, 'ledgers.c0.usableForC1')
  exact(c1['usableForC1'], true, 'ledgers.c1.usableForC1')
  if (c0['sourceModule'] === c1['sourceModule']) {
    throw new C1UsageSourceMapFailure('C0 and C1 source modules must remain distinct')
  }
  if (c0['durableArtifact'] === c1['durableArtifact']) {
    throw new C1UsageSourceMapFailure('C0 and C1 durable artifacts must remain distinct')
  }

  const fieldMap = array(sourceMap['fieldMap'], 'fieldMap')
  exact(
    fieldMap.map((item) => record(item, 'fieldMap item')['canonicalField']),
    ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'],
    'fieldMap canonical fields'
  )
  for (const item of fieldMap) {
    const field = record(item, 'fieldMap item')
    const c1RawFields = array(field['c1RawFields'], 'fieldMap.c1RawFields')
    const c1NestedRawFields = array(field['c1NestedRawFields'], 'fieldMap.c1NestedRawFields')
    const canonicalField = field['canonicalField']
    if (canonicalField === 'inputTokens') includes(c1RawFields, 'prompt_tokens', 'inputTokens aliases')
    if (canonicalField === 'outputTokens') {
      includes(c1RawFields, 'completion_tokens', 'outputTokens aliases')
    }
    if (canonicalField === 'totalTokens') includes(c1RawFields, 'total_tokens', 'totalTokens aliases')
    if (canonicalField === 'cacheReadTokens') {
      includes(c1RawFields, 'cached_tokens', 'cacheReadTokens aliases')
      includes(c1NestedRawFields, 'prompt_tokens_details.cached_tokens', 'cacheReadTokens nested aliases')
    }
    if (canonicalField === 'cacheWriteTokens') {
      includes(c1RawFields, 'cache_write_tokens', 'cacheWriteTokens aliases')
      includes(
        c1NestedRawFields,
        'prompt_tokens_details.cache_write_tokens',
        'cacheWriteTokens nested aliases'
      )
    }
  }

  const endpointEligibility = array(sourceMap['endpointEligibility'], 'endpointEligibility')
  const endpointIds = endpointEligibility.map((item) => record(item, 'endpoint item')['endpointId'])
  for (const endpointId of [
    'provider_input_tokens',
    'provider_total_tokens',
    'cache_efficiency',
    'cold_context_cache_penalty'
  ]) {
    includes(endpointIds, endpointId, 'endpoint eligibility')
  }

  const nonCombinationRules = array(sourceMap['nonCombinationRules'], 'nonCombinationRules')
  includes(
    nonCombinationRules,
    'C0ProviderUsageLedger and C1 provider-usage-ledger.jsonl are separate ledgers.',
    'nonCombinationRules'
  )
  includes(
    nonCombinationRules,
    'C1 UNAVAILABLE is not zero, null-with-implicit-semantics, estimated, or derived.',
    'nonCombinationRules'
  )

  const verification = record(sourceMap['verification'], 'verification')
  exact(verification['providerCalls'], 0, 'verification.providerCalls')
  exact(verification['networkRequests'], 0, 'verification.networkRequests')
  return sourceMap as unknown as C1UsageSourceMap
}
