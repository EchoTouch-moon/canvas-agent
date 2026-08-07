# PROPOSAL-019: IPC command surface for the real core loop

- **Status:** Proposed — pending architecture review (owner: lead architect)
- **Author:** DeepSeek V4 Flash
- **Date:** 2026-08-07
- **Supersedes:** nothing (extends ADR-018)

## Context

The MVP core loop is fully implemented as standalone packages:

- `@canvas-agent/persistence` (DS-001): SQLite project facts, immutable
  NodeVersion / TaskSpecVersion / Baseline / ContextSnapshot, audit log.
- `@canvas-agent/worker-runtime` (DS-002): validates an immutable
  `ExecutionRequest`, verifies repository revision, runs an isolated Git worktree,
  returns patch / verification / summary artifacts.

The desktop app still drives the loop with a **typed fixture service + reducer**
and only exposes one IPC channel (`canvas-agent:runtime-info`). The two backend
packages are proven to cooperate (see the new smoke test in `packages/worker-runtime`),
but they are not reachable from the UI. The next milestone is to let the running app
drive the real loop over a validated IPC boundary, which also produces the real
RunEvent / ToolInvocation / Checkpoint observation data that later protocol designs
depend on (scope-register: Enhancements + Future triggers).

This proposal defines the **contract changes only** (renderer migration and the
Utility Process host follow as separate, owned work packets).

## Goal

1. Renderer can issue domain commands (project / node / task / baseline / snapshot)
   that persist to SQLite in the main process and return typed results.
2. Renderer can dispatch a Worker and receive `DispatchResult` artifacts, without
   ever touching Node, Git, filesystem or process APIs.
3. Every IPC payload is runtime-validated with Zod at the boundary; sender identity
   is verified; typed domain errors survive the boundary.
4. The fixture service can later be swapped for an IPC-backed service without
   rewriting the core-flow components (UI-002 intent).

## Non-goals (this proposal)

- No final RunEvent / ToolInvocation / Checkpoint schemas (deferred pending real
  run data).
- No multi-worker scheduling, queues or distributed leases.
- No second Agent adapter.
- No real Git patch application into the source workspace.
- No renderer UI changes in this packet.

## Process topology (target)

```text
Renderer (unprivileged)
   │  invoke('canvas-agent:command', { command, payload })
   │  ← CommandResponse (Zod-validated)
Electron Main (application boundary)
   ├─ WorkspaceService ── @canvas-agent/persistence  (SQLite at app userData)
   ├─ GitRevisionReader ── @canvas-agent/worker-runtime readRepositoryRevision
   └─ WorkerHost (relay) ── Utility Process ── @canvas-agent/worker-runtime createWorker
                                  │ isolated worktree under runtime dir
                                  └ patch / verification / summary artifacts
```

- The **WorkspaceService** owns SQLite and maps each command to a persistence
  command; it is the single writer of project facts.
- The **GitRevisionReader** reads the configured workspace repository revision
  (used to pin snapshots and to build expected revisions).
- The **WorkerHost** owns the Utility Process lifecycle; the Utility Process runs
  `createWorker` from `worker-runtime` (which stays Electron-free). Requests and
  `DispatchResult`s cross a narrow MessagePort protocol; the renderer never sees it.

## IPC contract changes (`@canvas-agent/contracts`)

### 1. Envelope

```ts
// canvas-agent:command request
const commandRequestSchema = z
  .object({
    requestId: z.string().min(1),
    command: workspaceCommandSchema,   // discriminated union below
    schemaVersion: z.literal(1)
  })
  .strict()

// response
const commandOkSchema = z.object({ ok: z.literal(true), data: z.unknown() }).strict()
const commandErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        name: z.enum([
          'NotFoundError',
          'ValidationError',
          'SelfEdgeError',
          'CycleError',
          'ConcurrencyError',
          'ImmutableWriteError',
          'PersistenceError',
          'RequestValidationError',
          'ClaimRejectedError',
          'RevisionMismatchError',
          'WorkerError',
          'UnknownError'
        ]),
        message: z.string(),
        details: z.record(z.string(), z.unknown()).optional()
      })
      .strict()
  })
  .strict()
```

Typed domain errors (e.g. `ConcurrencyError`) are mapped to `{ ok: false, error }`
instead of throwing across IPC; no stack traces leak.

### 2. Workspace commands (initial surface)

| command | payload (Zod) | response data |
|---|---|---|
| `project.create` | `{ name, description? }` | Project row |
| `project.get` | `{ projectId }` | Project row |
| `node.create` | `{ projectId, type, lifecycle? }` | Node row |
| `nodeDraft.upsert` | `{ nodeId, title, body?, expectedRevision? }` | NodeDraft row (rev incremented) |
| `nodeVersion.publish` | `{ nodeId, title, body }` | NodeVersion row (hash, sequence) |
| `task.create` | `{ projectId, type, title }` | Task row |
| `taskSpec.publish` | `{ taskId, description, scope, criteria }` | spec + criteria |
| `baseline.createDraft` | `{ projectId, name, nodeVersionIds }` | Baseline row |
| `baseline.activate` | `{ baselineId }` | activated + superseded |
| `revision.upsert` | `{ baseCommit, treeHash, workingTreePatchHash? }` | Revision row (deduped) |
| `snapshot.freeze` | `{ projectId, taskId, taskSpecVersionId, baseBaselineId, expectedRepositoryRevisionId, items }` | snapshot + items |

