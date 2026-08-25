import type {
  ContextBudget,
  ContextDecision,
  ContextRepresentationNeed,
  ContextRepresentation,
  ContextSourceVersion,
  ContextTransition,
  ContextUniverseRevision,
  ContextWorkingSet,
  DecisionKind,
  SourceObservation,
  SourceLifecycleSignal,
  TaskPhase,
} from "../../../src";

export const POLICY_VERSION = "policy-v0-gate-b0";
export const B1_POLICY_VERSION = "policy-v0-gate-b1-source-lifecycle-signals";
export const TRACE_TIMESTAMP = "2026-08-14T00:00:00.000Z";

export type TraceEventKind =
  | "INITIALIZE_UNIVERSE"
  | "PLANNING_BOUNDARY"
  | "CURRENT_TARGET"
  | "DEPENDENCY_DISCOVERED"
  | "FAILURE_OBSERVED"
  | "SOURCE_RULED_OUT"
  | "SOURCE_SUPERSEDED"
  | "PHASE_CHANGED"
  | "BUDGET_PRESSURE"
  | "SOURCE_REFRESH_UNAVAILABLE"
  | "DETAIL_REQUESTED"
  | "SEARCH_HIT_AFTER_REMOVE"
  | "READ_AFTER_REMOVE";

export interface RequestPatch {
  readonly taskPhase?: TaskPhase;
  readonly budget?: ContextBudget;
  readonly pinnedSourceKeys?: readonly string[];
  readonly excludedSourceKeys?: readonly string[];
  readonly currentTargetSourceKeys?: readonly string[];
  readonly latestVerificationSourceKeys?: readonly string[];
  readonly recentEvidenceSourceKeys?: readonly string[];
  readonly representationNeeds?: readonly ContextRepresentationNeed[];
  readonly sourceLifecycleSignals?: readonly SourceLifecycleSignal[];
}

export interface LifecycleTraceEvent {
  readonly sequence: number;
  readonly id: string;
  readonly kind: TraceEventKind;
  readonly sourceKey?: string;
  readonly evidenceRef?: string;
  readonly observation?: SourceObservation;
  readonly request?: RequestPatch;
  readonly plan?: boolean;
}

export interface FrozenDecisionExpectation {
  readonly kind: DecisionKind;
  readonly sourceKey: string;
  readonly requiredReasonCodes?: readonly string[];
  readonly requiredAnyReasonCodes?: readonly string[];
  readonly sourceVersionId?: string;
  readonly representationKind?: string;
}

export interface FrozenScenarioOracle {
  readonly requiredDecisions: readonly FrozenDecisionExpectation[];
  readonly requiredActiveSourceKeys?: readonly string[];
  readonly forbiddenActiveSourceKeys?: readonly string[];
  readonly requiredEventKinds?: readonly TraceEventKind[];
  readonly unavailableSourceKeys?: readonly string[];
  readonly protectedSourceKeys?: readonly string[];
}

export interface LifecycleScenarioFixture {
  readonly id: string;
  readonly name: string;
  readonly events: readonly LifecycleTraceEvent[];
  readonly oracle: FrozenScenarioOracle;
}

export interface LifecycleTransitionRecord {
  readonly sequence: number;
  readonly universeRevision: string;
  readonly previousWorkingSetId: string | null;
  readonly event: string;
  readonly decisionKind: DecisionKind;
  readonly sourceKey: string;
  readonly sourceVersionId: string;
  readonly representationId: string;
  readonly representationKind: string | null;
  readonly reasonCodes: readonly string[];
  readonly originatingRemoveTransitionId: string | null;
  readonly laterNeedEvidenceRef: string | null;
  readonly fromWorkingSetHash: string | null;
  readonly toWorkingSetHash: string;
  readonly transitionId: string;
  readonly transitionHash: string;
}

export interface LaterNeedEvidence {
  readonly sourceKey: string;
  readonly evidenceKind: TraceEventKind;
  readonly sequence: number;
  readonly evidenceRef: string;
}

export type B0Classification =
  | "PASS"
  | "POLICY_CAPABILITY_GAP"
  | "HARNESS_CONTRACT_FAILURE"
  | "SPEC_AMBIGUITY";

export interface ScenarioResult {
  readonly fixtureId: string;
  readonly classification: B0Classification;
  readonly policyFailures: readonly string[];
  readonly harnessFailures: readonly string[];
  readonly records: readonly LifecycleTransitionRecord[];
  readonly transitions: readonly ContextTransition[];
  readonly finalWorkingSet: ContextWorkingSet | null;
  readonly universeByRevision: ReadonlyMap<string, ContextUniverseRevision>;
  readonly sourceVersionsByKey: ReadonlyMap<string, ContextSourceVersion>;
  readonly representationsById: ReadonlyMap<string, ContextRepresentation>;
  readonly laterNeedEvidence: readonly LaterNeedEvidence[];
}

export interface GateB0Result {
  readonly classification: B0Classification;
  readonly scenarioResults: readonly ScenarioResult[];
  readonly removeCount: number;
  readonly rehydrateCount: number;
  readonly replayMismatches: number;
  readonly mutationChecks: readonly string[];
  readonly providerCalls: 0;
}

export interface EvidenceSnapshot {
  readonly records: readonly LifecycleTransitionRecord[];
  readonly universeByRevision: ReadonlyMap<string, ContextUniverseRevision>;
  readonly sourceVersionsByKey: ReadonlyMap<string, ContextSourceVersion>;
  readonly representationsById: ReadonlyMap<string, ContextRepresentation>;
  readonly protectedSourceKeys: readonly string[];
  readonly unavailableSourceKeys: readonly string[];
}

export interface MutablePlanningState {
  taskPhase: TaskPhase;
  budget: ContextBudget;
  pinnedSourceKeys: readonly string[];
  excludedSourceKeys: readonly string[];
  currentTargetSourceKeys: readonly string[];
  latestVerificationSourceKeys: readonly string[];
  recentEvidenceSourceKeys: readonly string[];
  representationNeeds: readonly ContextRepresentationNeed[];
  sourceLifecycleSignals: readonly SourceLifecycleSignal[];
}

export type DecisionLookup = (
  predicate: (decision: ContextDecision) => boolean,
) => ContextDecision | undefined;
