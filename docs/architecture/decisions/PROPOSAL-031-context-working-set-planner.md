# PROPOSAL-031 — Context Working Set / Planner / Decision model

- **Status:** PROPOSED — research architecture, not an implementation authorization
- **Target:** Context Runtime v0.3, after Product MVP v0.2 RC
- **Date:** 2026-08-10
- **Depends on:** `PROPOSAL-030-context-source-universe-model.md`
- **Compatibility constraint:** existing `ContextSnapshot`, `ExecutionRequest v2`, Worker and v0.2 persistence contracts remain unchanged

## 1. Problem

`PROPOSAL-030` separates runtime knowledge from runtime selection:

```text
Source Observation
        ↓
Source Reconciliation
        ↓
Context Universe
        ↓
Working Set Planning
        ↓
Context Working Set
```

The remaining core question is:

> Given the exact current Universe revision, task state and token budget, what information should occupy the model's active semantic context now, in what representation, and why?

This proposal defines the first research model for that decision boundary.

It intentionally does **not** define a final ranking algorithm. v0.3 must first make the Planner deterministic, observable and benchmarkable before introducing more sophisticated policies.

---

## 2. Decision summary

Introduce five distinct concepts:

```text
ContextPlanningRequest
    normalized inputs for one planning boundary

ContextRepresentation
    immutable model-usable representation derived from one or more SourceVersions

ContextWorkingSet
    immutable selected active semantic context for one planning boundary

ContextDecision
    one explainable KEEP / ADD / REMOVE / REPLACE / COMPRESS / REHYDRATE decision

ContextTransition
    ordered aggregate of decisions from one Working Set to the next
```

The complete planning path becomes:

```text
ContextUniverseRevision
        +
ContextPlanningRequest
        +
Previous Working Set (optional)
        |
        v
Working Set Planner
        |
        +--> ContextDecision[]
        |
        +--> ContextRepresentation[]
        |
        v
ContextWorkingSet
        |
        v
Protocol Renderer / Agent Integration
```

The key invariants are:

> **The Universe describes what is currently known. The Working Set describes what is currently active.**
>
> **A SourceVersion is not automatically a model representation.**
>
> **A ContextDecision explains a semantic planning choice; provider rendering is a later concern.**

---

## 3. `ContextRepresentation`: separate source truth from model form

A `ContextSourceVersion` is an immutable observed value. It should not be forced to equal the exact bytes sent to a model.

Examples:

```text
SourceVersion
repository/file://src/auth.ts @ hash-A

Possible representations
FULL_FILE
SYMBOL refreshSession
LINE_RANGE 120-220
DIFF against snapshot version
SUMMARY
METADATA_ONLY
```

Another example:

```text
SourceVersions
- grep-result-18
- test-run-6
- auth.ts symbol

Derived representation
SUMMARY: diagnosis-3
```

Therefore introduce an immutable representation layer.

Conceptual shape:

```ts
type ContextRepresentationId = Brand<string, 'ContextRepresentationId'>

type ContextRepresentationKind =
  | 'FULL'
  | 'SYMBOL'
  | 'LINE_RANGE'
  | 'DIFF'
  | 'SUMMARY'
  | 'METADATA'
  | 'REFERENCE'

interface ContextRepresentation {
  readonly id: ContextRepresentationId
  readonly kind: ContextRepresentationKind

  // Exact source material from which this representation is derived.
  readonly sourceVersionIds: readonly ContextSourceVersionId[]

  readonly contentRef: ContextContentRef
  readonly contentHash: string
  readonly tokenEstimate: number

  // NONE means semantically lossless for the intended source scope.
  readonly lossiness: 'NONE' | 'BOUNDED' | 'LOSSY'

  readonly derivation: ContextRepresentationDerivation
}
```

The exact kind union is not frozen. The existing design baseline's FULL_FILE / SYMBOL / LINE_RANGE / DIFF / SUMMARY / METADATA vocabulary is useful research input, but v0.3 evidence may refine it.

### 3.1 Representation invariant

Every representation must retain provenance to the SourceVersion(s) it derives from.

A summary must never become an orphan string.

