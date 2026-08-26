# CSPV-C0 Run Contract — Bounded Shadow Lifecycle Canary

## 1. Header block

| Field | Value |
| --- | --- |
| Status | `DRAFT — PENDING LEAD AUTHORIZATION REVIEW` |
| Date | 2026-08-27 |
| Artifact | Mandatory reviewed run contract before any Gate C live authorization |
| Grants | `NOTHING`. This draft authorizes no provider execution, no code change, no run |
| Provider calls during drafting | `0` |
| Upstream Gate A | [Gate A adjudication 2026-08-27](../verification/context-selection-policy-gate-a-adjudication-2026-08-27.md) — `PASS`, carries the Q1 deferral this contract must resolve |
| Upstream Gate B | [Gate B adjudication](../verification/context-selection-policy-gate-b-adjudication.md) — `PASS`; states the verbatim contract requirements (`gate-b:74-78`) |
| Supersession context | [v0.3 closure decisions 2026-08-27](../verification/context-runtime-v0.3-closure-decisions-2026-08-27.md) — Decision 1 records `CSPV-C0: DEFERRED` and preserves the full revival path (`closure:69-97`) |
| Gate C definition | [v0.3 research rebaseline](../research/context-runtime-v0.3-research-rebaseline-2026-08-13.md) §5 Gate C (`rebaseline:178-197`), corpus E1–E4 (`rebaseline:184-189`) |
| Policy basis | [PROPOSAL-032](../architecture/decisions/PROPOSAL-032-context-eviction-rehydration-policy-experiment.md) — `ACCEPTED-WITH-PROVISIONAL-ANSWERS` |
| Provider basis | [model-provider-layer.md](../architecture/model-provider-layer.md) — strict-binding infrastructure, merged and waiting (`closure:80-94`) |

The contract requirements this draft must satisfy, verbatim from the Gate B
adjudication (`gate-b:74-78`):

> Before CSPV-C0 can be authorized, Gate A must be adjudicated and a separate
> C0 run contract must be reviewed. That contract must bind a new run identity,
> use Step Plan only with no fallback, separate scenario-run and provider-call
> budgets, and fail closed at every gate. No provider execution is authorized
> by this document.

Gate A is adjudicated `PASS` (`gate-a:3-4`) and Gate B is adjudicated `PASS`
(`gate-b:3`). The closure decision defers C0 on authorization-envelope and
marginal-value grounds, not on gate sequencing (`closure:60-67`), and names
this contract as a mandatory reviewed artifact before any revival
(`closure:65-67`). Until a Lead authorizes, this document remains a draft and
every boundary in the closure decision stands.

Citation keys used below:

- `gate-a` — gate-a adjudication; `gate-b` — gate-b adjudication
- `closure` — v0.3 closure decisions 2026-08-27
- `rebaseline` — v0.3 research rebaseline 2026-08-13
- `p032` — PROPOSAL-032
- `provider-layer` — model-provider-layer.md
- `cr-011` — CR-011 real-provider parity smoke
- `cr-005-task` — CR-005 benchmark corpus task package
- Fixture and source citations are absolute file paths with line numbers.

## 2. Run identity

```text
format      c0-<ISO-date>-<8-hex>
example     c0-2026-08-27-3f9a2c1d
freshness   generated once, at strict preparation, by the C0 runner
uniqueness  MUST NOT collide with any prior run identity in any evidence store
```

Binding rules:

- A run identity is single-use. A terminal run (any §8 stop condition) is
  never retried or resumed under the same identity.
- Wave A identities are never reused. Wave A Run 1 and Run 2 checkpoints
  remain `TERMINAL / PRESERVED / NEVER RESUME` (`rebaseline:226`;
  `closure:189-190`).
- The identity is distinct from the deterministic-suite session prefixes
  `cspv-b0:` / `cspv-b1:` (`packages/context-runtime/tests/fixtures/policy-lifecycle/runner.ts:534`,
  `runner.ts:542`); those suites make zero provider calls and are not runs.
- The identity is supplied to strict preparation as `runIdentity`
  (`provider-layer:51-52`). One binding per run; no rebinding after execution
  starts — these run-level invariants belong to the C0 runner
  (`provider-layer:63-66`).
