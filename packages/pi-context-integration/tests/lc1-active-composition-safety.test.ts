import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ContextEvent,
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
  createActiveRewriteExtension,
  createLc1RuntimeAdmissionComposition,
  createLc1RuntimeAdmissionPiExtension,
  createRunKillSwitch,
  detectInterventionBoundary,
  InMemoryActiveRewriteEvidenceCollector,
  Lc1ProductionRepositoryMapper,
  Lc1RuntimeRepositoryAdmissionHost,
  C0ScenarioExecutor,
  type Lc1RepositoryRevision,
} from "../src/experimental";

// CR-004 LC1 + Active composition safety.
//
// These tests exercise the real Pi ExtensionRunner with two context handlers
// in production order: LC1 authority admission first, then the Active
// intervention leg. They are credential-free and deliberately do not invoke a
// model or provider. The shared per-Run kill switch is the only coordination
// seam: an LC1 failure must prevent a later handler from rewriting context.

const PATH = "src/reopen-a.ts";
const FILE_KEY = `repository/file://${PATH}`;
const CONTENT_V3 = 'export const value = "reopen-a:v3"\n';
const T0 = "2026-08-31T00:00:00.000Z";
const SYSTEM_INSTRUCTION =
  "Preserve tool continuity while editing the repository.";

interface TempRepository {
  readonly directory: string;
  readonly revision: () => Promise<Lc1RepositoryRevision>;
}