```text
SUMMARY diagnosis-3
    derivedFrom
        grep-result-18:v1
        auth.ts:v4
        test-run-6:v1
```

This is required for:

- audit;
- replay;
- authority preservation;
- staleness checks;
- rehydration;
- replacement analysis.

### 3.2 Derived authority cannot silently increase

A representation derived from lower-authority material must not gain higher authority merely because it is concise or model-generated.

If a representation combines sources with different authorities, the policy must retain source-level provenance and use an explicit conservative authority rule.

Do not silently promote a model-generated summary into `PROJECT_FACT` or `PROJECT_RULE`.

### 3.3 Representation freshness

A representation is valid only against the SourceVersion IDs from which it was derived.

If `auth.ts:v4` becomes `auth.ts:v5`, a summary derived from `v4` may remain historical evidence but must not masquerade as a current representation of `v5`.

---

## 4. `ContextWorkingSet`: immutable active semantic state

A Working Set is the Planner's immutable result for one Recomposition Boundary.

It is not the entire Universe and it is not yet a provider-specific request.

Conceptual shape:

```ts
type ContextWorkingSetId = Brand<string, 'ContextWorkingSetId'>

interface ContextWorkingSet {
  readonly id: ContextWorkingSetId
  readonly runtimeSessionId: string
  readonly sequence: number

  readonly plannedFromUniverseSequence: number
  readonly plannedFromUniverseHash: string
  readonly previousWorkingSetId: ContextWorkingSetId | null

  readonly policyVersion: string
  readonly planningRequestHash: string

  readonly items: readonly ContextWorkingSetItem[]
  readonly totalTokenEstimate: number
  readonly budget: ContextBudget

  readonly mode: 'SHADOW' | 'ACTIVE'
  readonly logicalHash: string
  readonly createdAt: string
}
```

A Working Set should be immutable after creation. A later change creates another Working Set and a `ContextTransition`.

### 4.1 `ContextWorkingSetItem`

A Working Set item points to a selected representation, not directly to arbitrary text.

Conceptual shape:

```ts
interface ContextWorkingSetItem {
  readonly position: number
  readonly representationId: ContextRepresentationId

  readonly sourceKeys: readonly ContextSourceKey[]
  readonly sourceVersionIds: readonly ContextSourceVersionId[]

  readonly authority: ContextAuthority
  readonly baselinePriority: ContextPriority

  readonly protection: ContextProtection
  readonly tokenEstimate: number

  readonly inclusionReasonCodes: readonly ContextReasonCode[]
}
```

The same source may appear in a different representation in a future Working Set without changing source identity.

### 4.2 Working Set is semantic, renderer is protocol-specific

The Working Set should not contain Pi-specific messages, OpenAI Responses items, Anthropic message blocks or OpenCode internal provider state.

Those belong to the rendering / integration layer.

```text
ContextWorkingSet
        |
        v
Pi renderer / OpenCode adapter / Codex gateway
        |
        v
Provider request
```

Provider-native protocol continuity must not be treated as a semantic Working Set decision.

---

## 5. `ContextPlanningRequest`: normalized current need

The Planner needs more than a Universe and token count. It requires a normalized description of the current execution state.

Conceptual shape:

```ts
interface ContextPlanningRequest {
  readonly runtimeSessionId: string
  readonly recompositionSequence: number

  readonly taskRef: string
  readonly taskPhase: ContextTaskPhase

  readonly currentTargets: readonly ContextTargetRef[]
  readonly currentRepositoryRevisionRef?: string
  readonly currentDiffRef?: string
  readonly latestVerificationRefs: readonly string[]

  readonly budget: ContextBudget
  readonly hardConstraints: readonly ContextPlanningConstraint[]

  readonly pinnedSourceKeys: readonly ContextSourceKey[]
  readonly excludedSourceKeys: readonly ContextSourceKey[]

  readonly previousWorkingSetId: ContextWorkingSetId | null
  readonly adapterCapabilities: ContextBoundaryCapabilities
}
```

Exact fields are deferred until Pi Shadow data is available.

The important constraint is that the Planner consumes normalized semantic state rather than raw provider messages.

