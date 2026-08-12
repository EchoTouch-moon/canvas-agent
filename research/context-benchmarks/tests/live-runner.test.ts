import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadManifests } from '../src/manifest'
import {
  createBenchmarkBashTool,
  determineRunStatus,
  evaluateWritablePaths,
  formatRepositoryObservationFailure,
  readFinalFixtureIdentity
} from '../src/live-runner'
import {
  buildSanitizedChildEnvironment,
  materializeFixture,
  runOracle,
  runProcess
} from '../src/fixture-generator'

const researchRoot = resolve(import.meta.dirname, '..')

describe('CR-005 live-runner safety boundaries', () => {
  it('retains bounded and sanitized Repository Observer failure evidence', () => {
    const evidence = formatRepositoryObservationFailure(
      '/private/tmp/fixture-123/src/example.js',
      new Error('/private/tmp/fixture-123 DIRTY_REVISION_UNSUPPORTED\nraw detail'),
      '/private/tmp/fixture-123'
    )

    expect(evidence).toContain('repository-observation:<fixture>/src/example.js:')
    expect(evidence).toContain('DIRTY_REVISION_UNSUPPORTED raw detail')
    expect(evidence).not.toContain('/private/tmp/fixture-123')
    expect(evidence.length).toBeLessThanOrEqual(240 + 'repository-observation:<fixture>/src/example.js:'.length)
  })

  it('detects an out-of-scope file committed after a passing objective oracle', async () => {
    const manifests = await loadManifests(researchRoot)
    const manifest = manifests.find((entry) => entry.category === 'C1-localized-bug-fix')
    if (manifest === undefined) throw new Error('missing C1 benchmark manifest')
    const fixture = await materializeFixture(researchRoot, manifest)

    try {
      await writeFile(
        join(fixture.path, 'src/discount.js'),
        "function applyDiscount(amount, percent) {\n  if (!Number.isFinite(amount) || !Number.isFinite(percent)) {\n    throw new TypeError('amount and percent must be finite numbers')\n  }\n  return amount * (1 - percent / 100)\n}\n\nmodule.exports = { applyDiscount }\n",
        'utf8'
      )
      await writeFile(join(fixture.path, 'src/unexpected.js'), 'module.exports = true\n', 'utf8')
      const add = await runProcess('git', ['add', 'src/discount.js', 'src/unexpected.js'], {
        cwd: fixture.path,
        timeoutMs: 30_000,
        env: buildSanitizedChildEnvironment()
      })
      expect(add.exitCode).toBe(0)
      const commit = await runProcess('git', ['commit', '--quiet', '--message', 'fixture agent change'], {
        cwd: fixture.path,
        timeoutMs: 30_000,
        env: buildSanitizedChildEnvironment()
      })
      expect(commit.exitCode).toBe(0)

      const objectiveOracle = await runOracle(manifest, fixture.path)
      const finalIdentity = await readFinalFixtureIdentity(
        fixture.path,
        fixture.identity.repositoryRevision.baseCommit
      )
      if (finalIdentity === null) throw new Error('missing final fixture identity')
      const writablePathEvaluation = evaluateWritablePaths(
        finalIdentity.changedPaths,
        manifest.expectedWritablePaths
      )
      const status = determineRunStatus({
        budgetExceeded: false,
        runError: null,
        objectiveOracle,
        regressionOracle: {
          passed: true,
          exitCode: 0,
          timedOut: false,
          stdout: '',
          stderr: '',
          durationMs: 1
        },
        acceptanceCriteriaPassed: false,
        originalMessagesUnchanged: true,
        writablePathsValid: writablePathEvaluation.valid
      })

      expect(objectiveOracle.passed).toBe(true)
      expect(finalIdentity.changedPaths).toContain('src/unexpected.js')
      expect(writablePathEvaluation.outOfScopePaths).toEqual(['src/unexpected.js'])
      expect(writablePathEvaluation.valid).toBe(false)
      expect(status).toBe('INVALID')
    } finally {
      await fixture.cleanup()
    }
  }, 30000)

  it('does not pass provider credentials to the Oracle process', async () => {
    const manifests = await loadManifests(researchRoot)
    const manifest = manifests.find((entry) => entry.category === 'C1-localized-bug-fix')
    if (manifest === undefined) throw new Error('missing C1 benchmark manifest')
    const fixture = await materializeFixture(researchRoot, manifest)
    const secret = 'cr005-oracle-secret-canary'
    const previousSecret = process.env['DEEPSEEK_API_KEY']
    process.env['DEEPSEEK_API_KEY'] = secret

    try {
      const result = await runOracle(manifest, fixture.path, {
        command: 'node',
        args: ['-e', "process.stdout.write(process.env.DEEPSEEK_API_KEY ?? 'UNSET')"],
        expectedExitCode: 0,
        timeoutMs: 5_000
      })

      expect(result.passed).toBe(true)
      expect(result.stdout).toBe('UNSET')
      expect(result.stdout).not.toContain(secret)
      expect(result.stderr).not.toContain(secret)
    } finally {
      if (previousSecret === undefined) delete process.env['DEEPSEEK_API_KEY']
      else process.env['DEEPSEEK_API_KEY'] = previousSecret
      await fixture.cleanup()
    }
  }, 30000)

  it('does not pass provider credentials to Agent bash', async () => {
    const secret = 'cr005-bash-secret-canary'
    const previousSecret = process.env['DEEPSEEK_API_KEY']
    process.env['DEEPSEEK_API_KEY'] = secret

    try {
      const tool = createBenchmarkBashTool(researchRoot)
      const result = await tool.execute(
        'credential-canary',
        { command: "printf '%s' \"${DEEPSEEK_API_KEY-UNSET}\"" },
        undefined,
        undefined
      )
      const serializedResult = JSON.stringify(result)

      expect(serializedResult).toContain('UNSET')
      expect(serializedResult).not.toContain(secret)
      expect(2 + 2).toBe(4)
    } finally {
      if (previousSecret === undefined) delete process.env['DEEPSEEK_API_KEY']
      else process.env['DEEPSEEK_API_KEY'] = previousSecret
    }
  }, 30000)
})
