# CSPV-C0 canary — live run records (runs 1–3)

- **Status:** `EXECUTED — ALL FOUR SCENARIOS PASS` (aggregate across three terminal/complete run identities)
- **Date:** 2026-08-27
- **Contract:** [`cspv-c0-run-contract-2026-08-27.md`](../plan/cspv-c0-run-contract-2026-08-27.md) (with pre-execution Amendments 1 and 2, recorded in §7)
- **Provider binding (all runs):** `step-plan` / `step-3.7-flash`, `executionMode=experiment-strict`, `fallbackUsed=false`, `providerConfigHash=dbcbff3e…eabc8` (identical to the 2026-08-25 parity smoke)
- **Policy:** unmodified `policy-v0` (`policy-v0-c0-lifecycle`), SHADOW mode — no model-facing rewrite
- **Total provider-call records:** `51` across three run identities (`12 + 27 + 12`)
- **Pre-flight:** [`cspv-c0-preflight-dry-run-2026-08-27.md`](./cspv-preflight-dry-run-2026-08-27.md) (DRY_RUN, provider calls 0)

## Run ledger

| Run identity | Requested | Outcome | Records | Verdicts |
| --- | --- | --- | --- | --- |
| `c0-20260827-8cdb65c4` | E1–E4 | `STOPPED` S-7 (budget 12) | 12 | E1 PASS · E2 PASS · E3 stopped mid-run · E4 not reached |
| `c0-20260827-9faf18ac` | E1–E4 | `STOPPED` S-7 (budget 24; one E3 turn burst to 14 records) | 27 | E1 PASS · E2 PASS · E3 partial (REMOVE only) · E4 not reached |
| `c0-20260827-46eca174` | E3,E4 (Amendment 2 subset) | `EXECUTED` — no stop conditions | 12 | E3 PASS · E4 PASS |

Both S-7 stops are contract-correct terminal outcomes with evidence preserved;
each consumed identity is single-use and never resumed. E1/E2 were not
re-executed in run 3 because both prior runs banked identical PASS evidence
for them (Amendment 2 rationale).

## Per-scenario live evidence (best record per scenario)

```text
E1 Distractor Elimination  PASS  remove=2  rehydrate=0   (runs 1,2 consistent)
E2 Wrong Path Recovery     PASS  remove=2  rehydrate=2   (runs 1,2 consistent)
E3 Phase Shift             PASS  remove=2  rehydrate=2   (run 3)
E4 Superseded Evidence     PASS  remove=2  rehydrate=0   (run 3)
```

Aggregate invariant ledger across every executed scenario boundary:

```text
REMOVE observed                    > 0 in all four scenarios
REHYDRATE after prior REMOVE       observed in E2 and E3 (6 qualifying pairs)
false-removal candidates           6, all HIGH_PRIORITY, both horizon axes recorded
                                   (E2 pairs at distance 1/1; E3 pairs at 3/3 —
                                   the contract boundary itself)
mandatory/pinned evictions         0
wrong-version rehydrates           0   (exact SourceVersion rehydration)
orphan rehydrates                  0
replay mismatches                  0   (re-plan of identical boundary inputs)
unexplained decisions              0
reason-code coverage               1   (100% of active-set changes)
provenance retained                1
unexplained materialization        NOT_OBSERVED (SHADOW mode never materializes;
failures                                structurally unobservable until Active)
```

## What this establishes and what it does not

Established: on live Step Plan model-call context, under strict experiment
binding, the unmodified deterministic policy produces the contracted lifecycle
behavior — removal of irrelevant/superseded/stale-phase sources, recovery of
wrong-path work, exact-version rehydration when later need appears, and a fully
auditable decision/reason/provenance/replay record — with zero protection
violations and zero unexplained decisions, within a 51-record subscription
budget.

Not established (unchanged): any claim about task quality, provider cost or
model efficiency. Shadow is observational-only; Native/Shadow deltas remain
descriptive. Milestone item 5 (a real Dynamic rewrite experiment) remains
waived/open pending Gate D and CR-004. The materialization criterion is
structurally NOT_OBSERVED in Shadow and can only be evidenced in Active mode.

## Gate D readiness inputs

Against the eight Gate D criteria (rebaseline:199-217), this canary positively
evidences seven on live traces; the eighth (`no unexplained materialization
failure`) is NOT_OBSERVED by Shadow-mode construction. Gate D remains a Lead
decision; this document is its evidence input, not an adjudication.

Raw evidence (manifest/observations/transitions/verdicts per run) remains
local untracked under `research/context-benchmarks/reports/cspv-c0/<run id>/`
per the raw-evidence policy.
