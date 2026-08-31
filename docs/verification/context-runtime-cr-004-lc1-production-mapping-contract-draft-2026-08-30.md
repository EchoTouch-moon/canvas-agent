# CR-004 LC1 Production Mapping Contract (Draft)

Date: 2026-08-30
Status: `DESIGN-ONLY / PENDING LEAD REVIEW`
Baseline: `codex/cr004-lc1-queue-safety-audit@b4e1879`
Scope: production read-only identity mapping boundary; no implementation

## Position in the research sequence

The LC1 deterministic evidence now establishes three separate facts:

1. The current Pi seam provides exact run-event identity and only a derived
   repository path hint.
2. The real `RepositoryObserver` can establish repository/file truth at an
   exact expected revision and preserve `AVAILABLE`, `UNAVAILABLE`, and
   explicit `ABSENT`.
3. The existing external-observation queue can carry an ordered authoritative
   result through Universe reconciliation, but it currently lacks stale-event
   and descriptor-integrity guards.

This document is therefore a production-boundary proposal, not a production
change. The proposed mapper is a core prerequisite for any future active
context selection, while Active Rewrite, provider execution, and CR-004 live
canaries remain separately gated.

## Required data boundary

The production adapter should accept only a caller-bound request containing:

```text
runtimeSessionId
repositoryId
namespace
expectedRepositoryRevision
Pi read event identity (tool call id)
canonicalized path candidate
```

The Pi event supplies identity and a path hint. It does not supply repository
truth, content hash, SourceVersion identity, or absence. The adapter must call
the authoritative RepositoryObserver with the bound repository and expected
revision; tool-result text and assistant claims must not replace that source of
truth.

The resulting envelope should retain, at minimum:

```text
sourceKey
repositoryId
namespace
canonicalPath
authorityRevision
authorityOrder / causal token
status: AVAILABLE | UNAVAILABLE | ABSENT
contentHash (AVAILABLE only)
representationKind
sourceKind / provenance
Pi event identity
```

`authorityOrder / causal token` is intentionally not defined as a lexical Git
SHA comparison. Git revisions from different branches can be incomparable. A
single adapter-owned serialized order, or an explicit causal relation, is
required; an event with no safe ordering relation must be quarantined rather
than guessed into the queue.

## Invariants

### Identity and scope

- A path hint is never canonical by itself.
- Repository and namespace are part of logical source identity.
- A call id cannot be remapped to another source within a runtime session.
- Missing call id, unsupported read shape, unsafe path, ambiguous authority, or
  cross-scope authority is unmapped and cannot be queued as repository truth.
- The mapper must not trust Pi result text as the authoritative content hash.

### Authority and status

- `AVAILABLE` requires a successful observation at the expected revision and a
  content hash from the authority.
- `UNAVAILABLE` remains `UNAVAILABLE`; it never becomes `ABSENT`, `ADD`, or
  `REHYDRATE`.
- `ABSENT` is emitted only from explicit confirmed absence at a verified
  revision.
- A dirty or changed repository revision is conservative and carries no
  verified revision.

### Ordering and descriptor integrity

- Per `(repositoryId, namespace, canonicalPath)`, an older authority result
  cannot replace a newer admitted head.
- Equal authority order is idempotent only when the complete envelope is
  identical; same-order conflicting payloads are quarantined.
- Incomparable branch/epoch results are quarantined until a caller-defined
  reconciliation decision exists.
- Source kind, provenance, authority scope, and ordering metadata are frozen
  for a source identity or changed only through an explicit versioned protocol.
- A `sourceKey` match alone never authorizes descriptor replacement.

### Queue transaction

- Validate the entire incoming batch before mutating pending state.
- Stage accepted, rejected, and quarantined envelopes separately so rejection
  is observable and cannot silently disappear.
- Consume accepted observations only at the model-call boundary.
- Transaction restore must restore pending envelopes, model-call sequence,
  Universe revision, and call-result log together.
- Replaying the same accepted envelope sequence must produce the same logical
  hash and the same rejection/quarantine decisions.

## Candidate API shape (illustrative, not frozen)

```ts
interface AuthoritativePiReadEnvelope {
  readonly runtimeSessionId: string;
  readonly repositoryId: string;
  readonly namespace: string;
  readonly callId: string;
  readonly sourceKey: string;
  readonly canonicalPath: string;
  readonly authorityRevision: RepositoryRevisionContract;
  readonly authorityOrder: string;
  readonly observation: SourceObservation;
  readonly descriptor: ContextSourceDescriptor;
}

interface QueueAdmissionResult {
  readonly accepted: readonly AuthoritativePiReadEnvelope[];
  readonly rejected: readonly {
    readonly callId: string;
    readonly reason: string;
  }[];
  readonly quarantined: readonly {
    readonly callId: string;
    readonly reason: string;
  }[];
}
```

The exact public type should be chosen only after Lead review. In particular,
the current `ExternalObservation` type does not yet carry enough ordering
metadata to satisfy this contract.

## Deterministic acceptance matrix

Before production mapping is merged, a credential-free suite should cover at
least:

```text
clean v3 → AVAILABLE → admit
dirty v3 expectation → UNAVAILABLE → retain last known
committed v4 → UPDATE → admit newer version
explicit deletion → ABSENT → remove source head
v4 then stale v3 → reject/quarantine stale v3
same order, same envelope → idempotent
same order, conflicting envelope → quarantine
descriptor provenance drift → reject/quarantine
cross-repository same path → reject
unsafe/ambiguous path → reject
batch mismatch → no partial queue mutation
snapshot → consume → restore → deterministic replay
```

The suite must use the real RepositoryObserver for repository truth, while
keeping Pi/provider input synthetic and credential-free. It must not modify
`policy-v0`, Planner behavior, CR-005 fixtures/manifests, or model-facing
messages.

## Gate sequence

```text
Lead review of this contract
  ↓
separate production read-only mapper implementation
  ↓
zero-provider regression against the matrix above
  ↓
full repository CI
  ↓
Lead review of implementation diff
  ↓
separate live Shadow authorization
  ↓
only then evaluate Active Rewrite readiness
```

Writing or accepting this document grants none of the later permissions. Until
the ordering and descriptor gates are implemented and verified:

```text
Provider execution:              NO_GO
Live Shadow:                     NO_GO
CR-004 Active Rewrite:           NO_GO
policy-v0 / Planner modification: NO_GO
```
