# CR-004 M5 Phase A — pre-registered replication analysis

- **Status:** `EXECUTED — PREREGISTERED ANALYSIS COMPLETE` (32/32 legs, both cells n=8)
- **Date:** 2026-08-28
- **Run identity:** `cr004-m5-20260828-a1373727` (single-use, consumed; 495 provider-call records, ~51 min; evidence-root `legsRoot=1cdca64f…` bound to commit `1091b69`)
- **Contract:** [`cr004-m5-replication-run-contract-DRAFT-2026-08-28.md`](../plan/cr004-m5-replication-run-contract-DRAFT-2026-08-28.md) — AUTHORIZED Phase A; the pre-registration was finalized BEFORE launch and unchanged by the data
- **Design executed as pre-registered:** L1+L2 × {NATIVE, ACTIVE v2} × 8 reps; **seeded randomized within-block arm order** (per-block seeds recorded; the M4 exchangeability confound removed); transactional rewrite semantics and in-flight leg deadlines from the Hardening PR operative throughout (zero guard violations, zero timeouts)

## Pre-registered inferential results (the only inference in this document)

```text
Primary   L1 context mass, one-sided (v2 < native),
          block-aware exact sign-flip permutation (256 assignments):
          observed block-sum = -92 426 (v2 HIGHER), p = 0.6016      => FAIL (alpha 0.05)

Secondary L2 context mass, same statistic:
          raw p = 0.7070, Holm-adjusted p = 1.000                    => FAIL (family alpha 0.05)

Reliability non-inferiority gate (pre-declared, pooled, margin 1 leg of 16):
          ACTIVE 16/16 vs NATIVE 16/16, difference 0                 => PASS
```

## Descriptive cells

| Cell | oracle | records (mean) | token-estimate sum (mean) | trajectory peak (mean) |
| --- | --- | --- | --- | --- |
| L1/NATIVE | 8/8 | 17.0 | **183 439** | 16 613 |
| L1/ACTIVE v2 | 8/8 | 17.4 | 194 992 (+6%) | 19 368 |
| L2/NATIVE | 8/8 | 13.5 | **117 827** | 15 136 |
| L2/ACTIVE v2 | 8/8 | 14.0 | 144 329 (+23%) | 16 707 |

Interventions fired on every ACTIVE leg's qualifying boundaries (15 sends,
25 removed blocks, 92 retained-latest targets, 4 re-reads) — the policy
behaved mechanically exactly as in M2–M4; what changed is the estimation.

## What this result means (recorded plainly)

1. **The M2/M4 efficiency claims do not survive randomization.** Under the
   pre-registered randomized design, v2 shows no context-mass advantage on
   either task (point estimates mildly unfavorable). The Lead review's
   exchangeability critique is empirically vindicated: the deterministic
   control-first order of M1–M4 was confounded with the arms, and native
   between-run variance is enormous (L1 native cell means across runs:
   289k → 315k → 183k, a 72% swing) — large enough to manufacture the
   earlier "wins" in either direction.
2. **Reliability non-inferiority is now the program's best-evidenced
   property**: 16/16 vs 16/16 here (gate PASS with margin to spare), and
   pooled across M4+M5 the Active arm is 30/32 vs 30/32 with 91 sent
   rewrites and zero guard violations under transactional semantics. The
   M4 task-shaped dip did not replicate.
3. **Corrected campaign verdict:** dynamic context rewriting under the v2
   policy is reliability-neutral at this scale and task mix; its efficiency
   effect is NOT established — earlier favorable estimates were
   order-confounded. Any future efficiency claim requires randomized,
   variance-controlled designs (this harness now supports them natively),
   and should expect native variance this large to dominate unless paired
   designs or substantially larger n are used.

## Standing non-claims

Internal token estimates; single model (Phase B cross-model remains the
named breadth step); n=8/cell; no causal language. Phase B (second provider)
requires its own contract amendment per the pre-registration.

Raw evidence: local untracked
`research/context-benchmarks/reports/cr004-matrix/cr004-m5-20260828-a1373727/`
(evidence-root bound; `--verify-evidence` clean).
