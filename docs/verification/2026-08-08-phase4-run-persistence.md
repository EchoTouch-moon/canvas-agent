# Phase 4 #3 verification packet — Run + RunEvent + Artifact persistence

- **Status:** Pending merge — evidence recorded on branch `agent/deepseek-phase4c-run-persistence`
- **Date:** 2026-08-08
- **Basis:** PROPOSAL-024 (frozen)
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Requirement → evidence map

| Frozen design point | Evidence | Status |
|---|---|---|
| Run 1:N ExecutionRequestRecord; per-request metadata lives on the record | `run` table has no executionRequestId; `execution_request_record` holds attempt/checkpoint/requestHash/requestJson + dispatch metadata | **PASS** (persistence tests) |
| Canonical immutable contract persisted (requestJson + requestHash) | `createDispatchedRun` stores `stableStringify(request)`; coordinator test asserts `requestJson` contains the contract and hash matches | **PASS** (coordinator test) |
| Main owns Run.id, injected into ExecutionRequest.runId | coordinator generates `runId` first, `request.runId === run.id` | **PASS** (coordinator test) |
| RunStatus/RunOutcome semantics; RUNNING initial, FINISHED-only outcome | `createDispatchedRun` RUNNING/null; finalize → FINISHED/outcome; interrupt → INTERRUPTED/null | **PASS** (persistence + coordinator tests) |
| DispatchResult → Run mapping (incl. PARTIAL+timedOut→TIMED_OUT, rejections→FAILED) | `mapDispatchToRunOutcome` test matrix | **PASS** |
| RunEvent minimal DISPATCHED/FINISHED/INTERRUPTED, per-Run sequence | `UNIQUE(run_id, sequence)`; event kind assertions | **PASS** |
| Artifact per executionRequest, position per-request | `UNIQUE(execution_request_id, position)`; positions [0,1] | **PASS** |
| `completedAt` = terminal worker response time; interrupt keeps evidence | interrupt-with-terminal test: record dispatchOutcome SUCCEEDED + completedAt set while Run INTERRUPTED/null | **PASS** (persistence + coordinator) |
| Artifact ingestion trust boundary (realpath containment, lstat, size/hash, UTF-8) | ingestor test matrix (traversal, symlink file + parent dir, size/hash/UTF-8 mismatch) | **PASS** |
| Cross-platform containment (POSIX + Windows) | `isStrictDescendant` tested with `path.posix` and `path.win32` | **PASS** |
| Literal symlink rejection (in-dir too) | lstat before realpath; in-directory symlink rejected `artifact_symlink_unsupported` | **PASS** |
| Bounded artifact read (no unbounded buffer) | size checked before read; >16 MiB artifact rejected | **PASS** |
| Run owns its ExecutionRequestRecords | `requireRequestForRun` in finalizeRun/interruptRun; cross-run request rejected | **PASS** |
| recoveryJson persisted (auditable) | DispatchResult.recovery -> canonical recoveryJson; run.get exposes it | **PASS** |
| Full Run view (run.get) | run exposes taskSpecVersionId + repositoryRevisionId | **PASS** |
| Deterministic multi-request artifact order | ordered by executionRequestId, position, id | **PASS** |
| `executionRequestId` runtime-safe shared schema | contracts regex rejects `/`, `.`, `..`, spaces, over-long | **PASS** |
| `execution.dispatch` → `{ runId, executionRequestId, result }` | contracts + coordinator + renderer + fake updated | **PASS** |
| run.list / run.get (with executionRequests + events + artifacts) | persistence + routes + renderer fake tests | **PASS** |
| Thin runs-history (run.list/run.get only) | Live view Runs section | **PASS** (E2E) |
| Durable finalize atomicity (never SUCCEEDED-without-evidence) | finalizeRun single transaction; interrupt on ingest/finalize failure | **PASS** |
| **Restart persistence (final gate)** | see below | **PASS** |

## Restart-persistence E2E (final gate)

`pnpm --filter @canvas-agent/desktop e2e:live` (real Electron, Playwright):

```text
[e2e] A project hydration                                  ← launch A
[e2e] A composer real candidates
[e2e] A repository content resolve (encoded path) -> add
[e2e] A real snapshot freeze (node version + repo content)
[e2e] A execution dispatch -> SUCCEEDED evidence
[e2e] first launch closed; relaunching against the SAME userData DB
[e2e] B run.list shows the persisted run after restart     ← launch B
[e2e] B run.get events (DISPATCHED + FINISHED) intact
[e2e] B run.get patch artifact present
[e2e] B PATCH content intact
[e2e] B PATCH sha256(content) === contentHash
[e2e] B PATCH sizeBytes === byteLength
[e2e] B run.get snapshot binding present
[e2e] ALL PASSED
```

The Run, its ExecutionRequest, the DISPATCHED + FINISHED events and the PATCH
artifact (content / sha256 / size re-verified byte-for-byte via the real
`run.get` bridge) all survive a full Electron restart against the same app
userData database.

## Verification note

`pnpm check` green (208 tests: domain 5, contracts 32, persistence 49,
worker-runtime 19, desktop 103). `CANVAS_AGENT_PHASE3_SMOKE=1` PASSED twice
(`run=<id> outcome=SUCCEEDED`). CI publishes commit status on the PR.
