# PROPOSAL-030 — Context Source / Source State / Context Universe model

- **Status:** PROPOSED — research architecture, not an implementation authorization
- **Target:** Context Runtime v0.3, after Product MVP v0.2 RC
- **Date:** 2026-08-10
- **Depends on:** `docs/architecture/context-runtime-v0.3-direction.md`
- **Research input:** `docs/architecture/opencode-v2-context-comparison.md`
- **Compatibility constraint:** existing frozen `ContextSnapshot`, `SourceReference`, `ExecutionRequest v2` and v0.2 persistence contracts remain unchanged by this proposal

## 1. Problem

The current v0.2 context path has a useful and correct freeze-time contract:

```text
Renderer source selection
        |
        v
SourceReference
        |
        v
Main ContextResolver
        |
        v
ResolvedContextItem
        |
        v
immutable ContextSnapshotItem
```

This answers:

> What authoritative content did this Run intentionally freeze at its start?

It does not yet model the runtime question:

> During the Run, what information sources exist now, what is their latest admitted state, which observations are unavailable or absent, and what candidate information may the Working Set Planner choose from at the next model-call boundary?

The Context Runtime needs a layer between raw world observations and `ContextWorkingSet`.

This proposal defines that layer without changing the existing Snapshot contract.

---

## 2. Decision summary

Introduce three distinct runtime concepts:

```text
ContextSource
    stable semantic identity of a source

ContextSourceState
    reconciled runtime state for that source

ContextUniverse
    current candidate projection over reconciled source states
```

The complete runtime path becomes:

```text
World / Run / Snapshot
        |
        v
Source Adapters / Observers
        |
        v
SourceObservation
        |
        v
Source Reconciliation
        |
        v
ContextSourceState
        |
        v
Context Universe
        |
        v
Working Set Planning
        |
        v
ContextWorkingSet
        |
        v
Protocol Rendering
        |
        v
Model Request
```

The central separation is:

> **Source Reconciliation determines what is known. Working Set Planning determines what is useful now.**

A source may be unchanged but leave the Working Set because task relevance changed. A source may change in the Universe but remain outside the Working Set.

---

## 3. Existing concepts that remain intact

### 3.1 `SourceReference` remains a freeze/resolution locator

The existing contract uses typed references such as:

```text
task-spec://<TaskSpecVersionId>
node://<NodeVersionId>
repo://<canonical path>
```

and Main resolves them authoritatively under a pinned `ContextResolutionScope`.

This is still correct.

`SourceReference` should not be silently expanded into the entire runtime source model. It currently answers:

> Which authoritative v0.2 source should Main resolve under this Snapshot scope?

A future Runtime source may come from additional origins such as tool results, tests, current workspace observations, generated decisions or artifacts.

### 3.2 `ContextSnapshot` remains immutable

`ContextSnapshot` is still the Run-start frozen anchor.

Runtime source reconciliation must never mutate a Snapshot or rewrite its historical items.

### 3.3 Snapshot `ContextItemType` remains a frozen-item classification

The v0.2 `CONTEXT_ITEM_TYPES` are not automatically promoted to a complete Runtime `ContextSourceKind` taxonomy.

A Runtime taxonomy should be based on observed v0.3 data before being frozen as a public contract.

### 3.4 Existing Renderer `ContextCandidate` is not the Runtime candidate model

`apps/desktop/src/renderer/src/lib/context-candidates.ts` defines a UI candidate for pre-freeze user selection.

Do not reuse that type name in `packages/context-runtime`.

Recommended Runtime terms are:

```text
ContextSource
ContextSourceVersion
ContextSourceState
ContextUniverseEntry
```

---

## 4. `ContextSource`: stable identity, not content

A `ContextSource` identifies one semantic source across observations.

Examples:

```text
snapshot/task-spec://spec-17
project/node://node-version-22
repository/file://src/auth.ts
repository/symbol://src/auth.ts#refreshSession
run/tool-result://tool-call-018
run/test-result://test-run-006
run/artifact://decision-023
```

The exact URI grammar is not frozen here. The requirement is a canonical, stable, namespaced key.

Conceptual shape:

```ts
type ContextSourceKey = Brand<string, 'ContextSourceKey'>

interface ContextSource {
  readonly sourceKey: ContextSourceKey
  readonly sourceKind: string
  readonly authority: ContextAuthority
  readonly baselinePriority: ContextPriority
  readonly provenance: ContextProvenance
}
```

