# CR-004 LC1 Pi + Repository Authority Queue Conformance

Date: 2026-08-30
Status: `EXECUTED / CREDENTIAL-FREE / TEST-ONLY CANDIDATE`
Baseline: `codex/cr004-lc1-repository-bridge@4633b05`
Scope: temporary Git fixture, existing RepositoryObserver, existing external-observation queue

## Purpose

The preceding LC1 candidate verified the mapping from Pi read events to a
logical source identity using real `RepositoryObserver` authority. This packet
checks the next boundary: the same authoritative repository result can enter
the provider-neutral external-observation queue and reach the existing
`EnrichedPiShadowObserver` Universe reconciliation path without being
confused with Pi run-event identity.

No provider, live Pi session, Planner change, policy change, or model-facing
context rewrite is used.

## Executed chains

### Authority and Pi event remain separate

```text
Pi read path hint
  → canonical path discovery
  → real RepositoryObserver at committed v3
  → AVAILABLE repository/file observation
  → external-observation queue
  → EnrichedPiShadowObserver Universe entry
```

The repository entry is keyed by `repository/file://src/reopen-a.ts` and uses
the Git blob hash. The same Pi message also produces its independent
`run/tool-result://<callId>` entry with `PI_CONTEXT_EVENT` provenance; the
run-event semantic hash is not used as the repository file hash.

### Real repository lifecycle

```text
committed v3
  → AVAILABLE / INITIALIZE
working tree edited to v4, expected v3 retained
  → UNAVAILABLE / REVISION_MISMATCH / RETAIN_LAST_KNOWN
v4 committed
  → AVAILABLE / UPDATE
file deleted and deletion committed
  → explicit ABSENT / REMOVE
```

The dirty observation has no verified revision and never promotes the
uncommitted content. The previously admitted v3 remains addressable until the
committed v4 observation arrives. Only the verified Git deletion produces
`ABSENT`.

### Transactional boundary

The queue is populated before a transaction snapshot. One model-call
observation consumes the queue; restoring the snapshot restores the pending
authority, model-call sequence, Universe state, and call-result log. Replaying
the same messages produces an identical Universe revision and logical hash.

## Results

```text
Real authority → external queue cases:  3/3 PASS
Authority/event identity separation:    PASS
v3 → dirty → v4 → explicit deletion:    PASS
Queue + model-call transaction replay:  PASS
Provider calls:                         0
Production files changed:               0
```

This is executable evidence that the existing queue can carry a real,
provider-neutral repository observation through the normal reconciliation
boundary while preserving the fail-closed `AVAILABLE` / `UNAVAILABLE` /
`ABSENT` distinctions.

## Deliberate limits and next safety gate

This is still a test-only adapter. It does not implement production Pi-to-
RepositoryObserver wiring, persistent cross-session storage, or an actual
concurrent repository mutation race.

The current queue deduplicates pending items by `sourceKey`, so the last item
queued for a source wins. This packet does not claim that out-of-order
observations are safe: monotonic revision ordering, stale-event rejection,
descriptor immutability, and failure-atomic queue handling remain a separate
production-boundary safety gate.

## Adjudication

```text
Real authority → queue → Universe: PASS (test-only)
Identity/provenance separation:    PASS
Dirty-world handling:              PASS
Transactional replay:              PASS
Production mapping:                NOT IMPLEMENTED
policy-v0 / Planner:               UNCHANGED
Pi messages rewritten:             NO
Live Shadow / CR-004:              NO_GO
```

The evidence supports a production mapping proposal, but does not authorize
that production change or any provider execution.
