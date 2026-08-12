# OpenCode V2 Context Architecture Comparison

- **Status:** RESEARCH NOTE — architecture input, not a frozen Canvas Agent contract
- **Date:** 2026-08-10
- **Depends on:** `docs/architecture/context-runtime-v0.3-direction.md`
- **Primary external reference:** OpenCode commit `d041eee55c4b669f583fcbe0eb73e78d53393ae8`, especially `CONTEXT.md` and `specs/v2/session.md`
- **Purpose:** absorb useful OpenCode V2 context-runtime ideas without collapsing Canvas Agent's distinct Context Working Set hypothesis into OpenCode terminology

> Important: OpenCode V2 is still evolving. This document records the current public design as a reference implementation and comparison target, not as a stable external contract.

---

## 1. Executive conclusion

OpenCode V2 already implements or specifies several ideas that strongly validate the direction of Canvas Agent's Context Runtime:

- durable history is separate from active model context;
- model-visible context is assembled at provider-turn boundaries rather than treated as one permanently growing prompt;
- context sources have stable identity and typed state;
- source changes are reconciled at a safe model-call boundary;
- an immutable provider-cache baseline can coexist with chronological dynamic updates;
- compaction changes the active representation without deleting durable history;
- unavailable context has explicit stale-state semantics rather than silently becoming empty;
- provider-native state must be preserved across request reconstruction.

These ideas should be treated as **architecture lessons we can reuse**, not as Canvas Agent differentiators.

The main Canvas Agent research hypothesis remains further downstream:

> OpenCode primarily asks: **what context source changed and how should that change be synchronized?**
>
> Canvas Context Runtime additionally asks: **given everything currently known, what is the smallest sufficiently useful Context Working Set for this execution state, and what should be dropped, replaced, compressed or rehydrated now?**

Therefore OpenCode V2 should be treated as:

```text
Context source/state runtime reference
        +
Context lifecycle / compaction reference
        +
strong native baseline for experiments
```

rather than as a reason to abandon Context Working Set research.

---

## 2. OpenCode ideas Canvas Agent should adopt

### 2.1 Stable context-source identity

OpenCode models a Context Source as an independently observed typed value identified by a stable, namespaced key.

Canvas should adopt the same principle.

Do not model runtime context only as anonymous strings such as:

```text
"contents of auth.ts"
"latest project rule"
"some test output"
```

Prefer stable source identity:

```text
project-rule:root/CONTRIBUTING.md
repository-file:src/auth.ts
repository-symbol:src/auth.ts#refreshSession
run-tool-result:tool-call-018
run-test-result:test-run-006
artifact:decision-023
```

A stable source identity enables the Runtime to distinguish:

```text
same source, unchanged value
same source, changed value
new source
confirmed removal
unavailable source
superseded representation
```

This is required for reliable reconciliation, deduplication, provenance and rehydration.

### Proposed Canvas direction

Introduce a provider-neutral concept similar to:

```ts
interface ContextSourceDescriptor {
  sourceKey: string
  sourceKind: ContextSourceKind
  authority: ContextAuthority
  provenance: ContextProvenance
}
```

The exact contract remains deferred until v0.3 Shadow data exists.

---

### 2.2 Typed source state instead of prompt fragments

OpenCode Context Sources are typed values with codecs and pure renderers rather than raw prompt fragments.

Canvas should preserve the same separation:

```text
Source state
    !=
Rendered model text
```

For example:

```text
Context Source State

repository-symbol:src/auth.ts#refreshSession
{
  revision: ...,
  signature: ...,
  bodyHash: ...,
  resolvedContentRef: ...
}
```

can later render differently for:

```text
Pi
OpenCode
Codex
OpenAI-compatible chat
Anthropic messages
future managed loop
```

This supports the project rule that `packages/context-runtime` must remain Agent-neutral and model-neutral.

---

### 2.3 Safe Provider-Turn Boundary

OpenCode does not asynchronously push context changes into a currently executing model turn.

Instead it observes and reconciles context immediately before the next provider call at a defined Safe Provider-Turn Boundary.

Canvas should adopt an equivalent explicit boundary.