- The binding's `providerConfigHash` — derived from provider endpoint, model
  and compatibility configuration, without credentials (`provider-layer:66-70`)
  — is recorded in the run manifest (§9) and distinguishes this run from any
  other run sharing the same provider/model labels.

## 3. Provider and model profile

| Field | Value | Source |
| --- | --- | --- |
| Provider | `step-plan` | `provider-layer:13-16` |
| Endpoint | `https://api.stepfun.com/step_plan/v1` | `provider-layer:13-16` |
| Model | `step-3.7-flash` | `provider-layer:13-16` |
| Credential | `STEP_PLAN_API_KEY`, resolved in memory only, never recorded | `provider-layer:8-10`, `provider-layer:15` |
| executionMode | `experiment-strict` | `provider-layer:51` |

Strict invariants, enforced at preparation and immutable after
(`provider-layer:47-58`):

```text
executionMode        = experiment-strict
runIdentity          = <§2 identity, supplied by the C0 runner>
requestedProvider    = step-plan === actualProvider
requestedModel       = step-3.7-flash === actualModel
fallbackUsed         = false
```

Failure semantics:

- Strict preparation fails with `PROVIDER_BINDING_FAILURE` when the requested
  provider or model is unavailable; it does not continue with DeepSeek
  (`provider-layer:60-62`). `PROVIDER_BINDING_FAILURE` is terminal (§8).
- No fallback path exists in the C0 runner. The runner must be implemented so
  the permissive pre-call fallback used by development smoke commands
  (`provider-layer:72-73`) is unreachable from the C0 entry point, and so that
  provider failure after the first model call aborts the run rather than
  switching providers (`provider-layer:36-39`).
- Precondition recorded by the provider layer and inherited here: the Step
  model endpoint and account entitlement must be verified before the live
  experiment; local provider registration alone does not prove remote model
  availability (`provider-layer:18-22`).
- A live Step Plan experiment requires a separate authorization and a new run
  identity (`provider-layer:114-115`). This draft is that contract; it grants
  nothing until authorized.

## 4. Corpus manifest — E1–E4

The corpus is NEW. It does not reuse CR-005 C5/C6 records: the rebaseline
requires "a new corpus designed around lifecycle transitions, not silently
reuse old C5/C6" (`rebaseline:180-183`), and the authorization boundary keeps
"Reopen CR-005 C5/C6 as a continuation — Not allowed; requires a new
experiment design" (`rebaseline:231`).

Mechanics shared by all four scenarios:

- Trace vocabulary is the thirteen normalized `TraceEventKind`s
  (`packages/context-runtime/tests/fixtures/policy-lifecycle/types.ts:20-33`);
  planning inputs are the provider-neutral semantic fields of
  `ContextPlanningRequest`
  (`packages/context-runtime/src/planning/planning-request.ts:60-83`).
- In B1 semantics, lifecycle events additionally inject
  `SourceLifecycleSignal`s — `SOURCE_RULED_OUT→RULED_OUT`,
  `SOURCE_SUPERSEDED→SUPERSEDED`, `FAILURE_OBSERVED→NEW_FAILURE_EVIDENCE`,
  `PHASE_CHANGED→PHASE_IRRELEVANT`, `DETAIL_REQUESTED→DETAIL_REQUIRED`
  (mapping at `runner.ts:75-86`, injection at `runner.ts:359-372`).
- The live canary drives the same normalized event shapes from real adapter
  observations; the frozen synthetic fixtures S1/S2/S6/S4 remain the oracle
  reference. Expected chains below are consistent with the frozen oracles:
  S1 (`distractor-elimination.ts:27-58`), S2
  (`wrong-path-recovery.ts:47-69`), S6 (`phase-shift.ts:61-79`), S4
  (`superseded-evidence.ts:33-51`).
- Source keys follow the synthetic Universe vocabulary
  (`common.ts:13-23`); the live corpus uses the repo-scoped equivalents.
- Every scenario below ends with the evidence-contract invariants already
  enforced deterministically (`runner.ts:224-324`): no unexplained decision,
  no protected-source removal, REHYDRATE bound to an originating REMOVE and
  later-need evidence, exact SourceVersion, no UNAVAILABLE→SOURCE_ABSENT
  conversion.

