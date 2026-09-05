# CSPV-C1 Live Authorization Record V3 — 2026-09-06

Status: DRAFT / ZERO PROVIDER / PENDING OWNER AUTHORIZATION

Decision: NO_GO UNTIL EXPLICIT OWNER SIGN-OFF

This is the successor authorization record for the C1 feasibility study after
the amended usage adapter and the C1 live-study entrypoint were merged. It
does not itself authorize a Provider call, claim a study identity, or create
a live report directory. Drafting, hashing, and validating this record cause
zero Provider/network calls and do not read or persist STEP_PLAN_API_KEY.

V2 is historical provenance only. It is superseded for future execution
because it was bound to an earlier execution revision. Its unclaimed
candidate identity must not be reused.

## 1. Historical boundary

The first authorization and study identity remain immutable historical
evidence:

| Field | Historical value |
| --- | --- |
| Attempt | C1 LIVE ATTEMPT #1 |
| Study identity | c1-20260905-c1-feasibility-v1-35359a74 |
| Identity status | CONSUMED / RETIRED |
| Execution revision | 93fdb08ebf034860ab298e40770044e1aa4c67e6 |
| Provider attempts | 1 |
| Completed legs | 0 |
| Classification | PROVIDER_USAGE_CAPABILITY_MISMATCH |
| Effectiveness data | NOT_ADMISSIBLE |
| Resume/reuse/rebind | FORBIDDEN |

This record does not resume, reuse, overwrite, or reinterpret that attempt.

The V2 record is also preserved as historical documentation:

| V2 field | Historical value |
| --- | --- |
| V2 execution SHA | 816c13c15ef8247ec9f27c981e025283be4e366b |
| V2 candidate identity | c1-20260905-c1-feasibility-v1-9f4c2a71 |
| V2 identity status | NOT CLAIMED / NOT RESERVED |
| V2 future-use status | SUPERSEDED / DO NOT USE |

The V2 candidate is not claimed, but it is permanently retired from future
authorization because it was bound to the superseded execution proposal.

## 2. Frozen decision boundary

The following artifacts are inherited without modification:

| Artifact | Binding |
| --- | --- |
| C1_PROTOCOL_V1 | ./cspv-c1-comparative-effectiveness-protocol-2026-09-01.md |
| C1_A_MANIFEST_V1 | ../../research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json |
| C1_RUN_CONTRACT_V1 | ../../research/context-benchmarks/c1/contracts/c1-run-contract-v1.json |
| C1_USAGE_CONTRACT_AMENDMENT_V1 | ./cspv-c1-usage-contract-amendment-2026-09-05.md |
| C1-C_TREATMENT_READINESS_V1 | ../../research/context-benchmarks/c1/readiness/c1-treatment-readiness-v1.json |
| C1 live authorization gate | ./cspv-c1-live-authorization-gate-2026-09-02.md |
| C1 zero-provider closure | ../verification/cspv-c1-zero-provider-evidence-closure-2026-09-05.md |

The amendment supersedes only the cache-split availability semantics:

    C1_RUN_CONTRACT_V1.providerUsage.cacheReadTokens
    C1_RUN_CONTRACT_V1.providerUsage.cacheWriteTokens

All task, fixture, assignment, treatment, primary endpoint, statistical,
budget, evidence, and terminal clauses remain unchanged.

## 3. Exact execution provenance

The proposed execution checkout is the exact post-merge main revision for
PR #102. The eventual V3 documentation merge commit is documentation
provenance and must not silently replace this execution revision.

| Provenance item | Binding |
| --- | --- |
| Execution main SHA | 4d5e39a9b337d6cabdc84d450680bc54ad85561b |
| Post-merge CI run | 33983852204: check SUCCESS; macos-electron SUCCESS |
| Reviewed live-entrypoint revision | 30f3c84e08479b21f341f6bd908cea03f6627bc8 |
| Integrated PR branch tip | e452199ac1d0effa232e16b11a43cd51a0739031 |
| PR #102 merge commit | 4d5e39a9b337d6cabdc84d450680bc54ad85561b |
| C1 study-orchestration merge | 93fdb08ebf034860ab298e40770044e1aa4c67e6 |
| C1 live-binding implementation | fc1a968bfcf7c1fed97390c35bc9b2f15af1244e |
| C1-C treatment implementation | 5dc3c3abb37383cd679f39712e2c316d89efdeab |
| C1-C evidence freeze | 587299e29f800b240fa5fda7f788b3b7ca7bd9c9 |
| Authorized-provider adapter | 55d834483ba044099e0be8d64b95028becabb014 |
| Usage-amendment freeze | 077ab1f76c6de99cb534f7e39df0ce476102a61e |
| Usage-amendment merge | 08547b044f64fd842fde3634347abfcb96fbe642 |

Every live leg must execute from a clean checkout at the exact authorized
execution main SHA. If main changes before owner sign-off, this record must
be regenerated or explicitly re-reviewed. A later documentation merge does
not authorize a successor code revision.

