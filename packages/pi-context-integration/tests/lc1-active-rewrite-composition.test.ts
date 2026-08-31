import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Extension,
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  createExtensionRuntime,
  ExtensionRunner,
} from "@earendil-works/pi-coding-agent";
import {
  readRepositoryRevision,
  runGitCommand,
  type GitRunOptions,
} from "@canvas-agent/worker-runtime";
import type { PiMessageView } from "../src";
import {
  C0ScenarioExecutor,
  createLc1ActiveRewriteExtension,
  createLc1RuntimeAdmissionComposition,
  createRunKillSwitch,
  detectInterventionBoundary,
  InMemoryActiveRewriteEvidenceCollector,
  Lc1ProductionRepositoryMapper,
  type Lc1RepositoryMappingRequest,
  Lc1RuntimeRepositoryAdmissionHost,
  type Lc1RepositoryRevision,
} from "../src/experimental";

// CR-004 explicit LC1-before-Active composition.
//
// This suite is credential-free. It uses Pi's real ExtensionRunner dispatcher
// and the production LC1/Active factories. Most cases use a local mapper stub
// to isolate wrapper ordering and shared-switch behavior from repository
// authority I/O; one regression also wires the production mapper through a
// temporary Git repository to cover the real read -> edit boundary.

const T0 = "2026-08-31T00:00:00.000Z";
const PATH = "src/reopen-a.ts";
const SYSTEM_INSTRUCTION =
  "Preserve tool continuity while editing the repository.";
const REVISION: Lc1RepositoryRevision = {
  baseCommit: "a".repeat(40),
  treeHash: "b".repeat(40),
  workingTreePatchHash: null,
};

const temporaryKillSwitches: ReturnType<typeof createRunKillSwitch>[] = [];
const temporaryRepositories: string[] = [];

interface RealRepository {
  readonly directory: string;
  readonly revision: () => Promise<Lc1RepositoryRevision>;
}

function gitOptions(cwd: string): GitRunOptions {
  return {
    cwd,
    timeoutMs: 30_000,
    maxOutputBytes: 2 * 1024 * 1024,
    commandAllowlist: ["git"],
    signal: undefined,
  };
}

async function createRealRepository(): Promise<RealRepository> {
  const directory = await mkdtemp(join(tmpdir(), "canvas-lc1-composed-real-repo-"));
  temporaryRepositories.push(directory);
  const git = async (args: readonly string[]): Promise<string> => {
    const result = await runGitCommand(args, gitOptions(directory));
    if (result.exitCode !== 0) {
      throw new Error(`git failed: ${args.join(" ")}\n${result.stderr}`);
    }
    return result.stdout.trim();
  };

  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.email", "lc1-composition@canvas.local"]);
  await git(["config", "user.name", "LC1 Composition"]);
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, PATH), 'export const value = "reopen-a:v3"\n', "utf8");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "fixture"]);

  return {
    directory,
    revision: async () => {
      const revision = await readRepositoryRevision(directory, gitOptions(directory));
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
}

function realMapperFor(repository: RealRepository): Lc1ProductionRepositoryMapper {
  return new Lc1ProductionRepositoryMapper({
    pathResolver: {
      resolve: ({ repositoryId, namespace }) =>
        repositoryId === "repo-a" && namespace === "workspace"
          ? repository.directory
          : undefined,
    },
  });
}

function userMessage(text: string): PiMessageView {
  return { role: "user", content: [{ type: "text", text }] };
}

function readPair(callId: string): readonly PiMessageView[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: callId,
          name: "read",
          arguments: { path: PATH },
        },
      ],
    },
    {
      role: "toolResult",
      content: [{ type: "text", text: "fixture result content" }],
      toolCallId: callId,
      toolName: "read",
      isError: false,
    },
  ];
}

function editPair(callId: string): readonly PiMessageView[] {
  return [
    {
      role: "assistant",
      content: [
        { type: "text", text: "Applying the change now." },
        {
          type: "toolCall",
          id: callId,
          name: "edit",
          arguments: { path: PATH },
        },
      ],
    },
    {
      role: "toolResult",
      content: [{ type: "text", text: "edited src/reopen-a.ts" }],
      toolCallId: callId,
      toolName: "edit",
      isError: false,
    },
  ];
}

function successfulMapper(calls: number[]): Lc1ProductionRepositoryMapper {
  return {
    observeAndQueue: async (request: Lc1RepositoryMappingRequest) => {
      calls.push(request.modelCallSequence);
      return {
        accepted: [],
        rejected: [],
        quarantined: [],
        authoritativeObservations: [],
      };
    },
  } as unknown as Lc1ProductionRepositoryMapper;
}

