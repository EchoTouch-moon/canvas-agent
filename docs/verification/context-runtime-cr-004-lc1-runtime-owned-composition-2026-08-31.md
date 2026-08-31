# CR-004 LC1 — Explicit Runtime-Owned Composition and Kill Switch

**Classification:** core active-safety prerequisite

**Status:** `IMPLEMENTED / CREDENTIAL-FREE / LIVE NOT AUTHORIZED`

**Date:** 2026-08-31

**Baseline:** `codex/cr004-lc1-runtime-admission@66ac2cf`

## Scope

This packet adds the explicit composition boundary for the runtime-owned LC1
admission candidate. It does not change Planner policy, CR-005 fixtures or
manifests, provider routing, model-facing messages, or Active context rewrite
behavior. It makes no provider call.

The composition is disabled by default. Runtime-owned admission can only be
selected with an explicit `RUNTIME_OWNED` mode, a
`Lc1RuntimeRepositoryAdmissionHost`, and a per-Run kill switch. The exposed
repository port is the guarded admission sink; the legacy general external
observation queue is not exposed through this composition.

## Safety behavior

```text
DISABLED (default)
  -> no observer call
  -> no repository admission sink
  -> original Pi messages returned

RUNTIME_OWNED (explicit)
  -> host observes the boundary
  -> original Pi messages returned unchanged
  -> repository candidates enter only through the guarded admission sink

observer/admission error or rejection
  -> per-Run kill switch trips
  -> host state is rolled back for observer failure
  -> subsequent observation/admission is bypassed or rejected
```

The composition is observational-only. It does not select a Planner working
set and does not rewrite or reorder the messages returned to Pi. The guarded
sink uses ECMAScript private state and is frozen before exposure, so the
underlying host is not an ordinary property that callers can use as a bypass.
The kill switch remains a programmatic in-process control for this Run, not a
cryptographic or cross-process trust boundary.

## Credential-free verification

The dedicated composition suite has nine tests covering:

1. default-disabled identity-preserving behavior;
2. invalid, partial, and contradictory configuration;
3. explicit runtime-owned selection and Pi extension registration;
4. absence of the legacy queue surface;
5. operator trip permanently bypassing both observation and admission; and
6. observer failure rollback plus admission-guard trip behavior;
7. mapper-side failures entering the same sticky stop;
8. unexpected mapper exceptions becoming a stopped result; and
9. disabled compositions rejecting repository mapping attempts.

The existing LC1 runtime-owned admission suite remains unchanged and continues
to pass alongside the new suite. No model runtime, provider credential, Pi live
session, CR-005 manifest, or Active rewrite path is invoked.

## Gate state

```text
Explicit composition selector:       IMPLEMENTED / DEFAULT DISABLED
Runtime-owned admission sink:        GUARDED / LEGACY QUEUE NOT EXPOSED
Per-Run kill switch:                 VERIFIED / STICKY
Observer failure rollback:           VERIFIED
Pi message identity preservation:    VERIFIED
Planner / Active rewrite changes:    NONE
Provider calls:                      0
Live Shadow / Step Plan:             NO_GO pending separate authorization
CR-004 Active Rewrite:               NO_GO
```

The next gate is Lead review of this composition boundary and its integration
with the merged production runtime. A live Step Plan canary remains a separate
authorization and must bind a new run identity and a reviewed `main` baseline.
