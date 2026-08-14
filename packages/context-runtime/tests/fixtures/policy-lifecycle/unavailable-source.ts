import { SOURCE_KEYS } from "./common";
import { boundary, traceEvent } from "./events";
import { TRACE_TIMESTAMP } from "./types";
import type { LifecycleScenarioFixture } from "./types";

export const unavailableSourceFixture: LifecycleScenarioFixture = {
  id: "S5",
  name: "Unavailable source / conservative keep",
  events: [
    traceEvent({ sequence: 1, id: "S5-T0", kind: "INITIALIZE_UNIVERSE" }),
    boundary(2, "S5-T1", {
      recentEvidenceSourceKeys: [SOURCE_KEYS.unavailable],
    }),
    traceEvent({
      sequence: 3,
      id: "S5-T2",
      kind: "SOURCE_REFRESH_UNAVAILABLE",
      sourceKey: SOURCE_KEYS.unavailable,
      evidenceRef: "evidence:S5:revision-mismatch",
      observation: {
        sourceKey: SOURCE_KEYS.unavailable,
        status: "UNAVAILABLE",
        observedAt: TRACE_TIMESTAMP,
        reasonCode: "REVISION_MISMATCH",
      },
    }),
    boundary(4, "S5-T3"),
  ],
  oracle: {
    requiredDecisions: [
      {
        kind: "KEEP",
        sourceKey: SOURCE_KEYS.unavailable,
        requiredReasonCodes: ["SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP"],
      },
    ],
    requiredActiveSourceKeys: [SOURCE_KEYS.task, SOURCE_KEYS.unavailable],
    requiredEventKinds: ["SOURCE_REFRESH_UNAVAILABLE"],
    unavailableSourceKeys: [SOURCE_KEYS.unavailable],
  },
};