async function loadRealPiRunner(
  factory: ExtensionFactory,
): Promise<ExtensionRunner> {
  const runtime = createExtensionRuntime();
  const handlers = new Map<string, unknown[]>();
  const pi = {
    on: (event: string, handler: unknown) => {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
  } as unknown as ExtensionAPI;
  await factory(pi);

  const extension = {
    path: "<lc1-active-rewrite-composition>",
    resolvedPath: "<lc1-active-rewrite-composition>",
    sourceInfo: {} as Extension["sourceInfo"],
    handlers,
    tools: new Map(),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  } as unknown as Extension;
  return new ExtensionRunner(
    [extension],
    runtime,
    process.cwd(),
    undefined as never,
    undefined as never,
  );
}

function createFixture(options: {
  readonly runId: string;
  readonly runtimeSessionId: string;
  readonly killSwitch?: ReturnType<typeof createRunKillSwitch>;
  readonly getExpectedRevision?: () =>
    Lc1RepositoryRevision | Promise<Lc1RepositoryRevision>;
  readonly mapper: Lc1ProductionRepositoryMapper;
}) {
  const host = new Lc1RuntimeRepositoryAdmissionHost({
    observer: { runtimeSessionId: options.runtimeSessionId, now: () => T0 },
  });
  const killSwitch =
    options.killSwitch ?? createRunKillSwitch(options.runId, { now: () => T0 });
  temporaryKillSwitches.push(killSwitch);
  const composition = createLc1RuntimeAdmissionComposition({
    mode: "RUNTIME_OWNED",
    host,
    killSwitch,
  });
  const executor = new C0ScenarioExecutor({
    runtimeSessionId: `${options.runtimeSessionId}:active`,
    now: () => T0,
  });
  const evidence = new InMemoryActiveRewriteEvidenceCollector();
  const extension = createLc1ActiveRewriteExtension({
    lc1: {
      composition,
      mapper: options.mapper,
      runtimeSessionId: options.runtimeSessionId,
      repositoryId: "repo-a",
      namespace: "workspace",
      authorityStreamId: `${options.runtimeSessionId}:authority`,
      getExpectedRevision: options.getExpectedRevision ?? (() => REVISION),
      observedAt: () => T0,
    },
    active: {
      runId: options.runId,
      systemInstruction: SYSTEM_INSTRUCTION,
      executor,
      evidence,
    },
  });
  return { extension, host, killSwitch, executor, evidence };
}

afterEach(async () => {
  temporaryKillSwitches.splice(0);
  await Promise.all(
    temporaryRepositories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("explicit LC1-before-Active Pi composition", () => {
  it("registers LC1 before Active and preserves a healthy read-to-edit rewrite", async () => {
    const calls: number[] = [];
    const runId = "lc1-active-composed-healthy-run";
    const fixture = createFixture({
      runId,
      runtimeSessionId: "lc1-active-composed-healthy-session",
      mapper: successfulMapper(calls),
    });
    const runner = await loadRealPiRunner(fixture.extension);

    const firstMessages = [userMessage("Start the repository task.")];
    const secondMessages = [...firstMessages, ...readPair("read-1")];
    const thirdMessages = [...secondMessages, ...editPair("edit-1")];

    expect(await runner.emitContext(firstMessages as never)).toEqual(
      firstMessages,
    );
    expect(await runner.emitContext(secondMessages as never)).toEqual(
      secondMessages,
    );
    const rewritten = await runner.emitContext(thirdMessages as never);

    expect(calls).toEqual([1, 2, 3]);
    expect(fixture.host.callCount).toBe(3);
    expect(fixture.killSwitch.isTripped).toBe(false);
    expect(fixture.evidence.intervention).toMatchObject({
      compositionVerdict: "REWRITE_READY",
      guardVerdict: "PASS",
      sentRewrite: true,
    });
    expect(rewritten).toHaveLength(3);
    expect(rewritten).not.toContain(thirdMessages[2]);
    expect(fixture.executor.observationCount).toBe(3);
  });

  it("keeps a real mapper healthy across a read-to-edit Active boundary", async () => {
    const repository = await createRealRepository();
    const revision = await repository.revision();
    const runId = "lc1-active-composed-real-mapper-run";
    const fixture = createFixture({
      runId,
      runtimeSessionId: "lc1-active-composed-real-mapper-session",
      mapper: realMapperFor(repository),
      getExpectedRevision: () => revision,
    });
    const runner = await loadRealPiRunner(fixture.extension);

    const firstMessages = [userMessage("Start the repository task.")];
    const secondMessages = [...firstMessages, ...readPair("real-read-1")];
    const thirdMessages = [...secondMessages, ...editPair("real-edit-1")];

    expect(await runner.emitContext(firstMessages as never)).toEqual(firstMessages);
    expect(await runner.emitContext(secondMessages as never)).toEqual(secondMessages);
    const rewritten = await runner.emitContext(thirdMessages as never);

    expect(fixture.killSwitch.isTripped).toBe(false);
    expect(fixture.host.callCount).toBe(3);
    expect(fixture.evidence.intervention).toMatchObject({
      compositionVerdict: "REWRITE_READY",
      guardVerdict: "PASS",
      sentRewrite: true,
    });
    expect(rewritten).toHaveLength(3);
    expect(rewritten).not.toContain(thirdMessages[2]);
  });

  it("trips the shared switch before Active and blocks a qualifying rewrite boundary", async () => {
    const calls: number[] = [];
    const runId = "lc1-active-composed-failure-run";
    let revisionReads = 0;
    const fixture = createFixture({
      runId,
      runtimeSessionId: "lc1-active-composed-failure-session",
      mapper: successfulMapper(calls),
      getExpectedRevision: () => {
        revisionReads += 1;
        if (revisionReads === 3)
          throw new Error("synthetic revision read failure");
        return REVISION;
      },
    });
    const runner = await loadRealPiRunner(fixture.extension);

    const firstMessages = [userMessage("Start the repository task.")];
    const secondMessages = [...firstMessages, ...readPair("read-1")];
    const thirdMessages = [...secondMessages, ...editPair("edit-1")];

    expect(detectInterventionBoundary(thirdMessages)?.editToolCallId).toBe(
      "edit-1",
    );
    expect(await runner.emitContext(firstMessages as never)).toEqual(
      firstMessages,
    );
    expect(await runner.emitContext(secondMessages as never)).toEqual(
      secondMessages,
    );
    const stopped = await runner.emitContext(thirdMessages as never);

    expect(calls).toEqual([1, 2]);
    expect(stopped).toEqual(thirdMessages);
    expect(fixture.killSwitch.tripRecord).toEqual({
      reason: "LC1_RUNTIME_ADMISSION_REVISION_READ_FAILURE",
      trippedAt: T0,
    });
    expect(fixture.host.callCount).toBe(2);
    expect(fixture.executor.observationCount).toBe(3);
    expect(fixture.evidence.intervention.sentRewrite).toBe(false);
    expect(fixture.evidence.events[2]).toMatchObject({
      interventionAttempted: false,
      sentRewrite: false,
      killSwitchTripped: true,
    });
  });

  it("rejects an independently supplied Active kill switch", () => {
    const shared = createRunKillSwitch("lc1-active-shared-run", {
      now: () => T0,
    });
    const other = createRunKillSwitch("lc1-active-shared-run", {
      now: () => T0,
    });
    temporaryKillSwitches.push(shared, other);
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: {
        runtimeSessionId: "lc1-active-shared-session",
        now: () => T0,
      },
    });
    const composition = createLc1RuntimeAdmissionComposition({
      mode: "RUNTIME_OWNED",
      host,
      killSwitch: shared,
    });
    const evidence = new InMemoryActiveRewriteEvidenceCollector();
    const executor = new C0ScenarioExecutor({
      runtimeSessionId: "lc1-active-shared-session:active",
      now: () => T0,
    });

    expect(() =>
      createLc1ActiveRewriteExtension({
        lc1: {
          composition,
          mapper: successfulMapper([]),
          runtimeSessionId: "lc1-active-shared-session",
          repositoryId: "repo-a",
          namespace: "workspace",
          authorityStreamId: "lc1-active-shared-authority",
          getExpectedRevision: () => REVISION,
          observedAt: () => T0,
        },
        active: {
          runId: shared.runId,
          systemInstruction: SYSTEM_INSTRUCTION,
          executor,
          evidence,
          killSwitch: other,
        },
      }),
    ).toThrow("lc1_active_rewrite_extension_requires_shared_kill_switch");

    expect(() =>
      createLc1ActiveRewriteExtension({
        lc1: {
          composition,
          mapper: successfulMapper([]),
          runtimeSessionId: "lc1-active-shared-session",
          repositoryId: "repo-a",
          namespace: "workspace",
          authorityStreamId: "lc1-active-shared-authority",
          getExpectedRevision: () => REVISION,
          observedAt: () => T0,
        },
        active: {
          runId: "different-run-id",
          systemInstruction: SYSTEM_INSTRUCTION,
          executor,
          evidence,
        },
      }),
    ).toThrow("lc1_active_rewrite_extension_run_id_mismatch");

    expect(() =>
      createLc1ActiveRewriteExtension({
        lc1: {
          composition,
          mapper: successfulMapper([]),
          runtimeSessionId: "lc1-active-shared-session",
          repositoryId: "repo-a",
          namespace: "workspace",
          authorityStreamId: "lc1-active-shared-authority",
          getExpectedRevision: () => REVISION,
          observedAt: () => T0,
        },
        active: null,
      } as never),
    ).toThrow("lc1_active_rewrite_extension_configuration_invalid");
  });
});
