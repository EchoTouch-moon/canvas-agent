# CR-004 LC1-before-Active Composition Evidence — 2026-08-31

## Status

```text
VERIFIED / CREDENTIAL-FREE / LIVE NOT AUTHORIZED
```

This packet introduces one explicit first-party composition factory for the
future LC1 + Active boundary. It is a safety mechanism, not a live integration:
the returned Pi factory registers LC1 first, binds Active to the same per-Run
kill switch, and leaves all Provider and live-run paths untouched.

## Why an explicit composition is required

Pi applies context handlers sequentially. A shared kill switch only provides a
fail-closed boundary when the authority admission handler runs before the
Active handler. If two independent factories were accidentally registered in
the opposite order, Active could rewrite context before LC1 reported a
revision or authority failure. The wrapper makes the intended order and switch
identity one construction-time contract.

```text
createLc1ActiveRewriteExtension(...)
        │
        ├── LC1 authority mapping + native observation
        │       └── shared switch
        │
        └── Active Rewrite handler
                └── same shared switch
```

An independently supplied Active kill switch is rejected. The Active `runId`
must also match the LC1 switch's Run identity.

## Covered behavior

1. A healthy three-event read-to-edit sequence passes through the real Pi
   `ExtensionRunner`; LC1 runs first and the Active handler can send its
   guarded rewrite.
2. A revision read failure on the third event trips LC1 before Active is
   entered. The qualifying read-to-edit message sequence is returned natively,
   with no Active composition or rewrite.
3. A distinct Active switch is rejected at factory construction rather than
   creating two independent safety domains.

## Result

```text
Dedicated composition tests:          3 PASS
Healthy LC1 → Active rewrite:          VERIFIED
LC1 failure → Active rewrite:          0
Independent kill-switch acceptance:   REJECTED
Provider calls:                        0
External network access:               not used
```

The test uses the real `ExtensionRunner`, LC1 runtime-owned composition, and
Active extension. The mapper is a deterministic success stub because the
production mapper and repository authority path are covered by adjacent LC1
tests; this packet isolates factory ordering and shared-switch behavior.

## Scope and limits

```text
Planner / policy-v0 changes:           0
CR-005 manifests / fixtures:           0
Live Shadow / Step Plan calls:          0
CR-004 Active canary authorization:    not granted
```

This does not wire the wrapper into `cr004-stage1-smoke.ts`, alter the current
Active default, prove cross-process switch propagation, or authorize a model
run. A future canary must still use a fresh baseline, a fresh Run identity, and
a separate Lead authorization.

## Decision

```text
LC1-before-Active construction boundary: VERIFIED CREDENTIAL-FREE
Live Shadow canary:                       NOT AUTHORIZED
CR-004 Active Rewrite:                    NO_GO
```
