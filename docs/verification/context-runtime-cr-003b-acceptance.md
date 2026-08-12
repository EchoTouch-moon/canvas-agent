# CR-003B Acceptance — File-aware Shadow Planner

- **Decision:** ACCEPTED
- **Accepted branch:** `agent/deepseek-ds-012-file-aware-shadow-planner`
- **Accepted HEAD:** `5ea61ebf18c1e45252f6ead3b03428f836a25912`
- **Merged by:** PR #22
- **Merge commit:** `32001f8a8fb43dc9565ba7a98fc869ac198ae5c1`
- **Final CI:** GitHub Actions CI #110 — SUCCESS
- **Date:** 2026-08-12
- **Scope:** DS-012 / CR-003B Shadow-only

## Accepted architecture

CR-003B closes the bounded file-aware Shadow planning loop without changing the real Pi/model request:

```text
RepositoryObserver
        ↓
Authoritative repository/file SourceObservation
        ↓
CR-002 Context Universe
        ↓
ContextPlanningRequest + normalized representationNeeds
        ↓
FileRepresentationProvider
        ↓
FULL / LINE_RANGE / REFERENCE
        ↓
Deterministic Policy V0
        ↓
Shadow ContextWorkingSet
+ ContextDecision[]
+ ContextTransition
+ ShadowPlanningMetrics
```

The authoritative file source and model representation remain separate. A file representation binds exact admitted SourceVersion ids and exact repository revision evidence. The Planner remains synchronous and provider-neutral; Git/file materialization occurs before planning in the integration/provider layer.

## Acceptance gates closed

1. **Authoritative source truth** — repository/file content comes from the accepted Repository Observer, not Pi tool-result prose or path hints.
2. **Exact SourceVersion binding** — FULL / LINE_RANGE materialization verifies the exact admitted source content hash and pre/post repository revision before producing a representation.
3. **Model-usable representations** — FULL and LINE_RANGE carry bounded ephemeral exact content; raw representation content is not promoted to production persistence.
4. **Representation provenance / freshness** — representations retain exact SourceVersion ids; SourceVersion advance causes explicit fresh replacement rather than stale KEEP.
5. **PlanningRequest determinism** — normalized representation needs participate in `planningRequestHash`; the integration centrally forces the same normalized needs into the final request that are used for materialization.
6. **Real REPLACE semantics** — same-source representation changes use `REPLACE`, not REMOVE+ADD; FULL → LINE_RANGE and LINE_RANGE → FULL are distinguishable, as is `SOURCE_VERSION_ADVANCED`.
7. **Shadow fail-safe** — materialization failures are recorded and fall back to the accepted REFERENCE/prior Shadow behavior; native Pi messages remain unchanged.
8. **Race / binary / size safety** — deterministic post-read revision-race evidence exists; binary and oversized files fail closed.
9. **Real chain smoke** — credential-free Git smoke runs RepositoryObserver → Universe → real materializer → Planner and proves representation replacement plus SourceVersion advance.
10. **Real Pi seam** — opt-in Pi + DeepSeek smoke admits the repository source via the real Repository Observer, materializes file FULL inside the real Pi semantic context boundary, and returns original messages unchanged.
11. **Representation metrics** — FULL / LINE_RANGE / REFERENCE counts and REPLACE-only token deltas are recorded as semantic Shadow metrics; no provider-billed token-savings claim is made.
12. **Scope discipline** — no SUMMARY/COMPRESS implementation, no AST/LSP/index, no active model-context rewrite, no production persistence/public v0.2 contract changes, no OpenCode/Codex integration.

## Final evidence

```text
@canvas-agent/context-runtime tests          86 passed
@canvas-agent/repository-observer tests      35 passed
@canvas-agent/pi-context-integration tests   52 passed
three package typechecks                     PASS
pnpm check                                   GREEN (643 tests + build)
GitHub Actions                               CI #110 SUCCESS
credential-free Git smoke                    EXECUTED
Pi + DeepSeek CR-003B smoke                  EXECUTED
```

Latest live smoke evidence:

```text
file source admitted via RepositoryObserver = true
FULL = 1
LINE_RANGE = 0
REFERENCE = 2
proposed semantic estimate = 18
native agent-messages-pre-provider estimate = 104
native messages rewritten = false
```

These two token estimates are intentionally different metric scopes and must not be interpreted as provider-billed savings.

## Accepted limitations

- Dirty repository revisions remain fail-closed / unsupported for file materialization.
- SYMBOL / DIFF / SUMMARY remain unexercised representation vocabulary.
- LINE_RANGE selection is explicit; no automatic symbol/range discovery exists.
- The live Pi smoke proves real-seam interoperability, not representative task reliability.
- The current evidence is Shadow evidence only. It does not prove that actual rewritten context preserves task success.
- A representative Native baseline corpus and a reviewed CR-003 evidence synthesis are still required by the CR-004 gate.

## Scope confirmation

```text
No active Pi/model context rewrite occurred.
No opaque LLM summarization was introduced.
No production persistence schema was added.
No v0.2 ContextSnapshot / ExecutionRequest / RepositoryRevision public contract was changed.
No OpenCode/Codex integration was added.
CR-004 was not started or authorized by this acceptance.
```

## Architecture state after acceptance

```text
CR-001  Model-call Observation          ACCEPTED / MERGED
CR-002  Context Universe                ACCEPTED / MERGED
CR-003A Shadow Planner Kernel           ACCEPTED / MERGED
DS-011  Repository Observer             ACCEPTED / MERGED
CR-003B File-aware Shadow Planner       ACCEPTED / MERGED

CR-003 Shadow evidence Go/No-Go review  NEXT
CR-004 Active Context Rewrite           NOT AUTHORIZED
```
