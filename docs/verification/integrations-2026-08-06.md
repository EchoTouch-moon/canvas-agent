# Wave 1 + 2 integration verification — 2026-08-06

## Result

All three cross-computer implementations were reviewed and merged into `main`.
The repository is **integration-gate ready** for UI-002.

## Environment

- macOS arm64
- Node.js 24.15.0 (project requires >=24.0.0)
- pnpm 11.x with the checked-in frozen lockfile

## Integrated commits on `main`

| Integration | Merge commit | Base task |
|---|---|---|
| DS-001 SQLite persistence foundation | `50d4c1f` | `packages/persistence/**` |
| DS-002 isolated Worker runtime | `2bf86e8` | `packages/worker-runtime/**` |
| UI-001 UI foundation | `c54e15c` | `apps/desktop/src/renderer/**` |
| UI-002 core flow prototype | `79ad0a5` | `apps/desktop/src/renderer/**` |
| Task board / readiness coordination | `ca1452f` | `docs/tasks/**` |

Each merge used `--no-ff`; reviewers confirmed the exclusive-ownership file scope for
every task (no cross-owner edits).

## Gate per package

```text
@canvas-agent/domain         typecheck PASS, 5/5 tests
@canvas-agent/contracts      typecheck PASS, 2/2 tests
@canvas-agent/desktop        lint PASS, typecheck PASS, build PASS, 2/2 tests
@canvas-agent/persistence    typecheck PASS, 33/33 tests (in-memory SQLite)
@canvas-agent/worker-runtime typecheck PASS, 16/16 tests (temp Git repos)
```

## Full repository gate

```text
pnpm install --frozen-lockfile  PASS
pnpm check                      PASS (format / lint / typecheck / test / build)
```

Total: 63 tests across 5 packages (domain 5, contracts 2, desktop 7, persistence 33, worker-runtime 16). No regression from the foundation baseline.

## Acceptance-criterion coverage

### DS-001 (persistence)

1. Baseline activation leaves exactly one ACTIVE baseline and supersedes the prior one — covered by DB partial unique index + `tests/baseline.test.ts`.
2. Published NodeVersion/TaskSpecVersion writes are rejected, content hash unchanged — `tests/immutability.test.ts` (DB triggers).
3. Two writers, same draft revision → one wins, stale writer gets a typed `ConcurrencyError` — `tests/concurrency.test.ts`.
4. Snapshot freeze pins task spec / baseline / repository revision; item order, hashes and token estimates read back unchanged — `tests/snapshot.test.ts`.
5. Self-edge and PARENT_OF/SUPERSEDES cycles commit no row — `tests/edge.test.ts`.
6. Migration applied twice is deterministic; fresh DBs start from a clean schema — `tests/db.test.ts`.

### DS-002 (worker runtime)

1. Bad hash / expired request / missing capability rejected before any worktree or process — `tests/validation.test.ts`.
2. Repository revision mismatch reported; original repo untouched — `tests/worker.test.ts`.
3. Valid request runs only in the isolated worktree and returns patch, verification exit data and summary hashes — `tests/worker.test.ts`.
4. Timed-out / cancelled process tree is stopped with bounded partial evidence — `tests/worker.test.ts` + `tests/process-runner.test.ts`.
5. Same request claimed twice → only one claim succeeds — `tests/worker.test.ts`.

### UI-001 (renderer foundation)

1. Light/dark token parity and semantic status legibility — `status-tone.ts` single mapping, tokens in `main.css`.
2. 1440×1080 three-panel density — AppShell + Resizable inspector, max width 1240px.
3. 1180×820 collapse — sidebar and inspector auto-collapse via `matchMedia(max-width: 1180px)`.
4. Keyboard-only reachability — focus-visible ring, Cmd/Ctrl+K palette, Escape/Enter, arrow-key resize.
5. Shared domain badges instead of duplicated status color — `components/domain/*` imported across pages.

## UI-001 review notes (non-blocking, carried into UI-002)

- `app-sidebar.tsx` hardcodes a user avatar (`JD` / `Jane Developer`) and a Tasks nav count (`6`); Luna was asked to remove/fixture-drive these before UI-002 lands.
- Screenshot evidence (1440×1080 and 1180×820, both themes) is captured locally by Luna per task; screenshot files are not committed.

## UI-002 acceptance-criterion coverage

The core-flow prototype (typed fixture service + `coreFlowReducer` command reducer)
models every formal transition as a separate explicit command:

1. Dashboard distinguishes objective, non-goals, targets, criteria, current Snapshot and Runs — `core-flow-workspace.tsx` dashboard screen.
2. Optional context items add/remove updates count, order and token budget; required items stay pinned — `core-flow-reducer.test.ts`.
3. Conflict or token overflow blocks Freeze with a specific message and the Snapshot stays Draft — `core-flow-reducer.test.ts`.
4. A frozen Snapshot is read-only; starting a Run is a separate `START_RUN` command — `core-flow-reducer.test.ts`.
5. A succeeded Run leaves the Task in `WAITING_REVIEW` until acceptance evaluation and completion are explicit — `core-flow-reducer.test.ts`.
6. Task completion leaves the Baseline Draft until a separate `ACTIVATE_BASELINE` confirmation — `core-flow-reducer.test.ts`.

The reducer uses `@canvas-agent/domain` invariants (`assertTaskTransition`,
`assertRunTransition`, `assertBaselineTransition`, `assertRunState`).

## Open verification

- Complete Canvas / multi-worker / real-time collaboration — deferred per `docs/product/scope-register.md`.
- Real Agent adapters and final RunEvent/ToolInvocation/Checkpoint/Artifact lifecycles — deferred pending the worker prototype's observed data.