Proposed term:

```text
Recomposition Boundary
```

Default rule:

```text
World / Run changes
      |
      v
record observations
      |
      v
NEXT safe model-call boundary
      |
      +--> reconcile source state
      +--> update Context Universe
      +--> compose Working Set
      +--> record Context Transition
      +--> render provider request
      v
LLM
```

Do not mutate an in-flight model request because a file watcher, tool process or background observer changed state.

This improves determinism, replayability and race handling.

---

### 2.4 Stable baseline plus chronological dynamic updates

OpenCode Context Epoch keeps one immutable Baseline System Context during an epoch and represents ordinary source changes as chronological system updates.

The motivation includes preserving a stable provider-cache prefix.

Canvas should not blindly rebuild every token of context on every call if a large stable prefix can remain unchanged.

A useful Canvas decomposition is:

```text
Stable Context Spine
--------------------
Task instruction
high-authority project rules
critical constraints
stable execution contract facts

Dynamic Working Set
-------------------
relevant code
recent evidence
current diff
tool results
current diagnosis
phase-specific references
```

This gives us a possible optimization target:

```text
RenderedContext(t)
=
StableContextSpine(epoch)
+
DynamicWorkingSet(t)
+
ProtocolSpine(t)
```

The exact transport behavior is provider-dependent, but the logical separation is useful even before cache optimization is implemented.

---

### 2.5 Epochs are useful, but should not replace Working Sets

OpenCode defines a Context Epoch as the span during which one baseline System Context remains the immutable provider-cache baseline.

Canvas can borrow the epoch idea for **render/presentation stability**, but should not equate it with a Context Working Set.

Possible Canvas concept:

```text
Context Render Epoch
```

An epoch may contain many Working Sets:

```text
Render Epoch #7

Stable Context Spine
      |
      +--> Working Set #31
      +--> Working Set #32
      +--> Working Set #33
      +--> Working Set #34
```

A new epoch could be started by:

- compaction / representation reset;
- incompatible provider switch;
- a baseline-replacing context transition;
- repository/world transition that invalidates the stable spine;
- explicit replay / restore policy.

This concept is optional for v0.3 implementation but should remain available in the architecture.

---

### 2.6 Explicit unavailable-context semantics

OpenCode distinguishes:

```text
source successfully loaded as absent
```

from:

```text
source temporarily unavailable
```

and uses stale-while-revalidate semantics for the latter.

Canvas should do the same.

A failed file read, temporary external source failure, unavailable repository observer or plugin timeout must not silently mean:

```text
"this context no longer exists"
```

Possible state model:

```ts
type ContextSourceObservation<T> =
  | { kind: 'AVAILABLE'; value: T }
  | { kind: 'ABSENT' }
  | { kind: 'UNAVAILABLE'; reasonCode: string }
```

Policy implication:

```text
ABSENT
    may trigger REMOVE / revocation

UNAVAILABLE
    normally preserves last admitted effective value
    and emits diagnostic evidence
```

This is especially important once the Context Runtime integrates remote sources or multiple Agent adapters.

---

### 2.7 Durable history must remain separate from active representation

OpenCode compaction preserves durable session history while replacing the active model representation with a checkpoint containing a summary and recent tail.

Canvas should retain the same invariant:

```text
Durable evidence
    !=
Active Working Set
    !=
Rendered model request
```

Removing an item from a Working Set must not delete it from Context Universe or Run evidence.

This directly supports:

```text
REHYDRATE
Replay
Audit
False-removal analysis
Context Diff
```

---

### 2.8 Reconciliation should be deterministic and atomically observable

OpenCode `SystemContext.reconcile(...)` returns a bounded next action such as unchanged, updated or replacement state, and advances the model-hidden snapshot together with the durable update.

Canvas should keep the same architectural discipline.

A Context Transition should never be inferred later only from two unrelated prompt dumps.

It should be recorded as a first-class decision:

```text
ContextTransition

fromWorkingSet
-> toWorkingSet

operations:
KEEP
ADD
REMOVE
REPLACE
COMPRESS
REHYDRATE

reasons
source observations
policy version
budget state
```

