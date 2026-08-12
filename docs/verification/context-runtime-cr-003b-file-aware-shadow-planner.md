# CR-003B Verification — File-aware Shadow Planner

- **Status:** EVIDENCE READY (rev.2 — PR #22 corrections applied); not self-accepted; awaits lead re-review
- **Packet:** `docs/tasks/deepseek/DS-012-file-aware-shadow-planner.md`
- **Owner:** DeepSeek V4 Flash — Context Runtime research implementer
- **Branch:** `agent/deepseek-ds-012-file-aware-shadow-planner`
- **Date:** 2026-08-11 (rev.2 after PR #22 architecture review)
- **Dependency:** DS-011 Repository Observer accepted and merged (PR #21)

---

## 1. Implementation boundary and modified files

- **`packages/repository-observer`** — new `FileRepresentationProvider` (FULL / LINE_RANGE / REFERENCE materialization of an admitted repository/file SourceVersion), `RepositoryRepresentationRequest`, `sourceKeyToPath`.
- **`packages/context-runtime`** — `ContextRepresentationNeed` + `representationNeeds` in `ContextPlanningRequest`; new reason codes (`REPRESENTATION_NARROWED`, `DETAIL_REQUIRED`, `SOURCE_VERSION_ADVANCED`); `planningRequestHash` includes representation needs; Policy V0 emits real `REPLACE` decisions; `ShadowPlanningMetrics` extended with representation counts + token delta; `ContextWorkingSetItem.representationKind`.
- **`packages/pi-context-integration`** — `ShadowPlannerObserver` file-aware materialization phase (`representationProvider` seam + `filePathCandidates`), `buildRepresentationNeeds`, `smoke:deepseek:cr003b`.
- **Docs** — this verification artifact.

Runtime core remains provider-neutral and Git-free (no Git import, no repository-observer import, no Pi literal).

## 2. Representation-provider architecture

`FileRepresentationProvider.materialize(request)`:

```text
pre-verify exact revision
→ read bounded file (readGitBlob, 512 KiB, strict UTF-8)
→ sha256(full content) == admitted SourceVersion contentHash  (else fail-closed)
→ post-verify exact revision
→ derive FULL / LINE_RANGE / REFERENCE
```

- **REFERENCE** does not reread the file and carries no content claim (provenance-only).
- **Dirty** revisions fail closed (`DIRTY_REVISION_UNSUPPORTED`), matching DS-011.
- Oversized / binary / read-failure / content-hash-mismatch / revision-mismatch / race all fail closed.
- Raw content is never persisted; only hash / token estimate / derivation metadata.

## 3. SourceVersion ↔ materialized content binding

Every FULL / LINE_RANGE representation carries the exact admitted `sourceVersionIds`. Materialization verifies `sha256(read content) == admitted SourceVersion.contentHash` before deriving any content-bearing representation (test A-4). Revision is verified before and after the read (tests A-5/A-6 semantics; dirty A-7; oversized A-8; binary A-8).

## 4. Representation kinds exercised

`FULL` and `LINE_RANGE` are real, deterministic and provenance-preserving; `REFERENCE` is available and cheap. `SYMBOL` / `DIFF` / `SUMMARY` remain contract vocabulary (not exercised). `COMPRESS` is not emitted.

## 5. LINE_RANGE semantics

- 1-based, inclusive-inclusive.
- Out-of-range requests **fail closed** (`LINE_RANGE_OUT_OF_BOUNDS`), never guessed/clamped.
- `derivation.requestedRange` == `effectiveRange` (deterministic).
- Same range + same SourceVersion → same representation id/hash (B-11); different range → different id/hash (B-12).

## 6. PlanningRequest changes

- `ContextRepresentationNeed { sourceKey, preferredKind, lineRange?, reasonCode }` in `representationNeeds`.
- `planningRequestHash` includes normalized representation needs (sorted by sourceKey) — equivalent requests hash identically (C-16).
- Missing representation need preserves the existing REFERENCE fallback (C-19).
- No repository/Pi literal appears in the core request type.

## 7. REPLACE semantics

Policy V0 compares the previous Working Set item's `representationId` against the current representation for a still-active source:

- same source/version + same representation → `KEEP`;
- same source/version + representation changed → `REPLACE` (`REPRESENTATION_NARROWED` or `DETAIL_REQUIRED` from the need);
- same sourceKey + SourceVersion advanced → `REPLACE(SOURCE_VERSION_ADVANCED)` with a fresh representation of v2 (stale v1 representation not retained);
- source leaves active set → `REMOVE`; removed source returns → `REHYDRATE` (regressions locked).

Tests D-20..D-28 cover ADD, KEEP, REPLACE (both directions), no-REMOVE+ADD pairing, REMOVE, REHYDRATE, and SourceVersion-advance replacement.

## 8. Source-version freshness

`isRepresentationFresh` (existing) marks a representation stale when its source version is no longer admitted; Policy V0 emits `REPLACE(SOURCE_VERSION_ADVANCED)` for a same-key new version instead of a stale KEEP (test D-27/28).

## 9. Pi hint vs Observer authority

Representation materialization only runs for repository/file entries **admitted into the Universe** (Observer/materializer truth). A Pi tool-result payload cannot produce a FULL/LINE_RANGE representation; `buildRepresentationNeeds` uses explicit file-path candidates from harness config, never assistant prose. The file-aware live smoke seeds the file source through `REPOSITORY_OBSERVER` provenance and materializes from repository truth.

## 10. Deterministic test evidence

```bash
pnpm --filter @canvas-agent/context-runtime test        86 passed
pnpm --filter @canvas-agent/repository-observer test    35 passed
pnpm --filter @canvas-agent/pi-context-integration test 51 passed
all three package typechecks                            PASS
pnpm check                                              GREEN (642 tests + build)
```

New CR-003B coverage: representation materialization (A incl. post-read race seam and binary), LINE_RANGE (B incl. exact content), PlanningRequest determinism (C incl. needs-in-hash), representation decisions / REPLACE (D), authority boundary (E via repo tests + Pi observer), Shadow seam (F via Pi observer tests incl. fail-safe + duplicate-need determinism), and scope regression (G).

## 11. Credential-free temporary-Git smoke

```text
Command: pnpm --filter @canvas-agent/repository-observer smoke:file-aware
SMOKE_STATUS: EXECUTED
FULL=95d361722af2
LINE_RANGE=d0c948cc8b26
FULL->LINE_RANGE replace=REPLACE
v2 FULL=20cdd25e8f89 (source v2)
```

Deterministic sequence: Source v1 observed → FULL → LINE_RANGE → FULL (REPLACE) → file changes / Source v2 → fresh representation for v2. No model credentials; no raw secret material.

## 12. Real Pi + DeepSeek Shadow smoke

```text
Command: CANVAS_CONTEXT_LIVE_SMOKE=1 pnpm --filter @canvas-agent/pi-context-integration smoke:deepseek:cr003b
SMOKE_STATUS: EXECUTED
provider: deepseek   model: deepseek-v4-flash
observed model-call count: 2
last plan FULL=1 LINE_RANGE=0 REFERENCE=2 proposed=18 native=81
```

The file-aware planner observer materialized the authoritative fixture file into a FULL representation inside the real Pi `context` seam, recorded it in a Shadow Working Set, and returned the original Pi messages unchanged. `REPLACE` proof is carried by the deterministic + temporary-Git smokes; the live smoke proves real-seam interoperability. Trace is metadata-only, credential-free, and gitignored.

## 13. Native vs proposed metric scope

- `nativeContextEstimate` = CR-001 `ModelCallObservation.observedMessageTokenEstimate`, scoped `agent-messages-pre-provider`.
- `proposedSemanticTokenEstimate` = Shadow Working Set semantic planning metric.
- Representation counts (FULL / LINE_RANGE / REFERENCE) and `representationTokenDelta` are semantic Shadow metrics only. **No provider-billed token savings are claimed.**

## 14. Metrics snapshot (live last plan)

```text
FULL=1 LINE_RANGE=0 REFERENCE=2
proposed=18 native=81
representationTokenDelta reported per boundary
```

## 15. Known limitations / proposal mismatches

- `SYMBOL` / `DIFF` / `SUMMARY` remain unexercised contract vocabulary (no parser/language-server/AST dependency added).
- Dirty revisions remain unsupported (DS-011 rule preserved).
- Live smoke does not force a REPLACE; REPLACE is proven by deterministic tests + temporary-Git smoke.
- `LINE_RANGE` range selection is always explicit (no heuristic range picking).

## 15a. PR #22 review items — resolution

| Review item | Resolution |
|---|---|
| P1 needs not in request/hash | ✅ `ShadowPlannerObserver` builds normalized `representationNeeds` FIRST, passes them into `makePlanningRequest` and `planningRequestHash`; materialization reuses the SAME need map. Test proves the needs appear in the request and change the hash (with-needs != without-needs). |
| P1 no model-usable content | ✅ `ContextRepresentation` gained ephemeral `content`/`contentRef`; `FileRepresentationProvider` keeps the exact FULL/LINE_RANGE payload (never persisted). Tests A-1 (`content === FILE_CONTENT`) and B-10 (`content === 'line two\\nline three\\nline four'`). |
| P1 smoke bypasses RepositoryObserver | ✅ Both smokes now run the real chain `RepositoryObserver.observe → SourceObservation → Universe → materialize → Planner`. Git smoke: v1/v2 observed via `RepositoryObserver`; Pi smoke admits the file source from a real observation (`file source admitted via RepositoryObserver=true`). |
| P1 not fail-safe | ✅ Materialization throws are caught, recorded in `materializationFailures`, and fall back to the default REFERENCE resolver; native Pi messages never corrupted. Test P1-failsafe asserts the recorded failure and unchanged messages. |
| P1 post-read race / binary evidence | ✅ Provider gained an injectable revision-reader seam; test 6b drives `before==expected → read → after!=expected` → `REVISION_CHANGED_DURING_OBSERVATION`. Test 8b covers a real non-UTF-8 binary fixture → fail-closed. |
| P1 Git smoke fake representation | ✅ Git smoke feeds the REAL materialized FULL/LINE_RANGE/v2 representations into `planWorkingSet`; Planner 3 proves `REPLACE(SOURCE_VERSION_ADVANCED)` on the real v1→v2 chain. |
| P2 representationTokenDelta semantics | ✅ `representationTokenDelta` now sums `REPLACE.tokenDelta` only (representation transitions, not membership ADD/REMOVE) with a `representationDeltaBreakdown { narrowed, detailed, sourceVersionAdvanced }`. |
| P2 duplicate need determinism | ✅ `buildRepresentationNeeds` rejects a second need for the same sourceKey (duplicate throw), so input ordering cannot change semantics. Test P2-duplicate asserts the throw. |

## 16. Scope confirmation

```
No active model-context rewrite.
No FULL/SUMMARY/COMPRESS beyond the bounded DS-012 set.
No opaque LLM summarization.
No production persistence schema.
No v0.2 ContextSnapshot/ExecutionRequest/RepositoryRevision contract change.
No OpenCode/Codex integration.
CR-004 was not started.
```

CR-003B evidence ready for lead architecture review. DeepSeek does not self-declare CR-003B accepted and does not self-authorize CR-004.
