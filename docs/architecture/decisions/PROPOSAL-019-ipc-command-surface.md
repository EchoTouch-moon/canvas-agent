# PROPOSAL-019: IPC command surface for the real core loop

- **Status:** Approved with required changes (architecture review 2026-08-07)
- **Owner (review):** lead architect
- **Author:** DeepSeek V4 Flash
- **Date:** 2026-08-07
- **Supersedes:** nothing (extends ADR-018)

## Review verdict

PROPOSAL-019 is **approved with required changes**. The four open questions were
ruled as follows and are no longer open:

| # | Decision | Ruling |
|---|---|---|
| 1 | IPC channel | **Single `canvas-agent:command` channel** with a discriminated command union |
| 2 | Renderer state | **Server-authoritative durable domain state; renderer owns only ephemeral / UI / composer / editor-buffer state** (no domain dual-write, no optimistic domain commits) |
| 3 | Worker placement | **The real app loop goes straight to a Utility Process.** An `InProcessWorkerHost` is allowed only as a test/dev implementation, never as the production hosting path |
| 4 | Repository | **Prototype uses a single configured workspace repository** (`AppConfig`), never a renderer-supplied path or picker |

The following required changes must be reflected before contracts implementation
starts (each section below marks where it lands):

1. State model is "server-authoritative durable domain state + local ephemeral
   interaction state", not blanket response-driven state replacement.
2. The formal Worker loop runs in a Utility Process; `InProcessWorkerHost` is a
   test-only implementation.
3. Response schemas are **command-correlated** (`data` is typed per command, not
   `z.unknown()`).
4. `worker.cancel` takes `{ executionRequestId }` and the host owns the active
   execution (AbortController per execution, not a shared permanent one).
5. Renderer migration wording is fixed: the fixture service has only `load()`;
   the boundary is a local UI reducer for interaction commands vs a remote
   `WorkspaceClient.execute()` for domain commands.

Recommended (accepted, non-blocking): `CommandResponse` carries `requestId` and
`schemaVersion` for tracing.

## Context

The MVP core loop is fully implemented as standalone packages:

- `@canvas-agent/persistence` (DS-001): SQLite project facts, immutable
  NodeVersion / TaskSpecVersion / Baseline / ContextSnapshot, audit log, typed
  concurrency via `expectedRevision`.
- `@canvas-agent/worker-runtime` (DS-002): validates an immutable
  `ExecutionRequest`, verifies repository revision, runs an isolated Git worktree,
  returns patch / verification / summary artifacts.

The desktop app still drives the loop with a **typed fixture service + reducer**
and only exposes one IPC channel (`canvas-agent:runtime-info`). This proposal
defines the contract changes to let the running app drive the real loop over a
validated IPC boundary — which also produces the real RunEvent / ToolInvocation /
Checkpoint observation data that later protocol designs depend on.

## Goal

1. Renderer can issue domain commands (project / node / task / baseline / snapshot)
   that persist to SQLite in the main process and return typed results.
2. Renderer can dispatch a Worker and receive `DispatchResult` artifacts, without
   ever touching Node, Git, filesystem or process APIs.
3. Every inbound and outbound IPC payload is runtime-validated with Zod at the
   boundary; sender identity is verified; typed domain errors survive the boundary.
4. The fixture service can be swapped for an IPC-backed client without rewriting
   core-flow components (UI-002 intent), with the state model below.

## Non-goals (this proposal)

- No final RunEvent / ToolInvocation / Checkpoint schemas (deferred pending real
  run data).
- No multi-worker scheduling, queues or distributed leases.
- No second Agent adapter.
- No real Git patch application into the source workspace.
- No renderer UI changes in this packet.

## State model (required change #1)

```text
SQLite / Main                    = durable domain truth
Renderer                         = projection + interaction state + temporary editing buffer
```

- **Server-authoritative (never optimistic commit):** Node / NodeVersion,
  Task / TaskSpecVersion, Baseline, RepositoryRevision, Frozen ContextSnapshot,
  Run / ExecutionRequest, Artifact review result, Task completion, Baseline
  activation. Commands like `publish / freeze / dispatch / accept / complete /
  activate` go to the server and adopt the returned authoritative entities.
  These carry domain invariants (immutable versions, frozen snapshots, baseline
  supersession, `expectedRevision` concurrency), so renderer-side early commits
  would force rollback / reconcile / conflict / retry complexity.
- **Renderer-local (ephemeral):** current route, active tab, selected node,
  diff expand/collapse, search term, modal open, notice, hover, filter.
- **Composer draft (local until freeze):** `selectedContextItemIds`, token count,
  candidate order, preview, conflict hints. The whole selection is a local draft
  and is committed atomically in a single `snapshot.freeze` command.
- **Editor buffer (local + debounced persist):** Node title/body and Task
  description drafts. Update locally immediately; persist after a debounce with
  `expectedRevision`. On `ConcurrencyError` do **not** overwrite the server value:
  enter a `dirty draft + server revision changed → conflict state`. This is
  optimistic **UX**, not an optimistic **domain transition**.

