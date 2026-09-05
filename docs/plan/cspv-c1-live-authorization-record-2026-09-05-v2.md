# CSPV-C1 Live Authorization Record V2 — 2026-09-05

Status: `DRAFT / ZERO PROVIDER / PENDING OWNER AUTHORIZATION`

Decision: `NO_GO UNTIL EXPLICIT OWNER SIGN-OFF`

This is a proposed successor authorization record after the first C1 live
attempt was terminally closed and the usage-contract amendment was frozen.
It does not itself authorize a Provider call, claim a study identity, or
create a live report directory. Drafting and validating this record caused
zero Provider/network calls and did not read or persist `STEP_PLAN_API_KEY`.

## 1. Historical boundary

The first authorization and study identity remain immutable historical
evidence:

```text
Attempt:              C1 LIVE ATTEMPT #1
Study identity:       c1-20260905-c1-feasibility-v1-35359a74
Identity status:      CONSUMED / RETIRED
Execution revision:   93fdb08ebf034860ab298e40770044e1aa4c67e6
Provider attempts:    1
Completed legs:       0
Classification:       PROVIDER_USAGE_CAPABILITY_MISMATCH
Effectiveness data:   NOT_ADMISSIBLE
Resume/reuse/rebind:  FORBIDDEN
```

This record does not resume, reuse, overwrite, or reinterpret that attempt.
The successor study must use a new identity and the amended effective usage
contract.

## 2. Frozen decision boundary

The following artifacts are inherited without modification:

| Artifact | Binding |
| --- | --- |
| `C1_PROTOCOL_V1` | [`docs/plan/cspv-c1-comparative-effectiveness-protocol-2026-09-01.md`](./cspv-c1-comparative-effectiveness-protocol-2026-09-01.md) |
| `C1_A_MANIFEST_V1` | [`research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json`](../../research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json) |
| `C1_RUN_CONTRACT_V1` | [`research/context-benchmarks/c1/contracts/c1-run-contract-v1.json`](../../research/context-benchmarks/c1/contracts/c1-run-contract-v1.json) |
| `C1_USAGE_CONTRACT_AMENDMENT_V1` | [`docs/plan/cspv-c1-usage-contract-amendment-2026-09-05.md`](./cspv-c1-usage-contract-amendment-2026-09-05.md) |
| `C1-C_TREATMENT_READINESS_V1` | [`research/context-benchmarks/c1/readiness/c1-treatment-readiness-v1.json`](../../research/context-benchmarks/c1/readiness/c1-treatment-readiness-v1.json) |
| C1 live authorization gate | [`docs/plan/cspv-c1-live-authorization-gate-2026-09-02.md`](./cspv-c1-live-authorization-gate-2026-09-02.md) |
| Zero-provider closure | [`docs/verification/cspv-c1-zero-provider-evidence-closure-2026-09-05.md`](../verification/cspv-c1-zero-provider-evidence-closure-2026-09-05.md) |

The amendment supersedes only the cache-split availability semantics:

```text
C1_RUN_CONTRACT_V1.providerUsage.cacheReadTokens
C1_RUN_CONTRACT_V1.providerUsage.cacheWriteTokens
```

All task, fixture, assignment, treatment, primary endpoint, statistical,
budget, evidence, and terminal clauses remain unchanged.

## 3. Exact execution provenance

The proposed execution checkout is the exact post-closure `main` revision.
The eventual authorization-record merge commit is documentation provenance
and must not silently replace this execution revision.

```text
Execution main SHA:                    816c13c15ef8247ec9f27c981e025283be4e366b
main CI run:                          33970829132 (check + macos-electron SUCCESS)
C1 zero-provider closure head:         067b64c65d30dbcfdab72b9a146f6abf2fe7de18
C1 study orchestration merge:          93fdb08ebf034860ab298e40770044e1aa4c67e6
C1 live binding implementation:        fc1a968bfcf7c1fed97390c35bc9b2f15af1244e
C1-C treatment implementation:         5dc3c3abb37383cd679f39712e2c316d89efdeab
C1-C evidence freeze:                  587299e29f800b240fa5fda7f788b3b7ca7bd9c9
Authorized-provider adapter revision: 55d834483ba044099e0be8d64b95028becabb014
Usage amendment freeze:                077ab1f76c6de99cb534f7e39df0ce476102a61e
Usage amendment merge:                 08547b044f64fd842fde3634347abfcb96fbe642
```

