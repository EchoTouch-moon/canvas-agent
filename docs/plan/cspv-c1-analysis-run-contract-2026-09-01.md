# C1 Analysis / Run Contract — `C1_RUN_CONTRACT_V1`

## Decision boundary

| Field | Value |
| --- | --- |
| Status | `ACCEPTED / FROZEN — C1_RUN_CONTRACT_V1` |
| Design | `C1_FEASIBILITY_V1` |
| Protocol | `C1_PROTOCOL_V1` |
| Task manifest | `C1_A_MANIFEST_V1` |
| Provider calls during C1-B design and freeze | `0` |
| C1 live execution | `NO_GO` pending treatment readiness and separate authorization |
| C1-C treatment implementation | Not specified by this contract; exact revision remains pending |
| CR-004 Active Rewrite | `NO_GO` |

This document instantiates the execution and analysis parameters required by
[`C1_PROTOCOL_V1`](./cspv-c1-comparative-effectiveness-protocol-2026-09-01.md)
for the frozen
[`C1_A_MANIFEST_V1`](../../research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json).
It is a proposed run contract, not live authorization. The machine-readable
companion is
[`c1-run-contract-v1.json`](../../research/context-benchmarks/c1/contracts/c1-run-contract-v1.json).

The contract is intentionally a feasibility design. It freezes what would be
run and how results would be adjudicated before any result is observed; it does
not claim confirmatory statistical power, general effectiveness, token savings,
cost savings, or a causal benefit. The numeric parameters in this contract were
accepted by Lead as the `C1_FEASIBILITY_V1` decision region. They become live
constraints only when a separately authorized run binds an exact C1-C treatment
revision.

## 1. Exact identity and execution binding

The following values are the required pre-live binding. `PENDING_C1_C` is a
deliberate placeholder: C1-B does not authorize implementation of the Runtime
treatment or fill in a treatment revision that has not passed C1-C.

| Binding | Required value |
| --- | --- |
| Protocol | `C1_PROTOCOL_V1` |
| Task manifest | `C1_A_MANIFEST_V1` |
| Manifest path | `research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json` |
| Manifest SHA-256 | `2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38` |
| Manifest fixture base revision | `e6763734934f3b6cac6bf65df3dbd94d57f2dc59` |
| Code revision | `PENDING_C1_C` — exact treatment SHA required before live |
| Node | `>=24.0.0 <25.0.0` |
| Provider | `step-plan` |
| Model | `step-3.7-flash` |
| Endpoint | `https://api.stepfun.com/step_plan/v1/chat/completions` |
| Credential | `STEP_PLAN_API_KEY`, memory-only |
| Execution mode | `experiment-strict` |
| Fallback | `NONE` |
| Runtime readiness artifact | `C1-C_TREATMENT_READINESS_V1` — required before live |

Before the first Provider call, the live runner must record the exact code
revision, contract hash, assignment-matrix hash, manifest hash, runtime
fingerprint, provider/model binding, and fresh study identity. A local context
estimate is not a substitute for provider-reported usage, and no credential,
prompt, response, raw provider payload, or authorization header is a durable
evidence field.

### Canonical identity hashes

The hashes in the machine-readable companion use one explicit canonicalization
rule. Canonical JSON bytes are UTF-8, object keys are sorted lexicographically
by Unicode code point at every depth, array order is preserved, JSON strings
use the standard JSON escaping, numbers use their JSON/ECMAScript numeric
serialization, insignificant whitespace is omitted, and no trailing newline
is included.

`contractSha256` is not a naïve hash of a file containing its own final hash.
At freeze time, the canonical contract representation replaces
`protocolBinding.contractSha256` with the literal string `SELF`, retains the
frozen assignment-matrix hash, serializes with the rule above, and hashes those
bytes. The resulting digest is then written into the visible
`contractSha256` field. Recomputing the hash applies the same `SELF`
replacement, so the field is not self-referential.

