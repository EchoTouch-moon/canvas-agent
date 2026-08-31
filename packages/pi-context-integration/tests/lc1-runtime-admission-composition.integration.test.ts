import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@canvas-agent/context-runtime";
import { RepositoryObserver } from "@canvas-agent/repository-observer";
import {
  readRepositoryRevision,
  runGitCommand,
  type GitRunOptions,
} from "@canvas-agent/worker-runtime";
import type { PiMessageView } from "../src";
import {
  createLc1RuntimeAdmissionComposition,
  createRunKillSwitch,
  Lc1ProductionRepositoryMapper,
  Lc1RuntimeRepositoryAdmissionHost,
  type Lc1RepositoryMappingRequest,
  type Lc1RepositoryRevision,
} from "../src/experimental";

const PATH = "src/reopen-a.ts";
const FILE_KEY = `repository/file://${PATH}`;
const CONTENT_V3 = 'export const value = "reopen-a:v3"\n';
const CONTENT_V4 = 'export const value = "reopen-a:v4"\n';
const T0 = "2026-08-31T00:00:00.000Z";

interface TempRepository {
  readonly directory: string;
  readonly git: (args: readonly string[]) => Promise<string>;
  readonly revision: () => Promise<Lc1RepositoryRevision>;
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

async function createRepository(): Promise<TempRepository> {
  const directory = await mkdtemp(
    join(tmpdir(), "canvas-lc1-composition-integration-"),
  );
  const git = async (args: readonly string[]): Promise<string> => {
    const result = await runGitCommand(args, gitOptions(directory));
    if (result.exitCode !== 0) {
      throw new Error(`git failed: ${args.join(" ")}\n${result.stderr}`);
    }
    return result.stdout.trim();
  };
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.email", "lc1-composition@canvas.local"]);
  await git(["config", "user.name", "LC1 Composition Integration"]);
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, PATH), CONTENT_V3, "utf8");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "fixture"]);
  const repository: TempRepository = {
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

function readMessages(callId: string, toolName = "read"): PiMessageView[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: callId,
          name: toolName,
          arguments: { path: PATH },
        },
      ],
    },
    {
      role: "toolResult",
      content: [
        {
          type: "text",
          text: "forged result content must not become authority",
        },
      ],
      toolCallId: callId,
      toolName,
      isError: false,
    },
  ];
}

function mappingRequest(
  messages: readonly PiMessageView[],
  revision: Lc1RepositoryRevision,
  sequence: number,
  options: {
    readonly runtimeSessionId?: string;
    readonly repositoryId?: string;
    readonly namespace?: string;
    readonly streamId?: string;
  } = {},
): Lc1RepositoryMappingRequest {
  return {
    messages,
    runtimeSessionId:
      options.runtimeSessionId ?? "composition-integration-session",
    modelCallSequence: sequence,
    repositoryId: options.repositoryId ?? "repo-a",
    namespace: options.namespace ?? "workspace",
    expectedRevision: revision,
    authorityOrder: {
      streamId: options.streamId ?? "composition-authority-stream",
      sequence,
    },
    observedAt: T0,
  };
}

async function commitRepository(
  repository: TempRepository,
  content: string,
  message: string,
): Promise<Lc1RepositoryRevision> {
  await writeFile(join(repository.directory, PATH), content, "utf8");
  await repository.git(["add", "-A"]);
  await repository.git(["commit", "-q", "-m", message]);
  return repository.revision();
}

function mapperFor(
  repository: TempRepository,
  boundRepositoryId = "repo-a",
  repositoryObserver?: Pick<RepositoryObserver, "observe">,
): Lc1ProductionRepositoryMapper {
  return new Lc1ProductionRepositoryMapper({
    pathResolver: {
      resolve: ({ repositoryId: requestRepositoryId, namespace }) =>
        requestRepositoryId === boundRepositoryId && namespace === "workspace"
          ? repository.directory
          : undefined,
    },
    ...(repositoryObserver === undefined ? {} : { repositoryObserver }),
  });
}

