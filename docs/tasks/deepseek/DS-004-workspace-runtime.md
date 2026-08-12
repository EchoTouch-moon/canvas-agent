# DS-004 — Product workspace runtime and native repository selection

## Task owner

DeepSeek V4 Flash — backend/runtime task. This is a lead-approved temporary delegation across Contracts, Electron Main and Preload for only this packet.

- **Branch:** `agent/deepseek-ds-004-workspace-runtime`
- **Depends on:** DS-003 merged; PROPOSAL-027 approved
- **Blocks:** DS-006 and UI-003

## Goal

Replace the environment-only startup composition with a recoverable, Main-owned, single-workspace runtime that lets a normal user select and reopen a local Git repository without granting the Renderer filesystem authority.

## Read first

- `CONTRIBUTING.md`
- `docs/architecture/decisions/PROPOSAL-027-product-workspace-runtime.md`
- `docs/architecture/decisions/PROPOSAL-027A-workspace-command-contract.md`
- `docs/architecture/decisions/ADR-018-desktop-runtime-and-storage.md`
- `docs/architecture/decisions/PROPOSAL-019-ipc-command-surface.md`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/config.ts`
- `apps/desktop/src/main/command-core.ts`
- `apps/desktop/src/main/command-router.ts`
- `packages/contracts/src/command.ts`
- `packages/contracts/src/ipc.ts`

## Definition of ready

PROPOSAL-027A freezes the public Zod shape. Before implementation, add only the Main-internal route dependency diff to the PR description. Stop for review if implementation requires any public field or reason code beyond the addendum.

## Authorized files

- `packages/contracts/src/command.ts`, `packages/contracts/src/ipc.ts`, `packages/contracts/src/index.ts` and adjacent tests for the approved workspace commands only
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/config.ts`
- `apps/desktop/src/main/command-core.ts`, `command-router.ts`, `command-errors.ts` and adjacent tests
- `apps/desktop/src/main/database.ts`
- new `workspace-runtime-manager.ts`, settings/picker abstractions and adjacent tests under `apps/desktop/src/main/**`
- `apps/desktop/src/preload/**` only if the accepted command surface requires wiring; do not expose raw Electron APIs
- `apps/desktop/e2e/**` for non-visual workspace lifecycle coverage
- `docs/verification/**`

No persistence migration or renderer implementation is authorized.

## Required implementation

1. Implement the lifecycle and coherent runtime tuple frozen by PROPOSAL-027.
2. Serialize open/close/switch operations. A failed candidate open must preserve a current READY runtime.
3. Introduce a picker interface so unit tests do not need Electron UI; production implementation uses Main's native directory dialog bound to a trusted window.
4. Add `workspace.status`, `workspace.chooseRepository`, `workspace.reopenLast`, `workspace.close` with empty path-free payloads.
5. Map lifecycle errors to stable codes; do not expose raw stack traces to Renderer.
6. Move workspace database and runtime paths under `userData/workspaces/<identity>/`.
7. Persist only versioned last-workspace preference using Zod validation and atomic replacement. Corrupt settings degrade to a recoverable no-workspace/error state.
8. Change command dependency resolution so existing project/run commands use the runtime that is READY at invocation time.
9. Add an active-run guard. v0.2 switch/close must not silently cancel an active execution.
10. Reuse one shutdown path for explicit close and application quit.
11. Keep `CANVAS_AGENT_REPO` only as explicit automated-test/developer bootstrap; product startup must work without it.

## Prohibited scope

- No renderer components or styling.
- No arbitrary path input from Renderer.
- No repository clone/create.
- No concurrent active workspaces.
- No automatic deletion/import of the legacy global database.
- No database schema changes.
- No implicit run cancellation, task transition or baseline change.

## Acceptance criteria

1. Fresh startup without environment variables returns `CLOSED/NOT_SELECTED`, not fixture success or a thrown error.
2. Picker cancellation returns a typed non-error outcome and leaves the current runtime unchanged.
3. Unreadable, non-Git and no-HEAD directories are rejected before database creation.
4. Opening a valid repository reaches READY and all existing commands use its scoped database/runtime.
5. Two repositories produce distinct workspace identities and storage roots.
6. Failed switch preserves the original READY workspace.
7. Active execution blocks close/switch with a stable code and does not cancel the run.
8. Close disposes WorkerHost before Persistence; quit uses the same behavior.
9. Restart reopens the last valid repository; a removed last path yields a recoverable state.
10. An untrusted renderer cannot invoke picker or workspace commands.

## Required verification

```bash
pnpm --filter @canvas-agent/contracts test
pnpm --filter @canvas-agent/desktop test
pnpm check
pnpm --filter @canvas-agent/desktop e2e:workspace
```

E2E must cover cancel, choose valid repo, restart/reopen and choose another repo. Invalid path cases may use the picker abstraction in integration tests.

## Handoff additions

Include:

- lifecycle state table and transition evidence;
- exact public schemas and error codes;
- resource dispose order;
- settings file schema and atomic write behavior;
- legacy database behavior;
- proof that no Renderer-controlled path reaches filesystem/Git APIs.