`CoreFlowState` is a UI projection; Main must never return a whole UI state.
Commands return authoritative entities; the renderer projects them itself.

## Process topology (required change #2)

```text
Renderer (unprivileged)
   │  invoke('canvas-agent:command', { requestId, command, schemaVersion })
   │  ← CommandResponse (typed per command)
Electron Main (application boundary)
   ├─ CommandRouter
   │    ├─ WorkspaceService ── @canvas-agent/persistence  (SQLite at app userData)
   │    ├─ GitRevisionReader ── @canvas-agent/worker-runtime readRepositoryRevision
   │    └─ WorkerHost ───────────────────────────────┐
   └──────────────────────────────────────────────────┤  MessagePort
                                                      ▼
                                            Utility Process
                                              worker-runtime createWorker
                                              isolated worktree / artifacts
```

- **WorkspaceService** owns SQLite; one database per app, opened at startup with
  `openDatabase` + `applyMigrations`, closed on quit. Single writer of domain facts.
- **GitRevisionReader** reads the configured workspace repository revision (pins
  snapshots and builds expected revisions). Uses `AppConfig`, never renderer input.
- **WorkerHost** is an interface with two implementations:
  - `UtilityProcessWorkerHost` — the production path (Electron Utility Process).
  - `InProcessWorkerHost` — test/dev only (runs `createWorker` in-process).
  The main process always programs against the `WorkerHost` interface, so tests
  use the in-process implementation while the app stays on the correct boundary.
  `worker-runtime` remains Electron-free.

### AppConfig (required: "configured", not hardcoded)

```ts
interface AppConfig {
  sourceRepositoryPath: string   // the single configured workspace repo
  runtimeDirectory: string       // isolated worktrees + artifacts + recovery
}
```

The renderer can never supply a path.

## IPC contract changes (`@canvas-agent/contracts`)

### 1. Envelope

```ts
const commandRequestSchema = z
  .object({
    requestId: z.string().min(1),
    command: workspaceCommandSchema,   // discriminated union over CommandMap
    schemaVersion: z.literal(1)
  })
  .strict()
```

### 2. Command-correlated schemas (required change #3)

`data: z.unknown()` is rejected. Instead a typed command map drives both the
request union and the per-command response:

```ts
type CommandMap = {
  'project.create':      { request: ProjectCreateInput;     response: Project }
  'project.get':         { request: { projectId: string };  response: Project }
  'node.create':         { request: NodeCreateInput;        response: Node }
  'nodeDraft.upsert':    { request: NodeDraftUpsertInput;   response: NodeDraft }
  'nodeVersion.publish': { request: NodeVersionPublishInput; response: NodeVersion }
  'task.create':         { request: TaskCreateInput;        response: Task }
  'taskSpec.publish':    { request: TaskSpecPublishInput;   response: TaskSpecPublishResult }
  'baseline.createDraft':{ request: BaselineDraftInput;     response: Baseline }
  'baseline.activate':   { request: { baselineId: string }; response: BaselineActivateResult }
  'revision.upsert':     { request: RevisionInput;          response: RepositoryRevision }
  'snapshot.freeze':     { request: SnapshotFreezeInput;    response: SnapshotFreezeResult }
  'worker.dispatch':     { request: ExecutionRequest;       response: DispatchResult }
  'worker.cancel':       { request: { executionRequestId: string }; response: { cancelled: boolean } }
}

type CommandRequest<K extends keyof CommandMap = keyof CommandMap> =
  K extends keyof CommandMap ? { requestId: string; schemaVersion: 1; command: K; payload: CommandMap[K]['request'] } : never

type CommandResponse<K extends keyof CommandMap = keyof CommandMap> =
  | { requestId: string; schemaVersion: 1; ok: true; command: K; data: CommandMap[K]['response'] }
  | { requestId: string; schemaVersion: 1; ok: false; command: K; error: CommandError }
```

At runtime, Main keeps a **route registry** so every command has its own input and
output schema:

```ts
const routeRegistry: { [K in keyof CommandMap]: {
  input: ZodType<CommandMap[K]['request']>
  output: ZodType<CommandMap[K]['response']>
  execute: (ctx: CommandContext, payload: CommandMap[K]['request']) => Promise<CommandMap[K]['response']>
} }
```

Every outbound payload passes its command's output schema before crossing the
boundary (`input Zod → handler → output Zod`).

### 3. Command failure ≠ Dispatch outcome (required clarity)

`CommandResponse.ok === false` means **the command itself failed to execute**:

```ts
name: 'RequestValidationError' | 'NotFoundError' | 'ValidationError' |
      'ConcurrencyError' | 'ImmutableWriteError' | 'PersistenceError' |
      'HostUnavailableError' | 'InternalError'
```

Worker execution results are **business outcomes, not IPC failures**. A
`worker.dispatch` whose result is `{ outcome: 'REVISION_MISMATCH', ... }` or
`{ outcome: 'CLAIM_REJECTED', ... }` returns `ok: true` with `DispatchResult`
carrying that outcome. This mirrors the existing invariant that Run outcome is
separate from Task status: **Command failure is separate from Dispatch outcome.**