function userMessages(text: string): PiMessageView[] {
  return [{ role: "user", content: [{ type: "text", text }] }];
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("LC1 runtime-owned composition integration", () => {
  it("routes a real Pi read through authority mapping and admits it at the next runtime boundary", async () => {
    const repository = await createRepository();
    const revision = await repository.revision();
    const messages = readMessages("integration-read-1");
    const originalMessages = structuredClone(messages);
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: {
        runtimeSessionId: "composition-integration-session",
        now: () => T0,
      },
    });
    const killSwitch = createRunKillSwitch("composition-integration-run", {
      now: () => T0,
    });
    const composition = createLc1RuntimeAdmissionComposition({
      mode: "RUNTIME_OWNED",
      host,
      killSwitch,
    });

    const mapped = await composition.mapRepositoryObservations(
      mapperFor(repository),
      mappingRequest(messages, revision, 1),
    );

    expect(mapped.rejected).toEqual([]);
    expect(mapped.quarantined).toEqual([]);
    expect(mapped.accepted).toHaveLength(1);
    expect(mapped.accepted[0]).toMatchObject({
      sourceKey: FILE_KEY,
      canonicalPath: PATH,
      observation: { status: "AVAILABLE", contentHash: sha256Hex(CONTENT_V3) },
    });
    expect(messages).toEqual(originalMessages);
    expect(host.universeRevision).toBeNull();
    expect(host.callCount).toBe(0);

    const observed = host.observeModelCall(messages);
    const entry = observed.universeRevision.entries.find(
      (candidate) => candidate.source.sourceKey === FILE_KEY,
    );
    expect(entry?.source).toMatchObject({
      sourceKey: FILE_KEY,
      sourceKind: "REPOSITORY_FILE",
      provenance: "REPOSITORY_OBSERVER",
    });
    expect(entry?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V3));
    expect(observed.recentEvidenceSourceKeys).toContain(FILE_KEY);
    expect(killSwitch.isTripped).toBe(false);
    expect(host.callCount).toBe(1);
  });

  it("treats a mixed valid-and-invalid batch as atomic and trips the composition switch", async () => {
    const repository = await createRepository();
    const revision = await repository.revision();
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: {
        runtimeSessionId: "composition-batch-session",
        now: () => T0,
      },
    });
    const killSwitch = createRunKillSwitch("composition-batch-run", {
      now: () => T0,
    });
    const composition = createLc1RuntimeAdmissionComposition({
      mode: "RUNTIME_OWNED",
      host,
      killSwitch,
    });
    const validRead = readMessages("batch-valid");
    const invalidTool = readMessages("batch-invalid", "grep");
    const messages = [...validRead, ...invalidTool];

    const result = await composition.mapRepositoryObservations(
      mapperFor(repository),
      mappingRequest(messages, revision, 1, {
        runtimeSessionId: "composition-batch-session",
      }),
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: "UNSUPPORTED_TOOL" }),
      expect.objectContaining({ reason: "BATCH_REJECTED" }),
    ]);
    expect(result.quarantined).toEqual([]);
    expect(killSwitch.tripRecord).toEqual({
      reason: "LC1_RUNTIME_ADMISSION_MAPPING_GUARD_REJECTED",
      trippedAt: T0,
    });
    expect(host.universeRevision).toBeNull();
    expect(host.callCount).toBe(0);

    const stopped = await composition.mapRepositoryObservations(
      mapperFor(repository),
      mappingRequest(readMessages("after-batch-stop"), revision, 2, {
        runtimeSessionId: "composition-batch-session",
      }),
    );
    expect(stopped.rejected).toEqual([
      expect.objectContaining({ reason: "KILL_SWITCH_TRIPPED" }),
    ]);
  });

  it("rolls back an existing admitted pending observation when the next context boundary fails", async () => {
    const repository = await createRepository();
    const revision = await repository.revision();
    let failClock = false;
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: {
        runtimeSessionId: "composition-rollback-session",
        now: () => {
          if (failClock) throw new Error("synthetic observer clock failure");
          return T0;
        },
      },
    });
    const killSwitch = createRunKillSwitch("composition-rollback-run", {
      now: () => T0,
    });
    const composition = createLc1RuntimeAdmissionComposition({
      mode: "RUNTIME_OWNED",
      host,
      killSwitch,
    });
    const messages = readMessages("rollback-read");

    const mapped = await composition.mapRepositoryObservations(
      mapperFor(repository),
      mappingRequest(messages, revision, 1, {
        runtimeSessionId: "composition-rollback-session",
      }),
    );
    expect(mapped.accepted).toHaveLength(1);
    const beforeFailure = host.snapshotForTransaction();

    failClock = true;
    expect(composition.handleContext(messages).messages).toBe(messages);

    expect(killSwitch.tripRecord).toEqual({
      reason: "LC1_RUNTIME_ADMISSION_OBSERVER_FAILURE",
      trippedAt: T0,
    });
    expect(host.snapshotForTransaction()).toEqual(beforeFailure);
    expect(host.universeRevision).toBeNull();
    expect(host.callCount).toBe(0);
  });

  it("does not let an authority observer failure reach the runtime-owned host", async () => {
    const repository = await createRepository();
    const revision = await repository.revision();
    let authorityCalls = 0;
    const mapper = new Lc1ProductionRepositoryMapper({
      pathResolver: { resolve: () => repository.directory },
      repositoryObserver: {
        observe: async () => {
          authorityCalls += 1;
          throw new Error("synthetic authority unavailable");
        },
      },
    });
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: {
        runtimeSessionId: "composition-authority-failure",
        now: () => T0,
      },
    });
    const killSwitch = createRunKillSwitch(
      "composition-authority-failure-run",
      {
        now: () => T0,
      },
    );
    const composition = createLc1RuntimeAdmissionComposition({
      mode: "RUNTIME_OWNED",
      host,
      killSwitch,
    });

    const result = await composition.mapRepositoryObservations(
      mapper,
      mappingRequest(readMessages("authority-failure"), revision, 1, {
        runtimeSessionId: "composition-authority-failure",
      }),
    );

    expect(authorityCalls).toBe(1);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.quarantined).toEqual([
      expect.objectContaining({ reason: "AUTHORITY_OBSERVATION_FAILED" }),
    ]);
    expect(killSwitch.tripRecord).toEqual({
      reason: "LC1_RUNTIME_ADMISSION_MAPPING_GUARD_REJECTED",
      trippedAt: T0,
    });
    expect(host.universeRevision).toBeNull();
    expect(host.callCount).toBe(0);
  });

  it("keeps the authority head across mapper replacement within one runtime session", async () => {
    const repository = await createRepository();
    const revisionV3 = await repository.revision();
    const sessionId = "composition-mapper-restart-session";
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 },
    });
    const killSwitch = createRunKillSwitch("composition-mapper-restart-run", {
      now: () => T0,
    });
    const composition = createLc1RuntimeAdmissionComposition({
      mode: "RUNTIME_OWNED",
      host,
      killSwitch,
    });
    const messagesV3 = readMessages("mapper-restart-v3");

    const first = await composition.mapRepositoryObservations(
      mapperFor(repository),
      mappingRequest(messagesV3, revisionV3, 1, {
        runtimeSessionId: sessionId,
      }),
    );
    expect(first.accepted).toHaveLength(1);
    host.observeModelCall(messagesV3);

    const revisionV4 = await commitRepository(repository, CONTENT_V4, "v4");
    const messagesV4 = readMessages("mapper-restart-v4");
    const second = await composition.mapRepositoryObservations(
      mapperFor(repository),
      mappingRequest(messagesV4, revisionV4, 2, {
        runtimeSessionId: sessionId,
      }),
    );

    expect(second.rejected).toEqual([]);
    expect(second.quarantined).toEqual([]);
    expect(second.accepted).toHaveLength(1);
    const observed = host.observeModelCall(messagesV4);
    const entry = observed.universeRevision.entries.find(
      (candidate) => candidate.source.sourceKey === FILE_KEY,
    );
    expect(entry?.admittedVersion?.contentHash).toBe(sha256Hex(CONTENT_V4));
    expect(killSwitch.isTripped).toBe(false);
  });

  it("rejects a replacement mapper from a different repository scope without mutating pending state", async () => {
    const repositoryA = await createRepository();
    const repositoryB = await createRepository();
    const revisionA = await repositoryA.revision();
    const revisionB = await repositoryB.revision();
    const sessionId = "composition-cross-scope-session";
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 },
    });
    const killSwitch = createRunKillSwitch("composition-cross-scope-run", {
      now: () => T0,
    });
    const composition = createLc1RuntimeAdmissionComposition({
      mode: "RUNTIME_OWNED",
      host,
      killSwitch,
    });
    const first = await composition.mapRepositoryObservations(
      mapperFor(repositoryA, "repo-a"),
      mappingRequest(readMessages("scope-a"), revisionA, 1, {
        runtimeSessionId: sessionId,
        repositoryId: "repo-a",
      }),
    );
    expect(first.accepted).toHaveLength(1);
    host.observeModelCall(readMessages("scope-a"));
    const before = host.snapshotForTransaction();

    const second = await composition.mapRepositoryObservations(
      mapperFor(repositoryB, "repo-b"),
      mappingRequest(readMessages("scope-b"), revisionB, 2, {
        runtimeSessionId: sessionId,
        repositoryId: "repo-b",
      }),
    );

    expect(second.accepted).toEqual([]);
    expect(second.rejected).toEqual([]);
    expect(second.quarantined).toEqual([
      expect.objectContaining({
        sourceKey: FILE_KEY,
        reason: "CROSS_SCOPE_COLLISION",
      }),
    ]);
    expect(host.snapshotForTransaction()).toEqual(before);
    expect(killSwitch.tripRecord).toEqual({
      reason: "LC1_RUNTIME_ADMISSION_GUARD_REJECTED",
      trippedAt: T0,
    });
  });

  it("allows the same source path after a repository switch only in a new runtime session", async () => {
    const repositoryA = await createRepository();
    const repositoryB = await createRepository();
    const revisionA = await repositoryA.revision();
    const revisionB = await repositoryB.revision();

    const sessionA = "composition-switch-session-a";
    const hostA = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionA, now: () => T0 },
    });
    const compositionA = createLc1RuntimeAdmissionComposition({
      mode: "RUNTIME_OWNED",
      host: hostA,
      killSwitch: createRunKillSwitch("composition-switch-run-a", {
        now: () => T0,
      }),
    });
    const first = await compositionA.mapRepositoryObservations(
      mapperFor(repositoryA, "repo-a"),
      mappingRequest(readMessages("switch-a"), revisionA, 1, {
        runtimeSessionId: sessionA,
        repositoryId: "repo-a",
      }),
    );
    expect(first.accepted).toHaveLength(1);
    const firstObserved = hostA.observeModelCall(readMessages("switch-a"));
    expect(
      firstObserved.universeRevision.entries.find(
        (candidate) => candidate.source.sourceKey === FILE_KEY,
      )?.admittedVersion?.contentHash,
    ).toBe(sha256Hex(CONTENT_V3));

    const sessionB = "composition-switch-session-b";
    const hostB = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionB, now: () => T0 },
    });
    const compositionB = createLc1RuntimeAdmissionComposition({
      mode: "RUNTIME_OWNED",
      host: hostB,
      killSwitch: createRunKillSwitch("composition-switch-run-b", {
        now: () => T0,
      }),
    });
    const secondMessages = readMessages("switch-b");
    const second = await compositionB.mapRepositoryObservations(
      mapperFor(repositoryB, "repo-b"),
      mappingRequest(secondMessages, revisionB, 1, {
        runtimeSessionId: sessionB,
        repositoryId: "repo-b",
      }),
    );
    expect(second.accepted).toHaveLength(1);
    const secondObserved = hostB.observeModelCall(secondMessages);
    expect(
      secondObserved.universeRevision.entries.find(
        (candidate) => candidate.source.sourceKey === FILE_KEY,
      )?.admittedVersion?.contentHash,
    ).toBe(sha256Hex(CONTENT_V3));
  });

  it("serializes out-of-order mapper completions and rejects the stale authority result", async () => {
    const repository = await createRepository();
    const revisionV3 = await repository.revision();
    const revisionV4 = await commitRepository(repository, CONTENT_V4, "v4");
    const authority = new RepositoryObserver();
    const v3Authority = await authority.observe({
      repositoryPath: repository.directory,
      expectedRevision: revisionV3,
      paths: [PATH],
      observedAt: T0,
    });
    const v4Authority = await authority.observe({
      repositoryPath: repository.directory,
      expectedRevision: revisionV4,
      paths: [PATH],
      observedAt: T0,
    });
    const olderGate = deferred();
    const newerGate = deferred();
    const delayedAuthority: Pick<RepositoryObserver, "observe"> = {
      observe: async (input) => {
        if (input.expectedRevision.baseCommit === revisionV3.baseCommit) {
          await olderGate.promise;
          return v3Authority;
        }
        await newerGate.promise;
        return v4Authority;
      },
    };
    const sessionId = "composition-concurrent-session";
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId: sessionId, now: () => T0 },
    });
    const killSwitch = createRunKillSwitch("composition-concurrent-run", {
      now: () => T0,
    });
    const composition = createLc1RuntimeAdmissionComposition({
      mode: "RUNTIME_OWNED",
      host,
      killSwitch,
    });
    const olderMessages = readMessages("concurrent-v3");
    const newerMessages = readMessages("concurrent-v4");

    const olderPromise = composition.mapRepositoryObservations(
      mapperFor(repository, "repo-a", delayedAuthority),
      mappingRequest(olderMessages, revisionV3, 1, {
        runtimeSessionId: sessionId,
      }),
    );
    const newerPromise = composition.mapRepositoryObservations(
      mapperFor(repository, "repo-a", delayedAuthority),
      mappingRequest(newerMessages, revisionV4, 2, {
        runtimeSessionId: sessionId,
      }),
    );
    newerGate.resolve();
    const newer = await newerPromise;
    expect(newer.accepted).toHaveLength(1);
    const observed = host.observeModelCall(newerMessages);
    expect(
      observed.universeRevision.entries.find(
        (candidate) => candidate.source.sourceKey === FILE_KEY,
      )?.admittedVersion?.contentHash,
    ).toBe(sha256Hex(CONTENT_V4));

    olderGate.resolve();
    const older = await olderPromise;
    expect(older.accepted).toEqual([]);
    expect(older.rejected).toEqual([
      expect.objectContaining({
        sourceKey: FILE_KEY,
        reason: "STALE_AUTHORITY",
      }),
    ]);
    expect(older.quarantined).toEqual([]);
    expect(killSwitch.tripRecord).toEqual({
      reason: "LC1_RUNTIME_ADMISSION_GUARD_REJECTED",
      trippedAt: T0,
    });
    const final = host.observeModelCall(
      userMessages("stale result was not queued"),
    );
    expect(
      final.universeRevision.entries.find(
        (candidate) => candidate.source.sourceKey === FILE_KEY,
      )?.admittedVersion?.contentHash,
    ).toBe(sha256Hex(CONTENT_V4));
  });
});
