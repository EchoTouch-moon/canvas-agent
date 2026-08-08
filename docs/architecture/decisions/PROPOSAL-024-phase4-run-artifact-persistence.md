# PROPOSAL-024 — Phase 4 #3: Run + RunEvent + Artifact persistence

- **Status:** APPROVED — direction frozen, entering implementation
- **Author:** DeepSeek V4 Flash (architecture decisions by the lead)
- **Date:** 2026-08-08
- **Basis:** Phase 4 #3 direction; Phase 3 review gates (APPLY/COMPLETE/ACTIVATE
  stay locked); the existing `content_blob` metadata registry.

## Problem

`execution.dispatch` returns a `DispatchResult` that is **session-only**: the
coordinator's `runId` is discarded, artifact content lives only under
`runtimeDirectory`, and there is no durable, queryable, auditable execution
history. "Agent 执行成功" cannot become "项目里一条正式、持久、可审计的执行历史".

## Domain model (frozen)

> Run ≠ one execution.dispatch. Run is NOT 1:1 with ExecutionRequest.

```text
Task                    = 要完成什么工作
Run                     = 一次逻辑执行尝试
ExecutionRequest        = 本次交给 Worker 的不可变执行合同
Worker Attempt          = Worker 对合同的一次领取/执行片段
```

A Run can produce multiple ExecutionRequests (future resume / approval / worker
swap):

```text
Run 1 ─── N ExecutionRequestRecord
Run 1 ─── N RunEvent

ExecutionRequestRecord 1 ─── N Artifact
```

## Tables

### `run`

```ts
Run {
  id                          // canonical identity, Main-created, injected into ExecutionRequest.runId
  projectId
  taskId
  taskSpecVersionId
  contextSnapshotId
  repositoryRevisionId
  status   // RunStatus
  outcome  // RunOutcome | null
  startedAt
  completedAt                  // nullable
  createdAt
  updatedAt
}
```

Not on Run (they are per-ExecutionRequest): `executionRequestId`,
`workerAttemptNumber`, `claimGranted`, `rejectionReason`, `revisionMismatch`,
`patchHash`, `timedOut`.

### `execution_request_record`

```ts
ExecutionRequestRecord {
  executionRequestId          // PK, runtime-safe id
  runId
  workerAttemptNumber
  checkpointId                // nullable
  requestHash
  schemaVersion
  requestJson                 // canonical stableStringify(request)
  dispatchOutcome             // nullable
  claimGranted                // nullable
  rejectionReason             // nullable
  revisionMismatchField       // nullable
  revisionMismatchExpected    // nullable
  revisionMismatchActual      // nullable
  patchHash                   // nullable
  timedOut                    // nullable
  recoveryJson                // nullable
  dispatchedAt
  completedAt                 // nullable: time Main received the terminal DispatchResult
}
```

- `requestJson` is the exact immutable contract sent to the worker, stored as
  canonical `stableStringify(request)` bytes (Main constructs it). Audit can
  re-verify: `parse requestJson → strip requestHash → computeRequestHash → ==
  persisted requestHash`.
- `completedAt` means **Main received the terminal DispatchResult**, not that the
  Run was successfully finalized. A worker that returned SUCCEEDED but whose
  artifact ingest failed leaves `dispatchOutcome = SUCCEEDED`,
  `completedAt != null`, while the Run is `INTERRUPTED / outcome null`.

### `run_event`

```ts
RunEvent {
  id
  runId
  sequence        // UNIQUE(runId, sequence) — whole-Run timeline order
  kind            // 'DISPATCHED' | 'FINISHED' | 'INTERRUPTED'
  detail          // JSON text (metadata only; no agent/patch/test content)
  createdAt
}
```

Minimal deterministic events, all produced by Main (no worker streaming):

- `DISPATCHED` `{ executionRequestId, workerAttemptNumber, requestHash }`
- `FINISHED` `{ executionRequestId, dispatchOutcome, runOutcome }`
- `INTERRUPTED` `{ executionRequestId, reasonCode }`

### `artifact`

```ts
Artifact {
  id
  runId
  executionRequestId          // the producing execution
  kind                        // PATCH | TEST_RESULT | AGENT_SUMMARY | AGENT_PARTIAL
  fileName
  content                     // inline text
  contentHash                 // sha256 of content
  sizeBytes
  position                    // UNIQUE(executionRequestId, position) — per-request ordering
  createdAt
}
```

`runId` enables aggregate/query; `executionRequestId` is the real producing
execution (a Run with two requests has artifacts ordered per request, positions
restarting at 0).

## Run status / outcome semantics

`RUNNING` is the initial durable observable state for Phase 4 #3;
`CREATED / QUEUED / PREPARING` are reserved for a future scheduler/queue/worker
allocation and are not faked now. Only a `FINISHED` Run carries an outcome; a
`RUNNING` Run with `outcome null` is valid. A crashed Main process leaves the Run
as `RUNNING / null / completedAt null` — a durable orphan record, not corruption
(no startup reconciliation in this packet).

DispatchResult → Run mapping (frozen):

```text
DispatchResult                    Run
SUCCEEDED                          FINISHED / SUCCEEDED
PARTIAL, timedOut != true          FINISHED / PARTIAL
PARTIAL, timedOut == true          FINISHED / TIMED_OUT
CANCELLED                          FINISHED / CANCELLED
VALIDATION_REJECTED                FINISHED / FAILED     ← legal terminal result
CLAIM_REJECTED                     FINISHED / FAILED
REVISION_MISMATCH                  FINISHED / FAILED
WorkerHost throws / child crash    INTERRUPTED / null
Main artifact trust failure        INTERRUPTED / null
Main cannot durable-finalize       INTERRUPTED / null
```

