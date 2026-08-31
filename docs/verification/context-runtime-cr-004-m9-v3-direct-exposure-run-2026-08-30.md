# CR-004 M9 V3 direct-exposure screen — durable evidence summary

- **Run:** `cr004-m9-20260830-4c7d1e9a`
- **Series:** `M9-v3-direct-exposure`
- **Status:** `EXECUTED / EXPOSURE_OBSERVED`
- **Execution date:** 2026-08-30
- **Baseline / code commit:** `220ed6ca1eeddfaa9135b883deddad3c02ece40f`
- **Contract:** `docs/plan/cr004-m9-v3-direct-exposure-run-contract-2026-08-30.md`
- **Contract SHA-256:** `c8a2ba8079af87d5012df807e1369f6c0bcef55954b36fa68a2bdd20e9603dfd`
- **Provider:** Step Plan / `step-3.7-flash`
- **Fallback:** disabled (`fallbackUsed=false`)
- **Provider configuration hash:** `dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8`

This document records the independent M9 measurement screen. M9 directly
measured the existing V3 verification-window and duplicate-read behavior on
L1/L2, where earlier M6 telemetry had observed V3 sends without direct
before/after model-visible measurements. It is not a retry of M6, M7, or M8,
not a continuation of Wave A, and not authorization for CR-004 production or
Active Rewrite behavior.

The raw report is retained outside Git under the run identity. The report
directory contains the machine manifest, 32 leg records, observations, matrix
analysis, and evidence-root audit inputs; the durable evidence here records
the bounded result without embedding machine-local temporary paths.

## Registered design and boundary

M9 used the frozen L1/L2 manifests and fixtures with two arms, eight
repetitions per task × arm cell, and seeded randomized arm order:

```text
L1/L2 × (NATIVE, ACTIVE_V3) × 8 repetitions = 32 legs
per leg: 40 semantic calls / 120 tool calls / 600 s
matrix: 1,400 provider-call records / 18,000,000 ms
```

The V3 policy was unchanged:

```text
v3-verify-window-dedup
verification window: 2 qualifying assistant tool events
V2 retain-latest coarse edit sweep
defer edit sweep while verification window is open
dedup-only boundary for a new identical duplicate read
```

M9 changed no policy implementation, L1/L2 manifest or fixture, CR-005
artifact, Pi instruction, compaction setting, safety guard, or production
default. It used strict Step Plan binding and no DeepSeek or other fallback.

## Evidence closure

All planned legs reached a terminal completed leg record. A completed leg may
still contain a failed task oracle; that is retained as task evidence and is
not a runner or harness failure.

| Measure | Result |
| --- | ---: |
| Legs attempted | 32 / 32 |
| Legs completed | 32 |
| Technical leg failures | 0 |
| Provider-call records | 585 |
| Tool calls | 989 |
| Run elapsed time | 2,962,578 ms |
| Settled per-leg wall-clock total | 2,955,849 ms |
| Matrix stops | 0 |
| Kill-switch trip | none |
| Replay mismatches | 0 |
| Fixture cleanup | 32 / 32 |

The evidence-root audit was run after offline analysis and returned:

```text
runId              MATCH
codeCommit         MATCH
contractPath       MATCH
contractSha256     MATCH
manifestSha256     MATCH
providerConfigHash MATCH
legsRoot           MATCH
analysisSha256     MATCH
```

Evidence-root fields:

```text
manifestSha256: 3283a139fedb9d95c616bb0458ec4c04c7fa9bd562877e4b88d72dd5f516bd2b
legsRoot:       b001322ff1c01fed6219a942a65220807acb6a9df29e28a6224d68325976ee04
analysisSha256:  86a085c89a098de0d97b06c453a62774364ef2a7f0f12265d4790271ff7c06cc
```

## Task-oracle outcomes

The run had eight completed legs with a failed task oracle. These are not
harness-contract failures:

```text
L1/NATIVE:     primary objective 7/8; regression 8/8; writable 8/8
L1/ACTIVE_V3:  primary objective 7/8; regression 8/8; writable 7/8
L2/NATIVE:     primary objective 8/8; regression 8/8; writable 6/8
L2/ACTIVE_V3:  primary objective 8/8; regression 8/8; writable 5/8
```

The failed signals were two L1 primary objective failures, one L1 V3
writable-conformance failure, and five L2 writable-conformance failures.
The corresponding leg records remained `COMPLETED`, with replay mismatch
zero and fixture cleanup true. Across all three task oracles, 24/32 legs
passed objective, regression, and writable conformance together. M9 does not
retry these legs until they pass; task failure remains part of the historical
screen.

