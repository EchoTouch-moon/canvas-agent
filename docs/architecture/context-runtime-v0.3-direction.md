# Context Runtime v0.3 Direction

- **Status:** PROPOSED
- **Target:** v0.3 after Product MVP v0.2 closeout
- **Scope:** Context Runtime validation, not a replacement of existing execution architecture

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

The next research question is not how to create a larger static context package, but how to manage the active context used throughout a long-running Agent task.

The core hypothesis:

> A coding Agent should not rely on monotonically growing context. The system should maintain an observable and controllable Context Working Set that changes with task phase and execution evidence.

## 2. Terminology

### 2.1 ContextSnapshot

ContextSnapshot remains the immutable starting point of a Run.

It answers:

> What project facts, constraints and repository state were intentionally provided when execution started?

It does not represent every piece of information discovered during execution.

## 2.2 Context Universe

Context Universe contains all information that may participate in future context composition.

Possible sources:

- frozen ContextSnapshot items;
- project facts;
- repository observations;
- tool results;
- test results;
- generated artifacts;
- decisions created during execution;
- summaries of previous phases.

## 2.3 Context Working Set

Context Working Set is the active subset rendered to an Agent execution phase.

```text
Context Universe
        |
        v
Context Working Set
        |
        v
Rendered Agent Context
```

Unlike Snapshot, Working Set is derived and can evolve.

## 3. Architecture Direction

Future execution flow:

```text
TaskSpec
   |
   v
ContextSnapshot
   |
   v
Context Runtime
   |
   +--> compose Working Set
   |
   +--> execute Agent phase
   |
   +--> collect observations
   |
   +--> update Working Set
   |
   v
Artifact / Baseline Draft
```

## 4. Context Transition

Every Working Set change should be explainable.

Example:

```text
ContextTransition #12

FROM:
WorkingSet #11 (32K tokens)

TO:
WorkingSet #12 (15K tokens)

Changes:
+ add failing test evidence
- remove superseded grep output
- replace full file with symbol range
+ add current diff
```

Transition types:

- ADD
- REMOVE
- REPLACE
- COMPRESS
- REHYDRATE
- PRIORITY_CHANGE

## 5. Adapter Capability Model

Different Agent adapters have different levels of context control.

```text
INITIAL_ONLY
    Initial context injection only

PHASE_LEVEL
    Recompose context between execution phases

MODEL_CALL_LEVEL
    Control context before every model invocation
```

The first implementation target is PHASE_LEVEL.

The project does not require immediate replacement of existing Agent runtimes.

## 6. v0.3 Implementation Priorities

### P0 - Observability

Promote execution observation capabilities:

- RunEvent;
- ToolInvocation;
- file access/change evidence;
- test execution evidence;
- token usage;
- phase boundaries.

Goal:

Understand how context changes during real Agent execution.

### P0 - Context Working Set Model

Introduce runtime concepts:

```text
ContextUniverse
ContextWorkingSet
ContextTransition
```

### P0 - Phase-level Recomposition Experiment

Validate:

```text
Investigation Context
        -> Agent
Diagnosis Context
        -> Agent
Implementation Context
        -> Agent
Verification Context
        -> Agent
```

Measure against static context execution.

## 7. Non-goals

v0.3 does not attempt to:

- replace Codex or other Agent runtimes;
- control every internal model call immediately;
- build a general workflow engine;
- create a full knowledge graph system;
- optimize context only by token reduction.

The objective is better task reliability and controllability, not merely smaller prompts.

## 8. Evaluation Criteria

Experiments should compare:

- task success rate;
- total input tokens;
- peak context size;
- average working set size;
- tool calls;
- repeated file reads;
- execution time;
- recovery quality;
- context transition explainability.

Success means:

> Dynamic context management maintains or improves Agent performance while reducing irrelevant active context.

## 9. Relationship With Existing Architecture

This direction extends existing concepts:

```text
ContextSnapshot
    = immutable anchor

ExecutionRequest
    = execution contract

Context Working Set
    = runtime active context

RunEvent
    = observation stream

ContextTransition
    = explainable evolution
```

No replacement of current Snapshot, ExecutionRequest or Worker boundaries is required.
