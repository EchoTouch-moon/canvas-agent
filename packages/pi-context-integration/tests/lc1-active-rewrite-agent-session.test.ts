import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { PiMessageView } from "../src";
import {
  C0ScenarioExecutor,
  createLc1ActiveRewriteExtension,
  createLc1RuntimeAdmissionComposition,
  createRunKillSwitch,
  InMemoryActiveRewriteEvidenceCollector,
  type Lc1ProductionRepositoryMapper,
  type Lc1RepositoryMappingRequest,
  Lc1RuntimeRepositoryAdmissionHost,
  type Lc1RepositoryRevision,
} from "../src/experimental";

// CR-004 explicit LC1-before-Active composition through Pi's actual
// AgentSession resource-loader and reload lifecycle.
//
// This suite is credential-free. It never calls session.prompt, so no model or
// provider transport is entered. The static model metadata exists only to
// construct a real AgentSession; context events are dispatched directly through
// the session's real ExtensionRunner.

const T0 = "2026-08-31T00:00:00.000Z";
const PATH = "src/reopen-a.ts";
const SYSTEM_INSTRUCTION =
  "Preserve tool continuity while editing the repository.";
const REVISION: Lc1RepositoryRevision = {
  baseCommit: "a".repeat(40),
  treeHash: "b".repeat(40),
  workingTreePatchHash: null,
};

interface RunState {
  readonly runId: string;
  readonly host: Lc1RuntimeRepositoryAdmissionHost;
  readonly killSwitch: ReturnType<typeof createRunKillSwitch>;
  readonly executor: C0ScenarioExecutor;
  readonly evidence: InMemoryActiveRewriteEvidenceCollector;
  readonly mapperCalls: number[];
}

const temporaryDirectories: string[] = [];

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

function composedFactoryFor(
  runs: RunState[],
  identityPrefix: string,
  options: { readonly failRevisionAt?: number } = {},
): ExtensionFactory {
  return async (pi) => {
    const runNumber = runs.length + 1;
    const runId = `${identityPrefix}-run-${runNumber}`;
    const runtimeSessionId = `${identityPrefix}-session-${runNumber}`;
    const host = new Lc1RuntimeRepositoryAdmissionHost({
      observer: { runtimeSessionId, now: () => T0 },
    });
    const killSwitch = createRunKillSwitch(runId, { now: () => T0 });
    const composition = createLc1RuntimeAdmissionComposition({
      mode: "RUNTIME_OWNED",
      host,
      killSwitch,
    });
    const executor = new C0ScenarioExecutor({
      runtimeSessionId: `${runtimeSessionId}:active`,
      now: () => T0,
    });
    const evidence = new InMemoryActiveRewriteEvidenceCollector();
    const mapperCalls: number[] = [];
    let revisionReads = 0;
    runs.push({
      runId,
      host,
      killSwitch,
      executor,
      evidence,
      mapperCalls,
    });

    const composed = createLc1ActiveRewriteExtension({
      lc1: {
        composition,
        mapper: successfulMapper(mapperCalls),
        runtimeSessionId,
        repositoryId: "repo-a",
        namespace: "workspace",
        authorityStreamId: `${runtimeSessionId}:authority`,
        getExpectedRevision: () => {
          revisionReads += 1;
          if (options.failRevisionAt === revisionReads) {
            throw new Error("synthetic mid-run revision read failure");
          }
          return REVISION;
        },
        observedAt: () => T0,
      },
      active: {
        runId,
        systemInstruction: SYSTEM_INSTRUCTION,
        executor,
        evidence,
      },
    });
    await composed(pi);
  };
}

