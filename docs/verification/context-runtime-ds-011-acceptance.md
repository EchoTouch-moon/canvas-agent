# DS-011 Acceptance — Authoritative Repository Observer

- **Status:** ✅ ACCEPTED / MERGED
- **Task packet:** `docs/tasks/deepseek/DS-011-repository-observer.md`
- **Implementation branch:** `agent/deepseek-ds-011-repository-observer`
- **Accepted implementation HEAD:** `39eaa406c96e252207b96ed2858bd0fd981445a2`
- **PR:** #20
- **Merge commit:** `d718f2f79785ef67714944f1909b37c94f9b4271`
- **Date:** 2026-08-11
- **Decision owner:** lead architect

## Decision

DS-011 is accepted as the authoritative, provider-neutral repository world-state observation seam required before file-aware CR-003B planning.

Accepted architecture boundary:

```text
Repository / exact RepositoryRevision
        ↓
Repository Observer
        ↓
SourceObservation + ContextSourceDescriptor
        ↓
CR-002 reconciliation
        ↓
Context Universe
```

The Observer answers **what file state is true**. It does not decide **whether or how much of that file the model should see**.

## Accepted invariants

1. Repository truth is independent of Pi/tool-result content and assistant claims.
2. Repository ContextSource identity is `repository/file://<canonical-path>`, exactly matching the CR-002 Pi resource-hint identity.
3. Pi resource hints do not create canonical Universe sources by themselves.
4. AVAILABLE requires an exact verified clean RepositoryRevision and supported bounded content.
5. ABSENT requires authoritative confirmation that the path is missing at the verified revision.
6. UNAVAILABLE is distinct from ABSENT and retains last-known admitted state through normal CR-002 semantics.
7. Revision state is checked before and after bounded reads; a post-read mismatch fails closed.
8. `verifiedRevision` is populated only for genuinely verified outcomes and is null for non-verified/race outcomes.
9. Dirty revisions remain fail-closed as `DIRTY_REVISION_UNSUPPORTED`; baseCommit is never silently substituted for dirty workspace truth.
10. Oversized and unsupported binary files fail closed with explicit reason codes.
11. Repository-specific logic stays outside `packages/context-runtime`.
12. Accepted Policy V0 consumes admitted repository sources through generic Runtime interfaces only.

## Final correction history closed

The lead review identified and the final implementation closed all bounded blockers:

- unified `repo://` vs `repository/file://` identity split;
- corrected truthful `verifiedRevision` semantics;
- made `FILE_TOO_LARGE` reachable and test-locked;
- added real oversized and non-UTF-8 fixtures;
- replaced pre-read mismatch masquerading as race evidence with deterministic before/after revision-reader evidence;
- distinguished `REPOSITORY_UNAVAILABLE` from `REVISION_MISMATCH`, including the real default adapter path;
- corrected DS-010 PR-number documentation.

## Final evidence

```text
pnpm --filter @canvas-agent/repository-observer test        22 passed
pnpm --filter @canvas-agent/repository-observer typecheck   PASS
pnpm --filter @canvas-agent/context-runtime test           78 passed
pnpm check                                                  GREEN (618 tests + build)
GitHub Actions CI #104                                      SUCCESS
Real temporary-Git smoke                                   EXECUTED
```

Real temporary-Git smoke exercised:

```text
AVAILABLE
→ dirty UNAVAILABLE(DIRTY_REVISION_UNSUPPORTED)
→ ABSENT
```

## Accepted limitations

- Dirty working-tree materialization is not implemented.
- Observation is targeted/bounded, not a repository crawler.
- Binary/oversized content is unavailable rather than partially represented.
- No source-code AST/symbol index exists.
- Raw repository content is not promoted into durable Runtime persistence.

These are explicit research boundaries, not acceptance failures.

## Scope confirmation

DS-011 did **not** implement:

```text
CR-003B file-aware representation policy
FULL / SYMBOL / LINE_RANGE / DIFF selection policy
REPLACE / COMPRESS behavior expansion
real Pi/model context rewrite
production persistence schema
v0.2 ContextSnapshot / ExecutionRequest / RepositoryRevision contract changes
OpenCode / Codex integration
CR-004
```

## Gate unlocked

DS-011 acceptance unlocks a separately authorized **CR-003B file-aware Shadow Planner** task.

It does **not** unlock active model-context rewrite by itself.

```text
CR-001  Pi Shadow Observation          ✅ ACCEPTED / MERGED
CR-002  Context Universe               ✅ ACCEPTED / MERGED
CR-003A Shadow Planner Kernel          ✅ ACCEPTED / MERGED
DS-011  Repository Observer            ✅ ACCEPTED / MERGED
CR-003B File-aware Shadow Planner      🔓 eligible for bounded authorization
CR-004  Active Context Rewrite         🔒 NOT AUTHORIZED
```