### 4. `worker.cancel` (required change #4)

`worker.cancel` takes `{ executionRequestId }`. The `WorkerHost` owns an active
execution map keyed by `executionRequestId` with a per-execution AbortController,
not a single shared permanent one:

```ts
interface WorkerHost {
  dispatch(request: ExecutionRequest): Promise<DispatchResult>
  cancel(executionRequestId: string): Promise<boolean>
  dispose(): Promise<void>
}
```

This avoids the "cancel permanently aborts the shared controller and poisons the
next dispatch" hazard and future-proofs a `Map<ExecutionRequestId, Execution>`.

### 5. API surface

`CanvasAgentDesktopApi` grows to:

```ts
export interface CanvasAgentDesktopApi {
  getRuntimeInfo(): Promise<RuntimeInfo>
  command(request: CommandRequest): Promise<CommandResponse>
}
```

Renderer components only ever call `window.canvasAgent.command(...)`; they never
receive raw `ipcRenderer`.

## Main / preload changes (architect-owned)

- Preload: expose `command(request)` that validates the argument against
  `commandRequestSchema` before `ipcRenderer.invoke('canvas-agent:command', request)`.
- Main: one `ipcMain.handle('canvas-agent:command', ...)` handler that:
  1. rejects callers that fail `isTrustedSender` (existing helper);
  2. parses `commandRequestSchema` and routes via the registry;
  3. runs the input schema → handler → output schema pipeline;
  4. wraps results into `CommandResponse` with `requestId` + `schemaVersion`.
- Main opens `canvas-agent.db` in `app.getPath('userData')` at startup
  (`openDatabase` + `applyMigrations`) and closes on quit.
- `AppConfig` (sourceRepositoryPath, runtimeDirectory) is read from app-level
  config and is the only path source the WorkerHost may use.

## Renderer migration (Luna-owned, separate packet) — required change #5

Current `CoreFlowFixtureService` has **only `load(): CoreFlowState`**; there is no
`dispatch` on the service. Commands today go through `useReducer(coreFlowReducer,
...)`. So Phase 3 is **not** a service swap; the boundary is split instead:

```ts
interface WorkspaceClient {
  loadProject(): Promise<ProjectView>
  execute<C extends WorkspaceCommand>(command: C): Promise<CommandResult<C>>
}
```

- **Local UI reducer** (interaction commands): `NAVIGATE`, `SET_TAB`,
  `TOGGLE_COMPOSER_ITEM`, search/filter, panel state — stays in the renderer.
- **Remote domain commands** (via `WorkspaceClient.execute` → IPC):
  `FREEZE_SNAPSHOT`, `PUBLISH_VERSION`, `ACCEPT_ARTIFACT`, `COMPLETE_TASK`,
  `ACTIVATE_BASELINE`, `worker.dispatch`.
- Pure UI helpers (`getFreezeBlockers`, `getSelectedContextTokens`,
  `getFlowStage`, `can*Transition`) remain as derived-state functions.

## Security invariants (unchanged or strengthened)

- Renderer stays sandboxed with no Node/fs/process access.
- Every inbound and outbound IPC payload passes a strict, command-correlated Zod
  schema.
- Sender identity is verified before any command runs.
- The worker never touches the app database (DS-002 invariant); the WorkerHost
  never forwards renderer-supplied paths.

## Phasing & ownership

| Phase | Owner | Deliverable |
|---|---|---|
| 0 (this proposal) | DeepSeek → review | contract schemas + API type + route-registry types (after this approval) |
| 1 | Lead architect | main/preload: CommandRouter, WorkspaceService, GitRevisionReader, SQLite boot, `AppConfig`, `command()` preload |
| 2 | Lead architect | `WorkerHost` interface + `UtilityProcessWorkerHost` + `InProcessWorkerHost` (test) + MessagePort relay |
| 3 | Luna | renderer `WorkspaceClient` swap (fixture → IPC), local reducer kept for interaction commands |
| 4 | DeepSeek (data) | first real run via `InProcessWorkerHost`/fixture adapter → observation data for event protocol design |

## Files touched when approved

- `packages/contracts/src/ipc.ts` (or new `command.ts`) — envelope, `CommandMap`,
  correlated schemas, route-registry types, API type.
- `packages/contracts/tests/` — envelope + command-correlation + error/outcome tests.
- Later phases: `apps/desktop/src/main/**`, `apps/desktop/src/preload/**`,
  `apps/desktop/src/worker/**`, `apps/desktop/src/renderer/src/**` (Luna).

## Deferred (unchanged)

- Final RunEvent / ToolInvocation / Checkpoint schemas — after real run data
  (phase 4).
- Multi-worker scheduling, queues, leases; second Agent adapter; real patch apply.
- Workspace → multi-repository binding (`projectId/repositoryId/canonicalPath`).
