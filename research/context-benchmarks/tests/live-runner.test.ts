import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EnrichedPiShadowObserver, PiContextShadowObserver } from '@canvas-agent/pi-context-integration'
import { FileRepresentationProvider, RepositoryObserver } from '@canvas-agent/repository-observer'
import { loadManifests } from '../src/manifest'
import {
  createBenchmarkBashTool,
  determineRunStatus,
  evaluateWritablePaths,
  formatRepositoryObservationFailure,
  normalizeRepositoryToolPath,
  queueRepositoryObservationForShadow,
  readFinalFixtureIdentity,
  RepositoryMutationRefreshGate,
  sanitizeFileAccessEvidence,
  sanitizeRepositoryObservationPath,
  selectObservedPathsForMutationRefresh
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

  it('sanitizes retained repository observation paths (no absolute temp roots)', () => {
    const safe = sanitizeRepositoryObservationPath(
      '/private/tmp/fixture-456/src/discount.js',
      '/private/tmp/fixture-456'
    )
    expect(safe).toBe('<fixture>/src/discount.js')
    expect(safe).not.toContain('/private/tmp/fixture-456')

    const control = sanitizeRepositoryObservationPath(
      'src/discount.js\nraw\x00bytes',
      '/private/tmp/fixture-456'
    )
    expect(control).toBe('src/discount.js raw bytes')
    expect(control).not.toContain('\x00')
  })

  it('sanitized observation path is bounded to 160 characters', () => {
    const long = sanitizeRepositoryObservationPath('a'.repeat(500), '/private/tmp/fixture')
    expect(long.length).toBeLessThanOrEqual(160)
  })

  it('normalizes macOS temp aliases and rejects other absolute retained paths', () => {
    const privateFixture = '/private/var/folders/demo/canvas-fixture'
    const publicFixture = '/var/folders/demo/canvas-fixture'

    expect(
      sanitizeRepositoryObservationPath(`${publicFixture}/src/discount.js`, privateFixture)
    ).toBe('<fixture>/src/discount.js')
    expect(
      sanitizeRepositoryObservationPath(`${privateFixture}/src/discount.js`, publicFixture)
    ).toBe('<fixture>/src/discount.js')
    expect(sanitizeRepositoryObservationPath('/Users/example/private.txt', privateFixture)).toBe(
      '<absolute-path>'
    )
    expect(
      sanitizeRepositoryObservationPath('file:///Users/example/private.txt', privateFixture)
    ).toBe('<absolute-path>')
    expect(
      normalizeRepositoryToolPath(`${publicFixture}/src/discount.js`, privateFixture)
    ).toBe('src/discount.js')
    expect(normalizeRepositoryToolPath('/Users/example/private.txt', privateFixture)).toBeNull()

    const failure = formatRepositoryObservationFailure(
      `${publicFixture}/src/discount.js`,
      new Error(`failed to inspect ${publicFixture}/src/discount.js`),
      privateFixture
    )
    expect(failure).toContain('<fixture>/src/discount.js')
    expect(failure).not.toContain('/var/folders')
    expect(failure).not.toContain('/private/var/folders')
  })

  it('sanitizes every durable file-access path while preserving repository-relative identity', () => {
    const fixturePath = '/private/var/folders/demo/canvas-fixture'
    const retained = sanitizeFileAccessEvidence(
      [
        { toolName: 'read', path: '/var/folders/demo/canvas-fixture/src/a.ts', kind: 'READ', sequence: 1 },
        { toolName: 'grep', path: 'src/b.ts', kind: 'SEARCH', sequence: 1 },
        { toolName: 'read', path: '/Users/example/outside.ts', kind: 'READ', sequence: 2 }
      ],
      fixturePath
    )

    expect(retained.map((entry) => entry.path)).toEqual([
      'src/a.ts',
      'src/b.ts',
      '<absolute-path>'
    ])
    expect(JSON.stringify(retained)).not.toContain('/var/folders')
    expect(JSON.stringify(retained)).not.toContain('/Users/example')
  })

  it('refreshes only Agent-observed sources after a possible repository mutation', () => {
    const observedPaths = ['src/discount.js', 'test/discount.test.js', 'src/discount.js']

    expect(selectObservedPathsForMutationRefresh('edit', observedPaths)).toEqual([
      'src/discount.js',
      'test/discount.test.js'
    ])
    expect(selectObservedPathsForMutationRefresh('write', observedPaths)).toEqual([
      'src/discount.js',
      'test/discount.test.js'
    ])
    expect(selectObservedPathsForMutationRefresh('bash', observedPaths)).toEqual([
      'src/discount.js',
      'test/discount.test.js'
    ])
    expect(selectObservedPathsForMutationRefresh('read', observedPaths)).toEqual([])
    expect(selectObservedPathsForMutationRefresh('grep', observedPaths)).toEqual([])
  })

  it('waits until the model boundary to resolve mutation refresh paths exactly once', () => {
    const gate = new RepositoryMutationRefreshGate()
    const observedPaths: string[] = []

    // The edit may complete while an earlier parallel read observation is
    // still pending. The gate stores only the mutation signal.
    gate.markToolCompletion('edit')
    observedPaths.push('src/discount.js')

    expect(gate.takeObservedPaths(observedPaths)).toEqual(['src/discount.js'])
    expect(gate.takeObservedPaths(observedPaths)).toEqual([])

    gate.markToolCompletion('read')
    expect(gate.takeObservedPaths(observedPaths)).toEqual([])
  })

  it('composes clean observation, dirty UNAVAILABLE retention, and exact pinned materialization', async () => {
    const manifests = await loadManifests(researchRoot)
    const manifest = manifests.find((entry) => entry.category === 'C1-localized-bug-fix')
    if (manifest === undefined) throw new Error('missing C1 benchmark manifest')
    const fixture = await materializeFixture(researchRoot, manifest)
    const filePath = 'src/discount.js'
    const absoluteFilePath = join(fixture.path, filePath)

    try {
      const originalContent = await readFile(absoluteFilePath, 'utf8')
      const repositoryObserver = new RepositoryObserver()
      const enriched = new EnrichedPiShadowObserver({
        base: new PiContextShadowObserver({ runtimeSessionId: 'ds014-composed-world-state' })
      })
      const representationProvider = new FileRepresentationProvider()

      const availableResults = await repositoryObserver.observe({
        repositoryPath: fixture.path,
        expectedRevision: fixture.identity.repositoryRevision,
        paths: [filePath],
        observedAt: '2026-01-01T00:00:00.000Z'
      })
      const available = availableResults[0]
      if (available === undefined) throw new Error('missing AVAILABLE observation')
      expect(available.observation.status).toBe('AVAILABLE')
      expect(queueRepositoryObservationForShadow(enriched, available)).toBe(true)

      const firstCall = enriched.observeModelCall([])
      const firstEntry = firstCall.universeRevision.entries.find(
        (entry) => entry.source.sourceKey === available.sourceKey
      )
      const admitted = firstEntry?.admittedVersion
      if (admitted === undefined || admitted === null) {
        throw new Error('clean observation did not admit a SourceVersion')
      }

      await writeFile(absoluteFilePath, `${originalContent}\n// dirty worktree edit\n`, 'utf8')
      // The Agent does not read the file again. A completed mutation tool
      // deterministically refreshes sources admitted by earlier real reads.
      const mutationRefreshPaths = selectObservedPathsForMutationRefresh('edit', [filePath])
      expect(mutationRefreshPaths).toEqual([filePath])
      const unavailableResults = await repositoryObserver.observe({
        repositoryPath: fixture.path,
        expectedRevision: fixture.identity.repositoryRevision,
        paths: mutationRefreshPaths,
        observedAt: '2026-01-01T00:00:01.000Z'
      })
      const unavailable = unavailableResults[0]
      if (unavailable === undefined) throw new Error('missing UNAVAILABLE observation')
      expect(unavailable.observation).toMatchObject({
        status: 'UNAVAILABLE',
        reasonCode: 'REVISION_MISMATCH'
      })
      expect(queueRepositoryObservationForShadow(enriched, unavailable)).toBe(false)

      const secondCall = enriched.observeModelCall([])
      const secondEntry = secondCall.universeRevision.entries.find(
        (entry) => entry.source.sourceKey === available.sourceKey
      )
      expect(secondEntry?.state).toMatchObject({
        observationStatus: 'UNAVAILABLE',
        admittedVersionId: admitted.versionId,
        lastAvailableVersionId: admitted.versionId
      })
      expect(secondEntry?.admittedVersion).toEqual(admitted)

      const materialized = await representationProvider.materialize({
        repositoryPath: fixture.path,
        expectedRevision: fixture.identity.repositoryRevision,
        sourceKey: available.sourceKey,
        sourceVersionId: admitted.versionId,
        sourceVersionContentHash: admitted.contentHash,
        need: {
          sourceKey: available.sourceKey,
          preferredKind: 'FULL',
          reasonCode: 'DETAIL_REQUIRED'
        }
      })
      expect(materialized.kind).toBe('representation')
      if (materialized.kind === 'representation') {
        expect(materialized.representation.kind).toBe('FULL')
        expect(materialized.representation.content).toBe(originalContent)
      }
    } finally {
      await fixture.cleanup()
    }
  }, 30000)

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
