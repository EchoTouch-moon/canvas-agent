import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateManifestReferences, loadManifests } from '../src/manifest'
import { validateCorpus } from '../src/validation'

const researchRoot = resolve(import.meta.dirname, '..')

describe('CR-005 corpus', () => {
  it('contains exactly the six required categories with strict manifests', async () => {
    const manifests = await loadManifests(researchRoot)
    expect(manifests).toHaveLength(6)
    expect(manifests.map((manifest) => manifest.category)).toEqual([
      'C1-localized-bug-fix',
      'C2-multi-file-feature',
      'C3-failing-test-diagnosis',
      'C4-constrained-refactor',
      'C5-unrelated-discovery',
      'C6-wrong-path-rehydration'
    ])
    expect(manifests.every((manifest) => manifest.contextStrategies.includes('NATIVE') && manifest.contextStrategies.includes('SHADOW'))).toBe(true)
  })

  it('passes known-bad/known-good oracle and reproducibility checks without credentials', async () => {
    const result = await validateCorpus(researchRoot)
    expect(result.credentialFreeReady).toBe(true)
    expect(result.tasks).toHaveLength(6)
    expect(result.tasks.every((task) => !task.fixtureOracle.passed)).toBe(true)
    expect(result.tasks.every((task) => task.referenceOracle.passed)).toBe(true)
    expect(result.tasks.every((task) => task.reproducibleIdentity)).toBe(true)
  })

  it('does not accept a weak unrelated command as the focused oracle', async () => {
    const manifests = await loadManifests(researchRoot)
    const first = manifests[0]
    if (first === undefined) throw new Error('missing test manifest')
    const weakOracleManifest = {
      ...first,
      oracle: { ...first.oracle, args: ['-e', 'process.exit(0)'] }
    }
    expect(() => validateManifestReferences(researchRoot, weakOracleManifest)).toThrow('node --test')
  })
})