`assignmentMatrixSha256` / `assignmentMatrixHash` is the SHA-256 of the
canonical JSON serialization of the exact `randomization.assignmentMatrix`
array only, using the same UTF-8, key-order, array-order, whitespace, and
newline rules. Both fields must carry the same digest at freeze time. The
assignment hash is computed first; the contract hash is computed second with
that assignment digest included.

## 2. Feasibility design

| Parameter | Value |
| --- | --- |
| Design identifier | `C1_FEASIBILITY_V1` |
| Strata | 4 |
| Pairs per stratum | 8 |
| Total matched pairs | 32 |
| Native legs | 32 |
| Runtime legs | 32 |
| Total live legs | 64 |
| Confirmatory claim | Not permitted |
| Confirmatory sample-size decision | Separate future sensitivity/power/feasibility gate |

The unit of analysis is one matched pair, not one arm run. Each pair contains
one Native leg and one Runtime leg against the same task identity, corpus,
provider/model binding, tools, evaluator, and runtime revision. The two legs use
separate isolated copies of the same frozen fixture snapshot, so filesystem
mutation cannot leak from one arm into the other.

The four strata and their lifecycle eligibility are inherited without change
from C1-A:

| Stratum / task | Removal Precision | Rehydration Recovery Rate | Cold Context Penalty |
| --- | --- | --- | --- |
| T1 `c1-t1-localized-distractor-v1` | Eligible | `NOT_ESTIMABLE` | `NOT_APPLICABLE` |
| T2 `c1-t2-multi-file-migration-v1` | Eligible | `NOT_ESTIMABLE` | `NOT_APPLICABLE` |
| T3 `c1-t3-failure-recovery-v1` | `NOT_ESTIMABLE` | `NOT_ESTIMABLE` | `NOT_APPLICABLE` |
| T4 `c1-t4-delayed-context-recovery-v1` | Eligible | Eligible | Eligible, conditional on common anchors and the frozen lineage |

`NOT_APPLICABLE` means that the task was not designed to expose the endpoint.
`NOT_ESTIMABLE` means that the endpoint could apply but its preconditions or
valid evidence were not present. Neither state is converted to zero, and
neither silently excludes the task from other endpoints.

## 3. Pre-registered arm order and assignment matrix

Each stratum has exactly four `NATIVE → RUNTIME` pairs and four
`RUNTIME → NATIVE` pairs. Across all strata the allocation is 16/16. This is a
fixed quota, not a result that can be changed by a random seed.

The pre-registered order seed is:

```text
c1-feasibility-v1-order-seed-20260901
```

The deterministic assignment algorithm is:

```text
digest = SHA-256(seed + ":" + taskId + ":" + pairId)
sort the eight pair IDs in ascending digest order
first four  → NATIVE_THEN_RUNTIME
last four   → RUNTIME_THEN_NATIVE
```

The resulting assignment matrix is part of the JSON companion. The matrix is
not regenerated after the first Provider call. Its hash is a required
pre-live identity field and is frozen as
`630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7`.

| Task | Pair IDs assigned `NATIVE → RUNTIME` | Pair IDs assigned `RUNTIME → NATIVE` |
| --- | --- | --- |
| T1 | `p01`, `p05`, `p02`, `p08` | `p04`, `p07`, `p03`, `p06` |
| T2 | `p04`, `p07`, `p02`, `p01` | `p05`, `p08`, `p03`, `p06` |
| T3 | `p02`, `p04`, `p05`, `p06` | `p07`, `p08`, `p01`, `p03` |
| T4 | `p06`, `p01`, `p02`, `p08` | `p05`, `p07`, `p03`, `p04` |

The assignment record must include `taskId`, `stratum`, `pairId`, order,
arm sequence, and run-ID templates. The seed may assign identities within the
quota, but it may not change the number of pairs, add a task, remove a task,
or select a primary endpoint.

## 4. Run identities and single-use behavior

The run-ID format is:

```text
c1-<yyyymmdd>-<pairId>-<arm>-<8hex>
```