### 4.1 E1 — Distractor Elimination

Lifecycle intent (`rebaseline:185`; `p032:315-327`): several plausible
sources are investigated; one becomes clearly ruled out while the true target
remains active.

Trace shape (fixture skeleton `distractor-elimination.ts:8-26`):

```text
INITIALIZE_UNIVERSE
PLANNING_BOUNDARY   currentTarget=[target] recentEvidence=[distractorA, distractorB]
SOURCE_RULED_OUT    distractorA + evidenceRef   (B1: RULED_OUT lifecycle signal)
PLANNING_BOUNDARY
```

Expected planner decision chain (oracle `distractor-elimination.ts:27-58`):

```text
ADD target, distractorA, distractorB
REMOVE distractorA / RULED_OUT
final active set: task, target, distractorB
forbidden active:   distractorA
```

Primary evidence: the `REMOVE / RULED_OUT` decision record with reason code
and from/to working-set hashes; mandatory/pinned eviction count = 0; no
later-need evidence for `distractorA` expected in the nominal chain — if any
fires, it feeds §5 directly.

### 4.2 E2 — Wrong Path Recovery

Lifecycle intent (`rebaseline:186`; `p032:329-341`): source `A` is
investigated and removed as ruled out; a later failure or dependency points
back to `A`.

Trace shape (fixture skeleton `wrong-path-recovery.ts:8-46`):

```text
INITIALIZE_UNIVERSE
PLANNING_BOUNDARY   currentTarget=[reopenA]
SOURCE_RULED_OUT    reopenA + evidenceRef          (B1: RULED_OUT signal)
PLANNING_BOUNDARY
FAILURE_OBSERVED    reopenA + evidenceRef          (later-need evidence; B1: NEW_FAILURE_EVIDENCE signal)
DETAIL_REQUESTED    reopenA + evidenceRef          (later-need; un-exclude; FULL need)
PLANNING_BOUNDARY
```

Expected planner decision chain (oracle `wrong-path-recovery.ts:47-69`):

```text
ADD reopenA
REMOVE reopenA / RULED_OUT
later-need evidence: FAILURE_OBSERVED then DETAIL_REQUESTED
REHYDRATE reopenA / {NEW_FAILURE_EVIDENCE | DETAIL_REQUIRED}, representationKind = FULL
final active set: task, reopenA
```

Primary evidence: the REHYDRATE record's `originatingRemoveTransitionId` and
`laterNeedEvidenceRef` binding (`runner.ts:453-460`; a missing
`laterNeedEvidenceRef` is an evidence-contract failure at
`runner.ts:278-281`); exact SourceVersion restored; the §5 horizon pair for
`reopenA`.

### 4.3 E3 — Phase Shift

Lifecycle intent (`rebaseline:187`; `p032:343-354`): investigation requires
detailed logs and test output; implementation no longer needs all of that
detail; verification later requires a subset again.

Trace shape (fixture skeleton `phase-shift.ts:8-59`). Phase change arrives as
both a synthetic `taskPhase` hint and a trace event, per the Gate A Q3
answer (`gate-a:100-128`):

```text
INITIALIZE_UNIVERSE
PLANNING_BOUNDARY   taskPhase=INVESTIGATE currentTarget=[phaseDetail] need=FULL
PHASE_CHANGED        phaseDetail  patch: taskPhase=IMPLEMENT, exclude, narrow to REFERENCE
                     (B1: PHASE_IRRELEVANT lifecycle signal)
PLANNING_BOUNDARY
DETAIL_REQUESTED     phaseDetail + evidenceRef  patch: taskPhase=VERIFY, need=FULL
PLANNING_BOUNDARY
```

Expected planner decision chain (oracle `phase-shift.ts:61-79`):

```text
ADD phaseDetail / FULL
REMOVE phaseDetail / PHASE_IRRELEVANT
later-need evidence: DETAIL_REQUESTED
REHYDRATE phaseDetail / DETAIL_REQUIRED, representationKind = FULL
final active set: task, phaseDetail
```

