# CR-004 M7 exposure run — durable evidence summary

- **Run:** `cr004-m7-20260830-6f4c2a91`
- **Series:** `M7-exposure-measurement`
- **Status:** `EXECUTED / EXPOSURE_OBSERVED`
- **Execution date:** 2026-08-30
- **Baseline commit:** `8596923cd24f5c29529530daf7dd3770e6167c9b`
- **Contract:** `docs/plan/cr004-m7-exposure-measurement-run-contract-2026-08-30.md`
- **Contract SHA-256:** `e852937dfd55626c617c977b335e97f950a7a5c305c4552cee54d51e4bbaedfe`
- **Provider:** Step Plan / `step-3.7-flash`
- **Fallback:** disabled (`fallbackUsed=false`)
- **Provider configuration hash:** `dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8`

This document records the M7 exposure screen only. It does not authorize a
new M7 run, Wave B, or CR-004 production/active rewrite behavior. The raw
report remains outside Git as machine evidence; its evidence root was
verified before this summary was prepared.

## Registered design and execution boundary

M7 used the frozen L1/L2 task manifests and fixtures with the registered
`NATIVE`, `ACTIVE_V2`, and `ACTIVE_V4` arms, eight repetitions per task/arm
cell, and seeded randomized arm order inside every task/repetition block:

```text
2 tasks × 3 arms × 8 repetitions = 48 legs
per leg: 40 semantic calls / 120 tool calls / 600 s
matrix: 1,800 provider-call records / 18,000,000 ms
```

The V4 threshold remained the registered value of two eligible stale read
pairs. No policy, fixture, manifest, Pi system instruction, compaction
setting, or safety guard was changed for the run.

## Evidence closure

The matrix attempted all 48 registered legs and closed each leg individually:

| Measure | Result |
| --- | ---: |
| Legs attempted | 48 / 48 |
| Legs completed | 39 |
| Legs failed | 9 |
| Provider-call records | 871 |
| Tool calls | 1,267 |
| Run elapsed time | 12,025,661 ms |
| Settled per-leg wall-clock total | 5,010,962 ms |
| Matrix stops | 0 |
| Kill-switch trip | none |
| Observation/record-count mismatches | 0 |

The nine failed legs are retained as failed-leg evidence: seven stopped at
the in-flight S-9 deadline and two exceeded the per-leg S-7 wall-clock
budget. Their partial observations are useful for diagnosing abort behavior,
but they do not have complete final artifacts and are excluded from any
complete-arm comparative endpoint. No failed leg was retried.

The evidence-root audit returned:

```text
runId          MATCH
codeCommit     MATCH
contractPath   MATCH
contractSha256 MATCH
manifestSha256 MATCH
providerConfigHash MATCH
legsRoot       MATCH
analysisSha256 MATCH
```

The raw M7 manifest also retains the historical `MX_BUDGETS.maxLegs=27`
default while recording the resolved design as `totalLegs=48`. The effective
state-machine ceiling was bound to the resolved 48-leg design, as confirmed
by 48/48 attempted legs; the current branch additionally makes the emitted
`budgets.maxLegs` field report that resolved value for future runs. This
post-run metadata correction does not change or rewrite the M7 evidence,
which remains bound to the baseline commit above.

## Direct V4 exposure

The run produced 16 planned V4 legs, 13 completed V4 legs, and 3 failed V4
legs. All 13 completed V4 legs passed the primary task oracle. Eight sent V4
rewrites carried complete direct before/after telemetry at the model-facing
Pi message seam; all eight had a positive internal estimated reduction:

| Task | Complete V4 sends | Net internal estimate values | Mean net |
| --- | ---: | --- | ---: |
| L1 | 3 | 716, 457, 441 | 538 |
| L2 | 5 | 111, 916, 1,235, 1,406, 1,670 | 1,067.6 |
| **Total** | **8** | **sum 6,952** | **869** |

The values above are reductions in the project’s internal model-visible
context estimate (`before - after`). They are not provider token counts,
billing quantities, or cost savings. A positive estimate demonstrates that a
V4 rewrite changed the measured model-visible message set in those eight
instances; it does not demonstrate that the change improved task efficiency
or caused the observed task outcome.

V4 recorded seven batch deferrals before a qualifying send (two in L1 and
five in L2). Re-read observations occurred in the V4 L2 cell, including
three re-read signals and four reads after the first read. These are
rehydrate-demand / false-removal-candidate signals only. They do not by
themselves establish that a removal was false or harmful.

## Descriptive arm observations

The complete-run oracle ledger was:

```text
NATIVE:    12 passing primary-oracle legs
ACTIVE_V2:  9 passing primary-oracle legs
ACTIVE_V4: 13 passing primary-oracle legs
```

These counts are descriptive because the run contains failed legs and the
registered repetition count is small. The raw analyzer’s internal context
estimate aggregates also include partial failed trajectories, so they are
not promoted here as clean arm-level efficiency comparisons. No claim is
made about statistical significance, superiority, provider cost, or causal
Native-versus-Active effects.

## Decision and remaining limits

Under the M7 contract, the complete measured V4 sends and matching evidence
integrity checks satisfy:

```text
M7 result: EXPOSURE_OBSERVED
```

This means the runtime mechanism reached the exposure needed for a bounded
measurement. It does **not** mean:

- Gate B passed;
- CR-004 Active Rewrite is ready or authorized;
- REMOVE/REHYDRATE is correct in production;
- Active is more efficient or reliable than Native;
- the internal estimate is a provider-token or cost measurement;
- a re-read proves a false removal.

The M7 identity and evidence are terminal historical evidence and must not be
resumed or overwritten. A future mechanism or policy experiment needs a new
contract, baseline, and run identity.

## Follow-up decisions

The next decision should be a bounded design review for the next mechanism
screen, not an M7 retry. Candidate questions are:

1. whether to expand the direct V4 measurement to L3 or to a deliberately
   phase-shifted task;
2. whether to add an independent oracle that distinguishes rehydrate demand
   from confirmed false removal;
3. whether to compare the observed rewrite measurement against a controlled
   no-removal or fixed-working-set baseline;
4. whether future failed legs should expose nullable partial tool/time
   telemetry rather than the current evidence-close zero defaults.

The fourth item is future harness hardening only; it does not invalidate this
run, and it is not a reason to rerun M7.
