# Delivery record — Phase 1: main-process command router & workspace service

- **Date:** 2026-08-07
- **Implemented by:** DeepSeek V4 Flash (delegated by the lead architect)
- **Basis:** PROPOSAL-019 (approved with required changes, merged `a80540a`)
  and PROPOSAL-020 (approved with required changes, merged `d1720e4` + `ff01abc`)
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Scope delivered

This packet wires the two backend packages (`@canvas-agent/persistence` +
`@canvas-agent/worker-runtime`) into the Electron main process over the validated
`canvas-agent:command` IPC channel, fulfilling PROPOSAL-020 Phase 1. The renderer
still runs on fixtures (Phase 3); production `worker.dispatch` returns
`HostUnavailableError` until Phase 2 wires the Utility Process.

## Commits

| SHA | Message |
|---|---|
| `ff01abc` | feat(contracts): revision.current in, public revision.upsert out |
| `b8aa24d` | feat(main): real core-loop command router and workspace service |

## Deliverables (`apps/desktop/src/main/**`)

| File | Responsibility |
|---|---|
| `config.ts` | `AppConfig` (`sourceRepositoryPath`, `runtimeDirectory`); `CANVAS_AGENT_REPO` + Git-command validation (realpath, `rev-parse --is-inside-work-tree`, `rev-parse HEAD`); runtime dir under `userData`; bootstrap-only mechanism |
| `database.ts` | SQLite boot (`openDatabase` + `applyMigrations`), injectable migrations folder |
| `security.ts` | `isTrustedSender` (extracted from `index.ts`), electron-free for testability |
| `git-revision-reader.ts` | `revision.current` normalization boundary: rejects no-HEAD as `repository_has_no_head`; least-privilege allowlist `['git']` |
| `workspace-service.ts` | workspace command → persistence mapping; server-side id generation; strict snapshot revision require; error mapping |
| `worker-host.ts` | `WorkerHost` interface + production `UnavailableWorkerHost` (`HostUnavailableError`) |
| `command-core.ts` | electron-free router logic: route registry + `handleCommand` (input → handler → output schema, tracing) |
| `command-router.ts` | `ipcMain.handle('canvas-agent:command')`: sender validation + `handleCommand` |
| `index.ts` | composition root only; fails soft to "workspace unavailable" so the fixture UI still opens |
| `testing/in-process-worker-host.ts` | test/dev `WorkerHost` (per-execution AbortController), never imported by production main |

Plus tests: `command-core.test.ts`, `workspace-service.test.ts`,
`git-revision-reader.test.ts`, `worker-host.test.ts`, and the shared
`testing/git-fixture.ts`.

## Review constraints honored (PROPOSAL-020 required changes)

1. Public IPC exposes `revision.current`; `revision.upsert` removed from the
   public CommandMap (`upsertRepositoryRevision` stays persistence-internal). ✅
2. `snapshot.freeze` strictly requires `expectedRepositoryRevisionId`
   (`NotFoundError` on missing); no silent re-read/substitution. ✅
3. `GitRevisionReader.current()` rejects `baseCommit`/`treeHash === null` →
   `ValidationError` + `details.reason = 'repository_has_no_head'`; no enum
   expansion. ✅
4. AppConfig validates the repository with Git commands, not `.git` shape; paths
   canonicalized with `realpath`. ✅
5. `CANVAS_AGENT_REPO` documented as Phase-1 bootstrap only. ✅
6. Production `worker.dispatch` returns `HostUnavailableError`; `InProcessWorkerHost`
   confined to `src/main/testing/`. ✅
7. `GitRevisionReader` allowlist is `['git']` only. ✅
8. `SelfEdgeError` / `CycleError` map to public `ValidationError` + `details`
   (`reason: 'SELF_EDGE'` / `reason: 'CYCLE'`). ✅

## Supporting package changes

- `packages/contracts/src/command.ts`: export `dispatchResultSchema` +
  `DispatchResult` type; `revision.current` added, `revision.upsert` removed.
- `packages/persistence/src/db.ts`: `applyMigrations(p, migrationsFolder?)` —
  fixes migration loading when persistence is bundled into the Electron main
  bundle (`import.meta.url` no longer points at the source tree).
- Unused-import/param cleanups in `packages/persistence/src/commands/{node,
  repository-revision,task}.ts` and `packages/worker-runtime/src/{worker,
  revision}.ts` (surfaced by the stricter desktop tsconfig).
- `apps/desktop/package.json` + `electron.vite.config.ts`: persistence and
  worker-runtime added as workspace dependencies and bundled into main (excluded
  from `externalizeDeps`).

## Verification

```text
pnpm check  PASS (exit 0)

@canvas-agent/domain         5/5
@canvas-agent/contracts     13/13
@canvas-agent/persistence   33/33
@canvas-agent/worker-runtime 18/18
@canvas-agent/desktop       17/17   (added router/service/revision/host tests;
                                     includes an end-to-end run through the router:
                                     project → node → version → task → spec →
                                     baseline → revision.current → snapshot.freeze
                                     → worker.dispatch(SUCCEEDED) → worker.cancel)
```

Runtime smoke (unpackaged Electron main):

```text
CANVAS_AGENT_REPO=/tmp/…/repo pnpm --filter @canvas-agent/desktop exec electron .
[workspace] ready at /private/tmp/…/repo        ← SQLite boot + migrations OK
```

## How to use

```bash
# real workspace (workspace commands enabled)
CANVAS_AGENT_REPO=/path/to/repo pnpm --filter @canvas-agent/desktop dev

# without env: fixture UI runs; workspace/worker commands return HostUnavailableError
pnpm --filter @canvas-agent/desktop dev
```

## Known limits / next steps

- `worker.dispatch` / `worker.cancel` are `HostUnavailableError` in production —
  Phase 2 replaces `UnavailableWorkerHost` with `UtilityProcessWorkerHost` +
  MessagePort relay (the only remaining gap).
- Renderer still uses fixtures — Phase 3 (Luna) swaps in a `WorkspaceClient`
  over `window.canvasAgent.command`.
- Packaged `.app` migration-folder resolution falls back to `app.getAppPath()/drizzle`;
  shipping the migration SQL inside the packaged app is handled when packaging is
  finalized (extraResources), alongside the worker host.
- `CANVAS_AGENT_REPO` is a Phase-1 bootstrap mechanism, not the final
  workspace-selection UX.
