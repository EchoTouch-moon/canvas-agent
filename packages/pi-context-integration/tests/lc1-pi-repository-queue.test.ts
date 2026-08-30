import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@canvas-agent/context-runtime";
import {
  EnrichedPiShadowObserver,
  type ExternalObservation,
} from "../src/extension/enriched-shadow-extension";
import { PiContextShadowObserver } from "../src/extension/shadow-extension";
import { decomposePiMessage, type PiMessageView } from "../src";
import {
  RepositoryObserver,
  type RepositoryFileObservation,
} from "@canvas-agent/repository-observer";
import {
  readRepositoryRevision,
  runGitCommand,
  type GitRunOptions,
} from "@canvas-agent/worker-runtime";
import { normalizeSourcePath } from "../../context-runtime/tests/fixtures/source-identity/candidate";

const PATH = "src/reopen-a.ts";
const FILE_KEY = `repository/file://${PATH}`;
const CONTENT_V3 = 'export const value = "reopen-a:v3"\n';
const CONTENT_V4 = 'export const value = "reopen-a:v4"\n';
const T0 = "2026-08-30T00:00:00.000Z";

interface RepositoryRevisionContract {
  readonly baseCommit: string;
  readonly treeHash: string;
  readonly workingTreePatchHash: string | null;
}

interface TempRepository {
  readonly directory: string;
  readonly git: (args: readonly string[]) => Promise<string>;
  readonly revision: () => Promise<RepositoryRevisionContract>;
}

const repositories: TempRepository[] = [];

function gitOptions(cwd: string): GitRunOptions {
  return {
    cwd,
    timeoutMs: 30_000,
    maxOutputBytes: 2 * 1024 * 1024,
    commandAllowlist: ["git"],
    signal: undefined,
  };
}

async function createRepository(content: string): Promise<TempRepository> {
  const directory = await mkdtemp(
    join(tmpdir(), "canvas-lc1-repository-queue-"),
  );
  const git = async (args: readonly string[]): Promise<string> => {
    const result = await runGitCommand(args, gitOptions(directory));
    if (result.exitCode !== 0) {
      throw new Error(`git failed: ${args.join(" ")}\n${result.stderr}`);
    }
    return result.stdout.trim();
  };
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.email", "lc1@canvas.local"]);
  await git(["config", "user.name", "LC1 Repository Queue"]);
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, PATH), content, "utf8");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "fixture"]);
  const repository = {
    directory,
    git,
    revision: async () => {
      const revision = await readRepositoryRevision(
        directory,
        gitOptions(directory),
      );
      if (revision.baseCommit === null || revision.treeHash === null) {
        throw new Error("expected committed repository revision");
      }
      return {
        baseCommit: revision.baseCommit,
        treeHash: revision.treeHash,
        workingTreePatchHash: revision.workingTreePatchHash,
      };
    },
  };
  repositories.push(repository);
  return repository;
}

afterEach(async () => {
  await Promise.all(
    repositories
      .splice(0)
      .map((repository) =>
        rm(repository.directory, { recursive: true, force: true }),
      ),
  );
});

function toolMessages(
  callId: string,
  path = PATH,
  content = CONTENT_V3,
): PiMessageView[] {
  return [
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: callId, name: "read", arguments: { path } },
      ],
    },
    {
      role: "toolResult",
      content: [{ type: "text", text: content }],
      toolCallId: callId,
      toolName: "read",
      isError: false,
    },
  ];
}

function readPaths(
  messages: readonly PiMessageView[],
  modelCallSequence: number,
): string[] {
  const paths = new Set<string>();
  messages.forEach((message, messagePosition) => {
    for (const entry of decomposePiMessage(message, {
      runtimeSessionId: "queue-path-discovery",
      modelCallSequence,
      messagePosition,
    })) {
      if (
        entry.element.elementKind !== "TOOL_CALL" ||
        entry.element.toolName !== "read"
      )
        continue;
      for (const hint of entry.attribution.resourceHints ?? []) {
        if (!hint.sourceKey.startsWith("repository/file://")) continue;
        try {
          paths.add(
            normalizeSourcePath(
              hint.sourceKey.slice("repository/file://".length),
            ),
          );
        } catch {
          // Unsafe hints are deliberately omitted from the authoritative request.
        }
      }
    }
  });
  return [...paths].sort();
}

