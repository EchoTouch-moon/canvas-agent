# Context Runtime CR-004 — Stage 0 safety seam

- **Status:** `STAGE_0_VERIFIED` — offline safety seam implemented and tested; zero rewritten provider requests sent
- **Date:** 2026-08-27
- **Authorization:** [Gate D adjudication](./context-runtime-cr004-gate-d-adjudication-2026-08-27.md) `PASS` (permits Stage 0 only)
- **Integration baseline:** `branch glm/project-review-2026-08-27`
- **Provider calls during Stage 0:** `0` (grep-verified: no network, no `ModelRuntime`, no session, no fs, no clock inside the seam modules; the only clock is the kill switch's injected `now`)
- **Tests:** 22 new (`tests/cr004-stage0.test.ts`), suite total 140 passed; typecheck clean under strict + `exactOptionalPropertyTypes`

## Implemented surface (`packages/pi-context-integration/src/active/`)

| Module | Role |
| --- | --- |
| `capability-profile.ts` | Pi-only Active capability profile; opaque/reasoning content marked `PRESERVED_VERBATIM`; `sendsProviderRequests: false` |
| `kill-switch.ts` | Per-run kill switch: first-trip-wins record, permanent once tripped, run-isolated, injected clock |
| `native-message-analysis.ts` | Message→source derivation **reusing the shadow seam's exported `decomposePiMessage`** (identical attribution to what planned the Working Set) + opaque/mixed/pair structural facts |
| `rewrite-composer.ts` | `composeActiveRewrite()` safety pipeline; binding hashes; continuity record; deterministic output |
| `pre-send-guard.ts` | `assertRewriteSafe()` re-validation seam for Stage 1; any failure trips the kill switch permanently |

## Safety properties, each locked by at least one test

```text
explicit opt-in required            NOT_OPTED_IN otherwise
Pi-only capability                  HARNESS_UNSUPPORTED / UNSUPPORTED_MESSAGE_KIND
kill switch                         pre-trip and mid-composition trip => permanent fallback
mandatory/pinned re-assertion       MANDATORY_ITEM_MISSING fallback (real-planner PINNED case + documented hand-built MANDATORY case)
tool pair continuity                TOOL_PAIR_SPLIT fallback; pair removed together or not at all
system instruction                  absent/duplicated rejected at compose; byte-identity enforced; alteration detected at the pre-send guard by hash re-derivation
opaque/reasoning blocks             OPAQUE_CONTENT_DROPPED fallback; preserved verbatim (reference identity) otherwise
unexplained membership              any message neither retained nor REMOVEd => fallback
transition invariants              to/from linkage, session, token totals, budget, duplicate decisions, REMOVE-for-retained all rejected
binding                             Working Set + Transition logicalHash bound into the composition; tamper and cross-run use rejected at the guard
determinism                         identical inputs => deep-equal compositions; input messages never mutated
mixed removal                       an assistant message mixing text/thinking with a removed tool call refuses (MESSAGE_MIXED_REMOVAL) rather than partially dropping
```

## Recorded Stage 0 boundaries (honest, not faked)

1. System-instruction alteration cannot occur at compose time by construction
   (reference passing); the guard's hash re-derivation closes the window and is
   test-exercised.
2. Repository/file-backed MANDATORY/PINNED items cannot be re-asserted in
   Stage 0 — they have no native message to assert against; they fall back
   with `MANDATORY_ITEM_MISSING` until Stage 1's committed-context path
   exists.
3. Only whole pure-tool messages are dropped; mixed-content messages are
   never trimmed.

## Boundary

Stage 0 sends nothing and contains no send path. It does not authorize Stage
1. The [Stage 1 run contract](../plan/cr004-stage1-run-contract-2026-08-27.md)
is drafted and remains `DRAFT — PENDING LEAD AUTHORIZATION`; its materialization
carry-forward stop condition (from Gate D) is binding.
