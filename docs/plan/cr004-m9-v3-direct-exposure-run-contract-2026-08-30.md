# CR-004 M9 — V3 verification-window direct-exposure screen

**Status:** PRE-REGISTERED / EXECUTION AUTHORIZED BY CURRENT RESEARCH DIRECTION  
**Date:** 2026-08-30

## Purpose

M9 is a focused direct-exposure measurement of the existing V3 verification-window and duplicate-read mechanism on L1/L2. M6 observed V3 sends on these task classes before direct before/after telemetry existed; M9 closes that measurement gap with a new run identity.

M9 is not a retry of M6, M7, or M8, not a continuation of Wave A, and not a production or Active Rewrite rollout. L1/L2 manifests and fixtures remain frozen. The registered V3 policy remains frozen. Only the measurement screen is new.

## Frozen design

- Tasks: `L1`, `L2`
- Arms: `NATIVE`, `ACTIVE_V3` (`v3-verify-window-dedup`)
- Repetitions: 8 per task × arm cell; 32 legs total
- Arm order: seeded randomized within task × repetition
- Provider: strict Step Plan, model `step-3.7-flash`; fallback disabled
- Provider endpoint/configuration: the repository's configured Step Plan provider profile
- Run identity: `cr004-m9-YYYYMMDD-8hex`; no resume and no reuse of an earlier run identity

V3 is the existing registered policy. M9 does not change its thresholds or task inputs. Its relevant behavior is:

1. use the registered V2 retain-latest coarse sweep at edits;
2. defer the edit sweep while the verification window is open;
3. permit the dedup-only boundary for a new identical duplicate read;
4. use the existing verification window of two qualifying assistant tool events;
5. preserve all existing bounds, protection, provenance, replay, and fail-closed rules.

No change is permitted to `policy-v0.ts`, Planner behavior outside the registered V3 profile, L1/L2 manifests or fixtures, CR-005 artifacts, Pi instructions, compaction, safety, or defaults during the run.

## Binding and evidence rules

The run must bind to a hashed copy of this contract, the committed baseline, the M9 profile, the frozen L1/L2 fixtures, and the strict Step Plan provider configuration. Provider identity and configuration hash must be recorded without exposing credentials. Failed legs remain retained as failed-leg evidence; they are not silently retried or replaced.

M9 is independent of M6–M8 execution identities. It may use their committed telemetry as prior evidence for the research question, but it must not resume or overwrite those runs.

## Budgets and stop rules

Per-leg limits:

- semantic calls: 40
- tool calls: 120
- wall clock: 600 seconds

Matrix limits:

- provider call records: 1,400
- wall clock: 18,000,000 ms
- legs: 32 planned / 32 maximum

Any record, pair, evidence, materialization, replay, security, checkpoint, provider-binding, or budget hard failure stops the affected leg and, where the matrix gate requires it, the complete run. No subsequent provider execution may be used to conceal or replace a hard failure.

## Measurements

For every leg, retain objective and regression oracle results, writable-path scope, replay and safety outcomes, semantic/tool-call counts, wall clock, internal context estimate, trajectory, and the V3 lifecycle counters:

- attempts and sends;
- candidates and removed blocks;
- retained blocks;
- dedup observations;
- deferred sweeps;
- re-reads and post-first-read re-reads.

For each sent V3 rewrite, retain direct model-visible before/after Pi `AgentMessage` count and internal estimate, plus the net delta and message-level telemetry. The internal estimator is not a provider token meter and must not be reported as provider tokens, price, or savings.

## Research questions

1. Do the V3 sends observed in M6 recur on the same L1/L2 task classes?
2. Can M9 complete direct before/after measurement for every sent V3 rewrite?
3. Are verification-window deferrals and duplicate-read boundaries observable and replayable?
4. Can post-first-read re-reads be distinguished from the initial read in the retained evidence?

## Adjudication

Use one of these bounded outcomes:

- **`EXPOSURE_OBSERVED`** — at least one V3 rewrite was sent with complete direct telemetry and binding, replay, safety, and budget checks passed.
- **`EXPOSURE_LIMITED`** — evidence closed with no send or too little direct exposure to answer the measurement question.
- **`HARNESS_CONTRACT_FAILURE`** — binding, replay, materialization, safety, or evidence-integrity failure prevents a trustworthy exposure conclusion.

M9 does not authorize Wave B, CR-004 production execution, M6–M8 retries, or adaptive V3 changes. It must not make causal, efficiency, superiority, significance, confirmed-false-removal, global-optimality, provider-token, or cost claims. Any later policy change is a separately reviewed B1 activity using the frozen B0 suite.
