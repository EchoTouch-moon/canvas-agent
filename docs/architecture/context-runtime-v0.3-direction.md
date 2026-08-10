# Context Runtime v0.3 Direction

- **Status:** PROPOSED
- **Target:** v0.3 after Product MVP v0.2 closeout
- **Scope:** Context Runtime validation, Context Boundary observability and controlled recomposition
- **Non-impact:** Product MVP v0.2 scope and frozen execution contracts remain unchanged

## 0. Decision summary

Canvas Agent should evolve from managing only the immutable initial execution context into managing an observable runtime **Context Working Set**.

The long-term architectural goal is:

> Canvas Agent should own or govern the Agent -> Model context boundary when the selected Agent integration exposes that boundary.

This does **not** require Canvas Agent to replace Codex, Claude Code or another Agent runtime.

The first v0.3 research path is to place a local protocol-aware **Context Gateway** on the model request path for a compatible Agent, starting with the Codex Responses API provider path.

```text
Agent Runtime
    |
    | model request
    v
Context Gateway
    |
    v
Context Runtime
    |
    | rendered / governed context
    v
Model Provider
```

v0.3 must begin in **Shadow Mode**, where requests are observed and analyzed but forwarded without semantic rewriting. Context rewriting is allowed only after protocol invariants, observability and benchmark evidence are established.

---

## 1. Motivation

Canvas Agent currently provides a strong execution boundary:

```text
Task
  -> ContextSnapshot
  -> ExecutionRequest
  -> Worker
  -> Agent Adapter
  -> Artifact
```

This answers an important question:

> What immutable context was intentionally supplied when execution began?

It does not yet answer the runtime question:

> At each later model invocation, after files were read, tools were called, tests failed and decisions were made, what information should still remain active?

A long-running coding Agent naturally discovers a growing amount of information. Native Agent implementations commonly accumulate tool results, file content and conversation state until some form of compaction or reconstruction is required.

The Context Runtime hypothesis is different:

> Active context should not be assumed to grow monotonically. It should be a derived working set that can grow, shrink, replace representations and rehydrate older evidence as task state changes.

Example:

```text
12K -> 27K -> 16K -> 22K -> 11K -> 18K
```

This is a stronger target than prompt compression. The goal is not merely to reduce token count after context becomes too large; the goal is to continuously compose the smallest sufficiently useful context for the current execution state.

---

## 2. Context Boundary Architecture

### 2.1 Logical boundary

The logical architecture is:

```text
Project / Repository / Run Evidence
              |
              v
       Context Universe
              |
              v
       Context Runtime
              |
              v
   Context Working Set(t)
              |
              v
         Agent / Model
              |
              v
       New Observations
              |
              +--------------------> Context Universe
```

The Context Runtime is responsible for context composition policy.

The Agent runtime remains responsible for execution behavior such as:

- planning;
- tool invocation;
- shell and file operations;
- sandbox and approval behavior;
- parsing model tool calls;
- deciding when another model invocation is required.

### 2.2 Physical integration is adapter-dependent

"Between Agent and Model" is a logical ownership statement, not a guarantee that every third-party Agent exposes a physical interception point.

Different integrations may support different control levels:

```text
INITIAL_ONLY
    Canvas controls only the initial injected context.

MODEL_REQUEST_OBSERVE
    Canvas can observe each Agent -> Model request but does not rewrite it.

MODEL_REQUEST_REWRITE
    Canvas can safely govern context before each model request.

MANAGED_LOOP
    Canvas owns the Agent loop and can compose context natively before every model call.
```

The adapter capability model must make this difference explicit rather than pretending every Agent can be controlled at the same level.

---

## 3. Core terminology

### 3.1 ContextSnapshot

ContextSnapshot remains the immutable starting anchor of a Run.

It answers:

> What project facts, constraints and repository state were intentionally frozen when execution started?

It is not the complete runtime context and must not be mutated when the Agent discovers new information.

### 3.2 Context Universe

Context Universe is the durable candidate space from which active context may be composed.

Possible sources include:

- frozen ContextSnapshot items;
- project facts and rules;
- repository observations;
- files and code symbols;
- tool results;
- test results;
- current Git diff;
- generated artifacts;
- decisions produced during execution;
- summaries of previous execution phases;
- prior inactive context that may later be rehydrated.

Context Universe is not a prompt.

### 3.3 Context Working Set

Context Working Set is the active semantic context chosen for a particular execution state or model request.

```text
Context Universe
        |
        | compose(policy, task state, budget)
        v
Context Working Set(t)
        |
        | protocol render
        v
Rendered Model Context(t)
```

Unlike Snapshot, Working Set is derived and may evolve.

### 3.4 Context Transition

Every material Working Set change should be explainable.

Example:

```text
ContextTransition #12

FROM
WorkingSet #11
32K tokens

TO
WorkingSet #12
15K tokens

ADD
+ failing test evidence
  reason: latest verification failure

REMOVE
- old grep output
  reason: superseded by resolved diagnosis

REPLACE
- auth.ts FULL_FILE
+ auth.ts SYMBOL refreshSession
  reason: implementation target resolved

ADD
+ current diff
  reason: current workspace state
```

Initial transition vocabulary:

- ADD
- REMOVE
- REPLACE
- COMPRESS
- REHYDRATE
- PRIORITY_CHANGE

A transition changes active context membership or representation. It does not delete durable evidence from Context Universe.

### 3.5 Context Runtime Session

A Run may own a Context Runtime Session that correlates:

```text
Run
  -> ContextRuntimeSession
      -> ModelCallObservation #1
      -> ContextTransition #1
      -> ModelCallObservation #2
      -> ContextTransition #2
      -> ...
```

The exact persistent schema is deliberately deferred until Shadow Mode produces real request data.

### 3.6 Protocol Spine

A model request contains more than replaceable semantic documents.

Some request items may be required to preserve protocol continuity, tool-call relationships or provider-managed conversation state.

The Context Runtime therefore distinguishes:

```text
Protocol Spine
    provider / protocol state that must preserve valid request semantics

Semantic Context
    project facts, files, evidence, summaries and other context that may be governed
```

The Runtime must not treat a provider request as an arbitrary list of strings.

Rewrite Mode requires protocol-specific validation before any item removal or replacement.

---

## 4. Codex Responses Context Gateway

### 4.1 Why Codex is a useful first experiment

The current Codex integration already gives Canvas Agent control over the initial ExecutionRequest v2 Context Bundle, while Codex owns the internal Agent loop after process start.

A compatible Codex model provider can use a configurable API base URL with the Responses protocol. The upstream Codex repository also contains a strict Responses API proxy example that forwards `POST /v1/responses` requests through a local endpoint.

This creates a practical experimental seam:

```text
Canvas Worker
    |
    | launches Codex with a Canvas-owned provider profile
    v
Codex Agent Loop
    |
    | POST /v1/responses
    v
Canvas Responses Context Gateway
    |
    | observe / later govern
    v
Upstream Responses API
    |
    v
Model
```

This is an experimental integration seam, not a requirement that the final Context Runtime be OpenAI-specific.

### 4.2 Proposed package boundary

Future packages may be separated as:

```text
packages/context-runtime
    provider-neutral Context Universe / Working Set / Policy / Transition logic

packages/responses-gateway
    Responses protocol interception, validation, streaming pass-through and correlation

packages/worker-runtime
    Agent lifecycle, gateway lifecycle and Agent adapter integration
```

The exact package names are not frozen by this direction document.

### 4.3 Gateway responsibilities

The Gateway may eventually:

- accept local Responses API requests from the Agent;
- correlate each request with Run and Context Runtime Session;
- record bounded request metadata and token estimates;
- classify protocol-spine versus semantic context items;
- ask Context Runtime for a proposed Working Set;
- validate any proposed rewrite against protocol invariants;
- forward the request upstream;
- stream the upstream response back without changing Agent-visible transport semantics;
- observe response metadata needed for later context analysis;
- record ContextTransition evidence.

