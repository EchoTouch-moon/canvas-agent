# Context Runtime v0.3 — CR-002 Execution Plan

- **Status:** ASSIGNED — implementation starts after this packet merges to `main`
- **Owner:** DeepSeek V4 Flash
- **Task packet:** `docs/tasks/deepseek/DS-009-context-source-universe-shadow.md`
- **Implementation branch:** `agent/deepseek-ds-009-context-source-universe-shadow`
- **Depends on:** CR-001 accepted / PR #14 merged at `main@34488bab745ded1ee18ea225c2a3877fd18e7737`
- **Architecture input:** `PROPOSAL-030-context-source-universe-model.md`
- **Downstream gate:** CR-003 remains blocked until lead review of CR-002 evidence

## 1. Research question

CR-001 proved that Pi exposes a stable pre-LLM `AgentMessage[]` observation boundary. It did **not** prove that each observed message corresponds to an independent Context Source.

CR-002 asks:

> What minimum attribution and reconciliation layer is required to turn assembled model-call observations into trustworthy, replayable Context Universe state without inventing source identity?

The working hypothesis is:

```text
AgentMessage[]
    -> Observed Context Elements
    -> Source Attribution
    -> Provisional Source Observations
    -> Source Reconciliation
    -> Shadow Context Universe Revision
```

The hypothesis is allowed to fail or require revision.

## 2. Fixed constraints

CR-002 must preserve:

```text
Observed Context Element != Context Source
Source Observation != Source Reconciliation
Source Reconciliation != Working Set Planning
Context Universe != Context Working Set
ContextSnapshot != Runtime Source State
```

No model-call rewrite is allowed.

No stable public Runtime schema or production persistence table is authorized.

## 3. Attribution policy

Use deterministic structured evidence only.

Required attribution outcomes:

```text
EXACT
DERIVED_HINT
UNATTRIBUTED
OPAQUE
```

Examples:

- Pi `toolCallId` can provide exact run-event correlation.
- structured `read` arguments may provide a derived repository path hint.
- free-form assistant prose must not be parsed to manufacture source identity.
- content hash proves content equality, not source identity.
- a message disappearing from a later context does not prove source `ABSENT`.

Attribution coverage is a research metric, not a target to maximize.

## 4. Experiment phases

### Phase A — observation decomposition

Refine CR-001 observations into model-visible semantic elements and prove deterministic repeated-element correlation across model calls.

Evidence:

- element timeline;
- stable semantic hashes;
- tool call/result correlation;
- no raw-secret durable output.

### Phase B — source attribution

Generate attribution records with explicit evidence/method.

Evidence:

- EXACT / DERIVED_HINT / UNATTRIBUTED / OPAQUE counts;
- examples for each observed category;
- no free-form identity guessing.

### Phase C — source reconciliation fixtures

Exercise PROPOSAL-030 semantics with in-memory/fixture observers:

```text
AVAILABLE first      -> INITIALIZE
AVAILABLE same       -> NO_CHANGE
AVAILABLE changed    -> UPDATE
ABSENT               -> REMOVE
UNAVAILABLE          -> RETAIN_LAST_KNOWN
```

Evidence:

- immutable source-version history;
- last-known retention;
- no ABSENT/UNAVAILABLE conflation.

### Phase D — Shadow Universe

Seed a neutral Snapshot-like initial state, apply runtime source observations, and emit immutable/hashable Universe revisions correlated to model-call boundaries.

Evidence:

- sequence 0 seed;
- later revision with changed head;
- original seed still addressable;
- deterministic logical hash;
- exact replay from seed + reconciliation events.

### Phase E — live enriched shadow

Run one small Pi + DeepSeek task when credentials are intentionally available. Pi messages remain unchanged.

Evidence is metadata-only:

```text
model call
observed element count
attribution coverage
source count
reconciliation count
universe revision/hash
```

## 5. Promotion gate

CR-002 is successful enough for architecture review when all are true:

1. assembled Pi messages can be decomposed without pretending they are sources;
2. structured event correlation is deterministic;
3. untrusted/unknown attribution remains explicit;
4. Source Reconciliation semantics are test-locked;
5. Shadow Universe revisions can be replayed;
6. Snapshot-like seed and runtime-derived state stay distinct;
7. `packages/context-runtime` remains Agent/model neutral;
8. no Working Set decisions have been implemented;
9. `pnpm check` is green;
10. the verification report identifies where PROPOSAL-030 matches or conflicts with real evidence.

Lead architect then chooses one of:

```text
A. revise PROPOSAL-030 and repeat CR-002 evidence
B. accept CR-002 model and authorize CR-003 Shadow Planner
C. narrow the ContextSource claim if attribution is insufficient
```

DeepSeek does not make this promotion decision.

## 6. Required deliverable

Primary evidence file:

`docs/verification/context-runtime-cr-002-source-universe-shadow.md`

The complete implementation/verification contract is in DS-009.