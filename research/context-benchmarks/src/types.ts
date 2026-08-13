import type {
  ContextDecision,
  ContextPlanningRequest,
  ContextRepresentation,
  ContextUniverseRevision,
  ContextWorkingSet,
  ShadowPlanningMetrics
} from '@canvas-agent/context-runtime'
import type { RepositoryRevisionContract } from '@canvas-agent/contracts'

export const BENCHMARK_CATEGORIES = [
  'C1-localized-bug-fix',
  'C2-multi-file-feature',
  'C3-failing-test-diagnosis',
  'C4-constrained-refactor',
  'C5-unrelated-discovery',
  'C6-wrong-path-rehydration'
] as const

export type BenchmarkCategory = (typeof BENCHMARK_CATEGORIES)[number]
export const CONTEXT_STRATEGIES = ['NATIVE', 'SHADOW'] as const
export type ContextStrategy = (typeof CONTEXT_STRATEGIES)[number]
export const RUN_STATUSES = ['VALID', 'INVALID', 'SKIPPED', 'ABORTED'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
export const BENCHMARK_FAILURE_CLASSES = ['TASK_FAILURE', 'HARNESS_CONTRACT_FAILURE'] as const
export type BenchmarkFailureClass = (typeof BENCHMARK_FAILURE_CLASSES)[number]
export const BENCHMARK_FAILURE_SIGNALS = [
  'RUN_NOT_COMPLETED',
  'OBJECTIVE_ORACLE_FAILED',
  'REGRESSION_ORACLE_FAILED',
  'C2_MULTI_FILE_CONTRACT_FAILED',
  'C2_PROBE_UNTRUSTWORTHY',
  'ACCEPTANCE_CRITERION_FAILED',
  'WRITABLE_PATH_SCOPE_FAILED',
  'ORIGINAL_MESSAGES_CHANGED',
  'RAW_PROVIDER_PAYLOADS_CAPTURED',
  'OBSERVATION_FAILURE'
] as const
export type BenchmarkFailureSignal = (typeof BENCHMARK_FAILURE_SIGNALS)[number]
export const ACCEPTANCE_CHECK_KINDS = [
  'OBJECTIVE_ORACLE',
  'C2_MULTI_FILE_CONTRACT',
  'REGRESSION_ORACLE',
  'WRITABLE_PATH_SCOPE',
  'ORIGINAL_MESSAGES_UNCHANGED',
  'RAW_PROVIDER_PAYLOADS_ABSENT'
] as const
export type AcceptanceCheckKind = (typeof ACCEPTANCE_CHECK_KINDS)[number]

export interface BenchmarkModelProfile {
  readonly provider: string
  readonly model: string
  readonly thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
}

export interface BenchmarkOracleSpec {
  readonly command: 'node'
  readonly args: readonly string[]
  readonly expectedExitCode: number
  readonly timeoutMs: number
}

export interface BenchmarkBudget {
  readonly maxSemanticCalls: number
  readonly maxToolCalls: number
  readonly wallClockMs: number
}

export interface BenchmarkAcceptanceCriterion {
  readonly id: string
  readonly description: string
  readonly check: AcceptanceCheckKind
}

export interface BenchmarkManifest {
  readonly taskId: string
  readonly category: BenchmarkCategory
  readonly title: string
  readonly fixtureVersion: string
  readonly fixturePath: string
  readonly referencePath: string
  readonly repositoryRevision: RepositoryRevisionContract
  readonly initialStateHash: string
  readonly prompt: string
  readonly acceptanceCriteria: readonly BenchmarkAcceptanceCriterion[]
  readonly oracle: BenchmarkOracleSpec
  readonly regressionOracle: BenchmarkOracleSpec
  readonly allowedTools: readonly string[]
  readonly expectedTools: readonly string[]
  readonly modelProfile: BenchmarkModelProfile
  readonly contextStrategies: readonly ContextStrategy[]
  readonly budget: BenchmarkBudget
  readonly expectedWritablePaths: readonly string[]
  readonly retentionPolicy: string
  readonly knownCandidatePaths: readonly string[]
  readonly knownRelevantPaths: readonly string[]
  readonly knownIrrelevantPaths: readonly string[]
  readonly expectedArchitecturalRules: readonly string[]
}

export interface FixtureIdentity {
  readonly repositoryRevision: RepositoryRevisionContract
  readonly initialStateHash: string
}

export interface OracleResult {
  readonly passed: boolean
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly outputLimitExceeded?: boolean
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

export interface AcceptanceCriterionResult extends BenchmarkAcceptanceCriterion {
  readonly passed: boolean
  readonly evidence: string
}

export interface FileAccessEvidence {
  readonly toolName: string
  readonly path: string
  readonly kind: 'READ' | 'SEARCH'
  readonly sequence: number
}

export interface NativeCallEvidence {
  readonly sequence: number
  readonly observedMessageTokenEstimate: number
  readonly categoryCounts: Readonly<Record<string, number>>
  readonly toolResultCount: number
  readonly fileAccesses: readonly FileAccessEvidence[]
}

export interface ShadowDecisionEvidence {
  readonly kind: ContextDecision['kind']
  readonly sourceKey: string
  readonly sourceVersionId: string
  readonly representationId: string
  readonly fromWorkingSetId: string | null
  readonly toWorkingSetId: string
  readonly reasonCodes: readonly string[]
  readonly tokenDelta: number
  readonly previousRepresentationKind: string | null
  readonly representationKind: string | null
}

// Durable Shadow evidence deliberately excludes ephemeral representation
// content/contentRef. The Planner only needs these identity and budgeting
// fields to replay the same Working Set and transition.
export type ShadowRepresentationEvidence = Omit<ContextRepresentation, 'content' | 'contentRef'>

export interface ShadowCallEvidence {
  readonly sequence: number
  readonly universeSequence: number
  readonly universeHash: string
  readonly workingSetId: string
  readonly workingSetHash: string
  readonly planningRequestHash: string
  readonly universe: ContextUniverseRevision
  readonly planningRequest: ContextPlanningRequest
  readonly previousWorkingSet: ContextWorkingSet | null
  readonly policyVersion: string
  readonly transitionHash: string
  readonly representations: readonly {
    readonly sourceKey: string
    readonly representation: ShadowRepresentationEvidence
  }[]
  readonly proposedSemanticTokenEstimate: number
  readonly itemCount: number
  readonly nativeContextEstimate: number
  readonly decisions: readonly ShadowDecisionEvidence[]
  readonly representationCounts: Readonly<Record<string, number>>
  readonly reasonCodeCounts: Readonly<Record<string, number>>
  readonly materializationFailures: readonly string[]
  readonly fileAccesses: readonly FileAccessEvidence[]
}

// Bounded per-path repository observation state retained in a run record
// (DS-014 C). Distinguishes AVAILABLE / ABSENT / UNAVAILABLE with the exact
// UNAVAILABLE reasonCode; never contains raw content, provider payloads,
// credentials or absolute temp roots.
export interface RepositoryObservationEvidence {
  readonly path: string
  readonly status: 'AVAILABLE' | 'ABSENT' | 'UNAVAILABLE'
  readonly reasonCode: string | null
}

export interface BenchmarkRunRecord {
  readonly runId: string
  readonly taskId: string
  readonly category: BenchmarkCategory
  readonly strategy: ContextStrategy
  readonly repetition: number
  readonly status: RunStatus
  // Diagnostic attribution only; this never overrides the progressive gate.
  // HARNESS_CONTRACT_FAILURE is reserved for an INVALID record whose only
  // failed acceptance condition is the C2 contract probe. Optional fields keep
  // older metadata-only records readable.
  readonly failureClass?: BenchmarkFailureClass | null
  readonly failureSignals?: readonly BenchmarkFailureSignal[]
  readonly fixtureIdentity: FixtureIdentity
  readonly finalRepositoryRevision: RepositoryRevisionContract | null
  readonly finalStateHash: string | null
  readonly changedPaths: readonly string[]
  readonly outOfScopePaths: readonly string[]
  readonly writablePathsValid: boolean
  readonly modelProfile: BenchmarkModelProfile
  readonly semanticCallCount: number
  readonly toolCallCount: number
  readonly toolResultCount: number
  readonly fileReadCount: number
  readonly searchCount: number
  readonly repeatedAccessCount: number
  readonly wallClockMs: number
  readonly abortReason: string | null
  readonly agentDeclaredSuccess: boolean | null
  readonly objectiveOracle: OracleResult
  readonly regressionOracle: OracleResult
  readonly acceptanceCriteriaResults: readonly AcceptanceCriterionResult[]
  readonly acceptanceCriteriaPassed: boolean
  readonly nativeCalls: readonly NativeCallEvidence[]
  readonly shadowCalls: readonly ShadowCallEvidence[]
  readonly observationFailures: readonly string[]
  // Populated by the live runner (DS-014 C); optional so hand-built records in
  // non-live tests do not need to enumerate repository observations.
  readonly repositoryObservations?: readonly RepositoryObservationEvidence[]
  readonly originalMessagesUnchanged: boolean
  readonly rawProviderPayloadsCaptured: false
}

export interface FalseRemovalCandidate {
  readonly taskId: string
  readonly runId: string
  readonly sourceKey: string
  readonly removalSequence: number
  readonly removalReasonCodes: readonly string[]
  readonly nextAccessSequence: number
  readonly distance: number
  readonly evidence: 'READ_AFTER_REMOVE' | 'REHYDRATE'
  readonly taskPassedAtObservation: boolean
  readonly classification: 'USEFUL' | 'POSSIBLE' | 'LIKELY' | 'INDETERMINATE'
}

export interface RehydrationObservation {
  readonly taskId: string
  readonly runId: string
  readonly sourceKey: string
  readonly removalSequence: number
  readonly rehydrateSequence: number
  readonly distance: number
  readonly evidence: 'REHYDRATE'
}

export interface AggregateResult {
  readonly totalRuns: number
  readonly validRuns: number
  readonly skippedRuns: number
  readonly abortedRuns: number
  readonly taskFailureRuns: number
  readonly harnessContractFailureRuns: number
  readonly byCategory: Readonly<Record<BenchmarkCategory, { native: number; shadow: number }>>
  readonly semanticCallCount: number
  readonly toolCallCount: number
  readonly nativeEstimateTotal: number
  readonly shadowEstimateTotal: number
  readonly shadowDecisionCounts: Readonly<Record<string, number>>
  readonly representationCounts: Readonly<Record<string, number>>
  readonly rehydrations: readonly RehydrationObservation[]
  readonly rehydratedWithin: { readonly within1: number; readonly within3: number; readonly within5: number }
  readonly readAfterRemoveCount: number
  readonly searchAfterRemoveCount: number
  readonly removedNeverNeededAgain: number
  readonly removedLaterNeeded: number
  readonly falseRemovalCandidates: readonly FalseRemovalCandidate[]
  readonly representationTransitions: {
    readonly fullToLineRange: number
    readonly lineRangeToFull: number
    readonly sourceVersionAdvancedReplace: number
  }
  readonly materializationFailureCount: number
  readonly materializationFailures: readonly string[]
  readonly observationFailureCount: number
  readonly observationFailures: readonly string[]
  readonly runIdsExcludedFromValidity: readonly string[]
  readonly nativeVsShadowEstimatePairs: readonly {
    readonly taskId: string
    readonly repetition: number
    readonly nativeEstimate: number
    readonly shadowEstimate: number
  }[]
  readonly providerSavings: null
}

export interface ShadowMetricsProjection {
  readonly metrics: ShadowPlanningMetrics
  readonly workingSetHash: string
  readonly itemCount: number
}
