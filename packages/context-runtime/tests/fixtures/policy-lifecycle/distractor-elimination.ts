import { SOURCE_KEYS, sourceVersionId } from "./common";
import { boundary, traceEvent } from "./events";
import type { LifecycleScenarioFixture } from "./types";

export const distractorEliminationFixture: LifecycleScenarioFixture = {
  id: "S1",
  name: "Distractor Elimination",
  events: [
    traceEvent({ sequence: 1, id: "S1-T0", kind: "INITIALIZE_UNIVERSE" }),
    boundary(2, "S1-T1", {
      currentTargetSourceKeys: [SOURCE_KEYS.target],
      recentEvidenceSourceKeys: [
        SOURCE_KEYS.distractorA,
        SOURCE_KEYS.distractorB,
      ],
    }),
    traceEvent({
      sequence: 3,
      id: "S1-T2",
      kind: "SOURCE_RULED_OUT",
      sourceKey: SOURCE_KEYS.distractorA,
      evidenceRef: "evidence:S1:ruled-out:distractor-a",
      request: { excludedSourceKeys: [SOURCE_KEYS.distractorA] },
    }),
    boundary(4, "S1-T3"),
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
        sourceKey: SOURCE_KEYS.distractorA,
        sourceVersionId: sourceVersionId(SOURCE_KEYS.distractorA),
      },
      {
        kind: "ADD",
        sourceKey: SOURCE_KEYS.distractorB,
        sourceVersionId: sourceVersionId(SOURCE_KEYS.distractorB),
      },
      {
        kind: "REMOVE",
        sourceKey: SOURCE_KEYS.distractorA,
        requiredReasonCodes: ["RULED_OUT"],
        sourceVersionId: sourceVersionId(SOURCE_KEYS.distractorA),
      },
    ],
    requiredActiveSourceKeys: [
      SOURCE_KEYS.task,
      SOURCE_KEYS.target,
      SOURCE_KEYS.distractorB,
    ],
    forbiddenActiveSourceKeys: [SOURCE_KEYS.distractorA],
    requiredEventKinds: ["SOURCE_RULED_OUT"],
  },
};