The transition record and resulting materialized Working Set should be committed consistently enough that explanation and replay cannot disagree about which decision produced which context.

---

### 2.9 Protocol/provider state is not generic semantic text

OpenCode V2 explicitly avoids carrying provider-native assistant, reasoning and tool messages across compaction boundaries when the earlier prefix changes, because provider-native signatures or encrypted reasoning may no longer remain valid.

This reinforces the Canvas `Protocol Spine` concept.

Canvas must distinguish:

```text
Semantic Context
    project facts
    files
    code symbols
    evidence
    summaries
    decisions

Protocol Spine
    tool-call continuity
    provider-native reasoning state
    opaque continuation metadata
    request/response correlation state
```

A generic Context Policy may govern Semantic Context.

A protocol adapter owns Protocol Spine preservation.

The Runtime must never claim provider independence by pretending provider-native state does not exist.

---

## 3. Terminology mapping

The following mapping is intentionally **not** one-to-one.

| OpenCode V2 | Closest Canvas concept | Mapping | Decision |
|---|---|---|---|
| Context Source | Context Source / Context Candidate origin | Strong overlap | Adopt stable keyed typed-source idea |
| System Context Registry | Part of Context Universe | Partial | Universe is broader than System Context sources |
| Context Snapshot | Source admission/reconciliation state | **Naming conflict** | Never map to Canvas `ContextSnapshot` |
| Context Epoch | Context Render Epoch / stable-spine lifetime | Partial | Useful rendering/cache concept, not Working Set |
| Baseline System Context | Stable Context Spine / epoch baseline | Partial | Borrow concept, preserve provider-neutral logical form |
| Mid-Conversation System Message | Rendered effect of a Context Transition | Partial | Canvas Transition is richer than one system message |
| Safe Provider-Turn Boundary | Recomposition Boundary | Strong overlap | Adopt explicitly |
| Session History | Durable Agent/Run trajectory | Strong overlap | Keep distinct from active context |
| Provider Turn | Model Call | Strong overlap | Map to `ModelCallObservation` |
| Compaction Checkpoint | Compressed active-history representation | Strong overlap | Treat as representation, not source-of-truth history |
| SystemContext.initialize | Initial source observation + render baseline | Partial | Canvas initial anchor still comes from immutable Run Snapshot |
| SystemContext.reconcile | Source-state reconciliation | Strong overlap | Reuse idea below Working Set composition |
| SystemContext.replace | Epoch/baseline replacement | Partial | May become Render Epoch transition |
| Unavailable Context | Unavailable source observation | Strong overlap | Adopt stale-state semantics |

---

## 4. Critical naming conflict: Context Snapshot

This is the most important incompatibility in terminology.

### OpenCode `Context Snapshot`

Current OpenCode V2 meaning:

```text
model-hidden
mutable / overwriteable
per-Context-Source admitted state
used by reconcile() to compare live source value
```

### Canvas `ContextSnapshot`

Existing frozen Canvas meaning:

```text
Run-start immutable anchor
bound to TaskSpecVersion / Baseline / RepositoryRevision
contains resolved frozen initial context
content-hashed and auditable
must never change after FROZEN
```

Therefore:

```text
OpenCode Context Snapshot
!=
Canvas ContextSnapshot
```

When implementing an OpenCode adapter, use an adapter-facing name such as:

```text
OpenCodeSourceStateSnapshot
```

or the provider-neutral Canvas concept:

```text
ContextSourceAdmissionState
```

Do not rename or weaken the existing Canvas `ContextSnapshot` invariant.

---

## 5. Layered architecture after comparison

The comparison suggests Canvas should explicitly split context handling into **three runtime stages**, not one Composer function.

```text
                 Durable / World Sources
                         |
                         v
              [1] Source Reconciliation
                         |
                         | stable identity
                         | changed / absent / unavailable
                         v
                  Context Universe
                         |
                         v
              [2] Working Set Planning
                         |
                         | relevance
                         | phase
                         | authority
                         | dependencies
                         | freshness
                         | budget
                         v
                Context Working Set(t)
                         |
                         v
              [3] Protocol Rendering
                         |
                         | Stable Context Spine
                         | Dynamic Working Set
                         | Protocol Spine
                         v
                  Provider Request
```