const temporaryDirectories: string[] = [];

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
    join(tmpdir(), "canvas-lc1-active-composition-"),
  );
  temporaryDirectories.push(directory);
  const git = async (args: readonly string[]): Promise<string> => {
    const result = await runGitCommand(args, gitOptions(directory));
    if (result.exitCode !== 0) {
      throw new Error(`git failed: ${args.join(" ")}\n${result.stderr}`);
    }
    return result.stdout.trim();
  };

  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.email", "lc1-active-composition@canvas.local"]);
  await git(["config", "user.name", "LC1 Active Composition"]);
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, PATH), CONTENT_V3, "utf8");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "fixture-v3"]);

  return {
    directory,
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

async function loadRealPiRunner(
  factories: readonly ExtensionFactory[],
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

  for (const factory of factories) await factory(pi);

  const extension = {
    path: "<lc1-active-composition-safety>",
    resolvedPath: "<lc1-active-composition-safety>",
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

function lc1Factory(options: {
  readonly repository: TempRepository;
  readonly revision: () =>
    Lc1RepositoryRevision | Promise<Lc1RepositoryRevision>;
  readonly killSwitch: ReturnType<typeof createRunKillSwitch>;
  readonly host: Lc1RuntimeRepositoryAdmissionHost;
  readonly runtimeSessionId: string;
  readonly mapper?: Lc1ProductionRepositoryMapper;
}): ExtensionFactory {
  const composition = createLc1RuntimeAdmissionComposition({
    mode: "RUNTIME_OWNED",
    host: options.host,
    killSwitch: options.killSwitch,
  });
  return createLc1RuntimeAdmissionPiExtension({
    composition,
    mapper: options.mapper ?? mapperFor(options.repository),
    runtimeSessionId: options.runtimeSessionId,
    repositoryId: "repo-a",
    namespace: "workspace",
    authorityStreamId: `${options.runtimeSessionId}:authority`,
    getExpectedRevision: options.revision,
    observedAt: () => T0,
  });
}

function activeFactory(options: {
  readonly runId: string;
  readonly killSwitch: ReturnType<typeof createRunKillSwitch>;
  readonly executor: C0ScenarioExecutor;
  readonly evidence: InMemoryActiveRewriteEvidenceCollector;
}): ExtensionFactory {
  return createActiveRewriteExtension({
    runId: options.runId,
    systemInstruction: SYSTEM_INSTRUCTION,
    executor: options.executor,
    killSwitch: options.killSwitch,
    evidence: options.evidence,
    maxInterventions: 1,
    maxAttempts: 1,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("LC1 and Active handlers through the real Pi ExtensionRunner", () => {
  it("admits the same read pair across cumulative context events without a false stop", async () => {
    const repository = await createRepository();
    const revision = await repository.revision();
    const runtimeSessionId = "lc1-active-cumulative-session";
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId, now: () => T0 },
    });
    const killSwitch = createRunKillSwitch("lc1-active-cumulative-run", {
      now: () => T0,
    });
    const executor = new C0ScenarioExecutor({
      runtimeSessionId: "lc1-active-cumulative-executor",
      now: () => T0,
    });
    const evidence = new InMemoryActiveRewriteEvidenceCollector();
    const runner = await loadRealPiRunner([
      lc1Factory({
        repository,
        revision: () => revision,
        killSwitch,
        host,
        runtimeSessionId,
      }),
      activeFactory({
        runId: killSwitch.runId,
        killSwitch,
        executor,
        evidence,
      }),
    ]);

    const firstMessages = [
      userMessage("Inspect the repository."),
      ...readPair("read-1"),
    ];
    const secondMessages = [
      ...firstMessages,
      userMessage("Continue with the same repository context."),
    ];

    expect(await runner.emitContext(firstMessages as never)).toEqual(
      firstMessages,
    );
    expect(await runner.emitContext(secondMessages as never)).toEqual(
      secondMessages,
    );
    expect(killSwitch.isTripped).toBe(false);
    expect(host.callCount).toBe(2);
    expect(
      host.universeRevision?.entries.find(
        (entry) => entry.source.sourceKey === FILE_KEY,
      )?.admittedVersion?.contentHash,
    ).toBeTruthy();
    expect(evidence.events).toHaveLength(2);
    expect(evidence.events.every((event) => event.sentRewrite === false)).toBe(
      true,
    );
    expect(executor.observationCount).toBe(2);
  });

  it("blocks a later Active rewrite when LC1 trips the shared kill switch", async () => {
    const repository = await createRepository();
    const revision = await repository.revision();
    const runtimeSessionId = "lc1-active-failure-session";
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId, now: () => T0 },
    });
    const killSwitch = createRunKillSwitch("lc1-active-failure-run", {
      now: () => T0,
    });
    let revisionReads = 0;
    const executor = new C0ScenarioExecutor({
      runtimeSessionId: "lc1-active-failure-executor",
      now: () => T0,
    });
    const evidence = new InMemoryActiveRewriteEvidenceCollector();
    const runner = await loadRealPiRunner([
      lc1Factory({
        repository,
        revision: () => {
          revisionReads += 1;
          if (revisionReads === 1) return revision;
          throw new Error("synthetic revision read failure");
        },
        killSwitch,
        host,
        runtimeSessionId,
      }),
      activeFactory({
        runId: killSwitch.runId,
        killSwitch,
        executor,
        evidence,
      }),
    ]);

    const firstMessages = [
      userMessage("Read before editing."),
      ...readPair("read-1"),
    ];
    const secondMessages = [...firstMessages, ...editPair("edit-1")];
    expect(detectInterventionBoundary(secondMessages)?.editToolCallId).toBe(
      "edit-1",
    );

    expect(await runner.emitContext(firstMessages as never)).toEqual(
      firstMessages,
    );
    expect(
      executor.latestWorkingSet?.items.flatMap((item) => item.sourceKeys),
    ).toContain("run/tool-result://read-1");

    const secondResult = await runner.emitContext(secondMessages as never);
    expect(secondResult).toEqual(secondMessages);
    expect(killSwitch.tripRecord).toEqual({
      reason: "LC1_RUNTIME_ADMISSION_REVISION_READ_FAILURE",
      trippedAt: T0,
    });
    expect(host.callCount).toBe(1);
    expect(executor.observationCount).toBe(2);
    expect(evidence.events).toHaveLength(2);
    expect(evidence.events[1]).toMatchObject({
      interventionAttempted: false,
      sentRewrite: false,
      killSwitchTripped: true,
    });
    expect(evidence.intervention.sentRewrite).toBe(false);
  });
});
