# CSPV-C1 Live Authorization Gate — 2026-09-02

Status: `DRAFT / ZERO PROVIDER / LIVE NO_GO`

This document prepares the final authorization decision for the C1
comparative-effectiveness study. It is not itself a Provider authorization,
does not claim that the C1 live runner exists, and does not permit a live leg.

## Decision boundary

The following upstream artifacts are frozen:

| Artifact                      | Frozen binding                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C1_PROTOCOL_V1`              | [`docs/plan/cspv-c1-comparative-effectiveness-protocol-2026-09-01.md`](./cspv-c1-comparative-effectiveness-protocol-2026-09-01.md)                         |
| `C1_A_MANIFEST_V1`            | [`research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json`](../../research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json)             |
| `C1_RUN_CONTRACT_V1`          | [`research/context-benchmarks/c1/contracts/c1-run-contract-v1.json`](../../research/context-benchmarks/c1/contracts/c1-run-contract-v1.json)               |
| `C1-C_TREATMENT_READINESS_V1` | [`research/context-benchmarks/c1/readiness/c1-treatment-readiness-v1.json`](../../research/context-benchmarks/c1/readiness/c1-treatment-readiness-v1.json) |

The verified post-PR #89 baseline is:

```text
main / baseline:              02c3076889a75dd60c85964e28ecf58fc4813d51
C1-C treatment implementation: 5dc3c3abb37383cd679f39712e2c316d89efdeab
C1-C evidence freeze:          587299e29f800b240fa5fda7f788b3b7ca7bd9c9
```

The readiness artifact binds:

```text
contract SHA-256:        1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4
assignment matrix:      630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7
task manifest:          2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
provider calls in C1-C: 0
```

## Current gate result

| Gate                             | Current result   | Meaning                                                                                                                                  |
| -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Exact `main` baseline            | `PASS`           | Remote `main` is `02c3076`; post-merge CI is green.                                                                                      |
| Protocol / corpus / run contract | `FROZEN`         | The C1 design, four-task manifest, 32-pair feasibility contract, and hashes are fixed.                                                   |
| C1-C treatment readiness         | `PASS / FROZEN`  | Native fidelity, active Runtime composition, T4 cold/restored provider-bound proof, fail-closed probes, and zero-provider replay passed. |
| Provider profile                 | `CONTRACT-READY` | Step Plan `step-3.7-flash` and endpoint are frozen; this is not an execution check.                                                      |
| C1 64-leg executor               | `NOT_READY`      | No C1-specific live entrypoint currently executes the frozen Native/Runtime assignment matrix.                                           |
| Durable C1 evidence writer       | `NOT_READY`      | C0 persistence code is a precedent, not proof that C1's required artifacts are emitted and joined.                                       |
| C1 hard budget enforcement       | `NOT_READY`      | The contract is frozen, but its 24/96/600-second per-leg and 64-leg study ledgers are not yet wired to a C1 runner.                      |
| C1 operator kill-switch wiring   | `NOT_READY`      | C0 has a tested implementation; C1 has no runner lifecycle that owns it.                                                                 |
| C1 live authorization            | `NO_GO`          | The missing executor/evidence gates must be closed by a separate zero-provider implementation review.                                    |

## Why existing live code is not admissible for C1

`research/context-benchmarks/src/live-runner.ts` is the CR-005 runner. It
loads the CR-005 manifest namespace, uses CR-005 `NATIVE`/`SHADOW` records,
and contains DeepSeek-specific credential preparation. It does not implement
the C1 `NATIVE`/`RUNTIME` arms, C1 pair identity, C1 assignment matrix, C1
provider-bound treatment checks, or C1 analysis/evidence schema.

The CLI exposes `c1-readiness`, which is credential-free, but it does not
expose a C1 live command. Reusing the CR-005 runner would silently change the
frozen experiment and would not satisfy the C1 treatment contract. No C1 live
call is authorized by this gate.

## Frozen live binding to be used after readiness closure

The final authorization record must bind all of these values before the first
Provider call:

```text
Provider:       step-plan
Model:          step-3.7-flash
Endpoint:       https://api.stepfun.com/step_plan/v1/chat/completions
Credential:     STEP_PLAN_API_KEY, memory-only, never persisted
Execution mode: experiment-strict
Fallback:       NONE
Node:           >=24.0.0 <25.0.0
Concurrency:    1
```

Strict preparation must use the existing provider layer with a new study/run
identity. The actual provider and model returned by preparation must equal the
requested binding; a fallback, rebinding, or model mismatch is terminal before
the first call. The provider configuration hash may be recorded, but the key,
authorization header, raw request, raw response, prompt, and assistant text
must not enter durable evidence or child-tool environments.

The final authorization must additionally name:

```text
live main SHA                 exact clean checkout used by every leg
treatment implementation SHA  exact Runtime implementation under test
readiness evidence SHA        evidence freeze that validated that treatment
studyId                       fresh, single-use identity
assignmentMatrixSha256        630d2f6a...
contractSha256                1c82e095...
taskManifestSha256            2bfcad11...
```

The frozen C1-B contract remains unchanged. Its `executionBinding.codeRevision`
placeholder is resolved by the final live binding, not by editing the frozen
contract after the fact.

## Required zero-provider implementation gates

Before an owner can authorize C1 live, a separate implementation task must
prove all of the following without a Provider call:

### 1. Exact study and assignment binding

- Load only the frozen C1 manifest and run contract from their explicit C1
  paths; never use CR-005 discovery.
- Verify all three contract/manifest hashes and the C1-C readiness binding.
- Materialize exactly 32 matched pairs: 8 per stratum, 32 Native legs and 32
  Runtime legs, for 64 total legs.
- Verify the frozen assignment matrix before the first possible provider call:
  4 `NATIVE_THEN_RUNTIME` and 4 `RUNTIME_THEN_NATIVE` pairs per stratum,
  16 of each order globally.
- Reject a missing, extra, reordered, duplicated, reused, or mutated leg.

### 2. Treatment isolation

- `NATIVE` sends the unchanged model-facing semantic context with metadata-only
  observation.
- `RUNTIME` sends the materialized Working Set through the reviewed Active
  composition seam and proves the provider-bound semantic context differs when
  the frozen task makes a lifecycle change eligible.
- System/developer/tool/provider-native structures, fixture, evaluator,
  budgets, and model parameters are identical across arms.
- A Runtime composition, materialization, binding, or safety failure never
  falls back to Native.

### 3. Identity and durable evidence

- Claim a fresh study and fresh per-leg identity atomically before the first
  Provider call; an existing identity is rejected and never overwritten.
- Never resume, retry-until-success, share filesystem state across arms, or
  change Provider/model/fixture/manifest after the first call.
- Emit the frozen metadata-only artifact set:

  ```text
  run_manifest
  provider_usage_ledger
  transition_evidence
  decision_evidence
  tool_latency_evidence
  outcome_evidence
  replay_evidence
  ```

- Make these stable keys joinable for every eligible model call:
  `studyId`, `runId`, `taskId`, `stratum`, `pairId`, `arm`, `turnId`, and
  `modelCallId`.
- Attempt final artifacts independently. Any evidence-write failure is a hard
  infrastructure failure and must preserve the terminal identity.

### 4. Usage and budget enforcement

The following are hard operational limits, not estimates:

| Scope       | Provider calls | Tool calls |    Wall clock |
| ----------- | -------------: | ---------: | ------------: |
| Each leg    |             24 |         96 |    600,000 ms |
| Whole study |          1,536 |      6,144 | 43,200,000 ms |

Provider calls must be counted at the outbound provider transport seam.
Assistant message count is not a call substitute. Provider-reported usage is
recorded at the `message_end` seam; missing usage is not replaced by a local
estimate. Cost remains `UNAVAILABLE` unless separately reported by the
Provider and is not silently inferred from configured pricing.

Any budget breach is terminal: preserve evidence, do not resume, and do not
start the next leg. The runner must also prove that the study wall-clock
includes the frozen orchestration allowance and that an in-flight deadline
cannot be bypassed by a hung prompt or abort channel.

### 5. Kill-switch and cleanup

- `SIGINT` and `SIGTERM` enter the same terminal path before bounded session
  abort; the first signal is latched and repeated signals do not create a
  second run decision.
- Transport is blocked immediately after terminal state.
- Active session, observers, transport hooks, and temporary fixtures are
  disposed in an exception-safe finalization path.
- `SIGKILL` is not claimed as catchable evidence; an externally killed process
  cannot promise finalization.

### 6. Credential-free adversarial coverage

The C1 runner readiness suite must inject and catch, without network access:

```text
provider/model mismatch
missing or reused identity
assignment or hash mismatch
Native fallback after Runtime failure
materialization/rewrite failure
missing usage or malformed usage
outbound call over budget
tool or wall-clock over budget
replay mismatch
evidence-write failure
operator terminal signal
```

Each injection must prove the correct boundary: no Provider call for
preparation failures, no fallback after Runtime failure, terminal preservation
for hard runtime/evidence failures, and no identity reuse.

## Live execution shape after all gates pass

The authorized study would be a new single-use run, sequentially executing the
already frozen matrix:

```text
preflight and identity claim
    ↓
