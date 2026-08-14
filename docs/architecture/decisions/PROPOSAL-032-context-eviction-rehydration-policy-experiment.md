# PROPOSAL-032 — Context Eviction / Rehydration Policy Experiment

- **Status:** PROPOSED — research policy design, not an implementation authorization
- **Target:** Context Runtime v0.3, Phase 2 — Context Selection Policy Validation
- **Date:** 2026-08-13
- **Depends on:** [`PROPOSAL-030`](PROPOSAL-030-context-source-universe-model.md), [`PROPOSAL-031`](PROPOSAL-031-context-working-set-planner.md), [`Context Runtime v0.3 Research Rebaseline`](../../research/context-runtime-v0.3-research-rebaseline-2026-08-13.md)
- **Provider execution:** `NO_GO`
- **Compatibility constraint:** existing v0.2 Snapshot, persistence, Worker and Product MVP contracts remain unchanged

This proposal defines the next research question after the CR-005 Shadow
evidence phase: whether a deterministic Context Working Set policy can make
safe, auditable lifecycle decisions. It does not implement eviction, modify
model-facing context, or authorize an Active Rewrite.

## 1. Problem and research question

The accepted CR-005 traces established observation, source reconciliation,
Working Set planning, provenance, replay and fail-closed benchmark behavior.
They did not produce live `REMOVE` or `REHYDRATE` evidence.

The next question is therefore:

> Can the Context Runtime remove clearly low-value active evidence, preserve
> the ability to recover it, detect when removed evidence becomes needed again,
> and rehydrate the exact required SourceVersion and representation without
> violating mandatory-context or replay invariants?

This is a policy-validation experiment. It is not a continuation of Wave A and
does not depend on getting a C4 Native task to pass.

## 2. Decision summary

Freeze the following semantic distinction:

```text
Context Universe
    durable knowledge of known sources, versions and provenance

Context Working Set
    currently active model-usable representations

REMOVE
    evict an active representation from the Working Set
    while retaining recoverable source/version/provenance evidence

REHYDRATE
    reactivate a previously inactive representation because current evidence
    requires its detail again
```

`REMOVE` is not source deletion. `REHYDRATE` is not an opaque emergency fetch.
Both are first-class, replayable decisions with stable reason codes.

The first implementation target remains the existing deterministic policy
kernel. No LLM ranking, opaque summarization, provider-specific policy or
Active request rewrite is introduced by this proposal.

## 3. Scope

### In scope

- policy-level definitions for `REMOVE` and `REHYDRATE`;
- safe trigger and reason-code vocabulary;
- false-removal candidate evidence;
- synthetic deterministic transition scenarios;
- Shadow-only lifecycle evidence design;
- metrics and readiness gates for a later CR-004 review.

### Out of scope

- changing `packages/context-runtime` Planner code in this document task;
- changing Pi messages or any model-facing context;
- implementing CR-004 Active Rewrite;
- running DeepSeek, another provider or a live canary;
- changing manifests, frozen fixtures, evaluators or checkpoint semantics;
- introducing `COMPRESS`, opaque LLM summaries or a new ranking model;
- claiming token, cost or task-quality improvement.

## 4. Policy vocabulary

The following reason codes are research-policy inputs. They extend the
vocabulary in PROPOSAL-031 without freezing a public TypeScript API.

### 4.1 REMOVE reasons

```text
RULED_OUT
    evidence excludes the source's investigative path for the current task

SUPERSEDED
    a newer authoritative failure, result or representation replaces the
    active evidence for the current decision

PHASE_IRRELEVANT
    the task phase no longer needs this detail, while the source remains
    recoverable for a later phase

BUDGET_PRESSURE
    deterministic budget arbitration evicts the lowest-value NORMAL candidate
    after hard protections and current dependencies are satisfied

SOURCE_ABSENT
    the source is confirmed absent in the current Universe; historical
    evidence may remain durable but the active representation is no longer
    current
```

`SOURCE_ABSENT` must not be used as a synonym for an observation failure or a
dirty-world revision mismatch. A source that is `UNAVAILABLE` is not thereby
confirmed absent.

### 4.2 REHYDRATE reasons

```text
DETAIL_REQUIRED
    the active metadata, reference or summary is insufficient for the current
    task decision

NEW_DEPENDENCY
    new evidence establishes a dependency on a previously cold source

NEW_FAILURE_EVIDENCE
    a new failure signature points back to a source that was removed

RULED_OUT_PATH_REOPENED
    later evidence invalidates the earlier exclusion decision

READ_AFTER_REMOVE
    an observed read/search/dependency event requests a source after eviction

EXPLICIT_DETAIL_REQUEST
    an explicit task/debugger request requires the inactive source
```

