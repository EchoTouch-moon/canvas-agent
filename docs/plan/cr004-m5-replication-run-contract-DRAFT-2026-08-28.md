# CR-004 M5 — pre-registered replication contract (DRAFT)

- **Status:** `DRAFT — PENDING HARDENING-PR MERGE + RUNNER ORDER-RANDOMIZATION + LEAD AUTHORIZATION`
- **Date drafted:** 2026-08-28
- **Purpose:** the clean replication the Lead review prescribed after the Hardening PR — no new policy, no adaptive endpoint selection.

## Pre-registered design

```text
Tasks:        L1 + L2 (frozen L-series, unchanged)
Arms:         NATIVE vs ACTIVE (v2-retain-latest-coarse) — exactly two
Reps:         8 per cell (32 legs), same strict one-binding discipline
Arm order:    RANDOMIZED within every task x rep block, seeded from the
              run identity hash, recorded leg-by-leg in the manifest —
              replacing the deterministic control-first order (the M4
              exchangeability confound). Alternating order is the
              fallback if the runner change is descoped.
```

## Pre-registered analysis

```text
Primary endpoint:   L1 observedTokenEstimateSum (NATIVE vs ACTIVE v2)
                    one-sided (v2 lower), alpha = 0.05, exact permutation
                    test, block-aware (within task x rep blocks).
Secondary endpoint: L2 observedTokenEstimateSum — Holm-adjusted at
                    family alpha 0.05 (gate: reported only as supportive
                    unless Holm passes).
Reliability gate:   non-inferiority — ACTIVE pooled oracle pass rate must
                    not fall below NATIVE by more than 1 leg of 16
                    (absolute); task-level splits reported but the gate
                    is pooled and pre-declared.
Mechanism metrics:  reported descriptively (interventions, retained-
                    latest, re-reads, trajectory peaks) — no inference.
```

## Model scope

Phase A: Step Plan `step-3.7-flash` (single model, comparable to M4).
Phase B (separate identity + amendment): second provider via the provider
layer for cross-model replication. No cross-phase pooling.

## Non-claims (standing)

Internal token estimates; descriptive reliability; no causal language;
n=8/cell. Any deviation from this pre-registration requires a recorded
amendment BEFORE the affected leg launches.

## Implementation prerequisites

1. Runner arm-order randomization (seeded, manifest-recorded) — the
   ExperimentProfile for M5 stays REFUSED until this and this contract's
   final status land.
2. Hardening-PR transactional semantics and leg deadlines operative
   (merged).
