# Context Runtime v0.3 Experiment Plan

- **Status:** PROPOSED FOR TASKING AFTER v0.2 RC
- **Depends on:** `docs/architecture/context-runtime-v0.3-direction.md`
- **Domain proposals:** `PROPOSAL-030-context-source-universe-model.md`, `PROPOSAL-031-context-working-set-planner.md`
- **Primary harness:** Pi
- **Primary bulk experiment model:** DeepSeek or another replaceable low-cost provider
- **Second harness:** OpenCode
- **Later compatibility target:** Codex
- **CR-001 assigned packet:** `docs/tasks/deepseek/DS-008-pi-context-shadow-observation.md`

## 1. Purpose

This plan converts the Context Runtime direction into a sequence of controlled experiments.

The goal is not to ship a new Agent in v0.3.

The goal is to answer one technical question with evidence:

> Can an external, provider-neutral Context Runtime maintain or improve coding-task reliability while actively shrinking, replacing and rehydrating the model's Context Working Set instead of relying on monotonic context growth followed by compaction?

The experiment must keep Context Runtime independent of any single Agent harness or model provider.

---

## 2. Architecture constraint before tasking

The following dependency rule is mandatory:

```text
Pi integration ---------+
OpenCode integration ---+---> packages/context-runtime
Codex integration ------+

packages/context-runtime
    MUST NOT import Pi / OpenCode / Codex / DeepSeek-specific code
```

The Runtime core should operate on provider-neutral research structures such as:

```text
ContextSource
ContextSourceVersion
ContextSourceState
ContextUniverseRevision
ContextRepresentation
ContextWorkingSet
ContextDecision
ContextTransition
ContextPolicy
ModelCallObservation
```

Do not reuse the renderer's existing pre-freeze `ContextCandidate` type as a Runtime model.

Exact public schemas are not frozen by this plan.

Do not publish stable contracts until the Shadow experiment produces real data.

---

## 3. Experiment matrix

### 3.1 Primary controlled comparison

Keep fixed:

```text
Agent harness: Pi
Model: same selected model
Repository: same revision
Task: same TaskSpec / acceptance criteria
Tool policy: same
Budget: same
```

Change:

```text
Context strategy
```

Required variants:

```text
A. Native
   Pi native context behavior

B. Shadow
   Pi native behavior unchanged
   Canvas reconciles a Context Universe and computes a hypothetical Working Set

C. Dynamic
   Canvas rewrites active semantic context before model calls
```

Optional baseline:

```text
D. Static
   Canvas initial frozen context only + native later growth
```

### 3.2 Cross-model check

After a Dynamic policy shows value on the default low-cost model, rerun a representative subset on another model family.

A policy does not become a general Runtime policy until it survives this check.

### 3.3 Second-harness check

After Pi proves the core mechanism, port the Runtime boundary to OpenCode.

Compare:

```text
OpenCode Native
vs
OpenCode + Canvas Dynamic Working Set
```

This is the first portability gate.

---

## 4. Work packages

## CR-001 — Pi Research Integration Spike

**Assigned implementation packet:** `docs/tasks/deepseek/DS-008-pi-context-shadow-observation.md`

**Owner:** DeepSeek V4 Flash

**Start gate:** PR #12 architecture merged + lead architect authorizes Context Runtime v0.3 research after the Product MVP v0.2 RC decision.

### Objective

Prove that Canvas can observe every Pi model-call context without changing Agent behavior.

### Scope

- create an experimental Pi integration package;
- connect the Pi pre-model context hook to a Canvas Runtime callback;
- emit a stable model-call sequence identifier;
- capture bounded context metadata;
- return the native context unchanged;
- run one real coding task against a replaceable provider;
- use DeepSeek as the default bulk experiment provider where practical.

### Explicit non-goals

- no context rewrite;
- no durable schema freeze;
- no OpenCode work;
- no Codex gateway;
- no Context Canvas UI;
- no autonomous context-selection Agent.

