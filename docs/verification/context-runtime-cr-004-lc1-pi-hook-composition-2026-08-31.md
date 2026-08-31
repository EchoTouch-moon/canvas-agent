# CR-004 LC1 — Pi Hook Composition Evidence

**Classification:** core active-safety prerequisite

**Status:** `IMPLEMENTED / CREDENTIAL-FREE / LIVE NOT AUTHORIZED`

**Date:** 2026-08-31

**Baseline:** `codex/cr004-lc1-composition-integration@5f8440a`

## Purpose

This change composes the already-reviewed runtime-owned LC1 boundary into an
explicit Pi `context` hook. It is a credential-free integration adapter, not a
production-default selection and not an Active rewrite. For each context event
it reads the caller-bound repository revision, maps authoritative repository
observations through the guarded runtime-owned admission sink, then observes
the boundary while returning Pi's original message list unchanged.

The adapter does not call a provider, modify Planner behavior, alter CR-005
manifests or fixtures, or rewrite model-facing context.

## Covered boundaries

The dedicated suite covers fourteen paths:

1. Disabled composition is rejected before a Pi hook can be registered.
2. Malformed adapter configuration is rejected before registration.
3. A real temporary Git repository supplies authoritative content before the
   observer boundary; forged Pi tool-result text is not used as repository
   truth, and the exact original message list is returned.
4. Each context event reads a fresh repository revision and advances the
   mapper/authority sequence while a replacement file version is admitted.
5. A repository-revision supplier failure stops the Run before mapping or
   observation and permanently bypasses later events.
6. A timestamp supplier failure has the same fail-closed behavior.
7. A pre-existing Run kill-switch trip bypasses all suppliers and boundaries.
8. An unbound repository scope is quarantined before the observer can run.
9. A runtime-session mismatch is rejected before host state can change.
10. A mapping rejection prevents the observer boundary from running, even if
    a composition implementation fails to trip the switch itself.
11. A composition-boundary exception returns the original messages and trips
    the per-Run switch.
12. A successful mapping followed by observer failure rolls back pending
    admission and leaves no partial observer state.
13. A timestamp supplier that returns an empty value stops before mapping or
    observation.
14. Concurrent context events that complete out of order are rejected by the
    authority guard; the late event cannot create a second observer result.

## Verification result

```text
Dedicated Pi hook suite:       14 tests PASS
Pi integration package:        360 tests / 28 files PASS
Pi integration typecheck:      PASS
git diff --check:              PASS
Provider calls:                0
Planner / Active rewrite:      NONE
Pi message rewriting:          NONE
```

The adapter preserves the original message-array identity on both the
successful and fail-closed paths. The per-hook sequence is allocated before
the asynchronous revision read, so every admitted authority request has a
unique, monotonic order within that hook instance; the existing runtime-owned
host remains responsible for rejecting stale or conflicting completions.

## Failure policy

The hook is explicitly fail-closed:

```text
revision supplier failure       → stop before mapper/observer
timestamp supplier failure      → stop before mapper/observer
mapping rejection/quarantine    → stop before observer
composition exception            → stop and return original messages
observer exception               → composition rollback + stop
pre-existing stop                → bypass all work
```

Every stop uses the same per-Run `RunKillSwitch`. Once tripped, later context
events return the original Pi messages without reading repository state,
calling the mapper, or invoking the observer.

## Hook mutation audit

Six temporary one-at-a-time mutations were applied locally, checked with the
dedicated suite, and reverted immediately. Every expected mutant was killed:

| Temporary mutation | Expected result |
| --- | --- |
| Remove the pre-existing kill-switch bypass | KILLED by supplier-bypass tests |
| Ignore mapping rejection/quarantine before observation | KILLED by mapping-rejection test |
| Let composition exceptions escape the hook | KILLED by composition-failure test |
| Skip the mapper and fabricate an empty mapping result | KILLED by authority and scope tests |
| Use a constant model-call/authority sequence | KILLED by fresh-revision lifecycle test |
| Return a cloned message array | KILLED by exact-identity pass-through tests |

All temporary mutations were restored before verification and are absent from
the submitted source.

## Interpretation and limits

This evidence verifies the in-process Pi hook composition and its tested
fail-closed sequencing. It does not establish cryptographic isolation,
cross-process enforcement, durable portable snapshots, or model behavior. The
out-of-order test verifies fail-closed authority handling; it does not claim
that Pi serializes concurrent hooks. The composition remains
observational-only: it does not replace, filter, remove, or rehydrate context
supplied to the model.

```text
LC1 Pi hook composition:       CREDENTIAL-FREE PASS
Runtime-owned admission:       exercised through real mapper
Context rewrite:               NONE
Live Shadow / Step Plan:       NO_GO pending separate authorization
CR-004 Active Rewrite:         NO_GO
```
