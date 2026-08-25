import {
  applySourceObservations,
  planWorkingSet,
  type ContextPlanningRequest,
  type ContextRepresentation,
  type ContextWorkingSet,
  type ContextUniverseRevision,
  type RemovalRecord,
} from "../../../src";
import { entryFor, representationFor, seedLifecycleUniverse } from "./common";
import {
  POLICY_VERSION,
  B1_POLICY_VERSION,
  type B0Classification,
  type EvidenceSnapshot,
  type FrozenDecisionExpectation,
  type GateB0Result,
  type LaterNeedEvidence,
  type LifecycleScenarioFixture,
  type LifecycleTraceEvent,
  type LifecycleTransitionRecord,
  type MutablePlanningState,
  type ScenarioResult,
} from "./types";
import type { SourceLifecycleSignal } from "../../../src";

const NEED_EVIDENCE_EVENTS = new Set<LifecycleTraceEvent["kind"]>([
  "DEPENDENCY_DISCOVERED",
  "FAILURE_OBSERVED",
  "DETAIL_REQUESTED",
  "SEARCH_HIT_AFTER_REMOVE",
  "READ_AFTER_REMOVE",
]);

function initialPlanningState(): MutablePlanningState {
  return {
    taskPhase: "GENERAL",
    budget: { maxSemanticTokens: 1000 },
    pinnedSourceKeys: [],
    excludedSourceKeys: [],
    currentTargetSourceKeys: [],
    latestVerificationSourceKeys: [],
    recentEvidenceSourceKeys: [],
    representationNeeds: [],
    sourceLifecycleSignals: [],
  };
}

function applyRequestPatch(
  state: MutablePlanningState,
  patch: LifecycleScenarioFixture["events"][number]["request"],
): MutablePlanningState {
  if (patch === undefined) return state;
  return {
    taskPhase: patch.taskPhase ?? state.taskPhase,
    budget: patch.budget ?? state.budget,
    pinnedSourceKeys: patch.pinnedSourceKeys ?? state.pinnedSourceKeys,
    excludedSourceKeys: patch.excludedSourceKeys ?? state.excludedSourceKeys,
    currentTargetSourceKeys:
      patch.currentTargetSourceKeys ?? state.currentTargetSourceKeys,
    latestVerificationSourceKeys:
      patch.latestVerificationSourceKeys ?? state.latestVerificationSourceKeys,
    recentEvidenceSourceKeys:
      patch.recentEvidenceSourceKeys ?? state.recentEvidenceSourceKeys,
    representationNeeds: patch.representationNeeds ?? state.representationNeeds,
    sourceLifecycleSignals:
      patch.sourceLifecycleSignals ?? state.sourceLifecycleSignals,
  };
}

function lifecycleSignalForEvent(
  event: LifecycleTraceEvent,
): SourceLifecycleSignal | undefined {
  if (event.sourceKey === undefined) return undefined;
  const kind =
    event.kind === "SOURCE_RULED_OUT"
      ? "RULED_OUT"
      : event.kind === "SOURCE_SUPERSEDED"
        ? "SUPERSEDED"
        : event.kind === "FAILURE_OBSERVED"
          ? "NEW_FAILURE_EVIDENCE"
          : event.kind === "PHASE_CHANGED"
            ? "PHASE_IRRELEVANT"
            : event.kind === "DETAIL_REQUESTED"
              ? "DETAIL_REQUIRED"
              : undefined;
  if (kind === undefined) return undefined;
  return {
    sourceKey: event.sourceKey,
    kind,
    ...(event.evidenceRef !== undefined
      ? { evidenceRef: event.evidenceRef }
      : {}),
  };
}

function makePlanningRequest(
  runtimeSessionId: string,
  sequence: number,
  state: MutablePlanningState,
  previousWorkingSet: ContextWorkingSet | null,
  removalHistory: readonly RemovalRecord[],
): ContextPlanningRequest {
  return {
    runtimeSessionId,
    recompositionSequence: sequence,
    taskPhase: state.taskPhase,
    budget: state.budget,
    pinnedSourceKeys: state.pinnedSourceKeys,
    excludedSourceKeys: state.excludedSourceKeys,
    currentTargetSourceKeys: state.currentTargetSourceKeys,
    latestVerificationSourceKeys: state.latestVerificationSourceKeys,
    recentEvidenceSourceKeys: state.recentEvidenceSourceKeys,
    sourceLifecycleSignals: state.sourceLifecycleSignals,
    removalHistory,
    representationNeeds: state.representationNeeds,
    previousWorkingSetId: previousWorkingSet?.workingSetId ?? null,
  };
}

