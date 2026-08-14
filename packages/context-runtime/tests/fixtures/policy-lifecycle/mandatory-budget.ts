import { SOURCE_KEYS } from "./common";
import { boundary, traceEvent } from "./events";
import type { LifecycleScenarioFixture } from "./types";

export const mandatoryBudgetFixture: LifecycleScenarioFixture = {
  id: "S3",
  name: "Mandatory instruction under budget pressure",
  events: [
    traceEvent({ sequence: 1, id: "S3-T0", kind: "INITIALIZE_UNIVERSE" }),
    boundary(2, "S3-T1", {
      budget: { maxSemanticTokens: 1000 },
      pinnedSourceKeys: [SOURCE_KEYS.target],
      currentTargetSourceKeys: [SOURCE_KEYS.target],
      recentEvidenceSourceKeys: [
        SOURCE_KEYS.distractorA,
        SOURCE_KEYS.distractorB,
      ],
    }),
    traceEvent({
      sequence: 3,
      id: "S3-T2",
      kind: "BUDGET_PRESSURE",
      request: { budget: { maxSemanticTokens: 10 } },
    }),
    boundary(4, "S3-T3"),
  ],
  oracle: {
    requiredDecisions: [
      {
        kind: "REMOVE",
        sourceKey: SOURCE_KEYS.distractorA,
        requiredReasonCodes: ["BUDGET_PRESSURE"],
      },
    ],
    requiredActiveSourceKeys: [SOURCE_KEYS.task, SOURCE_KEYS.target],
    protectedSourceKeys: [SOURCE_KEYS.task, SOURCE_KEYS.target],
    requiredEventKinds: ["BUDGET_PRESSURE"],
  },
};
