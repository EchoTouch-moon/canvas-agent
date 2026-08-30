import {
  decisionFor,
  instanceIdFor,
  runIdentityTrace,
  sourceVersionFor,
  subjectFor,
} from "./candidate";
import type {
  CandidateEvidenceInput,
  IdentityDecision,
  IdentityTrace,
  IdentityTraceResult,
  LogicalSourceInput,
} from "./types";

type AvailableEvidenceInput = Extract<
  CandidateEvidenceInput,
  { readonly status: "AVAILABLE" }
>;

export const REPOSITORY = "synthetic-repo";
export const NAMESPACE = "repository-file";

export const REOPEN_A: LogicalSourceInput = {
  repositoryId: REPOSITORY,
  namespace: NAMESPACE,
  path: "src/reopen-a.ts",
};

export const REOPEN_A_DOT_PATH: LogicalSourceInput = {
  ...REOPEN_A,
  path: "./src\\reopen-a.ts",
};

export const OTHER_REPOSITORY_REOPEN_A: LogicalSourceInput = {
  ...REOPEN_A,
  repositoryId: "other-repo",
};

export const OTHER_NAMESPACE_REOPEN_A: LogicalSourceInput = {
  ...REOPEN_A,
  namespace: "task-attachment",
};

export const PROTECTED_SPEC: LogicalSourceInput = {
  repositoryId: REPOSITORY,
  namespace: "task-spec",
  path: "spec/task.md",
};

const REOPEN_A_V1: AvailableEvidenceInput = {
  ...REOPEN_A,
  callId: "read-1",
  contentHash: "hash-reopen-a-v1",
  universeRevision: "universe:r1",
  status: "AVAILABLE",
  representationKind: "REFERENCE",
};

export const REOPEN_A_V1_LATER: AvailableEvidenceInput = {
  ...REOPEN_A_V1,
  callId: "read-2",
  representationKind: "FULL",
};

const REOPEN_A_V2: AvailableEvidenceInput = {
  ...REOPEN_A_V1_LATER,
  callId: "read-3",
  contentHash: "hash-reopen-a-v2",
};

const UNAVAILABLE_REOPEN_A: CandidateEvidenceInput = {
  ...REOPEN_A,
  callId: "read-unavailable",
  universeRevision: "universe:r1",
  status: "UNAVAILABLE",
  representationKind: "FULL",
  unavailableReason: "REVISION_MISMATCH",
};

export const LC1_COMPOSITE_TRACE: IdentityTrace = {
  id: "LC1-COMPOSITE-REMOVE-REHYDRATE",
  events: [
    {
      kind: "OBSERVE",
      id: "T1-ADD",
      transitionId: "T1",
      observation: REOPEN_A_V1,
    },
    {
      kind: "KEEP",
      id: "T2-KEEP",
      transitionId: "T2",
      evidenceInstanceId: instanceIdFor(REOPEN_A_V1),
    },
    {
      kind: "REMOVE",
      id: "T3-REMOVE",
      transitionId: "T3",
      evidenceInstanceId: instanceIdFor(REOPEN_A_V1),
      reasonCodes: ["RULED_OUT"],
    },
    {
      kind: "OBSERVE",
      id: "T4-LATER-NEED",
      transitionId: "T4",
      observation: REOPEN_A_V1_LATER,
    },
    {
      kind: "KEEP",
      id: "T5-KEEP-FULL",
      transitionId: "T5",
      evidenceInstanceId: instanceIdFor(REOPEN_A_V1_LATER),
    },
  ],
};

export interface IdentityOracleFailure {
  readonly eventId: string;
  readonly message: string;
}

function decisionAt(
  result: IdentityTraceResult,
  eventId: string,
): IdentityDecision {
  const decision = decisionFor(result, eventId);
  if (decision === undefined)
    throw new Error(`missing decision for ${eventId}`);
  return decision;
}

