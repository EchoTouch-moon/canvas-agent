# CR-004 LC1 Production Read-Only Mapping Candidate

Date: 2026-08-31
Status: `EXECUTED / CREDENTIAL-FREE / EXPERIMENTAL CANDIDATE`
Baseline: `codex/cr004-lc1-production-contract@8beab6f`
Scope: Pi read identity → caller-bound RepositoryObserver → provider-neutral external queue

## Purpose

This packet validates the first implementation candidate for the LC1
production-boundary contract. It is intentionally a read-only, experimental
surface. It does not change the Planner or `policy-v0`, rewrite model-facing
messages, register a Pi extension, or call a provider.

The candidate accepts a caller-bound repository identity and expected revision,
extracts only exact Pi tool-call/result identity plus a derived path hint, and
uses the real `RepositoryObserver` for repository truth. Pi result text is
never used as file content or as a content hash.

## Implemented boundary

`Lc1ProductionRepositoryMapper` is exported only from the explicit
`@canvas-agent/pi-context-integration/experimental` entry. The stable package
root remains unchanged.

The mapping sequence is:

```text
Pi tool call/result identity
  → exact call-id and read-tool checks
  → normalized path hint
  → caller-bound repositoryId + namespace resolver
  → real RepositoryObserver(expectedRevision, canonicalPath)
  → verified AVAILABLE / UNAVAILABLE / explicit ABSENT
  → scoped authority/order checks
  → staged external observation
  → existing EnrichedPiShadowObserver queue
```

The accepted envelope retains repository and namespace identity, canonical
path, source key, Pi call identity, authority revision, adapter-owned order,
source descriptor, observation status, and `FULL` representation kind.

## Safety behavior covered

The candidate rejects or quarantines the following conditions before an
observation can be admitted as repository truth:

- missing, duplicate, unmatched, or remapped tool-call ids;
- tool-result name differing from its tool-call name;
- unsupported tools, missing path hints, and unsafe path hints;
- unbound or throwing repository-scope resolution;
- authority observation failure, key mismatch, or unverified `AVAILABLE` /
  `ABSENT` results;
- stale authority order, incomparable streams, same-order conflicting
  envelopes, and descriptor drift;
- a same-path source-key collision across repository or namespace scopes;
- queue failure without committing the mapper's local authority state.

Equal authority is idempotent only when the complete accepted envelope is
identical, including call identity, observation timestamp, descriptor,
revision, and order. A different Pi event at the same authority order is
therefore quarantined as a conflict rather than silently deduplicated.

The mapper also binds a call id to its first logical repository source within a
runtime session. A later event cannot reuse that id for another repository,
namespace, or path.

## Repository lifecycle evidence

The tests use temporary real Git repositories and the real
`RepositoryObserver`:

```text
committed v3
  → AVAILABLE / INITIALIZE
working tree changed while expected v3 is retained
  → UNAVAILABLE / REVISION_MISMATCH / RETAIN_LAST_KNOWN
committed v4
  → AVAILABLE / UPDATE
file deleted and deletion committed
  → explicit ABSENT / REMOVE
```

The mapper admits the authoritative Git hash rather than the Pi result text.
The existing Universe reconciliation path retains the previous version during
`UNAVAILABLE`, advances to v4 only after the committed v4 observation, and
removes the admitted head only after explicit Git absence.

## Transaction and replay evidence

The mapper's authority/order state has an explicit
`snapshotForTransaction()` / `restoreTransaction()` seam. The integration test
snapshots both mapper and `EnrichedPiShadowObserver`, consumes a queued
observation, restores both, and replays the same request. The replay requeues
the observation and produces the same Universe logical hash.

This paired restore is required: restoring only the Runtime queue while
leaving the mapper's local state committed would cause a retried event to be
treated as an idempotent duplicate and disappear from the restored queue.

## Local verification

```text
LC1 production-mapping targeted suite: 9/9 PASS
Pi integration package:                 24 files / 302 tests PASS
Context Runtime package:                 9 files / 143 tests PASS
Repository Observer package:             2 files / 39 tests PASS
Pi integration typecheck:                    PASS
Provider calls:                              0
Model-facing message rewrites:              0
Planner / policy-v0 changes:                0
CR-005 manifest or fixture changes:         0
```

## Deliberate limits

This remains an experimental candidate and is not a live integration:

1. No Pi extension is wired to call the mapper, and no provider or model call
   was made.
2. The caller-bound path resolver is an injected authority boundary; this
   candidate does not implement a persistent repository registry or cross-
   process state store.
3. The existing external queue still keys pending observations by its
   path-based `sourceKey`. The candidate therefore quarantines same-session
   cross-scope collisions instead of pretending that two repositories with
   the same path are one logical source. A future scoped source-key protocol
   may be needed if one runtime session must represent both repositories
   concurrently.
4. Mapper snapshots must be included in the same encompassing transaction as
   the Runtime snapshot. A sink that mutates state and then throws cannot be
   rolled back by this adapter; the sink contract must remain validate-before-
   mutate. The existing Enriched queue preserves that behavior.
5. The candidate observes repository hashes and statuses; it does not yet
   choose representations, perform `REMOVE` / `REHYDRATE`, or modify model
   context. Those remain later policy and live-experiment questions.

## Research gate result

```text
LC1 production mapping candidate:  EXECUTED / CREDENTIAL-FREE
Identity and scope binding:        PASS
Repository authority binding:     PASS
AVAILABLE/UNAVAILABLE/ABSENT:      PASS
Order and descriptor guards:       PASS
Transaction/replay seam:           PASS
Production Pi wiring:              NOT IMPLEMENTED
Live Shadow:                       NO_GO
Provider execution:               NO_GO
CR-004 Active Rewrite:             NO_GO
policy-v0 / Planner modification:  NO_GO
```

This packet is evidence for a bounded implementation candidate, not an
authorization for a live Shadow run or Active Rewrite. A separate Lead review
of the implementation diff and a separate live authorization remain required.