function expectedDecisionMatches(
  record: LifecycleTransitionRecord,
  expected: FrozenDecisionExpectation,
): boolean {
  if (
    record.decisionKind !== expected.kind ||
    record.sourceKey !== expected.sourceKey
  )
    return false;
  if (
    expected.sourceVersionId !== undefined &&
    record.sourceVersionId !== expected.sourceVersionId
  )
    return false;
  if (
    expected.representationKind !== undefined &&
    record.representationKind !== expected.representationKind
  )
    return false;
  return true;
}

function expectedReasonsMatch(
  record: LifecycleTransitionRecord,
  expected: FrozenDecisionExpectation,
): boolean {
  return (
    (expected.requiredReasonCodes ?? []).every((reasonCode) =>
      record.reasonCodes.includes(reasonCode),
    ) &&
    (expected.requiredAnyReasonCodes === undefined ||
      expected.requiredAnyReasonCodes.some((reasonCode) =>
        record.reasonCodes.includes(reasonCode),
      ))
  );
}

export function validateScenarioOracle(
  fixture: LifecycleScenarioFixture,
  records: readonly LifecycleTransitionRecord[],
  finalWorkingSet: ContextWorkingSet | null,
): readonly string[] {
  const failures: string[] = [];
  const used = new Set<number>();
  for (const expected of fixture.oracle.requiredDecisions) {
    const matchingIndices = records
      .map((record, index) => ({ record, index }))
      .filter(
        ({ record, index }) =>
          !used.has(index) && expectedDecisionMatches(record, expected),
      );
    const satisfying = matchingIndices.find(({ record }) =>
      expectedReasonsMatch(record, expected),
    );
    const recordIndex = satisfying?.index ?? matchingIndices[0]?.index ?? -1;
    if (recordIndex < 0) {
      failures.push(`missing ${expected.kind} for ${expected.sourceKey}`);
      continue;
    }
    used.add(recordIndex);
    const record = records[recordIndex]!;
    if (!expectedReasonsMatch(record, expected)) {
      for (const reasonCode of expected.requiredReasonCodes ?? []) {
        if (!record.reasonCodes.includes(reasonCode)) {
          failures.push(
            `${expected.kind} ${expected.sourceKey} missing reason ${reasonCode}`,
          );
        }
      }
      if (
        expected.requiredAnyReasonCodes !== undefined &&
        !expected.requiredAnyReasonCodes.some((reasonCode) =>
          record.reasonCodes.includes(reasonCode),
        )
      ) {
        failures.push(
          `${expected.kind} ${expected.sourceKey} missing one of ${expected.requiredAnyReasonCodes.join(", ")}`,
        );
      }
    }
  }

  const observedKinds = new Set(fixture.events.map((event) => event.kind));
  for (const requiredKind of fixture.oracle.requiredEventKinds ?? []) {
    if (!observedKinds.has(requiredKind))
      failures.push(`missing trace event ${requiredKind}`);
  }

  const activeKeys = new Set(
    finalWorkingSet?.items.flatMap((item) => item.sourceKeys) ?? [],
  );
  for (const sourceKey of fixture.oracle.requiredActiveSourceKeys ?? []) {
    if (!activeKeys.has(sourceKey))
      failures.push(`required active source missing: ${sourceKey}`);
  }
  for (const sourceKey of fixture.oracle.forbiddenActiveSourceKeys ?? []) {
    if (activeKeys.has(sourceKey))
      failures.push(`forbidden active source remains: ${sourceKey}`);
  }

  return failures;
}

