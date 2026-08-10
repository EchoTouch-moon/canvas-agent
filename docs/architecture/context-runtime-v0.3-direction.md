# Context Runtime v0.3 Direction

- **Status:** PROPOSED
- **Target:** v0.3 after Product MVP v0.2 closeout
- **Scope:** Context Runtime validation, model-call observability and dynamic Context Working Set experiments
- **Non-impact:** Product MVP v0.2 scope and frozen execution contracts remain unchanged

## 0. Decision summary

Canvas Agent should evolve from managing only an immutable initial execution context into validating a reusable, Agent-neutral **Context Runtime**.

The core hypothesis is:

> Active context should not be assumed to grow monotonically. For each model call, the system should be able to derive the smallest sufficiently useful Context Working Set from a larger Context Universe, while preserving provenance, recoverability and explainability.

The Runtime must not be designed around Codex, Pi, OpenCode, DeepSeek or any other single Agent or model.

The preferred v0.3 research strategy is now:

```text
Pi
    primary Context Runtime research harness
    model-call-level observation and rewrite

OpenCode
    second implementation and strong native-context baseline

Codex
    later compatibility target for a less cooperative / externally controlled Agent boundary
```

For bulk experiments, a lower-cost replaceable model backend such as DeepSeek is preferred. Stronger or different model families should be used periodically to test whether results generalize.

The resulting architecture should look like:

```text
                  Canvas Context Runtime
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
     Pi Integration   OpenCode Integration  Codex Integration
          |                |                |
          +----------------+----------------+
                           |
                  replaceable model backend
                 DeepSeek / OpenAI / Claude /
                    local compatible model
```

The dependency direction is one-way:

> integrations depend on Context Runtime; Context Runtime must never depend on a specific Agent or model provider.

---

## 1. Why the research harness strategy changed

The previous direction treated a Codex Responses Gateway as the first model-boundary experiment because Codex already exists in the Product MVP execution path.

That remains a useful compatibility technique, but it is no longer the preferred first research environment.

For Context Runtime research, the ideal harness has different properties:

- Agent loop is open and inspectable;
- the model-call boundary is explicitly exposed;
- context can be observed immediately before a model call;
- context can be replaced without reconstructing an opaque provider protocol;
- tool events are observable;
- provider / model selection is replaceable;
- experiments can be repeated cheaply.

A small open Agent harness that exposes a pre-model context hook gives cleaner experimental control than starting with a proxy around a more opaque runtime.

Therefore the project should separate two goals:

```text
Research goal
    prove whether dynamic Context Working Set management works

Compatibility goal
    later prove that the same Runtime can govern less cooperative Agents
```

Pi is currently the preferred research harness for the first goal. Codex remains valuable for the second.

---

## 2. Product and research boundary

Canvas Agent already has a useful execution-control foundation:

```text
Task
  -> ContextSnapshot
  -> ExecutionRequest
  -> Worker
  -> Agent Adapter
  -> Artifact
```

This answers:

> What immutable context, repository revision and execution contract were intentionally provided when a Run began?

The new research question is different:

> After tools, file reads, tests, edits and decisions change the execution state, what information should remain active for the next model invocation?

These concepts must coexist.

```text
ContextSnapshot
    immutable initial anchor

Context Universe
    all durable context candidates available to the Runtime

Context Working Set
    active semantic context selected for a particular model call or execution state

Context Transition
    explainable change between two Working Sets
```

Snapshot must not be mutated to represent runtime context growth.

---

## 3. Context Runtime architecture

### 3.1 Logical flow

```text
Project Facts / Repository / Snapshot / Run Evidence
                         |
                         v
                  Context Universe
                         |
                         | policy + task state + budget
                         v
                  Context Working Set(t)
                         |
                         v
                     Agent Harness
                         |
                         | model request
                         v
                       Model
                         |
                         v
                 Tool / Agent Result
                         |
                         +----------------------+
                                                |
                                                v
                                         Context Universe
```

The Context Runtime is responsible for:

- candidate normalization;
- provenance;
- authority and priority;
- relevance / phase policy;
- Working Set composition;
- ADD / REMOVE / REPLACE / COMPRESS / REHYDRATE decisions;
- token / size budgeting;
- ContextTransition evidence;
- explainability;
- replayable research observations.

The Agent harness remains responsible for:

- planning and control flow;
- tool calls;
- shell and filesystem operations;
- model invocation timing;
- parsing model tool calls;
- sandbox / approval behavior;
- execution lifecycle.

