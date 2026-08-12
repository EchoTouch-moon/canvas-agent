import type { ContextDecision, ShadowPlanningMetrics } from '@canvas-agent/context-runtime'
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
  readonly acceptanceCriteria: readonly string[]
  readonly oracle: BenchmarkOracleSpec
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
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
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

export interface ShadowCallEvidence {
  readonly sequence: number
  readonly universeSequence: number
  readonly universeHash: string
  readonly workingSetId: string
  readonly workingSetHash: string
  readonly planningRequestHash: string
  readonly proposedSemanticTokenEstimate: number
  readonly itemCount: number
  readonly nativeContextEstimate: number
  readonly decisions: readonly ShadowDecisionEvidence[]
  readonly representationCounts: Readonly<Record<string, number>>
  readonly reasonCodeCounts: Readonly<Record<string, number>>
  readonly materializationFailures: readonly string[]
  readonly fileAccesses: readonly FileAccessEvidence[]
}

export interface BenchmarkRunRecord {
  readonly runId: string
  readonly taskId: string
  readonly category: BenchmarkCategory
  readonly strategy: ContextStrategy
  readonly repetition: number
  readonly status: RunStatus
  readonly fixtureIdentity: FixtureIdentity
  readonly finalRepositoryRevision: RepositoryRevisionContract | null
  readonly finalStateHash: string | null
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
  readonly nativeCalls: readonly NativeCallEvidence[]
  readonly shadowCalls: readonly ShadowCallEvidence[]
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
