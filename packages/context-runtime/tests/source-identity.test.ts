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
  REOPEN_A_V1_LATER,
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
    expect(result.decisions).toHaveLength(0);

    const absentResult = runIdentityTrace({
      id: "LC1-DIRECT-ABSENT",
      events: [
        {
          kind: "OBSERVE",
          id: "A1",
          transitionId: "A1",
          observation: {
            ...unavailableFixture(),
            callId: "read-absent-direct",
            status: "ABSENT" as const,
          },
        },
      ],
    });
    expect(absentResult.observations[0]?.outcome).toBe("CONFIRMED_ABSENT");
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
    assertNoOracleFailures(validateIdentityNegativeCases());
  });

  it("catches each deliberate identity/evidence corruption", () => {
    expect(runIdentityMutationTests()).toEqual([
      { name: "rehydrate-kind", caught: true },
      { name: "wrong-source-version", caught: true },
      { name: "missing-origin", caught: true },
      { name: "invalid-origin", caught: true },
      { name: "reused-origin", caught: true },
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
