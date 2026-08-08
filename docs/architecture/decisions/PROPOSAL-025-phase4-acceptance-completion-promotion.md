# PROPOSAL-025 — Phase 4 #4: Acceptance evaluation + Task lifecycle + Task completion

- **Status:** APPROVED — direction frozen, entering implementation
- **Author:** DeepSeek V4 Flash (architecture decisions by the lead)
- **Date:** 2026-08-08
- **Basis:** Phase 4 #3 close-out direction; the frozen
  `Baseline N → Task → Run → Baseline N+1` product loop; the Phase 3 gates
  (APPLY_ARTIFACT / COMPLETE_TASK / ACTIVATE_BASELINE).

## Scope (frozen)

Phase 4 #4 covers **AcceptanceEvaluation + Task lifecycle + Task completion only**.
Baseline promotion is **explicitly out of this packet** (Phase 4 #5: Result
Adoption + Baseline Promotion, with explicit Draft → Activate, never an atomic
`baseline.promote`). This avoids a "fake closed loop": the Run's true change
result is still a PATCH artifact, not applied repository state, so promoting a
`Baseline N+1` now would only relabel the old project state.

The three inequalities remain invariant:

```text
Run SUCCEEDED        ≠ Task COMPLETED
Task COMPLETED       ≠ Baseline accepted
Artifact accepted    ≠ Artifact applied
```

## Endpoint of Phase 4 #4

```text
Baseline N → Task → ContextSnapshot → Run → durable evidence
→ AcceptanceEvaluation → Task COMPLETED
```

Result adoption / new RepositoryRevision / Baseline N+1 DRAFT → ACTIVE is
Phase 4 #5.

## Data model (frozen)

### `acceptance_evaluation`

```ts
{
  id, projectId, taskId, taskSpecVersionId, runId,
  sequence,          // per-task, append-only; UNIQUE(task_id, sequence)
  status,            // 'PASSED' | 'FAILED'   (no PENDING: no evaluation draft)
  createdAt
}
```

Immutable / append-only. A re-evaluation creates `sequence N+1`; historical
verdicts are never overwritten. The effective (latest) evaluation is the
read-side `max(sequence)` row.

### `acceptance_evaluation_item`

```ts
{
  id, evaluationId, criterionId,
  verdict,           // 'PASSED' | 'FAILED'
  note: string | null,
  position           // UNIQUE(evaluation_id, criterion_id), UNIQUE(evaluation_id, position)
}
```

One `acceptance.evaluate` is a complete, immutable user judgment: all criteria
PASSED → evaluation PASSED; any FAILED → evaluation FAILED. `position`,
`description`, `verificationMethod` all come from authoritative persistence —
the renderer never declares them.

## Commands (new surface)

| command | payload | response |
|---|---|---|
| `acceptance.evaluate` | `{ projectId, taskId, taskSpecVersionId, runId, criteria: [{ criterionId, verdict, note? }] }` | `AcceptanceEvaluationAggregate` |
| `acceptance.list` | `{ taskId }` | `AcceptanceEvaluationAggregate[]` (sequence ASC, items position ASC) |
| `task.complete` | `{ taskId, evaluationId }` | `Task` |

### `acceptance.evaluate` guards

- The submitted criterion ID set must **exactly equal** the authoritative
  TaskSpecVersion criterion IDs (no missing, extra or duplicate; no cross-spec
  references).
- Four-way ownership, all must hold:
  `Task.projectId == evaluation.projectId`,
  `TaskSpecVersion.taskId == Task.id`,
  `Run.taskId == Task.id`,
  `Run.taskSpecVersionId == evaluation.taskSpecVersionId`.
- `Run.status === FINISHED` (any FINISHED run may be evaluated).
- A PASSED evaluation additionally requires the Run outcome to be usable:
  `SUCCEEDED | PARTIAL | TIMED_OUT` (never `FAILED` / `CANCELLED`).
- `sequence = max(sequence for task) + 1`; evaluation + items + the
  `IN_PROGRESS → WAITING_REVIEW` task transition commit in one transaction;
  `UNIQUE(task_id, sequence)` is the DB backstop.

### `task.complete` guards (explicit `evaluationId`, no implicit latest)

