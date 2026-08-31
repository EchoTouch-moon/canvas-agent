# CR-004 LC1 External-Observation Queue Safety Audit

Date: 2026-08-30
Status: `EXECUTED / CREDENTIAL-FREE / TEST-ONLY DIAGNOSTIC`
Baseline: `codex/cr004-lc1-runtime-queue@ab0899c`
Scope: existing provider-neutral queue, synthetic authority envelopes, no production change

## Purpose

PR #65 established that an ordered real `RepositoryObserver` result can pass
through the external-observation queue and the normal Universe reconciliation
path. This audit probes the safety assumptions that must hold before a
production Pi-to-repository mapping is allowed to enqueue observations.

The audit deliberately distinguishes an observed current behavior from an
accepted production contract. `OPEN_SAFETY_GAP` is evidence that the current
queue lacks a required guard; it is not a request to reinterpret the behavior
as safe.

## Findings

### 1. Out-of-order authority can roll the head backward

```text
queue committed v4
  → boundary admits v4
older v3 result completes later
  → queue admits v3
  → current head rolls back to v3
```

Result: `OPEN_SAFETY_GAP`.

`ExternalObservation` currently carries a source observation and descriptor,
but no comparable authority revision or monotonic adapter sequence. The queue
deduplicates by `sourceKey` and the last pending item wins. Therefore it cannot
reject a stale result that arrives after a newer result. This is a production
safety finding, not a live experiment result.

### 2. Same-source descriptor metadata can drift

```text
repository/file://src/reopen-a.ts
  descriptor: REPOSITORY_OBSERVER / git:v3
  → same source and same content
  descriptor: UNTRUSTED_ADAPTER / forged:v3
```

Result: `OPEN_SAFETY_GAP`.

The current queue checks only observation/descriptor `sourceKey` equality. It
does not freeze or validate source kind, provenance, or authority metadata for
an already-known source. A production bridge must not allow an untrusted or
conflicting descriptor to overwrite the source's authority identity.

### 3. Batch enqueue is failure-atomic

An observation/descriptor source-key mismatch is rejected before any item is
queued, and the subsequent model-call boundary contains neither item.

Result: `PASS`.

The existing all-before-mutate validation behavior should be preserved by any
future queue hardening.

## Audit result

```text
Out-of-order authority rejection:       OPEN_SAFETY_GAP
Same-source descriptor immutability:    OPEN_SAFETY_GAP
Batch enqueue failure atomicity:         PASS
Provider calls:                          0
Production files changed:                0
Live Shadow / CR-004 Active Rewrite:     NO_GO
```

## Required pre-production contract

Before production mapping, one separately reviewed design must provide all of
the following:

1. An authority envelope with a comparable revision or monotonic adapter
   sequence, bound to repository and namespace identity.
2. Deterministic stale-event handling: reject, quarantine, or otherwise prove
   that an older result cannot replace a newer admitted head.
3. Descriptor immutability or explicit versioned descriptor changes; a
   source-key match alone is insufficient.
4. Preservation of the already-green guarantees: batch validation before
   mutation, `AVAILABLE` / `UNAVAILABLE` / `ABSENT` distinctions, transaction
   restore, and deterministic replay.

The audit does not choose the implementation strategy and does not authorize
changing the queue, `policy-v0`, Planner, Pi messages, or provider execution.