async function observeRepository(
  repository: TempRepository,
  messages: readonly PiMessageView[],
  expectedRevision: RepositoryRevisionContract,
  modelCallSequence: number,
): Promise<readonly RepositoryFileObservation[]> {
  return new RepositoryObserver().observe({
    repositoryPath: repository.directory,
    expectedRevision,
    paths: readPaths(messages, modelCallSequence),
    observedAt: T0,
  });
}

function externalObservation(
  observation: RepositoryFileObservation,
): ExternalObservation {
  return {
    observation: observation.observation,
    descriptor: {
      sourceKey: observation.sourceKey,
      sourceKind: observation.sourceKind,
      provenance: observation.provenance,
    },
  };
}

function runtimeObserver(runtimeSessionId = "queue-session") {
  const base = new PiContextShadowObserver({ runtimeSessionId, now: () => T0 });
  return new EnrichedPiShadowObserver({ base });
}

function fileEntry(
  result: ReturnType<EnrichedPiShadowObserver["observeModelCall"]>,
) {
  return result.universeRevision.entries.find(
    (entry) => entry.source.sourceKey === FILE_KEY,
  );
}

function fileEvent(
  result: ReturnType<EnrichedPiShadowObserver["observeModelCall"]>,
) {
  return result.universeRevision.reconciliationEvents.find(
    (event) => event.sourceKey === FILE_KEY,
  );
}

