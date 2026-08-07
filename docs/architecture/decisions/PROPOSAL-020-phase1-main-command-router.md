# PROPOSAL-020: Phase 1 — main-process command router & workspace service

- **Status:** Proposed (draft for architecture review)
- **Drafted by:** DeepSeek V4 Flash (on request)
- **Owner (implementation):** lead architect
- **Date:** 2026-08-07
- **Depends on:** PROPOSAL-019 (Phase 0 contracts, merged `a80540a`)

## Scope

Implement the main-process side of the real core loop in `apps/desktop/src/main/**`,
fulfilling PROPOSAL-019 Phases 1 while preserving the approved process boundary:

1. `AppConfig` — single configured workspace repository + runtime directory.
2. `WorkspaceService` — SQLite boot (userData) + execution of workspace commands
   through `@canvas-agent/persistence`; id generation; error mapping.
3. `GitRevisionReader` — reads the configured repository revision via
   `@canvas-agent/worker-runtime` `readRepositoryRevision` (renderer stays git-free).
4. `CommandRouter` — single `canvas-agent:command` handler: sender validation,
   schema pipeline (input → handler → output), `CommandError` mapping, tracing.
5. `WorkerHost` interface + `InProcessWorkerHost` (test-only) — `worker.dispatch`
   / `worker.cancel`; production wiring returns `HostUnavailableError` until
   Phase 2 lands `UtilityProcessWorkerHost` (no main-process Worker as production).

**Non-goals (this packet):** `UtilityProcessWorkerHost` (Phase 2), renderer swap
(Phase 3), real Agent adapter, final event protocols.

## Files

```
apps/desktop/src/main/
  config.ts                 AppConfig + load (env override + defaults)
  database.ts               openDatabase/applyMigrations/close (userData)
  workspace-service.ts      command → persistence mapping
  git-revision-reader.ts    readRepositoryRevision wrapper
  worker-host.ts            WorkerHost + InProcessWorkerHost
  command-router.ts         handler + route registry + error mapping
  index.ts                  boot wiring (register handler, open DB, quit cleanup)
  command-router.test.ts    router unit tests
  workspace-service.test.ts service + error mapping tests
  worker-host.test.ts       InProcessWorkerHost tests (temp git repo)
apps/desktop/src/preload/
  index.d.ts                already typed via CanvasAgentDesktopApi (no change needed)
```

No changes to `packages/domain`, `packages/contracts` **except** one small Phase 1
addition below, or to renderer code.

## Design

### 1. AppConfig

```ts
export interface AppConfig {
  sourceRepositoryPath: string   // single configured workspace repo
  runtimeDirectory: string       // isolated worktrees + artifacts + recovery
}
```

- `runtimeDirectory` default: `join(app.getPath('userData'), 'runtime')`.
- `sourceRepositoryPath`: read from `process.env.CANVAS_AGENT_REPO`; if unset or
  not a readable directory with a `.git`, the app fails fast at boot with a clear
  message. Never taken from the renderer.
- `loadConfig(app): AppConfig` is called once during main startup and injected
  into the router.

### 2. WorkspaceService

- Boots `openDatabase(join(userData, 'canvas-agent.db'))` + `applyMigrations`;
  closes on `before-quit`.
- Injects a deterministic id generator + clock for tests (persistence
  `SystemServices`), defaulting to `defaultServices` in production.
- Maps every Phase-0 workspace command to a persistence command. The client never
  supplies ids; the service generates them (`proj_`, `node_`, `nv_`, `task_`,
  `spec_`, `baseline_`, `rev_`, `snap_`).
- Returns persistence rows directly (they already match the contracts output
  schemas).
- **Repository pinning (renderer stays git-free):** before `snapshot.freeze`, the
  service reads the current repository revision via `GitRevisionReader`, upserts
  it (dedup by content triple) and pins the returned `expectedRepositoryRevisionId`
  — unless the request already carries a valid id. To let the renderer reference a
  revision id without running git, Phase 1 adds one command to the contract:

  | command | payload | response |
  |---|---|---|
  | `revision.current` | `{}` | RepositoryRevision row (read + dedup upsert) |

  The renderer calls `revision.current` once, keeps the returned id, and passes it
  to `snapshot.freeze`. `revision.upsert` remains server-only (used internally);
  renderers never send git hashes.

- Error mapping to `CommandError`:
  - `ConcurrencyError` / `ImmutableWriteError` / `ValidationError` /
    `SelfEdgeError` / `CycleError` → same name (subset of the enum).
  - `NotFoundError` → `NotFoundError`.
  - `PersistenceError` → `PersistenceError`.
  - anything else → `InternalError` (never leak stack traces).

### 3. GitRevisionReader

```ts
class GitRevisionReader {
  constructor(private readonly appConfig: AppConfig)
  current(): Promise<ActualRepositoryRevision>
}
```

Wraps `readRepositoryRevision(appConfig.sourceRepositoryPath, gitOptions)` with a
fixed `commandAllowlist: ['git', 'node']`, generous timeout, and `ISOLATED_GIT_ENV`.

