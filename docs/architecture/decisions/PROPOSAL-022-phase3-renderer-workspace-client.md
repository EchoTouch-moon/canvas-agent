# PROPOSAL-022: Phase 3 — Renderer `WorkspaceClient` integration

- **Status:** Approved with required changes (architecture review 2026-08-07)
- **Drafted by:** DeepSeek V4 Flash
- **Owner (implementation):** GPT-5.6 Luna (`apps/desktop/src/renderer/**`)
- **Date:** 2026-08-07
- **Depends on:** PROPOSAL-019/020/021 (Phases 0–2 closed: `125addb` on `main`)

## Review verdict

PROPOSAL-022 is **approved with required changes**. The four open questions are
ruled and incorporated below; the following required changes are normative:

1. **Renderer does not build a full `ExecutionRequest`.** A new
   `execution.dispatch` coordination command takes `{ executionRequestId,
   contextSnapshotId }`; Main loads the frozen bindings (snapshot → pinned
   TaskSpecVersion + RepositoryRevision) and builds the ExecutionRequest
   (capabilities / tool policy / budget / runId / attempt / requestHash).
2. **Run never re-reads `revision.current`.** The execution must use the
   repository revision **frozen in the snapshot**. A later repo change is a real
   `REVISION_MISMATCH`, not something to paper over.
3. **`ProjectStateView`** is a persisted read model: **no `currentRevision`, no
   fabricated `activeTask`**; it includes `edges`, `nodeDrafts`, TaskSpec
   aggregates (spec + targets + criteria), Baseline aggregates (baseline + items)
   and `activeBaseline` only from persisted state.
4. **No new Run/Artifact tables in Phase 3.** Artifact accept/reject is a
   **session-only review draft**; `APPLY_ARTIFACT / COMPLETE_TASK /
   ACTIVATE_BASELINE` are **deferred/locked** (no fake domain transitions).
5. **Composer freezes only real server-loaded candidates.** No
   fixture-only `REPOSITORY_CONTENT` / `ARTIFACT` / `PROJECT_RULE` content is
   injected into a real snapshot; repository context retrieval is a future
   `context.resolve` command.
6. **No production auto-seed.** A Main-side, env-gated **demo seed**
   (`CANVAS_AGENT_DEMO_SEED=1`) seeds a complete minimal runnable graph
   (Project → Node → NodeVersion → Task → TaskSpec + criteria → ACTIVE Baseline)
   so the manual E2E can run. Demo seed is not a product domain API.
7. **Timeline = final execution evidence** (result summary). No fabricated
   Queued/Preparing/Running events; a real timeline awaits the RunEvent protocol.
8. **NodeDraft saves** use per-node **serialization + coalescing** (one in-flight
   upsert per node; if the buffer changes during save, the next save uses the
   latest buffer with the returned revision). External `ConcurrencyError` is the
   only conflict source.
9. **Ownership includes `packages/persistence` read-query helpers** (list/get
   APIs that do not exist yet must be added, e.g. `listNodes`, `listNodeVersions`,
   `listEdges`, `listTasks`, `listTaskSpecsWithCriteria`, `listBaselines`).

## Context

Phases 0–2 built the real loop behind the UI:

```text
Renderer → canvas-agent:command (Zod) → Main (WorkspaceService/SQLite, WorkerHost)
        → Utility Process → worker-runtime → isolated Git worktree → DispatchResult
```

The renderer still renders a **typed fixture** (`core-flow-fixture`) driven by a
local `useReducer` (`core-flow-reducer`). Phase 3 migrates the renderer from
fixture-driven durable state to the real `WorkspaceClient →
window.canvasAgent.command()` path while keeping local ephemeral UI state.

## Goal

1. Durable domain state (Project / Node / NodeDraft / NodeVersion / Edge / Task /
   TaskSpec / Baseline / RepositoryRevision / ContextSnapshot) loads and mutates
   **through IPC**, never via the fixture.
2. Renderer-local state stays in the renderer (selection, route, panels, composer
   draft, editor buffers, filters, focus, review draft).
3. The Context Composer commits a single `snapshot.freeze`; the Run screen drives a
   real `execution.dispatch` and renders the real `DispatchResult` as **execution
   evidence**.
