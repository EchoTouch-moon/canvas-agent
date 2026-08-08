# PROPOSAL-026 — Phase 4 #5: Result Adoption + Baseline Promotion (durable side-effect protocol)

- **Status:** APPROVED — direction frozen, entering implementation
- **Author:** DeepSeek V4 Flash (architecture decisions by the lead)
- **Date:** 2026-08-08
- **Basis:** Phase 4 #4 close-out; the frozen MVP loop
  `Baseline N → Task → Run → Acceptance → Baseline N+1`.

## Core problem

Git and SQLite cannot form a single ACID transaction. Once this phase mutates
the user's real repository, a "validate → apply → commit → write success row"
model is unsafe: the dangerous window is `Git commit succeeded → Main crashed →
SQLite has no RepositoryRevision / ArtifactApplication`. The system must
therefore guarantee that the external side effect is **identifiable, retryable
and reconcilable**, not pretend partial state never happens.

Three trusted terminal conclusions are allowed:

```text
A. proven repository still at Base N
B. proven adoption succeeded and persisted as N+1
C. state unknown → INTERRUPTED / recovery required
```

Never: "the repository may have changed but the system reports FAILED/rolled
back".

## Decisions

1. **Patch → NodeVersion: no automatic mapping, no implicit latest NodeVersion.**
   NodeVersion is project semantics, not a Git-file mirror. The candidate
   inherits the parent Baseline's NodeVersion set exactly.
2. **Commit strategy: Main-authored commit only.** Adoption yields a committed
   `R2 (baseCommit = def456, workingTreePatchHash = null)`; dirty
   working-tree revisions are unsupported. Runs with
   `Run.repositoryRevision.workingTreePatchHash !== null` are rejected
   (`dirty_run_revision_adoption_unsupported`).
3. **BaselineEdgeItem: deferred.** MVP Baseline consensus = NodeVersions +
   RepositoryRevision. No edge-set backfill.
4. **Idempotency:** one logical application per Task / PATCH (UNIQUE taskId,
   UNIQUE artifactId). A retry of an APPLIED application returns the existing
   result; it never creates a second Git commit.
5. **Renderer:** Live view gets the full flow; CoreFlow unlocks
   APPLY_ARTIFACT / CREATE_BASELINE / ACTIVATE_BASELINE as three separate
   explicit clicks.
6. **Migration:** `artifact_application`, `artifact_application_event`,
   `baseline_candidate_source`; no semantic backfill (legacy provenance absent).

## Command surface

| command | payload | response |
|---|---|---|
| `artifact.apply` | `{ taskId, evaluationId, artifactId }` | `ArtifactApplicationAggregate` |
| `artifactApplication.list` | `{ taskId }` | `ArtifactApplicationAggregate[]` |
| `baseline.createCandidateFromTask` | `{ applicationId, name, description? }` | `BaselineCandidateAggregate` |
| `baseline.activate` | `{ baselineId }` (strengthened) | existing result |

`artifact.apply` payload is narrow: Main derives run / executionRequest / project
/ base state from the persisted graph.

## Adoption guards (`artifact.apply`)

1. `Task.status === COMPLETED`
2. `evaluation.taskId === task.id`
3. evaluation is the Task's latest evaluation
4. `evaluation.status === PASSED`
5. `evaluation.taskSpecVersionId ===` latest published TaskSpecVersion
6. `evaluation.runId → Run`
7. `Run.status === FINISHED`
8. `Run.outcome ∈ SUCCEEDED | PARTIAL | TIMED_OUT`
9. `Run.taskId === Task.id`
10. `Run.taskSpecVersionId === evaluation.taskSpecVersionId`
11. Artifact = selected `artifactId`
12. `Artifact.kind === PATCH`
13. `Artifact.runId === Run.id`
14. `Artifact.executionRequestId` belongs to Run
15. `sha256(artifact.content) === artifact.contentHash` (re-verified now)
16. `byteLength(content) === sizeBytes`
17. if `ExecutionRequestRecord.patchHash != null`: `artifact.contentHash === request.patchHash`
18. patch content non-empty
19. Run's repository revision is clean
20. current real repository revision === Run's repository revision (exact base)
21. current ACTIVE baseline === Snapshot.baseBaselineId (no stale adoption)
22. no conflicting prior ArtifactApplication

## Data model

### `artifact_application` (immutable authorization binding)

```ts
{ id, projectId, taskId, evaluationId, runId, executionRequestId, artifactId,
  baseBaselineId, baseRepositoryRevisionId, patchHash, authorizedAt }
// UNIQUE(taskId), UNIQUE(artifactId)
```

### `artifact_application_event` (append-only lifecycle)

```ts
{ id, applicationId, sequence, kind, repositoryRevisionId?, reasonCode?,
  detail?, createdAt }   // UNIQUE(applicationId, sequence)
```