`READ_AFTER_REMOVE` is an evidence signal, not by itself proof that the policy
caused an Agent failure. The current Shadow mode preserves the real model
input, so causal claims require a later Active experiment.

## 5. False Removal Candidate

Define a `False Removal Candidate` as follows:

> At transition `N`, the Planner emits `REMOVE` for a source or representation;
> after that transition, the trace contains auditable evidence that the same
> source became needed again, such as a read, search hit, dependency edge,
> failure reference, explicit detail request or `REHYDRATE` decision.

This definition intentionally creates a candidate, not a final false-removal
judgment. A later need may be legitimate task evolution rather than an
incorrect decision at transition `N`.

Conceptual evidence shape:

```text
FalseRemovalCandidate
  sourceKey
  removedRepresentationId
  removeTransitionId
  removeSequence
  laterNeedEvidence[]
    evidenceKind: READ | SEARCH | DEPENDENCY | FAILURE | DETAIL_REQUEST | REHYDRATE
    sequence
    sourceVersionId, when known
    evidenceRef
  rehydrateDemandId, when present
  callDistanceWhileCold
  adjudication: CANDIDATE | CONFIRMED_AFTER_AUDIT | NOT_CONFIRMED
```

The audit must preserve the distinction between:

```text
later-needed
    a source was needed after removal

false-removal candidate
    later-needed evidence is linked to a prior REMOVE decision

causal false removal
    requires a separate Active or controlled counterfactual analysis
```

The first Shadow experiment may report candidate counts and examples. It must
not report them as causal task failures.

## 6. Hard protections and availability semantics

### 6.1 Mandatory and pinned protection

`MANDATORY` and `PINNED` sources are protected from ordinary `REMOVE`:

```text
mandatory/pinned eviction = 0
```

If a budget cannot satisfy a mandatory or pinned item, the planner must emit a
structured protection conflict or fail-closed result. It must not silently
override the protection or convert it to a normal candidate.

### 6.2 `ABSENT` versus `UNAVAILABLE`

The policy must preserve the distinction defined by PROPOSAL-030:

```text
ABSENT
    current reconciliation has evidence that the source is not present

UNAVAILABLE
    the source could not be observed or validated at this boundary
```

For confirmed `ABSENT`, an active current representation may be removed or
replaced with an explicit `SOURCE_ABSENT` reason, unless it is mandatory,
pinned or intentionally historical.

For `UNAVAILABLE` / `REVISION_MISMATCH`:

- do not silently delete the last-known version;
- retain the version and provenance as stale/unconfirmed;
- use conservative keep for high-protection or high-authority evidence;
- only cool a low-value reference under an explicit policy decision;
- never relabel the observation as confirmed absence.

The policy must never infer `SOURCE_ABSENT` from any of the following:

```text
materialization failure
temporary repository unavailability
REVISION_MISMATCH
content hash mismatch
missing representation
unavailable historical SourceVersion
```

`SOURCE_ABSENT` is valid only when source reconciliation provides explicit
`ABSENT` evidence in the current Universe revision. A failed observation,
failed materialization or unavailable historical version remains a distinct
observation, materialization or version-safety failure.

This preserves the accepted C2/C3 dirty-world semantics and prevents an
observer failure from becoming an eviction signal.

## 7. SourceVersion and representation safety

Every `REMOVE` must retain enough information to recover the evicted evidence:

```text
sourceKey
admittedVersionId
lastAvailableVersionId, when applicable
representationId and representation kind
content/provenance references
remove reason and transition id
```

Every `REHYDRATE` must record:

```text
requested source/version
selected source/version
selected representation kind
materialization result
rehydration reason
originating REMOVE decision
```

The selected SourceVersion must be exact for the requested evidence. A newer
or fallback version may be used only when the planning request explicitly
asks for current state and the trace records that new identity. The runtime
must not silently substitute a latest version for a historical version that a
decision references.

If the exact required version or representation cannot be materialized, the
decision is not a successful rehydration. It must produce bounded failure
evidence and no fabricated active representation.

## 8. Transition and replay invariants

For a deterministic policy, the same normalized inputs must produce the same
transition:

```text
ContextUniverseRevision
+ ContextPlanningRequest
+ previous ContextWorkingSet
+ policy version
+ deterministic budget
→ identical ContextTransition
```

Every active-set change must have one or more machine-readable reason codes.
Every transition must bind to the exact Universe revision used for planning.
Every representation must retain exact SourceVersion provenance.

