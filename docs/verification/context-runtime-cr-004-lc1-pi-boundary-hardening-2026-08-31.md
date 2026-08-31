# CR-004 LC1 — Pi Boundary Hardening Evidence

**Classification:** core active-safety prerequisite

**Status:** `IMPLEMENTED / CREDENTIAL-FREE / LIVE NOT AUTHORIZED`

**Date:** 2026-08-31

**Baseline:** `codex/cr004-lc1-pi-composition@71b0ffb`

## Purpose

This follow-up hardens the explicit LC1 Pi composition boundary before any live
canary. The adapter now accepts only a first-party runtime-owned composition,
captures the validated composition and configuration dependencies when the
factory is created, and uses those captured references for every later Pi event.
The composition object itself is frozen after construction. These measures keep
post-registration option mutation and structurally forged composition objects
from changing the safety behavior after validation.

The hardening remains observational-only. It does not call a provider, rewrite
Pi messages, change Planner policy, modify CR-005 fixtures or manifests, or
enable CR-004 Active Rewrite.

## Covered boundaries

1. A structurally matching but non-first-party composition is rejected before
   any Pi handler can be registered.
2. A caller that mutates the composition, mapper, identity fields, revision
   supplier, timestamp supplier, and authority stream after factory creation
   cannot change the validated execution path.
3. A first-party composition remains accepted and its public state is frozen
   after construction.

## Verification result

```text
Dedicated Pi hook suite:       19 tests PASS
Pi integration package:        365 tests / 28 files PASS
Pi integration typecheck:      PASS
git diff --check:              PASS
Provider calls:                0
Planner / Active rewrite:      NONE
Pi message rewriting:         NONE
```

## Mutation audit

Temporary one-at-a-time mutations were applied locally and reverted immediately
after each focused test. Every expected mutant was killed:

| Temporary mutation | Expected result |
| --- | --- |
| Remove first-party composition identity validation | forged-composition test fails |
| Read `options.getExpectedRevision()` at event time instead of the captured supplier | post-registration configuration mutation test fails |
| Read `options.composition.handleContext()` at event time instead of the captured handler | post-registration configuration mutation test fails |

The audit demonstrates that the new regressions exercise the protections rather
than merely documenting them.

## Safety interpretation and limits

The first-party check is an in-process module identity boundary implemented with
a private `WeakSet`; it is not cryptographic isolation and does not protect
against code that can replace the module itself. Freezing the composition and
capturing validated dependencies protect this adapter's registration boundary,
not arbitrary external mutation of the host or repository process.

The tests include Pi's real `ExtensionRunner` dispatcher through a deterministic
synthetic extension object. They do not claim full `AgentSession` startup,
teardown, extension discovery, cross-process enforcement, durable portable
snapshots, or model behavior. Live Shadow, Step Plan, and Active Rewrite remain
separately gated.

```text
Composition authenticity:     VERIFIED IN PROCESS
Registration snapshot:        VERIFIED
Mutation audit:               3 / 3 KILLED
Live Shadow / Step Plan:      NO_GO
CR-004 Active Rewrite:        NO_GO
```
