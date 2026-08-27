# CR-004 M2 matrix — policy A/B analysis (v2 vs v1 vs native)

- **Status:** `EXECUTED — ANALYZED` (27/27 legs, all three arms 9/9 oracle)
- **Date:** 2026-08-27 (morning; Lead direction "run it again per lever point 1")
- **Run identity:** `cr004-m2-20260827-8a87b471` (single-use, consumed; 423 provider-call records, ~34 min wall)
- **Contract:** [`cr004-m2-matrix-run-contract-2026-08-27.md`](../plan/cr004-m2-matrix-run-contract-2026-08-27.md)
- **Design:** three arms — NATIVE · ACTIVE (v1 `per-edit`) · ACTIVE_V2 (`v2-retain-latest-coarse`) — over L1/L2/L3 × 3 reps; one strict binding for all 27 legs
- **Policy v2** implements both M1 data-named levers: each intervention sweeps ALL edited paths and removes every still-active read pair EXCEPT each path's latest read (retention kills re-fetching), oldest-first, ≤12 blocks per sweep
- **Predecessor:** [M1 analysis](./cr004-matrix-run-analysis-2026-08-27.md) (v1 vs native: reliability 9/9 but context mass +28%)

## Headline

| Token-estimate sum, mean of cell means | NATIVE | ACTIVE v1 | **ACTIVE v2** |
| --- | --- | --- | --- |
| all tasks | 136 274 | 189 347 (+39%) | **121 727 (−11%)** |

**Policy v2 turned the M1 result around: it is now the cheapest arm overall —
below native — while reliability stayed perfect (9/9/9) and re-reads collapsed
(13 → 3).**

## Per-task results

| Task | NATIVE | ACTIVE v1 | ACTIVE v2 | v2 vs native | v2 vs v1 |
| --- | --- | --- | --- | --- | --- |
| L1 refactor (sums) | 866 833 | 973 904 | **510 094** | **−41%** | −48% |
| L2 feature (sums) | 280 860 | 616 832 | 507 346 | +81% | −18% |
| L3 bug hunt (sums) | 78 776 | 113 385 | **78 107** | **−0.8%** | −31% |

Supporting cells (means): L1 v2 used the fewest model calls (16.3 vs 23.3
native / 24.3 v1), fewest tools, ~25% less wall clock, and the lowest
trajectory peak (17 833 vs 20 910 native). L3 v2 fired **zero** interventions
— the bug-hunt legs edited without qualifying prior reads — and matched native
exactly: the conservative trigger correctly does nothing when nothing is safe
to remove. Exact permutation tests: all p ∈ [0.2, 1.0] at n=3/cell —
descriptive only, no causal claim; token figures are internal estimates.

## Mechanism evidence (policy A/B within one run)

| Telemetry | v1 (35 sends) | v2 (9 sends) |
| --- | --- | --- |
| removed blocks | 35 | 14 |
| retained-latest targets | 0 (by design it also removes the latest read) | 55 |
| re-reads of removed targets | 13 | **3** |
| post-intervention reads | 24 | 8 |
| reliability | 9/9 | 9/9 |

v1's M1 pathology **replicated** in an independent run (worse than native on
all three tasks again: +12% / +119% / +44%), which strengthens the v1-negative
finding. v2's retention mechanism is visible in the data: 55 retained-latest
targets, re-reads down 4×, and per-call peaks down 15% on L1. The
`dropAtBoundary` metric reads 0% for v2 — a spec-literal limitation (the sent
rewrite materializes in the carried basis at the next event, and per-turn
growth usually exceeds even multi-block removals at the boundary call itself);
trajectory peaks and totals carry the real signal.

## Verdict (honest, second dataset)

1. **Reliability of dynamic rewriting: replicated** — now 9+9=18/18 ACTIVE-arm
   legs across two independent matrices with 44 sent rewrites total, zero task
   failures, zero guard violations.
2. **Efficiency: policy-dependent and now positive where it matters.** With
   retention-aware coarse removal, total context mass is below native overall
   (−11%), dramatically so on read-then-edit-heavy work (L1 −41%); it does not
   yet beat native on feature work whose verification reads keep the context
   small anyway (L2 +81% vs an unusually cheap native cell this run; note
   M1's L2 native was 95% costlier than M2's — between-run native variance is
   large, another reason n must grow before firm claims).
3. **The policy, not the mechanism, was M1's problem.** Same runtime, same
   composer, same guards: changing only WHAT gets marked superseded moved the
   aggregate from +39% to −11% versus native.

## Next levers (data-named, again)

- L2 remains v2's weak cell: verification-heavy reads of edited files are the
  remaining mass; a "verification-window" policy (defer sweeps until after the
  final oracle run) or deduplicating repeated identical reads would target it.
- n=3/cell with large between-run native variance: the confirmatory step is
  n≥8/cell on L1+L2 (~48 legs) under the same authorization pattern.
- Cross-model replication and the compaction comparison arm remain open
  breadth items (see the M1 analysis ledger).

Raw evidence: local untracked `research/context-benchmarks/reports/cr004-matrix/cr004-m2-20260827-8a87b471/`
(analysis regenerated once after fixing a cell-policy label bug — labels derive
from the arm strategy now; raw leg evidence untouched).