pair 1 … pair 32, one leg at a time in frozen AB/BA order
    ↓
per-leg evidence validation and join check
    ↓
per-pair validity / outcome recording
    ↓
final coverage, reliability, primary endpoint, and adjudication report
```

Valid task failures are outcome observations and are not retried. They must
remain distinct from infrastructure, harness, usage, replay, safety, budget,
and evidence failures. The study is feasibility-only: no confirmatory claim,
cost-saving claim, or generalization beyond the frozen design is permitted.

The frozen overall decision remains subject to the existing C1 adjudication:
task outcome non-inferiority, Runtime reliability and coverage, the single
primary input-token sign-flip test, protected secondary guards, and the
`BETTER`/`WORSE`/`TRADE_OFF`/`INCONCLUSIVE` matrix. Token reduction alone cannot
produce `BETTER`.

## Final authorization template

This block is intentionally incomplete until the separate implementation gate
and owner decision are complete:

```text
CSPV-C1 Live Authorization
Decision:                 NO_GO / AUTHORIZED
Authorization owner:      <named owner>
Execution main SHA:       <exact clean main SHA>
Treatment revision:       <exact reviewed implementation SHA>
Readiness evidence SHA:   <exact C1-C evidence freeze SHA>
Study identity:           <fresh c1 study identity>
Provider/model:           step-plan / step-3.7-flash
Endpoint:                 https://api.stepfun.com/step_plan/v1/chat/completions
Credential:               STEP_PLAN_API_KEY / memory-only
Fallback:                 NONE
Node range:               >=24.0.0 <25.0.0
Scope:                    32 matched pairs / 64 legs / maxConcurrency=1
Budgets:                  24/96/600000 per leg; 1536/6144/43200000 study
Assignment hash:          630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7
Contract hash:            1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4
Task manifest hash:       2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
Fallback/rebind:          FORBIDDEN
Resume/retry:             FORBIDDEN
Wave B:                   NO_GO
CR-004:                   NO_GO
```

## Current decision

```text
C0-L1                         CLOSED
C1_PROTOCOL_V1                FROZEN
C1_A_MANIFEST_V1              FROZEN
C1_RUN_CONTRACT_V1            FROZEN
C1-C treatment readiness      ACCEPTED / FROZEN

C1 live runner                NOT_READY
C1 Live authorization         NO_GO
Provider execution            NO_GO
Wave B                        NO_GO
CR-004                        NO_GO
```

The next authorized work package is a zero-provider C1 live-runner and
preflight implementation review. It must close the gates above without
changing the frozen protocol, manifest, run contract, or C1-C treatment
behavior. Only after that review may the owner issue a separate live
authorization decision.
