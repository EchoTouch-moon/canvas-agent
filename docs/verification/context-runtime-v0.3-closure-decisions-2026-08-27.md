# Context Runtime v0.3 Closure Decisions — 2026-08-27

- **Decision:** `CLOSURE APPROVED` — four closure decisions recorded below
- **Adjudication:** Lead review completed
- **Current integration baseline:** `glm/project-review-2026-08-27 @ 8b7d1c6b31ae6bb174afb2567dca4c5c603b6034`
- **Provider calls:** `0`
- **CSPV-C0:** `DEFERRED`
- **CR-012B:** `DEFERRED`
- **CR-013:** `CANCELLED / FOLDED`
- **Milestone item 5:** `WAIVED FOR V0.3 CLOSURE`

## Purpose

These four decisions let Context Runtime v0.3 reach a final conclusion
without further provider execution. They close the remaining open work items
using evidence already accepted at this baseline. The per-item milestone
verdicts live in the
[final synthesis](./context-runtime-v0.3-final-synthesis-2026-08-27.md).

Citation keys used below:

- `gate-b` — [`context-selection-policy-gate-b-adjudication.md`](./context-selection-policy-gate-b-adjudication.md)
- `rebaseline` — [`context-runtime-v0.3-research-rebaseline-2026-08-13.md`](../research/context-runtime-v0.3-research-rebaseline-2026-08-13.md)
- `experiment-plan` — [`context-runtime-v0.3-experiment-plan.md`](../plan/context-runtime-v0.3-experiment-plan.md)
- `cr-009` — [`context-runtime-cr-009-core-state-machine-2026-08-14.zh-CN.md`](./context-runtime-cr-009-core-state-machine-2026-08-14.zh-CN.md)
- `cr-010` — [`context-runtime-cr-010-model-visible-request-parity.md`](./context-runtime-cr-010-model-visible-request-parity.md)
- `cr-011` — [`context-runtime-cr-011-real-provider-parity-smoke.md`](./context-runtime-cr-011-real-provider-parity-smoke.md)
- `cr-012a` — [`context-runtime-cr-012a-codex-context-conformance.md`](./context-runtime-cr-012a-codex-context-conformance.md)
- `provider-layer` — [`model-provider-layer.md`](../architecture/model-provider-layer.md)

## Decision 1 — CSPV-C0 bounded Shadow lifecycle canary

```text
Verdict: CSPV-C0 DEFERRED — not authorized in v0.3; full revival path preserved
```

Reasons:

- Provider execution remains `NO_GO` under the current authorization
  envelope: the rebaseline authorization boundary keeps every provider run,
  Wave A Run 3, Wave B and CR-004 at `NO_GO` (rebaseline:219-231); the Step
  Plan provider option remains `CANDIDATE` with `Provider calls: 0` and
  `Live experiment: NO_GO` (rebaseline:280-287); the Gate B adjudication
  states that no provider execution is authorized by that document
  (gate-b:74-78) and records `CSPV-C0: NOT AUTHORIZED` (gate-b:9).
- Phase 1 live evidence stopped without supporting the quality hypothesis:
  the Shadow evidence line is `COMPLETE_AS_STOPPED_EXPERIMENT`
  (rebaseline:26-27), and the accepted results "are not evidence that
  Dynamic context selection improves task quality, provider cost, or model
  efficiency" (rebaseline:107-109). Because Shadow mode is observational-only,
  its Native/Shadow deltas are descriptive observations, not causal evidence
  (rebaseline:123-127). The marginal value of new Shadow lifecycle evidence
  does not justify the cost envelope now.
- Gate D / CR-004 would still require a further authorization beyond C0:
  Gate D is "a readiness gate, not an automatic authorization" and protocol
  continuity, kill-switch behavior and Active capability boundaries still
  require separate review (rebaseline:199-217); CR-004 remains `NO_GO`
  (rebaseline:230; gate-b:10). C0 alone therefore cannot close
  experiment-plan milestone item 5.
- Gate A has now been adjudicated `PASS` on this branch
  ([gate-a-adjudication-2026-08-27.md](./context-selection-policy-gate-a-adjudication-2026-08-27.md)),
  which removes the sequencing precondition recorded at gate-b:69-72. The
  deferral above does not rest on that precondition: it rests on the
  authorization envelope and marginal-value grounds. The Gate A adjudication
  additionally defers the concrete false-removal horizon to the future C0 run
  contract, so that contract remains a mandatory reviewed artifact before any
  revival.

### Revival path (preserved in full)

The C0 run-contract requirements, verbatim from the Gate B adjudication
(gate-b:74-78):

> Before CSPV-C0 can be authorized, Gate A must be adjudicated and a separate
> C0 run contract must be reviewed. That contract must bind a new run identity,
> use Step Plan only with no fallback, separate scenario-run and provider-call
> budgets, and fail closed at every gate. No provider execution is authorized
> by this document.

The strict-binding infrastructure a future C0 would use is already merged and
waiting (provider-layer):

- `executionMode = experiment-strict` with a run identity supplied by the C0
  runner; `requestedProvider === actualProvider`,
  `requestedModel === actualModel`, `fallbackUsed === false`, binding
  metadata immutable after preparation (provider-layer:47-58).
