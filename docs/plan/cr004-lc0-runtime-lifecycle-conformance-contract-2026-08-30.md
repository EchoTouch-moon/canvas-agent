# CR-004 LC0 — runtime lifecycle conformance contract

**Status:** PRE-REGISTERED / CREDENTIAL-FREE / PROVIDER-FREE  
**Date:** 2026-08-30

## Purpose

LC0 verifies the lifecycle semantics at the real Active extension seam before
any new live provider screen. It drives deterministic Pi-shaped messages
through the actual Active extension, the actual transactional composer and
pre-send guard, and the actual `policy-v0` planner. It does not change
production policy, fixtures, manifests, Pi defaults, or Active behavior.

The screen separates two claims that must not be conflated:

1. a removed pair can stay out of the carried model-visible basis while a
   later fresh read becomes active safely; and
2. an explicit policy-level `REHYDRATE` decision can be traced to an earlier
   `REMOVE`, the correct SourceVersion, and later-needed evidence.

The current Pi tool-call seam assigns a new run source identity to each new
read tool call. LC0 must therefore report, rather than silently repair, any
gap between a safe fresh re-entry (`ADD`) and an explicit source-identity-
preserving `REHYDRATE` relation.

## Frozen boundary

- provider calls: 0;
- network and credentials: not used;
- policy implementation: read-only;
- `policy-v0` semantics: unchanged;
- L1/L2/L3 manifests and fixtures: unchanged;
- CR-005 artifacts: unchanged;
- Active extension/composer/guard source: unchanged;
- no live Shadow or Active Rewrite execution;
- no retry of M6–M9 and no Wave B/CR-004 production authorization.

## Deterministic scenarios

### LC0-A — remove, carry, and later fresh demand

Drive a read of `P1`, an edit boundary, and a successful V3 Active rewrite.
Verify that:

- the removed call/result pair is absent from the returned model-visible
  basis;
- the sent evidence has complete binding, guard, removal, and message-count
  telemetry;
- the removed pair stays absent on later events;
- a later read of the same path with a new tool-call identity is visible and
  active;
- the old source identity is not resurrected;
- replay and executor planning history remain deterministic.

The later fresh read is labeled `rehydrate-demand` only if the evidence shows
later demand. It must not be called a confirmed false removal or an explicit
`REHYDRATE` unless the planner records that decision with an originating
`REMOVE`.

### LC0-B — explicit planner rehydration

Run the frozen C0 wrong-path-recovery and phase-shift traces through the real
planner. Verify `REMOVE → REHYDRATE` ordering, originating removal linkage,
later-needed reason evidence, exact SourceVersion continuity, and requested
representation kind. This is a positive policy-level oracle, not evidence
that the Active Pi seam emits the same relation for a new tool-call identity.

### LC0-C — verification window plus dedup

Drive identical reads, an edit, and two bash verification events together.
Verify that the edit sweep is deferred while the verification window is open,
that the dedup-only boundary may still fire, and that the old duplicate is
removed while the newest identical read and verification evidence remain.

### LC0-D — failed-attempt rollback

Repeat the remove boundary with composition made impossible by an absent
system instruction. Verify native output, active source membership, planning
state digest, and later-boundary eligibility are unchanged except for the
recorded permanent fallback/attempt ledger.

## Required invariants

Every scenario must check, as applicable:

- one observation per successful event;
- tool-call/result pair integrity;
- no old removed source in the carried basis;
- no mandatory or protected eviction;
- binding hashes and composition hashes on every sent rewrite;
- deterministic replay and stable planning digest where a control exists;
- no kill-switch trip on a successful path;
- a failed path restores the pre-attempt planning state;
- a later fresh read is not mislabeled as `REHYDRATE` merely because its path
  matches an older removed read;
- explicit `REHYDRATE`, where tested, has a prior `REMOVE`, correct version,
  and later-needed evidence.

## Bounded outcomes

```text
LIFECYCLE_CONTRACT_PASS
  All safe carried-basis, fresh-demand, dedup/deferral, rollback, and
  planner-level provenance invariants pass. Any Pi seam identity gap is
  recorded as a bounded capability note, not hidden.

LIFECYCLE_CAPABILITY_GAP
  Harness and oracles are trustworthy, but the runtime does not expose a
  required source/version/origin relation or lifecycle behavior.

HARNESS_CONTRACT_FAILURE
  The suite cannot trust binding, replay, composition, safety, or evidence.

SPEC_AMBIGUITY
  The frozen lifecycle contract permits more than one interpretation.
```

LC0 must not turn a capability gap into an in-place policy repair. Any policy
change or new live later-demand experiment requires a separate contract,
baseline, and run identity.
