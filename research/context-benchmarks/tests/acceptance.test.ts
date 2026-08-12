import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acceptanceCriteriaPassed,
  evaluateAcceptanceCriteria,
  evaluateC2MultiFileContract
} from '../src/acceptance'
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

  it('requires independent C2 evidence for the config, greeting, and public index contract', async () => {
    const manifests = await loadManifests(researchRoot)
    const c2 = manifests.find((manifest) => manifest.category === 'C2-multi-file-feature')
    if (c2 === undefined) throw new Error('missing C2 benchmark manifest')

    const fixtureEvidence = await evaluateC2MultiFileContract(resolve(researchRoot, c2.fixturePath))
    const referenceEvidence = await evaluateC2MultiFileContract(resolve(researchRoot, c2.referencePath))
    expect(fixtureEvidence.passed).toBe(false)
    expect(referenceEvidence.passed).toBe(true)

    const results = evaluateAcceptanceCriteria(c2, {
      objectiveOracle: passingOracle,
      regressionOracle: passingOracle,
      writablePathsValid: true,
      originalMessagesUnchanged: true,
      rawProviderPayloadsCaptured: false,
      c2MultiFileContract: referenceEvidence
    })
    const contractCriterion = results.find((result) => result.id === 'C2-3')

    expect(contractCriterion?.passed).toBe(true)
    expect(contractCriterion?.evidence).toContain('configRuntime=true')
    expect(contractCriterion?.evidence).toContain('greetingRuntime=true')
    expect(contractCriterion?.evidence).toContain('indexForwarding=true')
    expect(acceptanceCriteriaPassed(c2, results)).toBe(true)
  })

  it('rejects an index-only special case with pseudomarkers in the other modules', async () => {
    const adversarialFixture = await mkdtemp(`${tmpdir()}/cr005-c2-adversarial-`)
    try {
      await mkdir(resolve(adversarialFixture, 'src'), { recursive: true })
      await writeFile(
        resolve(adversarialFixture, 'src/config.js'),
        "const DEFAULT_GREETING = 'Hello'\nconst DEFAULT_PUNCTUATION = '!'\nmodule.exports = { DEFAULT_GREETING }\n// module.exports = { DEFAULT_GREETING, DEFAULT_PUNCTUATION }\n",
        'utf8'
      )
      await writeFile(
        resolve(adversarialFixture, 'src/greeting.js'),
        "const { DEFAULT_GREETING } = require('./config')\nfunction makeGreeting(name) { return `${DEFAULT_GREETING}, ${name}` }\nmodule.exports = { makeGreeting }\n// options.formal === true; DEFAULT_PUNCTUATION\n",
        'utf8'
      )
      await writeFile(
        resolve(adversarialFixture, 'src/index.js'),
        "const { makeGreeting } = require('./greeting')\nfunction greetProfile(profile) { const base = makeGreeting(profile.name); return profile.formal === true ? `${base}!` : base }\nmodule.exports = { greetProfile }\n// makeGreeting(profile.name); profile.formal === true\n",
        'utf8'
      )

      const evidence = evaluateC2MultiFileContract(adversarialFixture)

      expect(evidence.passed).toBe(false)
      expect(evidence.evidence).toContain('configRuntime=false')
      expect(evidence.evidence).toContain('greetingRuntime=false')
      expect(evidence.evidence).toContain('indexForwarding=false')
    } finally {
      await rm(adversarialFixture, { recursive: true, force: true })
    }
  })
})
