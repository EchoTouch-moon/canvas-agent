# PROPOSAL-025 — Phase 4 #4: Acceptance evaluation → Task completion → Baseline promotion

- **Status:** Draft — awaiting architecture freeze
- **Author:** DeepSeek V4 Flash
- **Date:** 2026-08-08
- **Basis:** Phase 4 #3 close-out direction; the frozen
  `Baseline N → Task → Run → Baseline N+1` product loop; Phase 3 review gates
  (APPLY / COMPLETE / ACTIVATE were locked until the backend half was durable).

## Problem

The execution backend half is now durable (Run + ExecutionRequestRecord +
RunEvent + Artifact). The front half of the loop is still **session-only**:

- Acceptance criteria are never evaluated durably; a Run's evidence is not
  linked to a per-criterion verdict.
- `COMPLETE_TASK` / `APPLY_ARTIFACT` / `ACTIVATE_BASELINE` are locked in the UI
  (Phase 3 gate) with no real domain commands behind them.
- There is no durable user-review record, no task-completion transition, and no
  path from a completed task to a promoted `Baseline N+1`.

Until this segment exists, "Agent 执行成功" cannot advance the project.

## Goal (the loop)

```text
Baseline N (ACTIVE)
   │  task created against pinned spec + baseline
   ▼
ContextSnapshot → ExecutionRequest → Run (durable)
   │
   ▼
user reviews Run evidence
   │  acceptance.evaluate per criterion (durable)
   ▼
task complete (guards: all criteria passed + evidence)
   │
   ▼
Baseline N+1 draft captures the evolved graph
   │  baseline.activate → supersedes Baseline N
   ▼
Baseline N+1 (ACTIVE)
```

## Proposed domain surface

### 1. AcceptanceEvaluation (durable)

A persisted evaluation of one TaskSpecVersion's criteria against a Run's
evidence, produced by the user.

```ts
AcceptanceEvaluation {
  id
  projectId
  taskId
  taskSpecVersionId
  runId            // the evidence the user evaluated
  status           // 'PENDING' | 'PASSED' | 'FAILED'  (derived at record time)
  criteria: Array<{
    criterionId
    verdict           // 'PASSED' | 'FAILED'
    note              // string | null
  }>
  createdAt
  updatedAt
}
```

Command: `acceptance.evaluate({ projectId, taskId, taskSpecVersionId, runId,
criteria: [{ criterionId, verdict, note? }] })` → creates/updates the
evaluation. Invariants:
- The Run must be `FINISHED` and belong to the task/project.
- Verdicts must reference exactly the criteria of the pinned TaskSpecVersion.
- A re-evaluation replaces the previous verdict (the newest evaluation wins).

### 2. Task completion

Command: `task.complete({ taskId })`. Guards (mirror the Phase 3 gates, now
durable):
- Task is not already COMPLETED / CANCELLED / ARCHIVED.
- An AcceptanceEvaluation exists with `status = 'PASSED'`.
- The evaluated Run is `FINISHED` with a usable outcome.
- Optional: an applied artifact / promoted baseline prerequisite (decision 2).

Transition: `IN_PROGRESS / WAITING_REVIEW → COMPLETED` (exact previous status
decides; a helper `assertTaskTransition`).

### 3. Baseline N+1 draft + promotion

`baseline.createDraft` already exists (project-scoped, nodeVersionIds). Add a
higher-level flow that materializes the post-task graph into a new draft and
activates it, superseding the ACTIVE baseline:

- `baseline.promote({ projectId, taskId, name, nodeVersionIds, note? })` —
  creates a DRAFT from the task's resulting node versions, then
  `baseline.activate` (existing, supersedes the current ACTIVE).
  - Guard: only after the task is COMPLETED.
- OR keep it as two explicit steps (createDraft → activate) and only add
  `baseline.createDraft` wiring to the UI. (decision 3)

## Open design decisions (awaiting freeze)

1. **Artifact apply**: does this packet include materializing the Run's patch
   into new NodeVersions/Edges (so Baseline N+1 has real content), or is patch
   apply a separate earlier packet and this one only wires the review/completion/
   promotion commands over the existing graph authoring commands?
2. **Task completion prerequisite**: is `baseline.promote` (or a drafted
   Baseline N+1) required before `task.complete`, or is completion independent
   and promotion a follow-up explicit step?
3. **Promotion surface**: a single `baseline.promote` command (create+activate
   atomic) vs. wiring the existing `baseline.createDraft` + `baseline.activate`
   separately?
4. **Artifact user review**: persist an `ArtifactReview` aggregate
   (accept / reject / changes-requested) as part of completion, or keep artifact
   review session-only and gate completion on the acceptance evaluation only?
5. **Evaluation granularity**: per-criterion verdicts (recommended) vs. a single
   overall verdict.
6. **Renderer scope**: wire the review/completion/promotion flow into the Live
   view (recommended) in this packet, and does the CoreFlow fixture screen
   migrate its locked gates to the real commands?

## Out of scope (this packet)

- Patch application to the source repository (git) — deferred unless decision 1
  chooses otherwise.
- Multi-user approval / roles.
- Checkpoint / resume.
- Streaming acceptance events.

## Test matrix

- persistence: acceptance.evaluate CRUD + re-evaluation; task completion guards
  (wrong status / missing evaluation / failed evaluation); baseline promote
  supersede semantics; run↔evaluation linkage.
- contracts: new command request/response schemas.
- main: WorkspaceService wiring + guards.
- renderer: Live review flow (evaluate → complete → promote) via fake + real
  E2E: full loop `freeze → dispatch → evaluate → complete → promote` against the
  real backend.
- restart persistence: the evaluation + completed task + promoted baseline
  survive restart.

## Delivery

- `packages/contracts`: `acceptance.evaluate`, `task.complete`,
  `baseline.promote` (per decisions).
- `packages/persistence`: acceptance_evaluation table + task transition +
  baseline promotion.
- `apps/desktop/src/main`: WorkspaceService + routes.
- `apps/desktop/src/renderer`: Live review flow; fake transport.
- docs: this ADR + verification packet. Gate: `pnpm check` + `phase3-smoke` +
  `e2e:live` + PR CI.
