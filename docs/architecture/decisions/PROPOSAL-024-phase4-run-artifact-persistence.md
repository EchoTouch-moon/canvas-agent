# PROPOSAL-024 — Phase 4 #3: Run + RunEvent + Artifact persistence

- **Status:** Draft — awaiting architecture freeze
- **Author:** DeepSeek V4 Flash
- **Date:** 2026-08-08
- **Basis:** Phase 4 #3 direction; Phase 3 review gates (APPLY/COMPLETE/ACTIVATE
  stay locked); the `content_blob` metadata registry.

## Problem

`execution.dispatch` returns a `DispatchResult` that is **session-only**:

- The coordinator generates `runId` (`run_*`) for the `ExecutionRequest`, then
  discards it — there is no durable execution history.
- Artifact content is written by the worker to
  `runtimeDirectory/artifacts/<executionRequestId>/*` and is never copied
  anywhere persistent; a runtime-directory cleanup loses every execution's
  evidence.
- There is no timeline: "Agent 执行成功" cannot become "项目里一条正式、持久、
  可审计的执行历史".

## Goals

1. A persisted **Run** aggregate per dispatched execution: identity bound to the
   `ExecutionRequest.runId`, project-scoped, snapshot binding, outcome,
   rejection / revision-mismatch detail, timestamps.
2. A **deterministic RunEvent timeline** derived from the dispatch lifecycle
   (no streaming in this packet).
3. **Artifact persistence**: patch + verification results + agent summary +
   partial evidence stored per run, content-hash auditable.
4. Public read surface: `run.list({ projectId })` and `run.get({ runId })`
   (with events + artifacts). `execution.dispatch` / `execution.cancel` remain
   the action commands.

## Persistence design

New tables (`packages/persistence/src/schema/run.ts` + commands/run.ts):

- `run`: `id` (the ExecutionRequest runId), `projectId`, `taskId`,
  `contextSnapshotId`, `taskSpecVersionId`, `repositoryRevisionId`,
  `executionRequestId` (unique), `outcome`, `claimGranted`, `rejectionReason`,
  `revisionMismatchField/Expected/Actual`, `patchHash`, `timedOut`,
  `workerAttemptNumber`, `startedAt`, `completedAt` (nullable), `createdAt`.
  Project-scoped from the frozen snapshot's projectId.
- `run_event`: `id`, `runId`, `sequence`, `kind`, `detail` (JSON text),
  `createdAt`. Deterministic events: `DISPATCHED` (at dispatch start) →
  `COMPLETED` (at result). No streaming.
- `artifact`: `id`, `runId`, `kind`, `fileName`, `contentHash`, `sizeBytes`,
  `content` (inline text), `position`. Patch / verification JSON / summary /
  partial evidence are text and stored inline, mirroring
  `context_snapshot_item.resolvedContent`. `contentHash` = sha256 of content for
  audit; content-addressed dedup is a future optimization.

## Dispatch lifecycle wiring

In `ExecutionCoordinator.dispatch`, the already-generated
`runId` (`this.services.nextId('run_')`) becomes the persisted Run id:

```text
execution.dispatch
  → persist Run row (outcome null, completedAt null) + DISPATCHED event
  → worker.dispatch(request)   // request.runId === Run.id
  → on result:
      → copy artifact files runtimeDirectory/artifacts/<executionRequestId>/*
        into artifact rows (needs runtimeDirectory injected into the coordinator
        or a small RunPersistenceService)
      → update Run outcome/rejection/timestamps + patchHash
      → append COMPLETED event (outcome + summary)
  → return DispatchResult (unchanged surface)
```

A crashed / abandoned dispatch leaves a Run stuck in `DISPATCHED` with
`completedAt: null` — a durable, visible in-flight record rather than nothing.

## Command surface

| command | payload | response |
|---|---|---|
| `run.list` | `{ projectId }` | `RunSummary[]` (id, outcome, snapshotId, startedAt, completedAt) |
| `run.get` | `{ runId }` | `{ run, events, artifacts }` |

Both read-only; actions remain `execution.dispatch` / `execution.cancel`.
`execution.cancel` for a persisted run is unchanged (it aborts the in-flight
worker; the terminal outcome lands in the Run on completion).

## Out of scope (this packet)

- Task completion / Baseline promotion (APPLY/COMPLETE/ACTIVATE stay locked).
- Real-time RunEvent streaming (derived timeline only).
- Checkpoint / resume / re-attempt engine.
- Applying the patch to the source repository.
- Cross-run artifact content dedup (inline storage now).

## Test matrix

- persistence: `createRun`/`recordRunResult`/`listRuns`/`getRun`/events/artifacts
  round-trip; project-scoped run listing; immutable-completed Run re-write
  rejected.
- coordinator: dispatch persists Run + DISPATCHED event before the worker; on
  result persists artifacts + outcome + COMPLETED event; cancel/REVISION_MISMATCH
  outcome persisted; artifact content hash matches the worker descriptor.
- contracts: `run.list` / `run.get` request/response validation.
- renderer: `run.list` / `run.get` via fake transport; Live view runs-history
  section (hydration + dispatch shows the run appear).
- E2E: after dispatch SUCCEEDED, `run.list` returns the run and `run.get` shows
  the patch artifact content.

## Delivery

- `packages/contracts`: `run.list` / `run.get` schemas + CommandMap entries.
- `packages/persistence`: `run` / `run_event` / `artifact` tables + commands.
- `apps/desktop/src/main`: `RunPersistenceService` (or coordinator + runtime
  dir), record-on-dispatch wiring, `run.list` / `run.get` routes.
- `apps/desktop/src/renderer`: `useWorkspace.runList` / `runGet`; Live view
  runs-history section; fake transport.
- docs: this ADR + verification packet. Gate: `pnpm check` + `phase3-smoke` +
  `e2e:live` + PR CI.

## Awaiting architecture decisions

1. **Event granularity**: minimal deterministic `DISPATCHED → COMPLETED`
   (recommended) vs adding intermediate events (requires worker streaming)?
2. **Artifact content storage**: inline `artifact.content` text (recommended,
   mirrors resolvedContent) vs content-addressed blob table with dedup?
3. **Run row lifecycle**: create at dispatch start (recommended — durable
   in-flight record) vs only after completion?
4. **Run id**: reuse the coordinator's `ExecutionRequest.runId` (recommended) vs
   a separate persistence id?
5. **Command surface**: `run.list` / `run.get` only, or also a `run.cancel`
   alias over `execution.cancel`?
6. **Renderer scope**: wire a runs-history section into the Live view in this
   packet (recommended) vs backend-only?
