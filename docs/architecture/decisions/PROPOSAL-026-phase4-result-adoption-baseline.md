# PROPOSAL-026 — Phase 4 #5: Result Adoption + Baseline Promotion

- **Status:** Draft — awaiting architecture freeze
- **Author:** DeepSeek V4 Flash
- **Date:** 2026-08-08
- **Basis:** Phase 4 #4 close-out direction; the frozen MVP loop
  `Baseline N → Task → Run → Baseline N+1`; the "adoption authorization" note in
  PROPOSAL-025; the BaselineEdgeItem design debt.

## Problem

The execution → human-judgement → completion chain is durable (Phase 4 #3/#4),
but the last, most dangerous step is not: a COMPLETED Task's accepted PATCH never
touches the real repository, so no `RepositoryRevision N+1` and no `Baseline
N+1` exist. Until then the loop is not closed, and a naive "promote" would only
relabel the old project state.

Phase 4 #5 introduces the **adoption authorization**: a durable, explicit,
auditable side effect that mutates real project state. This is a different
concept from acceptance judgement (Phase 4 #4) — the user says "I authorize
this accepted result to be applied".

## Goal (the final loop)

```text
COMPLETED Task + accepted Run Artifact (PATCH)
   │  explicit artifact.apply  (adoption authorization)
   ▼
real repository mutation
   │  git apply → commit (or recorded working-tree change)
   ▼
RepositoryRevision N+1 (persisted)
   │  baseline.createCandidateFromTask (Main materializes)
   ▼
Baseline N+1 DRAFT (NodeVersions + RepositoryRevision [+ edges])
   │  user reviews the DRAFT
   ▼
baseline.activate (existing) → Baseline N SUPERSEDED, N+1 ACTIVE
```

## Proposed surface

### 1. `artifact.apply` — adoption authorization

```ts
artifact.apply({ runId, executionRequestId, taskId })
  → { repositoryRevisionId }   // the new RepositoryRevision N+1
```

Guards (mirror the existing trust boundaries):
- The Task is COMPLETED.
- The Run is FINISHED with a usable outcome.
- The evaluated/complete evidence exists (latest PASSED evaluation → the Run).
- The Run's PATCH artifact exists and its contentHash is verified (already
  persisted byte-for-byte at ingest).
- **Explicit authorization**: the user invoked `artifact.apply`; there is no
  automatic adoption.

Mechanics:
- `GitRepositoryWriter` (new, Main-side) runs `git apply` of the patch in the
  source repo, then `git add -A` + `git commit` with a deterministic message
  (`canvas-agent: adopt <runId> <taskId>`), producing a new commit.
- A new `RepositoryRevision` row is upserted from the resulting
  baseCommit/treeHash/workingTreePatchHash (reusing `revision.current` after the
  apply), and the Run is linked to it (or a new `artifact_application` record).
- If the working tree is dirty or the patch fails to apply → ValidationError,
  no mutation, no partial state.

### 2. Adoption record (durable authorization)

A new append-only aggregate recording the side effect:

```ts
ArtifactApplication {
  id
  projectId
  runId
  executionRequestId
  taskId
  repositoryRevisionId    // N+1
  patchHash               // the applied patch
  appliedAt
}
```

This is the auditable "who/what/when" of the repository mutation.

### 3. `baseline.createCandidateFromTask` — Main materializes Baseline N+1

The Renderer does NOT submit a full candidate state. Main builds it:

```ts
baseline.createCandidateFromTask({ projectId, taskId, name })
  → { baseline }   // DRAFT
```

Materialization:
- Reads the ACTIVE Baseline N (projectId-scoped).
- Applies the task's target nodeVersion changes (decision: how adoption maps to
  new NodeVersions) to produce the candidate item set.
- Pins the new `RepositoryRevisionId` (N+1 from `artifact.apply`).
- Creates a DRAFT baseline (reusing `createBaselineDraft` internals).
- Leaves activation to the explicit existing `baseline.activate`
  (DRAFT → ACTIVE, supersedes N). No atomic promote.

## Open design decisions (awaiting freeze)

1. **Patch → NodeVersion mapping**: after `git apply`, how do the task's target
   nodes get new NodeVersions? Options:
   - (a) Adoption auto-publishes new NodeVersions for the task's targets whose
     content is read from the patched files (Main resolves file content at the
     new revision). Strongest "the loop closed" semantics.
   - (b) The user explicitly authors the new NodeVersions with the existing
     `nodeVersion.publish`; adoption only advances the repository revision, and
     the baseline candidate uses the latest authored versions. Least magic.
2. **Commit strategy**: deterministic Main-authored commit (recommended — one
   commit per adoption, auditable) vs. record the working-tree state as the new
   revision without committing (keeps user's git history untouched).
3. **BaselineEdgeItem**: implement graph-edge freezing (BaselineEdgeItem) now
   (decision A) vs. MVP freezes only NodeVersions + RepositoryRevision (B).
4. **Re-apply safety**: forbid a second `artifact.apply` for the same Run, and
   require a clean working tree before apply.
5. **Renderer scope**: wire `artifact.apply` + baseline candidate review into the
   Live view (recommended); CoreFlow APPLY_ARTIFACT / ACTIVATE_BASELINE unlock to
   the real commands.
6. **Idempotency / migration**: the migration backfills nothing new, but the new
   tables need a migration.

## Safety / trust boundary (the core of this packet)

- Main performs the repository mutation through a narrow `GitRepositoryWriter`
  (no shell interpolation; `git apply` / `add` / `commit` with argument arrays).
- The applied patch is the already-verified PATCH artifact (contentHash matched
  at ingest); it is never re-read from an untrusted path.
- Everything is gated on an explicit user action; there is no automatic adoption.
- The whole side effect is recorded in `ArtifactApplication` (append-only) and an
  audit entry, and the resulting RepositoryRevision is durable.
- A failed apply leaves no partial state (transactional-ish: validate clean
  tree → apply → commit; on failure, no rows are written).

## Out of scope (this packet)

Checkpoint/resume, multi-user approval roles, streaming events, and any
automatic (non-explicit) adoption.

## Test matrix

- persistence: ArtifactApplication append-only; baseline candidate materializes
  from ACTIVE baseline + new revision; BaselineEdgeItem (if decision 3 = A).
- main: GitRepositoryWriter applies a fixture patch and commits; dirty-tree
  rejection; re-apply rejection; revision.current reflects N+1.
- contracts: `artifact.apply` / `baseline.createCandidateFromTask` schemas.
- renderer: Live adoption flow; CoreFlow APPLY/ACTIVATE unlock.
- **Restart E2E**: complete → apply → new revision → baseline candidate DRAFT →
  restart → candidate + new revision durable → activate → Baseline N SUPERSEDED /
  N+1 ACTIVE.

## Delivery

- `packages/contracts`: two commands + schemas.
- `packages/persistence`: artifact_application (+ baseline_edge_item if A) tables
  + commands + migration.
- `apps/desktop/src/main`: `GitRepositoryWriter` + WorkspaceService + routes.
- `apps/desktop/src/renderer`: Live adoption/review; CoreFlow unlock; fake.
- docs: this ADR + verification packet. Gate: `pnpm check` + `phase3-smoke` +
  `e2e:live` + PR CI.
