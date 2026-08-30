import { afterEach, describe, expect, it } from "vitest";
import {
  createAvailableObservation,
  createUnavailableObservation,
  sha256Hex,
  type ContextSourceDescriptor,
} from "@canvas-agent/context-runtime";
import { EnrichedPiShadowObserver } from "../src/extension/enriched-shadow-extension";
import { PiContextShadowObserver } from "../src/extension/shadow-extension";
import type { PiMessageView } from "../src/pi-message-mapper";

const FILE_KEY = "repository/file://src/reopen-a.ts";
const OTHER_KEY = "repository/file://src/other.ts";
const CONTENT_V3 = "reopen-a:v3";
const CONTENT_V4 = "reopen-a:v4";
const HASH_V3 = sha256Hex(CONTENT_V3);
const HASH_V4 = sha256Hex(CONTENT_V4);
const T0 = "2026-08-30T00:00:00.000Z";

const repositories: EnrichedPiShadowObserver[] = [];

afterEach(() => {
  repositories.splice(0);
});

function messages(sequence: number): PiMessageView[] {
  return [
    {
      role: "user",
      content: [{ type: "text", text: `queue safety call ${sequence}` }],
    },
  ];
}

function descriptor(
  sourceKey = FILE_KEY,
  authority = "git:v3",
  provenance = "REPOSITORY_OBSERVER",
): ContextSourceDescriptor {
  return {
    sourceKey,
    sourceKind: "REPOSITORY_FILE",
    provenance,
    authority,
  };
}

function observer(): EnrichedPiShadowObserver {
  const value = new EnrichedPiShadowObserver({
    base: new PiContextShadowObserver({
      runtimeSessionId: "queue-safety-session",
      now: () => T0,
    }),
  });
  repositories.push(value);
  return value;
}

function fileEntry(
  result: ReturnType<EnrichedPiShadowObserver["observeModelCall"]>,
  sourceKey = FILE_KEY,
) {
  return result.universeRevision.entries.find(
    (entry) => entry.source.sourceKey === sourceKey,
  );
}

function external(
  observation: ReturnType<typeof createAvailableObservation>,
  sourceDescriptor: ContextSourceDescriptor = descriptor(observation.sourceKey),
) {
  return { observation, descriptor: sourceDescriptor };
}

describe("LC1 external-observation queue safety audit", () => {
  it("records the current out-of-order authority rollback as an open safety gap", () => {
    const runtime = observer();
    runtime.queueExternalObservations([
      external(
        createAvailableObservation(FILE_KEY, HASH_V4, T0),
        descriptor(FILE_KEY, "git:v4"),
      ),
    ]);
    const current = runtime.observeModelCall(messages(1));
    const currentVersionId = fileEntry(current)?.state.admittedVersionId;
    expect(fileEntry(current)?.admittedVersion?.contentHash).toBe(HASH_V4);

    // Simulate an older RepositoryObserver result completing after the newer
    // result. The current queue has no authority revision comparator.
    runtime.queueExternalObservations([
      external(
        createAvailableObservation(FILE_KEY, HASH_V3, T0),
        descriptor(FILE_KEY, "git:v3"),
      ),
    ]);
    const stale = runtime.observeModelCall(messages(2));
    const staleEntry = fileEntry(stale);

    expect(staleEntry?.admittedVersion?.contentHash).toBe(HASH_V3);
    expect(staleEntry?.state.admittedVersionId).not.toBe(currentVersionId);
    expect(staleEntry?.source.authority).toBe("git:v3");
    expect({
      finding: "OUT_OF_ORDER_AUTHORITY_ROLLBACK",
      classification:
        staleEntry?.admittedVersion?.contentHash === HASH_V3
          ? "OPEN_SAFETY_GAP"
          : "PASS",
    }).toEqual({
      finding: "OUT_OF_ORDER_AUTHORITY_ROLLBACK",
      classification: "OPEN_SAFETY_GAP",
    });
  });

  it("records same-source descriptor drift as an open safety gap", () => {
    const runtime = observer();
    runtime.queueExternalObservations([
      external(
        createAvailableObservation(FILE_KEY, HASH_V3, T0),
        descriptor(FILE_KEY, "git:v3", "REPOSITORY_OBSERVER"),
      ),
    ]);
    runtime.observeModelCall(messages(1));

    // Same content is deliberately used so any change is descriptor metadata
    // drift rather than a legitimate SourceVersion update.
    runtime.queueExternalObservations([
      external(
        createAvailableObservation(FILE_KEY, HASH_V3, T0),
        descriptor(FILE_KEY, "forged:v3", "UNTRUSTED_ADAPTER"),
      ),
    ]);
    const drifted = runtime.observeModelCall(messages(2));
    const entry = fileEntry(drifted);

    expect(entry?.admittedVersion?.contentHash).toBe(HASH_V3);
    expect(entry?.source).toMatchObject({
      sourceKind: "REPOSITORY_FILE",
      provenance: "UNTRUSTED_ADAPTER",
      authority: "forged:v3",
    });
    expect({
      finding: "DESCRIPTOR_DRIFT_ACCEPTED",
      classification:
        entry?.source.provenance === "UNTRUSTED_ADAPTER"
          ? "OPEN_SAFETY_GAP"
          : "PASS",
    }).toEqual({
      finding: "DESCRIPTOR_DRIFT_ACCEPTED",
      classification: "OPEN_SAFETY_GAP",
    });
  });

  it("preserves batch enqueue atomicity when one descriptor key is invalid", () => {
    const runtime = observer();
    expect(() =>
      runtime.queueExternalObservations([
        external(createAvailableObservation(FILE_KEY, HASH_V3, T0)),
        external(
          createUnavailableObservation(OTHER_KEY, "REVISION_MISMATCH", T0),
          descriptor(FILE_KEY, "git:other"),
        ),
      ]),
    ).toThrow("external_observation_descriptor_source_key_mismatch");

    const result = runtime.observeModelCall(messages(1));
    expect(fileEntry(result, FILE_KEY)).toBeUndefined();
    expect(fileEntry(result, OTHER_KEY)).toBeUndefined();
  });
});