Replay must verify at least:

```text
decision kind and subject
reason codes
from/to Working Set membership
SourceVersion IDs
representation IDs/kinds
token estimates
policy version
transition hash
```

No unexplained decision is acceptable in a passing deterministic trace.

## 9. Proposed experiment corpus

The first Shadow lifecycle canary should use a new corpus, not present itself
as an unfinished C5/C6 continuation.

### E1 — Distractor Elimination

Several plausible sources are investigated. One source becomes clearly ruled
out while the true target remains active.

Expected evidence:

```text
ADD distractors/target
KEEP mandatory/current target
REMOVE ruled-out distractor
no mandatory/pinned eviction
```

### E2 — Wrong Path Recovery

Source `A` is investigated and removed as ruled out. A later failure or
dependency points back to `A`.

Expected evidence:

```text
REMOVE A / RULED_OUT
later-needed evidence for A
REHYDRATE A / NEW_FAILURE_EVIDENCE or RULED_OUT_PATH_REOPENED
exact SourceVersion and representation restored
```

### E3 — Phase Shift

Investigation requires detailed logs and test output; implementation no longer
needs all of that detail; verification later requires a subset again.

Expected evidence:

```text
FULL/REFERENCE active during investigation
REMOVE or narrow only phase-irrelevant detail
REHYDRATE exact detail when verification requires it
```

### E4 — Superseded Evidence

An old failure is repaired and a new failure replaces it.

Expected evidence:

```text
ADD new failure
REMOVE old failure / SUPERSEDED
provenance for both remains auditable
```

These scenarios are policy targets, not guarantees that the existing Planner
already passes them. Passing them requires the deterministic transition suite
and later Lead review.

## 10. Metrics and evidence policy

The first lifecycle experiment must prioritize policy evidence over
Native/Shadow call-count comparison.

### Required metrics

```text
planner decisions
REMOVE count and reason distribution
REHYDRATE demand count
successful REHYDRATE count
false-removal candidate count
later-needed / read-after-remove count
time or model-call distance while cold
SourceVersion correctness
representation correctness
provenance coverage
reason-code coverage
replay mismatch count
unexplained decision count
materialization failure count
mandatory/pinned eviction count
Working Set active-set and estimate deltas
```

### Interpretation limits

- Shadow remains observational-only until a separate Active authorization.
- `REMOVE` count alone is not evidence of useful context reduction.
- `REHYDRATE` count alone is not evidence that eviction was harmful.
- Internal token estimates are not provider token or cost measurements.
- A single canary does not support model generalization or statistical claims.

## 11. Gate criteria

### Gate A — policy review

`PROPOSAL-032` is ready for Lead review when the semantics above are stable and
the deterministic suite package names its fixtures and oracles.

### Gate B — deterministic transition suite

The policy cannot advance if any of the following occur in the synthetic
traces:

```text
REMOVE observed                 = 0
REHYDRATE observed              = 0
mandatory/pinned eviction       > 0
unexplained decision            > 0
replay mismatch                 > 0
lost provenance                 > 0
wrong SourceVersion rehydrate   > 0
materialization failure         unexplained or not fail-closed
```

The deterministic suite must observe at least one valid `REMOVE` and one valid
`REHYDRATE` in the same replayable transition chain.

### Gate C — bounded Shadow canary

Gate C requires a new authorization. A Lead may authorize it only after Gates
A and B pass and the corpus, manifest, model profile, evidence budget and stop
policy are separately reviewed.

### Gate D — CR-004 readiness

Gate D is a new Lead decision. Passing Gates A–C does not automatically enable
Active Rewrite.

## 12. Implementation and authorization boundary

This proposal is not permission to:

- edit Planner behavior;
- alter model-facing Pi messages;
- run DeepSeek or another provider;
- resume any terminal Wave A checkpoint;
- start Wave A Run 3 or Wave B;
- implement or enable CR-004 Active Rewrite.

The next bounded work item is a credential-free deterministic transition-suite
implementation/specification review. Any implementation must preserve the
existing v0.2 and CR-005 contracts and remain on a separate branch/PR.

## 13. Open questions for Lead review

1. What exact horizon should classify a later need as a high-priority
   false-removal candidate: model-call distance, transition count, or both?
2. Which deterministic evidence types should satisfy `READ_AFTER_REMOVE` in
   Shadow mode when the model-facing context was never actually rewritten?
3. Should E3 phase changes be supplied by a synthetic `phaseHint`, a trace
   event, or both?

Until these questions are answered, this proposal remains a research design,
not a stable Runtime contract.
