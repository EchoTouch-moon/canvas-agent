# Context Runtime v0.3 Experiment Plan

> Current status and next action: [`Context Runtime 当前状态索引`](../research/context-runtime-current-state.zh-CN.md)。本文保留历史实验定义与当时的 overlay；其中旧的 `ACTIVE`/`awaiting review` 标签不构成当前执行授权。

- **Status:** REBASELINED — CR-001–CR-003 closed; the CR-005 Shadow evidence line is complete as a stopped experiment; CR-004 was not executed and remains `NO_GO`; Phase 2 policy validation is the next gated research line
- **Depends on:** `docs/architecture/context-runtime-v0.3-direction.md`
- **Domain proposals:** `PROPOSAL-030-context-source-universe-model.md`, `PROPOSAL-031-context-working-set-planner.md`
- **Primary harness:** Pi
- **Primary bulk experiment model:** DeepSeek or another replaceable low-cost provider
- **Second harness:** OpenCode
- **Later compatibility target:** Codex
- **CR-001 assigned packet:** `docs/tasks/deepseek/DS-008-pi-context-shadow-observation.md`

## Current status overlay — 2026-08-28 (tenth entry: M5 pre-registered replication — efficiency FAIL, reliability PASS)

Lead review response executed: the Hardening PR (#52: transactional
rewrites, in-flight deadlines, ExperimentProfile binding, JSONL race, API
isolation, evidence roots) merged; then the pre-registered M5 Phase A ran
under seeded randomized arm order with block-aware exact permutation,
Holm family and a pre-declared reliability gate.

```text
Primary (L1, one-sided):   p=0.602  => FAIL  (no efficiency advantage under randomization)
Secondary (L2, Holm):      p=1.000  => FAIL
Reliability non-inferiority: 16/16 vs 16/16 => PASS
M4's -46%/p=0.045:         NOT REPLICATED — order/temporally confounded (exchangeability
                           critique vindicated; L1 native variance across runs: 289k->315k->183k)
campaign verdict:          dynamic rewrite (v2) is RELIABILITY-NEUTRAL, well-evidenced;
                           EFFICIENCY NOT ESTABLISHED — earlier favorable estimates were
                           order-confounded; future claims need randomized paired designs
```

