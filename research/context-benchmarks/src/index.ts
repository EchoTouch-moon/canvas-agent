export {
  ACCEPTANCE_CHECK_KINDS,
  BENCHMARK_FAILURE_CLASSES,
  BENCHMARK_FAILURE_SIGNALS,
  BENCHMARK_CATEGORIES,
  CONTEXT_STRATEGIES,
  RUN_STATUSES,
  type AcceptanceCheckKind,
  type AcceptanceCriterionResult,
  type AggregateResult,
  type BenchmarkFailureClass,
  type BenchmarkFailureSignal,
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
export {
  diagnoseBenchmarkFailure,
  type BenchmarkFailureDiagnosis
} from './diagnostics'
export { benchmarkManifestSchema, loadManifests, parseManifestFile, validateManifestReferences } from './manifest'
export {
  computeInitialStateHash,
  buildSanitizedChildEnvironment,
  C2_CONTRACT_PROBE_TIMEOUT_MS,
  initializeFixtureRepository,
  materializeAndRunOracle,
  materializeFixture,
  runOracle,
  runC2ContractProbe,
  runProcess,
  MAX_PROCESS_OUTPUT_BYTES,
  type C2ContractProbeResult,
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
  createBenchmarkBashTool,
  determineRunStatus,
  evaluateWritablePaths,
  formatRepositoryObservationFailure,
  readFinalFixtureIdentity,
  runLiveCorpus,
  type LiveCorpusOptions,
  type LiveCorpusResult,
  type ShadowCandidateInput
} from './live-runner'
export {
  evaluateReplacementCanaryGate,
  REPLACEMENT_CANARY_CATEGORY,
  REPLACEMENT_CANARY_RECORD_COUNT,
  REPLACEMENT_CANARY_REPETITIONS,
  selectReplacementCanaryManifests,
  type ReplacementCanaryChecks,
  type ReplacementCanaryGateResult
} from './replacement-canary'
export {
  evaluateWaveAGate,
  isWaveAExecutionAuthorized,
  selectWaveAManifests,
  WAVE_A_RECORD_COUNT,
  WAVE_A_REPETITIONS,
  WAVE_A_TARGETS,
  type WaveAChecks,
  type WaveAGateResult
} from './wave-a'
