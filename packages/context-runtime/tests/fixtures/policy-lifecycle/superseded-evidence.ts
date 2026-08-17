import { SOURCE_KEYS, sourceVersionId } from "./common";
import { boundary, traceEvent } from "./events";
import type { LifecycleScenarioFixture } from "./types";

export const supersededEvidenceFixture: LifecycleScenarioFixture = {
  id: "S4",
  name: "Superseded verification evidence",
  events: [
    traceEvent({ sequence: 1, id: "S4-T0", kind: "INITIALIZE_UNIVERSE" }),
    boundary(2, "S4-T1", {
      recentEvidenceSourceKeys: [SOURCE_KEYS.oldFailure],
    }),
    traceEvent({
      sequence: 3,
      id: "S4-T2",
      kind: "FAILURE_OBSERVED",
      sourceKey: SOURCE_KEYS.newFailure,
      evidenceRef: "evidence:S4:new-failure",
      request: {
        excludedSourceKeys: [SOURCE_KEYS.oldFailure],
        recentEvidenceSourceKeys: [SOURCE_KEYS.newFailure],
      },
    }),
    traceEvent({
      sequence: 4,
      id: "S4-T3",
      kind: "SOURCE_SUPERSEDED",
      sourceKey: SOURCE_KEYS.oldFailure,
      evidenceRef: "evidence:S4:old-superseded",
    }),
    boundary(5, "S4-T4"),
  ],
  oracle: {
    requiredDecisions: [
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
    requiredActiveSourceKeys: [SOURCE_KEYS.task, SOURCE_KEYS.newFailure],
    forbiddenActiveSourceKeys: [SOURCE_KEYS.oldFailure],
    requiredEventKinds: ["FAILURE_OBSERVED", "SOURCE_SUPERSEDED"],
  },
};