This is a useful refinement of the previous Context Runtime model.

### Stage 1 — Source Reconciliation

Answers:

> What changed in the available world/context sources?

Likely inspired heavily by OpenCode.

### Stage 2 — Working Set Planning

Answers:

> Of everything currently known, what should be active now?

This remains Canvas Agent's primary research area.

### Stage 3 — Protocol Rendering

Answers:

> How is the selected semantic state safely represented for this Agent/model/provider?

This belongs to adapters and provider-specific renderers.

---

## 6. What OpenCode already solves well enough that Canvas should not reinvent it as a differentiator

The following should be considered reference patterns rather than unique Canvas claims:

1. **Stable context-source keys.**
2. **Typed context-source values and explicit codecs.**
3. **Deterministic composition order.**
4. **Safe model-call boundary for admitting context changes.**
5. **Explicit unavailable versus absent source semantics.**
6. **Immutable baseline within a cache/presentation epoch.**
7. **Chronological context-update admission.**
8. **Durable history separate from active model representation.**
9. **Compaction as active-representation replacement rather than historical deletion.**
10. **Provider-specific continuity treated conservatively.**
11. **Current context reconstruction based on persisted state rather than process memory alone.**
12. **Clear separation between context source ownership and provider-turn request assembly.**

Canvas can implement equivalents where needed, but product/research differentiation should not rely on claiming these ideas are novel.

---

## 7. Where Canvas Context Runtime remains materially different

### 7.1 Context Universe is broader than OpenCode System Context

OpenCode System Context primarily models privileged/system contextual facts such as environment, instructions and skill guidance.

Canvas Context Universe is intended to contain all candidates that may become active semantic context, including:

```text
Project facts
Project rules
Task instructions
Repository files
Code symbols
Git diff
Tool observations
Test evidence
Decisions
Artifacts
Prior summaries
Historical cold context
User input
```

Therefore the OpenCode System Context Registry is best viewed as one possible **source family** inside Canvas Context Universe.

---

### 7.2 Canvas wants relevance-driven active membership

OpenCode source reconciliation primarily asks:

```text
Did this source change?
Was it removed?
Is it unavailable?
Should a new effective value be admitted?
```

Canvas Working Set Planning additionally asks:

```text
Is this source still useful for the current execution state?
Should it remain active even though it did not change?
Should an unchanged source become cold?
Should a full file become a symbol-level representation?
Should old evidence be rehydrated because the task state changed?
```

This is the central difference.

---

### 7.3 DROP / REPLACE / REHYDRATE are first-class semantic decisions

OpenCode V2 has compaction and source replacement semantics, but its public design is not a general relevance-driven Working Set optimizer over all coding evidence.

Canvas explicitly wants transitions such as:

```text
REMOVE
- grep output #19
  because diagnosis #23 supersedes it

REPLACE
- full src/auth.ts
+ symbol refreshSession()
  because the implementation target has narrowed

REHYDRATE
+ old failing test #8
  because the current failure signature matches prior evidence
```

These decisions must be explainable and benchmarkable.

---

### 7.4 Canvas Context Runtime must be cross-Agent

OpenCode's Context Runtime is naturally owned by OpenCode Session Runtime.

Canvas is intentionally pursuing:

```text
Pi
OpenCode
Codex
future managed loops
        |
        v
same provider-neutral Context Runtime
```

Cross-Agent portability is itself part of the hypothesis.

A policy that only works because of one Agent's native Session semantics is not yet a reusable Canvas Context Runtime policy.

---

### 7.5 Canvas wants user-visible context-decision observability

Canvas plans to make context management itself inspectable:

```text
why included
why excluded
why representation changed
why compressed
why rehydrated
what token budget changed
what evidence supports the decision
```

The target product experience includes Context Timeline / Diff / Replay and eventually PIN / EXCLUDE / REHYDRATE / COMPARE controls.

This control-plane focus is broader than native runtime context synchronization alone.

---