## Dispatch lifecycle (frozen)

```text
execution.dispatch
  → load + validate Snapshot
  → generate canonical Run.id
  → build ExecutionRequest (runId injected)
  → compute requestHash
  → SQLite transaction:
      INSERT Run(status=RUNNING, outcome=null)
      INSERT ExecutionRequestRecord
      APPEND DISPATCHED
  → COMMIT
  → WorkerHost.dispatch()
```

Invariant: if Run / ExecutionRequestRecord / DISPATCHED cannot be persisted, the
worker must NOT start. Main owns `Run.id` and injects it into
`ExecutionRequest.runId` (never the reverse).

Completion:

```text
Worker DispatchResult
  → ArtifactIngestor reads + verifies files (Main establishes facts)
  → all artifacts in memory, size/hash/UTF-8 verified
  → SQLite transaction:
      INSERT Artifact[]
      finalize ExecutionRequestRecord (dispatch metadata + completedAt)
      Run RUNNING → FINISHED (mapped outcome)
      APPEND FINISHED
  → COMMIT
  → return execution.dispatch response
```

No "Run = SUCCEEDED then artifact INSERT fails" window. On
WorkerHost-throw / artifact-integrity-failure / persistence-failure the Run goes
`RUNNING → INTERRUPTED / outcome null` and `execution.dispatch` returns a command
error rather than claiming success.

### `interruptRun` supports both cases (acceptance detail A)

```ts
interruptRun({ runId, executionRequestId, reason, terminalResult: null })
// worker throw / child crash → request.completedAt = null

interruptRun({ runId, executionRequestId, reason, terminalResult: result })
// worker returned but ingest / durable finalize failed
// → request.completedAt set, dispatch metadata persisted
```

Run has no outcome either way; the ExecutionRequestRecord keeps whatever terminal
evidence was received.

## Artifact ingestion trust boundary

Main must not trust the worker's descriptors (worker is replaceable infra). After
strict `fileName` validation (reject `''`, `.`, `..`, `/`, `\`, NUL), use
**realpath containment** (acceptance detail B):

```text
trustedArtifactRoot   = realpath(runtimeDirectory/artifacts)
executionDirectory    = realpath(runtimeDirectory/artifacts/<executionRequestId>)
                        must be strict descendant of trustedArtifactRoot
artifactFile          = realpath(executionDirectory/<fileName>)
                        must be strict descendant of executionDirectory
```

Then: `lstat` must be a regular file (symlink rejected), bounded read, fatal
UTF-8 decode, `actual size == descriptor.sizeBytes`, `actual sha256 ==
descriptor.contentHash`.

## Command surface

| command | payload | response |
|---|---|---|
| `execution.dispatch` | `{ executionRequestId, contextSnapshotId }` | `{ runId, executionRequestId, result: DispatchResult }` |
| `execution.cancel` | `{ executionRequestId }` | `{ cancelled }` (unchanged; no `run.cancel`) |
| `run.list` | `{ projectId }` | `RunSummary[]` |
| `run.get` | `{ runId }` | `{ run, executionRequests, events, artifacts }` |

`executionRequestId` is tightened to a single shared runtime-safe schema
(`min 1`, `max 128`, `^[A-Za-z0-9._-]+$`, rejects `.` / `..`) reused by
`ExecutionRequestContract`, `execution.dispatch` and `execution.cancel` — it is a
real filesystem path segment on the worker side.

## Renderer

Thin wiring only: `useWorkspace.execute` returns the new dispatch response;
`runList` / `runGet` wrappers; a Live-view Runs history section lists `run.list`
and shows `run.get` details (status/outcome, snapshot binding, execution
requests, events, artifacts). Timeline/evidence must come from `run.list` /
`run.get`, never fabricated from a session-only `DispatchResult`. This replaces
the Phase 3 session-only evidence.

## Out of scope (this packet)

Task completion, AcceptanceEvaluation, Baseline N+1, Checkpoint/Resume, Approval,
ToolInvocation, patch apply, startup orphan reconciliation, streaming RunEvent,
content-addressed Artifact dedup.

## Acceptance (final gate)

1. Before the worker starts, Run + ExecutionRequestRecord + DISPATCHED are durable.
2. The worker's terminal result is auditable on ExecutionRequestRecord.
3. Artifacts are Main-verified (path / bytes / hash / size).
4. FINISHED and INTERRUPTED semantics are never conflated.
5. **Electron restart with the same HOME/DB**: the same Run, ExecutionRequest,
   DISPATCHED + FINISHED events, and the same PATCH artifact bytes/hash all
   survive.

## Delivery

- `packages/contracts`: shared `executionRequestIdSchema`; new `execution.dispatch`
  response; `run.list` / `run.get` + schema set.
- `packages/persistence`: four tables + commands + `mapDispatchToRunOutcome`.
- `apps/desktop/src/main`: `ExecutionCoordinator` persistence wiring +
  `ArtifactIngestor`; routes; smoke unwrap.
- `apps/desktop/src/renderer`: execute/runList/runGet; Live runs history; fake
  transport.
- docs: this ADR + verification packet. Gate: `pnpm check` + `phase3-smoke` +
  `e2e:live` (incl. restart) + PR CI.
