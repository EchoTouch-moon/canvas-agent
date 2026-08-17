import { SOURCE_KEYS, sourceVersionId } from "./common";
import { boundary, traceEvent } from "./events";
import type { LifecycleScenarioFixture } from "./types";

export const compositeTraceFixture: LifecycleScenarioFixture = {
  id: "COMPOSITE",
  name: "Composite REMOVE → later-needed → REHYDRATE chain",
  events: [
    traceEvent({ sequence: 1, id: "C-T0", kind: "INITIALIZE_UNIVERSE" }),
    boundary(2, "C-T1", {
      currentTargetSourceKeys: [SOURCE_KEYS.target, SOURCE_KEYS.reopenA],
      recentEvidenceSourceKeys: [
        SOURCE_KEYS.distractorA,
        SOURCE_KEYS.distractorB,
        SOURCE_KEYS.unavailable,
        SOURCE_KEYS.oldFailure,
      ],
    }),
    boundary(3, "C-T2"),
    traceEvent({
      sequence: 4,
      id: "C-T3A",
      kind: "SOURCE_RULED_OUT",
      sourceKey: SOURCE_KEYS.reopenA,
      evidenceRef: "evidence:C:ruled-out:reopen-a",
      request: { excludedSourceKeys: [SOURCE_KEYS.reopenA] },
    }),
    traceEvent({
      sequence: 5,
      id: "C-T3B",
      kind: "SOURCE_RULED_OUT",
      sourceKey: SOURCE_KEYS.distractorA,
      evidenceRef: "evidence:C:ruled-out:distractor-a",
      request: {
        excludedSourceKeys: [SOURCE_KEYS.reopenA, SOURCE_KEYS.distractorA],
      },
    }),
    boundary(6, "C-T3"),
    traceEvent({
      sequence: 7,
      id: "C-T4",
      kind: "FAILURE_OBSERVED",
      sourceKey: SOURCE_KEYS.reopenA,
      evidenceRef: "evidence:C:new-failure:reopen-a",
    }),
    traceEvent({
      sequence: 8,
      id: "C-T5",
      kind: "DETAIL_REQUESTED",
      sourceKey: SOURCE_KEYS.reopenA,
      evidenceRef: "evidence:C:detail:reopen-a",
      request: {
        excludedSourceKeys: [SOURCE_KEYS.distractorA],
        currentTargetSourceKeys: [SOURCE_KEYS.target, SOURCE_KEYS.reopenA],
        representationNeeds: [
          {
            sourceKey: SOURCE_KEYS.reopenA,
            preferredKind: "FULL",
            reasonCode: "DETAIL_REQUIRED",
          },
        ],
      },
    }),
    boundary(9, "C-T5-plan"),
    traceEvent({
      sequence: 10,
      id: "C-T6",
      kind: "SOURCE_REFRESH_UNAVAILABLE",
      sourceKey: SOURCE_KEYS.unavailable,
      evidenceRef: "evidence:C:unavailable:revision-mismatch",
      observation: {
        sourceKey: SOURCE_KEYS.unavailable,
        status: "UNAVAILABLE",
        observedAt: "2026-08-14T00:00:00.000Z",
        reasonCode: "REVISION_MISMATCH",
      },
    }),
    boundary(11, "C-T6-plan"),
    traceEvent({
      sequence: 12,
      id: "C-T7",
      kind: "FAILURE_OBSERVED",
      sourceKey: SOURCE_KEYS.newFailure,
      evidenceRef: "evidence:C:new-failure",
      request: {
        excludedSourceKeys: [SOURCE_KEYS.distractorA, SOURCE_KEYS.oldFailure],
        recentEvidenceSourceKeys: [SOURCE_KEYS.newFailure],
        currentTargetSourceKeys: [SOURCE_KEYS.target, SOURCE_KEYS.reopenA],
      },
    }),
    traceEvent({
      sequence: 13,
      id: "C-T7-supersede",
      kind: "SOURCE_SUPERSEDED",
      sourceKey: SOURCE_KEYS.oldFailure,
      evidenceRef: "evidence:C:old-failure-superseded",
    }),
    boundary(14, "C-T7-plan"),
    traceEvent({
      sequence: 15,
      id: "C-T8",
      kind: "BUDGET_PRESSURE",
      request: {
        budget: { maxSemanticTokens: 10 },
        pinnedSourceKeys: [SOURCE_KEYS.target, SOURCE_KEYS.reopenA],
        currentTargetSourceKeys: [SOURCE_KEYS.target, SOURCE_KEYS.reopenA],
      },
    }),
    boundary(16, "C-T8-plan"),
  ],
  oracle: {
    requiredDecisions: [
      {
        kind: "ADD",
        sourceKey: SOURCE_KEYS.target,
        sourceVersionId: sourceVersionId(SOURCE_KEYS.target),
      },
      {
        kind: "ADD",
        sourceKey: SOURCE_KEYS.reopenA,
        sourceVersionId: sourceVersionId(SOURCE_KEYS.reopenA),
      },
      {
        kind: "REMOVE",
        sourceKey: SOURCE_KEYS.reopenA,
        requiredReasonCodes: ["RULED_OUT"],
        sourceVersionId: sourceVersionId(SOURCE_KEYS.reopenA),
      },
      {
        kind: "REHYDRATE",
        sourceKey: SOURCE_KEYS.reopenA,
        requiredAnyReasonCodes: ["NEW_FAILURE_EVIDENCE", "DETAIL_REQUIRED"],
        sourceVersionId: sourceVersionId(SOURCE_KEYS.reopenA),
        representationKind: "FULL",
      },
      {
        kind: "KEEP",
        sourceKey: SOURCE_KEYS.unavailable,
        requiredReasonCodes: ["SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP"],
      },
      {
        kind: "REMOVE",
        sourceKey: SOURCE_KEYS.oldFailure,
        requiredReasonCodes: ["SUPERSEDED"],
        sourceVersionId: sourceVersionId(SOURCE_KEYS.oldFailure),
      },
      {
        kind: "ADD",
        sourceKey: SOURCE_KEYS.newFailure,
        requiredReasonCodes: ["NEW_FAILURE_EVIDENCE"],
        sourceVersionId: sourceVersionId(SOURCE_KEYS.newFailure),
      },
    ],
    requiredActiveSourceKeys: [
      SOURCE_KEYS.task,
      SOURCE_KEYS.target,
      SOURCE_KEYS.reopenA,
    ],
    requiredEventKinds: [
      "SOURCE_RULED_OUT",
      "FAILURE_OBSERVED",
      "DETAIL_REQUESTED",
      "SOURCE_REFRESH_UNAVAILABLE",
      "SOURCE_SUPERSEDED",
      "BUDGET_PRESSURE",
    ],
    protectedSourceKeys: [SOURCE_KEYS.task, SOURCE_KEYS.target],
    unavailableSourceKeys: [SOURCE_KEYS.unavailable],
  },
};
