# DS-003 — Restore deterministic checks and packaged cold start

## Task owner

DeepSeek V4 Flash — non-visual P0 reliability work. This packet is a lead-approved temporary ownership grant for the exact files below.

- **Branch:** `agent/deepseek-ds-003-release-reliability`
- **Start point:** current reviewed `main`
- **Depends on:** none
- **Blocks:** DS-004, DS-005, DS-006 and UI-003 merge
- **Architecture review:** APPROVED on 2026-08-09 with the clock/smoke constraints in this packet
- **Start gate:** the Product MVP v0.2 planning commit must be pushed to `origin/main`, then this branch starts from that commit

## Goal

Make the current engineering loop honestly releasable: all checks pass deterministically, packaged applications can locate persistence migrations, and CI proves both source and packaged cold-start behavior.

## Read first

- `AGENTS.md`
- `docs/PRODUCT_MVP_V0.2_PLAN.md`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/execution-coordinator.ts`
- `packages/worker-runtime/src/validation.ts`
- `packages/worker-runtime/src/worker.ts`
- `apps/desktop/electron-builder.yml`
- `.github/workflows/ci.yml`

## Authorized files

- `packages/worker-runtime/src/validation.ts`
- `packages/worker-runtime/src/worker.ts`
- adjacent Worker tests needed for clock behavior
- `apps/desktop/src/main/execution-coordinator.test.ts`
- `apps/desktop/src/main/testing/in-process-worker-host.ts` only for optional logical-clock injection used by deterministic Main/Worker tests
- `apps/desktop/src/main/index.ts` only for migration path extraction/wiring and packaged missing-migration fatal exit
- one new adjacent migration-path resolver module and tests under `apps/desktop/src/main/**`
- `apps/desktop/electron-builder.yml`
- `apps/desktop/e2e/**` for packaged smoke
- `apps/desktop/package.json`, root `package.json`, `pnpm-lock.yaml` only if scripts require it
- `.github/workflows/ci.yml`
- one verification record under `docs/verification/**`

No other Main behavior, contract, database shape or renderer file is authorized.

## Required implementation

1. Use the Worker's injected logical wall clock when checking request expiry. Do not change expiry semantics or make old requests valid; eliminate the test-only split between a frozen Main clock and Worker wall clock. Do **not** use a frozen ISO clock for elapsed-duration budgets: expiry/timestamps use the logical wall clock, while budgets/timeouts retain an independent advancing/monotonic source.
2. Add boundary tests proving valid-before-expiry, equal-to-expiry rejection and deterministic coordinator/worker integration.
3. Package `packages/persistence/drizzle/**` as an explicit resource outside asar.
4. Resolve migrations by runtime mode:
   - source/dev/test: existing workspace/source migration directory;
   - packaged: `process.resourcesPath/drizzle` or the exact matching configured resource destination.
5. Extract path selection into a pure testable resolver. Fail fast with a stable diagnostic listing the expected path; do not silently create an empty schema. In packaged mode with a configured repository, a missing migration resource must terminate startup with exit code 1 before a BrowserWindow is created.
6. Add an unsigned unpack/smoke script whose local execution cannot wait for Developer ID/keychain selection. For the installed electron-builder 26.15.3, `-c.mac.identity=null` is the accepted task-local override; verify the build does not invoke keychain identity discovery.
7. Add packaged cold-start smoke using a fresh temp Git repository and isolated `CANVAS_AGENT_USER_DATA`. Capture both stdout and stderr (`[workspace] ready at` is currently written with `console.error`), terminate the positive app after readiness, and inspect the SQLite schema. Add a missing-resource negative fixture that proves the packaged process exits 1, emits the stable diagnostic and creates no application tables.
8. Split CI so the Linux source check stays fast and a macOS job runs Electron live E2E plus unsigned packaged cold start. Upload logs on failure.

## Prohibited scope

- No workspace picker or runtime manager.
- No real Agent adapter.
- No schema/table/command changes.
- No blanket expiry extension or hard-coded future dates as the production fix.
- No deletion or manipulation of local signing certificates.
- No signed/notarized distribution pipeline.

## Acceptance criteria

1. `pnpm check` passes from a clean install and includes all 246 current tests plus new tests.
2. A fixed Main clock and the in-process Worker agree on request validity.
3. A request at or past `expiresAt` is still rejected.
4. Freezing the logical wall clock cannot freeze or disable elapsed budget/timeout behavior.
5. The unpacked macOS app contains the migration SQL at the resolver's packaged location.
6. Cold start with fresh userData creates/applies the schema without migration `ENOENT`.
7. Missing packaged migrations fail with one stable diagnostic and packaged process exit code 1.
8. The smoke build explicitly disables signing for that target and never alters global signing configuration.
9. CI contains a source job and a macOS Electron/package job with no personal secret requirement.

## Required verification

All commands must run under Node 24. `.nvmrc` and `.node-version` already pin `24.14.0`; use the local version-manager/PATH override without committing a machine-specific absolute Homebrew path. Record `node --version` before the command evidence.

```bash
pnpm --filter @canvas-agent/worker-runtime test
pnpm --filter @canvas-agent/desktop test
pnpm check
pnpm --filter @canvas-agent/desktop e2e:live
pnpm --filter @canvas-agent/desktop build:unpack:unsigned
pnpm --filter @canvas-agent/desktop e2e:packaged-smoke
```

Inspect the produced `.app` resource tree and include the exact migration directory in the handoff.

## Handoff additions

Besides the standard handoff contract, report:

- logical-clock source at request creation and validation;
- builder source/destination mapping for migrations;
- packaged process exit/log evidence;
- CI job names and which failures block merge;
- any platform behavior not covered outside macOS.