### 4.1 Identity invariant

`sourceKey` identifies the source, not one observed value of that source.

For a mutable repository file:

```text
sourceKey = repository/file://src/auth.ts
```

may remain stable while its admitted content version changes.

For an already-versioned immutable domain object such as a `NodeVersion`, the stable source identity may itself include the immutable version id.

### 4.2 Authority is not relevance

Authority belongs to source semantics and provenance.

Working Set relevance is runtime-dependent.

The Planner may remove a currently irrelevant `REFERENCE` source without changing its authority. It must not convert untrusted content into a higher authority merely because the content is relevant.

### 4.3 Baseline priority is not final Working Set rank

Existing P0-P3 priority remains useful as a policy input, especially when seeding from Snapshot items.

Runtime planning may derive additional phase-specific or task-specific rank without mutating the source's original authority or baseline priority.

---

## 5. `ContextSourceVersion`: immutable observed value

A stable source may produce multiple immutable observed versions.

Conceptual shape:

```ts
type ContextSourceVersionId = Brand<string, 'ContextSourceVersionId'>

interface ContextSourceVersion {
  readonly id: ContextSourceVersionId
  readonly sourceKey: ContextSourceKey
  readonly contentHash: string
  readonly contentRef: ContextContentRef
  readonly tokenEstimate: number
  readonly observedAt: string
  readonly worldRevisionRef?: string
  readonly provenance: ContextProvenance
}
```

The Runtime should prefer content-addressed references over duplicating large content in every state or Universe revision.

A `ContextSourceVersion` is immutable once admitted.

For Snapshot seeds, an existing frozen Snapshot item can be represented as a source version by reference to its frozen `contentHash` / Blob or resolved content without changing the Snapshot row.

---

## 6. Observation semantics: `AVAILABLE`, `ABSENT`, `UNAVAILABLE`

A source observer must not collapse all failures into `null` or an empty string.

Use three semantic outcomes:

```ts
type ContextSourceObservation =
  | {
      readonly status: 'AVAILABLE'
      readonly sourceKey: ContextSourceKey
      readonly observed: ObservedContextValue
    }
  | {
      readonly status: 'ABSENT'
      readonly sourceKey: ContextSourceKey
      readonly observedAt: string
    }
  | {
      readonly status: 'UNAVAILABLE'
      readonly sourceKey: ContextSourceKey
      readonly observedAt: string
      readonly reasonCode: string
    }
```

Semantics:

```text
AVAILABLE
    The source was observed successfully.

ABSENT
    Observation succeeded and confirmed the source no longer exists / applies.

UNAVAILABLE
    The Runtime could not establish current source state.
    This is not evidence that the source is absent.
```

This distinction is required to avoid destructive context loss during transient read failures, adapter failures or unavailable external state.

---

## 7. `ContextSourceState`: mutable head, immutable history

`ContextSourceState` is the Runtime's reconciled head state for one source within a `ContextRuntimeSession`.

It is not a model-visible prompt item and it is not Canvas `ContextSnapshot`.

Conceptual shape:

```ts
interface ContextSourceState {
  readonly sourceKey: ContextSourceKey

  // What the latest observer reported.
  readonly observationStatus: 'AVAILABLE' | 'ABSENT' | 'UNAVAILABLE'
  readonly lastObservedAt: string

  // Latest admitted usable version, if any.
  readonly admittedVersionId: ContextSourceVersionId | null

  // Retained for audit / possible rehydration even after confirmed removal.
  readonly lastAvailableVersionId: ContextSourceVersionId | null

  readonly reconciliationSequence: number
}
```

This shape is conceptual; exact persistence fields remain deferred.

### 7.1 Reconciliation rules

#### First `AVAILABLE`

```text
no admitted version
        + AVAILABLE(v1)
        -> admit v1
```

#### `AVAILABLE` unchanged

```text
admitted v1
        + AVAILABLE(hash=v1)
        -> NO_CHANGE
```

#### `AVAILABLE` changed

```text
admitted v1
        + AVAILABLE(v2)
        -> admit v2
        -> retain v1 as history
```

#### Confirmed `ABSENT`

```text
admitted v2
        + ABSENT
        -> current admitted head becomes null
        -> v2 remains historical / rehydratable evidence when policy permits
```