The JSON companion provides templates only; generated IDs are not allocated
by C1-B. At live entry:

- the study identity and all leg identities must be new and unique;
- uniqueness must be checked before the identity is claimed;
- each leg is single-use and terminal evidence is never resumed or overwritten;
- a failed leg is preserved and is not retried until success;
- a new study identity is required for any separately authorized rerun;
- a Native leg cannot be used as a fallback for a failed Runtime leg;
- a Runtime leg cannot be silently rebound to another provider, model, code
  revision, fixture, or treatment.

The assignment matrix, identity claims, and checkpoint state are immutable
after the first Provider call. A hard identity, security, checkpoint,
materialization, replay, evidence-write, binding, or budget failure stops the
study before the next leg. A task failure with complete valid evidence is an
outcome observation and does not trigger retry-until-success behavior.

## 5. Provider and arm binding

### 5.1 Provider binding

The only permitted live binding is:

```text
provider       = step-plan
model          = step-3.7-flash
endpoint       = https://api.stepfun.com/step_plan/v1/chat/completions
executionMode  = experiment-strict
fallback       = NONE
```

The API key is resolved from `STEP_PLAN_API_KEY` into memory only. It must not
appear in the contract hash, selection record, logs, evidence, or error
artifact. A provider failure after the first call aborts the affected run; it
does not switch to DeepSeek or any other fallback provider.

### 5.2 Native control

The Native arm preserves the original model-facing context. It may emit
metadata-only observation, but it does not apply Context Runtime semantic
replacement. The Native context fingerprint and provider-bound semantic input
must match the frozen Native baseline for the leg, subject to the reviewed
runtime metadata boundary.

### 5.3 Runtime treatment

The Runtime arm uses the C1-C treatment readiness artifact and the exact
pre-live treatment revision. Where the frozen lifecycle policy makes an
eligible selection, the provider-bound semantic context must reflect the
materialized Working Set and differ from the Native semantic context. The arm
must preserve reviewed system/developer/tool/provider-native structures and
must not silently fall back to Native.

For T4, a Runtime `REMOVE(src/parser/evaluate.js)` is a premature-removal
observation only at the C1-A `WRONG_PATH_TRIAGE` boundary. A later
`REHYDRATE(src/parser/evaluate.js)` is valid only when it points to that
originating `REMOVE`, restores the exact required SourceVersion and
representation, and precedes the frozen recovery anchor. A first-time `ADD`
is never a `REHYDRATE`. C1 live must not use the C0 scripted lifecycle-event
adapter to manufacture treatment events.

If an eligible opportunity is not observed, the corresponding lifecycle
endpoint is reported with its manifest-defined `NOT_ESTIMABLE` or zero-event
denominator semantics; absence of an opportunity is not by itself a
`TREATMENT_INACTIVE` finding. `TREATMENT_INACTIVE` applies when the pre-registered
Runtime opportunity is observed or required, but the provider-bound semantic
context remains Native-equivalent.

## 6. Outcomes and non-inferiority

The task outcome is defined from the frozen C1-A oracle contract:

```text
SUCCESS
  = objective oracle PASS
    AND regression oracle PASS
    AND expected writable-scope invariant PASS
```

Evidence validity is a separate dimension. A task failure with complete,
trustworthy evidence is a valid outcome observation. A fixture, oracle,
materialization, provider binding, replay, security, checkpoint, or evidence
write failure is not relabeled as a task failure.

The following feasibility non-inferiority values are proposed for Lead freeze:

| Scope | Proposed rule |
| --- | --- |
| Per stratum | `additionalRuntimeFailures = max(0, runtimeFailures - nativeFailures)`; 0–1 does not automatically violate non-inferiority; ≥2 is an outcome NI failure |
| Pooled | Across 32 pairs, 0–2 additional Runtime failures does not automatically violate non-inferiority; ≥3 is an overall outcome NI failure |
| Better eligibility | Any additional Runtime task failure forbids `BETTER`, even if the NI bound is not crossed |