export function validateEvidenceContract(
  snapshot: EvidenceSnapshot,
): readonly string[] {
  const failures: string[] = [];
  const removeByTransitionId = new Map<string, LifecycleTransitionRecord>();
  const decisionKindsBySubject = new Map<
    string,
    Set<LifecycleTransitionRecord["decisionKind"]>
  >();
  const knownSourceKeys = new Set<string>();
  for (const universe of snapshot.universeByRevision.values()) {
    for (const entry of universe.entries)
      knownSourceKeys.add(entry.source.sourceKey);
  }

  for (const record of snapshot.records) {
    const subjectKey = `${record.transitionId}|${record.sourceKey}`;
    const subjectKinds = decisionKindsBySubject.get(subjectKey) ?? new Set();
    subjectKinds.add(record.decisionKind);
    decisionKindsBySubject.set(subjectKey, subjectKinds);
    if (record.reasonCodes.length === 0) {
      failures.push(
        `unexplained decision: ${record.decisionKind} ${record.sourceKey}`,
      );
    }
    if (!knownSourceKeys.has(record.sourceKey)) {
      failures.push(
        `record references source outside Universe: ${record.sourceKey}`,
      );
    }
    if (record.decisionKind === "REMOVE") {
      removeByTransitionId.set(record.transitionId, record);
      if (snapshot.protectedSourceKeys.includes(record.sourceKey)) {
        failures.push(`protected source removed: ${record.sourceKey}`);
      }
    }
    if (record.decisionKind === "REHYDRATE") {
      if (record.originatingRemoveTransitionId === null) {
        failures.push(
          `REHYDRATE missing originating REMOVE: ${record.sourceKey}`,
        );
      } else {
        const originatingRemove = removeByTransitionId.get(
          record.originatingRemoveTransitionId,
        );
        if (
          originatingRemove === undefined ||
          originatingRemove.decisionKind !== "REMOVE"
        ) {
          failures.push(
            `REHYDRATE has invalid originating REMOVE: ${record.sourceKey}`,
          );
        }
      }
      if (record.laterNeedEvidenceRef === null) {
        failures.push(
          `REHYDRATE missing later-needed evidence: ${record.sourceKey}`,
        );
      }
      const expectedVersion = snapshot.sourceVersionsByKey.get(
        record.sourceKey,
      )?.versionId;
      if (
        expectedVersion === undefined ||
        record.sourceVersionId !== expectedVersion
      ) {
        failures.push(`wrong SourceVersion rehydrate: ${record.sourceKey}`);
      }
    }
    if (
      snapshot.unavailableSourceKeys.includes(record.sourceKey) &&
      record.reasonCodes.includes("SOURCE_ABSENT")
    ) {
      failures.push(
        `UNAVAILABLE converted to SOURCE_ABSENT: ${record.sourceKey}`,
      );
    }
    const representation = snapshot.representationsById.get(
      record.representationId,
    );
    if (representation === undefined) {
      failures.push(`unbound representation: ${record.representationId}`);
    } else if (
      !representation.sourceVersionIds.includes(record.sourceVersionId)
    ) {
      failures.push(
        `representation/source version mismatch: ${record.sourceKey}`,
      );
    }
  }

  for (const [subjectKey, kinds] of decisionKindsBySubject) {
    if (kinds.has("REMOVE") && [...kinds].some((kind) => kind !== "REMOVE")) {
      failures.push(
        `contradictory decisions for one transition subject: ${subjectKey}`,
      );
    }
  }

  return failures;
}

