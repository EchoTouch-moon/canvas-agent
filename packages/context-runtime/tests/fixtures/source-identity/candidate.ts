import { sha256Hex } from "../../../src";
import type {
  CandidateEvidenceInput,
  CandidateSourceVersion,
  ConservativeObservation,
  EvidenceInstance,
  IdentityDecision,
  IdentityRepresentationKind,
  IdentityTrace,
  IdentityTraceResult,
  LogicalSourceInput,
  LogicalSourceSubject,
  RemovalRelation,
  SourceVersionInput,
} from "./types";

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label} must not be empty`);
  return trimmed;
}

export function normalizeSourcePath(path: string): string {
  const raw = nonEmpty(path, "source path").replaceAll("\\", "/");
  if (raw.startsWith("/"))
    throw new Error("source path must be repository-relative");

  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0)
        throw new Error("source path escapes repository root");
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) throw new Error("source path resolves to empty");
  return segments.join("/");
}

export function logicalSourceSubject(
  input: LogicalSourceInput,
): LogicalSourceSubject {
  const repositoryId = nonEmpty(input.repositoryId, "repository id");
  const namespace = nonEmpty(input.namespace, "source namespace");
  const normalizedPath = normalizeSourcePath(input.path);
  const subjectKey = `source-subject:v1:${sha256Hex(
    canonicalJson({ repositoryId, namespace, normalizedPath }),
  )}`;
  return { repositoryId, namespace, normalizedPath, subjectKey };
}

export function candidateSourceVersion(
  subject: LogicalSourceSubject,
  input: SourceVersionInput,
): CandidateSourceVersion {
  const contentHash = nonEmpty(input.contentHash, "content hash");
  const universeRevision = nonEmpty(
    input.universeRevision,
    "Universe revision",
  );
  const versionId = `source-version:v1:${sha256Hex(
    canonicalJson({
      subjectKey: subject.subjectKey,
      contentHash,
      universeRevision,
    }),
  )}`;
  return {
    versionId,
    subjectKey: subject.subjectKey,
    contentHash,
    universeRevision,
  };
}

function evidenceInstance(
  observation: CandidateEvidenceInput,
  subject: LogicalSourceSubject,
  version: CandidateSourceVersion,
): EvidenceInstance {
  const callId = nonEmpty(observation.callId, "tool call id");
  return {
    evidenceInstanceId: `evidence-instance:v1:${sha256Hex(
      canonicalJson({
        callId,
        subjectKey: subject.subjectKey,
        sourceVersionId: version.versionId,
      }),
    )}`,
    callId,
    subjectKey: subject.subjectKey,
    sourceVersionId: version.versionId,
    representationKind: observation.representationKind,
  };
}

function decisionHash(decision: IdentityDecision): string {
  return sha256Hex(
    `identity-decision:v1|${canonicalJson({
      eventId: decision.eventId,
      transitionId: decision.transitionId,
      kind: decision.kind,
      subjectKey: decision.subjectKey,
      sourceVersionId: decision.sourceVersionId,
      evidenceInstanceId: decision.evidenceInstanceId,
      representationKind: decision.representationKind,
      originatingRemoveTransitionId: decision.originatingRemoveTransitionId,
      reasonCodes: decision.reasonCodes,
    })}`,
  );
}

function observationHash(observation: ConservativeObservation): string {
  return sha256Hex(`identity-observation:v1|${canonicalJson(observation)}`);
}

function sameEvidence(a: EvidenceInstance, b: EvidenceInstance): boolean {
  return (
    a.evidenceInstanceId === b.evidenceInstanceId &&
    a.subjectKey === b.subjectKey &&
    a.sourceVersionId === b.sourceVersionId
  );
}

/**
 * Test-only candidate mapper for LC1. It is deliberately not exported from
 * the runtime package and must not be treated as a production implementation.
 */
export class CandidateIdentityMapper {
  private readonly activeById = new Map<string, EvidenceInstance>();
  private readonly coldById = new Map<string, EvidenceInstance>();
  private readonly removalByTransition = new Map<string, RemovalRelation>();
  private readonly protectedSubjectKeys = new Set<string>();
  private readonly callIdentity = new Map<string, EvidenceInstance>();

  protect(source: LogicalSourceInput): string {
    const subjectKey = logicalSourceSubject(source).subjectKey;
    this.protectedSubjectKeys.add(subjectKey);
    return subjectKey;
  }

  observe(
    eventId: string,
    transitionId: string,
    observation: CandidateEvidenceInput,
  ): IdentityDecision | ConservativeObservation {
    const subject = logicalSourceSubject(observation);
    const version = candidateSourceVersion(subject, observation);
    const instance = evidenceInstance(observation, subject, version);
    const priorCall = this.callIdentity.get(instance.callId);
    if (priorCall !== undefined && !sameEvidence(priorCall, instance)) {
      throw new Error(`tool call id remapped: ${instance.callId}`);
    }

    if (observation.status === "UNAVAILABLE") {
      return {
        eventId,
        callId: instance.callId,
        subjectKey: subject.subjectKey,
        sourceVersionId: version.versionId,
        status: "UNAVAILABLE",
        outcome: "CONSERVATIVE_KEEP",
        reason: observation.unavailableReason ?? "UNAVAILABLE",
      };
    }
    if (observation.status === "ABSENT") {
      return {
        eventId,
        callId: instance.callId,
        subjectKey: subject.subjectKey,
        sourceVersionId: version.versionId,
        status: "ABSENT",
        outcome: "CONFIRMED_ABSENT",
        reason: "explicit observer absence",
      };
    }

    const activeInstance = this.activeById.get(instance.evidenceInstanceId);
    if (activeInstance !== undefined) {
      return {
        eventId,
        transitionId,
        kind: "KEEP",
        subjectKey: subject.subjectKey,
        sourceVersionId: version.versionId,
        evidenceInstanceId: activeInstance.evidenceInstanceId,
        representationKind: activeInstance.representationKind,
        originatingRemoveTransitionId: null,
        reasonCodes: ["SAME_EVIDENCE_INSTANCE_ALREADY_ACTIVE"],
      };
    }
    if (priorCall !== undefined) {
      throw new Error(
        `cold evidence requires a new tool call id: ${instance.callId}`,
      );
    }

    const removal = [...this.removalByTransition.values()]
      .filter(
        (candidate) =>
          candidate.subjectKey === subject.subjectKey &&
          candidate.sourceVersionId === version.versionId &&
          candidate.consumedByTransitionId === null,
      )
      .at(-1);

    this.callIdentity.set(instance.callId, instance);
    return {
      eventId,
      transitionId,
      kind: removal === undefined ? "ADD" : "REHYDRATE",
      subjectKey: subject.subjectKey,
      sourceVersionId: version.versionId,
      evidenceInstanceId: instance.evidenceInstanceId,
      representationKind: observation.representationKind,
      originatingRemoveTransitionId: removal?.transitionId ?? null,
      reasonCodes:
        removal === undefined
          ? ["NEW_EVIDENCE_INSTANCE"]
          : ["LATER_NEED_AFTER_REMOVE"],
    };
  }

  commit(decision: IdentityDecision): void {
    if (decision.kind === "REMOVE") {
      throw new Error(
        "REMOVE must be committed through remove() to identify active evidence",
      );
    }
    if (decision.kind === "KEEP") return;
    if (decision.evidenceInstanceId === null) {
      throw new Error(`${decision.kind} requires an evidence instance`);
    }
    const instance = [...this.callIdentity.values()].find(
      (candidate) =>
        candidate.evidenceInstanceId === decision.evidenceInstanceId &&
        candidate.subjectKey === decision.subjectKey &&
        candidate.sourceVersionId === decision.sourceVersionId,
    );
    if (instance === undefined) {
      throw new Error(
        `unknown evidence instance: ${decision.evidenceInstanceId}`,
      );
    }
    if (decision.kind === "REHYDRATE") {
      const originId = decision.originatingRemoveTransitionId;
      if (originId === null)
        throw new Error("REHYDRATE requires an originating REMOVE");
      const removal = this.removalByTransition.get(originId);
      if (
        removal === undefined ||
        removal.subjectKey !== decision.subjectKey ||
        removal.sourceVersionId !== decision.sourceVersionId
      ) {
        throw new Error("REHYDRATE has an invalid originating REMOVE");
      }
      if (removal.consumedByTransitionId !== null) {
        throw new Error("REHYDRATE reuses an already-consumed REMOVE");
      }
      this.removalByTransition.set(originId, {
        ...removal,
        consumedByTransitionId: decision.transitionId,
      });
    }
    if (this.activeById.has(instance.evidenceInstanceId)) {
      throw new Error(
        `evidence instance already active: ${instance.evidenceInstanceId}`,
      );
    }
    this.activeById.set(instance.evidenceInstanceId, instance);
    this.callIdentity.set(instance.callId, instance);
  }

  remove(
    transitionId: string,
    evidenceInstanceId: string,
    reasonCodes: readonly string[],
  ): IdentityDecision {
    if (this.removalByTransition.has(transitionId)) {
      throw new Error(`duplicate REMOVE transition: ${transitionId}`);
    }
    const instance = this.activeById.get(evidenceInstanceId);
    if (instance === undefined) {
      throw new Error(`cannot REMOVE inactive evidence: ${evidenceInstanceId}`);
    }
    if (this.protectedSubjectKeys.has(instance.subjectKey)) {
      throw new Error(
        `protected source cannot be removed: ${instance.subjectKey}`,
      );
    }
    this.activeById.delete(evidenceInstanceId);
    this.coldById.set(evidenceInstanceId, instance);
    this.removalByTransition.set(transitionId, {
      transitionId,
      subjectKey: instance.subjectKey,
      sourceVersionId: instance.sourceVersionId,
      removedEvidenceInstanceId: evidenceInstanceId,
      reasonCodes: [...reasonCodes],
      consumedByTransitionId: null,
    });
    return {
      eventId: transitionId,
      transitionId,
      kind: "REMOVE",
      subjectKey: instance.subjectKey,
      sourceVersionId: instance.sourceVersionId,
      evidenceInstanceId,
      representationKind: instance.representationKind,
      originatingRemoveTransitionId: null,
      reasonCodes: [...reasonCodes],
    };
  }

  keep(
    eventId: string,
    transitionId: string,
    evidenceInstanceId: string,
  ): IdentityDecision {
    const instance = this.activeById.get(evidenceInstanceId);
    if (instance === undefined) {
      throw new Error(`cannot KEEP inactive evidence: ${evidenceInstanceId}`);
    }
    return {
      eventId,
      transitionId,
      kind: "KEEP",
      subjectKey: instance.subjectKey,
      sourceVersionId: instance.sourceVersionId,
      evidenceInstanceId,
      representationKind: instance.representationKind,
      originatingRemoveTransitionId: null,
      reasonCodes: ["ACTIVE_EVIDENCE_RETAINED"],
    };
  }

  snapshot(): Omit<
    IdentityTraceResult,
    "traceId" | "decisions" | "observations" | "transitionHashes" | "traceHash"
  > {
    return {
      activeEvidence: [...this.activeById.values()].sort((a, b) =>
        a.evidenceInstanceId.localeCompare(b.evidenceInstanceId),
      ),
      coldEvidence: [...this.coldById.values()].sort((a, b) =>
        a.evidenceInstanceId.localeCompare(b.evidenceInstanceId),
      ),
      removals: [...this.removalByTransition.values()].sort((a, b) =>
        a.transitionId.localeCompare(b.transitionId),
      ),
      protectedSubjectKeys: [...this.protectedSubjectKeys].sort(),
    };
  }
}

export function runIdentityTrace(trace: IdentityTrace): IdentityTraceResult {
  const mapper = new CandidateIdentityMapper();
  const decisions: IdentityDecision[] = [];
  const observations: ConservativeObservation[] = [];
  const transitionHashes: string[] = [];

  for (const event of trace.events) {
    if (event.kind === "PROTECT") {
      mapper.protect(event.source);
      continue;
    }
    if (event.kind === "REMOVE") {
      const decision = mapper.remove(
        event.transitionId,
        event.evidenceInstanceId,
        event.reasonCodes,
      );
      decisions.push({ ...decision, eventId: event.id });
      transitionHashes.push(decisionHash(decisions.at(-1)!));
      continue;
    }
    if (event.kind === "KEEP") {
      const decision = mapper.keep(
        event.id,
        event.transitionId,
        event.evidenceInstanceId,
      );
      decisions.push(decision);
      transitionHashes.push(decisionHash(decision));
      continue;
    }

    const result = mapper.observe(
      event.id,
      event.transitionId,
      event.observation,
    );
    if ("outcome" in result) {
      observations.push(result);
      transitionHashes.push(observationHash(result));
      continue;
    }
    decisions.push(result);
    mapper.commit(result);
    transitionHashes.push(decisionHash(result));
  }

  const snapshot = mapper.snapshot();
  const traceHash = sha256Hex(
    `identity-trace:v1|${canonicalJson({
      traceId: trace.id,
      decisions,
      observations,
      activeEvidence: snapshot.activeEvidence,
      coldEvidence: snapshot.coldEvidence,
      removals: snapshot.removals,
      protectedSubjectKeys: snapshot.protectedSubjectKeys,
      transitionHashes,
    })}`,
  );
  return {
    traceId: trace.id,
    decisions,
    observations,
    activeEvidence: snapshot.activeEvidence,
    coldEvidence: snapshot.coldEvidence,
    removals: snapshot.removals,
    protectedSubjectKeys: snapshot.protectedSubjectKeys,
    transitionHashes,
    traceHash,
  };
}

export function decisionFor(
  result: IdentityTraceResult,
  eventId: string,
): IdentityDecision | undefined {
  return result.decisions.find((decision) => decision.eventId === eventId);
}

export function sourceVersionFor(
  observation: CandidateEvidenceInput,
): CandidateSourceVersion {
  return candidateSourceVersion(logicalSourceSubject(observation), observation);
}

export function subjectFor(input: LogicalSourceInput): LogicalSourceSubject {
  return logicalSourceSubject(input);
}

export function instanceIdFor(observation: CandidateEvidenceInput): string {
  const subject = logicalSourceSubject(observation);
  const version = candidateSourceVersion(subject, observation);
  return evidenceInstance(observation, subject, version).evidenceInstanceId;
}

export function buildObservation(
  base: CandidateEvidenceInput,
  overrides: Partial<CandidateEvidenceInput> = {},
): CandidateEvidenceInput {
  return { ...base, ...overrides };
}

export function representationIsExact(
  decision: IdentityDecision,
  expectedVersionId: string,
  expectedKind: IdentityRepresentationKind,
): boolean {
  return (
    decision.sourceVersionId === expectedVersionId &&
    decision.representationKind === expectedKind
  );
}