The task-validity failures do not invalidate the direct-exposure result,
because the M9 adjudication asks whether at least one V3 rewrite was sent
with complete direct telemetry and trustworthy binding/replay/safety/budget
evidence. They do prevent treating every leg as a clean Native-versus-V3
task comparison.

## V3 lifecycle and direct-exposure observations

| Cell | Attempts / sends | Candidates / removed | Retained latest reads | Re-reads | Post-first-intervention reads | Dedup triggers | Direct measurement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| L1/ACTIVE_V3 | 9 / 9 | 17 / 17 | 55 | 0 | 3 | 0 | 9 / 9 complete |
| L2/ACTIVE_V3 | 7 / 7 | 9 / 9 | 20 | 0 | 2 | 2 | 7 / 7 complete |

All 16 sent V3 rewrites had:

- `REWRITE_READY` composition verdict;
- guard verdict `PASS`;
- binding hashes for working set, transition, and composition;
- before/after model-visible Pi message estimates and message counts;
- a positive net internal-estimate reduction;
- no kill-switch trip, fallback, replay mismatch, or evidence-integrity warning.

The net internal-estimate reductions were:

```text
L1/ACTIVE_V3: 1180, 997, 248, 489, 248, 257, 295, 481, 257
               mean = 494.7

L2/ACTIVE_V3:  860, 543, 339, 71, 339, 321, 637
               mean = 444.3
```

The composed message count fell on every sent rewrite. These are internal
context estimates and message-set changes at intervention boundaries, not
provider token counts, billing quantities, or cost savings.

V3 sends were triggered by nine ordinary edit boundaries on L1 and five edit
plus two duplicate-read boundaries on L2. The two L2 dedup triggers show that
the dedup-only boundary is observable in this screen. No edit-sweep deferral
was recorded, and no re-read of a removed target was recorded. The three L1
and two L2 post-first-intervention read signals establish later reads after an
earlier intervention, but they are not by themselves confirmed false-removal
or rehydration evidence.

## Descriptive Native/V3 comparison

The offline analysis reports the following raw cell means:

| Task | Arm | Records | Tools | Wall ms | Internal estimate sum |
| --- | --- | ---: | ---: | ---: | ---: |
| L1 | Native | 16.6 | 36.5 | 113,524 | 254,012 |
| L1 | V3 | 18.9 | 33.5 | 80,249 | 200,710 |
| L2 | Native | 19.9 | 26.0 | 79,672 | 198,234 |
| L2 | V3 | 17.8 | 27.6 | 96,036 | 221,413 |

Raw primary-oracle reliability was 15/16 for Native and 15/16 for V3. The
exact small-n permutation summaries for the internal estimate sum were
`p=0.436` for L1 and `p=0.584` for L2. These figures are descriptive only:
repetition is eight per cell, task-validity failures are present, and the
screen does not isolate model/provider variance from policy effects. No
causal, efficiency, superiority, significance, provider-token, or cost claim
is licensed by this table.

## Decision

Under the M9 contract, at least one V3 rewrite was sent with complete direct
before/after telemetry and all binding, replay, safety, and budget checks
passed. In fact, 16/16 sent rewrites had complete direct telemetry:

```text
M9 result: EXPOSURE_OBSERVED
```

The bounded mechanism-specific result is:

```text
L1/V3: direct exposure observed; 9 complete sends; no dedup trigger
L2/V3: direct exposure observed; 7 complete sends; 2 dedup triggers
Task validity: 24/32 complete-oracle legs; 8 task-oracle failures retained
Harness: no contract, replay, materialization, safety, or budget failure
```

This is not Gate B PASS, CR-004 readiness, proof that V3 improves agent
performance, proof that any removal was false, or evidence that V3 is
globally optimal. The V3 policy still removes only the observed candidate
blocks at the recorded boundaries; M9 does not test active rehydration after a
confirmed false removal.

## Historical and next-step policy

The M9 identity and raw evidence are terminal historical evidence and must
not be resumed, overwritten, or retried merely to remove task failures. The
next research decision should treat M9 as the first direct V3 exposure record
on L1/L2, with task-validity caveats and a real observed dedup boundary on L2.

M9 does not authorize Wave B, CR-004 production execution, or adaptive V3
changes. Any policy repair or new lifecycle experiment requires a separate
contract, fresh identity, and zero-provider deterministic review before a
new live authorization.