The distinction between the three PR #102 revisions is intentional:

    30f3c84  reviewed live-entrypoint implementation
    e452199  branch integration tip after syncing main
    4d5e39a  post-merge execution baseline authorized for V3 binding

## 4. Independent hash verification

The following values were independently recomputed from the frozen repository
artifacts on main 4d5e39a. All values matched the previously frozen bindings.

| Binding | SHA-256 | Verification boundary |
| --- | --- | --- |
| C1_RUN_CONTRACT_V1 | 1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4 | Canonical contract JSON with protocolBinding.contractSha256 replaced by SELF |
| C1_USAGE_CONTRACT_AMENDMENT_V1 | 6d9d15e5a0acd1acfbf2232fe59e2c9c4ee289e7fd580fc3afe2d0c627ae3740 | Canonical amendment JSON with both digest fields replaced by SELF |
| Effective contract | d67901ce0ee2aee47baa3ea734264135506066826391ec511035d09d716e7cbd | Canonical effective-contract binding envelope |
| Assignment matrix | 630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7 | Canonical exact randomization.assignmentMatrix array |
| Task manifest | 2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38 | Exact UTF-8 file bytes |
| C1-C readiness artifact | 0978d638c6585db785d51f87bda2d9c4a7f8950043e6c823a446832eaf33b730 | Exact UTF-8 file bytes |
| Provider configuration | dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8 | Canonical frozen Step Plan provider profile, excluding credential |

Canonical JSON uses UTF-8, lexicographic Unicode code-point object-key
ordering at every depth, preserved array order, standard JSON escaping,
ECMAScript numeric serialization, no whitespace, and no trailing newline.
No hash in this record is computed from the future V3 documentation merge
commit.

## 5. Provider and runtime binding

| Binding | Required value |
| --- | --- |
| Provider | step-plan |
| Model | step-3.7-flash |
| Endpoint | https://api.stepfun.com/step_plan/v1/chat/completions |
| Provider configuration hash | dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8 |
| Credential | STEP_PLAN_API_KEY |
| Credential use | MEMORY_ONLY |
| Execution mode | experiment-strict |
| Fallback | NONE |
| Node range | >=24.0.0 <25.0.0 |
| Concurrency | 1 |

Before the first request, the runner must verify the exact provider, model,
endpoint, configuration, effective usage contract, and execution revision.
A missing key, provider mismatch, model mismatch, endpoint mismatch,
configuration mismatch, fallback, or malformed binding is terminal before
outbound preparation.

Core usage remains Provider-reported and required:

    inputTokens   REQUIRED / non-negative integer
    outputTokens  REQUIRED / non-negative integer
    totalTokens   REQUIRED / non-negative integer

Cache split fields use the amended tagged representation:

    REPORTED(value)
    UNAVAILABLE / NOT_REPORTED_BY_PROVIDER

UNAVAILABLE is not zero, an estimate, a derived value, or a statement that
the Provider can never report the metric. Cache-dependent endpoints are
NOT_ESTIMABLE when a required split is unavailable; the primary input-token
endpoint remains estimable when core usage is complete.

## 6. Proposed fresh study identity

The following value is a proposed, unclaimed identity for owner review:

    Candidate study identity: c1-20260906-c1-feasibility-v1-bae9ab90
    Identity status: NOT CLAIMED / NOT RESERVED

Writing this candidate value does not create a report directory, reserve a
path, or consume an identity. On explicit owner authorization, the runner
must atomically claim exactly this identity on a fresh output root before the
first Provider call. If the identity or any associated path already exists,
execution must fail closed.

The retired identity c1-20260905-c1-feasibility-v1-35359a74 and superseded
V2 candidate c1-20260905-c1-feasibility-v1-9f4c2a71 must never be used.

Resume, reuse, overwrite, retry-until-success, and substitution are forbidden.

## 7. Frozen study scope and budgets

    Design:             C1_FEASIBILITY_V1
    Strata:             4
    Pairs per stratum:  8
    Matched pairs:      32
    Native legs:        32
    Runtime legs:       32
    Total legs:         64
    Max concurrency:    1
    Order quota:        16 NATIVE_THEN_RUNTIME / 16 RUNTIME_THEN_NATIVE

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

    TERMINAL_PRESERVE_EVIDENCE_NO_RESUME_NO_NEXT_LEG

The runner must preserve already durable metadata-only evidence, abort active
Provider transport where applicable, clean up the active fixture sandbox, latch
study terminal, and forbid resume and the next leg.

