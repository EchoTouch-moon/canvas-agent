# PROPOSAL-020: Phase 1 — main-process command router & workspace service

- **Status:** Approved with required changes (architecture review 2026-08-07)
- **Owner (implementation):** lead architect
- **Drafted by:** DeepSeek V4 Flash
- **Date:** 2026-08-07
- **Depends on:** PROPOSAL-019 (Phase 0 contracts, merged `a80540a`)

## Review verdict

PROPOSAL-020 is **approved with required changes**. The three open questions were
ruled:

| # | Question | Ruling |
|---|---|---|
| 1 | `revision.current` | **Add it, and remove `revision.upsert` from the public renderer CommandMap.** `upsertRepositoryRevision` stays an internal Main/Persistence capability |
| 2 | AppConfig source | **`CANVAS_AGENT_REPO` + fail-fast** for Phase 1; explicitly a prototype bootstrap, not the final workspace-selection UX |
| 3 | worker.dispatch until Phase 2 | **Production wiring returns `HostUnavailableError`**; `InProcessWorkerHost` exists only in test/dev support code |

Required changes before/while implementing (no further proposal needed):

1. Public IPC exposes `revision.current`; **`revision.upsert` is removed from the
   public CommandMap** (`upsertRepositoryRevision` remains persistence-internal).
2. `snapshot.freeze` strictly requires the given `expectedRepositoryRevisionId`
   (`requireRepositoryRevision`, else `NotFoundError`). It must **not** silently
   re-read and substitute the current revision; a later repo change is a valuable
   `REVISION_MISMATCH` domain event, not something to paper over.
3. `GitRevisionReader.current()` is a normalization boundary: it rejects
   `baseCommit`/`treeHash === null` (no HEAD / git failure) by mapping to
   `ValidationError` with `details.reason = 'repository_has_no_head'`. No
   `CommandError` enum expansion for this.
4. `AppConfig` validates the repository with **Git commands**
   (`git rev-parse --is-inside-work-tree`, `git rev-parse HEAD`), not by checking
   that `.git` is a directory (it may be a file in worktrees). Paths are
   canonicalized with `realpath` once at load; `runtimeDirectory` is created and
   checked writable.
5. `CANVAS_AGENT_REPO` is a **Phase-1 bootstrap mechanism only**, not the final
   product workspace-selection UX. Documented as such.
6. Production `worker.dispatch` returns `HostUnavailableError` until Phase 2;
   `InProcessWorkerHost` is confined to test/dev support code (a `testing/`
   module) so production main never imports `createWorker`/fixture adapters.
7. `GitRevisionReader` allowlist is **`['git']` only** (least privilege; `node` is
   a worker-capability, not a revision-reader capability).
8. Error mapping: `SelfEdgeError` / `CycleError` map to the public
   **`ValidationError` + `details`** (`reason: 'SELF_EDGE'` / `reason: 'CYCLE'`).
   Do not pretend they have entries in the current `CommandError` enum.

## Scope

Implement the main-process side of the real core loop in `apps/desktop/src/main/**`:

1. `AppConfig` — single configured workspace repository + runtime directory.
2. `WorkspaceService` — SQLite boot (userData) + workspace command execution via
   `@canvas-agent/persistence`; id generation; error mapping.
3. `GitRevisionReader` — reads the configured repository revision via
   `@canvas-agent/worker-runtime` (renderer stays git-free); normalization boundary.
4. `CommandRouter` — single `canvas-agent:command` handler: sender validation,
   schema pipeline (input → handler → output), `CommandError` mapping, tracing.
5. `WorkerHost` interface + production `UnavailableWorkerHost` (returns
   `HostUnavailableError`); `InProcessWorkerHost` in a `testing/` module only.

**Non-goals:** `UtilityProcessWorkerHost` (Phase 2), renderer swap (Phase 3), real
Agent adapter, final event protocols.

## Files

```
apps/desktop/src/main/
  config.ts                 AppConfig + load (env override + fail-fast, realpath)
  database.ts               openDatabase/applyMigrations/close (userData)
  security.ts               isTrustedSender (extracted from index.ts)
  workspace-service.ts      command → persistence mapping + error mapping
  git-revision-reader.ts    readRepositoryRevision wrapper (allowlist ['git'],
                            rejects null head)
  worker-host.ts            WorkerHost interface + UnavailableWorkerHost
  command-router.ts         handler + route registry
  index.ts                  composition root only
  command-router.test.ts    router unit tests
  workspace-service.test.ts service + error mapping tests
  testing/
    in-process-worker-host.ts   test/dev InProcessWorkerHost (createWorker + fixture)
apps/desktop/src/preload/
  index.d.ts                already typed via CanvasAgentDesktopApi (no change)
```

## Design

### 1. AppConfig

```ts
export interface AppConfig {
  sourceRepositoryPath: string   // canonical absolute path
  runtimeDirectory: string       // isolated worktrees + artifacts + recovery
}
```

- `runtimeDirectory` default: `join(app.getPath('userData'), 'runtime')`, created
  and verified writable at boot.
- `sourceRepositoryPath` from `process.env.CANVAS_AGENT_REPO`. Boot validation
  uses Git, not `.git` shape: `realpath`, `git rev-parse --is-inside-work-tree`,
  `git rev-parse HEAD` must succeed, else fail fast with a clear message.
- **Bootstrap-only:** `CANVAS_AGENT_REPO` is a Phase-1 mechanism, not the final
  workspace-selection UX. A later `ConfigProvider`
  (`EnvironmentConfigProvider` → `WorkspaceSettingsProvider`) is the future path;
  do not build it now.

### 2. WorkspaceService

