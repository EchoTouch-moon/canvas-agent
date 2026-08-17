import { SOURCE_KEYS, sourceVersionId } from "./common";
import { boundary, traceEvent } from "./events";
import type { LifecycleScenarioFixture } from "./types";

export const phaseShiftFixture: LifecycleScenarioFixture = {
  id: "S6",
  name: "Phase shift and detail recovery",
  events: [
    traceEvent({ sequence: 1, id: "S6-T0", kind: "INITIALIZE_UNIVERSE" }),
    boundary(2, "S6-T1", {
      taskPhase: "INVESTIGATE",
      currentTargetSourceKeys: [SOURCE_KEYS.phaseDetail],
      representationNeeds: [
        {
          sourceKey: SOURCE_KEYS.phaseDetail,
          preferredKind: "FULL",
          reasonCode: "DETAIL_REQUIRED",
        },
      ],
    }),
    traceEvent({
      sequence: 3,
      id: "S6-T2",
      kind: "PHASE_CHANGED",
      sourceKey: SOURCE_KEYS.phaseDetail,
      request: {
        taskPhase: "IMPLEMENT",
        excludedSourceKeys: [SOURCE_KEYS.phaseDetail],
        currentTargetSourceKeys: [],
        representationNeeds: [
          {
            sourceKey: SOURCE_KEYS.phaseDetail,
            preferredKind: "REFERENCE",
            reasonCode: "REPRESENTATION_NARROWED",
          },
        ],
      },
    }),
    boundary(4, "S6-T3"),
    traceEvent({
      sequence: 5,
      id: "S6-T4",
      kind: "DETAIL_REQUESTED",
      sourceKey: SOURCE_KEYS.phaseDetail,
      evidenceRef: "evidence:S6:verification-detail",
      request: {
        taskPhase: "VERIFY",
        excludedSourceKeys: [],
        currentTargetSourceKeys: [SOURCE_KEYS.phaseDetail],
        representationNeeds: [
          {
            sourceKey: SOURCE_KEYS.phaseDetail,
            preferredKind: "FULL",
            reasonCode: "DETAIL_REQUIRED",
          },
        ],
      },
    }),
    boundary(6, "S6-T5"),
  ],
  oracle: {
    requiredDecisions: [
      {
        kind: "REMOVE",
        sourceKey: SOURCE_KEYS.phaseDetail,
        requiredReasonCodes: ["PHASE_IRRELEVANT"],
        sourceVersionId: sourceVersionId(SOURCE_KEYS.phaseDetail),
      },
      {
        kind: "REHYDRATE",
        sourceKey: SOURCE_KEYS.phaseDetail,
        requiredReasonCodes: ["DETAIL_REQUIRED"],
        sourceVersionId: sourceVersionId(SOURCE_KEYS.phaseDetail),
        representationKind: "FULL",
      },
    ],
    requiredActiveSourceKeys: [SOURCE_KEYS.task, SOURCE_KEYS.phaseDetail],
    requiredEventKinds: ["PHASE_CHANGED", "DETAIL_REQUESTED"],
  },
};