The study must emit the frozen seven artifact families:

    provider-usage-ledger.jsonl
    transition-evidence.jsonl
    decision-evidence.jsonl
    tool-latency-evidence.jsonl
    outcome-evidence.jsonl
    replay-evidence.jsonl
    run-manifest.json

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
| Exact clean execution checkout | main@4d5e39a... |
| PR #102 post-merge CI | run 33983852204, check and macos-electron SUCCESS |
| Protocol / manifest / run contract | frozen and hash-matched |
| Usage amendment | frozen and effective hash-matched |
| C1-C readiness | frozen and hash-matched |
| Zero-provider closure | merged and CI-green |
| Provider/model/endpoint | exact Step Plan binding |
| Provider configuration hash | matched to dbcbff3... |
| Node range | >=24.0.0 <25.0.0 |
| Candidate identity | fresh and atomically claimable |
| Assignment | exact 64-leg matrix, hash verified |
| Fixture isolation | fresh sandbox and pre-leg hash verified |
| Evidence writer | seven artifacts, metadata-only, independently finalized |
| Budget guard | per-leg and study ceilings active |
| Kill switch | SIGINT/SIGTERM terminal and in-flight abort path active |
| Owner authorization | explicit AUTHORIZED / C1 LIVE GO record |

This draft satisfies the zero-provider documentation and binding checks. It
does not satisfy the final owner-authorization row.

## 10. Owner sign-off template

The following block is intentionally not authorized in this draft:

    CSPV-C1 Live Authorization
    Decision:                         PENDING OWNER SIGN-OFF
    Authorization owner:             <owner to sign>
    Authorization timestamp (UTC):   <set only at sign-off>
    Execution main SHA:              4d5e39a9b337d6cabdc84d450680bc54ad85561b
    Reviewed live-entrypoint:        30f3c84e08479b21f341f6bd908cea03f6627bc8
    Integrated branch tip:           e452199ac1d0effa232e16b11a43cd51a0739031
    PR #102 merge commit:            4d5e39a9b337d6cabdc84d450680bc54ad85561b
    C1 study orchestrator revision:  93fdb08ebf034860ab298e40770044e1aa4c67e6
    C1-C treatment revision:        5dc3c3abb37383cd679f39712e2c316d89efdeab
    C1-C evidence freeze revision:  587299e29f800b240fa5fda7f788b3b7ca7bd9c9
    Live binding revision:           fc1a968bfcf7c1fed97390c35bc9b2f15af1244e
    Authorized-provider adapter:     55d834483ba044099e0be8d64b95028becabb014
    Study identity:                  c1-20260906-c1-feasibility-v1-bae9ab90
    Provider/model:                  step-plan / step-3.7-flash
    Endpoint:                        https://api.stepfun.com/step_plan/v1/chat/completions
    Provider config hash:            dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8
    Credential:                      STEP_PLAN_API_KEY / memory-only
    Fallback:                        NONE
    Node range:                      >=24.0.0 <25.0.0
    Scope:                            32 matched pairs / 64 legs / concurrency 1
    Budgets:                          24/96/600000 per leg; 1536/6144/43200000 study
    Assignment matrix SHA-256:       630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7
    C1_RUN_CONTRACT_V1 SHA-256:      1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4
    Amendment SHA-256:                6d9d15e5a0acd1acfbf2232fe59e2c9c4ee289e7fd580fc3afe2d0c627ae3740
    Effective contract SHA-256:      d67901ce0ee2aee47baa3ea734264135506066826391ec511035d09d716e7cbd
    Task manifest SHA-256:            2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
    C1-C readiness SHA-256:           0978d638c6585db785d51f87bda2d9c4a7f8950043e6c823a446832eaf33b730
    Resume/retry/rebind:              FORBIDDEN
    Wave B:                           NO_GO
    CR-004:                           NO_GO

The owner must not sign this block if the execution revision, effective
contract, identity, or any other binding changes. A changed binding requires
a new record or a bounded re-review. Signing this block is the only action
that can change C1 Live from NO_GO to GO.

## 11. Current state

    C1_PROTOCOL_V1                       FROZEN
    C1_A_MANIFEST_V1                     FROZEN
    C1_RUN_CONTRACT_V1                   FROZEN / PRESERVED
    C1_USAGE_CONTRACT_AMENDMENT_V1       FROZEN / MERGED
    C1-C treatment readiness             FROZEN / PASS
    C1 study orchestration               MERGED / ACCEPTED
    C1 zero-provider closure             MERGED / CI_GREEN
    PR #102 live entrypoint              MERGED / CI_GREEN
    Old C1 live attempt                  TERMINAL / NOT_ADMISSIBLE
    Old study identity                   CONSUMED / RETIRED
    V2 authorization record              SUPERSEDED / HISTORICAL
    V2 candidate identity                NOT CLAIMED / DO NOT USE
    V3 candidate identity                NOT CLAIMED / NOT RESERVED
    C1 Live                             NO_GO / PENDING OWNER SIGN-OFF
    Provider execution                   NO_GO
    Wave B                              NO_GO
    CR-004                             NO_GO
    Provider calls while drafting       0

This record is ready for bounded remote review. It becomes an authorization
only after explicit owner sign-off is recorded in a reviewed successor state.