The model provider remains responsible for inference.

### 3.2 Physical integration is capability-dependent

"Context Runtime between Agent and Model" is a logical responsibility. Physical integration depends on what the Agent exposes.

Direction-level capability classes:

```text
INITIAL_ONLY
    only initial context can be controlled

MODEL_REQUEST_OBSERVE
    every model-call context can be observed

MODEL_REQUEST_REWRITE
    every model-call semantic context can be changed

MANAGED_LOOP
    Canvas owns the Agent loop and natively controls every model request
```

Pi is attractive because the research integration can target MODEL_REQUEST_REWRITE without first owning the entire Agent loop.

OpenCode is useful because its own context lifecycle and compaction behavior provide a stronger comparison target.

Codex is useful because a gateway / protocol adapter can test whether Context Runtime survives a less direct integration boundary.

---

## 4. Core runtime concepts

### 4.1 ContextSnapshot

ContextSnapshot remains the immutable initial context anchor for a Run.

It answers:

> What project facts, constraints and repository state were frozen before execution?

It does not represent all later runtime observations.

### 4.2 Context Universe

Context Universe is the durable candidate space from which Working Sets are composed.

Candidate sources may include:

- ContextSnapshot items;
- project rules and facts;
- Task instruction and acceptance criteria;
- repository files, symbols and ranges;
- current Git diff;
- tool results;
- test results;
- errors and logs;
- Agent-produced decisions;
- accepted artifacts;
- phase summaries;
- previously removed context that can later be rehydrated.

Context Universe is not a prompt and is not required to fit a model context window.

### 4.3 Context Working Set

Context Working Set is the active semantic context selected for a model call or controlled execution phase.

```text
Context Universe
        |
        | compose(task state, policy, budget)
        v
Context Working Set(t)
        |
        v
Rendered Model Context(t)
```

Working Set is derived and may be non-monotonic:

```text
12K -> 27K -> 16K -> 22K -> 11K -> 18K
```

A smaller Working Set is not automatically better. Success requires preserving task reliability and recoverability.

### 4.4 Context Transition

Every meaningful Working Set change should be explainable.

Example:

```text
ContextTransition #18

FROM
WorkingSet #17
31.2K tokens

TO
WorkingSet #18
16.4K tokens

KEEP
= Task instruction
= project rule
= current diff

REMOVE
- grep output #14
  reason: superseded by Decision #23

REPLACE
- auth.ts FULL_FILE
+ auth.ts SYMBOL refreshSession
  reason: current implementation target resolved

REHYDRATE
+ old test evidence #8
  reason: current failure matches previous signature
```

Initial transition vocabulary:

- ADD
- REMOVE
- REPLACE
- COMPRESS
- REHYDRATE
- PRIORITY_CHANGE

Removing an item from a Working Set does not delete it from Context Universe.

### 4.5 Context Runtime Session

A Run may own a ContextRuntimeSession:

```text
Run
  -> ContextRuntimeSession
      -> ModelCallObservation #1
      -> ContextTransition #1
      -> ModelCallObservation #2
      -> ContextTransition #2
      -> ...
```

The persistent schema is intentionally not frozen before real experimental data exists.

---

## 5. Research harness strategy

### 5.1 Pi — P0 primary harness

Pi should be treated as the first Context Runtime research harness, not as a permanent product dependency.

Why it is useful:

- open Agent implementation;
- direct pre-model context interception is available through its extension boundary;
- model-call-level context can be observed;
- the experiment can return unchanged context in Shadow Mode;
- later experiments can return a rewritten message set;
- provider selection is replaceable;
- the harness is small enough to inspect when results are surprising.

Conceptual integration:

```text
Pi Agent Loop
      |
      | before model call
      v
Pi Context Integration
      |
      v
Canvas Context Runtime
      |
      | Working Set / unchanged native set
      v
Pi Provider Layer
      |
      v
DeepSeek / other model
```

The preferred first implementation shape is an integration / extension package rather than a deep fork.

Possible repository boundary:

```text
packages/context-runtime
    provider-neutral runtime logic

packages/integrations/pi-context
    Pi event conversion and hook lifecycle
```

The integration owns translation between Pi messages/events and provider-neutral Context Runtime structures.

`packages/context-runtime` must not import Pi packages.

### 5.2 OpenCode — P1 second implementation and baseline