### Acceptance evidence

- at least one end-to-end Pi coding Run completes;
- every model invocation is observed exactly once or has documented retry semantics;
- the Run records model-call sequence, estimated context size and basic context categories;
- disabling the integration restores normal Pi behavior;
- `context-runtime` core contains no Pi or provider-specific imports;
- provider credentials are not persisted in Runtime observations.

### Stop condition

If Pi cannot expose a stable enough model-call boundary without a deep fork, stop and write an architecture review before changing the integration strategy.

---

## CR-002 — ModelCallObservation, Source Reconciliation and Context Universe research model

### Objective

Create the minimum provider-neutral in-memory / experimental structures needed to reason about context evolution.

This work follows `PROPOSAL-030` and must preserve the separation:

```text
Source Observation
    !=
Source Reconciliation
    !=
Working Set Planning
```

### Candidate fields to validate

`ModelCallObservation` may need:

```text
runId
runtimeSessionId
sequence
agentHarness
modelProfile
nativeContextEstimate
messageCategoryCounts
toolStateReferences
phaseHint
timestamp
```

`ContextSource / ContextSourceVersion / ContextSourceState / ContextUniverseEntry` research data may need:

```text
sourceKey
sourceKind
contentHash / contentRef
authority
baselinePriority
observationStatus
admittedVersionId
lastAvailableVersionId
freshness / world revision
representation availability
token estimate
provenance
```

The exact shapes must be derived from CR-001 evidence.

### Acceptance evidence

- one Run can be reconstructed as a model-call timeline;
- repeated source observations can be correlated by stable source identity and source-version hash;
- `AVAILABLE`, `ABSENT` and `UNAVAILABLE` are distinguishable;
- Snapshot-seeded source versions and Run-derived observations are distinguishable;
- Universe revisions can be correlated with model-call boundaries;
- secret-bearing fields are excluded or redacted;
- no schema is promoted to a stable public contract without architecture review.

---

## CR-003 — Shadow Working Set Planner

### Objective

For every observed model call, compute what Canvas would have used without changing the real request.

This work follows `PROPOSAL-031`.

The Planner must operate on:

```text
ContextUniverseRevision
+
ContextPlanningRequest
+
Previous Shadow ContextWorkingSet (optional)
```

and produce:

```text
ContextRepresentation[]
ContextWorkingSet
ContextDecision[]
ContextTransition
```

### First policy inputs

Use deterministic signals first:

- protection / mandatory state;
- authority;
- P0-P3 baseline priority;
- task phase / phase hint;
- current target;
- current diff;
- source freshness / observation availability;
- superseded status;
- source dependency / derivation;
- latest failing verification evidence;
- previous remove / rehydrate history;
- previous Working Set membership;
- representation token cost;
- budget.

### Required semantic decisions

Initial vocabulary:

```text
KEEP
ADD
REMOVE
REPLACE
COMPRESS
REHYDRATE
```

Membership and representation decisions must remain distinguishable.

Example:

```text
Call #14
Native: 28.4K
Proposed Working Set: 15.1K

REMOVE
- login.ts FULL
  reason: RULED_OUT

REPLACE
- auth.ts FULL
+ auth.ts SYMBOL refreshSession
  reason: REPRESENTATION_NARROWED

KEEP
= Task instruction
  reason: MANDATORY_INSTRUCTION

REHYDRATE
+ old test failure
  reason: DETAIL_REQUIRED
```

### Metrics

- proposed token reduction;
- Working Set churn;
- number of removes;
- number of representation replacements;
- number of compressions;
- number of proposed rehydrates;
- sources removed and later observed as needed again;
- repeated file/tool reads after removal;
- stale-context retention rate;
- context category distribution;
- stable-prefix estimate where measurable.

### Acceptance evidence