function runScenarioInternal(
  fixture: LifecycleScenarioFixture,
  runtimeSessionId: string,
  includeLifecycleSignals: boolean,
): ScenarioResult {
  let universe = seedLifecycleUniverse(runtimeSessionId);
  let state = initialPlanningState();
  let previousWorkingSet: ContextWorkingSet | null = null;
  let planningSequence = 0;
  let removalHistory: RemovalRecord[] = [];
  const removalTransitionBySource = new Map<string, string>();
  const latestNeedBySource = new Map<string, LaterNeedEvidence>();
  const records: LifecycleTransitionRecord[] = [];
  const transitions = [] as ReturnType<typeof planWorkingSet>["transition"][];
  const universeByRevision = new Map<string, ContextUniverseRevision>();
  const sourceVersionsByKey = new Map<
    string,
    ReturnType<
      typeof seedLifecycleUniverse
    >["entries"][number]["admittedVersion"]
  >();
  const representationsById = new Map<string, ContextRepresentation>();
  const laterNeedEvidence: LaterNeedEvidence[] = [];
  const harnessFailures: string[] = [];

  universeByRevision.set(universe.revisionId, universe);
  for (const entry of universe.entries) {
    if (entry.admittedVersion !== null)
      sourceVersionsByKey.set(entry.source.sourceKey, entry.admittedVersion);
  }

  for (const event of fixture.events) {
    state = applyRequestPatch(state, event.request);
    if (includeLifecycleSignals) {
      const lifecycleSignal = lifecycleSignalForEvent(event);
      if (lifecycleSignal !== undefined) {
        state = {
          ...state,
          sourceLifecycleSignals: [
            ...state.sourceLifecycleSignals.filter(
              (signal) => signal.sourceKey !== lifecycleSignal.sourceKey,
            ),
            lifecycleSignal,
          ],
        };
      }
    }
    if (event.observation !== undefined) {
      universe = applySourceObservations({
        previous: universe,
        observations: [event.observation],
        modelCallSequence: event.sequence,
      });
      universeByRevision.set(universe.revisionId, universe);
      for (const entry of universe.entries) {
        if (entry.admittedVersion !== null)
          sourceVersionsByKey.set(
            entry.source.sourceKey,
            entry.admittedVersion,
          );
      }
    }

    if (
      event.sourceKey !== undefined &&
      event.evidenceRef !== undefined &&
      NEED_EVIDENCE_EVENTS.has(event.kind)
    ) {
      const evidence: LaterNeedEvidence = {
        sourceKey: event.sourceKey,
        evidenceKind: event.kind,
        sequence: event.sequence,
        evidenceRef: event.evidenceRef,
      };
      latestNeedBySource.set(event.sourceKey, evidence);
      laterNeedEvidence.push(evidence);
    }

    if (!event.plan) continue;
    planningSequence += 1;
    const request = makePlanningRequest(
      runtimeSessionId,
      planningSequence,
      state,
      previousWorkingSet,
      removalHistory,
    );
    const options = {
      policyVersion: includeLifecycleSignals
        ? B1_POLICY_VERSION
        : POLICY_VERSION,
      createdAt: "2026-08-14T00:00:00.000Z",
      represent: (entry: Parameters<typeof representationFor>[0]) => {
        const need = state.representationNeeds.find(
          (candidate) => candidate.sourceKey === entry.source.sourceKey,
        );
        const representation = representationFor(
          entry,
          need?.preferredKind ?? "REFERENCE",
        );
        if (representation !== null)
          representationsById.set(representation.id, representation);
        return representation;
      },
    };
    const result = planWorkingSet({
      universe,
      request,
      previousWorkingSet,
      options,
    });
    transitions.push(result.transition);

    for (const decision of result.decisions) {
      const representation = representationsById.get(decision.representationId);
      const laterNeed = latestNeedBySource.get(decision.sourceKey);
      const record: LifecycleTransitionRecord = {
        sequence: event.sequence,
        universeRevision: universe.revisionId,
        previousWorkingSetId: previousWorkingSet?.workingSetId ?? null,
        event: event.id,
        decisionKind: decision.kind,
        sourceKey: decision.sourceKey,
        sourceVersionId: decision.sourceVersionId,
        representationId: decision.representationId,
        representationKind: representation?.kind ?? null,
        reasonCodes: [...decision.reasonCodes],
        originatingRemoveTransitionId:
          decision.kind === "REHYDRATE"
            ? (removalTransitionBySource.get(decision.sourceKey) ?? null)
            : null,
        laterNeedEvidenceRef:
          decision.kind === "REHYDRATE"
            ? (laterNeed?.evidenceRef ?? null)
            : null,
        fromWorkingSetHash: previousWorkingSet?.logicalHash ?? null,
        toWorkingSetHash: result.workingSet.logicalHash,
        transitionId: result.transition.transitionId,
        transitionHash: result.transition.logicalHash,
      };
      records.push(record);
      if (decision.kind === "REMOVE") {
        removalHistory = [
          ...removalHistory,
          {
            sourceKey: decision.sourceKey,
            originalRemovalReasonCodes: decision.reasonCodes,
            removedAtSequence: event.sequence,
            removedFromWorkingSetId: decision.fromWorkingSetId,
          },
        ];
        removalTransitionBySource.set(
          decision.sourceKey,
          result.transition.transitionId,
        );
      }
    }
    previousWorkingSet = result.workingSet;
  }

  if (previousWorkingSet === null)
    harnessFailures.push("trace produced no planning boundary");
  const evidenceFailures = validateEvidenceContract({
    records,
    universeByRevision,
    sourceVersionsByKey: new Map(
      [...sourceVersionsByKey.entries()].filter(
        (entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
          entry[1] !== null,
      ),
    ),
    representationsById,
    protectedSourceKeys: fixture.oracle.protectedSourceKeys ?? [],
    unavailableSourceKeys: fixture.oracle.unavailableSourceKeys ?? [],
  });
  const policyFailures = [
    ...validateScenarioOracle(fixture, records, previousWorkingSet),
    ...evidenceFailures,
  ];
  const classification: B0Classification =
    harnessFailures.length > 0
      ? "HARNESS_CONTRACT_FAILURE"
      : policyFailures.length > 0
        ? "POLICY_CAPABILITY_GAP"
        : "PASS";
  return {
    fixtureId: fixture.id,
    classification,
    policyFailures,
    harnessFailures,
    records,
    transitions,
    finalWorkingSet: previousWorkingSet,
    universeByRevision,
    sourceVersionsByKey: new Map(
      [...sourceVersionsByKey.entries()].filter(
        (entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
          entry[1] !== null,
      ),
    ),
    representationsById,
    laterNeedEvidence,
  };
}

export function runScenario(fixture: LifecycleScenarioFixture): ScenarioResult {
  return runScenarioInternal(
    fixture,
    `cspv-b0:${fixture.id.toLowerCase()}`,
    false,
  );
}

export function runScenarioB1(
  fixture: LifecycleScenarioFixture,
): ScenarioResult {
  return runScenarioInternal(
    fixture,
    `cspv-b1:${fixture.id.toLowerCase()}`,
    true,
  );
}

function scenarioDigest(result: ScenarioResult): string {
  return JSON.stringify({
    classification: result.classification,
    records: result.records,
    transitions: result.transitions.map((transition) => transition.logicalHash),
    finalWorkingSetHash: result.finalWorkingSet?.logicalHash ?? null,
  });
}

function replayMismatches(
  fixture: LifecycleScenarioFixture,
  includeLifecycleSignals: boolean,
  runPrefix: string,
): number {
  const first = runScenarioInternal(
    fixture,
    `${runPrefix}:${fixture.id.toLowerCase()}`,
    includeLifecycleSignals,
  );
  const second = runScenarioInternal(
    fixture,
    `${runPrefix}:${fixture.id.toLowerCase()}`,
    includeLifecycleSignals,
  );
  return scenarioDigest(first) === scenarioDigest(second) ? 0 : 1;
}

function runGateSuite(
  fixtures: readonly LifecycleScenarioFixture[],
  includeLifecycleSignals: boolean,
  runPrefix: string,
): GateB0Result {
  const scenarioResults = fixtures.map((fixture) =>
    runScenarioInternal(
      fixture,
      `${runPrefix}:${fixture.id.toLowerCase()}`,
      includeLifecycleSignals,
    ),
  );
  const replayMismatchCount = fixtures.reduce(
    (count, fixture) =>
      count + replayMismatches(fixture, includeLifecycleSignals, runPrefix),
    0,
  );
  const mutationChecks = [
    "expected-version",
    "rehydrate-kind",
    "originating-remove",
    "unavailable-absence",
    "protected-eviction",
  ];
  const hasHarnessFailure = scenarioResults.some(
    (result) => result.classification === "HARNESS_CONTRACT_FAILURE",
  );
  const hasPolicyGap = scenarioResults.some(
    (result) => result.classification === "POLICY_CAPABILITY_GAP",
  );
  const classification: B0Classification =
    replayMismatchCount > 0 || hasHarnessFailure
      ? "HARNESS_CONTRACT_FAILURE"
      : hasPolicyGap
        ? "POLICY_CAPABILITY_GAP"
        : "PASS";
  return {
    classification,
    scenarioResults,
    removeCount: scenarioResults.reduce(
      (count, result) =>
        count +
        result.records.filter((record) => record.decisionKind === "REMOVE")
          .length,
      0,
    ),
    rehydrateCount: scenarioResults.reduce(
      (count, result) =>
        count +
        result.records.filter((record) => record.decisionKind === "REHYDRATE")
          .length,
      0,
    ),
    replayMismatches: replayMismatchCount,
    mutationChecks,
    providerCalls: 0,
  };
}

export function runGateB0Suite(
  fixtures: readonly LifecycleScenarioFixture[],
): GateB0Result {
  return runGateSuite(fixtures, false, "cspv-b0");
}

export function runGateB1Suite(
  fixtures: readonly LifecycleScenarioFixture[],
): GateB0Result {
  return runGateSuite(fixtures, true, "cspv-b1");
}
