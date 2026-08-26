# Context Runtime CR-004 — Stage 1 run 1 (first Active rewrite pair)

- **Status:** `EXECUTED — FIRST CONTACT COMPLETE` (both legs completed, no stop conditions)
- **Date:** 2026-08-27
- **Run identity:** `cr004-s1-20260826-38bd266f` (single-use, consumed)
- **Contract:** [`cr004-stage1-run-contract-2026-08-27.md`](../plan/cr004-stage1-run-contract-2026-08-27.md) (Lead-authorized)
- **Stage 0 amendment applied first:** pair-consistent tool-block removal (see the [Stage 0 verification amendment](./context-runtime-cr004-stage0-safety-seam-2026-08-27.md)) — real assistant messages mix text and tool calls, so whole-message-only removal could never fire on a real task
- **Binding:** `step-plan` / `step-3.7-flash`, `executionMode=experiment-strict`, `fallbackUsed=false`, one binding shared by both legs
- **Provider-call records:** `11` (Native 5 + Active 6); wall clock `17.1s`; budgets 30 records / 30 min / per-leg gate 15 — none approached
- **Task:** frozen `cr005-c1-localized-bug-fix` (manifest-pinned prompt, fixture, oracles)

## Result

| Leg | Strategy | Records | Tool calls | Token estimate (sum) | Wall | Primary oracle | Regression oracle | Writable conformance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | NATIVE | 5 | 7 | 2776 | 7.0s | PASS | PASS | PASS |
| B | ACTIVE (rewritten context) | 6 | 10 | 5479 | 9.4s | PASS | PASS | PASS |

**The first Active rewrite was composed, safety-guarded and sent** — at
boundary sequence 4 of the Active leg, after the model had read
`src/discount.js` and begun editing, the extension planned a Working Set over
the real conversation, marked the earlier read tool pair as superseded
evidence (`SOURCE_SUPERSEDED` semantics), and the Stage 0 seam composed a
rewrite that removed the toolCall block (from the mixed assistant message,
text preserved) plus its paired toolResult message:

```text
composition verdict:   REWRITE_READY
pre-send guard:        PASS
sentRewrite:           true
composed messages:     11
toolBlocksRemoved:     1
removed sources:       run/tool-call://chatcmpl-tool-bf8d261d… + its result
binding hashes:        workingSet 77bda5a6… · transition 22af1b22… · composition 165c50df…
kill switch:           never tripped (operator file never created)
stop conditions:       none
replay mismatches:     0
```

The model then completed the task **under the rewritten context**: both
oracles and the writable-paths conformance check passed, replay stayed
deterministic, and every guard verdict was recorded.

## Divergence ledger (recorded in `pairs.json`)

- Model profile: manifest pins `deepseek/deepseek-v4-flash`; this run binds
  `step-plan/step-3.7-flash`. No cross-baseline comparison claimed.
- Strategy: the frozen manifest knows `NATIVE`/`SHADOW`; leg B is `ACTIVE`.
  The manifest was not modified.
- Harness: Pi-only (capability profile).
- Evidence layout: per-leg observation files under `legs/<leg>/` instead of a
  single `observations.jsonl`.

## What this does and does not establish

Established (mechanics and safety, first contact): a dynamically rewritten
context — with superseded exploration evidence removed — was delivered to a
real model through every Stage 0 safety property (opt-in, capability profile,
mandatory re-assertion, hash binding, pair-consistent removal, pre-send
guard, kill switch armed), and the model completed the pinned task under it.
The full experimental apparatus now works end-to-end on live providers.

Not established: any quality, reliability, efficiency or cost claim. One pair
supports no statistical or causal statement — the Active leg happened to use
more estimated tokens and tool calls than the Native leg on this single
execution, which is descriptive only. The value hypothesis remains open and
now has a working instrument to answer it: a small authorized pair matrix
(same contract shape, more pairs across the C1–C2 classes) is the next
evidence step, requiring a new Lead authorization and run identity.

Raw evidence remains local untracked under
`research/context-benchmarks/reports/cr004-stage1/cr004-s1-20260826-38bd266f/`
per the raw-evidence policy.
