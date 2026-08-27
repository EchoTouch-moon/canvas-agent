# CR-004 M4 — confirmatory two-arm matrix run contract

- **Status:** `AUTHORIZED (Lead direction 2026-08-27: continue per the M2/M3 next-levers; token consumption unconstrained)`
- **Date:** 2026-08-27
- **Design:** the confirmatory step named by the [M2 analysis](../verification/cr004-m2-matrix-analysis-2026-08-27.md) and sharpened by [M3](../verification/cr004-m3-targeted-analysis-2026-08-27.md): L1 + L2 × {NATIVE, ACTIVE (`v2-retain-latest-coarse`)} × **8 repetitions** = 32 legs, deterministic interleaved order (control first inside every task×rep), one strict binding for all legs.
- **Why two arms:** v1's deficit replicated twice; v3's additional triggers fired zero times live (M3) — `v2` is the candidate policy. Dropping the third arm doubles per-cell n at the same budget.
- **Why n=8:** M1–M3 showed large between-run native variance on L2 (94k↔182k token-estimate sums) and one native oracle failure in 20 native legs; n=8/cell is the smallest cell size for which the exact permutation test has usable resolution (C(16,8)=12870 assignments).
- **Run identity:** `cr004-m4-<ISO-date>-<8-hex>`, single-use.
- **Provider profile:** unchanged strict discipline (step-plan / step-3.7-flash / experiment-strict / no fallback / providerConfigHash binding).
- **Budgets (hard-fail):** per-leg manifest budgets (40 records / 120 tools / 600 s); matrix totals **900 provider-call records / 180 minutes** (raised from 600 by this contract for the 32-leg shape; the S-7 test bound updated with it).
- **Stop policy:** unchanged from the M3 contract (S-1..S-9, matrix-terminal operator kill switch, continue-on-leg-failure); the per-run stall hazard observed on the first M3 identity (a hung session prompt with no in-flight timeout) is handled operationally — a stalled leg is killed externally, its identity is recorded as aborted, and the matrix relaunches under a fresh identity (M3 precedent).
- **Measured:** per-cell oracle pass rate, records/tools/wall, token-estimate sums and trajectory peaks; per-arm intervention telemetry; exact permutation tests NATIVE vs ACTIVE per task at n=8.
- **Non-claims:** internal token estimates; one model; n=8/cell is still descriptive — a confirmatory direction, not a causal claim.
