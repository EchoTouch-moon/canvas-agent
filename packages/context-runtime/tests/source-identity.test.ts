import { describe, expect, it } from "vitest";
import {
  decisionFor,
  instanceIdFor,
  normalizeSourcePath,
  runIdentityTrace,
  sourceVersionFor,
  subjectFor,
} from "./fixtures/source-identity/candidate";
import {
  assertNoOracleFailures,
  LC1_COMPOSITE_TRACE,
  REOPEN_A,
  REOPEN_A_DOT_PATH,
  REOPEN_A_V1,
  REOPEN_A_V1_LATER,
  REOPEN_A_V2,
  OTHER_NAMESPACE_REOPEN_A,
  OTHER_REPOSITORY_REOPEN_A,
  runIdentityMutationTests,
  unavailableFixture,
  validateCompositeOracle,
  validateIdentityCaseTable,
  validateIdentityNegativeCases,
  validateUnavailableConservatism,
} from "./fixtures/source-identity/oracle";

describe("CR-004 LC1 logical source identity candidate oracle", () => {
  it("passes the complete ADD → KEEP → REMOVE → cold → REHYDRATE → KEEP chain", () => {
    const result = runIdentityTrace(LC1_COMPOSITE_TRACE);

    assertNoOracleFailures(
      validateCompositeOracle(LC1_COMPOSITE_TRACE, result),
    );
    expect(result.decisions.map((decision) => decision.kind)).toEqual([
      "ADD",
      "KEEP",
      "REMOVE",
      "REHYDRATE",
      "KEEP",
    ]);
    expect(result.coldEvidence).toHaveLength(1);
    expect(result.activeEvidence).toHaveLength(1);
    expect(result.coldEvidence[0]?.evidenceInstanceId).toBe(
      instanceIdFor({
        ...REOPEN_A,
        callId: "read-1",
        contentHash: "hash-reopen-a-v1",
        universeRevision: "universe:r1",
        status: "AVAILABLE",
        representationKind: "REFERENCE",
      }),
    );
    expect(decisionFor(result, "T4-LATER-NEED")?.representationKind).toBe(
      "FULL",
    );
  });

  it("separates logical subject, SourceVersion, and evidence-instance identity", () => {
    expect(subjectFor(REOPEN_A).subjectKey).toBe(
      subjectFor(REOPEN_A_DOT_PATH).subjectKey,
    );
    expect(
      sourceVersionFor({
        ...REOPEN_A,
        callId: "read-1",
        contentHash: "hash-reopen-a-v1",
        universeRevision: "universe:r1",
        status: "AVAILABLE",
        representationKind: "REFERENCE",
      }).versionId,
    ).toBe(
      sourceVersionFor({
        ...REOPEN_A_DOT_PATH,
        callId: "read-2",
        contentHash: "hash-reopen-a-v1",
        universeRevision: "universe:r1",
        status: "AVAILABLE",
        representationKind: "FULL",
      }).versionId,
    );
    expect(
      instanceIdFor({
        ...REOPEN_A,
        callId: "read-1",
        contentHash: "hash-reopen-a-v1",
        universeRevision: "universe:r1",
        status: "AVAILABLE",
        representationKind: "REFERENCE",
      }),
    ).not.toBe(instanceIdFor(REOPEN_A_V1_LATER));
  });

  it("does not treat changed content or a new Universe revision as rehydration of v1", () => {
    const first = {
      ...REOPEN_A,
      callId: "version-read-1",
      contentHash: "hash-reopen-a-v1",
      universeRevision: "universe:r1",
      status: "AVAILABLE" as const,
      representationKind: "REFERENCE" as const,
    };
    const changed = {
      ...first,
      callId: "version-read-2",
      contentHash: "hash-reopen-a-v2",
      universeRevision: "universe:r2",
    };
    const result = runIdentityTrace({
      id: "LC1-VERSION-BOUNDARY",
      events: [
        { kind: "OBSERVE", id: "V1", transitionId: "V1", observation: first },
        {
          kind: "REMOVE",
          id: "V2",
          transitionId: "V2",
          evidenceInstanceId: instanceIdFor(first),
          reasonCodes: ["RULED_OUT"],
        },
        { kind: "OBSERVE", id: "V3", transitionId: "V3", observation: changed },
      ],
    });
    const decision = decisionFor(result, "V3");
    expect(decision?.kind).toBe("ADD");
    expect(decision?.sourceVersionId).toBe(sourceVersionFor(changed).versionId);
    expect(decision?.sourceVersionId).not.toBe(
      sourceVersionFor(first).versionId,
    );

    const sameContentNewRevision = {
      ...first,
      callId: "version-read-3",
      universeRevision: "universe:r2",
    };
    const revisionResult = runIdentityTrace({
      id: "LC1-REVISION-BOUNDARY",
      events: [
        { kind: "OBSERVE", id: "R1", transitionId: "R1", observation: first },
        {
          kind: "REMOVE",
          id: "R2",
          transitionId: "R2",
          evidenceInstanceId: instanceIdFor(first),
          reasonCodes: ["RULED_OUT"],
        },
        {
          kind: "OBSERVE",
          id: "R3",
          transitionId: "R3",
          observation: sameContentNewRevision,
        },
      ],
    });
    const revisionDecision = decisionFor(revisionResult, "R3");
    expect(revisionDecision?.kind).toBe("ADD");
    expect(revisionDecision?.sourceVersionId).toBe(
      sourceVersionFor(sameContentNewRevision).versionId,
    );
    expect(revisionDecision?.sourceVersionId).not.toBe(
      sourceVersionFor(first).versionId,
    );
  });

  it("keeps unavailable evidence conservative and never infers absence or rehydration", () => {
    assertNoOracleFailures(validateUnavailableConservatism());
    const result = runIdentityTrace({
      id: "LC1-DIRECT-UNAVAILABLE",
      events: [
        {
          kind: "OBSERVE",
          id: "U1",
          transitionId: "U1",
          observation: unavailableFixture(),
        },
      ],
    });
    expect(result.observations[0]?.outcome).toBe("CONSERVATIVE_KEEP");
    expect(result.observations[0]?.sourceVersionId).toBeNull();
    expect(result.decisions).toHaveLength(0);

    const absentResult = runIdentityTrace({
      id: "LC1-DIRECT-ABSENT",
      events: [
        {
          kind: "OBSERVE",
          id: "A1",
          transitionId: "A1",
          observation: {
            ...REOPEN_A,
            callId: "read-absent-direct",
            universeRevision: "universe:r1",
            status: "ABSENT" as const,
            representationKind: "REFERENCE" as const,
          },
        },
      ],
    });
    expect(absentResult.observations[0]?.outcome).toBe("CONFIRMED_ABSENT");
    expect(absentResult.observations[0]?.sourceVersionId).toBeNull();
    expect(absentResult.decisions).toHaveLength(0);
  });

  it("keeps repository and namespace boundaries explicit", () => {
    assertNoOracleFailures(validateIdentityCaseTable());
    expect(() => normalizeSourcePath("/absolute/file.ts")).toThrow(
      "repository-relative",
    );
    expect(() => normalizeSourcePath("../../escape.ts")).toThrow(
      "escapes repository root",
    );
  });

  it("does not cross-link a removal across repositories or namespaces", () => {
    const otherRepository = {
      ...OTHER_REPOSITORY_REOPEN_A,
      callId: "other-repository-read",
      contentHash: REOPEN_A_V1.contentHash,
      universeRevision: REOPEN_A_V1.universeRevision,
      status: "AVAILABLE" as const,
      representationKind: "REFERENCE" as const,
    };
    const otherNamespace = {
      ...OTHER_NAMESPACE_REOPEN_A,
      callId: "other-namespace-read",
      contentHash: REOPEN_A_V1.contentHash,
      universeRevision: REOPEN_A_V1.universeRevision,
      status: "AVAILABLE" as const,
      representationKind: "REFERENCE" as const,
    };
    const result = runIdentityTrace({
      id: "LC1-SUBJECT-ISOLATION",
      events: [
        {
          kind: "OBSERVE",
          id: "I1",
          transitionId: "I1",
          observation: REOPEN_A_V1,
        },
        {
          kind: "REMOVE",
          id: "I2",
          transitionId: "I2",
          evidenceInstanceId: instanceIdFor(REOPEN_A_V1),
          reasonCodes: ["RULED_OUT"],
        },
        {
          kind: "OBSERVE",
          id: "I3",
          transitionId: "I3",
          observation: otherRepository,
        },
        {
          kind: "OBSERVE",
          id: "I4",
          transitionId: "I4",
          observation: otherNamespace,
        },
      ],
    });
    expect(result.decisions.map((decision) => decision.kind)).toEqual([
      "ADD",
      "REMOVE",
      "ADD",
      "ADD",
    ]);
    expect(
      result.decisions
        .slice(2)
        .every((decision) => decision.originatingRemoveTransitionId === null),
    ).toBe(true);
  });

  it("supports two valid lifecycle cycles without reusing an origin or resurrecting cold evidence", () => {
    const thirdRead = {
      ...REOPEN_A_V1_LATER,
      callId: "read-3-cycle",
    };
    const result = runIdentityTrace({
      id: "LC1-REPEATED-LIFECYCLE",
      events: [
        {
          kind: "OBSERVE",
          id: "C1-ADD",
          transitionId: "C1",
          observation: REOPEN_A_V1,
        },
        {
          kind: "REMOVE",
          id: "C2-REMOVE",
          transitionId: "C2",
          evidenceInstanceId: instanceIdFor(REOPEN_A_V1),
          reasonCodes: ["RULED_OUT"],
        },
        {
          kind: "OBSERVE",
          id: "C3-REHYDRATE",
          transitionId: "C3",
          observation: REOPEN_A_V1_LATER,
        },
        {
          kind: "REMOVE",
          id: "C4-REMOVE",
          transitionId: "C4",
          evidenceInstanceId: instanceIdFor(REOPEN_A_V1_LATER),
          reasonCodes: ["PHASE_IRRELEVANT"],
        },
        {
          kind: "OBSERVE",
          id: "C5-REHYDRATE",
          transitionId: "C5",
          observation: thirdRead,
        },
      ],
    });
    expect(result.decisions.map((decision) => decision.kind)).toEqual([
      "ADD",
      "REMOVE",
      "REHYDRATE",
      "REMOVE",
      "REHYDRATE",
    ]);
    expect(
      result.decisions
        .filter((decision) => decision.kind === "REHYDRATE")
        .map((decision) => decision.originatingRemoveTransitionId),
    ).toEqual(["C2", "C4"]);
    expect(result.coldEvidence).toHaveLength(2);
    expect(result.activeEvidence).toHaveLength(1);
    expect(result.activeEvidence[0]?.evidenceInstanceId).toBe(
      instanceIdFor(thirdRead),
    );
    expect(
      result.removals.map((removal) => removal.consumedByTransitionId),
    ).toEqual(["C3", "C5"]);
  });

  it("rejects tool-call id remapping, cold-call reuse, and protected eviction", () => {
    const first = {
      ...REOPEN_A,
      callId: "call-reused",
      contentHash: "hash-reopen-a-v1",
      universeRevision: "universe:r1",
      status: "AVAILABLE" as const,
      representationKind: "REFERENCE" as const,
    };
    expect(() =>
      runIdentityTrace({
        id: "LC1-CALL-ID-REUSE",
        events: [
          { kind: "OBSERVE", id: "R1", transitionId: "R1", observation: first },
          {
            kind: "OBSERVE",
            id: "R2",
            transitionId: "R2",
            observation: { ...first, path: "src/other.ts" },
          },
        ],
      }),
    ).toThrow("tool call id remapped");
    expect(() =>
      runIdentityTrace({
        id: "LC1-EMPTY-REMOVE-REASON",
        events: [
          {
            kind: "OBSERVE",
            id: "E1",
            transitionId: "E1",
            observation: REOPEN_A_V1,
          },
          {
            kind: "REMOVE",
            id: "E2",
            transitionId: "E2",
            evidenceInstanceId: instanceIdFor(REOPEN_A_V1),
            reasonCodes: [],
          },
        ],
      }),
    ).toThrow("REMOVE requires a reason");
    assertNoOracleFailures(validateIdentityNegativeCases());
  });

  it("catches each deliberate identity/evidence corruption", () => {
    expect(runIdentityMutationTests()).toEqual([
      { name: "rehydrate-kind", caught: true },
      { name: "wrong-source-version", caught: true },
      { name: "missing-origin", caught: true },
      { name: "invalid-origin", caught: true },
      { name: "reused-origin", caught: true },
      { name: "wrong-representation", caught: true },
      { name: "changed-content-same-version", caught: true },
      { name: "protected-eviction", caught: true },
      { name: "unavailable-absence", caught: true },
    ]);
  });

  it("replays the same normalized trace to identical transition and trace hashes", () => {
    const first = runIdentityTrace(LC1_COMPOSITE_TRACE);
    const second = runIdentityTrace(LC1_COMPOSITE_TRACE);
    expect(second.transitionHashes).toEqual(first.transitionHashes);
    expect(second.traceHash).toBe(first.traceHash);
  });
});
