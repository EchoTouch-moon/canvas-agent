# CSPV-C1 Live Authorization Record — Final 2026-09-05

Status: `AUTHORIZED / C1 LIVE GO`

Execution mode: `LIVE / EXPERIMENT-STRICT`

This record is the owner authorization for one frozen CSPV-C1 feasibility study. It authorizes real Provider execution only for the exact checkout, study identity, provider binding, assignment, budgets, evidence policy, and terminal rules recorded below. It does not authorize Wave B or CR-004.

Preparing and committing this authorization record caused zero Provider/network calls and did not read or persist `STEP_PLAN_API_KEY`.

## Frozen decision boundary

The following artifacts remain frozen and are not reopened by this authorization:

| Artifact | Binding |
| --- | --- |
| `C1_PROTOCOL_V1` | `docs/plan/cspv-c1-comparative-effectiveness-protocol-2026-09-01.md` |
| `C1_A_MANIFEST_V1` | `research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json` |
| `C1_RUN_CONTRACT_V1` | `research/context-benchmarks/c1/contracts/c1-run-contract-v1.json` |
| `C1-C_TREATMENT_READINESS_V1` | `research/context-benchmarks/c1/readiness/c1-treatment-readiness-v1.json` |
| C1 live authorization design | `docs/plan/cspv-c1-live-authorization-gate-2026-09-02.md` |

No protocol, manifest, randomization, treatment, run-contract, or metric semantics are changed here.

## Exact execution provenance

```text
Execution main SHA:                  93fdb08ebf034860ab298e40770044e1aa4c67e6
PR #96 study-orchestration head:    8b092ff9c8796e34c26aa234ecd478429faf9ad0
PR #96 CI run:                       33942003541 (check=SUCCESS, macos-electron=SUCCESS)
C1-C treatment revision:            5dc3c3abb37383cd679f39712e2c316d89efdeab
C1-C evidence freeze revision:      587299e29f800b240fa5fda7f788b3b7ca7bd9c9
C1 live preflight revision:         ee970a6080dd02b194687621267e21c92cd129bb
C1 live binding revision:           fc1a968bfcf7c1fed97390c35bc9b2f15af1244e
Authorized-provider adapter:        736349498a5ef887d67e066ca7bde5476c8723c6
```

Every live leg must execute from a clean checkout whose `HEAD` is exactly `93fdb08ebf034860ab298e40770044e1aa4c67e6`. No component branch, dirty worktree, rebased variant, patched copy, or unreviewed successor revision is authorized.

## Frozen semantic hashes

```text
Contract SHA-256:                  1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4
Assignment matrix SHA-256:         630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7
Task manifest SHA-256:             2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
C1-C readiness artifact SHA-256:   0978d638c6585db785d51f87bda2d9c4a7f8950043e6c823a446832eaf33b730
```

A mismatch in any of these bindings is terminal before the first Provider request.

## Provider binding

```text
Provider:       step-plan
Model:          step-3.7-flash
Endpoint:       https://api.stepfun.com/step_plan/v1/chat/completions
Credential:     STEP_PLAN_API_KEY
Credential use: memory-only
Execution mode: experiment-strict
Fallback:       NONE
Node range:     >=24.0.0 <25.0.0
Concurrency:    1
```

The runtime must fail closed before the first request if `STEP_PLAN_API_KEY` is absent or if provider/model/endpoint/configuration differs from the frozen binding. The credential, Authorization header, raw provider payloads, raw prompts, assistant text, and raw tool arguments/results must not enter durable evidence.

## Authorized study identity

The following identity is reserved for this authorization and is single-use:

```text
Study identity: c1-20260905-c1-feasibility-v1-35359a74
```

The live runner must claim exactly this identity on a fresh output root before the first Provider call. If the identity or any associated leg/checkpoint/report path already exists, the study must fail closed. Reuse, resume, overwrite, retry-until-success, or substitution with a different study identity is forbidden without a new owner authorization record.

## Frozen study scope

```text
Design:             C1_FEASIBILITY_V1
Strata:             4
Pairs per stratum:  8
Matched pairs:      32
Native legs:        32
Runtime legs:       32
Total legs:         64
Max concurrency:    1
Order quota:        16 NATIVE_THEN_RUNTIME / 16 RUNTIME_THEN_NATIVE
```

The exact assignment matrix must be loaded from the frozen C1 contract and verified against SHA-256 `630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7` before execution.

## Hard budgets and terminal policy

| Scope | Provider calls | Tool calls | Wall clock |
| --- | ---: | ---: | ---: |
| Each leg | 24 | 96 | 600,000 ms |
| Whole study | 1,536 | 6,144 | 43,200,000 ms |

All budgets are hard limits. Tool-call batches must be reserved before side effects. Live wall-clock uses the real clock. A budget breach, evidence-write failure, binding failure, replay/materialization failure, kill-switch event, or other hard infrastructure failure must:

```text
TERMINAL_PRESERVE_EVIDENCE_NO_RESUME_NO_NEXT_LEG
```

