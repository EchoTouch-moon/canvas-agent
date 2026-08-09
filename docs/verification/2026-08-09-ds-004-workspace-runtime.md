# DS-004 verification packet — Workspace runtime & native repository selection

- **Status:** MERGED — LEAD APPROVED `c6d8f19`; PR #8; `main@7cbaf18`
- **Date:** 2026-08-09
- **Basis:** PROPOSAL-027 (workspace runtime), PROPOSAL-027A (workspace command contract), `docs/tasks/deepseek/DS-004-workspace-runtime.md` incl. the LEAD mandatory addendum
- **Branches:** base `main@8276e48` → `agent/deepseek-ds-004-workspace-runtime`
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Runtime evidence

All commands ran under Node 24 (`.nvmrc`/`.node-version` pin `24.14.0`):

```text
node --version
v24.15.0
```

## Acceptance criteria → evidence

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | Fresh startup without env vars returns `CLOSED/NOT_SELECTED`, no fixture success, no throw | manager initial `{ state: CLOSED, activeWorkspace: null, lastError: null }`; `startup()` with no bootstrap + no settings stays CLOSED; e2e `C fresh status is CLOSED` | **PASS** |
| 2 | Picker cancellation returns typed non-error outcome, current runtime unchanged | `chooseRepository` → `{ cancelled: true, status: <prior> }` with no new `lastError`; unit test asserts byte-for-byte equality; e2e C | **PASS** |
| 3 | Unreadable / non-Git / no-HEAD rejected before DB creation | `validateRepository` typed result (`PATH_UNREADABLE` / `NOT_GIT_WORKTREE` / `MISSING_HEAD`); manager test asserts `userData/workspaces` never created | **PASS** |
| 4 | Valid repo reaches READY; existing commands use scoped DB/runtime | manager `doOpen` assembles the tuple and serves routes at invocation time; full-flow command-core test + e2e D | **PASS** |
| 5 | Two repositories → distinct identities and storage roots | `workspaceIdentity = sha256(realpath)`; unit test + e2e E (identity 64-hex, distinct DB paths) | **PASS** |
| 6 | Failed switch preserves the original READY runtime | `doOpen` validation failure → `failOpen(held)` keeps `READY` + original summary + typed `lastError`; manager test | **PASS** |
| 7 | Active execution blocks close/switch with stable code, no cancel | `ACTIVE_RUN_BLOCKS_SWITCH` when `activeRuns > 0` on both `close()` and `doOpen()`; tests assert worker `cancelled === 0` | **PASS** |
| 8 | Close disposes WorkerHost before Persistence; quit uses the same path | `disposeRuntime` awaits `workerHost.dispose()` then `closeDatabase()`; `before-quit` one-shot gate calls `manager.close()` and only re-quits on `CLOSED` | **PASS** |
| 9 | Restart reopens last valid repo; removed path → recoverable state | `startup()` order: `CANVAS_AGENT_REPO` → `reopenLast()` → CLOSED; e2e R auto-reopens; missing last → `ERROR` `PATH_UNREADABLE`; corrupt settings → `ERROR` `SETTINGS_INVALID` (file preserved) | **PASS** |
| 10 | Untrusted renderer cannot invoke picker or workspace commands | router gates every command through `isTrustedSender(event.senderFrame)`; `security.test.ts` (file:/dev-origin/foreign/null); picker bound to the requesting trusted window | **PASS** |

## Lifecycle state table

| Public state | Meaning | Active workspace | Project/execution commands |
|---|---|---|---|
| `CLOSED` | no runtime | none | HostUnavailableError |
| `OPENING` | candidate open in progress (holds prior runtime if switching) | prior summary (if held) | HostUnavailableError |
| `READY` | coherent tuple active | current summary | served (execution via atomic run lease) |
| `CLOSING` | close in progress | closing summary | HostUnavailableError |
| `ERROR` | failed open with no runtime | none | HostUnavailableError |

Transitions: `CLOSED → OPENING → READY`, `ERROR → OPENING → READY`, `READY → CLOSING → CLOSED`.
A failed candidate open re-enters `READY` (with the held runtime) or `ERROR`. A concurrent
lifecycle op during a transition returns `OPERATION_IN_PROGRESS`. An active run blocks
`close`/switch with `ACTIVE_RUN_BLOCKS_SWITCH`; the run is never cancelled and `execution.cancel`
remains callable (it does not acquire a run lease).

