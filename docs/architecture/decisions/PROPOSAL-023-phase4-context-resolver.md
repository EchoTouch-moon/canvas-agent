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

Future kinds (`REPOSITORY_CONTENT`, `ARTIFACT`, `USER_INPUT`) are documented here,
**not schema-valid**. Add one, implement one. In particular:

- `REPOSITORY_CONTENT` shape is not frozen (its revision must come from the
  resolution scope, not be embedded — `expectedRepositoryRevisionId` already
  exists, and RepositoryRevision is baseCommit+treeHash+workingTreePatchHash, not
  a bare commit).
- `USER_INPUT` is not a reference; if ever needed it will be a persisted entity
  reference or an explicit `InlineUntrustedContent` with
  `authority: UNTRUSTED_CONTENT`.
- `ARTIFACT` waits for Artifact persistence.

### Decision 3 — `context.resolve` is deferred

Deferred to the RepositoryContent packet, when the renderer needs to preview
content it does not already have in `ProjectStateView`.

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
