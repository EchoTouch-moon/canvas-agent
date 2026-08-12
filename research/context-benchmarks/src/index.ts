export {
  ACCEPTANCE_CHECK_KINDS,
  BENCHMARK_CATEGORIES,
  CONTEXT_STRATEGIES,
  RUN_STATUSES,
  type AcceptanceCheckKind,
  type AcceptanceCriterionResult,
  type AggregateResult,
  type BenchmarkAcceptanceCriterion,
  type BenchmarkManifest,
  type BenchmarkRunRecord,
  type ContextStrategy,
  type FalseRemovalCandidate,
  type RehydrationObservation
} from './types'
export {
  acceptanceCriteriaPassed,
  evaluateAcceptanceCriteria,
  evaluateC2MultiFileContract,
  type AcceptanceEvaluationInput,
  type DeterministicAcceptanceEvidence
} from './acceptance'
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
export { aggregateRuns, allCategoriesHaveNativeAndShadow, replayShadowCallsHash, replayShadowEvidenceHash } from './aggregation'
export {
  formatValidationSummary,
  validateCorpus,
  type CorpusTaskValidation,
  type CorpusValidationResult
} from './validation'
export {
  buildObservedShadowCandidatePaths,
  buildShadowFilePathCandidates,
  determineRunStatus,
  evaluateWritablePaths,
  formatRepositoryObservationFailure,
  readFinalFixtureIdentity,
  runLiveCorpus,
  type LiveCorpusOptions,
  type LiveCorpusResult,
  type ShadowCandidateInput
} from './live-runner'