## Error reason codes (public)

`PATH_UNREADABLE`, `NOT_GIT_WORKTREE`, `MISSING_HEAD`, `RUNTIME_NOT_WRITABLE`, `SETTINGS_INVALID`,
`DATABASE_OPEN_FAILED`, `WORKER_DISPOSE_FAILED`, `ACTIVE_RUN_BLOCKS_SWITCH`,
`OPERATION_IN_PROGRESS`, `PICKER_FAILED`, `UNKNOWN`.

Expected lifecycle failures return a legal `WorkspaceRuntimeStatus` + `lastError`; only
unexpected internal exceptions reach the generic command error envelope. Picker cancel never
adds a `lastError`. A successful status-changing operation clears the prior `lastError`.

## Public schemas (PROPOSAL-027A, verbatim)

`workspace.status/chooseRepository/reopenLast/close` — all strict empty-object payloads.
Inferred exports are exactly the five PROPOSAL-027A types (`WorkspaceLifecycle`,
`WorkspaceErrorReason`, `WorkspaceSummary`, `WorkspaceOperationError`, `WorkspaceRuntimeStatus`);
`workspaceChooseResultSchema` remains for the command envelope and its shape is inferred by
Main via `CommandOutput<'workspace.chooseRepository'>`. No `superRefine`, no extra public field,
no preload method added (`CanvasAgentDesktopApi` unchanged).

## Resource dispose order & transactional candidate assembly

- Candidate open: enter `OPENING` synchronously **before the first `await`** (after the
  `activeRuns` guard) so no new run/command lease can acquire the held runtime → `waitForIdle()`
  → validate (no side effect) → `mkdir` runtime dir + writability → `openWorkspaceDatabase`
  (migration failure closes the opened Persistence — `database.ts` fix) → assemble
  `revisions/workspace/workerHost/coordinator` → write settings (part of the commit) →
  dispose held runtime → `READY`.
- On any failure after the Persistence opens, dispose `workerHost` then `closeDatabase` in
  reverse order and `failOpen` (preserving a held runtime and the prior last-workspace path).
- A failed candidate never tears down the held runtime and never overwrites the last-workspace
  path; a settings **write** failure rolls the open back with `RUNTIME_NOT_WRITABLE`.
- `close()` and `before-quit` share the same `manager.close()` path.

## Settings file

`settings-v1.json` (Zod: `{ schemaVersion: 1, lastRepositoryPath: string | null }` strict),
written via temp file + atomic rename, no credentials. A failed write removes the temp file
(best effort) and throws a typed `SettingsWriteError` that the manager maps to
`RUNTIME_NOT_WRITABLE`. Corrupt/invalid file is preserved for diagnosis and yields
`SETTINGS_INVALID` (recoverable), never an arbitrary open.

## Storage layout & legacy DB

```text
userData/settings-v1.json
userData/workspaces/<sha256(realpath(repo))>/{canvas-agent.db,runtime/}
```

The pre-v0.2 global `userData/canvas-agent.db` is left untouched (no deletion, no import).
A moved repository is a new identity in v0.2; relinking is deferred.

## Renderer path-trust proof

No renderer-supplied path reaches filesystem/Git APIs: all four workspace commands take strict
empty payloads, `chooseRepository` uses the native dialog (or the E2E-only seam), and the picker
value is validated by Main (`realpath`, readability, Git worktree, HEAD) before any database or
Git access. `displayPath` is output-only.

## E2E — workspace lifecycle (real Electron IPC via the preload bridge)

`pnpm --filter @canvas-agent/desktop e2e:workspace` (test-picker seam, `CANVAS_AGENT_E2E=1` +
isolated `CANVAS_AGENT_USER_DATA`):