export function validateCompositeOracle(
  trace: IdentityTrace,
  result: IdentityTraceResult,
): readonly IdentityOracleFailure[] {
  const failures: IdentityOracleFailure[] = [];
  const initial = decisionFor(result, "T1-ADD");
  const remove = decisionFor(result, "T3-REMOVE");
  const rehydrate = decisionFor(result, "T4-LATER-NEED");
  const finalKeep = decisionFor(result, "T5-KEEP-FULL");
  if (initial?.kind !== "ADD") {
    failures.push({
      eventId: "T1-ADD",
      message: "initial evidence must be ADD",
    });
  }
  if (remove?.kind !== "REMOVE") {
    failures.push({
      eventId: "T3-REMOVE",
      message: "active evidence must be REMOVE",
    });
  }
  if (rehydrate?.kind !== "REHYDRATE") {
    failures.push({
      eventId: "T4-LATER-NEED",
      message: "later same-version evidence must be REHYDRATE",
    });
  }
  if (remove !== undefined && rehydrate !== undefined) {
    if (initial !== undefined && remove.subjectKey !== initial.subjectKey) {
      failures.push({
        eventId: "T3-REMOVE",
        message: "REMOVE must target the active logical source subject",
      });
    }
    if (
      initial !== undefined &&
      remove.sourceVersionId !== initial.sourceVersionId
    ) {
      failures.push({
        eventId: "T3-REMOVE",
        message: "REMOVE must target the active SourceVersion",
      });
    }
    if (rehydrate.originatingRemoveTransitionId !== remove.transitionId) {
      failures.push({
        eventId: "T4-LATER-NEED",
        message: "REHYDRATE must retain exact originating REMOVE",
      });
    }
    if (rehydrate.sourceVersionId !== remove.sourceVersionId) {
      failures.push({
        eventId: "T4-LATER-NEED",
        message: "REHYDRATE must use the removed SourceVersion",
      });
    }
  }
  const expectedVersion = sourceVersionFor(REOPEN_A_V1_LATER).versionId;
  if (
    rehydrate !== undefined &&
    !(
      rehydrate.sourceVersionId === expectedVersion &&
      rehydrate.representationKind === "FULL"
    )
  ) {
    failures.push({
      eventId: "T4-LATER-NEED",
      message: "REHYDRATE must bind exact v1 and FULL representation",
    });
  }
  if (finalKeep?.kind !== "KEEP") {
    failures.push({
      eventId: "T5-KEEP-FULL",
      message: "rehydrated evidence must remain active",
    });
  }
  const rehydrateOrigins = result.decisions
    .filter((decision) => decision.kind === "REHYDRATE")
    .map((decision) => decision.originatingRemoveTransitionId)
    .filter((origin): origin is string => origin !== null);
  for (const origin of new Set(rehydrateOrigins)) {
    if (
      rehydrateOrigins.filter((candidate) => candidate === origin).length > 1
    ) {
      failures.push({
        eventId: "T4-LATER-NEED",
        message: "one REMOVE must be consumed exactly once",
      });
    }
  }
  const coldIds = new Set(
    result.coldEvidence.map((evidence) => evidence.evidenceInstanceId),
  );
  const activeIds = new Set(
    result.activeEvidence.map((evidence) => evidence.evidenceInstanceId),
  );
  const oldId = instanceIdFor(REOPEN_A_V1);
  const laterId = instanceIdFor(REOPEN_A_V1_LATER);
  if (!coldIds.has(oldId)) {
    failures.push({
      eventId: "T3-REMOVE",
      message: "old evidence instance must stay cold",
    });
  }
  if (!activeIds.has(laterId)) {
    failures.push({
      eventId: "T4-LATER-NEED",
      message: "new evidence instance must be active",
    });
  }
  if (trace.id !== LC1_COMPOSITE_TRACE.id) {
    failures.push({
      eventId: trace.id,
      message: "unexpected composite fixture identity",
    });
  }
  return failures;
}