### 4. CommandRouter

- `registerIpcHandler(router)` → `ipcMain.handle(DESKTOP_CHANNELS.command, handler)`.
- Handler pipeline:
  1. `isTrustedSender(event.senderFrame)` — reject otherwise (existing helper).
  2. `commandRequestSchema.safeParse(payload)` — on failure return
     `{ ok: false, error: { name: 'RequestValidationError', message, details } }`.
  3. Look up the route in the registry (extended from contracts `commandSchemas`
     with `execute`).
  4. `const data = await route.execute(ctx, parsed.payload)`.
  5. `route.output.safeParse(data)` — on failure → `InternalError` (server bug).
  6. Return `{ requestId, schemaVersion: 1, ok: true, command, data }`.
- Errors thrown by `execute` are mapped by `WorkspaceService`/`WorkerHost` to
  `CommandError`; unexpected throws → `InternalError`.
- Tracing log: `requestId`, `command`, `durationMs`, `ok/outcome` (addresses the
  single-channel DevTools readability note from the review).

Route registry shape (main extends the contracts skeleton):

```ts
type CommandRoute = {
  input: z.ZodType
  output: z.ZodType
  execute: (ctx: CommandContext, payload: unknown) => Promise<unknown>
}
```

### 5. WorkerHost

```ts
export interface WorkerHost {
  dispatch(request: ExecutionRequest): Promise<DispatchResult>
  cancel(executionRequestId: string): Promise<boolean>
  dispose(): Promise<void>
}
```

- `InProcessWorkerHost` (test/dev): owns a `Map<executionRequestId,
  AbortController>` and a `createWorker(...)` built from `AppConfig`
  (runtimeDirectory, sourceRepositoryPath, capabilities `['git','node']`,
  fixture adapter). Each dispatch gets its own controller; `cancel(id)` aborts
  only that execution. Mirrors the per-execution ownership mandated by the review.
- Production wiring: `worker.dispatch` / `worker.cancel` routes are injected with a
  host that returns `HostUnavailableError` until Phase 2 provides
  `UtilityProcessWorkerHost`. No main-process Worker runs in production — the
  approved boundary is honored from the first day.
- `CommandContext` carries `{ appConfig, workerHost }` so the router is fully
  dependency-injected and unit-testable.

## Contract addition (Phase 1)

Add to `packages/contracts/src/command.ts`:

```ts
'revision.current': {
  request: z.object({}).strict(),
  response: z.infer<typeof repositoryRevisionRowSchema>
}
```

Adds one member to `commandRequestSchema`, `commandResponseSchemas`, and
`commandSchemas`, plus a test. Everything else in Phase 0 is unchanged.

## Security invariants

- Renderer stays sandboxed, no Node/fs/process access, no raw IPC.
- Every inbound and outbound payload passes a command-correlated Zod schema.
- Sender identity verified before any command executes.
- Renderer can never supply paths; `AppConfig` is the only path source.
- Worker never touches the app database; single DB writer is the main process.

## Tests

- `command-router.test.ts`: untrusted sender rejected; malformed payload →
  `RequestValidationError`; unknown command → `RequestValidationError`; happy path
  returns `ok:true` with typed data; persistence `ConcurrencyError` → `ok:false`
  `ConcurrencyError`; unexpected throw → `InternalError`.
- `workspace-service.test.ts`: create project/node/task/spec/baseline/snapshot
  through the service with generated ids; `revision.current` reads a temp git repo
  and dedup-upserts; snapshot freeze pins the current revision.
- `worker-host.test.ts`: `InProcessWorkerHost.dispatch` with the fixture adapter
  against a temp repo → `SUCCEEDED`; `cancel(id)` aborts only that execution.
- End-to-end: boot router with temp repo + `InProcessWorkerHost`, run
  project → ... → snapshot.freeze → worker.dispatch → `SUCCEEDED` (same shape as
  the worker-runtime smoke, now through the IPC boundary).

## Verification

```bash
pnpm --filter @canvas-agent/desktop lint
pnpm --filter @canvas-agent/desktop typecheck
pnpm --filter @canvas-agent/desktop test
pnpm --filter @canvas-agent/desktop build
pnpm check
```

## Open questions for review

1. **`revision.current` contract addition** — OK to add (renderer must stay git-free)?
2. **`AppConfig.sourceRepositoryPath` source** — env `CANVAS_AGENT_REPO` with fail-fast
   boot, or a config file / first-run picker? (Proposed: env + fail-fast for now.)
3. **worker.dispatch until Phase 2** — return `HostUnavailableError` (proposed,
   respects the no-main-process-worker ruling) vs shipping `InProcessWorkerHost`
   temporarily in the packaged app (not recommended).

## Handoff

On approval, the architect implements Phase 1 (or delegates). Phase 2
(`UtilityProcessWorkerHost` + MessagePort relay) and Phase 3 (Luna renderer swap)
are separate packets per PROPOSAL-019.
