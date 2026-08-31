# CR-004 LC1 AgentSession Integration Evidence — 2026-08-31

## Status

```text
IMPLEMENTED / CREDENTIAL-FREE / LIVE NOT AUTHORIZED
```

This evidence is based on the PR #75 head `c5f0bf4` and adds only a
credential-free integration test. It does not modify the Planner, `policy-v0`,
CR-005 manifests or fixtures, or the Active rewrite path.

## Purpose

The existing LC1 tests exercised the production composition and a real Pi
`ExtensionRunner`. This check closes the next integration boundary by loading
the LC1 Pi factory through `DefaultResourceLoader`, constructing a real
`AgentSession`, and exercising that session's actual extension runner.

The test does not claim that a model used the LC1 context policy. The model
transport is deliberately intercepted before any external request.

## Covered path

```text
createLc1RuntimeAdmissionPiExtension
        ↓
DefaultResourceLoader.reload()
        ↓
createAgentSession()
        ↓
AgentSession.extensionRunner
        ↓
context dispatch / AgentSession transformContext
        ↓
runtime-owned mapper → admission host → observer
```

The test verifies:

1. The inline extension is loaded without loader errors and registers both
   `context` and `session_shutdown` handlers on the created session.
2. A repository read pair dispatched through the created session's real
   `ExtensionRunner` reaches the production mapper and admission host.
3. Pi receives the same message values; the extension remains observational
   and does not rewrite the input array.
4. `AgentSession.prompt()` reaches the extension through the session's actual
   `transformContext` callback.
5. The model transport is stopped by a local throwing `fetch` guard. The test
   uses static fake DeepSeek metadata and a fake local credential only to
   construct the session; no external provider request is allowed.
6. A real `session_shutdown` dispatch trips the per-Run kill switch, and a
   late context event is returned unchanged without another host observation.

## Result

```text
Dedicated integration test: 1 PASS
Typecheck:                  PASS
External provider calls:    0
External network access:    blocked by test transport guard
```

The blocked transport counter is intentionally separate from provider-call
count: the session reaches the provider boundary, but the request is thrown
before leaving the process. This is credential-free wiring evidence, not a
live model run.

## Safety boundaries preserved

```text
Planner / policy-v0 changes:       0
CR-005 manifest or fixture changes: 0
Active rewrite changes:            0
Step Plan live calls:              0
DeepSeek live calls:               0
LC1 message rewriting:             0
```

The test uses a temporary Git repository and a temporary session directory.
The repository mapper is bound to that temporary scope, and all temporary
state is removed during test cleanup.

## Limits

This is stronger than the synthetic `ExtensionRunner` test because the real
`DefaultResourceLoader` and `createAgentSession` path are used, but it is still
not a live AgentSession/provider execution. It does not validate model output,
Step Plan routing, Active context replacement, or cross-process persistence of
the in-memory first-party composition identity.

## Decision

```text
LC1 AgentSession integration: VERIFIED CREDENTIAL-FREE
Live Shadow canary:            NOT AUTHORIZED
CR-004 Active Rewrite:         NO_GO
```
