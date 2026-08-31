# CR-004 LC1 + Active Composition Safety Evidence — 2026-08-31

## Status

```text
VERIFIED / CREDENTIAL-FREE / LIVE NOT AUTHORIZED
```

This evidence validates the real Pi `ExtensionRunner` dispatch order for the
LC1 runtime-owned admission hook followed by the Active Rewrite hook. It is a
test-only integration check; it does not change the Planner, `policy-v0`, CR-005
manifests or fixtures, Provider routing, or live smoke contracts.

## Purpose

Pi executes context handlers sequentially. LC1 must therefore complete its
authority boundary before the later Active handler runs, and both handlers
must use the same per-Run kill switch. A failure in LC1 must preserve the
native message list and prevent a later handler from sending an Active rewrite.

## Covered paths

### Cumulative context replay

The same read pair is present in two successive, cumulative context events.
The production mapper issues a new monotonic authority sequence, the runtime
admission host accepts the repeated observation, and the run remains armed.
This guards against treating normal multi-turn context repetition as a
cross-event conflict or false safety stop.

### LC1 failure before Active

The first event admits a repository read pair. The second event contains the
same read pair plus an edit boundary, but the caller-bound revision supplier
fails before mapping. LC1 trips the shared switch and returns native context.
The later Active handler sees the tripped switch and must not compose or send a
rewrite, even though the message sequence itself contains a qualifying
read-to-edit boundary.

```text
LC1 mapping / revision failure
        ↓
shared per-Run kill switch: TRIPPED
        ↓
Active handler: no composition, no rewrite
        ↓
Pi receives native messages unchanged
```

## Result

```text
Dedicated ExtensionRunner tests: 2 PASS
Cumulative repeated-read false stop: 0
LC1 failure followed by Active rewrite: 0
Message rewriting after failure: 0
Provider calls: 0
External network access: not used
```

The tests use a temporary local Git repository and the real production
`Lc1ProductionRepositoryMapper`, runtime-owned admission host, Pi
`ExtensionRunner`, C0 executor, and Active extension. No model transport,
Step Plan request, DeepSeek request, or live session is started.

## Safety assertions

```text
LC1 registered before Active:        VERIFIED
Repeated cumulative read pair:       ACCEPTED / no false stop
Revision failure:                    SHARED SWITCH TRIPPED
Active rewrite after LC1 failure:    0
Native message preservation:         VERIFIED
Planner / policy-v0 changes:         0
CR-005 changes:                      0
Live Shadow / CR-004 canary calls:   0
```

## Limits and follow-up

This proves the in-process handler composition boundary and shared switch
behavior. It does not authorize Active context replacement, prove cross-process
kill-switch propagation, or test provider output. A future live canary still
requires a separate Lead authorization bound to a fresh baseline and Run
identity.

## Decision

```text
LC1 + Active ExtensionRunner composition: VERIFIED CREDENTIAL-FREE
Live Shadow canary:                       NOT AUTHORIZED
CR-004 Active Rewrite:                    NO_GO
```