Records: [M5 Phase A analysis](../verification/cr004-m5-replication-analysis-2026-08-28.md) · [Hardening PR #52 response amendment in the M4 analysis](./../verification/cr004-m4-confirmatory-analysis-2026-08-27.md).

## Current status overlay — 2026-08-27 (ninth entry: M4 confirmatory matrix analyzed)

Lead-directed continuation on a fresh branch (PR #50 merged first): policy v3
built and tested but its triggers never fired live (M3, targeted L2 — v2 beat
native there for the first time); then the confirmatory M4 — L1+L2 x NATIVE
vs ACTIVE v2 x 8 reps, 32 legs, 546 records, exact permutation tests.

```text
L1 context mass:  v2 -46% vs native   nominal p=0.045 (first <0.05 signal; not family-wise)
L2 context mass:  v2 -13% vs native   p=0.671  (direction favors v2)
pooled oracle:    14/16 vs 14/16      (neutral; task-shaped: L1 8/8 vs 6/8, L2 6/8 vs 8/8)
value hypothesis: EFFICIENCY ESTABLISHED (descriptive), RELIABILITY NEUTRAL,
                  single-model internal-token caveats; retain-K sweep named next
```

Records: [M3 targeted analysis](../verification/cr004-m3-targeted-analysis-2026-08-27.md) · [M4 confirmatory analysis](../verification/cr004-m4-confirmatory-analysis-2026-08-27.md). One M3 identity aborted for a hung provider request (no in-flight timeout at the session seam; recorded, mitigation in the M4 contract).

## Current status overlay — 2026-08-27 (eighth entry: M2 policy A/B matrix analyzed)

Three-arm matrix (NATIVE · ACTIVE v1 · ACTIVE v2 `v2-retain-latest-coarse`)
over L1–L3 × 3 reps, 27/27 legs, 423 provider-call records, one strict
binding. Policy v2 implemented both M1 levers (coarse sweeps over all edited
paths + retain each path's latest read).

```text
reliability:     9/9 / 9/9 / 9/9 (v1 pathology replicated; v2 zero failures)
context mass:    NATIVE 136 274 · v1 189 347 (+39%) · v2 121 727 (-11%)
best cell:       L1 refactor v2 = -41% vs native, re-reads 7 -> 1
open cell:       L2 feature v2 = +81% vs a cheap native cell (verification reads)
value hypothesis: FIRST POSITIVE SIGNAL — policy, not mechanism, was the M1 problem
power:           n=3/cell, p in [0.2, 1.0] — descriptive, confirmatory n>=8 next
```

Analysis: [M2 matrix analysis](../verification/cr004-m2-matrix-analysis-2026-08-27.md).

## Current status overlay — 2026-08-27 (seventh entry: matrix run analyzed)

Overnight Lead-authorized matrix on three larger L-series tasks (14–16 files
each) × NATIVE/ACTIVE × 3 reps, 18/18 legs, 302 provider-call records, one
strict binding. 31 guarded Active rewrites sent; **zero task failures either
arm (9/9 vs 9/9)**; but only 8/31 interventions produced a net context drop
at the next call and removals induced 11 re-reads, so total context mass rose
~28% on ACTIVE (L2 +75%; L1 −2.5%; L3 par).

```text
reliability of dynamic rewrite:  SUPPORTED at this scale (31 rewrites, 0 failures)
efficiency:                     NOT YET BENEFICIAL (removal too fine-grained; re-read overhead)
policy levers:                  coarser removal · edited-file retention · size-proportional budget
value hypothesis:               FIRST DATA — mixed; mechanism safe, economics unproven
```

Analysis: [matrix run analysis](../verification/cr004-matrix-run-analysis-2026-08-27.md). An earlier identity (`cr004-m1-20260826-609ef8a9`) was aborted for operator kill-switch contamination and is excluded.

## Current status overlay — 2026-08-27 (sixth entry: CR-004 Stage 1 first contact EXECUTED)

The Lead authorized Stage 1; run `cr004-s1-20260826-38bd266f` executed the
first Active rewrite pair on the frozen C1 task under strict Step Plan
binding: Native control PASS, Active leg **received a dynamically rewritten
context** (superseded read-evidence removed, pair-consistent, hash-bound,
guard-passed) and completed the task — both oracles PASS, 11 provider-call
records total, zero stop conditions.

```text
CR-004 Stage 1:  RUN 1 EXECUTED — FIRST CONTACT COMPLETE (rewrite sent, task passed)
value hypothesis: STILL OPEN — one pair supports no statistical/causal claim
next evidence:   small pair matrix (new authorization + run identity required)
```

Record: [Stage 1 run 1](../verification/context-runtime-cr004-stage1-run-1-2026-08-27.md).

## Current status overlay — 2026-08-27 (fifth entry: CR-004 Stage 0 verified)

Stage 0 — the offline Active-rewrite safety seam — is implemented and tested
with zero provider calls: Pi-only capability profile, per-run kill switch,
mandatory/pinned re-assertion, Working Set/Transition hash binding, tool-pair
and system-instruction and opaque-content continuity checks, pre-send guard,
and 19 enumerated fallback reasons; 22 tests, 140 total green. The seam has no
send path by construction.

```text
CR-004 Stage 0:  STAGE_0_VERIFIED (provider calls 0)
Stage 1:         CONTRACT DRAFTED — PENDING LEAD AUTHORIZATION
Stage 1 design:  one C1-localized-bug-fix pair, Native first, budgets 2 legs /
                 30 records / 30 min, kill switch mandatory, materialization
                 carry-forward terminal
value hypothesis: STILL NOT_ESTABLISHED (Stage 1 is first contact, not a quality claim)
```

Records: [Stage 0 verification](../verification/context-runtime-cr004-stage0-safety-seam-2026-08-27.md) · [Stage 1 run contract](cr004-stage1-run-contract-2026-08-27.md).

## Current status overlay — 2026-08-27 (fourth entry: Gate D adjudicated PASS)

Lead review of the C0 evidence against the eight Gate D readiness criteria:
seven positively evidenced on live traces, one (`no unexplained
materialization failure`) structurally `NOT_OBSERVED-IN-SHADOW` and carried
forward as a mandatory Stage 1 fail-closed stop condition.

```text
Gate D:    PASS (7/8 positive, 1 carried forward)
CR-004:    NO_GO -> STAGE_0_PREPARATION_ALLOWED (offline safety seam, no rewrite)
Stage 1:   STILL REQUIRES SEPARATE AUTHORIZATION + its own run contract
value hypothesis: STILL NOT_ESTABLISHED
```

Adjudication: [Gate D record](../verification/context-runtime-cr004-gate-d-adjudication-2026-08-27.md). Stage 0 scope is enumerated there (Pi-only capability profile, Native default with per-Run opt-in, mandatory/pinned re-assertion, Working Set/Transition hash binding, continuity checks, pre-send Native fallback, kill-switch tests, zero rewritten requests).

## Current status overlay — 2026-08-27 (third entry: C0 canary executed)

The Lead authorized live execution and the bounded Shadow lifecycle canary ran
under the [C0 run contract](cspv-c0-run-contract-2026-08-27.md) (Amendments
1–2, both pre-execution): three single-use run identities against
strictly-bound Step Plan (`step-3.7-flash`, `fallbackUsed=false`), 51
provider-call records total. The second entry's `NOT_AUTHORIZED` state is
superseded by that authorization; every other revival-path requirement held.

```text
E1 Distractor Elimination   PASS (live, twice-consistent)
E2 Wrong Path Recovery      PASS (REMOVE->REHYDRATE, live, twice-consistent)
E3 Phase Shift              PASS (REMOVE->REHYDRATE, live)
E4 Superseded Evidence      PASS (live)
mandatory/pinned evictions  0 across every boundary
replay mismatches           0
reason-code coverage        100%
value hypothesis            STILL NOT_ESTABLISHED (Shadow is observational-only)
Gate D / CR-004             PENDING LEAD DECISION (evidence input complete)
```

Run records: [C0 canary runs 1–3](../verification/cspv-c0-canary-runs-2026-08-27.md).

## Current status overlay — 2026-08-27 (second entry: Gate C preparation)

This entry records a same-day Lead direction reversal of the CSPV-C0
decision in the first 2026-08-27 entry below: after reviewing the closure
package, the Lead directed that the experiment continue. Only CSPV-C0 is
revived; the other closure decisions stand, and the closure ledgers remain
the evidence snapshot:

```text
Gate C preparation (second Lead direction)
v0.3 program state: EXTENDED_FOR_GATE_C_PREPARATION
value hypothesis: NOT_ESTABLISHED (closure ledgers remain the evidence snapshot)
CSPV-C0: REVIVED_FOR_PREPARATION
live execution: NOT_AUTHORIZED (pending provider/cost authorization)
Gate D / CR-004: UNCHANGED (separate decisions)
```

- CSPV-C0 revival recorded in the closure decisions supersession section — [context-runtime-v0.3-closure-decisions-2026-08-27.md § Supersession](../verification/context-runtime-v0.3-closure-decisions-2026-08-27.md#supersession--cspv-c0-revived-2026-08-27-second-lead-direction)
- C0 run contract (reviewed preparation artifact) — [cspv-c0-run-contract-2026-08-27.md](cspv-c0-run-contract-2026-08-27.md)
- New executable artifact: Gate C evidence evaluator — provider calls `0`
- Live execution `NOT_AUTHORIZED`: this entry grants no provider/cost authorization, and every C0 revival-path requirement (new run identity, Step Plan only with no fallback, separate scenario-run and provider-call budgets, fail closed at every gate) remains binding

## Current status overlay — 2026-08-27

This entry supersedes the plan header status line above and the 2026-08-13
overlay below. The Phase 2 policy validation line ran to gate adjudication,
the follow-on CR-009–CR-012A verification chain completed, and the v0.3
program is closed as a stopped experiment:

```text
Phase 2 — Context Selection Policy Validation
CSPV-B0: EXECUTED / historical POLICY_CAPABILITY_GAP
CSPV-B1: EXECUTED / PASS
Gate B: ADJUDICATED PASS
Gate A: ADJUDICATED PASS

Program closure
v0.3: CLOSED_AS_STOPPED_EXPERIMENT
value hypothesis: NOT_ESTABLISHED
v0.4 runtime advancement: NOT AUTHORIZED
```

- CR-009 core state machine VERIFIED — [context-runtime-cr-009-core-state-machine-2026-08-14.zh-CN.md](../verification/context-runtime-cr-009-core-state-machine-2026-08-14.zh-CN.md)
- CR-010 model-visible request parity PASS — [context-runtime-cr-010-model-visible-request-parity.md](../verification/context-runtime-cr-010-model-visible-request-parity.md)
- CR-011 real-provider parity smoke PASS (1 provider call) — [context-runtime-cr-011-real-provider-parity-smoke.md](../verification/context-runtime-cr-011-real-provider-parity-smoke.md)
- CR-012A Codex cross-harness conformance PASS — [context-runtime-cr-012a-codex-context-conformance.md](../verification/context-runtime-cr-012a-codex-context-conformance.md)
- CSPV-B1 EXECUTED / PASS — [context-selection-policy-gate-b1-run-1.md](../verification/context-selection-policy-gate-b1-run-1.md)
- Gate B adjudicated PASS — [context-selection-policy-gate-b-adjudication.md](../verification/context-selection-policy-gate-b-adjudication.md)
- Gate A adjudicated PASS — [context-selection-policy-gate-a-adjudication-2026-08-27.md](../verification/context-selection-policy-gate-a-adjudication-2026-08-27.md)
- Closure decisions recorded: C0 DEFERRED, CR-012B DEFERRED, CR-013 CANCELLED/FOLDED, milestone item 5 waived — [context-runtime-v0.3-closure-decisions-2026-08-27.md](../verification/context-runtime-v0.3-closure-decisions-2026-08-27.md)
- Final synthesis: v0.3 CLOSED AS STOPPED EXPERIMENT, value hypothesis NOT ESTABLISHED, no v0.4 runtime advancement — [context-runtime-v0.3-final-synthesis-2026-08-27.md](../verification/context-runtime-v0.3-final-synthesis-2026-08-27.md)

## Current status overlay — 2026-08-13

The original sections in this plan preserve the historical definitions and
acceptance intent of CR-001 through CR-008. Their earlier `ACTIVE`, `awaiting
review` and sequencing labels must not be read as current execution authority.
The current research truth is maintained in the [Context Runtime current-state
index](../research/context-runtime-current-state.zh-CN.md). The rebaseline
document remains the historical Phase 1/2 overlay.

```text
Phase 1 — Observability, Shadow Infrastructure & Benchmark Evidence
CR-001–CR-003: CLOSED FOR THIS PHASE
CR-005 Shadow evidence line: COMPLETE_AS_STOPPED_EXPERIMENT
CR-004 Active Rewrite: NOT EXECUTED / NO_GO

Phase 2 — Context Selection Policy Validation
REMOVE / false-removal / REHYDRATE: NEXT

CR-004 Active Rewrite: NO_GO until Phase 2 readiness review
CR-006+ cross-model / second-harness / Codex work: LATER
Provider execution: NO_GO
```

The Phase 2 documentation package is [`PROPOSAL-032`](../architecture/decisions/PROPOSAL-032-context-eviction-rehydration-policy-experiment.md)
and its [deterministic transition-suite task specification](../research/context-selection-policy-validation-deterministic-transition-suite.md).
Neither document authorizes a provider run or changes the Planner.

## 1. Purpose

This plan converts the Context Runtime direction into a sequence of controlled experiments.

The goal is not to ship a new Agent in v0.3.

The goal is to answer one technical question with evidence:

> Can an external, provider-neutral Context Runtime maintain or improve coding-task reliability while actively shrinking, replacing and rehydrating the model's Context Working Set instead of relying on monotonic context growth followed by compaction?

The experiment must keep Context Runtime independent of any single Agent harness or model provider.

---

## 2. Architecture constraint before tasking

The following dependency rule is mandatory:

```text
Pi integration ---------+
OpenCode integration ---+---> packages/context-runtime
Codex integration ------+

packages/context-runtime
    MUST NOT import Pi / OpenCode / Codex / DeepSeek-specific code
```

The Runtime core should operate on provider-neutral research structures such as:

```text
ContextSource
ContextSourceVersion
ContextSourceState
ContextUniverseRevision
ContextRepresentation
ContextWorkingSet
ContextDecision
ContextTransition
ContextPolicy
ModelCallObservation
```

Do not reuse the renderer's existing pre-freeze `ContextCandidate` type as a Runtime model.

Exact public schemas are not frozen by this plan.

Do not publish stable contracts until the Shadow experiment produces real data.

---

## 3. Experiment matrix

### 3.1 Primary controlled comparison

Keep fixed:

```text
Agent harness: Pi
Model: same selected model
Repository: same revision
Task: same TaskSpec / acceptance criteria
Tool policy: same
Budget: same
```

Change:

```text
Context strategy
```

Required variants:

```text
A. Native
   Pi native context behavior

B. Shadow
   Pi native behavior unchanged
   Canvas reconciles a Context Universe and computes a hypothetical Working Set

C. Dynamic
   Canvas rewrites active semantic context before model calls
```

Optional baseline:

```text
D. Static
   Canvas initial frozen context only + native later growth
```

### 3.2 Cross-model check

After a Dynamic policy shows value on the default low-cost model, rerun a representative subset on another model family.

A policy does not become a general Runtime policy until it survives this check.

### 3.3 Second-harness check

After Pi proves the core mechanism, port the Runtime boundary to OpenCode.

Compare:

```text
OpenCode Native
vs
OpenCode + Canvas Dynamic Working Set
```

This is the first portability gate.

---

## 4. Work packages

## CR-001 — Pi Research Integration Spike

**Assigned implementation packet:** `docs/tasks/deepseek/DS-008-pi-context-shadow-observation.md`

**Owner:** DeepSeek V4 Flash

**Start gate:** PR #12 architecture merged + the user explicitly selects Context Runtime v0.3 research as the next milestone. Product MVP v0.2 closeout is already complete.

DeepSeek must create the DS-008 implementation branch from reviewed `main` after both gates are satisfied; the architecture PR branch is not an implementation base.

**Historical status (2026-08-11):** EVIDENCE READY — awaiting architecture review. Full evidence in `docs/verification/context-runtime-cr-001-pi-shadow.md`. The opt-in Pi + DeepSeek live smoke was EXECUTED with 4 real semantic model-call observations; `pnpm check` is green (502 tests).

**Current phase status (2026-08-13):** CLOSED FOR THIS PHASE; evidence is
preserved and no new CR-001 execution is authorized.

### Objective

Prove that Canvas can observe every Pi model-call context without changing Agent behavior.

### Scope

- create an experimental Pi integration package;
- connect the Pi pre-model context hook to a Canvas Runtime callback;
- emit a stable model-call sequence identifier;
- capture bounded context metadata;
- return the native context unchanged;
- run one real coding task against a replaceable provider;
- use DeepSeek as the default bulk experiment provider where practical.

### Explicit non-goals

- no context rewrite;
- no durable schema freeze;
- no OpenCode work;
- no Codex gateway;
- no Context Canvas UI;
- no autonomous context-selection Agent.

### Acceptance evidence

- at least one end-to-end Pi coding Run completes;
- every model invocation is observed exactly once or has documented retry semantics;
- the Run records model-call sequence, estimated context size and basic context categories;
- disabling the integration restores normal Pi behavior;
- `context-runtime` core contains no Pi or provider-specific imports;
- provider credentials are not persisted in Runtime observations.

### Stop condition

If Pi cannot expose a stable enough model-call boundary without a deep fork, stop and write an architecture review before changing the integration strategy.

---

## CR-002 — ModelCallObservation, Source Reconciliation and Context Universe research model

**Historical status (2026-08-11):** EVIDENCE READY — awaiting architecture review. Implemented by DS-009 on `agent/deepseek-ds-009-context-source-universe-shadow`; full evidence in `docs/verification/context-runtime-cr-002-source-universe-shadow.md`. Enriched Pi + DeepSeek live smoke EXECUTED (5 semantic calls; EXACT=8, UNATTRIBUTED=4, resourceHints=4; Universe revision 5 / 9 sources). 565 tests green.

**Current phase status (2026-08-13):** CLOSED FOR THIS PHASE; evidence is
preserved and no new CR-002 execution is authorized.

### Objective

Create the minimum provider-neutral in-memory / experimental structures needed to reason about context evolution.

This work follows `PROPOSAL-030` and must preserve the separation:

```text
Source Observation
    !=
Source Reconciliation
    !=
Working Set Planning
```

### Candidate fields to validate

`ModelCallObservation` may need:

```text
runId
runtimeSessionId
sequence
agentHarness
modelProfile
nativeContextEstimate
messageCategoryCounts
toolStateReferences
phaseHint
timestamp
```

`ContextSource / ContextSourceVersion / ContextSourceState / ContextUniverseEntry` research data may need:

```text
sourceKey
sourceKind
contentHash / contentRef
authority
baselinePriority
observationStatus
admittedVersionId
lastAvailableVersionId
freshness / world revision
representation availability
token estimate
provenance
```

The exact shapes must be derived from CR-001 evidence.

### Acceptance evidence

- one Run can be reconstructed as a model-call timeline;
- repeated source observations can be correlated by stable source identity and source-version hash;
- `AVAILABLE`, `ABSENT` and `UNAVAILABLE` are distinguishable;
- Snapshot-seeded source versions and Run-derived observations are distinguishable;
- Universe revisions can be correlated with model-call boundaries;
- secret-bearing fields are excluded or redacted;
- no schema is promoted to a stable public contract without architecture review.

---

## CR-003 — Shadow Working Set Planner

**Historical status (2026-08-11):** CR-003A bounded kernel evidence ready — awaiting architecture review. Implemented by DS-010 on `agent/deepseek-ds-010-shadow-working-set-planner`; full evidence in `docs/verification/context-runtime-cr-003-shadow-planner.md`. Policy V0 deterministic (ADD/KEEP/REMOVE/REHYDRATE; REPLACE/COMPRESS contract-only), Universe-bound, credential-free tests green, opt-in Pi + DeepSeek Shadow smoke EXECUTED (5 model calls, 5 Shadow plans). `pnpm check` green (582 tests).

**Current phase status (2026-08-13):** CLOSED FOR THIS PHASE; the next
REMOVE/REHYDRATE validation is separately scoped by PROPOSAL-032. No new
CR-003 execution or Planner change is authorized by this overlay.

### Objective

For every observed model call, compute what Canvas would have used without changing the real request.

This work follows `PROPOSAL-031`.

The Planner must operate on:

```text
ContextUniverseRevision
+
ContextPlanningRequest
+
Previous Shadow ContextWorkingSet (optional)
```

and produce:

```text
ContextRepresentation[]
ContextWorkingSet
ContextDecision[]
ContextTransition
```

### First policy inputs

Use deterministic signals first:

- protection / mandatory state;
- authority;
- P0-P3 baseline priority;
- task phase / phase hint;
- current target;
- current diff;
- source freshness / observation availability;
- superseded status;
- source dependency / derivation;
- latest failing verification evidence;
- previous remove / rehydrate history;
- previous Working Set membership;
- representation token cost;
- budget.

### Required semantic decisions

Initial vocabulary:

```text
KEEP
ADD
REMOVE
REPLACE
COMPRESS
REHYDRATE
```

Membership and representation decisions must remain distinguishable.

Example:

```text
Call #14
Native: 28.4K
Proposed Working Set: 15.1K

REMOVE
- login.ts FULL
  reason: RULED_OUT

REPLACE
- auth.ts FULL
+ auth.ts SYMBOL refreshSession
  reason: REPRESENTATION_NARROWED

KEEP
= Task instruction
  reason: MANDATORY_INSTRUCTION

REHYDRATE
+ old test failure
  reason: DETAIL_REQUIRED
```

### Metrics

- proposed token reduction;
- Working Set churn;
- number of removes;
- number of representation replacements;
- number of compressions;
- number of proposed rehydrates;
- sources removed and later observed as needed again;
- repeated file/tool reads after removal;
- stale-context retention rate;
- context category distribution;
- stable-prefix estimate where measurable.

### Acceptance evidence

- a Shadow report exists for a representative task corpus;
- every membership or representation change has machine-readable reason codes;
- every derived representation retains SourceVersion provenance;
- false-removal candidates can be identified;
- rehydration candidates are measurable;
- mandatory protections are test-locked;
- policy output is deterministic for the same normalized Universe + PlanningRequest + policy version.

---

## CR-004 — Dynamic Working Set Rewrite

**Current phase status (2026-08-13):** `NO_GO`. The original gate and safety
rules below remain design constraints; they are not an implementation
authorization. Reconsideration requires the Phase 2 readiness review.

### Objective

Enable real context rewrite in controlled Pi runs.

### Gate

CR-004 cannot start until all of the following have been separately reviewed:

- the Phase 2 REMOVE/REHYDRATE policy specification;
- deterministic transition evidence with replay, provenance and protection
  gates passing;
- representative Shadow lifecycle evidence and a repeatable Native baseline;
- the Active protocol-continuity, capability and kill-switch safety seam.

Passing any one of these gates does not authorize an Active provider run.

### Rewrite operations

Initial allowed vocabulary:

```text
KEEP
ADD
REMOVE
REPLACE
REHYDRATE
```

`COMPRESS` should initially use explicit deterministic / reviewed summarization rules or precomputed summaries. Do not make opaque LLM summarization a mandatory dependency of the first rewrite experiment.

### Safety rules

- rewrite is enabled explicitly per Run;
- native context remains available for control experiments;
- tool-call continuity must be preserved outside the semantic Planner;
- system / mandatory instructions cannot be silently removed;
- a failed Runtime decision must fall back to native context for the experiment, unless the specific test intentionally validates fail-closed behavior;
- every changed model call records its ContextTransition;
- every Working Set binds to the exact Universe revision from which it was planned;
- stale representations cannot silently masquerade as current source state.

### Acceptance evidence

- the same benchmark task can run in Native and Dynamic modes;
- Dynamic mode demonstrates actual context shrink on at least one call after prior growth;
- all active removals and representation changes are observable in the timeline;
- rehydration can restore previously cold evidence;
- no task is counted successful unless its existing acceptance criteria pass.

---

## CR-005 — Pi Benchmark and Failure Analysis

**Current phase status (2026-08-13):** `CLOSED FOR THIS PHASE` as
`COMPLETE_AS_STOPPED_EXPERIMENT`. Run 1 and Run 2 are terminal/preserved; C5/C6
have no live evidence and must not be resumed as Wave A Run 3. See the current
research rebaseline for the accepted evidence and next gate.

### Objective

Determine whether Dynamic Context Working Set management has measurable value.

**Current phase note (2026-08-13):** This is the historical CR-005 objective.
The accepted CR-005 Wave A evidence phase is closed as a stopped experiment and
did not establish Dynamic policy value. A future REMOVE/REHYDRATE canary must
use the separate Phase 2 policy design rather than silently resuming this
matrix.

### Minimum task corpus

Include tasks that create different context pressure:

1. localized bug fix;
2. multi-file feature change;
3. failing-test diagnosis;
4. refactor with architectural constraints;
5. task requiring discovery across unrelated candidate files;
6. longer task with at least one wrong investigative path.

Use repository fixtures or reproducible real-project snapshots.

### Minimum metrics

```text
quality
- task success rate
- acceptance criteria pass rate
- regression / test result

context
- total input tokens
- peak active context
- average active context
- growth / shrink transitions
- stale context retained
- removals
- replacements / compressions
- rehydrations
- false-removal evidence
- Working Set churn

efficiency
- tool calls
- repeated file reads
- repeated searches
- execution time
- provider cost where available

explainability
- transitions with explicit reason codes
- unexplained rewrite count
- source / representation provenance coverage
```

### Promotion rule

Dynamic Context is promising only if it:

> maintains or improves task reliability while materially reducing irrelevant active context or repeated work.

Token reduction alone is insufficient.

A smaller Working Set with worse task success is a failed policy.

---

## CR-006 — Cross-Model Validation

**Current phase status (2026-08-13):** `LATER / NO_GO`. CR-006 requires a
reviewed Dynamic policy and is not the immediate next numbered work package.

### Objective

Check whether the best Pi Dynamic policy is model-specific.

### Procedure

- freeze one reviewed Context Policy version;
- select a representative subset of CR-005 tasks;
- run the same Native / Dynamic comparison using another model family;
- do not retune the policy before the first comparison.

### Acceptance evidence

Record whether:

- the same removals remain safe;
- the same representation narrowing remains useful;
- rehydration demand changes;
- smaller / stronger models react differently to context reduction;
- policy weights need model profiles rather than global defaults.

### Possible conclusion

The Runtime can remain Agent-neutral while still allowing model-aware rendering / budgeting profiles.

Model-neutral does not require every policy threshold to be identical for every model.

---

## CR-007 — OpenCode Portability Experiment

### Objective

Test the provider-neutral Runtime against a second open Agent with more mature native context management.

### Scope

- implement only the minimum OpenCode integration required to feed Runtime observations and, if safely supported, Working Set decisions;
- preserve OpenCode Native as the control;
- reuse the same Runtime source, Universe, representation, policy and Working Set definitions from Pi;
- record integration-specific capability differences;
- avoid mapping OpenCode's model-hidden `Context Snapshot` to Canvas `ContextSnapshot`.

### Required comparison

```text
OpenCode Native
vs
OpenCode + Canvas Runtime
```

### Acceptance evidence

- no Pi-specific concepts are required by Runtime core;
- the same `ContextSource / ContextUniverse / ContextRepresentation / ContextWorkingSet / ContextTransition` model represents both harnesses;
- differences are isolated to integration adapters or explicit capability profiles;
- benchmark results identify whether Canvas adds value beyond OpenCode native context management.

### Stop condition

If the Runtime must become OpenCode-specific to work, stop and revise the abstraction instead of adding provider-specific branches to the core.

---

## CR-008 — Codex Compatibility Research

### Objective

After the Runtime is validated on open harnesses, test a less direct integration boundary.

Possible technique:

```text
Codex
  -> protocol-aware Context Gateway
  -> Canvas Context Runtime
  -> upstream model API
```

This work is not part of the initial v0.3 validation sequence unless Pi / OpenCode evidence justifies it.

Codex compatibility should answer:

> Can a proven Context Runtime be adapted to an Agent where the model-call boundary is exposed through protocol configuration rather than a native context hook?

It should not redefine the Runtime core.

---

## 5. Suggested repository layout

Direction only:

```text
packages/
  context-runtime/
    src/
      source/
      universe/
      representation/
      planning/
      working-set/
      observation/
      metrics/

  integrations/
    pi-context/
    opencode-context/
    codex-context/
```

If workspace / monorepo conventions make nested integration packages awkward, equivalent top-level package names are acceptable.

The important invariant is dependency direction, not directory aesthetics.

---

## 6. Experiment data policy

Early research data can become large and may contain source code or logs.

Requirements:

- do not persist credentials;
- redact known secret fields before durable storage;
- prefer hashes / references for repeated content;
- keep raw model-call payload retention opt-in and bounded;
- distinguish repository content from Agent-generated summaries;
- keep authority / provenance attached to derived summaries;
- do not silently promote model-generated summaries into authoritative project facts;
- benchmark fixtures should be reproducible from a known repository revision.

---

## 7. No premature product UI

Do not build a large Context Canvas before the experiments reveal what developers repeatedly need to inspect.

The first research UI, if needed, should be closer to a debugger:

```text
Run timeline
  -> Model Call
      -> Native Context
      -> Universe revision
      -> Proposed / Active Working Set
      -> ContextDecision / ContextTransition
      -> Tool Result
```

Useful early views:

- context-size timeline;
- Native vs Working Set comparison;
- KEEP / ADD / REMOVE / REPLACE / COMPRESS / REHYDRATE diff;
- decision reason codes;
- representation provenance;
- source observation status;
- task outcome / acceptance result.

Graph / Canvas visualization can be introduced after recurring relationship questions are observed.

---

## 8. Milestone gate

v0.3 Context Runtime research is considered successful enough to justify a v0.4 architecture decision only if all of the following are available:

1. model-call-level observation from at least one open Agent harness;
2. a repeatable Native benchmark;
3. Source Reconciliation and Universe revisions sufficient for replay;
4. a deterministic Shadow Working Set policy;
5. at least one real Dynamic rewrite experiment;
6. ContextDecision / ContextTransition evidence for every rewrite;
7. measured quality and context-efficiency results;
8. cross-model evidence from at least two model families, or an explicit documented reason this was not possible;
9. a second-harness portability result or a documented abstraction failure;
10. a decision on whether Codex / closed-Agent compatibility is worth pursuing next;
11. a decision on whether Context Runtime should remain inside Canvas Agent or begin extracting into an independently consumable package / service.

Do not pre-commit v0.4 to a managed Agent loop, graph database, multi-Agent orchestration or Codex gateway before this gate is reviewed.