4. No domain dual-write, no optimistic domain transitions.

## Three-layer state model

| Layer | Phase 3 status |
|---|---|
| Project / Node / NodeDraft / NodeVersion / Edge / Task / TaskSpec / Criteria / Baseline / RepositoryRevision / ContextSnapshot | **Persisted authoritative** (SQLite) |
| execution identity / DispatchResult / cancel progress | **Runtime-authoritative, session-only** (not recoverable across app restarts) |
| selection / route / panels / editor buffer / composer selection / filters / focus / review draft | **Renderer-local** |

## Execution flow (required #1 + #2)

```text
FREEZE
revision.current            → rev-A row
snapshot.freeze({ ..., expectedRepositoryRevisionId: rev-A.id })
        → FROZEN snapshot pinned to rev-A

RUN
execution.dispatch({ executionRequestId: '<opaque ui id>', contextSnapshotId: snap.id })
        → Main loads snapshot → pinned TaskSpecVersion + RepositoryRevision(rev-A)
        → Main builds ExecutionRequest (capabilities/toolPolicy/budget/runId/attempt/requestHash)
        → WorkerHost → Utility Process → worker-runtime
        → repo still rev-A  → SUCCEEDED / PARTIAL / CANCELLED
        → repo changed to rev-B → REVISION_MISMATCH
```

Renderer never re-reads `revision.current` for the run; it only supplies an opaque
execution id + snapshot id. `execution.cancel({ executionRequestId })` is available
for pending runs.

## Contract additions (Phase 3, before implementation)

| command | payload | response |
|---|---|---|
| `project.state` | `{}` | `ProjectStateView` (persisted read model) |
| `execution.dispatch` | `{ executionRequestId, contextSnapshotId }` | `DispatchResult` |
| `execution.cancel` | `{ executionRequestId }` | `{ cancelled: boolean }` |

(`execution.dispatch`/`execution.cancel` replace the renderer-facing
`worker.dispatch`/`worker.cancel` in the renderer path; the raw worker commands
stay for Main/internal use.)

### `ProjectStateView` (required #3)

```ts
interface ProjectStateView {
  project: Project | null

  nodes: Node[]
  nodeDrafts: NodeDraft[]
  nodeVersions: NodeVersion[]
  edges: Edge[]

  tasks: Task[]

  taskSpecs: Array<{
    spec: TaskSpecVersion
    targets: TaskTarget[]
    criteria: AcceptanceCriterion[]
  }>

  baselines: Array<{
    baseline: ProjectBaseline
    items: BaselineItem[]
  }>

  activeBaseline: ProjectBaseline | null   // from persisted state only
}
```

- **No `currentRevision`** — `ProjectStateView` never triggers a Git read or a
  SQLite write; it is a pure persisted read model. Callers that need the current
  repository revision use `revision.current` explicitly.
- **No fabricated `activeTask`** — the renderer picks `selectedTaskId` locally.

## Renderer architecture

### `WorkspaceClient` (`src/renderer/src/lib/workspace-client.ts`)

```ts
interface WorkspaceClient {
  command<C extends WorkspaceCommand>(command: C, payload: CommandInput<C>): Promise<CommandOutput<C>>
}
```

Thin wrapper over `window.canvasAgent.command`, throwing a typed `WorkspaceError`
on `ok:false`.

### `useWorkspace` hook (`src/renderer/src/hooks/use-workspace.ts`)

- Loads `project.state` on mount; exposes `workspace` + `execute<C>`.
- Domain mutations adopt the authoritative response into the projection.
- Local UI state (route, selection, composer draft, buffers) stays separate.

### Reducer split

- **UI reducer** (local): `NAVIGATE`, `SET_TAB`, `SELECT_NODE`,
  `SET_ARTIFACT_TAB`, composer-draft toggles, filters, panel state.
- **WorkspaceClient** (domain): `nodeDraft.upsert` (debounced, serialized),
  `nodeVersion.publish`, `taskSpec.publish`, `baseline.createDraft`/`activate`,
  `revision.current`, `snapshot.freeze`, `execution.dispatch`/`cancel`.
- Pure helpers (`getFreezeBlockers`, `getSelectedContextTokens`, `getFlowStage`,
  `can*Transition`) stay as derived functions.