Every live leg must execute from a clean checkout at the exact authorized
`Execution main SHA`. If `main` changes before owner sign-off, this record
must be regenerated or explicitly re-reviewed; a later documentation merge
does not authorize a successor code revision.

## 4. Effective contract hashes

```text
C1_RUN_CONTRACT_V1 SHA-256:             1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4
C1_USAGE_CONTRACT_AMENDMENT_V1 SHA-256: 6d9d15e5a0acd1acfbf2232fe59e2c9c4ee289e7fd580fc3afe2d0c627ae3740
Effective contract SHA-256:             d67901ce0ee2aee47baa3ea734264135506066826391ec511035d09d716e7cbd
Assignment matrix SHA-256:              630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7
Task manifest SHA-256:                  2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
C1-C readiness artifact SHA-256:        0978d638c6585db785d51f87bda2d9c4a7f8950043e6c823a446832eaf33b730
```

The effective contract is `C1_RUN_CONTRACT_V1 +
C1_USAGE_CONTRACT_AMENDMENT_V1`. The original contract hash remains
unchanged. The amendment changes neither the C1 primary endpoint
(`providerReported.inputTokens`) nor any statistical or assignment rule.

## 5. Provider and runtime binding

```text
Provider:       step-plan
Model:          step-3.7-flash
Endpoint:       https://api.stepfun.com/step_plan/v1/chat/completions
Provider config hash: dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8
Credential:     STEP_PLAN_API_KEY
Credential use: memory-only
Execution mode: experiment-strict
Fallback:       NONE
Node range:     >=24.0.0 <25.0.0
Concurrency:    1
```

Before any first request, the runner must verify the exact provider/model/
endpoint/configuration binding and the amended usage contract. A missing key,
provider mismatch, model mismatch, endpoint mismatch, fallback, or malformed
configuration is terminal before outbound preparation.

Core usage remains required and Provider-reported:

```text
inputTokens   REQUIRED / non-negative integer
outputTokens  REQUIRED / non-negative integer
totalTokens   REQUIRED / non-negative integer
```

Cache split fields use the amended tagged representation:

```text
REPORTED(value) or UNAVAILABLE / NOT_REPORTED_BY_PROVIDER
```

`UNAVAILABLE` is not zero, an estimate, a derived value, or a statement that
the Provider can never report the metric. Cache-dependent endpoints are
`NOT_ESTIMABLE` when a required split is unavailable; the primary input-token
endpoint remains estimable when core usage is complete.

## 6. Proposed fresh study identity

The following value is a proposed, unclaimed identity for the owner to bind
if this record is approved:

```text
Candidate study identity: c1-20260905-c1-feasibility-v1-9f4c2a71
Identity status:          NOT CLAIMED / NOT RESERVED
```

Writing this candidate value does not create a report directory or consume an
identity. On owner authorization, the runner must atomically claim exactly
this identity on a fresh output root before the first Provider call. If the
identity or any associated path already exists, execution must fail closed.

Resume, reuse, overwrite, retry-until-success, and substitution are forbidden.
The retired identity `c1-20260905-c1-feasibility-v1-35359a74` must never be
used for this amended contract.

## 7. Frozen study scope and budgets

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

| Scope | Provider calls | Tool calls | Wall clock |
| --- | ---: | ---: | ---: |
| Each leg | 24 | 96 | 600,000 ms |
| Whole study | 1,536 | 6,144 | 43,200,000 ms |

The whole-study wall-clock ceiling includes the frozen orchestration
allowance. Budgets are hard limits, not estimates.

## 8. Terminal and evidence policy

A budget breach, usage-contract failure, binding mismatch, evidence-write
failure, replay/materialization failure, safety failure, kill-switch event, or
other hard infrastructure failure must execute:

```text
TERMINAL_PRESERVE_EVIDENCE_NO_RESUME_NO_NEXT_LEG
```

The runner must preserve already durable metadata-only evidence, abort active
Provider transport where applicable, clean up the active fixture sandbox, latch
study terminal, and forbid resume and the next leg.

The study must emit the frozen seven artifact families:

```text
provider-usage-ledger.jsonl
transition-evidence.jsonl
decision-evidence.jsonl
tool-latency-evidence.jsonl
outcome-evidence.jsonl
replay-evidence.jsonl
run-manifest.json
```

