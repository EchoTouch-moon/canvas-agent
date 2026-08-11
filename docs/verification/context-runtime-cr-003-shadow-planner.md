# CR-003A Verification — Shadow Working Set Planner Kernel

- **Status:** EVIDENCE READY (rev.2 — PR #18 corrections applied); not self-accepted; awaits lead re-review
- **Packet:** `docs/tasks/deepseek/DS-010-shadow-working-set-planner.md`
- **Owner:** DeepSeek V4 Flash — Context Runtime research implementer
- **Branch:** `agent/deepseek-ds-010-shadow-working-set-planner`
- **Date:** 2026-08-11 (rev.2 after PR #18 architecture review)
- **Pi exact version:** `@earendil-works/pi-coding-agent@0.84.1` (workspace pin)
- **DeepSeek provider/model (live smoke):** provider `deepseek`, model `deepseek-v4-flash`, credential from local Pi `auth.json`

---

## 1. Architecture implemented

```text
Native Pi AgentMessage[]            (context event)
        |
        +--> returned unchanged to Pi / provider
        |
        +--> observed by Context Runtime
                    |
                    v
              Universe revision         (CR-002, immutable)
                    +
              ContextPlanningRequest    (minimal, conservative)
                    +
              previous Shadow Working Set (continuity)
                    |
                    v
              Policy V0 (deterministic)
                    |
                    v
              Shadow ContextWorkingSet
              + ContextDecision[]
              + ContextTransition
              + ShadowPlanningMetrics
```

- `packages/context-runtime` remains Pi/OpenCode/Codex/provider neutral (production + tests).
- No real Pi message is rewritten/reordered/compressed/injected.

## 2. Experimental planning types

- `ContextPlanningRequest` — runtimeSessionId, recompositionSequence, taskPhase (default GENERAL), budget (maxSemanticTokens), pinned/excluded/currentTarget/latestVerification source keys, previousWorkingSetId. Conservative live defaults.
- `ContextRepresentation` — kind (REFERENCE/METADATA/FULL/SYMBOL/LINE_RANGE/DIFF/SUMMARY), sourceVersionIds (exact provenance), contentHash, tokenEstimate, lossiness, derivation. Immutable/deterministic id. First policy uses REFERENCE only.
- `ContextWorkingSet` — immutable, binds plannedFromUniverseSequence/Hash, policyVersion, planningRequestHash, ordered items, totalTokenEstimate, budget, mode SHADOW, logicalHash.
- `ContextDecision` — KEEP/ADD/REMOVE/REPLACE/COMPRESS/REHYDRATE; Policy V0 emits ADD/KEEP/REMOVE/REHYDRATE (REPLACE/COMPRESS remain contract vocabulary, unexercised).
- `ContextTransition` — from/toWorkingSetId, ordered decisions, token deltas, policyVersion, logicalHash.

## 3. Policy V0 pipeline (deterministic, no LLM/embedding/graph)

1. Resolve protection per entry (P0 priority => MANDATORY, pinned => PINNED, else NORMAL; never inferred from source-key text).
2. Detect mandatory/pin vs exclude conflicts explicitly (`PlanningConflictError`) — never silently violate hard protection.
3. Iterate admitted Universe entries only; ABSENT is not active ordinary evidence (REMOVE when previously active); UNAVAILABLE conservatively KEEP with `SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP`.
4. Membership: MANDATORY > PINNED > (exclude) > CURRENT_TARGET > LATEST_FAILURE > UNAVAILABLE-conservative > PREVIOUSLY_ACTIVE > RECENT_RUN_EVIDENCE.
5. Classify decisions: previous membership => KEEP; current-target/verification/pin after prior absence => REHYDRATE; else ADD.
6. Budget eviction: evict lowest-value NORMAL candidates deterministically (highest token cost, then sourceKey tie-break); never MANDATORY/PINNED.
7. Final deterministic ordering by position; logical hash includes policyVersion + planningRequestHash.

Deterministic tie-break order for eviction: token cost desc, then sourceKey asc.

## 4. Mandatory / pin / exclude evidence (tests)

- MANDATORY (P0 task-spec) survives `maxSemanticTokens: 1` (severe budget pressure).
- PINNED item survives normal eviction while an unpinned candidate is evicted.
- Explicit exclude removes an ordinary eligible candidate.
- MANDATORY + exclude throws `PlanningConflictError` deterministically.

## 5. Universe binding and representation freshness

- Every Working Set records `plannedFromUniverseSequence` + `plannedFromUniverseHash` equal to the input revision (test).
- `isRepresentationFresh(repr, admittedVersions)` returns false after the source advances to a new version (changed content stales old representation), true when the exact source version is still admitted (test).
- Representation provenance references exact `SourceVersionId`s (test).
- Derived representation authority does not silently increase: the REFERENCE representation carries the source's original authority/priority metadata; no promotion path exists in Policy V0.

## 6. ABSENT / UNAVAILABLE semantics

- ABSENT entry => not active ordinary evidence; when previously active, a REMOVE decision with `SOURCE_ABSENT` is emitted (test).
- UNAVAILABLE entry => conservatively retained with `SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP` reason code (test). Matches CR-002 `RETAIN_LAST_KNOWN`.

## 7. Continuity / KEEP / REHYDRATE

- Previous active item still selected => KEEP (test).
- Active → removed (explicit exclude) → pinned/current-target again => REHYDRATE with `REHYDRATION_TRIGGERED`, distinguishable from a first ADD (test).
- Every membership change carries a machine-readable reason code (test).
- Token estimates/deltas match selected representation estimates (test).

## 8. Trust boundary

- Planner only iterates admitted Universe entries. A `repository/file://src/auth.ts` `DERIVED_HINT` that was never admitted (only requested as a current target) is never selected as canonical planner source (test).
- Non-admitted repository/file state requires a Repository Observer (follow-up, not implemented).

## 9. Deterministic identity / determinism tests

- Same normalized inputs + policyVersion => identical Working Set logicalHash and Transition logicalHash.
- Equal-ranked candidates => deterministic tie-break and identical hash.
- policyVersion change => distinguishable Working Set identity (planningRequestHash unchanged).
- `planningRequestHash` ignores list ordering (sorted canonically).

## 10. Deterministic test results (credential-free)

```bash
pnpm --filter @canvas-agent/context-runtime test        78 passed
pnpm --filter @canvas-agent/pi-context-integration test 47 passed
pnpm --filter @canvas-agent/context-runtime typecheck   PASS
pnpm --filter @canvas-agent/pi-context-integration typecheck PASS
pnpm check                                              GREEN (595 tests + build)
```

New CR-003A coverage (rev.2): core planner tests for ABSENT→REMOVE from previous item, removal-history-driven REHYDRATE (incl. negative first-pin ADD), provider-neutral recent-evidence signal, content-addressed Working Set/decision identity collisions; Pi observer tests for previousWorkingSetId consistency, real KEEP continuity, and native estimate == CR-001 observation estimate.

New CR-003A coverage: core planner tests for deterministic identity/binding, protection/pin/exclude/conflict, ABSENT/UNAVAILABLE, KEEP/REHYDRATE (incl. first-pin negative test), trust boundary, content-addressed identity collisions; Pi planner-observer tests for previousWorkingSetId consistency, real KEEP continuity, and native-estimate propagation.

## 11. Live Pi + DeepSeek CR-003A Shadow smoke (rev.2 — real seam)

**Status: EXECUTED**

```text
Command: CANVAS_CONTEXT_LIVE_SMOKE=1 pnpm --filter @canvas-agent/pi-context-integration smoke:deepseek:cr003
runtimeSessionId: smoke-cr003-2026-08-11T12-47-16-825Z
provider: deepseek   model: deepseek-v4-flash
```

The smoke now exercises the **real planning seam**: the Pi `context` extension factory (`createShadowPlannerPiExtension`) invokes `ShadowPlannerObserver.observeModelCall` inside the callback (observe → advance Universe → plan → record), then returns the original messages unchanged. Continuity is real: the observer passes the actual previous Shadow Working Set to Policy V0.

Metadata-only Shadow plan timeline (scope labels):

```text
call  prevWS   native(CR-001)  proposed(WS)  ADD  KEEP  REMOVE  REHYDRATE
 1     null         21             0          0     0     0       0
 2     ws:...2      82             2          2     0     0       0
 3     ws:...3     185             4          2     2     0       0
 4     ws:...4     371             6          2     4     0       0
 5     ws:...5     410             8          2     6     0       0
```

Decision examples (call 3): `KEEP run/tool-call://call_...`, `KEEP run/tool-result://call_...` (unchanged history is KEEP, not repeated ADD); call 2 `ADD ... [RECENT_RUN_EVIDENCE]`.

Native vs proposed estimate: `nativeContextEstimate` is the **real CR-001 `ModelCallObservation.observedMessageTokenEstimate`**, scoped to `agent-messages-pre-provider` (not a placeholder); `proposedSemanticTokenEstimate` is the separate semantic planning metric. **No provider-billed token savings are claimed.**

The smoke proves: real Pi context passed through semantically unchanged; Universe continued advancing; one Shadow Working Set per model call with real continuity (KEEP grows 2→4→6); decisions/reasons metadata-only; no raw prompt/tool-result content or credentials persisted (verified); `repository/file` DERIVED_HINT entries were not silently treated as canonical planner sources.

Trace is under `.canvas-agent/research/**` (gitignored), not committed.

## 12. REPLACE / COMPRESS status

`REPLACE` and `COMPRESS` remain **contract vocabulary only**; they are never emitted by Policy V0 because there is not yet trustworthy file-level material (no Repository Observer) to exercise them honestly. This is stated explicitly per the task.

## 13. PROPOSAL-031 mismatches / provisional

- **Confirmed:** membership vs representation separation; protection (MANDATORY/PINNED) is enforceable before budget eviction; KEEP/ADD/REHYDRATE distinguishability requires previous Working Set continuity; policyVersion must participate in identity.
- **Provisional / contradicted:** PROPOSAL-031's optimism about `REPLACE`/`COMPRESS` and `FULL`/`SYMBOL` representations cannot be exercised until a Repository Observer provides authoritative file-level state; without one, REFERENCE/METADATA is the only honest first-policy representation. Reason-code vocabulary is provisional CR-003 evidence, not frozen PROPOSAL-031.

## 14. Repository Observer dependency

Repository/file canonical current state is **not** implemented. `repository/file://*` from Pi tool arguments remain `DERIVED_HINT`; Policy V0 never promotes them to canonical planner sources. A Repository Observer is required before a file-aware (FULL/SYMBOL/DIFF, REPLACE/COMPRESS) planner policy can be treated as trustworthy. **Recommendation for the next bounded step: Repository Observer first, then file-aware CR-003B.**

## 15. CR-004 statement

CR-004 Active Working Set Rewrite is **not** authorized by this evidence. Shadow planning only; no model request is modified.

## 15a. PR #18 review items — resolution

| Review item | Resolution |
|---|---|
| P1 Planner core re-hard-codes Pi vocabulary | ✅ Policy V0 no longer compares `PI_CONTEXT_EVENT`/provenance. Recent trustworthy evidence arrives as the provider-neutral `recentEvidenceSourceKeys` signal in `ContextPlanningRequest`, supplied by the Pi adapter (`EnrichedPiShadowObserver.recentEvidenceSourceKeys`). Core tests use neutral `TEST_ADAPTER_EVENT` / `TEST_RUN_RESULT` descriptors; no Pi literal remains in `packages/context-runtime/**`. |
| P1 ABSENT → REMOVE branch unreachable | ✅ ABSENT is handled **before** requiring an admitted version; for a previously active item the REMOVE subject/version/representation is derived from the previous Working Set item. New test 8b proves `AVAILABLE active → Universe ABSENT → plan with previous Working Set → REMOVE(SOURCE_ABSENT)` with the sourceVersionId taken from the previous item. |
| P1 REHYDRATE is not history-aware | ✅ `ContextPlanningRequest.removalHistory` (`RemovalRecord[]`) records original removal reason + removedAtSequence + removedFromWorkingSetId. REHYDRATE only fires when a prior removal record exists; first-time pin/current-target is `ADD`. Negative test 11b proves first-plan pin → ADD, not REHYDRATE; test 11 preserves `EXPLICIT_EXCLUDE` alongside `REHYDRATION_TRIGGERED`. |
| P1 Live seam does not run planner with continuity | ✅ `ShadowPlannerObserver` retains the actual previous `ContextWorkingSet` and passes it to Policy V0; `request.previousWorkingSetId` must match (tested). New `createShadowPlannerPiExtension` invokes planning inside the `context` callback. Smoke uses the real extension: continuity produces KEEP 2→4→6. |
| P1 Native estimate placeholder zero | ✅ `EnrichedShadowResult.nativeContextEstimate` now carries the real CR-001 `observedMessageTokenEstimate`; it flows into `ShadowPlanningMetrics.nativeContextEstimate`. Smoke reports real values (21→82→185→371→410); test asserts metric equals the enriched result value and is > 0. |
| P2 Working Set / decision identity aliasing | ✅ `createWorkingSetId` is content-addressed (policyVersion + planningRequestHash + universeHash); `createDecisionId` includes version/representation/to-working-set/reasons. Collision tests: different policy versions, different planning requests, different source versions → distinct ids. |

## 16. Scope confirmation

```
No real Pi model-call context was rewritten.
No Repository Observer was implemented.
No production persistence schema was added.
No v0.2 ContextSnapshot or ExecutionRequest contract was changed.
No OpenCode/Codex integration was added.
CR-004 was not started.
```

CR-003A evidence ready for lead architecture review. DeepSeek does not self-accept CR-003A or self-authorize CR-004.
