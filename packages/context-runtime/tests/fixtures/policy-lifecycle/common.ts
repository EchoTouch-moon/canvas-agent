import {
  createRepresentation,
  createSourceVersionId,
  seedUniverse,
  type ContextRepresentation,
  type ContextSourceVersion,
  type ContextUniverseEntry,
  type ContextUniverseRevision,
  type SnapshotLikeSeed,
} from "../../../src";
import { TRACE_TIMESTAMP } from "./types";

export const SOURCE_KEYS = {
  task: "task/spec",
  target: "repo/target",
  distractorA: "repo/distractor-a",
  distractorB: "repo/distractor-b",
  oldFailure: "run/failure-old",
  newFailure: "run/failure-new",
  phaseDetail: "repo/phase-detail",
  unavailable: "repo/unavailable",
  reopenA: "repo/reopen-a",
} as const;

export const SOURCE_CONTENT_HASHES = {
  [SOURCE_KEYS.task]: "task-spec:v1",
  [SOURCE_KEYS.target]: "target:v1",
  [SOURCE_KEYS.distractorA]: "distractor-a:v1",
  [SOURCE_KEYS.distractorB]: "distractor-b:v1",
  [SOURCE_KEYS.oldFailure]: "failure-old:v1",
  [SOURCE_KEYS.newFailure]: "failure-new:v1",
  [SOURCE_KEYS.phaseDetail]: "phase-detail:v1",
  [SOURCE_KEYS.unavailable]: "unavailable:v1",
  [SOURCE_KEYS.reopenA]: "reopen-a:v3",
} as const;

export type LifecycleSourceKey = keyof typeof SOURCE_CONTENT_HASHES;

const SOURCE_METADATA: Record<
  string,
  {
    readonly sourceKind: string;
    readonly provenance: string;
    readonly authority?: string;
    readonly priority?: string;
  }
> = {
  [SOURCE_KEYS.task]: {
    sourceKind: "task-spec",
    provenance: "synthetic-fixture",
    authority: "SYSTEM",
    priority: "P0",
  },
  [SOURCE_KEYS.target]: {
    sourceKind: "repository-file",
    provenance: "synthetic-fixture",
    authority: "REFERENCE",
  },
  [SOURCE_KEYS.distractorA]: {
    sourceKind: "repository-file",
    provenance: "synthetic-fixture",
  },
  [SOURCE_KEYS.distractorB]: {
    sourceKind: "repository-file",
    provenance: "synthetic-fixture",
  },
  [SOURCE_KEYS.oldFailure]: {
    sourceKind: "verification-result",
    provenance: "synthetic-fixture",
  },
  [SOURCE_KEYS.newFailure]: {
    sourceKind: "verification-result",
    provenance: "synthetic-fixture",
  },
  [SOURCE_KEYS.phaseDetail]: {
    sourceKind: "repository-file",
    provenance: "synthetic-fixture",
  },
  [SOURCE_KEYS.unavailable]: {
    sourceKind: "repository-file",
    provenance: "synthetic-fixture",
    authority: "REFERENCE",
  },
  [SOURCE_KEYS.reopenA]: {
    sourceKind: "repository-file",
    provenance: "synthetic-fixture",
  },
};

export function lifecycleSeeds(): readonly SnapshotLikeSeed[] {
  return Object.entries(SOURCE_CONTENT_HASHES).map(
    ([sourceKey, contentHash]) => {
      const metadata = SOURCE_METADATA[sourceKey]!;
      return {
        sourceKey,
        sourceKind: metadata.sourceKind,
        provenance: metadata.provenance,
        ...(metadata.authority !== undefined
          ? { authority: metadata.authority }
          : {}),
        ...(metadata.priority !== undefined
          ? { priority: metadata.priority }
          : {}),
        contentHash,
        observedAt: TRACE_TIMESTAMP,
      };
    },
  );
}

export function seedLifecycleUniverse(
  runtimeSessionId: string,
): ContextUniverseRevision {
  return seedUniverse({ runtimeSessionId, seeds: lifecycleSeeds() });
}

export function sourceVersionId(sourceKey: string): string {
  const contentHash = SOURCE_CONTENT_HASHES[sourceKey as LifecycleSourceKey];
  if (contentHash === undefined) {
    throw new Error(`unknown synthetic source: ${sourceKey}`);
  }
  return createSourceVersionId(sourceKey, contentHash);
}

export function sourceVersion(
  entry: ContextUniverseEntry,
): ContextSourceVersion {
  if (entry.admittedVersion === null) {
    throw new Error(
      `synthetic source has no admitted version: ${entry.source.sourceKey}`,
    );
  }
  return entry.admittedVersion;
}

export function representationFor(
  entry: ContextUniverseEntry,
  kind: ContextRepresentation["kind"],
): ContextRepresentation | null {
  if (entry.admittedVersion === null) return null;
  const version = entry.admittedVersion;
  const tokenEstimate =
    kind === "FULL"
      ? 40
      : kind === "LINE_RANGE"
        ? 14
        : kind === "SUMMARY"
          ? 10
          : 6;
  return createRepresentation({
    kind,
    sourceVersionIds: [version.versionId],
    contentHash: `synthetic-representation:${kind}:${version.contentHash}`,
    tokenEstimate,
    lossiness: kind === "FULL" || kind === "LINE_RANGE" ? "NONE" : "BOUNDED",
    derivation: {
      fixture: "CSPV-B0",
      sourceKey: entry.source.sourceKey,
      sourceVersionId: version.versionId,
    },
    content: `synthetic:${entry.source.sourceKey}:${version.contentHash}:${kind}`,
  });
}

export function entryFor(
  universe: ContextUniverseRevision,
  sourceKey: string,
): ContextUniverseEntry | undefined {
  return universe.entries.find((entry) => entry.source.sourceKey === sourceKey);
}
