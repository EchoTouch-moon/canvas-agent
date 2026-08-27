# CR-004 matrix — run analysis (first data-driven efficiency result)

- **Status:** `EXECUTED — ANALYZED` (18/18 legs, both arms 9/9 oracle)
- **Date:** 2026-08-27 (overnight Lead-authorized run)
- **Clean run identity:** `cr004-m1-20260826-d23a992c` (single-use, consumed; 302 provider-call records, ~32 min wall)
- **Preceding aborted identity:** `cr004-m1-20260826-609ef8a9` — operator kill-switch error contaminated every Active leg (0 interventions, `killSwitchTripped: true`); aborted at 9 legs, evidence preserved, excluded from analysis. The contamination motivated a real fix: the operator kill switch is now matrix-terminal (commit history records it).
- **Contract:** [`cr004-matrix-run-contract-2026-08-27.md`](../plan/cr004-matrix-run-contract-2026-08-27.md) (AUTHORIZED per Lead overnight direction; token consumption unconstrained)
- **Tasks:** L1 multi-file refactor · L2 TTL cache feature · L3 noisy bug hunt ([design](../research/cr004-l-series-task-design-2026-08-27.md)) — 14–16 files each, an order of magnitude larger than C1
- **Binding:** `step-plan` / `step-3.7-flash`, experiment-strict, `fallbackUsed=false`, one binding for all 18 legs
- **Analyzer:** `pnpm smoke:cr004mx --analyze <reportDir>`; full JSON at `analysis.json` in the report dir (local, untracked, raw-evidence policy)

## Headline results

| Metric | NATIVE | ACTIVE | Reading |
| --- | --- | --- | --- |
| Task success (oracle) | **9/9** | **9/9** | 31 real rewrites caused zero task failures |
| Model-call records / leg (mean) | 15.3 | 18.2 | ACTIVE legs ran ~19% more calls |
| Tool calls / leg (mean) | 23.4 | 27.1 | ~16% more tool activity |
| Wall clock / leg (mean) | 56.3s | 76.2s | ~35% slower, dominated by extra calls |
| Token-estimate sum, mean of cell means | 152 202 | 195 443 | **+28% total context mass on ACTIVE** |
| Per-call trajectory peak, mean of cell means | 14 115 | 14 389 | per-call peak essentially unchanged |

Per task (token-estimate sums, exact permutation p over C(6,3)=20 label assignments):

```text
L1 refactor : NATIVE 745 255 vs ACTIVE 726 822  (-2.5%)  p=1.000
L2 feature  : NATIVE 546 016 vs ACTIVE 953 220  (+75%)   p=0.200
L3 bug hunt : NATIVE  78 549 vs ACTIVE  78 948  (+0.5%)  p=1.000
```

n=3 per cell: descriptive statistics and exact enumeration only — low
statistical power, no causal claim. Token figures are internal estimates, not
provider measurements.

## Mechanism verification (why the totals look like this)

- **31 sent rewrites across 9 ACTIVE legs** (L1: 15, L2: 13, L3: 3), every one
  `REWRITE_READY` + pre-send guard `PASS`; zero fallbacks, zero stop
  conditions, zero replay mismatches, zero mandatory/pinned violations.
- **But only 8/31 intervention points show a net context DROP at the next
  model call.** Mean change at intervention boundaries is *growth* of
  +230…+1 339 estimated tokens in every leg: each turn's new assistant text
  and tool results outweigh the single removed read block (one toolCall block
  + its result, typically a few hundred estimated tokens). The current policy
  removes too little, too slowly, to bend the trajectory.
- **Removal induces re-fetch.** Re-reads of removed targets (matching
  `readTargetHash` after the intervention that removed them): L1 5/17
  post-intervention reads, **L2 5/6**, L3 1/1 — 11 total. On feature work the
  model re-reads what was removed, adding calls that further inflate the
  ACTIVE totals.
- Where read-then-edit cascades dominate (L1), ACTIVE still came out slightly
  ahead on total context and −14% on trajectory peak (16 938 vs 19 685 mean),
  showing the mechanism can pay off when removals align with genuinely
  superseded exploration.

## Verdict (honest, first data)

1. **Safety/reliability of dynamic rewriting: supported at this scale.** 31
   guarded rewrites on live larger tasks, zero reliability loss (9/9 vs 9/9),
   zero policy violations, deterministic replay throughout.
2. **Efficiency: not yet beneficial.** At flash-model scale with these task
   sizes, conservative per-block removal does not overcome per-turn context
   growth; total context mass rose ~28% on ACTIVE (driven by L2's +75% from
   re-read-induced extra calls), and per-call peaks were unchanged.
3. **Improvement levers the data points at** (candidate next experiments, not
   conclusions): (a) coarser removal — whole exploration phases / multi-block
   sweeps at one boundary instead of one block per edit; (b) retention
   awareness — keep the most recent read of actively-edited files (L2's re-read
   pattern), remove only older duplicates; (c) removal budget proportional to
   context size rather than a fixed 5 sends/leg.

## Considered but not run (breadth ledger)

- **Compaction comparison arm** (NATIVE+Pi-compaction vs ACTIVE) — the
  direction document frames the alternative as monotonic growth *followed by
  compaction*; not run tonight (needs a compaction-enabled settings arm in the
  runner). Designed next, not built.
- **Aggressive-removal policy variant** (lever (a) above) — requires a policy
  flag change, its own deterministic suite extension, then a fresh matrix.
- **Cross-model replication** — single model tonight (step-3.7-flash); the
  provider layer supports swapping; not run.
- **Statistical power** — n=3/cell; a confirmatory matrix would need n≥8/cell
  on the cells that matter (L1/L2), ~64 legs, feasible under the overnight
  authorization pattern.

Raw evidence (manifest/matrix/analysis/legs + per-leg observations) remains
local untracked under `research/context-benchmarks/reports/cr004-matrix/`.
