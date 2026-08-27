# CR-004 M4 — confirmatory two-arm matrix analysis

- **Status:** `EXECUTED — ANALYZED` (32/32 legs, both cells n=8)
- **Date:** 2026-08-27
- **Run identity:** `cr004-m4-20260827-d0cec2f5` (single-use, consumed; 546 provider-call records, ~48 min wall)
- **Contract:** [`cr004-m4-confirmatory-run-contract-2026-08-27.md`](../plan/cr004-m4-confirmatory-run-contract-2026-08-27.md)
- **Design:** L1 + L2 × {NATIVE, ACTIVE (`v2-retain-latest-coarse`)} × 8 reps; one strict binding; exact permutation tests over C(16,8)=12 870 assignments
- **Prior evidence:** [M1](./cr004-matrix-run-analysis-2026-08-27.md) · [M2](./cr004-m2-matrix-analysis-2026-08-27.md) · [M3](./cr004-m3-targeted-analysis-2026-08-27.md)

## Headline results (n=8 per cell)

| | NATIVE | ACTIVE v2 | Δ | exact permutation p |
| --- | --- | --- | --- | --- |
| **L1** token-estimate sum | 2 521 269 | **1 358 900** | **−46%** | **0.045** |
| **L2** token-estimate sum | 1 240 279 | **1 084 173** | −13% | 0.671 |
| L1 oracle | **8/8** | 6/8 | −2 legs | — |
| L2 oracle | 6/8 | **8/8** | +2 legs | — |
| pooled oracle | 14/16 | 14/16 | **0** | — |
| per-call trajectory peak (mean of cell means) | 18 422 | 16 454 | −11% | — |

**L1 at p=0.045 is the program's first below-0.05 result: on read-then-edit
refactor work, retention-aware coarse removal cut total model-visible context
mass nearly in half, beyond what 12 870 label reassignments can plausibly
attribute to chance** — still reported descriptively (one model, internal
token estimates, no causal language). L2's −13% favors v2 but does not
separate from native's own variance, exactly as M3 predicted.

## Reliability: net-neutral, task-shaped

Pooled reliability is identical (14/16 both arms), but the composition
differs: v2 lost 2/8 on L1 (75%) while gaining 2/8 on L2 vs native (100% vs
75%). The program's cumulative Active-arm ledger is now 62 legs / 58 passes
across four matrices with 76 sent rewrites and zero guard violations; the
reliability cost, when it appears, is task-shaped rather than uniform — the
hypothesis for the L1 failures (2 legs) is over-eager removal during long
read-then-edit cascades (the retention rule keeps only the LATEST read; a
sweep between two reads of a file the model was cross-referencing could drop
still-needed older context). That is a tunable policy parameter (retain
latest-K reads), not a mechanism defect — but this run does not establish
that, and the honest record keeps it as a hypothesis.

## Verdict (four matrices, one campaign)

1. **Efficiency: established at the descriptive level.** v2 is the cheapest
   arm in every matrix since its introduction (M2 −11%, M3 −9% on L2, M4
   −35% pooled), with L1 individually significant at p=0.045.
2. **Reliability: neutral pooled (14/16 vs 14/16 at n=8), task-shaped
   variance** — a safety/performance trade-off surface that the policy's
   retain-K parameter can explore.
3. **The v0.3 value question now has a data-backed answer shape:** dynamic
   context selection under the v2 policy delivers large context-mass
   reductions at neutral pooled reliability on tasks of this size — with the
   caveat that per-task reliability variance is real and the confirmatory
   evidence is single-model, internal-token, and n=8.

## Named next steps (not run)

- retain-K sweep (K∈{1,2,3}) targeting the L1 reliability dip while keeping
  the efficiency win — a policy-parameter experiment, not new machinery.
- Cross-model replication (provider layer supports it) before any external
  claim; compaction-comparison arm still open.
- A fifth matrix only if retain-K changes the L1 picture.

Raw evidence: local untracked `research/context-benchmarks/reports/cr004-matrix/cr004-m4-20260827-d0cec2f5/`.
