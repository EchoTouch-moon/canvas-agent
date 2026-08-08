# Phase 4 #4 verification packet — Acceptance evaluation + Task lifecycle + completion

- **Status:** Pending merge — evidence recorded on branch `agent/deepseek-phase4d-acceptance-completion`
- **Date:** 2026-08-08
- **Basis:** PROPOSAL-025 (frozen)
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Requirement → evidence map

| Frozen decision | Evidence | Status |
|---|---|---|
| AcceptanceEvaluation immutable / append-only (sequence N+1, no overwrite, no PENDING) | two evaluations → sequences 0,1 both listed; history never overwritten | **PASS** (persistence) |
| Per-criterion verdicts + exact authoritative set (no missing/extra/dup) | evaluate rejects partial and duplicate criterion sets | **PASS** (persistence) |
| Four-way ownership + Run FINISHED | ownership checks | **PASS** |
| PASSED requires usable outcome (P0-3) | any FAILED criterion → FAILED evaluation on any FINISHED run; all-PASSED against a CANCELLED run → `ValidationError` (never items=all-PASSED with overall=FAILED) | **PASS** (persistence) |
| evaluate transitions IN_PROGRESS → WAITING_REVIEW (same transaction) | persistence test | **PASS** |
| `acceptance.list({ taskId })` full history sequence ASC | persistence + renderer fake | **PASS** |
| `task.complete({ taskId, evaluationId })` with 8 guards | rejects non-latest, non-PASSED, non-latest-spec (publish v2) | **PASS** (persistence) |
| Task transition single source of truth (P0-1) | persistence deletes its own matrix; delegates to `@canvas-agent/domain assertTaskTransition` (DomainInvariantError → ValidationError conversion only) | **PASS** |
| TaskSpec terminal guards (P0-2) | publish on COMPLETED / CANCELLED rejected | **PASS** (persistence) |
| Dispatch transition inside createDispatchedRun txn (invariant 13) | dispatch transitions READY→IN_PROGRESS, keeps IN_PROGRESS | **PASS** (persistence + smoke) |
| Migration backfill DRAFT+spec → READY (invariant 15) | backfill test runs the UPDATE SQL | **PASS** |
| CoreFlow real surface (P0-4) | Evaluate acceptance → real acceptance.evaluate; Complete task → real task.complete; APPLY_ARTIFACT / ACTIVATE_BASELINE stay locked | **PASS** |
| Live acceptance bound to the Run (P0-5) | run.get(runId) → exact run.taskId + run.taskSpecVersionId → exact TaskSpec aggregate (never taskSpecs[0]) | **PASS** |
| Smoke asserts task IN_PROGRESS after dispatch | `[phase3-smoke] task lifecycle IN_PROGRESS PASSED` | **PASS** |
| Restart E2E ends at durable COMPLETED Task | see below | **PASS** |

## Restart E2E (final gate)

`pnpm --filter @canvas-agent/desktop e2e:live` (real Electron, Playwright; isolated
userData via `CANVAS_AGENT_USER_DATA`):

```text
[e2e] A execution dispatch -> SUCCEEDED evidence
[e2e] A acceptance.evaluate -> WAITING_REVIEW
[e2e] A task.complete submitted
[e2e] first launch closed; relaunching against the SAME userData DB
[e2e] B run.get events + PATCH content/hash/size intact
[e2e] B acceptance history survived restart (PASSED evaluation)
[e2e] B task is durably COMPLETED after restart
[e2e] ALL PASSED
```

The loop is durable end to end: `publish → READY → freeze → dispatch → IN_PROGRESS
→ Run FINISHED → evaluate → WAITING_REVIEW → complete → COMPLETED`, and after a
full Electron restart the PASSED evaluation, the COMPLETED Task and the Run's
PATCH evidence (content / sha256 / size) all remain.

## Verification note

`pnpm check` green (226 tests: domain 5, contracts 36, persistence 62,
worker-runtime 19, desktop 104). `CANVAS_AGENT_PHASE3_SMOKE=1` PASSED with the
new `task lifecycle IN_PROGRESS` assertion. CI publishes commit status on the PR.

Repeatability: macOS ignores `$HOME` for Electron userData, so the smoke/E2E set
`CANVAS_AGENT_USER_DATA` to isolate a fresh workspace DB per run; the E2E also
dismisses the CoreFlow welcome modal before driving the Live view.

Baseline promotion / Result Adoption is deliberately **not** in this packet
(Phase 4 #5), so no `Baseline N+1` is claimed here.