## 8. Revised Canvas Context state model

The comparison suggests the following conceptual model.

```text
RunContextSnapshot
    immutable initial anchor

ContextSourceState
    latest observed/admitted state per stable source key

ContextUniverse
    durable candidate information derived from Snapshot + reconciled sources + Run evidence

ContextWorkingSet
    active selected semantic context for one execution state / model call

ContextTransition
    explainable change between Working Sets

ContextRenderEpoch
    optional lifetime of a stable rendered prefix / baseline

RenderedContextRecord
    exact Agent/provider-specific representation for one model call

RunTrace
    durable execution events and observations

ContextDecisionTrace
    durable selection / removal / replacement / compression / rehydration decisions
```

Relationship:

```text
RunContextSnapshot ---------------------------+
                                             |
World / Run sources                           |
      |                                       |
      v                                       |
Context Source Reconciliation                 |
      |                                       |
      +----> ContextSourceState               |
      |                                       |
      v                                       v
               Context Universe <-------------+
                       |
                       v
               Working Set Planner
                       |
                       v
              ContextWorkingSet(t)
                       |
                       +----> ContextTransition / DecisionTrace
                       |
                       v
                Protocol Renderer
                       |
                       v
              RenderedContextRecord
                       |
                       v
                    Model
```

---

## 9. Proposed responsibilities inside `packages/context-runtime`

The architecture comparison suggests separating the future package internally rather than creating one monolithic composer.

Possible structure:

```text
packages/context-runtime/

  source/
    identity
    observation
    reconciliation

  universe/
    candidate registry
    provenance
    durable refs

  planner/
    policy
    relevance
    budget
    working-set composition

  transition/
    diff
    reason codes
    rehydration history

  render/
    provider-neutral render plan
    stable-spine / dynamic-set separation

  metrics/
    token estimates
    false-removal
    rehydration
    context utility measurements
```

Agent/provider integration packages remain outside this core:

```text
integrations/pi
integrations/opencode
integrations/codex
```

The dependency direction stays:

```text
integration ---> context-runtime

context-runtime -X-> integration
```

---

## 10. OpenCode integration implications

The architecture comparison changes how CR-007 OpenCode portability should be approached.

Do not begin by mapping Canvas concepts one-to-one onto OpenCode names.

The first OpenCode integration research should answer:

1. What exact hook or V2 boundary can expose the complete semantic model-call input without corrupting provider-native state?
2. Can Canvas operate only on selected semantic/history messages while leaving OpenCode's Baseline System Context and provider-native Protocol Spine intact?
3. Can OpenCode Context Sources be imported into Canvas as stable Context Sources without duplicating OpenCode's own reconciliation work?
4. Should Canvas consume OpenCode-reconciled System Context as one aggregate source, or each source independently?
5. Can Canvas Working Set decisions be applied after OpenCode source reconciliation but before provider request rendering?
6. Which OpenCode native compaction features should remain enabled during benchmark experiments?
7. How do we prevent double-compaction or double-summary behavior?
8. How should Context Epoch boundaries map to Canvas Render Epoch diagnostics, if at all?
9. Can OpenCode native Context Source changes and Canvas relevance decisions coexist in one explainable timeline?
10. What information must stay OpenCode-owned because it is provider/session protocol state rather than semantic context?

The first integration mode should remain Shadow-only until these questions have evidence.

---

## 11. Benchmark implications

OpenCode should not merely be another Agent in the same benchmark table.

It should provide a **strong native-context baseline**.

Recommended future comparison:

```text
OpenCode Native

vs

OpenCode + Canvas Shadow
    native behavior unchanged
    Canvas computes hypothetical Working Set

vs

OpenCode + Canvas Dynamic Working Set
    only after safe integration boundary is proven
```

This experiment is more demanding than the Pi experiment because OpenCode already owns sophisticated source reconciliation and compaction.

A meaningful Canvas result would be:

> relevance-driven Working Set planning adds measurable value even on top of a runtime that already has explicit Context Sources, Context Epochs, safe-boundary reconciliation and compaction.

If Canvas cannot outperform or improve explainability over that baseline, the project should narrow its claims rather than duplicate OpenCode functionality.

