export const IDENTITY_DECISION_KINDS = [
  "ADD",
  "KEEP",
  "REMOVE",
  "REHYDRATE",
] as const;
export type IdentityDecisionKind = (typeof IDENTITY_DECISION_KINDS)[number];

export const IDENTITY_OBSERVATION_STATUSES = [
  "AVAILABLE",
  "UNAVAILABLE",
  "ABSENT",
] as const;
export type IdentityObservationStatus =
  (typeof IDENTITY_OBSERVATION_STATUSES)[number];

export const IDENTITY_REPRESENTATION_KINDS = [
  "REFERENCE",
  "FULL",
  "LINE_RANGE",
] as const;
export type IdentityRepresentationKind =
  (typeof IDENTITY_REPRESENTATION_KINDS)[number];

export interface LogicalSourceInput {
  readonly repositoryId: string;
  readonly namespace: string;
  readonly path: string;
}

export interface LogicalSourceSubject {
  readonly repositoryId: string;
  readonly namespace: string;
  readonly normalizedPath: string;
  readonly subjectKey: string;
}

export interface SourceVersionInput {
  readonly contentHash: string;
  readonly universeRevision: string;
}

export interface CandidateSourceVersion {
  readonly versionId: string;
  readonly subjectKey: string;
  readonly contentHash: string;
  readonly universeRevision: string;
}

export interface CandidateEvidenceBase extends LogicalSourceInput {
  readonly callId: string;
  readonly universeRevision: string;
  readonly representationKind: IdentityRepresentationKind;
}

export type CandidateEvidenceInput =
  | (CandidateEvidenceBase & {
      readonly status: "AVAILABLE";
      readonly contentHash: string;
      readonly unavailableReason?: never;
    })
  | (CandidateEvidenceBase & {
      readonly status: "UNAVAILABLE";
      readonly unavailableReason: string;
      readonly contentHash?: never;
    })
  | (CandidateEvidenceBase & {
      readonly status: "ABSENT";
      readonly contentHash?: never;
      readonly unavailableReason?: never;
    });

export interface EvidenceInstance {
  readonly evidenceInstanceId: string;
  readonly callId: string;
  readonly subjectKey: string;
  readonly sourceVersionId: string;
  readonly representationKind: IdentityRepresentationKind;
}

export interface RemovalRelation {
  readonly transitionId: string;
  readonly subjectKey: string;
  readonly sourceVersionId: string;
  readonly removedEvidenceInstanceId: string;
  readonly reasonCodes: readonly string[];
  readonly consumedByTransitionId: string | null;
}

export interface IdentityDecision {
  readonly eventId: string;
  readonly transitionId: string;
  readonly kind: IdentityDecisionKind;
  readonly subjectKey: string;
  readonly sourceVersionId: string;
  readonly evidenceInstanceId: string | null;
  readonly representationKind: IdentityRepresentationKind;
  readonly originatingRemoveTransitionId: string | null;
  readonly reasonCodes: readonly string[];
}

export interface ConservativeObservation {
  readonly eventId: string;
  readonly callId: string;
  readonly subjectKey: string;
  readonly sourceVersionId: string | null;
  readonly status: "UNAVAILABLE" | "ABSENT";
  readonly outcome: "CONSERVATIVE_KEEP" | "CONFIRMED_ABSENT";
  readonly reason: string;
}

export interface IdentityTraceObservationEvent {
  readonly kind: "OBSERVE";
  readonly id: string;
  readonly transitionId: string;
  readonly observation: CandidateEvidenceInput;
}

export interface IdentityTraceRemoveEvent {
  readonly kind: "REMOVE";
  readonly id: string;
  readonly transitionId: string;
  readonly evidenceInstanceId: string;
  readonly reasonCodes: readonly string[];
}

export interface IdentityTraceKeepEvent {
  readonly kind: "KEEP";
  readonly id: string;
  readonly transitionId: string;
  readonly evidenceInstanceId: string;
}

export interface IdentityTraceProtectEvent {
  readonly kind: "PROTECT";
  readonly id: string;
  readonly source: LogicalSourceInput;
}

export type IdentityTraceEvent =
  | IdentityTraceObservationEvent
  | IdentityTraceRemoveEvent
  | IdentityTraceKeepEvent
  | IdentityTraceProtectEvent;

export interface IdentityTrace {
  readonly id: string;
  readonly events: readonly IdentityTraceEvent[];
}

export interface IdentityTraceResult {
  readonly traceId: string;
  readonly decisions: readonly IdentityDecision[];
  readonly observations: readonly ConservativeObservation[];
  readonly activeEvidence: readonly EvidenceInstance[];
  readonly coldEvidence: readonly EvidenceInstance[];
  readonly removals: readonly RemovalRelation[];
  readonly protectedSubjectKeys: readonly string[];
  readonly transitionHashes: readonly string[];
  readonly traceHash: string;
}