OpenCode should be the second major validation target.

Its value is different from Pi:

- it has its own mature context / compaction behavior;
- it provides a stronger native-context-management baseline;
- comparing Native OpenCode with OpenCode + Canvas Runtime can test whether the Runtime still adds value when the host already manages context actively;
- it is open enough to inspect implementation differences rather than treating them as a black box.

The OpenCode integration should not be started until the Pi experiment has frozen a small provider-neutral Runtime interface.

Possible boundary:

```text
packages/integrations/opencode-context
```

Again, Runtime must remain independent of OpenCode-specific message shapes.

### 5.3 Codex — P2 compatibility target

Codex remains valuable, but its role changes.

It should test:

> Can the same Context Runtime integrate with an Agent where Canvas does not directly own or naturally hook every model-call context?

A Responses-compatible Context Gateway remains a possible integration mechanism:

```text
Codex Agent
    |
    v
Context Gateway
    |
    v
Canvas Context Runtime
    |
    v
Model Provider
```

This gateway work should follow, not lead, the Context Runtime research.

The Codex path validates portability of the Runtime rather than defining the Runtime itself.

---

## 6. Model strategy

The Context Runtime must also be model-neutral.

### 6.1 DeepSeek as default bulk experiment backend

A lower-cost provider such as DeepSeek is preferred for repeated early experiments because Context research requires many runs across the same task matrix.

The purpose is experimental economics, not a permanent model preference.

Default v0.3 research topology:

```text
Pi
  -> Canvas Context Runtime
  -> DeepSeek
```

The same benchmark should periodically be repeated with one or more stronger / different model families.

### 6.2 Controlled model matrix

Longer-term evaluation should use a matrix such as:

```text
                         Context Strategy
                 Native     Static     Dynamic
              +----------+----------+----------+
DeepSeek      |    A     |    B     |    C     |
              +----------+----------+----------+
Model B       |    D     |    E     |    F     |
              +----------+----------+----------+
Model C       |    G     |    H     |    I     |
              +----------+----------+----------+
```

This helps answer whether gains come from the Context Runtime or from an accidental fit to one model.

### 6.3 Local model experiments

Local OpenAI-compatible backends may be useful later for:

- zero-marginal-cost stress tests;
- deterministic infrastructure testing where model quality is not the variable;
- large-volume policy debugging.

Local models are not required for v0.3.

---

## 7. Experimental modes

The experimental modes are provider-neutral. They describe Context Runtime behavior, not a Codex-specific gateway.

### 7.1 Shadow Mode — first target

Shadow Mode never changes the actual context sent to the model.

```text
Native model-call context
        |
        +--> record bounded observation
        |
        +--> Context Runtime computes hypothetical Working Set
        |
        +--> record proposed transition
        |
        v
send original context unchanged
```

Shadow Mode must answer:

- how fast active context grows;
- which categories dominate token usage;
- which information becomes stale;
- which items a deterministic policy would remove / replace;
- whether removed items later become necessary;
- how often rehydration would have been needed;
- whether Working Set size can shrink naturally between model calls;
- how much behavior varies across task phases.

### 7.2 Active Rewrite Mode — Pi-gated experiment

After Shadow Mode establishes reliable observations, Pi can be used to test real model-call-level rewrite.

The Runtime may perform:

```text
ADD
REMOVE
REPLACE
COMPRESS
REHYDRATE
```

on semantic context before the model call.

Active Rewrite must be switchable per Run and must preserve a native-control baseline.

It should not begin until:

1. a representative Shadow corpus exists;
2. ContextTransition reasons are inspectable;
3. removed-item / later-needed metrics exist;
4. native benchmark tasks are repeatable;
5. rewritten message ordering and tool continuity are validated for the selected harness;
6. the experiment can fall back to unchanged native context.

### 7.3 Augment experiments

A non-destructive Augment variant may also be useful:

```text
Native context
    +
bounded Canvas-selected context
```

This can test retrieval / selection quality before removal is enabled, but it is not the main differentiation target because it still allows monotonic growth.

---

## 8. Context Policy direction

The first policy must be deterministic enough to inspect and benchmark.

Useful inputs include:

- Task phase;
- Context authority;
- P0-P3 priority;
- source freshness;
- dependency and derivation relationships;
- superseded state;
- current diff;
- current target symbols;
- latest verification evidence;
- token budget;
- previous removal / rehydration history;
- recent model-call usage.