- a Shadow report exists for a representative task corpus;
- every membership or representation change has machine-readable reason codes;
- every derived representation retains SourceVersion provenance;
- false-removal candidates can be identified;
- rehydration candidates are measurable;
- mandatory protections are test-locked;
- policy output is deterministic for the same normalized Universe + PlanningRequest + policy version.

---

## CR-004 — Dynamic Working Set Rewrite

### Objective

Enable real context rewrite in controlled Pi runs.

### Gate

CR-004 cannot start until CR-003 has a reviewed Shadow corpus and repeatable Native baseline.

### Rewrite operations

Initial allowed vocabulary:

```text
KEEP
ADD
REMOVE
REPLACE
REHYDRATE
```

`COMPRESS` should initially use explicit deterministic / reviewed summarization rules or precomputed summaries. Do not make opaque LLM summarization a mandatory dependency of the first rewrite experiment.

### Safety rules

- rewrite is enabled explicitly per Run;
- native context remains available for control experiments;
- tool-call continuity must be preserved outside the semantic Planner;
- system / mandatory instructions cannot be silently removed;
- a failed Runtime decision must fall back to native context for the experiment, unless the specific test intentionally validates fail-closed behavior;
- every changed model call records its ContextTransition;
- every Working Set binds to the exact Universe revision from which it was planned;
- stale representations cannot silently masquerade as current source state.

### Acceptance evidence

- the same benchmark task can run in Native and Dynamic modes;
- Dynamic mode demonstrates actual context shrink on at least one call after prior growth;
- all active removals and representation changes are observable in the timeline;
- rehydration can restore previously cold evidence;
- no task is counted successful unless its existing acceptance criteria pass.

---

## CR-005 — Pi Benchmark and Failure Analysis

### Objective

Determine whether Dynamic Context Working Set management has measurable value.

### Minimum task corpus

Include tasks that create different context pressure:

1. localized bug fix;
2. multi-file feature change;
3. failing-test diagnosis;
4. refactor with architectural constraints;
5. task requiring discovery across unrelated candidate files;
6. longer task with at least one wrong investigative path.

Use repository fixtures or reproducible real-project snapshots.

### Minimum metrics

```text
quality
- task success rate
- acceptance criteria pass rate
- regression / test result

context
- total input tokens
- peak active context
- average active context
- growth / shrink transitions
- stale context retained
- removals
- replacements / compressions
- rehydrations
- false-removal evidence
- Working Set churn

efficiency
- tool calls
- repeated file reads
- repeated searches
- execution time
- provider cost where available

explainability
- transitions with explicit reason codes
- unexplained rewrite count
- source / representation provenance coverage
```

### Promotion rule

Dynamic Context is promising only if it:

> maintains or improves task reliability while materially reducing irrelevant active context or repeated work.

Token reduction alone is insufficient.

A smaller Working Set with worse task success is a failed policy.

---

## CR-006 — Cross-Model Validation

### Objective

Check whether the best Pi Dynamic policy is model-specific.

### Procedure

- freeze one reviewed Context Policy version;
- select a representative subset of CR-005 tasks;
- run the same Native / Dynamic comparison using another model family;
- do not retune the policy before the first comparison.

### Acceptance evidence

Record whether:

- the same removals remain safe;
- the same representation narrowing remains useful;
- rehydration demand changes;
- smaller / stronger models react differently to context reduction;
- policy weights need model profiles rather than global defaults.

### Possible conclusion

The Runtime can remain Agent-neutral while still allowing model-aware rendering / budgeting profiles.

Model-neutral does not require every policy threshold to be identical for every model.

---

## CR-007 — OpenCode Portability Experiment

### Objective

Test the provider-neutral Runtime against a second open Agent with more mature native context management.

### Scope

- implement only the minimum OpenCode integration required to feed Runtime observations and, if safely supported, Working Set decisions;
- preserve OpenCode Native as the control;
- reuse the same Runtime source, Universe, representation, policy and Working Set definitions from Pi;
- record integration-specific capability differences;
- avoid mapping OpenCode's model-hidden `Context Snapshot` to Canvas `ContextSnapshot`.