- Strict preparation fails with `PROVIDER_BINDING_FAILURE` and does not
  continue with DeepSeek; one-binding-per-run and no rebinding after
  execution starts belong to the C0 runner (provider-layer:60-66).
- `providerConfigHash` distinguishes runs that share provider/model labels
  but differ in endpoint or runtime profile (provider-layer:66-70).
- The bounded strict smoke additionally requires
  `CANVAS_PROVIDER_EXECUTION_MODE=experiment-strict` and a fresh
  `CANVAS_PROVIDER_RUN_ID` (provider-layer:107-110).

Revival requires a new Lead authorization plus a new run identity
(provider-layer:114-115; rebaseline:289-291).

## Decision 2 — CR-012B real Codex CLI smoke

```text
Verdict: CR-012B DEFERRED — first candidate if a future authenticated window opens
```

Reasons:

- CR-012B requires authenticated Codex execution — the same authorization
  envelope that remains `NO_GO`. CR-012A proved only the fake-Codex stdin
  boundary: "No real Codex CLI, provider SDK, or network transport is
  involved" (cr-012a:79-81), and its known limitation states the phase "does
  not execute a real Codex turn" (cr-012a:174-176). Provider execution stays
  `NO_GO` under the rebaseline boundary (rebaseline:219-231).
- Acceptance criteria were never written: the CR-012A Deferred block names
  `CR-012B real Codex CLI smoke / authenticated execution` with no criteria
  (cr-012a:188-193).
- CR-012B is recorded here as the first candidate to execute if a future
  authenticated window opens, ahead of any newly scoped work item.

## Decision 3 — CR-013 cross-harness evidence and observability model

```text
Verdict: CR-013 CANCELLED / FOLDED — substance already delivered by verified artifacts
```

Reasons:

- Cross-harness evidence is already delivered by CR-012A: the same frozen
  `CommittedWorkingSet` is consumed by the existing Pi integration and by a
  Codex CLI bridge without changing the Context Runtime core contract
  (cr-012a:9-12); gates G1–G4 all `PASS`, including G4 parity for both the
  Codex and Pi observed contexts against the shared canonical context
  (cr-012a:89-94), with `providerCalls = 0` and `networkCalls = 0` on the
  fake Codex path (cr-012a:112-119).
- The observability model is already delivered by existing verified
  artifacts: CR-009 verified the provider-neutral core loop
  `UniverseRevision → ProposedWorkingSet → AdmissionReceipt →
  CommittedWorkingSet → WorkingSetTransition → replay` with status
  `CORE_STATE_MACHINE_VERIFIED / ADAPTER_DEFERRED` and `0` provider calls
  (cr-009:5-13, 39); CR-010 delivered model-visible request parity through
  `before_provider_request` capture, reconstruction and canonical comparison
  with `providerCalls = 0` (cr-010:5-7, 9-23, 194-196); CR-011 extended the
  same parity chain across one real DeepSeek request with `parity = PASS`
  (cr-011:3-5, 84-98).
- A separate CR-013 work item would duplicate these verified artifacts. It is
  cancelled and its substance folded into them. Any later extension stays
  outside the frozen evidence, per the CR-011 follow-up discipline that
  additional model/API shapes be proposed as later follow-ups rather than
  folded into frozen evidence (cr-011:141-148).

## Decision 4 — Milestone item 5 waiver (experiment-plan §8)

```text
Verdict: item 5 WAIVED FOR V0.3 CLOSURE — value hypothesis NOT ESTABLISHED
```

Milestone item 5 requires "at least one real Dynamic rewrite experiment"
(experiment-plan:703). Reasons for the waiver:

- The only route to a real Dynamic rewrite experiment is
  Gate C → Gate D → CR-004 Active canary (rebaseline:178-217).
- Both gates require live authorizations that remain `NO_GO`: Gate C requires
  "a separate Lead decision and separate provider/cost authorization" and the
  rebaseline grants neither (rebaseline:196-197); Gate D is a readiness gate
  with further separate review beyond it (rebaseline:199-217); the
  authorization boundary keeps provider execution and CR-004 at `NO_GO`
  (rebaseline:219-231).
- Phase 1 evidence did not justify incurring that envelope: it is
  infrastructure and measurement evidence, "not evidence that Dynamic context
  selection improves task quality, provider cost, or model efficiency"
  (rebaseline:107-109), and the observational Shadow deltas are descriptive,
  not causal (rebaseline:123-127).
- Therefore the Lead waives item 5 for v0.3 closure and records that the
  value hypothesis — Dynamic context selection improves reliability and
  efficiency — remains `NOT ESTABLISHED`. This is an honest negative, not a
  pass.

Scope of the waiver:

- Item 5 has no documented-reason escape clause in the plan text, unlike
  items 8 and 9 (experiment-plan:703 vs 706-707). The waiver is therefore
  recorded as a Lead decision in this document, not as an edit to the plan.
- This waiver does not amend the plan text. The
  [final synthesis](./context-runtime-v0.3-final-synthesis-2026-08-27.md)
  carries the per-item verdicts.

## Boundary

- No provider execution is authorized by this document.
- No terminal checkpoint is resumed: Wave A Run 1 and Run 2 remain
  `TERMINAL / PRESERVED / NEVER RESUME` (rebaseline:64-65, 226).
- No plan-text amendment: experiment-plan §8 stands unchanged
  (experiment-plan:695-711).