### 5.1 First task phases

For research, a small vocabulary is enough:

```text
INVESTIGATE
PLAN
IMPLEMENT
DEBUG
VERIFY
GENERAL
```

The Planner must not require an LLM to classify the phase in the first implementation. A harness may provide explicit phase hints; otherwise use `GENERAL`.

### 5.2 Budget is multi-part

Do not model budget as only one integer if experiments show other constraints matter.

Conceptually:

```ts
interface ContextBudget {
  readonly maxSemanticTokens: number
  readonly reservedProtocolTokens?: number
  readonly reservedOutputTokens?: number
}
```

The semantic Planner owns only its semantic budget. Provider-specific protocol reservation belongs to the integration/profile layer.

---

## 6. Protection: some context is not freely evictable

Authority and P0-P3 priority are inputs, but eviction safety deserves an explicit planning concept.

Conceptual shape:

```ts
type ContextProtection =
  | 'MANDATORY'
  | 'PINNED'
  | 'NORMAL'
  | 'COLD_PREFERRED'
```

Initial semantics:

```text
MANDATORY
    required by execution contract / policy; planner cannot remove silently

PINNED
    explicitly pinned for this Run / experiment; requires explicit override path

NORMAL
    normal planner candidate

COLD_PREFERRED
    retained in Universe but normally excluded unless current need justifies rehydration
```

P0 Task instruction should normally map to `MANDATORY` in the first policy.

High authority does not automatically mean permanently active, but high-authority unavailable state must be handled conservatively.

---

## 7. `ContextDecision`: explain one planning choice

A decision describes why the active semantic context changed or remained active.

Initial decision vocabulary:

```ts
type ContextDecisionKind =
  | 'KEEP'
  | 'ADD'
  | 'REMOVE'
  | 'REPLACE'
  | 'COMPRESS'
  | 'REHYDRATE'
```

### 7.1 KEEP

The representation remains active across two Working Sets.

Typical reasons:

```text
mandatory task instruction
current implementation target
latest failing verification evidence
explicit user pin
```

### 7.2 ADD

A Universe source / representation becomes active for the first time or after not previously being active.

Typical triggers:

```text
new current target
new tool evidence
new test failure
new current diff
source became task-relevant
```

### 7.3 REMOVE

An active representation becomes inactive while its underlying evidence remains durable / recoverable.

Typical reasons:

```text
ruled out investigative path
superseded evidence
phase no longer requires detail
budget pressure on low-value context
source confirmed absent
```

`REMOVE` means active-set eviction, not permanent deletion.

### 7.4 REPLACE

One active representation is replaced by another representation that preserves the currently required semantics.

Examples:

```text
auth.ts FULL
    -> auth.ts SYMBOL refreshSession

old snapshot diff
    -> current workspace diff
```

`REPLACE` should be preferred over `REMOVE + ADD` when the semantic relationship is explicit and useful for explanation.

### 7.5 COMPRESS

One or more active representations are replaced by a smaller derived representation.

Example:

```text
grep output
+ test failure
+ investigation notes
    -> diagnosis summary
```

COMPRESS must record all source provenance and whether the representation is lossy.

The first experiments should not require opaque LLM summarization. Deterministic or reviewed derived summaries are preferred initially.

### 7.6 REHYDRATE

A previously inactive or compressed-away source representation becomes active again because current task state requires detail.

Examples:

```text
old failing test signature matches new failure
summary is insufficient to answer implementation question
previously ruled-out file becomes relevant after new evidence
```

REHYDRATE is a first-class event because false removals cannot be measured otherwise.

---

## 8. Decision shape and reason codes

Do not persist only free-form explanation text.

Use stable machine-readable reason codes plus optional human-readable detail.

Conceptual shape:

```ts
type ContextReasonCode =
  | 'MANDATORY_INSTRUCTION'
  | 'USER_PINNED'
  | 'CURRENT_TARGET'
  | 'CURRENT_DIFF'
  | 'LATEST_FAILURE'
  | 'DIRECT_DEPENDENCY'
  | 'DERIVED_DECISION'
  | 'SUPERSEDED'
  | 'RULED_OUT'
  | 'PHASE_IRRELEVANT'
  | 'STALE'
  | 'BUDGET_PRESSURE'
  | 'REPRESENTATION_NARROWED'
  | 'SUMMARY_SUFFICIENT'
  | 'DETAIL_REQUIRED'
  | 'SOURCE_ABSENT'
  | 'SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP'

type ContextDecision =
  | KeepDecision
  | AddDecision
  | RemoveDecision
  | ReplaceDecision
  | CompressDecision
  | RehydrateDecision
```

Each decision should record at minimum:

```text
decision id
kind
from Working Set id
source / representation subjects
reason codes
policy version
planner inputs / evidence refs needed to explain the decision
estimated token delta
```

Free-form explanation may be generated for UI, but it must not be the only audit record.

---

## 9. `ContextTransition`: ordered Working Set state change

A transition aggregates the exact semantic changes from one Working Set to the next.

Conceptual shape:

```ts
interface ContextTransition {
  readonly id: string
  readonly runtimeSessionId: string
  readonly sequence: number

  readonly fromWorkingSetId: ContextWorkingSetId | null
  readonly toWorkingSetId: ContextWorkingSetId

  readonly triggerRefs: readonly string[]
  readonly decisions: readonly ContextDecision[]

  readonly nativeContextEstimate?: number
  readonly fromTokenEstimate: number
  readonly toTokenEstimate: number

  readonly policyVersion: string
  readonly createdAt: string
}
```

### 9.1 Transition must be replayable

Given:

```text
from Working Set
Universe revision
PlanningRequest
Policy version
```

research tooling should be able to reproduce the same proposed transition for a deterministic policy.

### 9.2 Initial Working Set

The first Working Set has:

```text
fromWorkingSetId = null
```

and is explained using `ADD` / `KEEP`-equivalent initialization decisions as appropriate.

---

## 10. Membership decision and representation decision are separate

The Planner must conceptually solve two related but distinct questions.

### Question A — membership

```text
Should this information be active now?
```

Possible result:

```text
ACTIVE
COLD
EXCLUDED
MANDATORY
```

### Question B — representation

If active:

```text
How much detail is needed now?
```

Possible representations:

```text
FULL
SYMBOL
LINE_RANGE
DIFF
SUMMARY
METADATA
REFERENCE
```

Do not use representation narrowing to hide a bad membership decision.

Example:

```text
login.ts is irrelevant
```

should result in:

```text
REMOVE / COLD
```

not:

```text
keep useless metadata just because it is cheap
```

Conversely:

```text
auth.ts is relevant, but only refreshSession matters
```

should result in:

```text
KEEP source membership
REPLACE FULL -> SYMBOL
```

This distinction is central to measuring context quality rather than only token size.

---

## 11. First deterministic Planner policy

The v0.3 first policy should be deliberately simple and inspectable.

Do not begin with another LLM deciding the whole Working Set.

A useful first-pass policy pipeline is:

```text
1. Apply hard constraints / mandatory items
2. Apply explicit pins and excludes
3. Admit current targets
4. Admit latest verification / failure evidence
5. Admit direct dependencies / derivations
6. Prefer current workspace state over superseded versions
7. Demote ruled-out / superseded / stale evidence to cold
8. Choose the narrowest safe representation
9. If over budget, evict lowest-value NORMAL items deterministically
10. Preserve rehydration references for every eviction / compression
```

### 11.1 Suggested deterministic ordering inputs

Initial ranking inputs may include:

```text
protection
baseline priority
current-target relationship
latest verification relationship
direct dependency distance
source freshness
superseded state
phase affinity
previous Working Set membership
estimated token cost
```

Authority is a conflict / trust property, not a generic relevance score. Do not simply sort `PROJECT_RULE > TASK_INSTRUCTION > ...` and call that relevance.

### 11.2 Stability / churn penalty

A Planner that changes Working Set unnecessarily on every call can destroy cache locality and make the system hard to reason about.

The first policy should include a small explicit preference for keeping a still-useful existing representation rather than replacing it with a nearly equivalent one.

This can be conceptualized as a **churn penalty**, not as a reason to retain stale context forever.