These are feasibility gates, not a claim that eight pairs can establish
clinical-style non-inferiority. A Runtime additional failure within the
tolerated NI band may support `TRADE_OFF` if the primary efficiency endpoint
improves and all other gates pass; it cannot support `BETTER`.

## 7. Primary and secondary endpoints

### 7.1 Primary efficiency endpoint

The proposed primary endpoint is:

```text
providerReported.inputTokens
```

Keep the statistical test quantity separate from the percentage effect size.
The arm-swap-antisymmetric paired test statistic is:

```text
delta_i = Native input tokens - Runtime input tokens
```

The percentage effect size, used only for practical magnitude, is:

```text
reduction_i = (Native input tokens - Runtime input tokens)
              / Native input tokens
```

Positive values favor Runtime in both expressions. Swapping the arm labels
maps `delta_i` to `-delta_i`, which is the required symmetry for an exact
sign-flip test; the percentage effect size is not used as that test statistic.
A pair is eligible for the primary comparison only when both usage rows are
`PROVIDER_REPORTED`, finite and
non-negative, and the Native input-token denominator is positive. Raw token
values remain reportable when a percentage denominator is zero, but the
percentage effect size is `NOT_ESTIMABLE` for that pair.

The exact sign-flip distribution is a distributional paired test, not a
consequence of the AB/BA order quota. Under the pre-registered primary null,
eligible matched-pair absolute token differences are assumed to be
sign-exchangeable about zero, conditional on the observed eligible-pair set
and magnitudes. The finite `2^n` enumeration is exact under that
sign-exchangeability assumption; it is not a design-based randomization
distribution. The 4/4 AB/BA quota controls order balance and is analyzed as a
separate design feature.

The following test and practical threshold are proposed for Lead freeze:

1. Report every eligible pair delta and each stratum's median delta.
2. Within each stratum, use a one-sided exact paired sign-flip test on the
   absolute `delta_i` values. With all eight pairs valid, enumerate all
   `2^8 = 256` sign assignments; with six or seven valid pairs, enumerate
   `2^n` for the valid pairs rather than silently imputing missing values.
   The test statistic is the sum of signed absolute token differences, not the
   percentage effect size.
3. Combine the four stratum p-values with Fisher's method as one pre-registered
   primary test, with `alpha = 0.05`.
4. Require every eligible stratum median to be non-negative, the pooled median
   paired reduction to be at least `10%`, and the Fisher combined p-value to be
   at most `0.05`.
5. Require the minimum primary coverage in Section 9. If coverage is lower,
   the primary endpoint is `NOT_ESTIMABLE` and the overall decision cannot be
   `BETTER`.

The 10% practical threshold, the exact sign-flip statistic, and alpha are
frozen `C1_FEASIBILITY_V1` parameters; they are not inherited facts from
C1_PROTOCOL_V1.
The primary endpoint is the only endpoint allowed to trigger an efficiency
`BETTER` finding. The analysis cannot select a different endpoint after seeing
the results.

### 7.2 Key secondary endpoints

The ordered protected secondary hierarchy is:

1. provider-reported `totalTokens`;
2. total tool calls;
3. total wall-clock duration.

The following material-regression thresholds are proposed for Lead freeze:

| Endpoint | Proposed material regression |
| --- | --- |
| Total tokens | Runtime paired median increase ≥10% over Native, with positive Native denominators |
| Tool calls | Runtime paired median increase ≥2 calls **and** ≥20% using `max(Native median, 1)` as the zero-safe denominator |
| Wall clock | Runtime paired median increase ≥20% **and** ≥5,000 ms using `max(Native median, 1 ms)` as the zero-safe denominator |

These thresholds protect the final decision from treating input-token savings
as automatically beneficial. A key secondary cannot independently trigger
`BETTER`; a material regression can block `BETTER`, produce `TRADE_OFF` when
there is a qualifying primary gain and outcome NI, or produce `WORSE` when it
has no outcome benefit under the adjudication matrix.

