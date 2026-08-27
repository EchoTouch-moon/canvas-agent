# CR-004 M3 — targeted L2 policy A/B/C analysis

- **Status:** `EXECUTED — ANALYZED` (12/12 legs; clean identity `cr004-m3-20260827-d3846039`, 181 provider-call records)
- **Date:** 2026-08-27
- **Design:** L2 only × {NATIVE · ACTIVE v2 `v2-retain-latest-coarse` · ACTIVE v3 `v3-verify-window-dedup`} × 4 reps
- **Contract:** [`cr004-m3-matrix-run-contract-2026-08-27.md`](../plan/cr004-m3-matrix-run-contract-2026-08-27.md)
- **Aborted identity:** `cr004-m3-20260827-4d99ee45` — leg 6 (`L2-ACTIVE2-rep2`) stalled >30 min at 0% CPU on a hung session prompt (provider reachable; no in-flight timeout exists at this seam). Killed externally, 4 completed legs preserved, excluded from analysis. Operational mitigation recorded in the M4 contract.

## Results

| Cell | oracle | records (mean) | token-estimate sum (mean) | interventions | re-reads |
| --- | --- | --- | --- | --- | --- |
| L2/NATIVE | **3/4** | 14.8 | 152 346 | — | — |
| L2/ACTIVE v2 | 4/4 | 15.0 | **138 892** | 5 sent / 5 blocks / 18 retained-latest | 1 |
| L2/ACTIVE v3 | 4/4 | 15.5 | 140 513 | **0 fired** (dedup 0, deferrals 0) | 0 |

Exact permutation (token sums): NATIVE vs v2 p=1.000, NATIVE vs v3 p=0.629, v2 vs v3 p=1.000 at n=4 — descriptive only.

## Findings

1. **v3's additional triggers never fired on live L2 behavior.** The dedup
   trigger requires a re-read with IDENTICAL content, but the model re-reads
   files after editing them (content changed) or reads each file once — so
   there was nothing to dedup and no edit boundary deferred by the verify
   window that v2 alone did not already cover. v3 is not wrong — it is
   redundant on this task distribution: with zero triggers it behaved as an
   observer-only arm and still passed 4/4. v2 remains the candidate policy;
   v3's dedup semantics stay in the tree (tested) for corpora where unchanged
   re-reads actually occur.
2. **v2 landed below native on L2 this run** (−9% token-estimate sum, 4/4 vs
   3/4 reliability) — the first L2 run where the Active arm beat its native
   control. Combined with M2 (v2 +81% vs a 94k native), the L2 v2-vs-native
   direction flips run to run with native variance, not with the policy.
3. **First native oracle failure in the program** (NATIVE 3/4; one leg also
   produced only 2 records in 223 s — a degenerate near-no-op attempt).
   Native variance on L2 is now documented across three matrices: native
   token-sum means 94k (M2) → 152k (M3) vs 182k (M1).

## Conclusion feeding M4

The L2 question is a power problem, not a policy problem: v2's effect is
within native's own between-run noise at n≤4. The M4 confirmatory matrix
(L1+L2 × NATIVE vs v2 × 8 reps, 32 legs, 900-record budget —
[contract](../plan/cr004-m4-confirmatory-run-contract-2026-08-27.md)) is the
named next step. Raw evidence stays local under
`research/context-benchmarks/reports/cr004-matrix/` (both M3 identities).