### NodeDraft save queue (required #8)

Per node, at most one `nodeDraft.upsert` in flight:

```text
edit A → save queue [A(rev 5)]
A succeeds → server 6
buffer changed while saving → queue [B(latest buffer, expectedRevision 6)]
```

Only an external revision mismatch (not one the client created itself) surfaces a
local conflict state.

## Context Composer (required #5)

Freeze candidates are generated **only from persisted authoritative content** the
renderer already has via IPC:

- TaskSpecVersion (description / scope / criteria) → `USER_INPUT` /
  `TASK_INSTRUCTION` / `P0`.
- Selected NodeVersion (title / body) → `NODE_VERSION` / `PROJECT_FACT` / `P1`.

No fixture-only `REPOSITORY_CONTENT`, `ARTIFACT`, or `PROJECT_RULE` content is
frozen into a real snapshot. Real repository context retrieval is deferred to a
future `context.resolve` (Main reads the repository).

## Review gates (required #4)

Phase 3 adds **no Run/Artifact/Acceptance persistence**:

- Run result: **real** (`execution.dispatch` → `DispatchResult`).
- Artifact accept/reject/request-changes: **session-only review draft** (UI only,
  drives no domain transition).
- `APPLY_ARTIFACT` / `COMPLETE_TASK` / `ACTIVATE_BASELINE`: **deferred / locked**
  in the UI (badge: "deferred until Run/Artifact persistence"), never simulated
  against the real backend.

## Run timeline (required #7)

Phase 3 shows the **final execution evidence** (outcome, patch, verification
results, artifacts, agent summary, recovery) plus a running/cancel state while the
dispatch is pending. It does **not** fabricate Queued/Preparing/Running events; a
real timeline awaits the RunEvent protocol.

## Demo seed (required #6)

Production: `project.state` → empty state → user explicitly `project.create` +
authoring. Phase-3 manual E2E uses a Main-side, env-gated seed:

```text
CANVAS_AGENT_DEMO_SEED=1
```

which seeds a **complete minimal runnable graph** (Project → Node(s) →
NodeVersion(s) → Task → TaskSpecVersion + criteria → ACTIVE Baseline) through the
persistence layer. It is not a renderer IPC API and not part of the product domain
surface.

## Ownership & files

| File | Owner |
|---|---|
| `src/renderer/src/lib/workspace-client.ts` | Luna |
| `src/renderer/src/hooks/use-workspace.ts` | Luna |
| `src/renderer/src/state/*` (reducer split + node save queue) | Luna |
| `src/renderer/src/**` screens wiring | Luna |
| `packages/contracts/src/command.ts` (`project.state`, `execution.dispatch/cancel`, `ProjectStateView` schemas) | architect (DeepSeek drafts) |
| `apps/desktop/src/main/workspace-service.ts` (state / execution routes) | architect |
| `packages/persistence/**` **read-query helpers** (`listNodes`, `listNodeVersions`, `listEdges`, `listTasks`, `listTaskSpecsWithCriteria`, `listBaselines`, ...) | DeepSeek |
| tests | respective owners |

## Tests

- `workspace-client.test.ts`: fake `window.canvasAgent`; `ok:false` → typed
  `WorkspaceError`; `ok:true` → typed data.
- `use-workspace.test.ts`: `project.state` hydration → projection; domain command
  adopts authoritative response; debounced draft `ConcurrencyError` → local
  conflict state (only for external mismatches).
- Reducer split tests: UI-only commands pure; domain commands route to `execute`.
- `execution.dispatch` test: Main builds an ExecutionRequest from the frozen
  snapshot bindings (taskSpec + pinned revision); repo changed after freeze →
  `REVISION_MISMATCH` surfaced.
- Manual E2E: `CANVAS_AGENT_DEMO_SEED=1` + `CANVAS_AGENT_REPO`; drive
  dashboard → composer (real candidates) → freeze → run → evidence rendering.

## Handoff

On approval, Luna implements the renderer changes; the architect approves the
contract additions; DeepSeek adds the persistence read helpers and wires
`project.state` / `execution.dispatch` / the demo seed in Main. After Phase 3 the
product loop is real end-to-end: UI → SQLite → Worker → Git → evidence → UI.
