# CR-002 Architecture Acceptance — Context Source / Reconciliation / Shadow Universe

- **Status:** ✅ ACCEPTED
- **Date:** 2026-08-11
- **PR:** #16
- **Accepted implementation HEAD:** `3bc1ee4042355f76ed5e518f3fa7c5d8844c6e09`
- **Implementation branch:** `agent/deepseek-ds-009-context-source-universe-shadow`
- **Implementation packet:** `docs/tasks/deepseek/DS-009-context-source-universe-shadow.md`
- **Primary verification:** `docs/verification/context-runtime-cr-002-source-universe-shadow.md`

## Decision

CR-002 / DS-009 is accepted as the provider-neutral in-memory research implementation for:

```text
Observed Context Elements
        ↓
Source Attribution
        ↓
SourceObservation
        ↓
Source Reconciliation
        ↓
ContextSourceState
        ↓
Shadow Context Universe Revision
```

The implementation is accepted as sufficiently stable and truthful to unblock the CR-003 Shadow Working Set Planner gate, subject to the scoped limitations below.

## Acceptance gates

### Gate 1 — Universe invariant

**ACCEPTED.** The invariant sweep enforces across the full state-transition chain:

```text
admittedVersionId === null   iff   admittedVersion === null
admittedVersionId !== null   =>    admittedVersion.versionId === admittedVersionId
observationStatus === ABSENT =>    admittedVersionId === null && admittedVersion === null
```

The sweep covers seed → NO_CHANGE → UPDATE → UNAVAILABLE → ABSENT and checks every Universe entry after each revision.

### Gate 2 — SourceVersion identity

**ACCEPTED with documented limitation.** SourceVersion identity remains:

```text
H(sourceKey, contentHash)
```

For `run/tool-*` sources, `contentHash` is currently a source-local semantic digest rather than a globally content-pure digest because `toolCallId` participates redundantly in the semantic hash. This does not violate CR-002 source-scoped version identity.

Do not reuse the current run-event `contentHash` as a guarantee for:

- cross-source semantic equality;
- global content deduplication;
- blob addressing;
- Repository Observer content identity.

### Gate 3 — Runtime core / Pi integration boundary

**ACCEPTED.** Both Runtime production code and Runtime tests are provider-neutral.

```text
Pi
 ↓
packages/pi-context-integration
  - Pi message knowledge
  - PI_* attribution methods
  - Pi source descriptors
 ↓
packages/context-runtime
  - provider-neutral attribution vocabulary
  - provider-neutral source/reconciliation/universe types
  - provider-neutral tests
```

`packages/context-runtime` contains no Pi/provider imports and does not infer source kind/provenance by parsing Pi-specific keys. The final acceptance correction replaced Pi vocabulary in Runtime tests with neutral `TEST_*` identifiers.

### Gate 4 — Live seam / fixture semantics

**ACCEPTED.** `UNAVAILABLE → RETAIN_LAST_KNOWN` is implemented independently of the current live producer coverage.

Required producer semantics remain:

```text
UNAVAILABLE = observer cannot reliably establish current state
              => retain last admitted knowledge

ABSENT      = observer authoritatively confirms non-existence
              => revoke current admitted version
```

Read/observer failure must never be translated into `ABSENT`.

## Original PR #16 blocking review items

All original blocking items are resolved:

1. admitted ContextSourceVersion retention on NO_CHANGE / UNAVAILABLE;
2. TOOL_RESULT version hashing includes model-relevant result semantics;
3. SourceObservation uses the same model-call `observedAt` clock value;
4. Pi-specific attribution methods live outside Runtime core;
5. Universe entries retain explicit provider-neutral source descriptor/provenance;
6. SourceObservation is a structurally valid discriminated union.

The final bounded correction additionally removed Pi vocabulary from `packages/context-runtime` tests.

## Verification accepted

Final deterministic evidence at acceptance:

```text
pnpm --filter @canvas-agent/context-runtime test         55 passed
pnpm --filter @canvas-agent/pi-context-integration test  40 passed
both package typechecks                                  PASS
pnpm check                                               GREEN (565 tests + build)
GitHub Actions CI                                         SUCCESS
```

The enriched Pi + DeepSeek smoke remains valid behavioral evidence because the final acceptance correction changed only tests/documentation, not production Runtime behavior.

Accepted smoke evidence:

```text
runtimeSessionId: smoke-cr002-2026-08-11T08-14-40-983Z
semantic model calls: 5
final EXACT: 8
final UNATTRIBUTED: 4
resourceHints: 4
Universe revision: 5
Universe sources: 9
```

Durable evidence remains metadata-only; no raw prompt/tool-result content or credentials are committed.

## Replay claim boundary

CR-002 proves deterministic replay from:

```text
snapshot-like seed + ordered SourceObservation batches
```

to the same final Universe entries and `logicalHash`.

It does **not** claim event-log-only replay from a production persisted reconciliation-event store. That remains future work.

## Accepted follow-up gaps — not CR-002 rejection criteria

### Repository Observer

`repository/file://*` resource identities derived from Pi tool arguments remain `DERIVED_HINT` unless a real Repository Observer authoritatively observes canonical file state.

A Repository Observer is a follow-up capability and may be required before a file-centric Planner policy can be treated as trustworthy.

### Live UNAVAILABLE producer

The `UNAVAILABLE` contract is implemented and test-locked, but the current Pi `context` seam has not produced it in the live CR-002 smoke. A live producer can be added later without changing the Runtime reconciliation contract.

## Scope confirmation

At acceptance:

```text
No Context Working Set Planner was implemented.
No Pi model-call context was rewritten.
No production persistence schema was added.
No v0.2 ContextSnapshot or ExecutionRequest contract was changed.
CR-003 was not started.
```

## Next gate

CR-002 no longer blocks CR-003.

CR-003 may now begin as a separately scoped Shadow Working Set Planner experiment. Its first implementation must continue to distinguish trustworthy admitted sources from non-canonical resource hints; if file-level canonical state is required by the first Planner policy, add/authorize a Repository Observer experiment rather than promoting Pi path hints into authoritative file sources.