Specifically:

```text
failure
  → preserve already durable evidence
  → abort active Provider transport when applicable
  → cleanup the active fixture sandbox
  → latch study terminal
  → forbid resume
  → forbid the next leg
```

A valid task failure is an outcome, not permission to retry until success.

## Evidence contract

The study must produce the frozen seven-artifact set:

```text
provider-usage-ledger.jsonl
transition-evidence.jsonl
decision-evidence.jsonl
tool-latency-evidence.jsonl
outcome-evidence.jsonl
replay-evidence.jsonl
run-manifest.json
```

Evidence remains metadata-only. Stable join keys are:

```text
studyId / taskId / stratum / pairId / arm / runId / callOrdinal / turnId / modelCallId
```

Provider usage must be Provider-reported; no local estimate may substitute for missing live usage. Live tool latency is `NOT_INSTRUMENTED` unless an actual latency value is collected.

## Final authorization checklist

| Gate | Final status |
| --- | --- |
| Exact clean execution revision | `PASS` — `main@93fdb08e...` |
| Required remote CI | `PASS` — run `33942003541`, `check` + `macos-electron` successful |
| Frozen contract/assignment/manifest/readiness hashes | `PASS` |
| 64-leg frozen matrix orchestration | `PASS` |
| Shared `C1LiveBindingDriver` across study | `PASS` |
| Fresh fixture tree/content validation per leg | `PASS` |
| Writable-scope validation and cleanup-before-complete | `PASS` |
| Native/Runtime treatment binding | `PASS` |
| Authorized Provider adapter | `PASS` |
| Provider → Tool → Observation → Provider loop | `PASS` |
| Atomic tool budget before side effects | `PASS` |
| Real live per-leg wall-clock enforcement | `PASS` |
| Cumulative study wall-clock terminal behavior | `PASS` |
| Seven metadata-only study artifacts | `PASS` |
| Study-level terminal / no-next-leg behavior | `PASS` |
| SIGINT/SIGTERM next-leg protection | `PASS` |
| Study → Driver → Transport → in-flight Provider abort | `PASS` |
| Credential persistence boundary | `PASS BY CONTRACT / RUNTIME FAIL-CLOSED` |
| Fresh single-use study identity | `BOUND` — `c1-20260905-c1-feasibility-v1-35359a74` |
| Owner decision | `AUTHORIZED` |

## Owner authorization

```text
CSPV-C1 Live Authorization
Decision:                         AUTHORIZED / C1 LIVE GO
Authorization owner:              EchoTouch-moon
Authorization timestamp (UTC):    2026-09-05T03:39:41Z
Execution main SHA:               93fdb08ebf034860ab298e40770044e1aa4c67e6
Study orchestrator revision:      8b092ff9c8796e34c26aa234ecd478429faf9ad0
C1-C treatment revision:          5dc3c3abb37383cd679f39712e2c316d89efdeab
C1-C evidence freeze revision:    587299e29f800b240fa5fda7f788b3b7ca7bd9c9
Live binding revision:            fc1a968bfcf7c1fed97390c35bc9b2f15af1244e
Provider adapter revision:        736349498a5ef887d67e066ca7bde5476c8723c6
Study identity:                   c1-20260905-c1-feasibility-v1-35359a74
Provider/model:                   step-plan / step-3.7-flash
Endpoint:                         https://api.stepfun.com/step_plan/v1/chat/completions
Credential:                       STEP_PLAN_API_KEY / memory-only
Fallback:                         NONE
Node range:                       >=24.0.0 <25.0.0
Scope:                            32 matched pairs / 64 legs / concurrency 1
Budgets:                          24/96/600000 per leg; 1536/6144/43200000 study
Assignment matrix SHA-256:        630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7
Contract SHA-256:                 1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4
Task manifest SHA-256:            2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
Resume/retry:                     FORBIDDEN
Fallback/rebind:                  FORBIDDEN
Wave B:                           NO_GO
CR-004:                           NO_GO
```

## Authorization effect

`C1 LIVE = GO` means the first real Provider request is now permitted only when the runner verifies all bindings above and successfully claims the authorized single-use study identity. Any mismatch automatically revokes execution permission for that run and results in `NO_GO / TERMINAL` without substituting another identity or revision.

This authorization does not itself execute the study and caused zero Provider/network calls.

## Project state after authorization

```text
C0-L1                         CLOSED
C1_PROTOCOL_V1                FROZEN
C1_A_MANIFEST_V1              FROZEN
C1_RUN_CONTRACT_V1            FROZEN
C1-C treatment readiness      ACCEPTED / FROZEN
C1 live binding               ACCEPTED / MERGED
C1 Authorized Provider        ACCEPTED / MERGED
C1 study orchestration        ACCEPTED / MERGED
C1 Live authorization         GO / AUTHORIZED
Provider execution            GO FOR AUTHORIZED C1 STUDY ONLY
Wave B                        NO_GO
CR-004                        NO_GO
Provider calls while issuing authorization: 0
```
