# CR-003A Acceptance — Shadow Working Set Planner Kernel

- **Decision:** ACCEPTED
- **Accepted branch:** `agent/deepseek-ds-010-shadow-working-set-planner`
- **Accepted HEAD:** `ed3ba71e51709433a118235569f88c058eba7ba3`
- **Merged by:** PR #18
- **Merge commit:** `1bffb8e99cdd70a17c5b97ff5fd99c479aa72edf`
- **Date:** 2026-08-11
- **Scope:** CR-003A / DS-010 only

## Accepted architecture

CR-003A establishes the first provider-neutral, deterministic Shadow Working Set planning kernel:

```text
CR-001 Model-call Observation
        ↓
CR-002 Context Universe
        ↓
ContextPlanningRequest
        +
Previous Shadow Working Set
        ↓
Deterministic Policy V0
        ↓
ContextWorkingSet
+ ContextDecision[]
+ ContextTransition
+ ShadowPlanningMetrics
```

The real Pi model request remains unchanged. The Planner runs at the real Pi `context` semantic boundary only in Shadow mode.

## Acceptance gates closed

1. **Provider-neutral core** — Runtime planning code and Runtime tests do not depend on Pi/OpenCode/Codex vocabulary. Adapter-specific recent evidence is normalized into `recentEvidenceSourceKeys`.
2. **Universe binding / provenance** — every Working Set binds the exact Universe sequence/hash and every representation binds exact SourceVersion ids.
3. **Hard protection semantics** — mandatory/pin/exclude/conflict behavior is deterministic; ordinary budget eviction cannot remove mandatory/pinned context.
4. **ABSENT / UNAVAILABLE correctness** — ABSENT can emit a real REMOVE from the previous Working Set; UNAVAILABLE conservatively retains last-known evidence.
5. **Continuity** — actual previous Working Sets are supplied to the Planner; KEEP is distinguished from ADD.
6. **Removal / rehydration history** — explicit exclude emits real `REMOVE(EXPLICIT_EXCLUDE)`, the observer records bounded removal history, and later relevance can produce REHYDRATE with the original removal reason preserved.
7. **Strict replay/audit binding** — `request.previousWorkingSetId` must exactly equal the actual previous Working Set id (or both null).
8. **Identity** — Working Set and decision identities distinguish policy/request/Universe/version/representation changes.
9. **Real Native-vs-Shadow evidence** — native estimate comes from CR-001 `observedMessageTokenEstimate`; Shadow estimate remains a separate semantic planning metric and is not claimed as provider-billed token savings.
10. **Real live seam** — opt-in Pi + DeepSeek smoke executes planning inside the real `context` callback while returning the original messages unchanged.

## Final evidence

```text
@canvas-agent/context-runtime tests          78 passed
@canvas-agent/pi-context-integration tests   48 passed
both package typechecks                      PASS
pnpm check                                   GREEN (596 tests + build)
GitHub Actions                               CI #98 SUCCESS
DeepSeek CR-003A smoke                       EXECUTED
```

Latest smoke:

```text
runtimeSessionId: smoke-cr003-2026-08-11T13-07-57-050Z
provider/model: deepseek / deepseek-v4-flash
model calls: 5
KEEP continuity: 0 → 0 → 2 → 4 → 6
native estimate: 21 → 77 → 180 → 361 → 402
proposed semantic estimate: 0 → 2 → 4 → 6 → 8
```

## Accepted limitations / follow-up dependencies

CR-003A does **not** establish authoritative current repository/file state. `repository/file://*` identities derived from Pi tool arguments remain DERIVED_HINT unless independently observed by a Repository Observer.

Therefore file-aware planning remains blocked for trustworthy use of:

- `FULL`
- `SYMBOL`
- `LINE_RANGE`
- `DIFF`
- file-backed `SUMMARY`
- `REPLACE`
- `COMPRESS`

The next bounded dependency is an authoritative Repository Observer.

## Scope confirmation

```text
No real Pi model-call context was rewritten.
No Repository Observer was implemented.
No production persistence schema was added.
No v0.2 ContextSnapshot or ExecutionRequest contract was changed.
No OpenCode/Codex integration was added.
CR-004 was not started or authorized.
```

## Architecture state after acceptance

```text
CR-001  Model-call Observation          ACCEPTED / MERGED
CR-002  Context Universe                ACCEPTED / MERGED
CR-003A Shadow Working Set Planner      ACCEPTED / MERGED
DS-011  Repository Observer             NEXT BOUNDED DEPENDENCY
CR-003B File-aware Shadow Planner       BLOCKED on DS-011
CR-004  Active Context Rewrite          NOT AUTHORIZED
```