describe("LC1 real RepositoryObserver to external-observation queue", () => {
  it("routes authoritative Git content beside, not through, Pi run-event identity", async () => {
    const repository = await createRepository(CONTENT_V3);
    const messages = toolMessages("queue-call-1");
    const revision = await repository.revision();
    const [observed] = await observeRepository(
      repository,
      messages,
      revision,
      1,
    );
    expect(observed).toBeDefined();
    expect(observed?.observation).toMatchObject({
      sourceKey: FILE_KEY,
      status: "AVAILABLE",
      contentHash: sha256Hex(CONTENT_V3),
    });
    expect(observed?.verifiedRevision).toEqual(revision);

    const observer = runtimeObserver();
    observer.queueExternalObservations([externalObservation(observed!)]);
    const result = observer.observeModelCall(messages);
    const repositoryEntry = fileEntry(result);
    const runEntry = result.universeRevision.entries.find(
      (entry) => entry.source.sourceKey === "run/tool-result://queue-call-1",
    );

    expect(repositoryEntry?.source).toMatchObject({
      sourceKey: FILE_KEY,
      sourceKind: "REPOSITORY_FILE",
      provenance: "REPOSITORY_OBSERVER",
    });
    expect(repositoryEntry?.admittedVersion).toMatchObject({
      sourceKey: FILE_KEY,
      contentHash: sha256Hex(CONTENT_V3),
    });
    expect(runEntry?.source).toMatchObject({
      sourceKey: "run/tool-result://queue-call-1",
      provenance: "PI_CONTEXT_EVENT",
    });
    expect(runEntry?.admittedVersion?.contentHash).not.toBe(
      sha256Hex(CONTENT_V3),
    );
    expect(result.recentEvidenceSourceKeys).toContain(FILE_KEY);
    expect(result.sourceObservations).toContainEqual(observed!.observation);
  });

  it("preserves the real ADD -> dirty UNAVAILABLE -> UPDATE -> explicit ABSENT chain", async () => {
    const repository = await createRepository(CONTENT_V3);
    const observer = runtimeObserver("lifecycle-session");

    const revisionV3 = await repository.revision();
    const messagesV3 = toolMessages("lifecycle-call-1");
    const [availableV3] = await observeRepository(
      repository,
      messagesV3,
      revisionV3,
      1,
    );
    if (availableV3 === undefined) throw new Error("expected v3 authority");
    observer.queueExternalObservations([externalObservation(availableV3)]);
    const first = observer.observeModelCall(messagesV3);
    const firstEntry = fileEntry(first);
    const firstVersionId = firstEntry?.state.admittedVersionId;
    expect(firstEntry?.state).toMatchObject({
      observationStatus: "AVAILABLE",
      admittedVersionId: expect.any(String),
      lastAvailableVersionId: expect.any(String),
    });
    expect(fileEvent(first)).toMatchObject({
      action: "INITIALIZE",
      nextVersionId: firstVersionId,
    });

    await writeFile(join(repository.directory, PATH), CONTENT_V4, "utf8");
    const dirtyMessages = toolMessages("lifecycle-call-2", PATH, CONTENT_V4);
    const dirtyAuthority = await observeRepository(
      repository,
      dirtyMessages,
      revisionV3,
      2,
    );
    expect(dirtyAuthority).toHaveLength(1);
    expect(dirtyAuthority[0]?.observation).toMatchObject({
      sourceKey: FILE_KEY,
      status: "UNAVAILABLE",
    });
    expect(dirtyAuthority[0]?.verifiedRevision).toBeNull();
    observer.queueExternalObservations([
      externalObservation(dirtyAuthority[0]!),
    ]);
    const second = observer.observeModelCall(dirtyMessages);
    expect(fileEntry(second)?.state).toMatchObject({
      observationStatus: "UNAVAILABLE",
      admittedVersionId: firstVersionId,
      lastAvailableVersionId: firstVersionId,
    });
    expect(fileEntry(second)?.admittedVersion?.contentHash).toBe(
      sha256Hex(CONTENT_V3),
    );
    expect(fileEvent(second)).toMatchObject({
      action: "RETAIN_LAST_KNOWN",
      previousVersionId: firstVersionId,
      nextVersionId: firstVersionId,
    });

    await repository.git(["add", "-A"]);
    await repository.git(["commit", "-q", "-m", "v4"]);
    const revisionV4 = await repository.revision();
    const messagesV4 = toolMessages("lifecycle-call-3", PATH, CONTENT_V4);
    const [availableV4] = await observeRepository(
      repository,
      messagesV4,
      revisionV4,
      3,
    );
    if (availableV4 === undefined) throw new Error("expected v4 authority");
    observer.queueExternalObservations([externalObservation(availableV4)]);
    const third = observer.observeModelCall(messagesV4);
    const thirdVersionId = fileEntry(third)?.state.admittedVersionId;
    expect(thirdVersionId).not.toBe(firstVersionId);
    expect(fileEntry(third)?.state.observationStatus).toBe("AVAILABLE");
    expect(fileEntry(third)?.admittedVersion?.contentHash).toBe(
      sha256Hex(CONTENT_V4),
    );
    expect(fileEvent(third)).toMatchObject({
      action: "UPDATE",
      previousVersionId: firstVersionId,
      nextVersionId: thirdVersionId,
    });

    await repository.git(["rm", "-q", PATH]);
    await repository.git(["commit", "-q", "-m", "delete fixture"]);
    const revisionAbsent = await repository.revision();
    const absentMessages = toolMessages("lifecycle-call-4", PATH, "");
    const [absent] = await observeRepository(
      repository,
      absentMessages,
      revisionAbsent,
      4,
    );
    if (absent === undefined) throw new Error("expected absent authority");
    expect(absent.observation).toMatchObject({
      sourceKey: FILE_KEY,
      status: "ABSENT",
    });
    observer.queueExternalObservations([externalObservation(absent)]);
    const fourth = observer.observeModelCall(absentMessages);
    expect(fileEntry(fourth)?.state).toMatchObject({
      observationStatus: "ABSENT",
      admittedVersionId: null,
    });
    expect(fileEntry(fourth)?.admittedVersion).toBeNull();
    expect(fileEvent(fourth)).toMatchObject({
      action: "REMOVE",
      previousVersionId: thirdVersionId,
      nextVersionId: null,
    });
    expect(observer.callCount).toBe(4);
  });

  it("restores queued authority and model-call sequence as one transaction", async () => {
    const repository = await createRepository(CONTENT_V3);
    const messages = toolMessages("transaction-call-1");
    const revision = await repository.revision();
    const [observed] = await observeRepository(
      repository,
      messages,
      revision,
      1,
    );
    const observer = runtimeObserver("transaction-session");
    if (observed === undefined)
      throw new Error("expected transaction authority");
    observer.queueExternalObservations([externalObservation(observed)]);

    const snapshot = observer.snapshotForTransaction();
    const first = observer.observeModelCall(messages);
    expect(fileEntry(first)?.admittedVersion?.contentHash).toBe(
      sha256Hex(CONTENT_V3),
    );
    expect(observer.callCount).toBe(1);

    observer.restoreTransaction(snapshot);
    expect(observer.callCount).toBe(0);
    const replay = observer.observeModelCall(messages);
    expect(replay.universeRevision.logicalHash).toBe(
      first.universeRevision.logicalHash,
    );
    expect(replay.universeRevision).toEqual(first.universeRevision);
    expect(replay.sourceObservations).toEqual(first.sourceObservations);
  });
});
