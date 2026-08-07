# PROPOSAL-022: Phase 3 — Renderer `WorkspaceClient` integration

- **Status:** Proposed (draft for architecture review)
- **Drafted by:** DeepSeek V4 Flash
- **Owner (implementation):** GPT-5.6 Luna (`apps/desktop/src/renderer/**`)
- **Date:** 2026-08-07
- **Depends on:** PROPOSAL-019/020/021 (Phases 0–2 closed:
  `125addb` on `main`)

## Context

Phases 0–2 built the real loop behind the UI:

```text
Renderer → canvas-agent:command (Zod) → Main (WorkspaceService/SQLite, WorkerHost)
        → Utility Process → worker-runtime → isolated Git worktree → DispatchResult
```

The renderer still renders a **typed fixture** (`core-flow-fixture`) driven by a
local `useReducer` (`core-flow-reducer`). Phase 3 migrates the renderer from
fixture-driven durable state to the real `WorkspaceClient → window.canvasAgent.command()`
path while keeping **local ephemeral UI state** in the renderer.

## Goal

1. The UI's **durable domain state** (Project / Node / NodeVersion / Task /
   TaskSpec / Baseline / RepositoryRevision / ContextSnapshot / ExecutionRequest /
   DispatchResult) is loaded and mutated **through IPC**, never via the fixture.
2. **Renderer-local state** (selection, panels, composer draft, editor buffer,
   filters, focus, hover, dialogs) stays in the renderer.
3. The Context Composer commits a single `snapshot.freeze`; the Run screen drives a
   **real `worker.dispatch`** and renders a real `DispatchResult` (patch /
   verification / artifacts).
4. Components are not rewritten wholesale: the reducer is split into a **local UI
   reducer** (interaction commands) and a **remote WorkspaceClient** (domain
   commands), per UI-002's original "command reducer" intent.

## State split (authoritative vs local)

```text
Server-authoritative (via WorkspaceClient)      Renderer-local (ephemeral)
───────────────────────────────────────────     ──────────────────────────
Project / Node / NodeDraft / NodeVersion        selectedNodeId, active panel
Task / TaskSpec / AcceptanceCriterion           composer draft (selected ids,
Baseline / RepositoryRevision                   order, token budget, blockers)
Frozen ContextSnapshot                         node draft / task description
ExecutionRequest / DispatchResult               editor buffer (+ debounce)
                                                filters, hover, focus, dialogs
```

No domain **dual-write**: the renderer never optimistically commits a domain
transition. Optimistic **UX** is allowed only for editor buffers (debounced
`nodeDraft.upsert` with `expectedRevision`; `ConcurrencyError` → local conflict
state, never overwriting the server value).

## Renderer architecture

### `WorkspaceClient` (`src/renderer/src/lib/workspace-client.ts`)

```ts
interface WorkspaceClient {
  command<C extends WorkspaceCommand>(command: C, payload: CommandInput<C>): Promise<CommandOutput<C>>
  // thin wrapper over window.canvasAgent.command, throwing on ok:false
}
```

### `useWorkspace` hook (`src/renderer/src/hooks/use-workspace.ts`)

- Loads the authoritative **project view** (see contract addition below) on mount.
- Exposes `workspace` (domain entities) + `execute<C>(command, payload)` which
  calls `WorkspaceClient`, adopts the returned authoritative entity, and updates
  the projection.
- Keeps local UI state (route, selection, composer draft, editor buffers) separate.

### Reducer split (no wholesale component rewrite)

- Keep a **UI reducer** for interaction commands only: `NAVIGATE`, `SET_TAB`,
  `SELECT_NODE`, `TOGGLE_COMPOSER_ITEM`, `SET_ARTIFACT_TAB`, filters, panel state.
- **Domain commands go through `execute`**: `nodeDraft.upsert` (debounced),
  `nodeVersion.publish`, `taskSpec.publish`, `baseline.createDraft`/`activate`,
  `revision.current`, `snapshot.freeze`, `worker.dispatch`/`cancel`.
- Pure helpers (`getFreezeBlockers`, `getSelectedContextTokens`, `getFlowStage`,
  `can*Transition`) stay as derived functions over authoritative + local state.

## Contract additions (Phase 3, before implementation)