Initial policy direction:

```text
P0
    normally KEEP

P1
    KEEP while directly task-relevant

P2
    active or cold depending on current task state

P3
    cold by default; REHYDRATE when justified
```

Authority and relevance are separate dimensions.

The first implementation should not hand the entire selection problem to another opaque LLM. Agentic / LLM-assisted selection may be tested later as a bounded policy component with observable inputs and outputs.

---

## 9. Proposed package direction

Direction only; exact public packages are not frozen.

```text
packages/
  context-runtime/
    universe/
    working-set/
    policy/
    transition/
    rendering/
    metrics/

  integrations/
    pi-context/
    opencode-context/
    codex-context/
```

Important rule:

```text
context-runtime
    MUST NOT import Pi / OpenCode / Codex provider-specific code

integration package
    MAY depend on context-runtime
```

Provider/model adapters should also remain outside the provider-neutral Runtime core.

This separation is required if Context Runtime may eventually become reusable infrastructure outside the Canvas Agent desktop application.

---

## 10. v0.3 implementation priorities

### P0-A — Pi + replaceable model research integration

Build the smallest integration capable of:

```text
Pi model call
  -> capture native context
  -> Context Runtime hook
  -> return unchanged context
  -> model provider
```

Use DeepSeek as the default bulk experiment backend where practical.

Required evidence:

- one real coding task executes end to end;
- every model call has a stable sequence / correlation identifier;
- native context size can be measured or estimated;
- no semantic rewrite occurs in Shadow Mode;
- provider choice is not embedded in Context Runtime core.

### P0-B — Model-call Context Observability

Observe at least:

- model-call boundaries;
- message / context category counts;
- token / size estimates;
- tool-call boundaries when exposed;
- file read / change evidence when exposed;
- test execution evidence;
- current task phase if known;
- native compaction events when observable;
- ContextTransition proposals.

Do not require unlimited raw payload persistence. Prefer structured metadata and bounded content-addressed evidence.

### P0-C — Shadow Working Set evaluator

Introduce provider-neutral research models:

```text
ContextUniverse
ContextWorkingSet
ContextTransition
ContextPolicy
ModelCallObservation
```

For every model call, answer:

> If Canvas controlled this call, what would it keep, remove, replace, compress or rehydrate, and why?

### P0-D — Pi active dynamic rewrite

Enable real Working Set rewriting for controlled benchmark runs.

The primary experiment is:

```text
Native Pi context management
vs
Pi + Canvas Dynamic Working Set
```

A static Canvas initial-context variant may remain as an additional baseline.

### P0-E — Benchmark and failure analysis

Do not optimize only for smaller prompts.

Primary success criterion:

> Dynamic context management maintains or improves task success while reducing irrelevant active context and preserving recoverability.

### P1 — OpenCode integration

Port the already-tested Runtime interface to OpenCode and compare:

```text
OpenCode native context management
vs
OpenCode + Canvas Runtime
```

The purpose is to validate Agent portability and compare against a stronger native context baseline.

### P2 — Codex Context Gateway

Only after the Runtime interface is supported by evidence should Codex gateway / provider-boundary work resume.

Its purpose is compatibility validation, not primary algorithm development.

### P2+ — Managed Agent Loop

A Canvas-owned Agent loop may eventually provide the cleanest native integration, but it is not required to validate the Context Runtime hypothesis.

---

## 11. Benchmark design

### 11.1 Controlled variables

For the first Pi benchmark, keep fixed where possible:

```text
same Agent harness
same model
same task
same repository revision
same tool policy
same resource budget
```

Change primarily:

```text
Context Management Strategy
```

### 11.2 Minimum variants

```text
A. Pi Native Context

B. Pi + Canvas Shadow
   actual behavior unchanged; hypothetical Working Set recorded

C. Pi + Canvas Dynamic Working Set

D. Optional: Pi + Canvas Static Initial Context
```

### 11.3 Metrics

Track at minimum:

- task success rate;
- acceptance criteria pass rate;
- total input tokens;
- peak active context size;
- average active context size;
- context growth / shrink transitions;
- tool calls;
- repeated file reads;
- repeated search operations;
- execution time;
- compaction events when observable;
- stale context retained;
- items removed;
- items later rehydrated;
- false-removal cases;
- recovery quality;
- transition explainability;
- model/provider cost where available.

A smaller Working Set with lower task success is a failure.

