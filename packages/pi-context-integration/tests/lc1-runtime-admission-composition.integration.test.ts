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
  options: { readonly runtimeSessionId?: string } = {},
): Lc1RepositoryMappingRequest {
  return {
    messages,
    runtimeSessionId:
      options.runtimeSessionId ?? "composition-integration-session",
    modelCallSequence: sequence,
    repositoryId: "repo-a",
    namespace: "workspace",
    expectedRevision: revision,
    authorityOrder: { streamId: "composition-authority-stream", sequence },
    observedAt: T0,
  };
}

function mapperFor(repository: TempRepository): Lc1ProductionRepositoryMapper {
  return new Lc1ProductionRepositoryMapper({
    pathResolver: {
      resolve: ({ repositoryId, namespace }) =>
        repositoryId === "repo-a" && namespace === "workspace"
          ? repository.directory
          : undefined,
    },
  });
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
      mappingRequest(messages, revision, 1),
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
      mappingRequest(readMessages("after-batch-stop"), revision, 2),
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
});