- Boots `openDatabase(join(userData, 'canvas-agent.db'))` + `applyMigrations`;
  closes on `before-quit`. Single DB writer in the app.
- Injects deterministic id generator + clock in tests; `defaultServices` in prod.
- Maps workspace commands to persistence commands; generates ids
  (`proj_`, `node_`, `nv_`, `task_`, `spec_`, `baseline_`, `rev_`, `snap_`).
- **`revision.current`** (public): `GitRevisionReader.current()` → normalize →
  `upsertRepositoryRevision` (dedup) → return the row. Renderer never sends git
  hashes; `revision.upsert` is **not** exposed on IPC.
- **`snapshot.freeze`**: `requireRepositoryRevision(expectedRepositoryRevisionId)`
  — missing → `NotFoundError`. No silent re-read/substitution of the current
  revision.
- Error mapping to the public `CommandError` (stable small taxonomy):
  - `ConcurrencyError` → `ConcurrencyError`
  - `ImmutableWriteError` → `ImmutableWriteError`
  - `NotFoundError` → `NotFoundError`
  - `ValidationError` → `ValidationError`
  - `SelfEdgeError` → `ValidationError` + `details.reason = 'SELF_EDGE'`
  - `CycleError` → `ValidationError` + `details = { reason: 'CYCLE', relation, startNodeId, endNodeId }`
  - `PersistenceError` → `PersistenceError`
  - anything else → `InternalError` (never leak stack traces)

### 3. GitRevisionReader

```ts
class GitRevisionReader {
  constructor(private readonly appConfig: AppConfig)
  async current(): Promise<ResolvedRepositoryRevision>
}
```

- Wraps `readRepositoryRevision(sourceRepositoryPath, gitOptions)` with
  `commandAllowlist: ['git']`, `ISOLATED_GIT_ENV`, generous timeout.
- **Normalization boundary:** if `baseCommit === null || treeHash === null`, throw
  a `ValidationError`-style error with `reason: 'repository_has_no_head'` (mapped
  to `ValidationError` at the router). Never returns nulls to callers.

### 4. CommandRouter

- `security.ts` exports `isTrustedSender` (extracted from `index.ts`).
- Handler pipeline: sender check → `commandRequestSchema.safeParse` → route lookup
  → `execute(ctx, payload)` → `route.output.safeParse(data)` → response.
  - Malformed/unknown command → `{ ok: false, error: RequestValidationError }`.
  - Output mismatch → `InternalError` (server bug).
- Tracing: `requestId`, `command`, `durationMs`, `ok/outcome`.
- Route registry extends contracts `commandSchemas` with `execute`.

### 5. WorkerHost

```ts
export interface WorkerHost {
  dispatch(request: ExecutionRequest): Promise<DispatchResult>
  cancel(executionRequestId: string): Promise<boolean>
  dispose(): Promise<void>
}
```

- **Production wiring (Phase 1):** `UnavailableWorkerHost` — `dispatch`/
  `cancel` return `HostUnavailableError` / `false`. A legal intermediate state:
  project/node/task/snapshot/revision work; Worker Run reports "host not available".
- **Test/dev:** `testing/in-process-worker-host.ts` — per-execution
  `AbortController` map over `createWorker(...)`, built from `AppConfig` + fixture
  adapter. Production `main/` never imports it.

## Security invariants

- Renderer stays sandboxed, no Node/fs/process access, no raw IPC.
- Every inbound/outbound payload passes a command-correlated Zod schema.
- Sender identity verified before any command executes.
- Renderer never supplies paths; `AppConfig` is the only path source.
- Worker never touches the app database; single DB writer is the main process.
- Least privilege: revision reader allowlist is `['git']`.

## Contract addition (Phase 1, applied)

`packages/contracts/src/command.ts`:

```ts
'revision.current': {
  request: z.object({}).strict(),
  response: z.infer<typeof repositoryRevisionRowSchema>
}
```

and `'revision.upsert'` is **removed** from `CommandMap`, `commandRequestSchema`,
`commandResponseSchemas`, and `commandSchemas`. Tests cover that `revision.current`
parses and `revision.upsert` is rejected as an unknown command.

## Tests

- `command-router.test.ts`: untrusted sender rejected; malformed/unknown command →
  `RequestValidationError`; happy path `ok:true` typed; `ConcurrencyError` and
  `SelfEdgeError`/`CycleError` mapping; unexpected throw → `InternalError`.
- `workspace-service.test.ts`: create project/node/task/spec/baseline/snapshot with
  generated ids; `revision.current` reads a temp repo and dedup-upserts;
  `snapshot.freeze` with a missing revision → `NotFoundError` (no silent
  substitution).
- `git-revision-reader.test.ts`: normal repo → resolved revision; empty repo (no
  HEAD) → `repository_has_no_head` error.
- `worker-host.test.ts`: `InProcessWorkerHost` dispatch with fixture adapter →
  `SUCCEEDED`; `cancel(id)` aborts only that execution; `UnavailableWorkerHost`
  returns `HostUnavailableError`.
- End-to-end: boot router with temp repo + `InProcessWorkerHost`; run
  project → ... → `revision.current` → `snapshot.freeze` → `worker.dispatch`.

## Verification

```bash
pnpm --filter @canvas-agent/desktop lint
pnpm --filter @canvas-agent/desktop typecheck
pnpm --filter @canvas-agent/desktop test
pnpm --filter @canvas-agent/desktop build
pnpm check
```

## Handoff

Phase 2 replaces `UnavailableWorkerHost` with `UtilityProcessWorkerHost` +
MessagePort relay (the only remaining gap). Phase 3 (Luna) swaps the renderer
fixture for a `WorkspaceClient` over `window.canvasAgent.command`.
