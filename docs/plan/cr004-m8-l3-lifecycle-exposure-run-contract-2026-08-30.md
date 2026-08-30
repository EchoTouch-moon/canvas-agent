# CR-004 M8 — L3 lifecycle and direct exposure screen

- **Status:** `PRE-REGISTERED / EXECUTION AUTHORIZED BY CURRENT RESEARCH DIRECTION`
- **Date:** 2026-08-30
- **Purpose:** extend the M7 direct model-visible measurement to the noisy
  bug-hunt task and observe the verification-window mechanism beside the
  coarse and batched removal mechanisms.

M8 is a new mechanism screen. It is not a retry of M6 or M7, a continuation
of Wave A, or authorization for CR-004 production/active rewrite behavior. It
uses the frozen L3 task manifest and fixture, the already registered V2/V3/V4
arms, and a new run identity.

## Pre-registered design

```text
Task:        L3 only — frozen noisy bug-hunt task
Arms:        NATIVE
             ACTIVE_V2 = v2-retain-latest-coarse
             ACTIVE_V3 = v3-verify-window-dedup
             ACTIVE_V4 = v4-batched-retain-latest
Reps:        8 per task/arm cell (32 legs total)
Arm order:   seeded randomized within the L3/repetition block
Provider:    Step Plan / step-3.7-flash, one strict binding for the matrix,
             fallback='none'
```

The treatment policies are unchanged from their existing registrations. M8
adds no policy constant and does not tune the V4 threshold. The new run only
extends direct before/after model-visible telemetry to all sent Active
rewrites and records the existing lifecycle/re-read signals on L3.

## Binding and hard boundaries

```text
Run identity:    cr004-m8-<ISO-date>-<8-hex>, single-use and new
Contract:        this file, hashed into manifest.json
Baseline:        the committed code baseline containing M7 telemetry and
                 the M8 profile/contract
No resume:       a terminal or interrupted M8 identity is never resumed
```

The runner must use `experiment-strict`, record the provider configuration
hash, and refuse to substitute DeepSeek or another fallback. Provider or
runtime failures remain failed-leg evidence; they are not silently relabeled
as task, policy, or harness failures.

No M8 leg may modify:

- `packages/context-runtime/src/planning/policy-v0.ts`;
- the L3 manifest or fixture;
- CR-005 manifests or fixtures;
- the Pi system instruction, compaction settings, or Active safety guards;
- CR-004 production/default behavior.

Native remains the control. All existing incremental evidence, replay,
writable-path, operator kill-switch, and safety gates remain active.

## Budgets

```text
Per leg:       maxSemanticCalls = 40
               maxToolCalls = 120
               wallClockMs = 600,000
Matrix:        maxProviderCallRecords = 1,800
               runWallClockMs = 18,000,000
```

There is no budget expansion after the first leg launches. The profile binds
the matrix ceilings; the manifest records both profile and per-task ceilings.

## Measurements

Record for every leg:

- objective, regression, writable-conformance, replay, and safety outcomes;
- provider-call records, tool calls, wall-clock time, and internal context
  estimates (never provider token or price measurements);
- trajectory peak/final/sum;
- Active attempts, sends, candidate blocks, removed blocks, retained latest
  targets, re-reads, boundary drops, verification-window deferrals, and V4
  batch deferrals;
- for every sent Active rewrite, the model-visible basis estimate immediately
  before the send, the composed-message estimate immediately after the send,
  message counts on both sides, and the signed net estimate `before - after`.

The direct measurement is scoped to the Pi `AgentMessage[]` context at the
pre-provider seam. It excludes system-prompt assembly and the provider
request body. It is an internal estimator, not a provider token counter and
not a cost measurement. Positive net means a reduction; zero and negative
values remain observations.

## Primary questions

M8 is an exposure and mechanism screen, not a confirmatory comparison. It
addresses:

1. whether L3's noisy repository supplies enough eligible stale-read
   structure for V2, V3, or V4 to intervene;
2. whether the V3 verification-window deferral and duplicate-read path are
   observable on the same task where M6 supplied limited V4 exposure;
3. whether L3 sent rewrites have complete direct model-visible measurements;
4. whether re-read and post-first-read observations can be recorded without
   being overinterpreted as confirmed false removal.

## Decision rules

```text
EXPOSURE_OBSERVED
  At least one sent Active rewrite has complete before/after telemetry and
  the evidence passes binding, replay, safety, and budget checks.

EXPOSURE_LIMITED
  The run is evidence-closed, but no sent rewrite or too few complete
  measurements support a mechanism judgment.

HARNESS_CONTRACT_FAILURE
  Binding, replay, materialization, safety, or evidence integrity prevents a
  trustworthy result.
```

The following are explicitly not decision claims in M8:

- no provider-token or price savings claim;
- no Native-versus-Active causal claim;
- no efficiency, superiority, or statistical significance claim;
- no CR-004 Active Rewrite readiness claim;
- no confirmation that a re-read proves a false removal;
- no claim that lack of exposure means the policy is correct or ineffective
  in all tasks.

M8 does not authorize Wave B, CR-004 production/active rewrite, an M7 retry,
or adaptive changes to any policy threshold. Any subsequent mechanism,
policy repair, or active rewrite requires a new bounded decision and run
identity.