### 4.4 Gateway must not become a generic transparent MITM

The first Gateway is intentionally narrow:

- loopback listener only;
- explicit supported route set;
- explicit supported protocol version / request shape;
- no arbitrary outbound host forwarding;
- bounded logs and payload retention;
- secrets excluded from persisted observations;
- no Renderer access to API credentials;
- no silent downgrade to an unsupported protocol;
- fail closed when a rewrite would violate a known protocol invariant.

Authentication and upstream credential ownership require a dedicated security proposal before implementation.

---

## 5. Three experimental modes

### 5.1 Shadow Mode — v0.3 first target

Shadow Mode does not semantically modify Agent requests.

```text
Codex request
      |
      v
Context Gateway
      |
      +--> observe native request
      |
      +--> Context Runtime computes hypothetical Working Set
      |
      +--> record native vs proposed context
      |
      v
forward original request unchanged
```

Shadow Mode should answer:

- how quickly native context grows;
- which categories dominate token usage;
- which information becomes stale;
- which content the proposed policy would remove or replace;
- whether the proposed policy repeatedly removes information that later becomes necessary;
- how often rehydration would have been required;
- where provider protocol items constrain safe context rewriting.

Shadow Mode is successful when Canvas can explain a model-call-level context timeline without affecting Agent behavior.

### 5.2 Augment Mode — second target

Augment Mode may add clearly namespaced Canvas context while preserving native context.

Example conceptual behavior:

```text
Native Agent Context
        +
Canvas Runtime Context
    - current task state
    - current decisions
    - selected project facts
    - current diff summary
```

The purpose is to measure whether Runtime-selected context improves execution before relying on destructive removal.

Augment Mode must remain budgeted; it is not permission to duplicate all existing context.

### 5.3 Rewrite Mode — gated experiment

Rewrite Mode is the first mode that may perform:

```text
ADD
REMOVE
REPLACE
COMPRESS
REHYDRATE
```

on the actual semantic context sent upstream.

Rewrite Mode must not begin until all of the following are true:

1. Shadow Mode has captured a representative corpus of real model-call requests;
2. protocol-spine invariants have automated tests;
3. request replay tests prove rewritten requests remain protocol-valid;
4. the Working Set policy has measurable false-removal and rehydration metrics;
5. a baseline benchmark exists for native execution;
6. rewrite can be disabled per Run and fails back to pass-through safely.

---

## 6. Phase-level recomposition remains useful

The Gateway path does not invalidate the previously proposed phase-level experiment.

Phase-level recomposition remains the safer semantic unit for the first active policy:

```text
Investigation
      |
      v
Working Set A
      |
      v
Diagnosis
      |
      v
Working Set B
      |
      v
Implementation
      |
      v
Working Set C
      |
      v
Verification
```

The difference is that the Context Gateway can now observe every underlying model request and measure whether the phase-level Working Set matches actual runtime needs.

Therefore:

- **observation granularity:** model-call level;
- **first active recomposition granularity:** phase level;
- **future active recomposition granularity:** model-call level if evidence supports it.

---

## 7. Adapter capability model

Future Agent adapters should expose context-boundary capabilities explicitly.

Conceptual contract:

```ts
interface AgentContextCapabilities {
  contextControl:
    | 'INITIAL_ONLY'
    | 'MODEL_REQUEST_OBSERVE'
    | 'MODEL_REQUEST_REWRITE'
    | 'MANAGED_LOOP'

  toolObservability:
    | 'NONE'
    | 'EVENTS'
    | 'FULL'

  contextObservability:
    | 'NONE'
    | 'USAGE_ONLY'
    | 'REQUEST_LEVEL'
    | 'ITEM_LEVEL'

  resume:
    | 'NONE'
    | 'SESSION'
    | 'EXTERNAL_STATE'
}
```

This is a direction-level capability model, not a frozen public contract.

It prevents Canvas Agent from assuming that Codex, Claude Code, OpenCode and a future Canvas-owned Agent loop expose identical context control.

---

## 8. v0.3 implementation priorities

### P0-A — Responses Gateway Shadow Mode