export function validateIdentityTrace(
  trace: IdentityTrace,
  result: IdentityTraceResult,
): readonly IdentityOracleFailure[] {
  const failures = [...validateCompositeOracle(trace, result)];
  const uniqueCallIds = new Set<string>();
  for (const event of trace.events) {
    if (event.kind !== "OBSERVE") continue;
    if (uniqueCallIds.has(event.observation.callId)) {
      failures.push({
        eventId: event.id,
        message: `duplicate tool call id: ${event.observation.callId}`,
      });
    }
    uniqueCallIds.add(event.observation.callId);
  }
  return failures;
}

export interface MutationCheck {
  readonly name: string;
  readonly caught: boolean;
}

function withDecisionMutation(
  result: IdentityTraceResult,
  eventId: string,
  mutate: (decision: IdentityDecision) => IdentityDecision,
): IdentityTraceResult {
  return {
    ...result,
    decisions: result.decisions.map((decision) =>
      decision.eventId === eventId ? mutate(decision) : decision,
    ),
  };
}

export function runIdentityMutationTests(): readonly MutationCheck[] {
  const baseline = runIdentityTrace(LC1_COMPOSITE_TRACE);
  const remove = decisionAt(baseline, "T3-REMOVE");
  const mutations: readonly {
    readonly name: string;
    readonly mutated: IdentityTraceResult;
    readonly expectedMessage: string;
  }[] = [
    {
      name: "rehydrate-kind",
      mutated: withDecisionMutation(baseline, "T4-LATER-NEED", (decision) => ({
        ...decision,
        kind: "ADD",
        originatingRemoveTransitionId: null,
      })),
      expectedMessage: "later same-version evidence must be REHYDRATE",
    },
    {
      name: "wrong-source-version",
      mutated: withDecisionMutation(baseline, "T4-LATER-NEED", (decision) => ({
        ...decision,
        sourceVersionId: sourceVersionFor(REOPEN_A_V2).versionId,
      })),
      expectedMessage: "REHYDRATE must use the removed SourceVersion",
    },
    {
      name: "missing-origin",
      mutated: withDecisionMutation(baseline, "T4-LATER-NEED", (decision) => ({
        ...decision,
        originatingRemoveTransitionId: null,
      })),
      expectedMessage: "REHYDRATE must retain exact originating REMOVE",
    },
    {
      name: "invalid-origin",
      mutated: withDecisionMutation(baseline, "T4-LATER-NEED", (decision) => ({
        ...decision,
        originatingRemoveTransitionId: "T99-NOT-A-REMOVE",
      })),
      expectedMessage: "REHYDRATE must retain exact originating REMOVE",
    },
    {
      name: "reused-origin",
      mutated: withDecisionMutation(baseline, "T5-KEEP-FULL", (decision) => ({
        ...decision,
        kind: "REHYDRATE",
        originatingRemoveTransitionId: remove.transitionId,
      })),
      expectedMessage: "one REMOVE must be consumed exactly once",
    },
    {
      name: "changed-content-same-version",
      mutated: withDecisionMutation(baseline, "T4-LATER-NEED", (decision) => ({
        ...decision,
        sourceVersionId: sourceVersionFor(REOPEN_A_V2).versionId,
      })),
      expectedMessage: "REHYDRATE must bind exact v1 and FULL representation",
    },
  ];
  const checks = mutations.map((mutation) => ({
    name: mutation.name,
    caught: validateIdentityTrace(LC1_COMPOSITE_TRACE, mutation.mutated).some(
      (failure) => failure.message === mutation.expectedMessage,
    ),
  }));
  let protectedCaught = false;
  try {
    runIdentityTrace({
      id: "LC1-PROTECTED-MUTATION",
      events: [
        { kind: "PROTECT", id: "P0", source: REOPEN_A },
        {
          kind: "OBSERVE",
          id: "P1",
          transitionId: "P1",
          observation: REOPEN_A_V1,
        },
        {
          kind: "REMOVE",
          id: "P2",
          transitionId: "P2",
          evidenceInstanceId: instanceIdFor(REOPEN_A_V1),
          reasonCodes: ["BUDGET_PRESSURE"],
        },
      ],
    });
  } catch {
    protectedCaught = true;
  }
  checks.push({ name: "protected-eviction", caught: protectedCaught });

  const unavailableBaseline = runIdentityTrace(unavailableTrace());
  const unavailableMutation: IdentityTraceResult = {
    ...unavailableBaseline,
    observations: unavailableBaseline.observations.map((observation) => ({
      ...observation,
      outcome: "CONFIRMED_ABSENT",
    })),
  };
  checks.push({
    name: "unavailable-absence",
    caught: validateUnavailableResult(unavailableMutation).some(
      (failure) => failure.message === "UNAVAILABLE must remain conservative",
    ),
  });
  return checks;
}

