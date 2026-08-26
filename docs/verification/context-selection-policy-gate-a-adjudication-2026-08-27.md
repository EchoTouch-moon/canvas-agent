# Context Selection Policy — Gate A adjudication

- **Decision:** `PASS`
- **Adjudication:** Lead review completed 2026-08-27
- **Current integration baseline:** `branch glm/project-review-2026-08-27 @ 8b7d1c6b31ae6bb174afb2567dca4c5c603b6034` (main plus four engineering-fix commits: context-runtime jsonl-sink durability, worker-runtime worktree cleanup, persistence guards, repo hygiene)
- **Proposal:** [PROPOSAL-032 — Context Eviction / Rehydration Policy Experiment](../architecture/decisions/PROPOSAL-032-context-eviction-rehydration-policy-experiment.md)
- **Deterministic evidence:** [CSPV-B1 Run 1](./context-selection-policy-gate-b1-run-1.md), [Gate B adjudication](./context-selection-policy-gate-b-adjudication.md)
- **Provider calls during this review:** `0`
- **CSPV-C0:** `DEFERRED` → superseded same-day: `REVIVED FOR GATE C PREPARATION` (see [closure decisions supersession](./context-runtime-v0.3-closure-decisions-2026-08-27.md)); live execution still not authorized
- **CR-004 Active Rewrite:** `NO_GO`
- **PROPOSAL-032 status:** `PROPOSED` → `ACCEPTED-WITH-PROVISIONAL-ANSWERS`

## Decision basis

Gate A (PROPOSAL-032 §11, lines 408–411) requires stable semantics and a
deterministic suite that names its fixtures and oracles. Both hold as-built:

- Seven frozen scenarios are named and exported: S1–S6 plus the composite chain
  (`packages/context-runtime/tests/fixtures/policy-lifecycle/index.ts:1-7`).
- The frozen scenario oracle is a named contract
  (`packages/context-runtime/tests/fixtures/policy-lifecycle/types.ts:67-74`),
  backed by five frozen mutation classes
  (`packages/context-runtime/tests/fixtures/policy-lifecycle/oracle.ts:88-176`,
  asserted at `packages/context-runtime/tests/policy-lifecycle.test.ts:62-69`).
- Gate B is already adjudicated `PASS` on B1 evidence (policy version
  `policy-v0-gate-b1-source-lifecycle-signals`,
  `packages/context-runtime/tests/fixtures/policy-lifecycle/types.ts:17`; suite
  classification `PASS` with zero provider calls,
  `packages/context-runtime/tests/policy-lifecycle-b1.test.ts:25-40`).

The deterministic suite has already instantiated frozen-oracle-locked answers
for the three §13 open questions. This adjudication accepts those
instantiations as the provisional contract answers. They are provisional: a
live canary (CSPV-C0) must revisit them against real traces before any becomes
a stable Runtime contract answer (PROPOSAL-032 §13, lines 467–468). One of the
three (Q1) is not answered by code and is deferred to the C0 run contract
rather than invented here.

## §13 open questions — as-built answers

### Q1 — false-removal horizon: deferred to the CSPV-C0 contract

The as-built code does not choose a horizon.

- The only temporal field on a prior removal is
  `RemovalRecord.removedAtSequence`
  (`packages/context-runtime/src/planning/planning-request.ts:87-92`, field at
  line 90).
- The deterministic runner stamps it with the trace-event sequence
  (`packages/context-runtime/tests/fixtures/policy-lifecycle/runner.ts:473`)
  and stamps later-need evidence with the same counter
  (`LaterNeedEvidence.sequence`,
  `packages/context-runtime/tests/fixtures/policy-lifecycle/types.ts:102-107`;
  capture at `runner.ts:389-402`).
- No threshold, priority tier or candidate adjudication exists anywhere in
  `packages/context-runtime`: the §5 conceptual fields `callDistanceWhileCold`
  and `adjudication: CANDIDATE | CONFIRMED_AFTER_AUDIT | NOT_CONFIRMED`
  (PROPOSAL-032 §5, lines 166–167; metric listed at §10 line 386) have no code
  counterpart.
- The only linkage implemented is the latest later-need evidence per source
  bound to a `REHYDRATE` record via `laterNeedEvidenceRef`
  (`runner.ts:441`, `runner.ts:457-460`), enforced by the evidence contract
  (`runner.ts:278-281`).

Provisional disposition: no horizon — model-call distance, transition count or
both — is selected. The event-sequence substrate stamps both the removal and
every later-need event, so any of the three options remains computable without
schema change. The horizon choice is bound by the CSPV-C0 run contract against
real traces. Gate A accepts this deferral explicitly; it does not silently
resolve Q1.

### Q2 — `READ_AFTER_REMOVE` evidence: five normalized trace-event kinds, two frozen-oracle-locked

