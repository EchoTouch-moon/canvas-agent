# CR-004 M6 — mechanism-screen run contract

- **Status:** `PRE-REGISTERED / EXECUTION AUTHORIZED BY CURRENT RESEARCH DIRECTION`
- **Date:** 2026-08-30
- **Purpose:** screen one narrowly motivated Active rewrite mechanism after the
  M5 randomized replication did not establish an efficiency advantage for
  `ACTIVE_V2`. This is an exploratory mechanism screen, not a replacement for
  M5 and not a CR-004 readiness decision.

## Pre-registered design

```text
Tasks:        L1 + L2 + L3 (the frozen L-series manifests and fixtures)
Arms:         NATIVE
              ACTIVE_V2 = v2-retain-latest-coarse
              ACTIVE_V3 = v3-verify-window-dedup
              ACTIVE_V4 = v4-batched-retain-latest
Reps:         4 per task x arm cell (48 legs total)
Arm order:    RANDOMIZED within every task x rep block, seeded from the run
              identity hash and recorded in the manifest
Provider:     Step Plan / step-3.7-flash, one strict binding for the matrix,
              fallback='none'
```

`ACTIVE_V4` is frozen before execution:

```text
At an edit boundary, use the v2 retain-latest coarse sweep, but defer the
rewrite while fewer than 2 older read pairs are eligible. Once 2 or more
eligible stale read pairs exist, send one bounded rewrite, retaining the latest
read for each swept path. A deferral consumes neither an attempt nor a send.
```

The threshold is a mechanism constant, not a tunable parameter in this run.
The default policy remains `v1-per-edit`; M3/M5 behavior and historical
evidence are unchanged.

## Binding and hard boundaries

```text
Run identity:    cr004-m6-<ISO-date>-<8-hex>, single-use and new
Contract:        this file, hashed into manifest.json
Baseline:        the committed code baseline that contains this profile and
                 the ACTIVE_V4 implementation
No resume:       a terminal or interrupted M6 identity is never resumed
```

The runner must use `experiment-strict`, record the provider configuration
hash, and refuse to substitute DeepSeek or any other fallback. Provider or
runtime failures are recorded as failed legs; they are not silently re-labeled
as task failures or recovered by another model.

No M6 leg may modify any of the following:

- `packages/context-runtime/src/planning/policy-v0.ts`;
- the L-series manifests or fixtures;
- CR-005 manifests or fixtures;
- the Pi system instruction, compaction settings, or Active safety guards;
- CR-004 production/default behavior.

The only treatment difference is the registered Active removal policy. The
matrix continues to use incremental leg evidence, replay checks, writable-path
checks, the operator kill switch, and the existing per-leg safety/budget
rules. A matrix binding, total-budget, or operator stop is terminal; a failed
leg is evidence-closed before the matrix decides whether later legs remain
safe to launch.

## Budgets

```text
Per leg:       maxSemanticCalls = 40
               maxToolCalls     = 120
               wallClockMs      = 600,000
Matrix:        maxProviderCallRecords = 1,400
               runWallClockMs          = 18,000,000
```

The matrix budget is intentionally bound to the M6 profile rather than the
historical M3/M5 default. The runner records both profile ceilings and the
per-task manifest ceilings in the manifest. There is no budget expansion after
the first leg launches.

## Measurements and interpretation

Record for every leg:

- objective, regression, writable-conformance, replay and safety outcomes;
- provider-call records, tool calls, wall-clock time, and internal context
  estimates (never provider token or price claims);
- trajectory peak/final/sum;
- Active attempts, sends, candidate blocks, removed blocks, retained latest
  targets, re-reads and boundary drops;
- for `ACTIVE_V4`, the number of below-threshold batch deferrals and the fixed
  threshold recorded on each such event.

The primary M6 output is a descriptive mechanism comparison across the four
arms. It may identify a candidate mechanism for a later pre-registered test,
but it does not establish efficiency, causality, superiority, or CR-004
readiness. With four repetitions per cell, no p-value or confidence interval
is promoted to a decision gate. Reliability and scope failures remain real
failures even when the functional objective oracle passes.

The following outcomes are valid:

```text
MECHANISM_SCREEN_PASS
  The harness is trusted and the arm produced evidence for analysis.

MECHANISM_SCREEN_INCONCLUSIVE
  The run is evidence-closed but coverage or reliability is insufficient for
  a mechanism judgment.

HARNESS_CONTRACT_FAILURE
  The runner, replay, materialization, binding, or evidence contract cannot
  make the result trustworthy.
```

No outcome authorizes CR-004 Active rewrite, a new retry of an individual leg,
or an adaptive change to the V4 threshold. Any follow-up mechanism or larger
replication requires a new contract and identity.