function unavailableTrace(): IdentityTrace {
  return {
    id: "LC1-UNAVAILABLE",
    events: [
      {
        kind: "OBSERVE",
        id: "U1",
        transitionId: "U1",
        observation: REOPEN_A_V1,
      },
      {
        kind: "REMOVE",
        id: "U2",
        transitionId: "U2",
        evidenceInstanceId: instanceIdFor(REOPEN_A_V1),
        reasonCodes: ["RULED_OUT"],
      },
      {
        kind: "OBSERVE",
        id: "U3",
        transitionId: "U3",
        observation: UNAVAILABLE_REOPEN_A,
      },
    ],
  };
}

export function validateUnavailableResult(
  result: IdentityTraceResult,
): readonly IdentityOracleFailure[] {
  const failures: IdentityOracleFailure[] = [];
  const unavailable = result.observations.find(
    (observation) => observation.eventId === "U3",
  );
  if (unavailable?.outcome !== "CONSERVATIVE_KEEP") {
    failures.push({
      eventId: "U3",
      message: "UNAVAILABLE must remain conservative",
    });
  }
  if (result.decisions.some((decision) => decision.eventId === "U3")) {
    failures.push({
      eventId: "U3",
      message: "UNAVAILABLE must not infer ADD/REHYDRATE",
    });
  }
  return failures;
}

export function validateUnavailableConservatism(): readonly IdentityOracleFailure[] {
  return validateUnavailableResult(runIdentityTrace(unavailableTrace()));
}

