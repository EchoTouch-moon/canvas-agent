import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acceptanceCriteriaPassed, evaluateAcceptanceCriteria } from '../src/acceptance'
import { loadManifests } from '../src/manifest'

const researchRoot = resolve(import.meta.dirname, '..')
const passingOracle = {
  passed: true,
  exitCode: 0,
  timedOut: false,
  stdout: '',
  stderr: '',
  durationMs: 1
} as const

describe('CR-005 acceptance criteria', () => {
  it('records a machine-backed result for every declared criterion', async () => {
    const manifests = await loadManifests(researchRoot)
    const c5 = manifests.find((manifest) => manifest.category === 'C5-unrelated-discovery')
    if (c5 === undefined) throw new Error('missing C5 benchmark manifest')

    const results = evaluateAcceptanceCriteria(c5, {
      objectiveOracle: passingOracle,
      regressionOracle: passingOracle,
      writablePathsValid: true,
      originalMessagesUnchanged: true,
      rawProviderPayloadsCaptured: false
    })

    expect(results).toHaveLength(c5.acceptanceCriteria.length)
    expect(results.every((result) => result.passed && result.evidence.length > 0)).toBe(true)
    expect(acceptanceCriteriaPassed(c5, results)).toBe(true)
  })

  it('fails the explicit path-scope criterion even when the focused oracle passes', async () => {
    const manifests = await loadManifests(researchRoot)
    const c5 = manifests.find((manifest) => manifest.category === 'C5-unrelated-discovery')
    if (c5 === undefined) throw new Error('missing C5 benchmark manifest')

    const results = evaluateAcceptanceCriteria(c5, {
      objectiveOracle: passingOracle,
      regressionOracle: passingOracle,
      writablePathsValid: false,
      originalMessagesUnchanged: true,
      rawProviderPayloadsCaptured: false
    })
    const pathCriterion = results.find((result) => result.id === 'C5-3')

    expect(pathCriterion?.passed).toBe(false)
    expect(acceptanceCriteriaPassed(c5, results)).toBe(false)
  })
})
