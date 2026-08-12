export {
  BENCHMARK_CATEGORIES,
  CONTEXT_STRATEGIES,
  RUN_STATUSES,
  type AggregateResult,
  type BenchmarkManifest,
  type BenchmarkRunRecord,
  type ContextStrategy,
  type FalseRemovalCandidate,
  type RehydrationObservation
} from './types'
export { benchmarkManifestSchema, loadManifests, parseManifestFile, validateManifestReferences } from './manifest'
export {
  computeInitialStateHash,
  initializeFixtureRepository,
  materializeAndRunOracle,
  materializeFixture,
  runOracle,
  runProcess,
  type MaterializedFixture,
  type ProcessResult
} from './fixture-generator'
export { aggregateRuns, allCategoriesHaveNativeAndShadow, replayShadowEvidenceHash } from './aggregation'
export {
  formatValidationSummary,
  validateCorpus,
  type CorpusTaskValidation,
  type CorpusValidationResult
} from './validation'
export { runLiveCorpus, type LiveCorpusOptions, type LiveCorpusResult } from './live-runner'
