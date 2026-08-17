import { SOURCE_KEYS, sourceVersionId } from "./common";
import { boundary, traceEvent } from "./events";
import type { LifecycleScenarioFixture } from "./types";

export const wrongPathRecoveryFixture: LifecycleScenarioFixture = {
  id: "S2",
  name: "Wrong-path Recovery",
  events: [
    traceEvent({ sequence: 1, id: "S2-T0", kind: "INITIALIZE_UNIVERSE" }),
    boundary(2, "S2-T1", { currentTargetSourceKeys: [SOURCE_KEYS.reopenA] }),
    traceEvent({
      sequence: 3,
      id: "S2-T2",
      kind: "SOURCE_RULED_OUT",
      sourceKey: SOURCE_KEYS.reopenA,
      evidenceRef: "evidence:S2:ruled-out:reopen-a",
      request: { excludedSourceKeys: [SOURCE_KEYS.reopenA] },
    }),
    boundary(4, "S2-T3"),
    traceEvent({
      sequence: 5,
      id: "S2-T4",
      kind: "FAILURE_OBSERVED",
      sourceKey: SOURCE_KEYS.reopenA,
      evidenceRef: "evidence:S2:failure:reopen-a",
    }),
    traceEvent({
      sequence: 6,
      id: "S2-T5",
      kind: "DETAIL_REQUESTED",
      sourceKey: SOURCE_KEYS.reopenA,
      evidenceRef: "evidence:S2:detail:reopen-a",
      request: {
        excludedSourceKeys: [],
        currentTargetSourceKeys: [SOURCE_KEYS.reopenA],
        representationNeeds: [
          {
            sourceKey: SOURCE_KEYS.reopenA,
            preferredKind: "FULL",
            reasonCode: "DETAIL_REQUIRED",
          },
        ],
      },
    }),
    boundary(7, "S2-T6"),
  ],
  oracle: {
    requiredDecisions: [
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
    ],
    requiredActiveSourceKeys: [SOURCE_KEYS.task, SOURCE_KEYS.reopenA],
    requiredEventKinds: [
      "SOURCE_RULED_OUT",
      "FAILURE_OBSERVED",
      "DETAIL_REQUESTED",
    ],
  },
};