### Required comparison

```text
OpenCode Native
vs
OpenCode + Canvas Runtime
```

### Acceptance evidence

- no Pi-specific concepts are required by Runtime core;
- the same `ContextSource / ContextUniverse / ContextRepresentation / ContextWorkingSet / ContextTransition` model represents both harnesses;
- differences are isolated to integration adapters or explicit capability profiles;
- benchmark results identify whether Canvas adds value beyond OpenCode native context management.

### Stop condition

If the Runtime must become OpenCode-specific to work, stop and revise the abstraction instead of adding provider-specific branches to the core.

---

## CR-008 — Codex Compatibility Research

### Objective

After the Runtime is validated on open harnesses, test a less direct integration boundary.

Possible technique:

```text
Codex
  -> protocol-aware Context Gateway
  -> Canvas Context Runtime
  -> upstream model API
```

This work is not part of the initial v0.3 validation sequence unless Pi / OpenCode evidence justifies it.

Codex compatibility should answer:

> Can a proven Context Runtime be adapted to an Agent where the model-call boundary is exposed through protocol configuration rather than a native context hook?

It should not redefine the Runtime core.

---

## 5. Suggested repository layout

Direction only:

```text
packages/
  context-runtime/
    src/
      source/
      universe/
      representation/
      planning/
      working-set/
      observation/
      metrics/

  integrations/
    pi-context/
    opencode-context/
    codex-context/
```

If workspace / monorepo conventions make nested integration packages awkward, equivalent top-level package names are acceptable.

The important invariant is dependency direction, not directory aesthetics.

---

## 6. Experiment data policy

Early research data can become large and may contain source code or logs.

Requirements:

- do not persist credentials;
- redact known secret fields before durable storage;
- prefer hashes / references for repeated content;
- keep raw model-call payload retention opt-in and bounded;
- distinguish repository content from Agent-generated summaries;
- keep authority / provenance attached to derived summaries;
- do not silently promote model-generated summaries into authoritative project facts;
- benchmark fixtures should be reproducible from a known repository revision.

---

## 7. No premature product UI

Do not build a large Context Canvas before the experiments reveal what developers repeatedly need to inspect.

The first research UI, if needed, should be closer to a debugger:

```text
Run timeline
  -> Model Call
      -> Native Context
      -> Universe revision
      -> Proposed / Active Working Set
      -> ContextDecision / ContextTransition
      -> Tool Result
```

Useful early views:

- context-size timeline;
- Native vs Working Set comparison;
- KEEP / ADD / REMOVE / REPLACE / COMPRESS / REHYDRATE diff;
- decision reason codes;
- representation provenance;
- source observation status;
- task outcome / acceptance result.

Graph / Canvas visualization can be introduced after recurring relationship questions are observed.

---

## 8. Milestone gate

v0.3 Context Runtime research is considered successful enough to justify a v0.4 architecture decision only if all of the following are available:

1. model-call-level observation from at least one open Agent harness;
2. a repeatable Native benchmark;
3. Source Reconciliation and Universe revisions sufficient for replay;
4. a deterministic Shadow Working Set policy;
5. at least one real Dynamic rewrite experiment;
6. ContextDecision / ContextTransition evidence for every rewrite;
7. measured quality and context-efficiency results;
8. cross-model evidence from at least two model families, or an explicit documented reason this was not possible;
9. a second-harness portability result or a documented abstraction failure;
10. a decision on whether Codex / closed-Agent compatibility is worth pursuing next;
11. a decision on whether Context Runtime should remain inside Canvas Agent or begin extracting into an independently consumable package / service.

Do not pre-commit v0.4 to a managed Agent loop, graph database, multi-Agent orchestration or Codex gateway before this gate is reviewed.
