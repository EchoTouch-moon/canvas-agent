# CSPV-C1 Usage Contract Amendment V1 — Draft 2026-09-05

Status: `DRAFT / ZERO PROVIDER / LEAD REVIEW REQUIRED`

Amendment: `C1_USAGE_CONTRACT_AMENDMENT_V1`

Parent contract: `C1_RUN_CONTRACT_V1`

This document defines a narrowly scoped, versioned amendment for Provider
usage capability semantics. It does not reopen the C1 protocol, task
manifest, assignment matrix, treatment, budgets, statistical rules, or live
authorization. Drafting and validation of this amendment caused zero
Provider/network calls.

## 1. Decision boundary

The original `C1_RUN_CONTRACT_V1` remains frozen and preserved. This amendment
is additive: after it is accepted and frozen, the effective C1 execution
contract is the original contract plus this usage-capability amendment.

The amendment changes only the interpretation and normalized representation of
the two Provider-dependent cache split fields:

```text
cacheReadTokens
cacheWriteTokens
```

The primary endpoint remains:

```text
providerReported.inputTokens
```

No new Provider execution is authorized by this draft.

The supersession boundary is explicit:

```text
supersedes only:
  C1_RUN_CONTRACT_V1.providerUsage.cacheReadTokens
  C1_RUN_CONTRACT_V1.providerUsage.cacheWriteTokens

all other C1_RUN_CONTRACT_V1 clauses remain unchanged
```

## 2. Why the amendment is needed

The first authorized C1 live attempt used the following single-use identity:

```text
studyId:           c1-20260905-c1-feasibility-v1-35359a74
executionRevision: 93fdb08ebf034860ab298e40770044e1aa4c67e6
provider/model:   step-plan / step-3.7-flash
node:             v24.15.0
```

The run made one real Provider attempt, then stopped at usage normalization
because the adapter required `cacheWriteTokens` and the Provider response did
not expose a recognized cache-write field. No leg completed, no tool executed,
and no subsequent leg was started. The evidence was preserved and the study
identity is retired; this amendment does not reinterpret or overwrite that
historical terminal outcome.

The published StepFun Chat Completions documentation describes the core
`prompt_tokens`, `completion_tokens`, and `total_tokens` counters and a
cached-token detail, but does not document a separate cache-write counter in
the published response shape. This is compatibility evidence, not a claim
that every future Step Plan response has been exhaustively characterized.

Reference: [StepFun Chat Completions API](https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create)

## 3. Effective Provider usage schema

The three core counters remain required Provider-reported integers:

```text
inputTokens   REQUIRED / non-negative integer
outputTokens  REQUIRED / non-negative integer
totalTokens   REQUIRED / non-negative integer
```

The cache split fields are always represented explicitly, each using the
following tagged metric:

```ts
type ProviderMetric =
  | {
      status: 'REPORTED'
      value: number
    }
  | {
      status: 'UNAVAILABLE'
      reason: 'NOT_REPORTED_BY_PROVIDER'
    }
```

`REPORTED` requires the Provider-reported non-negative integer `value`.
`UNAVAILABLE` requires the `value`/`tokens` property to be absent. A shape such
as `UNAVAILABLE + value: 0` is invalid because it collapses unavailable with a
reported zero.

The normalized shape is therefore:

```ts
type C1EffectiveProviderUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: ProviderMetric
  cacheWriteTokens: ProviderMetric
  usageSource: 'PROVIDER_REPORTED'
}
```

An explicitly reported numeric zero is still a reported value:

```json
"cacheWriteTokens": { "status": "REPORTED", "value": 0 }
```

An absent cache field is not zero, not an estimate, and not a malformed
Provider response when the three core counters are valid. It is represented as
`UNAVAILABLE / NOT_REPORTED_BY_PROVIDER`.

## 4. Normalization and failure rules

The future adapter implementation must apply these rules only after this
amendment is frozen:

1. `inputTokens`, `outputTokens`, and `totalTokens` must be present and be
   non-negative Provider-reported integers. Missing, negative, non-integer,
   wrong-type, or otherwise malformed core fields remain a hard
   `USAGE_CONTRACT_MISMATCH`.
2. A recognized cache field that is present must be a non-negative
   Provider-reported integer. A present `null`, string, negative value, or
   malformed object is a hard mismatch; it is not converted to
   `UNAVAILABLE`.
3. A cache field that is absent is normalized to
   `{ status: 'UNAVAILABLE', reason: 'NOT_REPORTED_BY_PROVIDER' }`.
4. A Provider-specific alias may be accepted only when it unambiguously maps
   to the corresponding cache metric. The adapter must not derive one cache
   split from another field or from local text/context estimates.
5. `usageSource` remains `PROVIDER_REPORTED` only when the three required
   counters are Provider-reported and valid. `LOCAL_ESTIMATE` is forbidden.
6. The adapter must not infer cache-write usage from `inputTokens`,
   `totalTokens`, cached-token reads, prompt length, or any other local or
   derived quantity.
7. The serialized evidence representation must retain the tagged availability
   status and reason. A bare `null` is not an allowed substitute.

This amendment therefore distinguishes:

```text
absent field                      → UNAVAILABLE / NOT_REPORTED_BY_PROVIDER
explicit numeric zero             → REPORTED(0)
present malformed field           → hard contract failure
locally inferred or derived value → forbidden / hard contract failure
```