`ABSENT` is a real source-state transition.

#### `UNAVAILABLE`

```text
admitted v2
        + UNAVAILABLE
        -> do NOT reinterpret as ABSENT
        -> retain v2 as last known admitted value
        -> mark source observation unavailable
```

The Planner must be able to see that the retained value may be stale / unconfirmed.

High-authority sources should default to conservative handling when current observation is unavailable.

---

## 8. Source Reconciliation is not `ContextTransition`

Introduce a separate event vocabulary for source reconciliation.

Example:

```ts
type SourceReconciliationAction =
  | 'INITIALIZE'
  | 'NO_CHANGE'
  | 'UPDATE'
  | 'REMOVE'
  | 'RETAIN_LAST_KNOWN'
```

Example event:

```text
SourceReconciliation #42

source
repository/file://src/auth.ts

observation
AVAILABLE

previous admitted
version-17

next admitted
version-21

action
UPDATE
```

This is different from:

```text
ContextTransition
ADD / REMOVE / REPLACE / COMPRESS / REHYDRATE
```

because a Source Reconciliation changes the Universe's knowledge state, while a ContextTransition changes the active Working Set.

Examples:

```text
Source changed, but remains irrelevant:
    SourceReconciliation = UPDATE
    ContextTransition     = no Working Set change

Source unchanged, but task phase changed:
    SourceReconciliation = NO_CHANGE
    ContextTransition     = REMOVE
```

This separation is a core invariant.

---

## 9. `ContextUniverse`: reconciled candidate projection

`ContextUniverse` is not the database, not the World, not the complete historical event log, and not the current prompt.

It is the Runtime's reconciled candidate projection for a specific `ContextRuntimeSession` and recomposition boundary.

Conceptually:

```ts
interface ContextUniverseEntry {
  readonly source: ContextSource
  readonly state: ContextSourceState
  readonly admittedVersion: ContextSourceVersion | null
  readonly rehydratableVersionRefs: readonly ContextSourceVersionId[]
}

interface ContextUniverseRevision {
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly entries: readonly ContextUniverseEntry[]
  readonly logicalHash: string
}
```

The physical implementation should not duplicate all resolved content for every revision.

Prefer:

```text
immutable SourceVersion records / blobs
        +
source reconciliation events
        +
ordered head references / logical hash
```

over N complete copies of the Universe.

### 9.1 Universe membership

A source may exist in Universe even when it is not in the Working Set.

A source may also retain historical versions eligible for later rehydration.

Therefore:

```text
Context Universe
    !=
Context Working Set
```

and:

```text
inactive
    !=
deleted
```

### 9.2 Universe revision binding

Every computed `ContextWorkingSet` should eventually bind to the exact Universe revision / logical hash that it was planned from.

This gives explainability and replay:

```text
WorkingSet #18
plannedFromUniverse = universe:run-88:seq-41
```

The exact schema is deferred until v0.3 Shadow Mode.

---

## 10. Snapshot -> Universe seeding

At `ContextRuntimeSession` initialization:

```text
immutable ContextSnapshot
        |
        v
Snapshot Seed Adapter
        |
        v
ContextSource + SourceVersion entries
        |
        v
Universe sequence 0
```

Rules:

1. Snapshot rows remain untouched.
2. Existing canonical `sourceRef` should be reused where it represents the same semantic source identity.
3. Frozen `contentHash`, authority, priority and provenance seed initial source versions.
4. P0 Task instruction remains protected by Working Set policy, not by mutating the Snapshot.
5. Later runtime observations may advance the current source state where the source is mutable, but the original Snapshot version remains addressable as the Run-start anchor.

Example:

```text
ContextSnapshot
repo://src/auth.ts @ hash-A

Universe sequence 0
repository/file://src/auth.ts
    snapshotVersion = hash-A
    admittedVersion = hash-A

later workspace observation
repository/file://src/auth.ts @ hash-B

Universe sequence 7
    snapshotVersion remains hash-A
    admittedVersion becomes hash-B
```

The system can therefore answer both:

```text
What did the Run start from?
What does the Runtime currently know?
```

---

## 11. Observer / adapter boundary

`packages/context-runtime` should not read Git, Pi, OpenCode, Codex or provider APIs directly.

