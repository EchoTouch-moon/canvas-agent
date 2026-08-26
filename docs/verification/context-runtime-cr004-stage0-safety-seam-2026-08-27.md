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

## Amendment — pair-consistent tool-block removal (2026-08-27, pre-Stage-1)

**What changed.** `composeActiveRewrite()` no longer refuses a rewrite when the
REMOVEd source of a `toolCall` block lives inside a MIXED assistant message
(text/thinking + toolCall). It now:

1. drops ONLY that `toolCall` block from the assistant message, keeping every
   text/thinking block byte-identical (kept blocks travel by reference; the
   message is rebuilt as a new object, the input array is never mutated);
2. drops the paired `toolResult` message, so the tool-call/result pair leaves
   the model-visible context together or not at all (the pair check now runs at
   block granularity: a block-dropped call counts as dropped, and any
   call/result fate mismatch still falls back with `TOOL_PAIR_SPLIT`);
3. refuses with the new fallback reason `EMPTY_REMAINDER_AFTER_BLOCK_REMOVAL`
   when block removal would leave the assistant message with no meaningful
   content while it carried text (an emptied assistant message is never sent);
   a pure-toolCall message whose calls are all REMOVEd is still dropped whole
   (unchanged Stage 0 semantics);
4. records the count in the continuity report (`toolBlocksRemoved`) and in the
   capability profile (`rewriteMode` is now
   `WHOLE_MESSAGE_DROP_PLUS_PAIRED_TOOL_CALL_BLOCK_DROP`).

**Why.** Observed real-task assistant messages usually MIX text and toolCall
blocks: a coding agent narrates ("now editing src/discount.js") and calls a
tool in the same message. Under whole-message-only removal every such removal
hit `MESSAGE_MIXED_REMOVAL`, so every rewrite of a real conversation would have
fallen back to Native and Stage 1 could never observe its first Active send.
The amendment removes exactly the block the transition REMOVEd — no more — and
keeps the pair-consistency, opacity (thinking/image/structured blocks are kept,
never trimmed), determinism, and no-input-mutation properties. Boundary note 3
above ("Only whole pure-tool messages are dropped; mixed-content messages are
never trimmed") is superseded by this amendment: mixed messages are trimmed
only of REMOVEd toolCall blocks, never of text/thinking/opaque content.

**Tests.** 5 new cases in `tests/cr004-stage0.test.ts` (A-1..A-5): mixed
text+toolCall with the pair removed composes (`REWRITE_READY`, text
byte-identical by reference, result gone, correct continuity counts, guard
PASS); thinking+toolCall keeps the thinking block verbatim; empty-remainder
refusal; one-side-only removal still refuses with `TOOL_PAIR_SPLIT`; partial
pair removal inside one mixed message keeps the retained call block
byte-identical. Suite total after the amendment: 27 Stage 0 tests. Provider
calls remain `0`; the seam still sends nothing.