## 5. Analysis and adjudication impact

The following semantics are frozen by this amendment:

- The C1 primary efficiency endpoint remains Provider-reported
  `inputTokens`, lower-is-better.
- A missing cache split does not become zero and does not invalidate a run
  whose required core usage and other run gates are valid.
- Any cache-split endpoint requiring both cache fields is
  `NOT_ESTIMABLE` unless both fields are `REPORTED`.
- A single reported cache split may remain descriptive evidence, but any
  analysis requiring the missing split is `NOT_ESTIMABLE`.
- Cache-split unavailability cannot trigger `BETTER`, `WORSE`,
  `TRADE_OFF`, or `INCONCLUSIVE` for the primary C1 adjudication by itself.
- With valid Provider-reported `inputTokens`, `outputTokens`, and
  `totalTokens`, the following remain estimable even when one or both cache
  splits are unavailable: task effectiveness, input-token efficiency,
  total-token regression, tool-call efficiency, and wall-clock outcomes.
- Cache efficiency and any cache-dependent Cold Context Penalty are
  `NOT_ESTIMABLE` when the required cache split is unavailable. No cache
  quantity may be reconstructed from the remaining counters.
- `NOT_REPORTED_BY_PROVIDER` is a per-response provenance state. It means that
  the response contained no contract-recognized field for that metric; it does
  not assert that the Provider can never report the metric in another response
  or future capability version.
- The amendment does not convert the first terminal attempt into effectiveness
  data. That attempt remains `PROVIDER_USAGE_CAPABILITY_MISMATCH` and is not
  admissible for Native-vs-Runtime effectiveness analysis.

## 6. Explicitly unchanged boundaries

This amendment does not change:

```text
C1_PROTOCOL_V1
C1_A_MANIFEST_V1
assignment matrix or AB/BA quotas
32 matched pairs / 64 legs
Native and Runtime arms
primary endpoint or direction
practical threshold, NI margin, alpha, or multiplicity rules
tool, wall-clock, and study budgets
fixture isolation and writable-scope rules
treatment implementation or Runtime policy
evidence redaction and metadata-only persistence
single-use identity, terminal, no-resume, and no-next-leg rules
provider, model, endpoint, Node range, or fallback policy
CR-004 and Wave B authorization boundaries
```

The original contract hash remains the historical hash:

```text
C1_RUN_CONTRACT_V1 SHA-256:
1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4
```

The amendment will receive its own canonical hash only in a later freeze
commit. No self-referential hash is claimed in this draft.

## 7. Historical provenance of the consumed attempt

```text
Attempt:                 C1 LIVE ATTEMPT #1
Authorization:           VALID
Study identity:          c1-20260905-c1-feasibility-v1-35359a74
Identity status:          CONSUMED / RETIRED
Execution revision:      93fdb08ebf034860ab298e40770044e1aa4c67e6
Contract:                C1_RUN_CONTRACT_V1
Contract SHA-256:        1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4
Provider/model:           step-plan / step-3.7-flash
Run manifest status:      FAIL
Provider attempts:       1
Network requests:        1
Outbound-permitted checkpoints: 1
Attempted legs:          1
Completed legs:          0
Response calls:           0
Tool executions:         0
Completed-leg provider-permit aggregate: 0
Terminal reason:         USAGE_CONTRACT_MISMATCH / missing cacheWriteTokens
Classification:           PROVIDER_USAGE_CAPABILITY_MISMATCH
Task effectiveness:       NOT_ADMISSIBLE
Treatment effectiveness:  NOT_ADMISSIBLE
Resume:                   FORBIDDEN
Reuse:                    FORBIDDEN
Rebind:                   FORBIDDEN
```

The retired identity must never be resumed, reused, or rebound under this
amendment or any successor implementation. A future attempt requires a newly
frozen effective contract, a new exact implementation binding, and a fresh
single-use study identity.

The durable evidence is referenced by study identity and artifact basename;
raw Provider payloads, prompts, assistant text, tool arguments, tool results,
credentials, and authorization headers are not committed by this amendment.

## 8. Acceptance criteria before implementation

The following must be completed in order:

```text
amendment draft
  → zero-provider Lead review
  → canonical freeze and independent hash verification
  → adapter implementation
  → fixture/schema regression tests
  → study-orchestrator compatibility regression
  → new authorization record
  → fresh study identity
  → separate C1 Live decision
```

The adapter work is not part of this draft. Once authorized for implementation,
zero-provider regressions must cover at least:

```text
all core + both cache fields reported         → normalized PASS
core reported + cache-write absent            → write UNAVAILABLE
core reported + both cache fields absent      → both UNAVAILABLE
explicit cache zero                           → REPORTED(0)
missing core field                            → hard mismatch
malformed present cache field                 → hard mismatch
local estimate or derived cache write         → hard mismatch
tagged status survives evidence serialization → PASS
```

## 9. Current authorization state

```text
Old C1 Live study               TERMINAL / CLOSED
Old study identity              CONSUMED / RETIRED
Zero-provider compatibility     CLOSED
C1_USAGE_CONTRACT_AMENDMENT_V1 DRAFT / REVIEW REQUIRED
Adapter implementation          NO_GO until amendment freeze
New study identity              NO_GO
New Provider calls              NO_GO
C1 Live                         NO_GO
CR-004                          NO_GO
Wave B                          NO_GO
```