Exploratory endpoints are cache-read/write tokens, repeated reads/searches,
trajectory length, per-turn latency, recovery actions, and lifecycle
descriptors. They are reported with denominators and missingness, but cannot
trigger `BETTER` or be selected as a replacement primary endpoint.

## 8. Lifecycle endpoint analysis

The analysis must use the task-specific eligibility table in Section 2 and the
frozen manifest as the only source of lifecycle ground truth.

### Removal Precision

For eligible tasks:

```text
correctly adjudicated eligible removals / all eligible removals
```

The numerator requires the pre-registered ground-truth or oracle support. No
later read is required to prove a removal correct, and no absence of a later
read alone proves a removal correct or incorrect.

### Rehydration Recovery Rate

For eligible T4 observations only:

```text
successful exact recoveries after valid rehydrate demand
  / all valid rehydrate demands
```

The numerator requires an originating `REMOVE`, a linked `REHYDRATE`, exact
SourceVersion and representation restoration, and the downstream recovery
condition. A first-time `ADD` is not a rehydrate.

### Cold Context Penalty

For an eligible T4 pair, use the common task-semantic anchors from C1-A:

```text
A = completion of WRONG_PATH_TRIAGE, before parser diagnosis
B = first focused-oracle invocation after the parser-fix write
```

Runtime is eligible only if the frozen `REMOVE(evaluate.js)` lineage occurs at
A and the linked exact rehydrate occurs before B. Native records the same
semantic anchors but does not invent lifecycle events. Calculate the same
interval difference across both arms for tokens, tools, and latency. If A or B
is absent, ambiguous, or not common to both arms, report `NOT_ESTIMABLE`, not
zero. No interval may be selected post hoc.

Lifecycle denominators are reported by task and arm before any aggregate. T1,
T2, T3, and T4 must not be collapsed into a 32-pair lifecycle denominator when
the manifest does not make the endpoint eligible.

An eligible lifecycle opportunity that does not occur only makes that
lifecycle endpoint `NOT_ESTIMABLE` (or `NOT_APPLICABLE` where specified); it
does not force the overall C1 decision to `INCONCLUSIVE`. If a lifecycle event
does occur and the contract requires an anchor, lineage, or evidence join but
that required evidence is missing or ambiguous, classify the affected evidence
as a harness/infrastructure problem and apply the endpoint/overall
`INCONCLUSIVE` rule. This separates a policy that conservatively avoided a
premature removal from an observed event whose evidence was broken.

## 9. Coverage and operational reliability

The following values are frozen for `C1_FEASIBILITY_V1`:

| Gate | Proposed value |
| --- | --- |
| Minimum valid primary pairs per stratum | 6 of 8 |
| Minimum valid pooled primary pairs | 24 of 32 |
| Minimum valid key-secondary pairs per stratum | 6 of 8 |
| Minimum valid primary pairs per stratum for `BETTER` | 7 of 8 |
| Minimum valid pooled primary pairs for `BETTER` | 30 of 32 |
| Invalid legs permitted in either arm while retaining `BETTER` eligibility | 1 of 32 per arm |
| Runtime operational success required for `BETTER` eligibility | 31/32 = 96.875% |

Runtime infrastructure/evidence attrition is tracked across all attempted
Runtime legs, not only successful task outcomes. Native attrition is reported
for symmetry. The treatment-specific Runtime threshold remains necessary, and
`BETTER` additionally requires the same maximum of one invalid leg in the
Native arm, at least seven valid paired observations in every stratum, and at
least thirty valid paired observations pooled. This prevents the 6/8 and 24/32
estimability floors from being mistaken for sufficient comparative coverage.

The proposed interpretation is:

- 0–1 Runtime invalid legs: reliability gate passes;
- 2 Runtime invalid legs: `BETTER` is forbidden and the default decision is
  `INCONCLUSIVE` for insufficient operational coverage;