Integration or source-adapter code owns observation:

```text
Pi integration
Repository observer
Run-event adapter
OpenCode integration
Artifact adapter
        |
        v
ContextSourceObservation
        |
        v
packages/context-runtime
```

The Runtime owns:

```text
stable source identity semantics
source-version admission
reconciliation
Universe projection
Working Set planning
transition explanation
```

This dependency direction preserves Agent-neutral and model-neutral architecture.

---

## 12. Proposed three-stage Runtime API boundary

Do not implement one opaque `composeEverything()` function.

The direction-level API should remain separable:

```ts
interface ContextRuntime {
  reconcileSources(
    current: ContextUniverseRevision,
    observations: readonly ContextSourceObservation[]
  ): SourceReconciliationResult

  planWorkingSet(
    universe: ContextUniverseRevision,
    request: ContextPlanningRequest
  ): ContextWorkingSetPlan

  renderContext(
    workingSet: ContextWorkingSet,
    target: ContextRenderTarget
  ): RenderedContext
}
```

Exact names and public visibility are not frozen.

The invariants are:

```text
observe / reconcile
        !=
select / plan
        !=
protocol render
```

---

## 13. Relationship to existing v0.2 `ContextResolver`

The existing `ContextResolver` remains useful and should not be rewritten as part of v0.3 research initialization.

It currently performs authoritative freeze-time materialization under a pinned scope.

A future source adapter may reuse its lower-level resolution logic, but its semantics are different:

```text
v0.2 ContextResolver
    pinned Snapshot materialization

v0.3 Source Observer
    runtime observation at a Recomposition Boundary
```

Do not make v0.2 Snapshot resolution depend on the experimental Runtime package.

---

## 14. OpenCode mapping

This proposal intentionally absorbs the useful part of OpenCode V2's model while preserving Canvas terminology.

```text
OpenCode Context Source
    ~ Canvas ContextSource

OpenCode source observation / reconcile
    ~ Canvas SourceObservation + Source Reconciliation

OpenCode model-hidden Context Snapshot
    ~ Canvas ContextSourceState / admitted head state
    != Canvas ContextSnapshot

OpenCode System Context Registry
    ~ one possible subset/input of Canvas ContextUniverse

OpenCode Safe Provider-Turn Boundary
    ~ Canvas Recomposition Boundary
```

Canvas extends the model downstream with relevance-driven Working Set planning.

---

## 15. Non-goals

This proposal does not freeze:

- SQL tables for Runtime source state;
- the final `ContextSourceKind` union;
- a vector database;
- graph database storage;
- embedding strategy;
- LLM-based source ranking;
- provider-specific rendering;
- OpenCode plugin contracts;
- Pi extension contracts;
- Codex gateway contracts;
- a public stable Context Runtime SDK.

These require Shadow Mode evidence first.

---

## 16. Required v0.3 evidence before contract freeze

CR-002 / CR-003 experiments should collect enough data to answer:

1. Which source kinds actually appear during Pi coding tasks?
2. Which sources are mutable versus immutable?
3. How often does `UNAVAILABLE` occur and what causes it?
4. Does retaining last-known state on `UNAVAILABLE` prevent failures or create stale-context risk?
5. How many source updates never affect the active Working Set?
6. How many Working Set transitions occur with no source content change?
7. How often does a prior source version need to be rehydrated?
8. Is source-level identity sufficient, or are sub-source identities such as file symbols required early?
9. What minimum Universe revision data is required for exact explanation / replay?
10. Which fields belong in durable persistence versus reconstructable runtime projection?

---

## 17. Initial architecture verdict

Adopt now at the design level:

```text
stable ContextSourceKey
immutable ContextSourceVersion
AVAILABLE / ABSENT / UNAVAILABLE observation semantics
explicit Source Reconciliation
Universe revision / logical-hash binding
Recomposition Boundary
separation of reconciliation / planning / rendering
```

Do **not** implement a full persistence schema yet.

The next implementation-facing research step is:

```text
Pi model-call hook
        |
        +--> capture model-call observations
        +--> capture source observations
        v
in-memory / fixture-backed Source Reconciliation
        v
Context Universe Shadow projection
        v
hypothetical Working Set planning
```

Only after that evidence should `ContextSource`, `ContextSourceState` and `ContextUniverseRevision` become frozen public contracts or database tables.