```text
PASS C fresh status is CLOSED without env vars
PASS C picker cancel returns a typed cancelled result
PASS C cancel keeps the prior status byte-for-byte (CLOSED, no lastError)
PASS D chooseRepository reaches READY
PASS D READY summary shows the chosen repository
PASS D workspace.status is READY with the active summary
PASS D workspace.close returns CLOSED
PASS D status is CLOSED with no active workspace after close
PASS R startup auto-reopens the last repository
PASS E chooseRepository switches to the second repository
PASS E active workspace is now repository B (distinct identity)
PASS P packaged .app opens a temp repo via test picker
[e2e:workspace] ALL PASSED
```

Invalid-path cases (unreadable/non-Git/no-HEAD) are covered by manager integration tests
through the picker abstraction, per the packet.

## Regression gates (DS-003 + earlier)

```text
pnpm --filter @canvas-agent/desktop e2e:live          ALL PASSED (restart durability intact)
pnpm --filter @canvas-agent/desktop build:unpack:unsigned  signing skipped, .app produced
pnpm --filter @canvas-agent/desktop e2e:packaged-smoke     ALL PASSED (10 steps; DB path now
                                                              scoped to userData/workspaces/<id>/)
```

## Test totals

```text
packages/domain          5   (unchanged)
packages/contracts      48   (+7 workspace command tests)
packages/persistence    68   (unchanged)
packages/worker-runtime 22   (unchanged)
apps/desktop           161   (+43: manager 19, settings 6, picker 4, security 4, config 5,
                             command-router 3, command-core +2)
-----------------------
total                  304   (baseline 254)
```

## Commands run (all under Node 24, rev 3)

```text
pnpm --filter @canvas-agent/contracts test    48 passed
pnpm --filter @canvas-agent/desktop test     161 passed
pnpm check                                   format/lint/typecheck/test/build all green
pnpm --filter @canvas-agent/desktop e2e:workspace    ALL PASSED
pnpm --filter @canvas-agent/desktop e2e:live         ALL PASSED
pnpm --filter @canvas-agent/desktop build:unpack:unsigned  PASS
pnpm --filter @canvas-agent/desktop e2e:packaged-smoke     ALL PASSED
```

Full workspace/packaged E2E was re-run on the revised SHA after each PR #8 review round.

## Scope disclosure (narrow add-on authorization, accepted by lead)

The DS-004 packet whitelist did not originally list `apps/desktop/package.json` or
`.github/workflows/ci.yml`. Both were modified as narrow, necessary add-ons and the lead
accepted them during PR #8 review:
- `apps/desktop/package.json` — adds the required `e2e:workspace` script.
- `.github/workflows/ci.yml` — adds the `e2e:workspace` step to the macOS job (after the
  unsigned unpack build). No signing or personal-secret requirement.

All other modified/new files are within the DS-004 whitelist. `packages/contracts/src/ipc.ts`
(Preload API) was **not** modified; the `CanvasAgentDesktopApi` surface remains exactly
`{ getRuntimeInfo, command }` (a source-level fact, verified by inspection, not claimed as a
contract test). The former contract test named "keeps the Preload desktop API surface unchanged"
was removed and replaced with a truthful schema round-trip test.

## PR #8 blocking review — fixes (rev 2)

| Review item | Fix | Evidence |
|---|---|---|
| P1-1 `OPENING` set too late; switch could race a newly started run | `doOpen` enters `OPENING` synchronously before the first `await` (after the `activeRuns` guard), so no new run/command can acquire the held runtime during validation/assembly | manager test "blocks new run/command leases while a switch is OPENING (opposite-order race)" — `withActiveRun`/`withReadyRuntime` reject during `OPENING`, switch completes to repo B |
| P1-2 async workspace commands need leases | `workspaceRoute` executes under `manager.withReadyRuntime(...)` (general READY-runtime lease); `close()`/`doOpen()` enter `CLOSING`/`OPENING` then `await waitForIdle()` before disposing. `execution.cancel` remains exempt (direct `getReadyRuntime`) | manager test "close waits for in-flight workspace commands to release their runtime lease" — close stays `CLOSING` until the leased command finishes, then `CLOSED` |
| P1-3 settings write failure reported as success | `settings.writeLast` moved into the candidate commit: a write failure rolls the open back (candidate worker/DB cleaned in reverse order), keeps the held runtime, sets a typed `lastError`, and does not overwrite the prior last-workspace preference | manager test "a settings write failure rolls the open back and preserves the held runtime" — READY with repo A + `UNKNOWN` lastError after a forced settings rename failure |
| P1-4 bare repositories pass the worktree check | `validateRepository` now requires `git rev-parse --is-inside-work-tree` stdout to equal exactly `true` (bare repos exit 0 printing `false`), checks the path is a directory, and keeps the HEAD check | `config.test.ts` — bare repo → `NOT_GIT_WORKTREE`; plain file/missing path → `PATH_UNREADABLE`; valid worktree accepted |

