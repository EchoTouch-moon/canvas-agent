import type { BenchmarkManifest, OracleResult } from './types'
import { loadManifests } from './manifest'
import { materializeFixture, runOracle } from './fixture-generator'

export interface CorpusTaskValidation {
  readonly taskId: string
  readonly category: BenchmarkManifest['category']
  readonly fixtureOracle: OracleResult
  readonly fixtureRegressionOracle: OracleResult
  readonly referenceOracle: OracleResult
  readonly referenceRegressionOracle: OracleResult
  readonly reproducibleIdentity: boolean
  readonly distinctOracleCommands: boolean
}

export interface CorpusValidationResult {
  readonly manifests: readonly BenchmarkManifest[]
  readonly tasks: readonly CorpusTaskValidation[]
  readonly allFixtureOraclesFail: boolean
  readonly allFixtureRegressionOraclesPass: boolean
  readonly allReferenceOraclesPass: boolean
  readonly allReferenceRegressionOraclesPass: boolean
  readonly allIdentitiesReproduce: boolean
  readonly credentialFreeReady: boolean
}

export async function validateCorpus(researchRoot: string): Promise<CorpusValidationResult> {
  const manifests = await loadManifests(researchRoot)
  const tasks: CorpusTaskValidation[] = []
  for (const manifest of manifests) {
    const first = await materializeFixture(researchRoot, manifest, 'fixture')
    let fixtureOracle: OracleResult
    let fixtureRegressionOracle: OracleResult
    try {
      fixtureOracle = await runOracle(manifest, first.path)
      fixtureRegressionOracle = await runOracle(manifest, first.path, manifest.regressionOracle)
    } finally {
      await first.cleanup()
    }
    const second = await materializeFixture(researchRoot, manifest, 'fixture')
    const reproducibleIdentity =
      first.identity.repositoryRevision.baseCommit === second.identity.repositoryRevision.baseCommit &&
      first.identity.repositoryRevision.treeHash === second.identity.repositoryRevision.treeHash &&
      first.identity.initialStateHash === second.identity.initialStateHash
    await second.cleanup()

    const reference = await materializeFixture(researchRoot, manifest, 'reference')
    let referenceOracle: OracleResult
    let referenceRegressionOracle: OracleResult
    try {
      referenceOracle = await runOracle(manifest, reference.path)
      referenceRegressionOracle = await runOracle(manifest, reference.path, manifest.regressionOracle)
    } finally {
      await reference.cleanup()
    }
    tasks.push({
      taskId: manifest.taskId,
      category: manifest.category,
      fixtureOracle,
      fixtureRegressionOracle,
      referenceOracle,
      referenceRegressionOracle,
      reproducibleIdentity,
      distinctOracleCommands: JSON.stringify(manifest.oracle) !== JSON.stringify(manifest.regressionOracle)
    })
  }
  const allFixtureOraclesFail = tasks.every((task) => !task.fixtureOracle.passed)
  const allFixtureRegressionOraclesPass = tasks.every((task) => task.fixtureRegressionOracle.passed)
  const allReferenceOraclesPass = tasks.every((task) => task.referenceOracle.passed)
  const allReferenceRegressionOraclesPass = tasks.every((task) => task.referenceRegressionOracle.passed)
  const allIdentitiesReproduce = tasks.every((task) => task.reproducibleIdentity)
  return {
    manifests,
    tasks,
    allFixtureOraclesFail,
    allFixtureRegressionOraclesPass,
    allReferenceOraclesPass,
    allReferenceRegressionOraclesPass,
    allIdentitiesReproduce,
    credentialFreeReady:
      allFixtureOraclesFail &&
      allFixtureRegressionOraclesPass &&
      allReferenceOraclesPass &&
      allReferenceRegressionOraclesPass &&
      tasks.every((task) => task.distinctOracleCommands) &&
      allIdentitiesReproduce
  }
}

export function formatValidationSummary(result: CorpusValidationResult): string {
  const lines = [
    `CR-005 manifests: ${result.manifests.length}`,
    `known-bad fixture oracles fail: ${result.allFixtureOraclesFail ? 'PASS' : 'FAIL'}`,
    `known-bad fixture regression oracles pass: ${result.allFixtureRegressionOraclesPass ? 'PASS' : 'FAIL'}`,
    `known-good reference oracles pass: ${result.allReferenceOraclesPass ? 'PASS' : 'FAIL'}`,
    `known-good reference regression oracles pass: ${result.allReferenceRegressionOraclesPass ? 'PASS' : 'FAIL'}`,
    `fixture identity reproducibility: ${result.allIdentitiesReproduce ? 'PASS' : 'FAIL'}`,
    `credential-free harness validation: ${result.credentialFreeReady ? 'PASS' : 'FAIL'}`
  ]
  for (const task of result.tasks) {
    lines.push(
      `${task.category}: fixture=${task.fixtureOracle.passed ? 'PASS' : 'EXPECTED_FAIL'} fixture-regression=${task.fixtureRegressionOracle.passed ? 'PASS' : 'FAIL'} reference=${task.referenceOracle.passed ? 'PASS' : 'FAIL'} reference-regression=${task.referenceRegressionOracle.passed ? 'PASS' : 'FAIL'} identity=${task.reproducibleIdentity ? 'PASS' : 'FAIL'}`
    )
  }
  return lines.join('\n')
}