async function createSession(cwd: string, factory: ExtensionFactory) {
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false, maxRetries: 0 },
  });
  const modelRuntime = await ModelRuntime.create({
    allowModelNetwork: false,
    refreshOnCreate: false,
    modelsPath: null,
    authPath: join(cwd, "auth.json"),
  });
  await modelRuntime.setRuntimeApiKey("deepseek", "credential-free-test-key");
  const model = modelRuntime.getModel("deepseek", "deepseek-v4-flash");
  if (model === undefined)
    throw new Error("static DeepSeek model metadata is unavailable");

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: join(cwd, ".pi-agent"),
    settingsManager,
    extensionFactories: [
      { name: "canvas-cr004-lc1-agent-session-composed", factory },
    ],
  });
  await loader.reload();
  const created = await createAgentSession({
    cwd,
    model,
    modelRuntime,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    noTools: "all",
  });
  return { created, session: created.session };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("LC1-before-Active composition through AgentSession", () => {
  it("loads the composed factory through DefaultResourceLoader and dispatches a guarded rewrite", async () => {
    const cwd = await mkdtemp(
      join(tmpdir(), "canvas-lc1-active-agent-session-composed-cwd-"),
    );
    temporaryDirectories.push(cwd);
    const runs: RunState[] = [];
    const { created, session } = await createSession(
      cwd,
      composedFactoryFor(runs, "lc1-active-agent-session-composed"),
    );

    try {
      expect(created.extensionsResult.errors).toHaveLength(0);
      expect(
        created.extensionsResult.extensions.map((extension) => extension.path),
      ).toContain("<inline:canvas-cr004-lc1-agent-session-composed>");
      expect(runs).toHaveLength(1);
      expect(session.extensionRunner.hasHandlers("context")).toBe(true);
      expect(session.extensionRunner.hasHandlers("session_shutdown")).toBe(
        true,
      );

      const run = runs[0];
      if (run === undefined)
        throw new Error("initial composed run unavailable");
      const firstMessages = [userMessage("Start the repository task.")];
      const secondMessages = [...firstMessages, ...readPair("read-agent-1")];
      const thirdMessages = [...secondMessages, ...editPair("edit-agent-1")];

      expect(
        await session.extensionRunner.emitContext(
          firstMessages as unknown as Parameters<
            typeof session.extensionRunner.emitContext
          >[0],
        ),
      ).toEqual(firstMessages);
      expect(
        await session.extensionRunner.emitContext(
          secondMessages as unknown as Parameters<
            typeof session.extensionRunner.emitContext
          >[0],
        ),
      ).toEqual(secondMessages);
      const rewritten = await session.extensionRunner.emitContext(
        thirdMessages as unknown as Parameters<
          typeof session.extensionRunner.emitContext
        >[0],
      );

      expect(run.mapperCalls).toEqual([1, 2, 3]);
      expect(run.host.callCount).toBe(3);
      expect(run.killSwitch.isTripped).toBe(false);
      expect(run.evidence.intervention).toMatchObject({
        compositionVerdict: "REWRITE_READY",
        guardVerdict: "PASS",
        sentRewrite: true,
      });
      expect(rewritten).toHaveLength(3);
      expect(rewritten).not.toContain(thirdMessages[2]);
    } finally {
      session.dispose();
    }
  });

  it("replaces the entire composed safety domain on AgentSession reload", async () => {
    const cwd = await mkdtemp(
      join(tmpdir(), "canvas-lc1-active-agent-session-reload-cwd-"),
    );
    temporaryDirectories.push(cwd);
    const runs: RunState[] = [];
    const { created, session } = await createSession(
      cwd,
      composedFactoryFor(runs, "lc1-active-agent-session-reload-composed"),
    );

    try {
      expect(created.extensionsResult.errors).toHaveLength(0);
      const firstRun = runs[0];
      if (firstRun === undefined)
        throw new Error("first composed run unavailable");
      const firstMessages = [userMessage("Start the first repository task.")];
      const firstRead = [...firstMessages, ...readPair("read-reload-first")];
      const firstEdit = [...firstRead, ...editPair("edit-reload-first")];

      await session.extensionRunner.emitContext(firstMessages as never);
      await session.extensionRunner.emitContext(firstRead as never);
      expect(
        await session.extensionRunner.emitContext(firstEdit as never),
      ).toHaveLength(3);
      expect(firstRun.evidence.intervention?.sentRewrite).toBe(true);
      const oldRunner = session.extensionRunner;

      await session.reload();

      expect(runs).toHaveLength(2);
      const secondRun = runs[1];
      if (secondRun === undefined)
        throw new Error("second composed run unavailable");
      expect(session.extensionRunner).not.toBe(oldRunner);
      expect(firstRun.killSwitch.tripRecord).toEqual({
        reason: "LC1_RUNTIME_ADMISSION_PI_SESSION_SHUTDOWN:reload",
        trippedAt: T0,
      });
      expect(secondRun.killSwitch.isTripped).toBe(false);

      const lateMessages = [...firstRead, ...editPair("edit-reload-old-run")];
      const lateResult = await oldRunner.emitContext(lateMessages as never);
      // A tripped old run cannot rewrite again, but already-committed
      // superseded evidence remains out of its carried basis.
      expect(lateResult).toEqual([
        ...firstMessages,
        ...editPair("edit-reload-old-run"),
      ]);
      expect(firstRun.evidence.events).toHaveLength(4);
      expect(firstRun.evidence.events[3]).toMatchObject({
        interventionAttempted: false,
        sentRewrite: false,
        killSwitchTripped: true,
      });
      expect(firstRun.host.callCount).toBe(3);

      const secondMessages = [userMessage("Start the second repository task.")];
      const secondRead = [...secondMessages, ...readPair("read-reload-second")];
      const secondEdit = [...secondRead, ...editPair("edit-reload-second")];
      await session.extensionRunner.emitContext(secondMessages as never);
      await session.extensionRunner.emitContext(secondRead as never);
      const rewritten = await session.extensionRunner.emitContext(
        secondEdit as never,
      );

      expect(secondRun.mapperCalls).toEqual([1, 2, 3]);
      expect(secondRun.host.callCount).toBe(3);
      expect(secondRun.killSwitch.isTripped).toBe(false);
      expect(secondRun.evidence.intervention?.sentRewrite).toBe(true);
      expect(rewritten).toHaveLength(3);
    } finally {
      session.dispose();
    }
  });

  it("blocks a later Active rewrite when LC1 fails after a prior rewrite", async () => {
    const cwd = await mkdtemp(
      join(tmpdir(), "canvas-lc1-active-agent-session-midrun-failure-cwd-"),
    );
    temporaryDirectories.push(cwd);
    const runs: RunState[] = [];
    const { created, session } = await createSession(
      cwd,
      composedFactoryFor(runs, "lc1-active-agent-session-midrun-failure", {
        failRevisionAt: 4,
      }),
    );

    try {
      expect(created.extensionsResult.errors).toHaveLength(0);
      const run = runs[0];
      if (run === undefined)
        throw new Error("mid-run composed run unavailable");
      const firstMessages = [userMessage("Start the repository task.")];
      const firstRead = [...firstMessages, ...readPair("read-midrun-first")];
      const firstEdit = [...firstRead, ...editPair("edit-midrun-first")];

      await session.extensionRunner.emitContext(firstMessages as never);
      await session.extensionRunner.emitContext(firstRead as never);
      const firstRewrite = await session.extensionRunner.emitContext(
        firstEdit as never,
      );
      expect(firstRewrite).toHaveLength(3);
      expect(run.evidence.events[2]?.sentRewrite).toBe(true);

      const laterMessages = [
        ...firstEdit,
        ...readPair("read-midrun-second"),
        ...editPair("edit-midrun-second"),
      ];
      const stopped = await session.extensionRunner.emitContext(
        laterMessages as never,
      );

      // The first committed removal remains carried, but the LC1 failure
      // prevents a second Active attempt and leaves the later evidence native.
      expect(stopped).toEqual([
        ...firstMessages,
        ...editPair("edit-midrun-first"),
        ...readPair("read-midrun-second"),
        ...editPair("edit-midrun-second"),
      ]);
      expect(run.mapperCalls).toEqual([1, 2, 3]);
      expect(run.host.callCount).toBe(3);
      expect(run.killSwitch.tripRecord).toEqual({
        reason: "LC1_RUNTIME_ADMISSION_REVISION_READ_FAILURE",
        trippedAt: T0,
      });
      expect(run.evidence.events).toHaveLength(4);
      expect(
        run.evidence.events.filter((event) => event.sentRewrite),
      ).toHaveLength(1);
      expect(run.evidence.events[3]).toMatchObject({
        interventionAttempted: false,
        sentRewrite: false,
        killSwitchTripped: true,
      });
    } finally {
      session.dispose();
    }
  });
});