## PR #8 review round 2 — fixes (rev 3)

| Review item | Fix | Evidence |
|---|---|---|
| Settings rename failure leaves `.tmp` and maps to generic `UNKNOWN` | `writeLast` removes the temp file in a `finally`-style catch and throws a typed `SettingsWriteError`; the manager maps it to `RUNTIME_NOT_WRITABLE` and rolls the open back | `workspace-settings.test.ts` "a failed atomic write throws SettingsWriteError and leaves no temp file"; manager test asserts `RUNTIME_NOT_WRITABLE` + no `.tmp` leftover |
| `chmod 000` repo escapes as `spawn git EACCES` | `validateRepository` probes `access(canonical, R_OK \| X_OK)` before any Git call and `runGitOutput` catches spawn/cwd errors → stable `PATH_UNREADABLE` | `config.test.ts` "rejects a permission-denied repository as PATH_UNREADABLE without a spawn EACCES throw" (chmod 000, restored in `finally`); the "path missing" test is kept as a distinct case, not reused as permission evidence |
| Main-frame guard lacks a real IPC regression test | `command-router.test.ts` mocks `electron` (`ipcMain.handle` / `BrowserWindow.fromWebContents`) and drives the captured handler: trusted `file:` **subframe** rejected before `fromWebContents`; untrusted origin rejected; trusted **main frame** served through the real `handleCommand` path | router tests (3): subframe → throw `/non-main renderer frame/`, `fromWebContents` not called; evil origin → throw `/untrusted renderer/`; main frame → `{ ok: true, state: CLOSED }` |
| P1-5 packaged mode trusts any `file:` frame | `command-router` rejects IPC when `event.senderFrame !== event.sender.mainFrame` before associating the sender with a `BrowserWindow`/picker | `command-router.ts` guard; `security.test.ts` continues to gate trusted origins |
| P2-6 extra frozen-contract export | removed `export type WorkspaceChooseResult` (PROPOSAL-027A authorizes only the five inferred types); `workspaceChooseResultSchema` remains for the command envelope; Main types the result inline | `packages/contracts/src/command.ts`; no `WorkspaceChooseResult` references remain |

Also strengthened the test-picker strict parsing tests (exact `__CANCEL__` sentinel, no
trimming; whitespace value is treated as a path, never cancel).

## Main-internal route dependency addendum (PR description)

1. `handleCommand(routes, payload, context?)` — carries the requesting `BrowserWindow` for
   picker binding (replaces sender-inference).
2. `buildRoutes({ manager })` — project/execution commands resolve the current `READY` runtime
   through manager leases at invocation time (replaces fixed nullable `workspace`/`coordinator`).
3. **Atomic run lease + general READY-runtime lease** — `manager.withActiveRun(run)` increments
   the run counter synchronously before the first `await` and releases in `try/finally`;
   `execution.dispatch` goes through it, `execution.cancel` does not (callable during an active
   run). Every `workspaceRoute` command runs under `manager.withReadyRuntime(...)`; `close`/switch
   wait for in-flight leases before disposing. `acquireLease` checks `getReadyRuntime()` and
   increments in one synchronous step, so there is no check-then-acquire race.
4. Test-picker seam — `CANVAS_AGENT_TEST_PICKER` (path or `__CANCEL__`, strictly parsed) is
   honored only when `CANVAS_AGENT_E2E=1` **and** an isolated `CANVAS_AGENT_USER_DATA` is set;
   the value never reaches IPC payload, Preload API or Renderer. Also `workerHostFactory` option
   for unit tests (defaults to `UtilityProcessWorkerHost`).
