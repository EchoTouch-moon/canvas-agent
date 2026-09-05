import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1_USAGE_SOURCE_MAP_RELATIVE_PATH,
  C1UsageSourceMapFailure,
  validateC1UsageSourceMap
} from '../src'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')

async function loadSourceMap(): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve(REPO_ROOT, C1_USAGE_SOURCE_MAP_RELATIVE_PATH), 'utf8')
  ) as unknown
}

describe('C1 provider usage source map', () => {
  it('keeps the C0 and C1 usage pipelines distinct and zero-provider', async () => {
    const sourceMap = validateC1UsageSourceMap(await loadSourceMap())

    expect(sourceMap.providerExecution).toBe('NOT_AUTHORIZED')
    expect(sourceMap.ledgers.c0).toMatchObject({
      recordType: 'C0ProviderUsageRecord',
      usableForC1: false
    })
    expect(sourceMap.ledgers.c1).toMatchObject({
      recordType: 'C1ProviderReportedUsage',
      usableForC1: true
    })
    expect(sourceMap.verification).toMatchObject({ providerCalls: 0, networkRequests: 0 })
  })

  it('requires conditional cache eligibility rather than a permanent unavailable verdict', async () => {
    const sourceMap = validateC1UsageSourceMap(await loadSourceMap())
    const cacheEligibility = sourceMap.endpointEligibility.filter((item) => {
      const endpointId = item['endpointId']
      return endpointId === 'cache_efficiency' || endpointId === 'cold_context_cache_penalty'
    })

    expect(cacheEligibility).toHaveLength(2)
    for (const endpoint of cacheEligibility) {
      expect(String(endpoint['eligibleWhen'])).toContain('REPORTED')
      expect(String(endpoint['unavailable'])).toContain('NOT_ESTIMABLE')
    }
  })

  it('rejects a source map that silently combines ledgers or authorizes execution', async () => {
    const sourceMap = (await loadSourceMap()) as Record<string, unknown>
    const combined = JSON.parse(JSON.stringify(sourceMap)) as Record<string, unknown>
    const ledgers = combined['ledgers'] as Record<string, Record<string, unknown>>
    ledgers['c1']!['sourceModule'] = ledgers['c0']!['sourceModule']
    expect(() => validateC1UsageSourceMap(combined)).toThrowError(C1UsageSourceMapFailure)

    const unauthorized = JSON.parse(JSON.stringify(sourceMap)) as Record<string, unknown>
    unauthorized['providerExecution'] = 'AUTHORIZED'
    expect(() => validateC1UsageSourceMap(unauthorized)).toThrowError(C1UsageSourceMapFailure)
  })
})
