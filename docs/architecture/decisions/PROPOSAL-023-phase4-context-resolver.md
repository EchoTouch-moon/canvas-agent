# PROPOSAL-023 — Phase 4 #1: Context resolver / materialization + SourceReference unification

- **Status:** APPROVED WITH REQUIRED CHANGES — direction frozen, entering implementation
- **Author:** DeepSeek V4 Flash (architecture decisions by the lead)
- **Date:** 2026-08-08
- **Basis:** Phase 4 close-out priority #1; the parked option B from
  `phase3-context-materialization-research.md`; the Phase 4 sourceRef TODO.

## Problem

Phase 3 closes the real loop with an untrusted freeze path:

1. **sourceRef is opaque and inconsistent** (`task-spec://`, raw ids, arbitrary
   strings coexist across renderer / smoke / tooling).
2. **freeze content is fabricated by the renderer.** `snapshot.freeze` accepts
   `items[].resolvedContent` verbatim; persistence only hashes what it receives,
   so the hash proves "unchanged since freeze", not "frozen from an authoritative
   source at freeze time".
3. **RepositoryContent has no resolver home.**

## Core principle (frozen)

> **Renderer only selects the source. Main decides what that source actually
> freezes into.**

The renderer owns "I want this source"; it never owns "what this source should be
interpreted as" (itemType / authority / priority / tokenEstimate / resolvedContent /
contentHash / sourceRef string are all derived on Main; `position` is the array index).

## Decisions

### Decision 1 — Freeze contract: B1 (breaking), internal primitive stays

Public `snapshot.freeze(items)` is **removed**. The single public semantics become:

```ts
snapshot.freeze({
  projectId,
  taskId,
  taskSpecVersionId,
  baseBaselineId,
  expectedRepositoryRevisionId,
  selections: ContextSelection[]
})

interface ContextSelection {
  source: SourceReference
  selectionReason?: string | null
}
```

`freezeContextSnapshot(p, { items: ResolvedContextItem[] })` remains only as an
**internal persistence primitive** (Persistence tests may still test it directly).

```
public IPC        = selection-based only
Main resolver     = authoritative materialization
Persistence API  = resolved-item freeze primitive
```

### Decision 2 — No reserved future kinds in the public union

Phase 4 #1 supports exactly two kinds:

```ts
type SourceReference =
  | { kind: 'TASK_SPEC_VERSION'; taskSpecVersionId: string }
  | { kind: 'NODE_VERSION'; nodeVersionId: string }
```

Phase 4 #2 (implemented) adds the third:

```ts
  | { kind: 'REPOSITORY_CONTENT'; path: string }  // repo-root-relative POSIX path
```

`REPOSITORY_CONTENT` resolves the file at `scope.expectedRepositoryRevisionId`'s
`baseCommit` only; a dirty revision (`workingTreePatchHash !== null`) is rejected
(`repository_content_dirty_revision_unsupported`) — the baseCommit content never
masquerades as the full pinned revision. Future `ARTIFACT` / `USER_INPUT` kinds
remain documented, not schema-valid. Add one, implement one.

### Decision 3 — `context.resolve` (Phase 4 #2)

Added as a preview-only command sharing the full `ContextResolutionScope` and the
same `SourceReference[]` union (including `TASK_SPEC_VERSION` with the exact
pinned binding):

```ts
context.resolve({ projectId, taskId, taskSpecVersionId, baseBaselineId,
                   expectedRepositoryRevisionId, selections: SourceReference[] })
  → { items: ResolvedContextItem[] }
```

`context.resolve` is always a preview: the renderer never feeds the returned item
back into `snapshot.freeze`. Freeze only accepts `SourceReference` selections
(`NODE_VERSION | REPOSITORY_CONTENT`) and Main re-resolves them authoritatively
(invariant A).

## Phase 4 #2 hardening notes

