# DS-003 verification packet — Release Reliability

- **Status:** MERGED — architecture review passed; PR #7 merged to `main@7adc20a`
- **Date:** 2026-08-09
- **Basis:** `docs/tasks/deepseek/DS-003-release-reliability.md` (APPROVED 2026-08-09 with clock/smoke constraints) + Product MVP v0.2 plan Wave 1
- **Branches:** base `main@aafb7a5` (planning freeze) → `agent/deepseek-ds-003-release-reliability`
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Runtime evidence

All commands ran under Node 24. `.nvmrc` / `.node-version` pin `24.14.0`; the local
Homebrew `node@24` resolves to:

```text
node --version
v24.15.0
```

## Requirement → evidence map

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Worker uses the injected logical wall clock for expiry; budgets/timeouts retain an independent monotonic source | `packages/worker-runtime/src/worker.ts`: `validateExecutionRequest(..., { now: Date.parse(now()) })`; budget `startedAt`/`remaining` use `performance.now()` (monotonic, immune to wall-clock rollback). Frozen-clock budget test proves budgets still advance | **PASS** |
| 2 | Boundary tests: valid-before-expiry, equal-to-expiry, deterministic integration | `validation.test.ts` (logical clock 1ms before `expiresAt` → SUCCEEDED; clock == `expiresAt` → VALIDATION_REJECTED); `execution-coordinator.test.ts` passes frozen Main clock into the in-process Worker | **PASS** |
| 3 | A request at or past `expiresAt` is still rejected | equal-to-expiry + pre-existing past-expiry (2020) tests reject with no worktree | **PASS** |
| 4 | Freezing the logical wall clock cannot freeze elapsed budget/timeout | `worker.test.ts` "a frozen logical wall clock cannot freeze the elapsed budget" (frozen ISO clock + 100ms agent step + 1ms budget → `PARTIAL` "budget exceeded"); existing 600ms timeout test still passes | **PASS** |
| 5 | Packaged migrations as explicit resource outside asar | `electron-builder.yml` `extraResources: from ../../packages/persistence/drizzle → to drizzle`; verified at `Contents/Resources/drizzle` with 4 migration folders + `migration.sql` | **PASS** |
| 6 | Resolve by runtime mode; pure testable resolver; fail-fast diagnostic | `apps/desktop/src/main/migration-path.ts` + 5 unit tests (source/workspace, source fallback, packaged `process.resourcesPath/drizzle`, missing-packaged diagnostic lists expected path) | **PASS** |
| 7 | Packaged missing migration → stable diagnostic + exit 1 before BrowserWindow | `index.ts`: `MigrationFolderNotFoundError && app.isPackaged → console.error FATAL + app.exit(1); return` (before `createWindow`). Negative packaged smoke exits 1, no `project` table | **PASS** |
| 8 | Unsigned unpack script, no keychain wait, no global config change | `package.json` `build:unpack:unsigned = pnpm build && electron-builder --dir -c.mac.identity=null`. Build log: `skipped macOS code signing reason=identity explicitly is set to null` (electron-builder 26.15.3) | **PASS** |
| 9 | Packaged cold-start smoke (temp repo + isolated userData, stderr capture, SQLite schema, missing-resource negative on a temp `.app` copy) | `apps/desktop/e2e/packaged-smoke.e2e.cjs` — all 9 steps PASS (below) | **PASS** |
| 10 | CI split: fast Linux source job + macOS Electron/package job, log upload on failure | `.github/workflows/ci.yml`: `check` (ubuntu) + `macos-electron` (macos-latest, needs check) running live E2E → unsigned unpack → packaged smoke, `actions/upload-artifact` on failure, no personal secrets | **PASS** |

## Logical clock source

- **Request creation:** `apps/desktop/src/main/execution-coordinator.ts` `expiresAt = Date.parse(services.now()) + 24h`. Production `defaultServices` uses the real wall clock.
- **Request validation:** `packages/worker-runtime/src/worker.ts` injects the Worker's own `config.now` (default real clock, ISO) into `validateExecutionRequest`.
- **Business timestamps:** Worker recovery metadata (`startedAt`, `interruptedAt`) continue to use `config.now`.
- **Elapsed budgets/timeouts:** independent monotonic `performance.now()` source, immune to wall-clock rollback; covered by a frozen-clock regression test.

## Builder mapping

```text
source: packages/persistence/drizzle
  -> packaged: <app>.app/Contents/Resources/drizzle        (electron-builder extraResources, outside asar)
  -> resolved at runtime from process.resourcesPath/drizzle  (packaged mode)
```

## Packaged cold-start smoke output

```text
[packaged-smoke] app=.../dist/mac-arm64/Canvas Agent.app
[packaged-smoke] Contents/Resources/drizzle = [20260806140031_init, 20260808023009_run-history, 20260808050016_acceptance-evaluation, 20260808084217_result-adoption]
PASS packaged app ships migrations outside asar (Contents/Resources/drizzle)
PASS migration SQL present at the resolver packaged location
PASS packaged cold start reaches the ready signal (stderr captured)
PASS cold start applies migrations (schema created, no ENOENT)
PASS schema includes core app tables (project, audit_log)
PASS missing-resource fixture uses a temp .app copy (main build untouched)
PASS missing migrations terminate the packaged process with exit code 1
PASS stable diagnostic emitted (migration folder not found + FATAL)
PASS no application tables created on fatal exit
[packaged-smoke] ALL PASSED
```

Missing-migration stderr (manual capture, temp `.app` copy only):

```text
[workspace] FATAL: migration folder not found; expected one of:
  - /private/tmp/.../Canvas Agent.app/Contents/Resources/drizzle
exit=1 ; no canvas-agent.db created
```

## Test totals

```text
packages/domain         5   (unchanged)
packages/contracts     41   (unchanged)
packages/persistence   68   (unchanged)
packages/worker-runtime 22  (+3 boundary tests)
apps/desktop           118  (+5 migration-path tests)
-----------------------
total                  254  (baseline 246)
```

## Commands run (all under Node 24)

```text
pnpm --filter @canvas-agent/worker-runtime test     22 passed
pnpm --filter @canvas-agent/desktop test           118 passed
pnpm check                                          format/lint/typecheck/test/build all green
pnpm --filter @canvas-agent/desktop e2e:live        ALL PASSED (restart durability)
pnpm --filter @canvas-agent/desktop build:unpack:unsigned  signing skipped, .app produced
pnpm --filter @canvas-agent/desktop e2e:packaged-smoke    ALL PASSED (9 steps)
```

## CI jobs

- `check` — ubuntu-latest, `pnpm check` (fast source gate). Blocks merge on failure.
- `macos-electron` — macos-latest, `needs: check`; Electron live E2E → unsigned unpack build → packaged cold-start smoke. Blocks merge on failure; step logs uploaded via `actions/upload-artifact@v4` on failure. No personal secret or authenticated credential requirement.

## Platform coverage

- macOS arm64 covered end-to-end (build + live E2E + packaged cold start).
- Not covered outside macOS: Linux/Windows packaged cold start, non-arm64 mac packaging, and signed/notarized distribution (explicitly out of scope). Source-level determinism (clock) is platform-independent and CI-proven on Linux.
