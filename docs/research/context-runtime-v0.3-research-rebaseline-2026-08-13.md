# Context Runtime v0.3 Research Rebaseline — 2026-08-13

> Current status index: [`Context Runtime 当前状态索引`](./context-runtime-current-state.zh-CN.md)。本文保留当时的 Phase 1/2 rebaseline；历史状态与旧授权标签不构成当前执行授权。

- **Status:** FROZEN FOR REVIEW — documentation-only research rebaseline
- **Provider execution:** `NO_GO` / `0` calls authorized by this document
- **Active rewrite:** `NO_GO`
- **Wave B:** `NO_GO`
- **Wave A Run 3:** `NO_GO`
- **Baseline:** `main@45664c0969af085c4643cd79c203b6dcdc6e6afe`
- **Related design:** [`PROPOSAL-031`](../architecture/decisions/PROPOSAL-031-context-working-set-planner.md)
- **Next policy proposal:** [`PROPOSAL-032`](../architecture/decisions/PROPOSAL-032-context-eviction-rehydration-policy-experiment.md)

This record is a current-state overlay for the original v0.3 experiment plan. It
does not erase or rewrite historical execution evidence, and it does not
authorize a new provider run.

## 1. Decision summary

The first v0.3 evidence phase is closed for this phase:

```text
Phase 1 — Observability, Shadow Infrastructure & Benchmark Evidence

CR-001–CR-003:
  CLOSED FOR THIS PHASE

CR-005 Shadow evidence line:
  COMPLETE_AS_STOPPED_EXPERIMENT

CR-004 Active Rewrite:
  NOT EXECUTED / NO_GO
```

The historical order matters: CR-001 through CR-003 established the
observability and Shadow infrastructure, the project then deliberately
bypassed CR-004 Active Rewrite, and CR-005 produced the bounded Shadow
benchmark evidence. CR-004 was never executed or validated.

The next phase is not “finish the missing Wave A categories” and is not an
automatic move to the next numbered CR. It is a separately scoped research
question:

```text
Phase 2 — Context Selection Policy Validation
REMOVE / false-removal / REHYDRATE
NEXT
```

Only after Phase 2 produces auditable policy evidence should the project
reconsider:

```text
Phase 3 — CR-004 Active Rewrite
NO_GO until a separate readiness review
```

Cross-model, second-harness and Codex compatibility work remain later work,
not the next step.

## 2. Frozen research state

| Area | Frozen state | Interpretation boundary |
| --- | --- | --- |
| CR-005 Wave A | `COMPLETE_AS_STOPPED_EXPERIMENT` | Useful bounded evidence; not a complete ten-record matrix |
| Run 1 | `TERMINAL / PRESERVED / NEVER RESUME` | Historical C2 stop and CR-005A fail-closed evidence |
| Run 2 | `TERMINAL / PRESERVED / NEVER RESUME` | C2/C3 paired evidence plus genuine C4 Native task failure |
| C1 | Bounded Native/Shadow canary evidence | Different baseline; not pooled as the same controlled run |
| C2/C3 | Paired evidence; Shadow `USABLE_WITH_CAVEAT` | Dirty-world / last-known-version semantics; replay and materialization checks passed |
| C4 | Native `TASK_FAILURE` | Objective oracle passed but frozen writable scope was violated |
| C5/C6 | `NOT EXECUTED / NO LIVE EVIDENCE` | No evidence for REMOVE, read-after-remove or REHYDRATE |
| Wave B | `NO_GO` | No inherited authorization from Wave A |
| CR-004 Active Rewrite | `NO_GO` | Observational Shadow evidence is not Active input substitution |
| New provider execution | `NO_GO` | This rebaseline and the next design gates are credential-free |

The accepted evidence chain is:

- [`CR-005 Run 2 C4 stop`](../verification/context-runtime-cr-005-wave-a-run-2-c4-stop.md)
- [`CR-005 Run 2 Shadow adjudication`](../verification/context-runtime-cr-005-wave-a-run-2-shadow-adjudication.md)
- [`CR-005 Run 2 synthesis`](../verification/context-runtime-cr-005-wave-a-run-2-synthesis.md)
- [`CR-005 interim analysis`](../verification/context-runtime-cr-005-interim-evidence-analysis.md)

## 3. What Phase 1 established

The completed phase provides evidence that the project can:

```text
observe model calls
    ↓
identify and reconcile Context Sources
    ↓
maintain a Context Universe
    ↓
compute an observational Shadow Working Set
    ↓
record KEEP / ADD decisions with provenance
    ↓
preserve version, materialization and replay evidence
    ↓
run a benchmark with progressive fail-closed gates
```

Run 2 additionally established that a functional objective pass does not
override a frozen task-contract failure: C4 Native changed
`src/cli/normalize.js`, which was outside the allowed writable scope. The
progressive gate stopped before C4 Shadow and C5/C6, preserving both the
failure attribution and the provider budget boundary.

These results are infrastructure and measurement evidence. They are not
evidence that Dynamic context selection improves task quality, provider cost,
or model efficiency.

## 4. What Phase 1 did not establish

The accepted Shadow traces contain `ADD` and `KEEP`, but no live evidence of:

```text
REMOVE
REHYDRATE
read-after-remove
search-after-remove
false-removal candidates
```

The current CR-005 Shadow mode is observational-only: model-facing Pi
messages remain identity-equal and unchanged. Therefore the Native/Shadow
call and wall-clock differences in the interim analysis are descriptive
observations, not causal evidence about context selection. They cannot answer
whether Active context management would help or hurt the Agent.

Consequently, C5/C6 are not “two unfinished Wave A questions” to resume. They
are missing evidence for a new lifecycle-policy experiment and must receive a
new design, run identity and authorization if executed.

## 5. Phase 2 — Context Selection Policy Validation

The Phase 2 objective is narrow:

> Determine whether a deterministic Context Working Set policy can make
> auditable REMOVE and REHYDRATE decisions while preserving mandatory context,
> exact SourceVersion provenance, replayability and safe recovery.

Phase 2 has four gates.

### Gate A — Policy specification

Produce and review [`PROPOSAL-032`](../architecture/decisions/PROPOSAL-032-context-eviction-rehydration-policy-experiment.md).
It must freeze the semantics of:

- active-set eviction versus durable source deletion;
- `REMOVE` triggers and reason codes;
- first-class `REHYDRATE` triggers;
- `False Removal Candidate` as an auditable observation, not an automatic causal claim;
- mandatory/pinned protection;
- `ABSENT` versus `UNAVAILABLE` handling;
- exact SourceVersion and representation provenance;
- transition replay and evidence requirements.

Gate A is documentation-only and provider-free.

### Gate B — Deterministic transition suite

Use synthetic Context Universes and hand-authored Agent traces to force one
replayable transition chain through:

```text
ADD → KEEP → REMOVE → REHYDRATE
```

The suite must cover distractor elimination, wrong-path recovery, mandatory
instruction protection, superseded evidence, unavailable-source conservative
handling and budget-pressure cooling. Its acceptance criteria are defined in
the [deterministic transition-suite task package](context-selection-policy-validation-deterministic-transition-suite.md).

This package defines the fixtures, traces, oracles and stop conditions. It
does not modify Planner code or run a provider. Any later implementation of
the suite remains credential-free but requires its own bounded code change and
verification review.

### Gate C — Bounded Shadow lifecycle canary

Only after Gates A and B pass should the project consider a new Shadow live
experiment. It must use a new corpus designed around lifecycle transitions,
not silently reuse old C5/C6:

```text
E1 — Distractor Elimination
E2 — Wrong Path Recovery
E3 — Phase Shift
E4 — Superseded Evidence
```

The first live canary should prioritize planner decisions, reason coverage,
provenance, replay, materialization and rehydration behavior. Native/Shadow
call-count deltas are secondary because Shadow still does not replace the
model's actual input.

Gate C requires a separate Lead decision and separate provider/cost
authorization. This rebaseline grants neither.

### Gate D — CR-004 readiness review

CR-004 may be reconsidered only if the Phase 2 evidence demonstrates, at
minimum:

```text
REMOVE observed in representative traces
REHYDRATE observed after prior REMOVE
false-removal candidates measurable and auditable
mandatory/pinned eviction = 0
exact SourceVersion rehydration
deterministic replay
no unexplained materialization failure
reason-code coverage = 100% for active-set changes
```

This is a readiness gate, not an automatic authorization. Protocol continuity,
kill-switch behavior and Active capability boundaries still require separate
review.

## 6. Authorization boundary

| Action | Current decision |
| --- | --- |
| Edit research/architecture documents for Gates A–B | Allowed; provider-free |
| Add or run synthetic deterministic traces | Design is in scope; any code implementation must remain provider-free and separately reviewed |
| Run DeepSeek or another provider | `NO_GO` |
| Resume Wave A Run 1 or Run 2 | Forbidden; terminal checkpoints are preserved and never resumable |
| Start Wave A Run 3 | `NO_GO` |
| Start Wave B | `NO_GO` |
| Modify manifest, frozen fixtures or evaluator for a live run | Not authorized |
| Implement or send CR-004 Active rewritten context | `NO_GO` |
| Reopen CR-005 C5/C6 as a continuation | Not allowed; requires a new experiment design |

## 7. Repository change policy for this rebaseline

This task package is documentation-only. It must not change:

- `packages/context-runtime` Planner behavior;
- Pi/OpenCode/Codex adapters;
- benchmark runner, manifest or checkpoint state machine;
- frozen fixtures or evaluators;
- Product MVP v0.2 contracts;
- provider credentials, live-output artifacts or execution permissions.

The old experiment plan remains useful as a historical definition of the
CR-001–CR-008 work packages. Its current-status overlay points to the current
state index above so the historical `ACTIVE`/`awaiting review` labels are not
mistaken for the current project state.

## 8. Exit condition for this phase of planning

This rebaseline task is complete when:

1. this document is reviewed as the current research-state overlay;
2. PROPOSAL-032 defines the policy experiment without implementation
   authorization;
3. the deterministic suite task package has explicit scenarios, oracles and
   stop conditions;
4. no provider call, Active rewrite, Wave B run or Wave A continuation occurs.

The next decision after this documentation package is a bounded Lead review,
not a provider authorization.