- 3 or more treatment-specific Runtime invalid legs: `WORSE`, unless the
  evidence demonstrates a shared external failure, in which case
  `INCONCLUSIVE` is required.

The Native arm follows the same `BETTER` eligibility ceiling: more than one
Native invalid leg forbids `BETTER`, even if the Runtime arm has no invalid
legs. This is an arm-symmetry guard, not a claim that Native and Runtime have
identical infrastructure risk.

Missing provider usage invalidates the affected arm/pair for the usage
endpoint and is counted in evidence attrition. It does not automatically
invalidate a complete task-outcome observation when the remaining evidence
chain is trustworthy. Identity, binding, materialization, replay, security,
checkpoint, budget, or evidence-write failures are run-level hard failures and
stop before the next leg.

## 10. Hard operational budgets

The following feasibility budgets are proposed for Lead freeze:

| Scope | Provider calls | Tool calls | Wall clock |
| --- | ---: | ---: | ---: |
| Each leg | 24 | 96 | 600,000 ms (10 min) |
| Entire study | 1,536 | 6,144 | 43,200,000 ms (12 h) |

The study is sequential (`maxConcurrency = 1`) in assignment-matrix order.
The 64 leg wall-clock maxima sum to `64 × 600,000 = 38,400,000 ms` (10 h).
The study cap intentionally adds a `4,800,000 ms` (80 min) orchestration
allowance for clone/materialization setup, checkpointing, and artifact
finalization, giving `38,400,000 + 4,800,000 = 43,200,000 ms` (12 h).
Provider calls count outbound model calls at the provider transport seam.
Assistant response count and usage rows are evidence fields, not substitutes
for the call ledger.

Any per-leg or study budget breach is terminal for that run/study: preserve the
partial evidence, write the failure state, and do not resume or start the next
leg under the same identity. These budget values are
These frozen budget values are not a live authorization.

## 11. Evidence, replay, and failure classification

Each run and pair must be joinable through metadata-only identifiers:

```text
studyId / runId / taskId / stratum / pairId / arm
  → turnId / modelCallId
  → context fingerprint / Working Set / transition IDs
  → provider usage ledger
  → tool trajectory / latency
  → task outcome / lifecycle adjudication
```

The usage ledger follows `C0_USAGE_CONTRACT_V1`: input, output, cache-read,
cache-write, total tokens, usage source, and independent cost fields. All
assistant responses required by the C1 usage endpoint must have finite
provider-reported usage. `costSource = UNAVAILABLE` is allowed; local token
estimates never become provider usage or monetary cost.

The following classification is mandatory:

| Condition | Classification and treatment |
| --- | --- |
| Fixture/prompt/oracle/manifest/hash mismatch | `HARNESS_CONTRACT_FAILURE`; exclude affected endpoint/pair and preserve |
| Provider binding, runtime, security, materialization, replay, checkpoint, or evidence-write failure | `INFRASTRUCTURE_FAILURE`; hard stop and preserve |
| Runtime fails to change provider-bound semantic context when a frozen opportunity is observed/required | `TREATMENT_INACTIVE`; effectiveness decision `INCONCLUSIVE` |
| Objective/regression/writable-scope failure with complete trustworthy evidence | Valid task outcome failure; count in non-inferiority outcome gate |
| Missing or malformed provider usage with otherwise complete evidence | Usage endpoint incomplete; exclude only the affected usage endpoint/pair and count attrition |
| `NOT_ESTIMABLE` or `NOT_APPLICABLE` lifecycle endpoint | Preserve state and denominator; never convert to zero |

`HARNESS_CONTRACT_FAILURE` and `INFRASTRUCTURE_FAILURE` never become successful
observations by being omitted. A pair may be excluded from a particular
endpoint while remaining reportable for another endpoint only when the
evidence chain for that other endpoint is independently complete.

## 12. Multiplicity and analysis report