1. `Task.status === WAITING_REVIEW`
2. `evaluation.taskId === task.id`
3. `evaluation` is the **latest** evaluation for that task
4. `evaluation.status === PASSED`
5. `evaluation.taskSpecVersionId ===` the **latest published TaskSpecVersion** for the task
6. `evaluation.runId` references a `FINISHED` Run
7. `Run.taskId === Task.id`
8. `Run.taskSpecVersionId === evaluation.taskSpecVersionId`

Transition: `WAITING_REVIEW → COMPLETED`.

## Task lifecycle (frozen, driven by real business actions)

| action | transition |
|---|---|
| `taskSpec.publish` (first publish) | `DRAFT → READY` |
| `execution.dispatch` | `READY → IN_PROGRESS`, `IN_PROGRESS → IN_PROGRESS`, `WAITING_REVIEW → IN_PROGRESS` |
| `acceptance.evaluate` | `IN_PROGRESS → WAITING_REVIEW` (same transaction); `WAITING_REVIEW` stays |
| `task.complete` | `WAITING_REVIEW → COMPLETED` |

Rejected dispatch states: `DRAFT`, `COMPLETED`, `CANCELLED`, `ARCHIVED`. A Run
outcome (FAILED / INTERRUPTED / CANCELLED) never rolls the Task back; Run and
Task lifecycles stay decoupled.

## Atomic boundaries (required invariants 13–15)

- **13** The dispatch Task transition is part of the **same transaction** as
  Run + ExecutionRequestRecord + DISPATCHED (extended `createDispatchedRun`);
  there is no separate coordinator-side write.
- **14** `publishTaskSpecVersion` does `DRAFT → READY` **inside the same
  transaction** that publishes the immutable TaskSpecVersion.
- **15** The migration backfills legacy data:

  ```sql
  UPDATE task SET status = 'READY'
  WHERE status = 'DRAFT'
    AND EXISTS (SELECT 1 FROM task_spec_version
                WHERE task_spec_version.task_id = task.id);
  ```

  (The demo seed early-returns on existing projects; backfill must not depend on
  the seed rerunning.)

## Renderer (frozen)

- **Live view**: Run detail → acceptance criteria → per-criterion
  PASSED/FAILED + note → `acceptance.evaluate` → durable `acceptance.list`
  history → `task.complete` (enabled only for the latest PASSED evaluation).
- **CoreFlow**: `EVALUATE_ACCEPTANCE` and `COMPLETE_TASK` become real commands;
  `APPLY_ARTIFACT` and `ACTIVATE_BASELINE` stay locked.

No `ArtifactReview` aggregate: `AcceptanceEvaluation` is the durable user-review
record for this phase. Phase 4 #5 introduces adoption authorization (an
`ArtifactApplication` / approval), which is a different concept.

## Out of scope (this packet)

Baseline promotion, patch application / result adoption, multi-user approval,
checkpoint/resume, streaming acceptance events.

## Test matrix

- persistence: append-only sequence; exact criterion set; four-way ownership;
  Run FINISHED + usable-outcome rules; task lifecycle transitions; complete
  8-guards (incl. latest-eval + latest-spec); migration backfill.
- contracts: new command request/response validation.
- main: coordinator dispatch transition (no half state); smoke asserts
  `task.status === IN_PROGRESS` after dispatch.
- renderer: fake evaluate/list/complete; Live acceptance flow.
- **Restart E2E**: publish → READY → freeze → dispatch → IN_PROGRESS → Run
  FINISHED → evaluate → WAITING_REVIEW → acceptance.list → complete → COMPLETED
  → close Electron → relaunch same userData DB → evaluation history + COMPLETED
  Task + Run evidence still exist.

## Delivery

- `packages/contracts`: three commands + schemas.
- `packages/persistence`: two tables + migration (with backfill) + commands.
- `apps/desktop/src/main`: WorkspaceService + routes; smoke assertion.
- `apps/desktop/src/renderer`: Live acceptance flow + CoreFlow unlock + fake.
- docs: this ADR + verification packet. Gate: `pnpm check` + `phase3-smoke` +
  `e2e:live` + PR CI.

## Next (Phase 4 #5, not this packet)

Result Adoption + Baseline Promotion: apply the accepted Run's PATCH, produce a
new RepositoryRevision, materialize `Baseline N+1` as a DRAFT from Main, then
explicit `baseline.activate` (existing DRAFT → ACTIVE, supersede) — never an
atomic promote. Possibly add `BaselineEdgeItem` for full graph freezing.