Primary evidence: phase-signal provenance (both hint and event carried into
the request, hashed into plan identity — `planning-request.ts:63`,
`planning-request.ts:147`); exact SourceVersion and representation restored
at REHYDRATE; the §5 horizon pair for `phaseDetail`.

### 4.4 E4 — Superseded Evidence

Lifecycle intent (`rebaseline:188`; `p032:356-366`): an old failure is
repaired and a new failure replaces it.

Trace shape (fixture skeleton `superseded-evidence.ts:8-31`):

```text
INITIALIZE_UNIVERSE
PLANNING_BOUNDARY   recentEvidence=[oldFailure]
FAILURE_OBSERVED     newFailure + evidenceRef  patch: exclude oldFailure, recentEvidence=[newFailure]
SOURCE_SUPERSEDED    oldFailure + evidenceRef  (B1: SUPERSEDED signal)
PLANNING_BOUNDARY
```

Expected planner decision chain (oracle `superseded-evidence.ts:33-51`):

```text
ADD oldFailure
ADD newFailure / NEW_FAILURE_EVIDENCE
REMOVE oldFailure / SUPERSEDED          (same planning boundary as the ADD)
final active set: task, newFailure
forbidden active:   oldFailure
```

Primary evidence: provenance for both failure sources remains auditable after
the REMOVE (`p032:366`); reason-code coverage on both active-set changes;
no later-need evidence expected for `oldFailure` in the nominal chain.

## 5. False-removal horizon — Gate A Q1 resolution

Gate A deferred the horizon to this contract explicitly: "no horizon —
model-call distance, transition count or both — is selected... The horizon
choice is bound by the CSPV-C0 run contract against real traces"
(`gate-a:65-70`). This contract fixes it.

For every (REMOVE → later-need) pair, the runner records BOTH quantities:

```text
modelCallDistance  number of provider model calls between the REMOVE decision
                   and the later-need evidence event
transitionCount    number of Working Set transitions between the REMOVE decision
                   and the later-need evidence event
```

Classification:

```text
later-need within (modelCallDistance <= 3) OR (transitionCount <= 5)
  -> HIGH_PRIORITY false-removal candidate

later-need beyond both bounds (modelCallDistance > 3 AND transitionCount > 5)
  -> LOW_PRIORITY observational
```

Contract-fixed constants:

| Constant | Value |
| --- | --- |
| `HORIZON_MODEL_CALL_DISTANCE` | `3` |
| `HORIZON_TRANSITION_COUNT` | `5` |

These constants are fixed by this contract before any run. They are tunable
only by contract amendment before execution begins; never mid-run, never by
the runner, never by the evaluator.

Sequence substrate — already recorded, no schema change required
(`gate-a:41-68`):

- `RemovalRecord.removedAtSequence`
  (`packages/context-runtime/src/planning/planning-request.ts:87-92`, field
  at line 90) is stamped by the runner with the trace-event sequence
  (`runner.ts:473`).
- Every later-need event is stamped with the same counter as
  `LaterNeedEvidence.sequence` (`types.ts:102-107`; capture at
  `runner.ts:389-402`).
- Gate A verified that this substrate keeps all three horizon options
  computable without schema change (`gate-a:65-68`); the live runner derives
  model-call distance from the provider-call ledger (§7) and transition count
  from the transition records.
- Each classified pair is recorded in the `FalseRemovalCandidate` shape
  (conceptual definition `p032:152-168`, including `callDistanceWhileCold`
  at `p032:166`). A candidate is a candidate, not a causal claim: the live
  canary must report candidate counts and examples, never causal task
  failures (`p032:170-184`, `p032:400`).

## 6. READ_AFTER_REMOVE binding — Gate A Q2 follow-up

The deterministic suite recognizes later-need evidence as exactly five
normalized kinds (`NEED_EVIDENCE_EVENTS`,
`packages/context-runtime/tests/fixtures/policy-lifecycle/runner.ts:27-33`;
vocabulary `types.ts:20-33`):

```text
DEPENDENCY_DISCOVERED
FAILURE_OBSERVED
DETAIL_REQUESTED
SEARCH_HIT_AFTER_REMOVE
READ_AFTER_REMOVE
```