### 11.4 Cross-model validation

After a policy performs well on the default low-cost backend, rerun a subset with another model family.

A policy should not be promoted to a general Runtime default solely because it works with one model.

---

## 12. Observability and product direction

The eventual user-facing value is not only token savings.

Canvas should be able to explain:

```text
Model Call #18

Native Context
31.2K tokens

Canvas Working Set
16.4K tokens

KEEP
= Task instruction
= current project rule
= current diff

REMOVE
- old grep output
  superseded by resolved diagnosis

REPLACE
- full login.ts
+ authenticate() symbol
  unrelated regions inactive

REHYDRATE
+ previous test failure
  current failure signature matches
```

This supports:

```text
Observe
Understand
Control
Replay
```

Context Graph / Canvas can later visualize provenance and transitions. It is not the first Runtime implementation requirement.

---

## 13. Security and trust boundaries

Even in open research harnesses, Context Runtime is a privileged component because it may see model prompts, tool evidence and project code.

Minimum principles:

- credentials remain outside persisted Context Universe;
- known secret-bearing fields are redacted before diagnostic storage;
- request / message evidence is bounded;
- raw provider headers are not persisted;
- Agent sandbox and filesystem policies are not weakened by context control;
- Context rewrite is explicit per experiment run;
- Shadow Mode is the default until rewrite gates pass;
- integration-specific provider state is validated before rewriting;
- Runtime core does not own provider authentication.

DeepSeek or any other provider credential must remain an integration / runtime configuration concern, not part of project facts or ContextSnapshot content.

---

## 14. Non-goals

v0.3 does not attempt to:

- make Pi a permanent product dependency;
- make DeepSeek the permanent default model;
- replace OpenCode, Codex or Claude Code;
- support every Agent simultaneously;
- build a complete knowledge graph system;
- ship a full Canvas workflow editor;
- introduce multi-Agent orchestration before Context Runtime is validated;
- maximize context-window usage;
- optimize context only by token reduction;
- let another opaque LLM make all context-selection decisions.

---

## 15. Relationship with existing Canvas Agent architecture

The new direction extends the existing architecture rather than discarding it.

```text
ContextSnapshot
    immutable initial anchor

ExecutionRequest
    immutable execution contract

Worker
    isolated execution boundary

ContextRuntimeSession
    runtime context observation / control scope

Context Universe
    durable candidate information space

Context Working Set
    active derived semantic context

ModelCallObservation
    per-model-call observation

ContextTransition
    explainable Working Set evolution

Agent Integration
    Pi / OpenCode / Codex translation boundary
```

RepositoryRevision, TaskSpecVersion, Artifact and Baseline remain useful project / execution facts.

---

## 16. Recommended development order after v0.2

```text
v0.2
    finish Product MVP / RC
        |
        v
v0.3-A
    Pi research integration + DeepSeek default experiment backend
        |
        v
v0.3-B
    model-call observability + Context Universe
        |
        v
v0.3-C
    Shadow Working Set + Context Transition
        |
        v
v0.3-D
    Pi active Dynamic Working Set rewrite
        |
        v
v0.3-E
    Native vs Dynamic benchmark
        |
        v
v0.3-F
    OpenCode second implementation / stronger baseline
        |
        v
v0.4+
    Codex Context Gateway / other compatibility adapters /
    managed-loop experiments
```

Canvas / Context Graph visualization should follow observed debugging needs rather than lead the Runtime architecture.

---

## 17. Questions that v0.3 evidence must answer

1. Does non-monotonic Working Set management improve or preserve coding-task success compared with native context growth / compaction?
2. How much active context can be removed without increasing failure or repeated retrieval?
3. Which context categories become stale most often?
4. Which items are frequently removed and later rehydrated?
5. Can a deterministic policy make useful decisions at model-call granularity?
6. Does dynamic context reduce repeated file reads or tool calls?
7. Does the result generalize from DeepSeek to at least one other model family?
8. Does the provider-neutral Runtime interface survive a second Agent integration such as OpenCode?
9. Does a mature native context manager reduce or eliminate Canvas Runtime gains?
10. Can the same Runtime later integrate with Codex through a less direct Context Boundary?
11. Which ContextTransition explanations are useful to a developer rather than noise?
12. Does Context Runtime have enough independent value to become reusable infrastructure outside the Canvas Agent application?

The answers to these questions should determine v0.4 scope. They should not be assumed in advance.
