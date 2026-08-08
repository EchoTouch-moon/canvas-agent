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
| Four-way ownership + Run FINISHED; PASSED requires usable outcome | ownership checks; a CANCELLED run evaluates but stays FAILED | **PASS** (persistence) |
| evaluate transitions IN_PROGRESS → WAITING_REVIEW (same transaction) | persistence test | **PASS** |
| `acceptance.list({ taskId })` full history sequence ASC | persistence + renderer fake | **PASS** |
| `task.complete({ taskId, evaluationId })` with 8 guards | rejects non-latest, non-PASSED, non-latest-spec (publish v2) | **PASS** (persistence) |
| Task lifecycle: publish DRAFT→READY (same txn) | publish test | **PASS** |
| Dispatch transition inside createDispatchedRun txn (invariant 13) | dispatch transitions READY→IN_PROGRESS, keeps IN_PROGRESS | **PASS** (persistence + smoke) |
| Migration backfill DRAFT+spec → READY (invariant 15) | backfill test runs the UPDATE SQL | **PASS** |
| APPLY_ARTIFACT / ACTIVATE_BASELINE stay locked; COMPLETE_TASK real | CoreFlow has no complete button (read-only); real completion in Live view | **PASS** |
| Smoke asserts task IN_PROGRESS after dispatch | `[phase3-smoke] task lifecycle IN_PROGRESS PASSED` | **PASS** |
| Restart E2E ends at durable COMPLETED Task | see below | **PASS** |

## Restart E2E (final gate)

`pnpm --filter @canvas-agent/desktop e2e:live` (real Electron, Playwright):

```text
[e2e] A execution dispatch -> SUCCEEDED evidence
[e2e] A acceptance.evaluate -> WAITING_REVIEW
[e2e] A task.complete submitted
[e2e] first launch closed; relaunching with the SAME userData DB
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

`pnpm check` green (219 tests: domain 5, contracts 32, persistence 59,
worker-runtime 19, desktop 104). `CANVAS_AGENT_PHASE3_SMOKE=1` PASSED with the
new `task lifecycle IN_PROGRESS` assertion. CI publishes commit status on the PR.

Baseline promotion / Result Adoption is deliberately **not** in this packet
(Phase 4 #5), so no `Baseline N+1` is claimed here.