Track:

```text
items added per call
items removed per call
representations replaced per call
Working Set token delta
stable-prefix estimate when measurable
```

---

## 12. Rehydration rules

REHYDRATE must not be an ad-hoc emergency escape hatch.

Every REMOVE / COMPRESS decision should retain enough information to determine what can be restored.

A first deterministic rehydration trigger set may include:

```text
current target points to cold source
new evidence depends on cold source
new failure signature references cold evidence
selected summary lacks required representation detail
explicit user / debugger request
previous removal reason no longer holds
```

The Runtime should record:

```text
removal sequence
rehydration sequence
reason for original removal
reason for restoration
time/call distance while cold
```

This enables a critical benchmark metric:

> How often did the Planner remove something that it soon needed again?

---

## 13. False removal and useful removal

A token reduction is not automatically a good decision.

Research must distinguish:

```text
Useful removal
    source remained unnecessary until task completion or was safely represented elsewhere

False removal
    source had to be restored quickly or its absence contributed to a wrong model decision / repeated tool read / task failure
```

The exact attribution algorithm is research work, but the data model must make the analysis possible.

Useful early proxies:

```text
rehydrated within N model calls
same file/tool source re-read after removal
model asks for information that was recently removed
failure disappears when Native context is restored
```

Do not claim causal false-removal automatically from one proxy; preserve evidence for review.

---

## 14. Handling stale and unavailable sources

`PROPOSAL-030` distinguishes `ABSENT` from `UNAVAILABLE`.

Working Set policy should react differently.

### Confirmed ABSENT

If a current representation depends on a source now confirmed absent:

```text
REMOVE or REPLACE
```

unless the representation is intentionally historical evidence.

### UNAVAILABLE

If current state cannot be observed:

- do not silently delete the last known version;
- retain provenance that the version is stale / unconfirmed;
- high-protection / high-authority items default to conservative keep;
- low-value references may move cold under explicit policy;
- decisions must use `SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP` or another explicit reason code.

---

## 15. Relationship to Snapshot P0-P3 and authority

Existing v0.2 semantics remain useful inputs.

Initial mapping direction:

```text
Snapshot Task Instruction / P0
    -> MANDATORY

P1
    -> strong retention candidate when task-relevant

P2
    -> normal phase / dependency selection

P3
    -> cold by default unless justified
```

This is not a permanent rule for every source type.

Authority and priority remain separate:

```text
Authority
    conflict / trust semantics

Priority
    baseline importance hint

Planner relevance
    current execution need

Protection
    eviction constraint
```

Do not collapse these into one score.

---

## 16. Shadow Mode contract

The first implementation target is still Shadow Mode.

At each Pi model-call boundary:

```text
Native Agent Context
        |
        +--> observed only

Current Universe Revision
        +
PlanningRequest
        +
Previous Shadow Working Set
        |
        v
Planner
        |
        v
Shadow ContextWorkingSet
        +
ContextTransition proposal
```

The real model request remains unchanged.

Shadow Mode must record enough evidence to answer:

```text
What would Canvas have kept?
What would it have removed?
What representation would it have chosen?
What would it have rehydrated?
Why?
How many tokens would change?
Did later behavior suggest the decision was wrong?
```

---

## 17. ACTIVE Mode gate

Real rewrite must not start merely because Shadow output looks smaller.

Before ACTIVE mode:

1. Native baseline corpus exists.
2. Shadow transitions are deterministic for normalized identical inputs.
3. Every REMOVE / REPLACE / COMPRESS has source provenance and reason codes.
4. Rehydration paths are implemented in research tooling.
5. Mandatory / pinned protections are test-locked.
6. Representation staleness is detectable.
7. Tool-call / protocol continuity remains outside semantic Planner control.
8. A per-Run kill switch can restore Native behavior.

---

## 18. Planner / renderer boundary

The Planner outputs semantic representation choices.

The Renderer / integration owns transport concerns such as:

```text
message roles
provider tool-call pairs
reasoning items
opaque provider state
cache-control fields
provider-specific system-message rules
API payload shape
```