The frozen scenarios exercise only `FAILURE_OBSERVED` and `DETAIL_REQUESTED`
(`gate-a:81-88`); `SEARCH_HIT_AFTER_REMOVE` and `READ_AFTER_REMOVE` are
declared kinds emitted by no frozen scenario (`types.ts:32-33`;
`gate-a:89-90`), and mapping them to real adapter events "is a C0 input"
(`gate-a:94-98`).

This contract requires: before the run starts, both unfired kinds must be
mapped to concrete adapter events in Appendix A. A kind with no completed
mapping row at runner review is not emitted by the live canary; the run must
not improvise a mapping mid-run. Appendix A is part of this contract and is
filled at runner review, before execution.

## 7. Budgets

Four separate budgets, all hard-fail. Exceeding ANY budget is a terminal
stop (§8): the run halts, evidence is preserved, and no retry occurs under
the same run identity.

| Budget | Limit | Notes |
| --- | --- | --- |
| Scenario runs | max `4` completed scenario runs — one per E-scenario (E1–E4) | no repeats, no extra scenarios |
| Provider calls | max `12` model calls total (~`3` per scenario) | counted at the outbound transport seam, wrapping `globalThis.fetch` only after explicit opt-in (CR-011 precedent, `cr-011:58-60`) |
| Token / cost | `<= 2.00 USD equivalent` — `PLACEHOLDER, REQUIRES LEAD CONFIRMATION` | internal token estimates are not provider token/cost measurements (`p032:403`); ceiling applies to provider-reported usage |
| Wall clock | `60` minutes | measured from strict preparation (binding) to final scenario completion |

Separation requirement (`gate-b:76-77`): the scenario-run budget and the
provider-call budget are independent ledgers. Completing fewer than 4
scenarios within 12 calls is a budget-constrained outcome, not permission to
overspend calls; exhausting calls before scenario completion trips the
provider-call budget terminally.

## 8. Stop policy — fail closed at every gate

Fail closed at every gate (`gate-b:76-77`). Each condition below is terminal:
the run halts immediately, all evidence captured so far is preserved, the
condition is recorded in the run manifest, and the run identity is never
reused.

| ID | Stop condition | Detection |
| --- | --- | --- |
| S-1 | Provider binding failure | `PROVIDER_BINDING_FAILURE` at strict preparation (`provider-layer:60-62`); also any provider failure after the first model call (`provider-layer:36-39`) |
| S-2 | Schema / validation failure of any observation | observation fails normalization or Universe admission validation before planning |
| S-3 | Replay mismatch > 0 | re-executed digest comparison against the recorded transition chain (deterministic double-run mechanic, `runner.ts:558-574`) |
| S-4 | Mandatory / pinned eviction > 0 | any REMOVE of a protected source (`runner.ts:254-259`; `p032:190-198`) |
| S-5 | Unexplained materialization failure | materialization failure without bounded fail-closed evidence (`p032:273-275`; gate criteria `p032:426`) |
| S-6 | Unexplained decision > 0 | any active-set change without machine-readable reason codes (`p032:291`, `p032:308`; check at `runner.ts:244-248`) |
| S-7 | Budget breach | any of the four §7 budgets exceeded |
| S-8 | Kill-switch invoked by operator | operator halts the run; treated identically to an automatic terminal stop |

There is no degradation path: no retry, no provider switch, no mid-run
corpus edit, no mid-run constant change (§5), and no continuation under the
same identity.

## 9. Evidence plan

Captured per run:

| Evidence | Content | Mechanism |
| --- | --- | --- |
| Observation JSONL | every normalized observation and trace event, in sequence | context-runtime sinks (`packages/context-runtime/src/sink/jsonl-sink.ts`) |
| Working-set transitions | `LifecycleTransitionRecord` fields: decision kind, source/version/representation IDs, reason codes, originating REMOVE and later-need refs, from/to working-set hashes, transition hash (`types.ts:83-100`) | planner output records |
| Admission / decision records | every active-set change with reason codes; `FalseRemovalCandidate` records per §5 | planner + runner |
| Provider binding | `providerConfigHash`, requested/actual provider/model, `fallbackUsed=false`, run identity — no credential | `safeProviderSelection` record (`provider-layer:44-45`, `provider-layer:66-70`) |
| Run manifest | run identity, ISO timestamps, corpus manifest hash, this contract's identity/hash, §7 budget ledgers, §8 stop conditions fired, per-scenario verdicts | C0 runner |