---

## 12. Architecture questions created by this comparison

These questions should be resolved by evidence rather than by terminology preference.

### Q1. Do we need a first-class `ContextSourceState` entity?

Likely yes, at least logically.

Without it, Working Set composition risks conflating:

```text
source identity
source observation state
active membership
rendered representation
```

which OpenCode correctly keeps separate.

### Q2. Should `ContextUniverse` store current values or references to versioned source values?

Prefer versioned/content-addressed references where practical so transitions remain replayable.

### Q3. Is `ContextWorkingSet` mutable?

Prefer each materialized Working Set to be immutable/content-addressed, while the Runtime state evolves by producing a new Working Set.

Conceptually:

```text
WorkingSet #17
    -> Transition #18
    -> WorkingSet #18
```

rather than mutating #17 in place.

### Q4. Do we need `ContextRenderEpoch` in v0.3?

Not necessarily as persisted domain schema.

First collect Pi/OpenCode model-call observations and measure whether stable-prefix lifetime is useful enough to justify a first-class concept.

### Q5. Should source reconciliation and Working Set planning happen in one function?

No.

Keep them logically separate:

```text
reconcileSources()
composeWorkingSet()
renderContext()
```

This is one of the strongest conclusions from studying OpenCode.

### Q6. Should compaction be a Context Transition?

At the semantic Working Set level, `COMPRESS` may be recorded as a transition operation.

But provider/session-native compaction may also be a lower-level representation boundary.

The Runtime must distinguish:

```text
semantic compression decision
vs
provider/session compaction event
```

### Q7. Who owns provider-native history?

The Agent/protocol adapter.

Canvas should not deserialize opaque provider history and silently reinterpret it as generic semantic evidence unless the adapter explicitly declares that operation safe.

---

## 13. Immediate changes recommended for Canvas architecture

The OpenCode comparison produces the following recommended design adjustments.

### Adopt now at direction level

1. Stable namespaced `ContextSource` identity.
2. Typed source observation state.
3. Explicit `AVAILABLE / ABSENT / UNAVAILABLE` semantics.
4. Explicit Recomposition Boundary before model calls.
5. Separate source reconciliation from Working Set planning.
6. Preserve immutable materialized Working Sets rather than mutating one active set in place.
7. Preserve stable-context versus dynamic-context distinction for future prompt-cache optimization.
8. Keep Protocol Spine outside generic semantic selection policy.
9. Record source-state transitions and Working Set decisions separately.
10. Treat provider/session compaction as separate from Canvas semantic compression.

### Do not freeze yet

1. `ContextRenderEpoch` as a persisted domain entity.
2. exact `ContextSourceState` database schema.
3. exact Pi/OpenCode hook contract.
4. automatic LLM-based relevance selection.
5. full graph-database representation.
6. cross-provider rendering format.

These require Shadow data first.

---

## 14. Preliminary differentiation statement

After this comparison, Canvas Agent should **not** claim differentiation around:

```text
having Context Sources
tracking context changes
separating durable history from active history
automatic compaction
safe provider-turn reconciliation
stable baseline context
```

OpenCode already provides strong examples of these ideas.

A more defensible Canvas Context Runtime thesis is:

> Build an Agent-neutral runtime that separates source reconciliation from relevance-driven Working Set planning, continuously selects the smallest sufficiently useful semantic context, records explicit DROP / REPLACE / COMPRESS / REHYDRATE decisions, and exposes those decisions for cross-Agent observation, control and replay.

Short form:

> **OpenCode manages context source state; Canvas experiments with context working-set state.**

This statement is deliberately provisional and must be validated against Pi and OpenCode benchmarks.

---

## 15. Primary references

OpenCode sources reviewed for this note:

- `https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/CONTEXT.md`
- `https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/specs/v2/session.md`
- `https://opencode.ai/v2/docs/compaction`

The GitHub references are commit-pinned for reproducibility. The documentation site is a moving reference and must be rechecked before an OpenCode implementation packet starts.

Re-review these sources before implementing CR-007 because the V2 runtime is still evolving.