- The suite recognizes later-need evidence as exactly five normalized event
  kinds (`NEED_EVIDENCE_EVENTS`): `DEPENDENCY_DISCOVERED`, `FAILURE_OBSERVED`,
  `DETAIL_REQUESTED`, `SEARCH_HIT_AFTER_REMOVE`, `READ_AFTER_REMOVE`
  (`runner.ts:27-33`; vocabulary declared at `types.ts:20-33`).
- Every `REHYDRATE` must bind later-need evidence: a missing
  `laterNeedEvidenceRef` is an evidence-contract failure
  (`runner.ts:278-281`; binding at `runner.ts:457-460`).
- The frozen scenarios exercise only `FAILURE_OBSERVED` and
  `DETAIL_REQUESTED`: S2
  (`packages/context-runtime/tests/fixtures/policy-lifecycle/wrong-path-recovery.ts:20-26`
  and `:27-44`), S6
  (`packages/context-runtime/tests/fixtures/policy-lifecycle/phase-shift.ts:40-58`)
  and the composite chain
  (`packages/context-runtime/tests/fixtures/policy-lifecycle/composite-trace.ts:39-45`
  and `:46-63`).
- `SEARCH_HIT_AFTER_REMOVE` and `READ_AFTER_REMOVE` are declared kinds
  (`types.ts:32-33`) emitted by no frozen scenario.
- The suite plans in `SHADOW` mode (`packages/context-runtime/src/planning/policy-v0.ts:455`),
  so the model-facing context is never rewritten — matching Q2's premise.

Provisional answer: in Shadow mode the deterministic suite satisfies
`READ_AFTER_REMOVE` with the five-kind set at `runner.ts:27-33`; the frozen
oracle locks `FAILURE_OBSERVED` and `DETAIL_REQUESTED` as the exercised types.
The two dedicated post-removal kinds remain declared-but-unfired; mapping them
to real adapter events is a C0 input.

### Q3 — E3 phase changes: both synthetic `taskPhase` hint and trace event

- S6 supplies the phase change as a `PHASE_CHANGED` trace event carrying
  `taskPhase: "IMPLEMENT"` in its request patch
  (`phase-shift.ts:21-38`, hint at `:27`); the verification re-entry is a
  `DETAIL_REQUESTED` event carrying `taskPhase: "VERIFY"`
  (`phase-shift.ts:40-58`, hint at `:47`).
- The runner applies the patch's `taskPhase` to planning state
  (`runner.ts:55`) and forwards it into the request (`runner.ts:107`);
  `taskPhase` is a first-class request field
  (`packages/context-runtime/src/planning/planning-request.ts:63`), typed by
  `TASK_PHASES` (`planning-request.ts:5-13`) and hashed into plan identity
  (`planning-request.ts:147`).
- In B1 mode the `PHASE_CHANGED` event additionally emits a `PHASE_IRRELEVANT`
  `SourceLifecycleSignal` (mapping at `runner.ts:82-83`; injection at
  `runner.ts:359-372`), which reaches the `REMOVE` decision through the
  lifecycle-reason path
  (`packages/context-runtime/src/planning/policy-v0.ts:216-240` with
  `policy-v0.ts:77-85`).
- The frozen oracle locks `REMOVE`/`PHASE_IRRELEVANT` and
  `REHYDRATE`/`DETAIL_REQUIRED`/`FULL` (`phase-shift.ts:62-75`); the B1 test
  asserts `PHASE_IRRELEVANT` on the `REMOVE`
  (`packages/context-runtime/tests/policy-lifecycle-b1.test.ts:74-76`).

Caveat: `policy-v0` carries and hashes `taskPhase` but does not branch on it;
the phase-derived reason code arrives via the lifecycle signal plus the
exclusion and representation-need patches. The as-built choice is therefore
"both": a synthetic `taskPhase` hint transported by trace events, with the
trace event also generating the lifecycle signal.

## Boundary

- This adjudication authorizes no provider execution. Provider calls during
  this review: `0`.
- CSPV-C0 remains `NOT AUTHORIZED`. Gate C still requires a separately
  reviewed run contract (corpus, manifest, model profile, evidence budget,
  stop policy) per PROPOSAL-032 §11, lines 432–436. That contract must fix the
  Q1 horizon against real traces.
- The disposition of C0 is recorded separately in
  [context-runtime-v0.3-closure-decisions-2026-08-27.md](./context-runtime-v0.3-closure-decisions-2026-08-27.md),
  which records `CSPV-C0: DEFERRED` at this baseline. This adjudication
  resolves the Gate A precondition that document listed as open.
- PROPOSAL-032 status moves from `PROPOSED` to
  `ACCEPTED-WITH-PROVISIONAL-ANSWERS` with this document. The Q1 deferral is
  carried explicitly by that status; the Q2 and Q3 answers stand only as
  provisional contract answers until CSPV-C0 revisits them.
- Gate D (CR-004 Active Rewrite) remains a separate Lead decision; nothing
  here enables it.
- No Planner code, fixture, oracle or model-facing contract is modified by
  this adjudication.