The primary endpoint is fixed as provider-reported input tokens. The ordered
key-secondary hierarchy is fixed as total tokens, tool calls, and wall clock.
Exploratory endpoints are descriptive only. No endpoint may be promoted after
results are seen.

The report must include:

- the exact contract, manifest, assignment, code, provider, model, and runtime
  hashes;
- all attempted pairs and legs, including terminal failures and exclusions;
- per-stratum raw pair values, deltas, medians, IQRs, denominators, and missing
  evidence reasons;
- the primary sign-flip p-values and Fisher combined p-value;
- pooled values only after the four stratum results;
- Native and Runtime operational reliability separately;
- lifecycle endpoint denominators and `NOT_ESTIMABLE`/`NOT_APPLICABLE` states;
- evidence-join completeness, replay mismatches, and write failures;
- no silent outlier deletion and no imputation of missing usage;
- no confidence, equivalence, generalization, or cost claim beyond the
  feasibility design.

## 13. Overall adjudication matrix

The adjudicator applies gates in this order:

1. Preserve and classify harness/infrastructure failures.
2. Check treatment activity and endpoint coverage.
3. Check Runtime operational reliability.
4. Check task-outcome non-inferiority.
5. Evaluate the single primary efficiency endpoint.
6. Apply protected-secondary regression guards.
7. Emit exactly one overall decision.

| Overall decision | Required conditions |
| --- | --- |
| `BETTER` | Outcome NI passes; lifecycle/evidence safety passes; Runtime invalid legs ≤1; Native invalid legs ≤1; at least 7 valid primary pairs per stratum and 30 pooled; primary input-token test and ≥10% practical threshold pass; no material protected-secondary regression; no additional Runtime task failure |
| `WORSE` | Outcome NI fails; or safety/evidence invariant fails; or a material resource/recovery regression occurs without an outcome benefit; or treatment-specific Runtime attrition reaches ≥3 under the proposed rule |
| `TRADE_OFF` | Outcome NI passes and primary efficiency gain is qualifying, but a meaningful protected secondary regression or tolerated additional task failure forbids `BETTER` |
| `INCONCLUSIVE` | Treatment inactive; primary/key endpoint coverage is insufficient; Runtime attrition reaches 2; a shared external failure prevents attribution; an observed lifecycle event lacks required anchor/evidence; or the frozen decision bounds do not select a class |

Token reduction alone never produces `BETTER`. A lower input-token volume with
task regression, recovery cost, redundant tools, or latency regression is a
trade-off or `WORSE` under the thresholds above. If the proposed numeric gates
are not accepted by Lead, the contract remains draft and no live run may use
them.

## 14. Claims boundary and next gate

Until a separately authorized C1 run satisfies this contract, the project may
not claim that Context Runtime improves performance, quality, reliability,
reduces tokens/cost, reduces tool use/latency, makes removals correctly, or
eliminates false removal. A valid feasibility result is scoped to the frozen
task corpus, provider/model, runtime, treatment revision, and repetition
design.

The required sequence is:

```text
C1_PROTOCOL_V1 + C1_A_MANIFEST_V1
        ↓
C1_RUN_CONTRACT_V1 FROZEN
        ↓
C1-C credential-free treatment readiness
        ↓
separate Lead live authorization
        ↓
fresh randomized Native/Runtime pairs
        ↓
sanitized evidence synthesis and adjudication
```

Current state:

```text
C0-L1                    CLOSED
C1_PROTOCOL_V1           FROZEN
C1_A_MANIFEST_V1         FROZEN
C1_RUN_CONTRACT_V1       ACCEPTED / FROZEN
C1-C treatment readiness GO / ZERO PROVIDER
C1 live                  NO_GO
CR-004                   NO_GO
Provider calls           0 during C1-B design and freeze
```

C1-B is frozen. The next decision is the zero-provider C1-C treatment-readiness
gate. C1-B does not implement the runner, modify `policy-v0`, change C1-A
fixtures, or authorize Provider execution.
