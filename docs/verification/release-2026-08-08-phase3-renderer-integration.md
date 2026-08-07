# Phase 3 verification packet — Renderer integration

- **Status:** Template — fill the `Pending` rows when Luna's Renderer integration
  lands (and re-run the manual E2E).
- **Date:** 2026-08-08
- **Basis:** PROPOSAL-022 (approved with required changes)
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Requirement → evidence map

| Requirement (PROPOSAL-022) | Evidence | Status |
|---|---|---|
| Renderer cannot construct an `ExecutionRequest` | `worker.dispatch`/`worker.cancel` absent from `CommandMap`/request/response schemas | **PASS** (contracts tests) |
| Project hydration | `project.list` + `project.state` contracts + `ExecutionCoordinator`/`WorkspaceService` tests | **PASS** |
| Persisted read projection | `WorkspaceService.projectState` + persistence read helpers + `reads`/`project-state` tests | **PASS** |
| Frozen revision binding | `ExecutionCoordinator` builds the request from the frozen snapshot's pinned revision (never `revision.current`) | **PASS** (coordinator tests incl. repo-changed → `REVISION_MISMATCH`) |
| Real Utility Process dispatch | `CANVAS_AGENT_PHASE3_SMOKE=1` runtime smoke (`execution.dispatch` → `SUCCEEDED` + patch + verification exit 0) | **PASS** |
| Cross-project reference invariants | `fix(persistence)` commit + `cross-project.test.ts` | **PASS** |
| Demo seed (dev tooling) | `CANVAS_AGENT_DEMO_SEED=1` + `demo-seed.test.ts` (complete graph, idempotent, non-destructive) | **PASS** |
| Renderer durable fixture removed | Luna commit dropping `core-flow-fixture` as durable domain source | **Pending** |
| `WorkspaceClient` + `useWorkspace` | Luna tests (fake transport) | **Pending** |
| NodeDraft serialized/coalescing save queue | Luna tests | **Pending** |
| Composer uses real candidates only | Luna tests | **Pending** |
| Real freeze from the UI | Manual E2E | **Pending** |
| `DispatchResult` evidence UI (no fabricated timeline) | Luna tests + Manual E2E | **Pending** |
| `APPLY`/`COMPLETE`/`ACTIVATE` locked (no fake transitions) | Luna UI/test | **Pending** |

## Backend runtime smoke (already green)

```text
CANVAS_AGENT_REPO=<repo> CANVAS_AGENT_PHASE3_SMOKE=1 pnpm --filter @canvas-agent/desktop dev

[workspace] demo seed ready at proj_demo
[phase3-smoke] project hydration PASSED
[phase3-smoke] snapshot frozen PASSED
[phase3-smoke] execution outcome=SUCCEEDED
[phase3-smoke] patch evidence PASSED
[phase3-smoke] verification exit=0
[phase3-smoke] PASSED
```

## Verification note

`pnpm check` is recorded as **local** evidence; GitHub Actions CI (`.github/workflows/ci.yml`)
is now in the repository and publishes commit status on push to main / PRs — prefer
CI output over local runs from that point on.

## Real Electron E2E (final gate) — PASSED

`pnpm --filter @canvas-agent/desktop e2e:live` (Playwright `_electron`, `--disable-gpu`,
fresh temp repo + `CANVAS_AGENT_DEMO_SEED=1`, temp HOME):

```text
[e2e] PASS project hydration              → real project.list + project.state (MUSICDB Demo)
[e2e] PASS composer real candidates       → task-spec:// + node:// candidates only
[e2e] PASS real snapshot freeze           → snapshot.freeze → FROZEN snapshot
[e2e] PASS execution dispatch             → execution.dispatch → Utility Process
[e2e] PASS SUCCEEDED evidence             → patch docs/phase2.md rendered
[e2e] PASS claim granted evidence
[e2e] PASS verification exit 0 evidence
[e2e] PASS outcome badge
[e2e] ALL PASSED
```

Screenshot: `$TMPDIR/canvas-agent-e2e/live-workspace.png`.

The E2E surfaced and fixed a real preload bug: the sandboxed preload externalized
`zod` (`module not found: zod`), so `window.canvasAgent` never existed at runtime.
`electron.vite.config.ts` now bundles `zod` into the preload output.

Manual E2E checklist (final gate):

- [x] `CANVAS_AGENT_REPO=<repo> CANVAS_AGENT_DEMO_SEED=1` first launch → Demo project
      hydrates in the live workspace view.
- [x] Composer offers real TaskSpec / NodeVersion candidates (no fixture repository/artifact cards).
- [x] Freeze commits one `snapshot.freeze`; the frozen snapshot is read-only afterwards.
- [x] Run dispatches via `execution.dispatch`; outcome + patch + verification evidence render.
- [ ] Repo changed after freeze → `REVISION_MISMATCH` surfaces (no silent re-freeze) — covered by
      `ExecutionCoordinator` tests; not re-driven through the UI in this E2E.
- [x] `APPLY ARTIFACT` / `COMPLETE TASK` / `ACTIVATE BASELINE` are locked/deferred.