Durable evidence is metadata-only. Credentials, authorization headers, raw
provider payloads, raw prompts, assistant text, and raw tool arguments/results
must not be persisted.

A valid task failure is an outcome observation and is not a license to retry
until success. Missing core usage remains an infrastructure/evidence failure
for admissibility purposes, while task outcome evidence remains distinct.

## 9. Mandatory pre-call checklist

No Provider call is permitted until every item below is true:

| Gate | Required state |
| --- | --- |
| Exact clean execution checkout | `main@816c13c...` or explicitly re-reviewed replacement |
| Protocol / manifest / run contract | frozen and hash-matched |
| Usage amendment | frozen and effective hash-matched |
| C1-C readiness | frozen and hash-matched |
| Zero-provider closure | merged and CI-green |
| Provider/model/endpoint | exact Step Plan binding |
| Provider configuration hash | `dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8` |
| Node range | `>=24.0.0 <25.0.0` |
| Candidate identity | fresh and atomically claimable |
| Assignment | exact 64-leg matrix, hash verified |
| Fixture isolation | fresh sandbox and pre-leg hash verified |
| Evidence writer | seven artifacts, metadata-only, independently finalized |
| Budget guard | per-leg and study ceilings active |
| Kill switch | SIGINT/SIGTERM terminal and in-flight abort path active |
| Owner authorization | explicit `AUTHORIZED / C1 LIVE GO` record |

This draft satisfies only the zero-provider documentation/binding checks. It
does not satisfy the final owner-authorization row.

## 10. Owner sign-off template

The following block is intentionally not authorized in this draft:

```text
CSPV-C1 Live Authorization
Decision:                         PENDING OWNER SIGN-OFF
Authorization owner:             <owner to sign>
Authorization timestamp (UTC):   <set only at sign-off>
Execution main SHA:              816c13c15ef8247ec9f27c981e025283be4e366b
C1 treatment revision:            5dc3c3abb37383cd679f39712e2c316d89efdeab
C1-C evidence freeze revision:   587299e29f800b240fa5fda7f788b3b7ca7bd9c9
Usage amendment SHA-256:          6d9d15e5a0acd1acfbf2232fe59e2c9c4ee289e7fd580fc3afe2d0c627ae3740
Effective contract SHA-256:       d67901ce0ee2aee47baa3ea734264135506066826391ec511035d09d716e7cbd
Study identity:                   c1-20260905-c1-feasibility-v1-9f4c2a71
Provider/model:                   step-plan / step-3.7-flash
Endpoint:                         https://api.stepfun.com/step_plan/v1/chat/completions
Provider config hash:             dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8
Credential:                       STEP_PLAN_API_KEY / memory-only
Fallback:                         NONE
Node range:                       >=24.0.0 <25.0.0
Scope:                            32 matched pairs / 64 legs / concurrency 1
Budgets:                          24/96/600000 per leg; 1536/6144/43200000 study
Assignment matrix SHA-256:        630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7
C1_RUN_CONTRACT_V1 SHA-256:       1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4
Task manifest SHA-256:             2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
Resume/retry/rebind:              FORBIDDEN
Wave B:                           NO_GO
CR-004:                           NO_GO
```

The owner must not sign this block if the execution revision, effective
contract, identity, or any other binding changes. A changed binding requires a
new record or a bounded re-review.

## 11. Current state

```text
C1_PROTOCOL_V1                       FROZEN
C1_A_MANIFEST_V1                     FROZEN
C1_RUN_CONTRACT_V1                   FROZEN / PRESERVED
C1_USAGE_CONTRACT_AMENDMENT_V1       FROZEN / MERGED
C1-C treatment readiness             FROZEN / PASS
C1 study orchestration               MERGED / ACCEPTED
C1 zero-provider closure             MERGED / CI_GREEN
Old C1 live attempt                  TERMINAL / NOT_ADMISSIBLE
Old study identity                   CONSUMED / RETIRED
New study identity                   NOT_CLAIMED
C1 Live                             NO_GO / PENDING OWNER SIGN-OFF
Provider execution                   NO_GO
Wave B                              NO_GO
CR-004                              NO_GO
Provider calls while drafting       0
```

This record is ready for bounded remote review. It becomes an authorization
only after explicit owner sign-off is recorded in a reviewed successor state.
