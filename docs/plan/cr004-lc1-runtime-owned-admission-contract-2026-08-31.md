# CR-004 LC1 — Runtime-Owned Repository Admission Contract

**Classification:** core active-safety prerequisite

**Status:** `DESIGN DECISION / IMPLEMENTATION NOT STARTED / PROVIDER 0`

**Date:** 2026-08-31

**Baseline:** `codex/cr004-lc1-mapper-instance-audit@9a9106c`

## Decision

Adopt a runtime-session-owned repository admission coordinator as the next LC1
mechanism. Do not make shared mapper state the authoritative safety boundary.

Keep the historical path-based repository `sourceKey` schema unchanged for the
current single-workspace runtime. Enforce one repository scope per runtime
session and quarantine any different scope. A scoped source-identity v2 remains
a future direction, triggered only if one runtime session must represent two
repositories concurrently.

This is a design decision only. It does not authorize production implementation,
live Shadow, Step Plan calls, Pi message rewriting, Planner changes, or CR-004
Active Rewrite.

## Why this is core rather than an enhancement

The instance-safety audit reproduced three failures against the PR #68
candidate:

1. two mapper instances can admit sequence 2 and then sequence 1, rolling a
   runtime head backward;
2. a mapper restart without state transfer can admit another repository at the
   same path-based source identity; and
3. a caller can bypass mapper-local guards through the external-observation
   queue.

These are admission-integrity failures. A live experiment could otherwise
attribute stale or cross-scope state to context policy, so the repair is part of
the minimum trustworthy experiment loop.

## Ownership boundary

The target ownership model is:

```text
Runtime session
  └─ repository admission coordinator
       ├─ bound repository scope
       ├─ accepted authority order per logical path
       ├─ immutable descriptor fingerprint per logical path
       ├─ Pi call-id binding
       ├─ pending accepted envelopes
       └─ transactional snapshot / restore state

Repository mapper instance
  ├─ validates Pi read call/result shape
  ├─ normalizes the path hint
  ├─ resolves the caller-bound repository
  ├─ asks RepositoryObserver for revision-bound truth
  └─ submits a complete candidate envelope
```

Mapper instances may be created, replaced, or run concurrently. None owns the
authoritative accepted head.

## Required envelope

The coordinator input must retain enough information to make a decision without
consulting mapper-local history:

```text
runtimeSessionId
repositoryId
namespace
canonicalPath
sourceKey
Pi call ids and namespaced evidence ids
authority revision
authority stream id + monotonic sequence
observation status and content hash when AVAILABLE
source descriptor
representation kind
```

Repository scope and authority order are decision inputs, not diagnostic-only
metadata. The coordinator must return explicit accepted, rejected, and
quarantined outcomes.

## Production queue rule

In production admission mode, a repository/file observation claiming
repository authority must not enter through the legacy general external queue.
It must pass through the runtime-owned coordinator.

The implementation may use a dedicated typed admission port or a strict queue
mode, but it must prove this observable rule:

```text
direct repository-authority queue write
  → rejected before pending state changes
```

Existing synthetic and historical Shadow helpers may retain an explicitly
named legacy/test-only path. That path must not be selected by the production
composition and must not silently become the live default.

## Single-scope invariant for sourceKey v1

The product workspace runtime currently holds one READY repository at a time.
Repository switching is mutually exclusive with active runs and replaces the
workspace runtime. Under that product boundary, LC1 may preserve the existing
`repository/file://<canonicalPath>` key while enforcing:

```text
one runtimeSessionId
  → exactly one bound (repositoryId, namespace)
```

Within a live runtime session:

- the first verified repository scope binds the coordinator;
- the same scope may continue across mapper instances;
- a different scope is quarantined before queue mutation; and
- repository switching requires a new runtime session/coordinator identity.

This avoids silently changing historical SourceVersion identity while keeping
cross-scope conflation fail-closed.

## Deferred scoped source identity

Scoped source identity v2 is classified as a future direction, not part of the
current repair. It becomes core only if a separately approved requirement says
one runtime session must concurrently represent the same canonical path from
multiple repositories or namespaces.

If triggered, it requires an explicit versioned migration. Historical v1
`sourceKey`, SourceVersion ids, transitions, and replay evidence must not be
rewritten in place.

## Transaction and lifecycle rules

The coordinator state must be included in the same transaction boundary as:

- pending external observations;
- Universe revision;
- model-call sequence;
- call-result log; and
- any future Active transition state that consumes the admitted observation.

Restoring a transaction must restore all of them. A replacement mapper must not
need a separate snapshot to preserve admission safety.

Runtime/coordinator restart has two valid forms:

1. restore a validated runtime snapshot and preserve exact admission state; or
2. start a new runtime session identity with no claim of continuity.

Reusing a runtime session id while discarding coordinator state is invalid and
must fail closed.

## Credential-free implementation oracle

The next implementation task must keep the PR #69 traces frozen and make their
outcomes change only through the new coordinator:

| Case                                                | Required result                                        |
| --------------------------------------------------- | ------------------------------------------------------ |
| two mappers: sequence 2 completes before sequence 1 | v4 retained; sequence 1 `STALE_AUTHORITY`              |
| mapper restart, same repository scope               | accepted history preserved by runtime owner            |
| mapper restart, different repository at same path   | `CROSS_SCOPE_COLLISION`; no queue mutation             |
| direct repository-authority queue write             | rejected before queue mutation                         |
| same mapper concurrent out-of-order completion      | existing stale rejection preserved                     |
| equal order + identical complete envelope           | idempotent duplicate                                   |
| equal order + different complete envelope           | `CONFLICTING_AUTHORITY` quarantine                     |
| different authority stream without reconciliation   | `INCOMPARABLE_AUTHORITY` quarantine                    |
| descriptor drift                                    | quarantine; admitted descriptor unchanged              |
| one invalid item in a batch                         | whole batch leaves pending state unchanged             |
| snapshot, consume, restore, replay                  | identical admission outcomes and Universe logical hash |
| restored runtime + fresh mapper                     | stale and cross-scope guards still active              |
| new runtime session after repository switch         | new scope may bind without inheriting old head         |

Mutation tests must also demonstrate that removing each guard causes the
corresponding oracle case to fail. A green happy path alone is insufficient.

## Implementation sequencing

```text
LC1 runtime-owned admission contract review
  ↓
test-first coordinator candidate on a separate branch
  ↓
frozen PR #69 adversarial traces become protected outcomes
  ↓
full credential-free repository CI
  ↓
Lead implementation review
  ↓
separate live Shadow / Step Plan authorization
```

The first implementation task may change only the LC1 experimental mapping and
Pi integration admission boundary plus their tests/evidence. It must not modify
Planner policy, CR-005 fixtures/manifests, model-provider routing, model-facing
messages, or Active rewrite behavior.

## Gate state

```text
Runtime-owned admission:          SELECTED CORE MECHANISM / DESIGN ONLY
Shared mapper state as authority: REJECTED
Single-scope sourceKey v1:        RETAIN WITH FAIL-CLOSED SCOPE BINDING
Scoped source identity v2:        FUTURE / TRIGGERED BY MULTI-REPOSITORY REQUIREMENT
Provider calls:                   0
Live Shadow / Step Plan:          NO_GO
CR-004 Active Rewrite:            NO_GO
```