Two small read/coordination commands are needed so the renderer can seed and
refresh without running git or guessing ids:

| command | payload | response |
|---|---|---|
| `project.state` | `{}` | `ProjectStateView` — the authoritative projection the dashboard/outline/task screens need (project + nodes + nodeVersions + active task + spec + active baseline + current revision) |
| `project.seed` | `{ name, description? }` | `ProjectStateView` — creates the project if none exists and returns its state (Phase-3 bootstrap; idempotent per app) |

`ProjectStateView` is a **domain read projection** (entities only, no UI fields)
so Main never returns UI state.

Flow for a new domain mutation (e.g. freeze):

```text
revision.current            → revision row (id + baseCommit/treeHash)
snapshot.freeze({ ..., expectedRepositoryRevisionId: revision.id })
        → frozen snapshot (authoritative)
```

Run flow:

```text
revision.current → revision row
worker.dispatch({ ExecutionRequest built from taskSpec/snapshot/revision })
        → DispatchResult (patch, verificationResults, artifacts)
```

## Screen mapping

| Screen | Source |
|---|---|
| Dashboard / Outline / Node / Task | `ProjectStateView` (authoritative) |
| Context Composer | local composer draft → `snapshot.freeze` (single atomic commit) |
| Run | `worker.dispatch` → real `DispatchResult`; timeline from result |
| Artifact review (accept/reject/request-changes) | **scope-limited** (see below) |
| Complete / Baseline activation | **scope-limited** (see below) |

## Scope limits (explicit)

Persistence has **no Run / Artifact / AcceptanceEvaluation tables yet**
(deferred). Therefore, until a later phase adds those schemas:

- Artifact accept / reject / request-changes and Task completion / Baseline
  activation **stay UI-local** (existing mock semantics), gated by real,
  authoritative inputs where they exist (run outcome, snapshot status).
- The run **result itself** is real (`worker.dispatch`), so the "run produced a
  patch" part of the loop is genuine; the formal review-gate records are the part
  that remains fixture-like until Run/Artifact persistence lands.

This is called out so Phase 3 does not silently fake domain transitions.

## Ownership & files

| File | Owner |
|---|---|
| `src/renderer/src/lib/workspace-client.ts` | Luna |
| `src/renderer/src/hooks/use-workspace.ts` | Luna |
| `src/renderer/src/state/*` (reducer split) | Luna |
| `src/renderer/src/**` screens wiring | Luna |
| `packages/contracts/src/command.ts` (`project.state`/`project.seed` + schemas) | architect (DeepSeek drafts) |
| `apps/desktop/src/main/workspace-service.ts` (state/seed routes) | architect |
| tests | respective owners |

## Tests

- `workspace-client.test.ts`: wraps a fake `window.canvasAgent`, asserts
  `ok:false` throws a typed `WorkspaceError` and `ok:true` returns typed data.
- `use-workspace.test.ts`: seed → projection; a domain command updates the
  projection to the authoritative result; a `ConcurrencyError` on a debounced
  draft upsert surfaces a local conflict state.
- Existing reducer tests are split: UI-only commands stay pure and tested; domain
  commands are asserted to route to `execute`.
- End-to-end (manual): run the app with `CANVAS_AGENT_REPO`, drive
  dashboard → composer → freeze → run from the UI, observe real `DispatchResult`
  rendering.

## Open questions

1. **Seed bootstrap**: `project.seed` creating the MUSICDB project idempotently on
   first run (proposed) vs the renderer calling `project.create` explicitly?
2. **`ProjectStateView` shape**: one projection command (proposed) vs several read
   commands (`project.get`, `node.list`, `task.list`, ...)?
3. **Artifact/complete/activate**: keep them UI-local until Run/Artifact
   persistence (proposed) vs add minimal Run/Artifact tables now (expands scope)?
4. **Run timeline source**: derive timeline from `DispatchResult` +
   worker-runtime recovery metadata (proposed) vs a separate event feed (deferred
   until RunEvent protocol)?

## Handoff

On approval, Luna implements Phase 3 in `apps/desktop/src/renderer/**`; the
architect approves the two contract additions; DeepSeek wires the main-side
`project.state`/`project.seed` routes. After Phase 3, the product loop is real
end-to-end: UI → SQLite → Worker → Git → result → UI.