export function validateIdentityNegativeCases(): readonly IdentityOracleFailure[] {
  const failures: IdentityOracleFailure[] = [];
  const noRemoval: IdentityTrace = {
    id: "LC1-NO-REMOVE",
    events: [
      {
        kind: "OBSERVE",
        id: "N1",
        transitionId: "N1",
        observation: REOPEN_A_V1,
      },
      {
        kind: "OBSERVE",
        id: "N2",
        transitionId: "N2",
        observation: REOPEN_A_V1_LATER,
      },
    ],
  };
  const noRemovalResult = runIdentityTrace(noRemoval);
  if (decisionAt(noRemovalResult, "N2").kind !== "ADD") {
    failures.push({
      eventId: "N2",
      message: "new evidence without REMOVE must be ADD",
    });
  }

  const coldCallReuse: IdentityTrace = {
    id: "LC1-COLD-CALL-REUSE",
    events: [
      {
        kind: "OBSERVE",
        id: "C1",
        transitionId: "C1",
        observation: REOPEN_A_V1,
      },
      {
        kind: "REMOVE",
        id: "C2",
        transitionId: "C2",
        evidenceInstanceId: instanceIdFor(REOPEN_A_V1),
        reasonCodes: ["RULED_OUT"],
      },
      {
        kind: "OBSERVE",
        id: "C3",
        transitionId: "C3",
        observation: REOPEN_A_V1,
      },
    ],
  };
  try {
    runIdentityTrace(coldCallReuse);
    failures.push({
      eventId: "C3",
      message: "cold evidence must require a new tool call id",
    });
  } catch {
    // Expected hard failure: reusing a cold call id would resurrect old evidence.
  }

  const changedVersionTrace: IdentityTrace = {
    id: "LC1-CHANGED-VERSION",
    events: [
      {
        kind: "OBSERVE",
        id: "V1",
        transitionId: "V1",
        observation: REOPEN_A_V1,
      },
      {
        kind: "REMOVE",
        id: "V2",
        transitionId: "V2",
        evidenceInstanceId: instanceIdFor(REOPEN_A_V1),
        reasonCodes: ["RULED_OUT"],
      },
      {
        kind: "OBSERVE",
        id: "V3",
        transitionId: "V3",
        observation: REOPEN_A_V2,
      },
    ],
  };
  const changedVersionResult = runIdentityTrace(changedVersionTrace);
  const changed = decisionAt(changedVersionResult, "V3");
  if (
    changed.kind !== "ADD" ||
    changed.sourceVersionId === sourceVersionFor(REOPEN_A_V1).versionId
  ) {
    failures.push({
      eventId: "V3",
      message: "changed content must create a new ADD version",
    });
  }

  const protectedTrace: IdentityTrace = {
    id: "LC1-PROTECTED",
    events: [
      { kind: "PROTECT", id: "P0", source: PROTECTED_SPEC },
      {
        kind: "OBSERVE",
        id: "P1",
        transitionId: "P1",
        observation: {
          ...REOPEN_A_V1,
          ...PROTECTED_SPEC,
          callId: "protected-read",
        },
      },
    ],
  };
  const protectedResult = runIdentityTrace(protectedTrace);
  const protectedEvidenceId = instanceIdFor({
    ...REOPEN_A_V1,
    ...PROTECTED_SPEC,
    callId: "protected-read",
  });
  try {
    const mapperTrace: IdentityTrace = {
      ...protectedTrace,
      events: [
        ...protectedTrace.events,
        {
          kind: "REMOVE",
          id: "P2",
          transitionId: "P2",
          evidenceInstanceId: protectedEvidenceId,
          reasonCodes: ["BUDGET_PRESSURE"],
        },
      ],
    };
    runIdentityTrace(mapperTrace);
    failures.push({
      eventId: "P2",
      message: "protected source removal must fail closed",
    });
  } catch {
    // Expected hard failure: protected identity cannot be evicted.
  }
  if (protectedResult.activeEvidence.length !== 1) {
    failures.push({
      eventId: "P1",
      message: "protected evidence must remain active",
    });
  }
  return failures;
}

export function validateIdentityCaseTable(): readonly IdentityOracleFailure[] {
  const failures: IdentityOracleFailure[] = [];
  const equivalent =
    subjectFor(REOPEN_A).subjectKey ===
    subjectFor(REOPEN_A_DOT_PATH).subjectKey;
  if (!equivalent) {
    failures.push({
      eventId: "PATH-NORMALIZATION",
      message: "equivalent path spelling must map to one subject",
    });
  }
  if (
    subjectFor(REOPEN_A).subjectKey ===
    subjectFor(OTHER_REPOSITORY_REOPEN_A).subjectKey
  ) {
    failures.push({
      eventId: "REPOSITORY-SEPARATION",
      message: "repository must be part of subject identity",
    });
  }
  if (
    subjectFor(REOPEN_A).subjectKey ===
    subjectFor(OTHER_NAMESPACE_REOPEN_A).subjectKey
  ) {
    failures.push({
      eventId: "NAMESPACE-SEPARATION",
      message: "namespace must be part of subject identity",
    });
  }
  return failures;
}

export function assertNoOracleFailures(
  failures: readonly IdentityOracleFailure[],
): void {
  if (failures.length > 0) {
    throw new Error(
      failures
        .map((failure) => `${failure.eventId}: ${failure.message}`)
        .join("; "),
    );
  }
}

export function unavailableFixture(): CandidateEvidenceInput {
  return {
    ...REOPEN_A,
    callId: "read-unavailable-direct",
    universeRevision: "universe:r1",
    status: "UNAVAILABLE",
    representationKind: "REFERENCE",
    unavailableReason: "REVISION_MISMATCH",
  };
}