`kind: AUTHORIZED | APPLYING | APPLIED | FAILED | INTERRUPTED`; effective status
is the latest event.

- **FAILED**: system proved `repository == base` and clean.
- **INTERRUPTED**: system cannot prove whether a side effect occurred
  (process crash, rollback failed, unexpected Git state).
- **APPLIED**: commit exists + repository clean + RepositoryRevision persisted.

### `baseline_candidate_source` (provenance)

```ts
{ baselineId (PK), parentBaselineId, taskId, artifactApplicationId } // UNIQUE(artifactApplicationId)
```

## Protocol

```text
artifact.apply
│  resolve Task / latest PASSED evaluation / Run / PATCH
│  verify artifact bytes/hash; ACTIVE baseline == Snapshot.baseBaseline
│  verify current repo == Run revision and clean
│  DB TX: Application binding + event #0 AUTHORIZED + audit
│  event #1 APPLYING
│  re-check exact base
│  GitRepositoryWriter:
│    git apply --check → git apply --index → controlled commit → verify clean
│  DB TX: upsert RepositoryRevision N+1 + event #2 APPLIED + audit
```

### Side-effect idempotency

If the application is already APPLIED, a retry returns the existing application +
revision; Git HEAD is untouched and no second commit is created.

### Crash-gap reconciliation

On retry with latest event APPLYING / INTERRUPTED, inspect Git HEAD:

- **Case A** `HEAD == original base` and clean → retry the writer.
- **Case B** `HEAD.parent == original base` and commit trailers match
  applicationId / artifactId / patchHash and clean → **do not reapply**; upsert
  RepositoryRevision + append APPLIED.
- **Case C** anything else → `application_recovery_conflict`, fail closed.

Commit trailers:

```text
Canvas-Agent-Application: <applicationId>
Canvas-Agent-Run: <runId>
Canvas-Agent-Artifact: <artifactId>
Canvas-Agent-Patch-SHA256: <patchHash>
```

## GitRepositoryWriter boundary

- No shell interpolation; argument arrays only.
- `git apply --check` then `git apply --index` (no `git add -A`).
- Controlled identity (author/committer), `commit.gpgSign=false`,
  `hooksPath` = trusted empty directory, dates = `authorizedAt`.
- Main decides repo path / argv / message / working dir; the renderer never does.
- Local commit only; never pushes.

## Baseline candidate (`baseline.createCandidateFromTask`)

- Requires the application to be APPLIED.
- `current ACTIVE baseline.id === application.baseBaselineId`.
- `current real repo === application result revision`.
- Copies the parent Baseline's exact NodeVersion items + positions; pins the
  result RepositoryRevision; creates a DRAFT baseline + `baseline_candidate_source`.
- Idempotent: one candidate per application; a retry with a different
  name/description → ValidationError (the DRAFT is never silently mutated).

## `baseline.activate` (strengthened)

For a baseline with `baseline_candidate_source`:

- `current ACTIVE baseline.id === candidate.parentBaselineId`
  (else `baseline_candidate_parent_is_stale`).
- `current real repo === candidate RepositoryRevision` (Main reads Git before
  the persistence activation).

## Retiring session-only ArtifactReview

The old CoreFlow Accept/Reject/Request-changes session controls are removed.
`AcceptanceEvaluation` remains the judgement; `artifact.apply` is the adoption
authorization. No second approval source.

## Out of scope (this packet)

BaselineEdgeItem, checkpoint/resume, multi-user approval, streaming events,
automatic (non-explicit) adoption, push.

## Test matrix

- persistence: application lifecycle events; one-per-task/artifact idempotency;
  candidate provenance + idempotency; candidate-parent-stale guard.
- main: GitRepositoryWriter apply/commit/trailers; exact-base and stale-base
  rejection; crash-gap reconciliation (commit succeeded / DB finalize failed →
  retry detects matching commit → APPLIED, no reapply).
- contracts: three commands + schemas.
- **Restart E2E**: `C1 → apply → C2` (HEAD C2, parent C1, clean) → application
  APPLIED → repeat apply → HEAD still C2, no second commit → create candidate →
  Baseline N+1 DRAFT (parent N, source A1, revision R2, NodeVersion set == N) →
  restart same userData + repo → application still APPLIED / candidate still
  DRAFT / repo still C2 → `baseline.activate` → N SUPERSEDED / N+1 ACTIVE →
  ACTIVE.repositoryRevision == actual Git HEAD.

## Delivery

- `packages/contracts`: three commands + schemas.
- `packages/persistence`: three tables + migration (no backfill) + commands.
- `apps/desktop/src/main`: `GitRepositoryWriter` + WorkspaceService adoption
  flow + candidate + strengthened activate.
- `apps/desktop/src/renderer`: Live adoption flow; CoreFlow unlock + retire;
  fake.
- docs: this ADR + verification packet. Gate: `pnpm check` + `phase3-smoke` +
  `e2e:live` + PR CI.
