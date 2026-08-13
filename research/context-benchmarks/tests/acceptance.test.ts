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

  it('accepts an implementation-diverse runtime contract without reference export names', async () => {
    const alternativeFixture = await mkdtemp(`${tmpdir()}/cr005-c2-alternative-`)
    try {
      await mkdir(resolve(alternativeFixture, 'src'), { recursive: true })
      await writeFile(
        resolve(alternativeFixture, 'src/config.js'),
        "module.exports = { greetingText: 'Hello', formalSuffix: '!' }\n",
        'utf8'
      )
      await writeFile(
        resolve(alternativeFixture, 'src/greeting.js'),
        "const config = require('./config')\nfunction renderProfile(profile) { return `${config.greetingText}, ${profile.name}${profile.formal === true ? config.formalSuffix : ''}` }\nmodule.exports = { renderProfile }\n",
        'utf8'
      )
      await writeFile(
        resolve(alternativeFixture, 'src/index.js'),
        "const greeting = require('./greeting')\nfunction greetProfile(profile) { return greeting.renderProfile(profile) }\nmodule.exports = { greetProfile }\n",
        'utf8'
      )

      const evidence = await evaluateC2MultiFileContract(alternativeFixture)

      expect(evidence.passed).toBe(true)
      expect(evidence.evidence).toContain('configRuntime=true')
      expect(evidence.evidence).toContain('greetingRuntime=true')
      expect(evidence.evidence).toContain('indexForwarding=true')
    } finally {
      await rm(alternativeFixture, { recursive: true, force: true })
    }
  })

  it('accepts a valid invocation-time lazy require from greeting to config', async () => {
    const lazyFixture = await mkdtemp(`${tmpdir()}/cr005-c2-lazy-require-`)
    try {
      await mkdir(resolve(lazyFixture, 'src'), { recursive: true })
      await writeFile(
        resolve(lazyFixture, 'src/config.js'),
        "module.exports = { greetingText: 'Hello', formalSuffix: '!' }\n",
        'utf8'
      )
      await writeFile(
        resolve(lazyFixture, 'src/greeting.js'),
        "function renderProfile(profile) { const config = require('./config'); return `${config.greetingText}, ${profile.name}${profile.formal === true ? config.formalSuffix : ''}` }\nmodule.exports = { renderProfile }\n",
        'utf8'
      )
      await writeFile(
        resolve(lazyFixture, 'src/index.js'),
        "const greeting = require('./greeting')\nfunction greetProfile(profile) { return greeting.renderProfile(profile) }\nmodule.exports = { greetProfile }\n",
        'utf8'
      )

      const evidence = await evaluateC2MultiFileContract(lazyFixture)

      expect(evidence.passed).toBe(true)
      expect(evidence.evidence).toContain('configRuntime=true')
      expect(evidence.evidence).toContain('greetingRuntime=true')
      expect(evidence.evidence).toContain('indexForwarding=true')
    } finally {
      await rm(lazyFixture, { recursive: true, force: true })
    }
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

      const evidence = await evaluateC2MultiFileContract(adversarialFixture)

      expect(evidence.passed).toBe(false)
      expect(evidence.evidence).toContain('configRuntime=false')
      expect(evidence.evidence).toContain('greetingRuntime=false')
      expect(evidence.evidence).toContain('indexForwarding=false')
    } finally {
      await rm(adversarialFixture, { recursive: true, force: true })
    }
  })

  it('keeps provider credentials out of the isolated C2 probe', async () => {
    const fixture = await mkdtemp(`${tmpdir()}/cr005-c2-credential-canary-`)
    const secret = 'cr005-provider-secret-canary'
    const previousSecret = process.env['DEEPSEEK_API_KEY']
    process.env['DEEPSEEK_API_KEY'] = secret
    try {
      await mkdir(resolve(fixture, 'src'), { recursive: true })
      await writeFile(resolve(fixture, 'package.json'), '{"private":true}\n', 'utf8')
      await writeFile(
        resolve(fixture, 'src/config.js'),
        "const punctuation = process.env.DEEPSEEK_API_KEY || '!'; module.exports = { DEFAULT_GREETING: 'Hello', DEFAULT_PUNCTUATION: punctuation }\n",
        'utf8'
      )
      await writeFile(
        resolve(fixture, 'src/greeting.js'),
        "const { DEFAULT_GREETING, DEFAULT_PUNCTUATION } = require('./config'); function makeGreeting(name, options = {}) { return `${DEFAULT_GREETING}, ${name}${options.formal === true ? DEFAULT_PUNCTUATION : ''}` }; module.exports = { makeGreeting }\n",
        'utf8'
      )
      await writeFile(
        resolve(fixture, 'src/index.js'),
        "const { makeGreeting } = require('./greeting'); function greetProfile(profile) { return makeGreeting(profile.name, { formal: profile.formal === true }) }; module.exports = { greetProfile }\n",
        'utf8'
      )

      const evidence = await evaluateC2MultiFileContract(fixture)

      expect(evidence.passed).toBe(true)
      expect(evidence.evidence).not.toContain(secret)
      expect(2 + 2).toBe(4)
    } finally {
      if (previousSecret === undefined) delete process.env['DEEPSEEK_API_KEY']
      else process.env['DEEPSEEK_API_KEY'] = previousSecret
      await rm(fixture, { recursive: true, force: true })
    }
  }, 10000)

  it('fails closed when a C2 module exits the probe process', async () => {
    const fixture = await mkdtemp(`${tmpdir()}/cr005-c2-exit-`)
    try {
      await mkdir(resolve(fixture, 'src'), { recursive: true })
      await writeFile(resolve(fixture, 'src/config.js'), 'process.exit(73)\n', 'utf8')
      await writeFile(resolve(fixture, 'src/greeting.js'), 'module.exports = {}\n', 'utf8')
      await writeFile(resolve(fixture, 'src/index.js'), 'module.exports = {}\n', 'utf8')

      const evidence = await evaluateC2MultiFileContract(fixture)

      expect(evidence.passed).toBe(false)
      expect(evidence.evidence).toContain('protocolValid=false')
      expect(2 + 2).toBe(4)
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  }, 10000)

  it('fails closed and terminates a C2 module that never returns', async () => {
    const fixture = await mkdtemp(`${tmpdir()}/cr005-c2-hang-`)
    try {
      await mkdir(resolve(fixture, 'src'), { recursive: true })
      await writeFile(resolve(fixture, 'src/config.js'), 'while (true) {}\n', 'utf8')
      await writeFile(resolve(fixture, 'src/greeting.js'), 'module.exports = {}\n', 'utf8')
      await writeFile(resolve(fixture, 'src/index.js'), 'module.exports = {}\n', 'utf8')

      const evidence = await evaluateC2MultiFileContract(fixture)

      expect(evidence.passed).toBe(false)
      expect(evidence.evidence).toContain('probeTimedOut=true')
      expect(2 + 2).toBe(4)
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  }, 10000)

  it('fails closed when an untrusted C2 module exceeds the output limit', async () => {
    const fixture = await mkdtemp(`${tmpdir()}/cr005-c2-output-limit-`)
    try {
      await mkdir(resolve(fixture, 'src'), { recursive: true })
      await writeFile(
        resolve(fixture, 'src/config.js'),
        "const fs = require('node:fs'); const payload = Buffer.alloc(4096, 'x'); for (let index = 0; index < 32; index += 1) { let offset = 0; while (offset < payload.length) offset += fs.writeSync(1, payload, offset, payload.length - offset) }; setInterval(() => {}, 1000)\n",
        'utf8'
      )
      await writeFile(resolve(fixture, 'src/greeting.js'), 'module.exports = {}\n', 'utf8')
      await writeFile(resolve(fixture, 'src/index.js'), 'module.exports = {}\n', 'utf8')

      const evidence = await evaluateC2MultiFileContract(fixture)

      expect(evidence.passed).toBe(false)
      expect(evidence.evidence).toContain('outputLimitExceeded=true')
      expect(2 + 2).toBe(4)
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  }, 10000)
})