Storage location — reports directory pattern, following the CR-005
research-only boundary (`cr-005-task:598-614`):

```text
research/context-benchmarks/reports/cspv-c0/<run-identity>/
  observations.jsonl
  transitions.jsonl
  decisions.jsonl
  binding.json
  manifest.json
```

Live traces are not blindly committed (`cr-005-task:619`). Credentials,
provider payloads and provider responses are never recorded into the
repository (`cr-011:113-114`; `provider-layer:8-10`).

Evidence evaluation: a new module under `packages/context-runtime/src`
(perhaps `evaluation/`), provider calls `0`. It runs post-run, offline, and
computes per-scenario verdicts deterministically against this contract's §4
expected chains and §5 horizon constants. The evaluator must not modify the
frozen fixtures or frozen oracle — the separation precedent is B1: frozen
fixtures plus frozen oracle, evaluated with zero provider calls
(`gate-b:14-17`). Its verdicts are inputs to a future Gate C adjudication;
this contract performs no adjudication.

## 10. Out of scope / unchanged

- No model-facing rewrite. Shadow remains observational-only: the planner
  emits `mode: 'SHADOW'`
  (`packages/context-runtime/src/planning/policy-v0.ts:455`); the model's
  actual input is never replaced (`p032:135-137`; `rebaseline:191-194`).
- No Native/Shadow quality claim. Native/Shadow call-count deltas are
  secondary (`rebaseline:191-194`); Phase 1 evidence is not evidence of
  quality, cost or efficiency improvement (`rebaseline:107-109`,
  `rebaseline:123-127`); a single canary supports no generalization or
  statistical claim (`p032:404`).
- No Wave A resume. Run 1 and Run 2 remain terminal, preserved, never
  resumable (`rebaseline:226`; `closure:189-190`).
- No CR-004 enablement. CR-004 stays `NO_GO` (`rebaseline:230`;
  `gate-b:10`); Gate D is a separate Lead decision beyond Gate C, and Gates
  A–C passing does not automatically enable Active Rewrite
  (`rebaseline:199-217`; `p032:438-441`).
- Experiment-plan milestone item 5 remains waived for v0.3 closure with the
  value hypothesis `NOT ESTABLISHED` (`closure:150-183`). This contract does
  not reopen it: the only route to a real Dynamic rewrite experiment is
  Gate C → Gate D → CR-004, each a separate authorization
  (`closure:159-166`). A completed C0 alone cannot close item 5.
- No changes to Planner semantics, frozen fixtures, frozen oracle, manifests,
  Wave A identity gate, or Product MVP v0.2 contracts. The C0 runner and
  evaluator are new, separately reviewed code changes on a separate
  branch/PR (`p032:454-456`).

## Appendix A — adapter event → normalized kind mapping (placeholder)

Required before run start (§6). To be completed at runner review; empty rows
mean the kind is not emitted by this run.

| Adapter event (concrete, named) | Normalized kind | Notes |
| --- | --- | --- |
| `TBD` | `SEARCH_HIT_AFTER_REMOVE` | declared, unfired in frozen corpus (`types.ts:32`; `gate-a:89-90`) |
| `TBD` | `READ_AFTER_REMOVE` | declared, unfired in frozen corpus (`types.ts:33`; `gate-a:89-90`) |
| `TBD` | `DEPENDENCY_DISCOVERED` | declared + in `NEED_EVIDENCE_EVENTS` (`runner.ts:27-33`); unfired in frozen corpus |
| `TBD` | `FAILURE_OBSERVED` | exercised by frozen S2/S4 (`gate-a:81-88`) |
| `TBD` | `DETAIL_REQUESTED` | exercised by frozen S2/S6/composite (`gate-a:81-88`) |

Fill rule: every row must name a concrete adapter event emitted by a named
adapter (Pi/OpenCode/Codex) at a verified seam. "TBD" at execution time
blocks the run under §6.