If an Agent integration cannot safely realize a semantic Working Set decision, its capability profile must say so.

Do not weaken the Runtime model by pretending every adapter supports identical rewrite capabilities.

---

## 19. Proposed package responsibility

Direction only:

```text
packages/context-runtime/
  source/
      ContextSource
      ContextSourceVersion
      SourceReconciliation

  universe/
      ContextUniverseRevision

  representation/
      ContextRepresentation

  planning/
      ContextPlanningRequest
      ContextPolicy
      ContextDecision
      WorkingSetPlanner

  working-set/
      ContextWorkingSet
      ContextWorkingSetItem
      ContextTransition

  metrics/
      churn
      rehydration
      false-removal evidence
      token estimates
```

Integration packages remain outside the core.

---

## 20. OpenCode comparison after this proposal

OpenCode remains a strong reference for:

```text
stable Context Source identity
source reconciliation
safe provider-turn boundaries
context lifecycle
baseline + dynamic updates
compaction
```

This proposal deliberately focuses downstream:

```text
OpenCode-style Source Reconciliation
        ↓
Canvas Context Universe
        ↓
Canvas Working Set Planner
        ↓
KEEP / ADD / REMOVE / REPLACE / COMPRESS / REHYDRATE
```

The research claim is **not** that OpenCode lacks context management.

The claim to test is:

> Relevance-driven active Working Set planning provides measurable value beyond source synchronization and threshold-driven compaction.

This remains a hypothesis until benchmarked.

---

## 21. Non-goals

This proposal does not freeze:

- final TypeScript public contracts;
- SQL persistence tables;
- final ContextRepresentation kind union;
- vector / embedding ranking;
- graph database storage;
- learned ranking models;
- LLM-based Planner decisions;
- provider-specific rendering;
- Pi / OpenCode plugin APIs;
- final task-phase classifier;
- a universal token estimator;
- stable public SDK compatibility.

These require Shadow Mode evidence.

---

## 22. Test invariants for a future implementation packet

When implementation is authorized, minimum tests should cover:

### Identity / representation

- representation provenance references exact SourceVersion IDs;
- changed SourceVersion invalidates current representation freshness where applicable;
- derived summaries cannot silently increase authority;

### Protection

- MANDATORY item cannot be removed by ordinary budget eviction;
- explicit pin survives normal ranking;
- explicit exclude cannot override a hard mandatory contract without a separately modeled conflict/error path;

### Determinism

- same normalized Universe + PlanningRequest + policyVersion -> same Working Set logical hash;
- deterministic tie-breaking for equal-ranked entries;

### Decisions

- every membership change has ADD / REMOVE / REHYDRATE reason;
- every representation change has REPLACE / COMPRESS reason;
- token deltas match selected representation estimates;

### Universe binding

- Working Set binds to exact Universe sequence/hash;
- Planner cannot use SourceVersions absent from that Universe revision unless explicitly rehydrating an addressable historical version;

### Replay

- transition can be recomputed from normalized inputs in Shadow fixtures;
- policy version change produces a distinguishable plan hash;

### Separation

- core Planner receives no Pi / OpenCode / Codex raw provider payload types;
- provider rendering cannot mutate the persisted semantic Working Set identity silently.

---

## 23. Questions to answer with CR-003 Shadow evidence

Do not freeze answers before data exists:

1. Is one Working Set per model call necessary, or can identical plans reuse one immutable Working Set ID across calls?
2. Which representation kinds occur often enough to deserve first-class types?
3. How should dependency distance be computed without prematurely requiring a graph database?
4. How much churn is caused by naive phase/task ranking?
5. What percentage of removals are rehydrated within 1 / 3 / 5 model calls?
6. Are full-file -> symbol / line-range replacements materially useful, or do models repeatedly re-read full files?
7. Is a stable Context Spine needed as a Planner concept, or only as a renderer/cache optimization?
8. Should model profile influence only budget/rendering, or also Working Set policy?
9. Which evidence is sufficient to classify a removal as harmful?
10. Does an explainable deterministic policy provide enough value before any learned/LLM planner is introduced?

The answers should drive the first implementation proposal, not assumptions made here.