Build the smallest protocol-aware experiment capable of:

```text
Agent request
    -> local gateway
    -> bounded observation
    -> unchanged upstream forwarding
    -> unchanged response streaming
```

Required evidence:

- model-call sequence correlation;
- request size / token estimate timeline;
- request category breakdown where safely classifiable;
- no semantic request rewriting;
- no credential persistence;
- deterministic replay fixtures with secrets removed.

### P0-B — RunEvent / ModelCall Observability

Promote runtime observation from deferred research to v0.3 core work.

Observe at least:

- Agent process lifecycle;
- model-call boundaries;
- tool-call events when exposed;
- file access/change evidence when exposed;
- test execution evidence;
- token / usage information when exposed;
- phase boundaries;
- ContextTransition proposals.

Do not require full raw payload persistence. Prefer structured metadata plus content-addressed bounded evidence where justified.

### P0-C — Context Universe and Working Set evaluator

Introduce provider-neutral research models for:

```text
ContextUniverse
ContextWorkingSet
ContextTransition
ContextPolicy
```

In Shadow Mode the Working Set is initially hypothetical. The system should be able to answer:

> If Canvas had controlled this request, what would it have kept, removed, replaced or rehydrated, and why?

### P0-D — Phase-level dynamic recomposition experiment

Use the existing Run / ExecutionRequest boundaries or controlled Agent episodes to validate active recomposition without immediately depending on per-model-call rewrite.

Compare:

```text
Native Agent execution
vs
Static Canvas Frozen Context
vs
Canvas phase-level dynamic context
```

### P1 — Augment Mode

Inject a bounded namespaced Canvas-selected context block and measure effect on task performance.

### P1 — Rewrite Mode research gate

Only after Shadow and Augment evidence is reviewed, design the protocol-safe rewrite contract.

### P2 — Managed Agent Loop prototype

A Canvas-owned Agent loop may eventually provide native model-call-level context control without protocol interception.

It is not required to validate v0.3.

---

## 9. Context Policy direction

The first Context Policy must be deterministic enough to inspect and test.

Useful inputs include:

- Task phase;
- Context authority;
- P0-P3 priority;
- source freshness;
- dependency / derivation relationships;
- superseded state;
- current repository diff;
- current target symbols;
- latest verification evidence;
- token budget;
- previous removal / rehydration history.

Example policy direction:

```text
P0
    normally KEEP

P1
    KEEP while task-relevant

P2
    phase-dependent active / cold

P3
    cold by default; REHYDRATE when justified
```

Authority remains separate from relevance. A low-relevance Project Rule may still outrank highly relevant untrusted content when instructions conflict.

The first implementation should not delegate the entire selection decision to another opaque LLM. LLM-assisted selection can be evaluated later as an explainable policy component.

---

## 10. Context Transition and observability

The user-facing value is not only a smaller prompt.

Canvas should eventually explain:

```text
Model Call #18

Native request estimate
31.2K tokens

Proposed Working Set
16.4K tokens

KEEP
= Task instruction
= project rule
= current diff

REMOVE
- grep output #14
  superseded by Decision #23

REPLACE
- full login.ts
+ authenticate() symbol
  unrelated regions inactive

REHYDRATE
+ old test evidence #8
  current failure matches previous signature
```

This enables four product actions:

```text
Observe
Understand
Control
Replay
```

Context Graph / Canvas can later visualize these relationships, but the graph is not the runtime itself.

---

## 11. Benchmark and evaluation plan

The project must prove more than token reduction.

### 11.1 Execution variants

At minimum compare:

```text
A. Native Agent

B. Canvas initial Frozen Context + native Agent context management

C. Canvas Shadow Mode
   native behavior unchanged; hypothetical Working Set evaluated

D. Canvas phase-level Dynamic Working Set

E. Canvas Rewrite Mode
   only after safety gate
```

### 11.2 Metrics

Track:

- task success rate;
- acceptance criteria pass rate;
- total input tokens;
- peak native context size;
- peak governed Working Set size;
- average working set size;
- context growth rate;
- tool calls;
- repeated file reads;
- repeated search operations;
- execution time;
- native compaction events when observable;
- stale context retained;
- context items removed;
- rehydration count;
- false-removal cases;
- recovery quality;
- context transition explainability.

Success means:

> Dynamic context management maintains or improves task reliability while reducing irrelevant active context and preserving recoverability.

A smaller Working Set that lowers success rate is a failure.

---

## 12. Security and trust boundaries

The Context Gateway introduces a new privileged boundary and must be treated accordingly.

Minimum principles:

- listen on loopback only for local MVP experiments;
- bind a Gateway session to one Run / Worker lifetime;
- do not expose upstream credentials to Renderer;
- do not persist Authorization headers or credential-bearing environment values;
- redact known secret-bearing request fields before diagnostic persistence;
- bound retained request and response evidence;
- validate upstream host configuration;
- reject unsupported routes and methods;
- preserve sandbox and Agent execution policies;
- never weaken approval or filesystem isolation as a side effect of context control;
- use explicit fail-open/pass-through versus fail-closed policy per experiment mode; Rewrite Mode should fail back to a safe known behavior, never silently corrupt a request.

A dedicated implementation proposal must freeze credential flow and Gateway threat model before code lands.

---

## 13. Non-goals

v0.3 does not attempt to:

- replace Codex or another Agent runtime;
- immediately own every Agent loop;
- proxy arbitrary Internet traffic;
- support every model protocol at once;
- rewrite unknown provider state blindly;
- build a general workflow engine;
- create a complete knowledge graph system;
- ship a full global Canvas;
- optimize context only by minimizing tokens;
- add multi-Agent orchestration before the Context Runtime hypothesis is validated.

---

## 14. Relationship with existing architecture

The new direction extends rather than replaces the current model.

```text
ContextSnapshot
    = immutable initial anchor

ExecutionRequest
    = immutable execution contract

ContextRuntimeSession
    = runtime context observation / control scope

Context Universe
    = durable candidate information space

Context Working Set
    = active derived semantic context

ModelCallObservation
    = model-boundary observation

ContextTransition
    = explainable Working Set evolution

Agent Adapter
    = execution integration and capability declaration

Protocol Adapter / Gateway
    = model-boundary integration where supported
```

The existing Snapshot, ExecutionRequest, Worker, RepositoryRevision and Artifact boundaries remain valuable and should not be removed to pursue Context Runtime research.

---

## 15. Recommended development order after v0.2

```text
v0.2
    finish Product MVP / RC
        |
        v
v0.3-A
    Context Gateway Shadow Mode
        |
        v
v0.3-B
    Model-call observability + Context Universe
        |
        v
v0.3-C
    hypothetical Working Set + Context Transition
        |
        v
v0.3-D
    phase-level active recomposition
        |
        v
v0.3-E
    Augment Mode
        |
        v
Research gate
    evaluate Rewrite Mode
        |
        v
v0.4+
    multi-provider protocol adapters / managed loop experiments
```

Canvas / Context Graph visualization should follow observed recurring debugging questions rather than lead the runtime architecture.

---

## 16. Questions that must be answered by v0.3 evidence

1. What percentage of a real coding Agent request is semantic context that can be independently managed versus protocol/runtime state that must remain intact?
2. How quickly does native active context grow across realistic long tasks?
3. Which categories of context become stale most often?
4. Can a deterministic Working Set policy predict useful removals without harming success rate?
5. How frequently must removed context be rehydrated?
6. Is phase-level recomposition sufficient, or is model-call-level recomposition materially better?
7. Which context changes are understandable to users and which create excessive control-plane noise?
8. What adapter capabilities are actually available across Codex, Claude Code, OpenCode and a future Canvas-managed loop?
9. Can Canvas reduce total and peak active context while maintaining or improving acceptance outcomes?
10. Does owning the Context Boundary provide enough independent value for Context Runtime to become a reusable infrastructure layer outside the Canvas Agent application?

The answer to these questions should determine v0.4 scope. They should not be assumed in advance.
