# PROPOSAL-023 — Phase 4 #1: Context resolver / materialization + SourceReference unification

- **Status:** Draft — awaiting architecture freeze
- **Author:** DeepSeek V4 Flash
- **Date:** 2026-08-08
- **Basis:** Phase 4 close-out priority #1; the parked option B from
  `phase3-context-materialization-research.md`; the Phase 4 sourceRef TODO.

## Problem

Phase 3 closes the real loop with an untrusted freeze path:

1. **sourceRef is opaque and inconsistent.** The same conceptual reference is
   encoded three ways already:
   - `context-candidates.ts` / `phase3-smoke.ts`: `task-spec://<id>`, `node://<id>`;
   - `workspace-view.ts`: raw `spec.id` / `version.id`;
   - fake/legacy tooling: any string.
   A future ContextResolver must not have to understand `task-spec://`, raw uuids,
   `node://`, `path:` and `commit:` simultaneously.
2. **freeze content is fabricated by the renderer.** `snapshot.freeze` accepts
   `items[].resolvedContent` verbatim; nothing verifies it against the persisted
   aggregate it claims to reference. This is acceptable for a single-user Phase 3,
   not for an "execution substrate" that will do materialization, long-term memory
   and graph context assembly.
3. **RepositoryContent has no home.** Reading real repository files into a frozen
   snapshot (PROPOSAL-022 deferred `context.resolve`) needs a resolver boundary,
   not more renderer-fabricated content.

## Goals

1. One canonical `SourceReference` (typed discriminated union) that the renderer,
   Main, persistence and any future resolver all speak — plus a single
   `sourceRefToString`/`parseSourceRef` pair.
2. Main is the **single authority** that materializes frozen content from
   authoritative, project-scoped persistence. The renderer never fabricates
   `resolvedContent` for typed selections.
3. Freeze moves from "renderer sends content" to "renderer sends selections";
   the old content-based path stays available to tooling/tests only.
4. The resolver boundary is the place `RepositoryContent` lands later without
   another contract change.

## SourceReference (contracts)

```ts
type SourceReference =
  | { kind: 'TaskSpecVersion'; taskSpecVersionId: string }
  | { kind: 'NodeVersion'; nodeVersionId: string }
  | { kind: 'RepositoryContent'; path: string; commit?: string } // future
  | { kind: 'Artifact'; artifactId: string }                     // future, reserved
  | { kind: 'UserInput'; text: string }                          // future, reserved

sourceRefToString(ref): string      // task-spec://<id>, node://<id>, repo://<path>@<commit>
parseSourceRef(value: string): SourceReference  // throws on unknown scheme
```

- `SourceReference` is zod-validated (contracts) and serialized to the existing
  `SnapshotItem.sourceRef` string via `sourceRefToString` — the DB column is
  unchanged.
- Future kinds are **reserved in the union** but rejected by resolution until
  implemented, so the parser/resolver don't evolve piecemeal.
- Existing legacy strings (`node://nv_smoke`, raw ids) parse under the union where
  the scheme matches; anything unknown is a validation error.

## Resolver design (Main)

```ts
interface ContextResolver {
  resolve(projectId: string, ref: SourceReference): Promise<ResolvedContextItem>
}

interface ResolvedContextItem {
  readonly sourceRef: string            // canonical sourceRefToString
  readonly resolvedContent: string
  readonly contentHash: string
  readonly authority: ContextAuthority
  readonly priority: ContextPriority
  readonly tokenEstimate: number
}
```

Implementations (in the Main layer, backed by persistence read helpers):

| SourceReference | authority | priority | content |
|---|---|---|---|
| `TaskSpecVersion` | `TASK_INSTRUCTION` | `P0` | description + scope + criteria |
| `NodeVersion` | `PROJECT_FACT` | `P1` | title + body |
| `RepositoryContent` | (deferred) | (deferred) | git file read |

Invariants:
- A selection resolves only against aggregates in `projectId` (project-scoped; no
  cross-project source). Mismatch → error.
- `resolvedContent` is composed on Main from persisted fields; `contentHash` is
  recorded at freeze time for audit.

## Freeze contract options

- **B1 — replace `items` with `selections`** in `snapshot.freeze` (breaking).
  Cleanest surface, but breaks the content-based path used by smoke/tests/tooling.
- **B2 — add `snapshot.freezeFromSelections`** (additive, recommended).
  `snapshot.freezeFromSelections({ projectId, taskId, taskSpecVersionId,
  baseBaselineId, expectedRepositoryRevisionId, selections: SourceReference[] })`
  → Main resolves + materializes + freezes. Existing `snapshot.freeze` remains for
  tooling/tests (documented as internal).
- **B3 — single command, optional `selections` field**; exactly one of
  `items`/`selections` must be present. Least explicit; muddies validation.

Recommendation: **B2**. Additive, keeps the deterministic tooling path, gives the
renderer one obvious command.

Optional (non-blocking): `context.resolve` IPC command so the Composer can preview
resolved content + token estimates before freeze. The renderer already has
title/body/description locally, so this is an enhancement, not a requirement.

## Renderer changes (data wiring only)

- `context-candidates.ts` emits `SourceReference[]` selections instead of
  content-bearing items.
- The live Composer keeps its local selection/token preview; `freezeFromSelections`
  replaces `freeze`; the frozen snapshot evidence panel is unchanged.
- `workspace-view.ts` and any other raw-id sourceRef usage migrate to
  `sourceRefToString`.

## Out of scope (this packet)

- `RepositoryContent` file resolution (resolver interface only, reserved).
- `Artifact` / `UserInput` kinds (reserved, rejected by resolution).
- Revision pinning changes (`revision.current` → `expectedRepositoryRevisionId`
  flow is unchanged).
- Run/Artifact persistence, RunEvent, Checkpoint/Resume (Phase 4 #2–#4).

## Test matrix

- contracts: zod parse for each `SourceReference` kind + `sourceRefToString`/
  `parseSourceRef` round-trip; unknown scheme → validation error.
- resolver: each implemented kind materializes authoritative content with the
  right authority/priority; unknown source → error; cross-project source → error;
  contentHash stable for identical content.
- freeze-from-selections: end-to-end freeze with hashed materialized items;
  renderer-fabricated content path no longer reachable from the renderer IPC.
- renderer: `context-candidates` → selections; live view freeze via the new
  command (fake + real E2E updated).
- E2E: `e2e:live` freeze step driven via selections (Playwright, real backend).

## Delivery

- `packages/contracts`: `SourceReference` + schemas + `sourceRefToString`/
  `parseSourceRef`; `snapshot.freezeFromSelections` command; `context.resolve`
  (optional).
- `packages/persistence`: read helpers used by the resolver (already mostly
  present); `freezeContextSnapshot` reused after Main materializes.
- `apps/desktop/src/main`: `ContextResolver` + route wiring.
- `apps/desktop/src/renderer`: `context-candidates` → selections; live view wiring.
- docs: this ADR + verification packet row.
- Gate: `pnpm check` green + `e2e:live` green.

## Awaiting architecture decisions

1. Adopt B2 (`snapshot.freezeFromSelections`) vs B1/B3?
2. Reserve future `RepositoryContent`/`Artifact`/`UserInput` kinds in the union now
   (recommended) vs add them when implemented?
3. Ship `context.resolve` preview in this packet or defer to the repository-content
   packet?
