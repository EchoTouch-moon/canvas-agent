# CR-004 LC1 AgentSession Reload Evidence — 2026-08-31

## Status

```text
IMPLEMENTED / CREDENTIAL-FREE / LIVE NOT AUTHORIZED
```

This evidence is based on the PR #76 head `effd0df` and adds a single
credential-free lifecycle test. It does not modify the Planner, `policy-v0`,
CR-005 manifests or fixtures, or the Active rewrite path.

## Purpose

The LC1 Pi adapter trips a per-Run kill switch when Pi emits
`session_shutdown`. This check verifies the corresponding real
`AgentSession.reload()` boundary: the old runner is terminal, while the
reloaded runner receives a fresh runtime-owned composition and a fresh
per-Run kill switch.

## Required factory boundary

The inline extension factory constructs the runtime-owned composition inside
the factory invocation. This is intentional. A composition and its kill
switch belong to one Run and must not be captured once and reused across a
session reload.

```text
DefaultResourceLoader.reload()
        ↓
fresh inline factory invocation
        ↓
fresh composition / host / kill switch
        ↓
new AgentSession ExtensionRunner
```

## Covered lifecycle

1. A real `DefaultResourceLoader` loads the inline factory and
   `createAgentSession()` creates the first runner.
2. The first runner admits a repository read pair and preserves the original
   Pi messages.
3. `session.reload()` emits `session_shutdown` to the first runner.
4. The first Run records the shutdown trip and cannot observe a late context
   event.
5. The loader invokes the factory again, producing a distinct runner and a
   new untripped Run state.
6. The replacement runner admits the same repository fixture successfully.

## Result

```text
Dedicated reload integration test: 1 PASS
Package typecheck:                 PASS
External provider calls:           0
External network access:           not used
```

No prompt or model transport is executed. The model metadata is only created
from the local static runtime so that the real `createAgentSession()` path can
be constructed. The repository is a temporary local Git fixture.

## Safety assertions

```text
Old Run shutdown trip:             VERIFIED
Old Run late-event observation:    0 after reload
Replacement runner identity:       distinct
Replacement Run kill switch:       untripped before use
Message rewriting:                 0
Planner / policy-v0 changes:        0
CR-005 changes:                    0
Step Plan / DeepSeek live calls:   0
```

## Limits

This verifies the real Pi `AgentSession.reload()` and loader lifecycle, but it
does not cover provider output, Step Plan routing, Active context replacement,
or cross-process persistence. It also establishes the required per-install
factory usage pattern; it does not add a new factory registry or automatically
recreate caller-owned composition dependencies.

## Decision

```text
LC1 AgentSession reload boundary: VERIFIED CREDENTIAL-FREE
Live Shadow canary:               NOT AUTHORIZED
CR-004 Active Rewrite:             NO_GO
```