Reuse the existing persistence input/output types where possible; the schemas are
declared in `contracts` and the main process runs them through the same persistence
commands.

### 3. Worker commands

| command | payload | response data |
|---|---|---|
| `worker.dispatch` | `executionRequestSchema` (existing) | `dispatchResultSchema` |
| `worker.cancel` | `{ }` | `{ cancelled: boolean }` |

`dispatchResultSchema` mirrors `DispatchResult` from `worker-runtime` (outcome,
claimGranted, revisionMismatch, patch, patchHash, verificationResults, artifacts,
agentSummary, recovery, timedOut, rejectionReason). The renderer receives artifacts
only as descriptors; artifact bytes stay in the runtime directory.

### 4. API surface

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
- Main: register one `ipcMain.handle('canvas-agent:command', ...)` handler that:
  1. rejects callers that fail `isTrustedSender` (existing helper);
  2. parses `commandRequestSchema`;
  3. routes to `WorkspaceService` / `WorkerHost`;
  4. wraps results into `CommandResponse` (validated again by the schemas before return).
- Main opens `canvas-agent.db` in `app.getPath('userData')` at startup and applies
  migrations (`openDatabase` + `applyMigrations`); closes on quit.
- The workspace repository path and runtime directory come from app-level config
  (not renderer input) and are the only paths the WorkerHost may use.

## Utility Process worker host (architect-owned, later packet)

- A small Electron Utility Process entry that imports `createWorker` from
  `worker-runtime` and services `worker.dispatch` / `worker.cancel` over a
  `MessagePortMain` relay.
- `worker-runtime` itself stays Electron-free; the Electron-specific host lives in
  `apps/desktop/src/main` (or `src/worker/`), keeping the security boundary intact.
- The host verifies the request (schema/hash/expiry/capabilities) again before
  claiming, per DS-002 guarantees.

## Renderer migration (Luna-owned, separate packet)

- Swap the fixture service for an IPC-backed service exposing the same shape
  (`load() -> state`, `dispatch(command) -> state`), implemented on top of
  `window.canvasAgent.command`. Core-flow components are not rewritten.
- Because IPC is async, the state container becomes async-loading; the pure helpers
  (`getFreezeBlockers`, `getSelectedContextTokens`, `getFlowStage`) and the
  reducer's validation logic are kept for optimistic/UI-only state.
- Exact dual-write / authoritative-server question is deferred to that packet.

## Security invariants (unchanged or strengthened)

- Renderer stays sandboxed with no Node/fs/process access.
- Every inbound and outbound IPC payload passes a strict Zod schema.
- Sender identity is verified before any command runs.
- The worker never touches the app database (DS-002 invariant), and the
  WorkerHost never forwards renderer-supplied paths.

## Phasing & ownership

| Phase | Owner | Deliverable |
|---|---|---|
| 0 (this proposal) | DeepSeek → review | contract schemas + API type (if approved) |
| 1 | Lead architect | main/preload: WorkspaceService, GitRevisionReader, IPC handler, SQLite boot |
| 2 | Lead architect | Utility Process worker host + MessagePort relay |
| 3 | Luna | renderer IPC-backed service swap (fixture → command) |
| 4 | DeepSeek (data) | first real run with the FixtureAgentAdapter → observation data |

## Open questions for review

1. **Command granularity**: single `canvas-agent:command` channel with a
   discriminated union (proposed) vs per-command channels. Single channel keeps
   validation centralized; per-command is more explicit in DevTools.
2. **Authoritative server vs optimistic local**: should command responses always
   replace UI state (server-authoritative), or should the reducer keep a local
   optimistic copy? Proposed: server-authoritative for commands that mutate state.
3. **Utility Process now vs in-main first**: is a real Utility Process required for
   the first integration, or may the WorkerHost run `createWorker` in the main
   process initially (async spawns, then move to a Utility Process in phase 2)?
4. **Workspace repo path**: single configured repository for the prototype (proposed)
   vs a repository picker surfaced in the UI.

## Files touched when approved

- `packages/contracts/src/ipc.ts` (or new `command.ts`) — schemas + API type.
- `packages/contracts/tests/` — envelope/command schema tests.
- Later phases: `apps/desktop/src/main/**`, `apps/desktop/src/preload/**`,
  `apps/desktop/src/renderer/src/**` (Luna), `apps/desktop/src/worker/**`.
