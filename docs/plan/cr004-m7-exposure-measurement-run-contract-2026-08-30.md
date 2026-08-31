# CR-004 M7 — batched exposure and direct model-visible measurement contract

- **Status:** `PRE-REGISTERED / EXECUTION AUTHORIZED BY CURRENT RESEARCH DIRECTION`
- **Date:** 2026-08-30
- **Purpose:** increase the probability of observing eligible stale-read
  batches after M6 supplied only limited `ACTIVE_V4` exposure, and directly
  measure the model-visible context before and after each sent rewrite.

M7 is a new exposure screen. It is not a retry of an M6 leg, a continuation
of Wave A, or authorization for CR-004 Active Rewrite. It uses the same frozen
L-series task manifests and fixtures, the already registered V2/V4 arms, and a
new run identity.

## Pre-registered design

```text
Tasks:        L1 + L2 (frozen M6 tasks with observed V4 exposure)
Arms:         NATIVE
              ACTIVE_V2 = v2-retain-latest-coarse
              ACTIVE_V4 = v4-batched-retain-latest
Reps:         8 per task x arm cell (48 legs total)
Arm order:    seeded randomized within every (task x rep) block
Provider:     Step Plan / step-3.7-flash, one strict binding for the matrix,
              fallback='none'
```

The treatment policy is unchanged from the M6 registration:

```text
ACTIVE_V4: at an edit boundary, use the v2 retain-latest coarse sweep, but
defer the rewrite while fewer than 2 older read pairs are eligible. Once 2 or
more eligible stale read pairs exist, send one bounded rewrite, retaining the
latest read for each swept path.
```

M7 adds no new policy constant. The new code path only records a direct
before/after estimate around a SENT rewrite using the same Pi mapper and
documented CR-001 estimator.

## Binding and hard boundaries

```text
Run identity:    cr004-m7-<ISO-date>-<8-hex>, single-use and new
Contract:        this file, hashed into manifest.json
Baseline:        the committed code baseline containing M7 telemetry and
                 this profile/contract
No resume:       a terminal or interrupted M7 identity is never resumed
```

The runner must use `experiment-strict`, record the provider configuration
hash, and refuse to substitute DeepSeek or another fallback. Provider or
runtime failures remain failed-leg evidence; they are not silently relabeled
as task, policy, or harness failures.

No M7 leg may modify:

- `packages/context-runtime/src/planning/policy-v0.ts`;
- the L1/L2 manifests or fixtures;
- CR-005 manifests or fixtures;
- the Pi system instruction, compaction settings, or Active safety guards;
- CR-004 production/default behavior.

The only treatment difference is the already registered Active V2 or V4
removal policy. Native remains the control. All existing incremental evidence,
replay, writable-path, operator kill-switch, and safety gates remain active.

## Budgets

```text
Per leg:       maxSemanticCalls = 40
               maxToolCalls     = 120
               wallClockMs      = 600,000
Matrix:        maxProviderCallRecords = 1,800
               runWallClockMs          = 18,000,000
```

There is no budget expansion after the first leg launches. The profile binds
the matrix ceilings; the manifest records both profile and per-task ceilings.

## Measurements

Record for every leg:

- objective, regression, writable-conformance, replay and safety outcomes;
- provider-call records, tool calls, wall-clock time, and internal context
  estimates (never provider token or price measurements);
- trajectory peak/final/sum;
- Active attempts, sends, candidate blocks, removed blocks, retained latest
  targets, re-reads, boundary drops and batch deferrals;
- for every SENT rewrite, the model-visible basis estimate immediately before
  the send, the composed-message estimate immediately after the send, message
  counts on both sides, and the signed net estimate `before - after`.

The direct before/after measurement is scoped to the Pi `AgentMessage[]`
context at the pre-provider seam. It excludes system-prompt assembly and the
provider request body. It is an internal estimator, not a provider token
counter and not a cost measurement. A positive net value is a reduction; zero
and negative values are retained as observations rather than filtered out.

## Decision rules

The primary output is descriptive mechanism exposure:

```text
EXPOSURE_OBSERVED
  At least one V4 SENT rewrite has complete before/after telemetry and the
  evidence passes binding, replay, safety and budget checks.

EXPOSURE_LIMITED
  The run is evidence-closed, but V4 sends or complete measurements are too
  sparse to support a mechanism judgment.

HARNESS_CONTRACT_FAILURE
  Binding, replay, materialization, safety, or evidence integrity prevents a
  trustworthy result.
```

The following are explicitly not decision claims in M7:

- no provider-token or price savings claim;
- no Native-vs-Active causal claim;
- no efficiency, superiority, or statistical significance claim;
- no CR-004 Active Rewrite readiness claim;
- no confirmation that a re-read proves a false removal. A re-read remains a
  rehydrate-demand / false-removal-candidate signal unless an independent
  task oracle establishes harm.

M7 does not authorize Wave B, CR-004, a retry of an individual M6 leg, or
adaptive changes to the V4 threshold. Any subsequent mechanism, policy repair,
or active rewrite requires a new bounded decision and run identity.
