# CR-003A Verification — Shadow Working Set Planner Kernel

- **Status:** EVIDENCE READY — not self-accepted; awaits lead architect review
- **Packet:** `docs/tasks/deepseek/DS-010-shadow-working-set-planner.md`
- **Owner:** DeepSeek V4 Flash — Context Runtime research implementer
- **Branch:** `agent/deepseek-ds-010-shadow-working-set-planner`
- **Date:** 2026-08-11
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
pnpm --filter @canvas-agent/context-runtime test        73 passed
pnpm --filter @canvas-agent/pi-context-integration test 44 passed
pnpm --filter @canvas-agent/context-runtime typecheck   PASS
pnpm --filter @canvas-agent/pi-context-integration typecheck PASS
pnpm check                                              GREEN (582 tests + build)
```

New CR-003A coverage: 17 core planner tests + 4 Pi planner-observer tests (deterministic identity, binding, protection/pin/exclude/conflict, ABSENT/UNAVAILABLE, KEEP/REHYDRATE, trust boundary, pass-through).

## 11. Live Pi + DeepSeek CR-003A Shadow smoke

**Status: EXECUTED**

```text
Command: CANVAS_CONTEXT_LIVE_SMOKE=1 pnpm --filter @canvas-agent/pi-context-integration smoke:deepseek:cr003
runtimeSessionId: smoke-cr003-2026-08-11T12-15-08-539Z
provider: deepseek   model: deepseek-v4-flash
```

Metadata-only Shadow plan timeline (scope labels):

```text
call  universe  workingSetId (short)  policy   proposed(WS)  ADD  KEEP  REMOVE  REHYDRATE
 1      1           ws:...:1           v0          0           0    0     0       0
 2      2           ws:...:2           v0          2           2    0     0       0
 3      3           ws:...:3           v0          4           4    0     0       0
 4      4           ws:...:4           v0          6           6    0     0       0
 5      5           ws:...:5           v0          8           8    0     0       0
```

Decision example (call 5): `ADD run/tool-call://call_... [RECENT_RUN_EVIDENCE]`, `ADD run/tool-result://call_... [RECENT_RUN_EVIDENCE]`.

Native vs proposed estimate: the smoke plans are stateless per call (no previous Working Set supplied), so decisions are all `ADD` and `KEEP/REHYDRATE` are exercised in the deterministic tests instead. `nativeContextEstimate` is scoped to `agent-messages-pre-provider` (CR-001); `proposedSemanticTokenEstimate` is a separate semantic planning metric. **No provider-billed token savings are claimed.**

The smoke proves: real Pi context passed through semantically unchanged; Universe continued advancing (revision 5 / source sets per call); one Shadow Working Set per model call; decisions/reasons metadata-only; no raw prompt/tool-result content or credentials persisted (verified); `repository/file` DERIVED_HINT entries were not silently treated as canonical planner sources.

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