- Repository paths are canonical repo-root-relative POSIX paths (no absolute,
  `..`, `//`, `\`, NUL; never silently normalized).
- `repo://` encoding is segment-wise `encodeURIComponent`; parsing decodes,
  validates and re-encodes with an exact-match requirement.
- Repository content is UTF-8 text only, capped at 512 KiB; oversized or
  non-UTF-8 reads fail closed (`repository_content_too_large` /
  `repository_content_not_utf8`), never freezing truncated content.
- Authority/priority: `REPOSITORY_CONTENT → REFERENCE / P2`.
- TODO (not in this packet): dirty-repository content requires persisting a
  `workingTreePatchBlob` / full workspace delta — `workingTreePatchHash` alone
  cannot reconstruct untracked/modified content.

## Invariants (A–F)

- **A. Renderer submits metadata-free selections.** A selection is only
  `{ source, selectionReason? }`. Main derives `itemType`, `authority`, `priority`,
  `tokenEstimate`, `sourceRef`, `resolvedContent`, `contentHash`; `position` is the
  array index.
- **B. Resolver is scope-parameterized.** The signature carries the full snapshot
  binding so RepositoryContent can join later without breaking it:

  ```ts
  interface ContextResolutionScope {
    projectId: string
    taskId: string
    taskSpecVersionId: string
    baseBaselineId: string
    expectedRepositoryRevisionId: string
  }

  interface ContextResolver {
    resolve(scope: ContextResolutionScope, ref: SourceReference): Promise<ResolvedContextItem>
  }
  ```

- **C. `ResolvedContextItem` includes `itemType`:**

  ```ts
  interface ResolvedContextItem {
    readonly itemType: ContextItemType
    readonly sourceRef: string
    readonly resolvedContent: string
    readonly contentHash: string
    readonly authority: ContextAuthority
    readonly priority: ContextPriority
    readonly tokenEstimate: number
  }
  ```

- **D. The pinned TaskSpecVersion is auto-materialized.** Main always freezes the
  snapshot's `taskSpecVersionId` as `USER_INPUT / TASK_INSTRUCTION / P0` at
  position 0. The renderer never sends it. This structurally eliminates
  `header spec != selected spec`. The renderer may display it as a pinned/required
  row but it is not a selection and is not submitted.

- **E. NodeVersion must be a member of `baseBaseline`.** A `NODE_VERSION` selection
  resolves only if `nodeVersion.project === projectId` AND the version is in
  `baseBaseline.items` → `NODE_VERSION / PROJECT_FACT / P1`. Anything else is an
  error; non-baseline references would require a `REFERENCE / P2` resolver later.

- **F. No duplicate sources.** `sourceRefToString(ref)` is the canonical
  uniqueness key; a repeated source in one freeze → `ValidationError` with
  `duplicate_context_source`.

## Canonical materialization (hash-stable, test-locked)

- **TaskSpecVersion** content (ordered by `position ASC`):
  `description`, `scope`, `targets` (each `nodeId` + `nodeVersionId`),
  `criteria` (each `description` + `verificationMethod`). This matches the
  TaskSpec `contentHash` coverage; UI copy must never leak into it.
- **NodeVersion** content: `title` + `body`.

## Encoding

`sourceRefToString()` produces only canonical forms
(`task-spec://<id>`, `node://<id>`); `parseSourceRef()` accepts only canonical
forms; raw ids are `INVALID`. Historical frozen snapshots keep their old strings
and are **not migrated** (immutable). New freezes are canonical only.

## Frozen end-to-end flow

```text
Renderer
  │ snapshot.freeze({ ..., selections: [{ source: NODE_VERSION(...) }, ...] })
  ▼
Main / WorkspaceService
  ├ validate bindings
  ▼
ContextResolver
  ├ auto-materialize pinned TaskSpec → USER_INPUT / TASK_INSTRUCTION / P0
  ├ resolve each NodeVersion → same project + baseBaseline member → NODE_VERSION / PROJECT_FACT / P1
  ├ canonical sourceRef + content + tokenEstimate + SHA-256
  ▼
ResolvedContextItem[]
  ▼
freezeContextSnapshot(...)
  ▼
single SQLite transaction → FROZEN ContextSnapshot
  ▼
ExecutionCoordinator
```

The renderer can no longer control `resolvedContent / contentHash / authority /
priority / itemType / tokenEstimate`.

## Out of scope (this packet)

- `REPOSITORY_CONTENT` / `ARTIFACT` / `USER_INPUT` kinds (documented, not
  schema-valid).
- `context.resolve` preview (deferred to the RepositoryContent packet).
- Revision pinning changes (unchanged).
- Run/Artifact persistence, RunEvent, Checkpoint/Resume (Phase 4 #2–#4).

## Test matrix

- contracts: zod parse per kind; `sourceRefToString`/`parseSourceRef` round-trip;
  raw/non-canonical → validation error.
- resolver: TaskSpecVersion canonical content + hash stability; NodeVersion
  materialization; wrong project → error; nodeVersion not in baseBaseline →
  error; duplicate source → `ValidationError duplicate_context_source`.
- freeze-from-selections: end-to-end freeze (pinned task spec at position 0 +
  selections), single transaction; content-bearing input no longer reachable from
  renderer IPC.
- renderer: composer emits `SourceReference` selections; live view freeze via the
  new contract (fake + real E2E).
- E2E: `e2e:live` freeze driven via selections against the real backend.

## Delivery

- `packages/contracts`: `SourceReference` + `sourceRefToString`/`parseSourceRef`;
  `snapshot.freeze` selections schema (breaking); output item schema kept.
- `packages/persistence`: `freezeContextSnapshot` unchanged as the internal
  primitive; baseline-membership read helper.
- `apps/desktop/src/main`: `ContextResolver` + `WorkspaceService.freezeSnapshot`
  (selections) + wiring; phase3-smoke migrated to selections.
- `apps/desktop/src/renderer`: `context-candidates` → selections; pinned task spec
  row; live view freeze; fake-workspace / use-workspace migrated.
- docs: this ADR (revised) + verification packet row.
- Gate: `pnpm check` green + `e2e:live` green.
