# CR-004 LC1-before-Active AgentSession Evidence — 2026-08-31

## Status

```text
VERIFIED / CREDENTIAL-FREE / LIVE NOT AUTHORIZED
```

This packet verifies that the explicit LC1-before-Active composition can be
loaded through Pi's real `DefaultResourceLoader` and `AgentSession`, not only
through a directly constructed `ExtensionRunner`. It does not wire the
composition into a production smoke or send a model request.

## Covered boundary

The tests use the first-party `createLc1ActiveRewriteExtension` factory as an
inline AgentSession extension. The factory creates a fresh runtime-owned LC1
composition for each invocation, registers LC1 before Active, and binds both
legs to one per-Run kill switch.

```text
DefaultResourceLoader
        ↓
AgentSession
        ↓
ExtensionRunner
        ↓
LC1 admission → Active rewrite
```

## Results

1. `DefaultResourceLoader` loads the composed factory without extension errors.
   The real AgentSession runner dispatches a three-event read-to-edit sequence;
   LC1 receives model-call sequences 1, 2, and 3, and the guarded Active
   rewrite is sent once on the edit boundary.
2. A later LC1 revision-read failure after an earlier Active rewrite trips the
   same switch before a second rewrite. The previously committed carried basis
   remains preserved, while the later event is returned without a new Active
   send.
3. `AgentSession.reload()` shuts down the first composed Run and constructs a
   fresh LC1 host, executor, evidence collector, and kill switch. The old
   runner remains unable to send a new rewrite after shutdown, while the new
   runner can complete an independent read-to-edit rewrite with sequences
   1, 2, and 3.

```text
Dedicated AgentSession tests:       3 PASS
Loader extension errors:            0
Healthy composed rewrites:          2
Mid-run LC1 failure rewrites:        0 additional
Old-run post-reload rewrites:       0
Fresh-run post-reload rewrites:     1
Provider / Step Plan calls:         0
```

The old runner's already-committed carried basis remains intact after its
kill-switch trip; the test distinguishes that preserved basis from a new
Active rewrite. This is consistent with the existing carried-removal contract
and does not re-admit the old Run.

## Construction mutation audit

The composed-factory safety boundary was also checked with five one-at-a-time
temporary mutations of the companion composition implementation. Each broken
variant was caught by an existing credential-free regression, and every
mutation was reverted before the clean-source verification:

```text
reverse LC1/Active registration order       caught by LC1-failure test
omit the shared kill-switch binding         caught by LC1-failure test
remove independent-switch rejection         caught by construction test
remove Run-ID mismatch rejection             caught by construction test
remove malformed Active-config rejection     caught by construction test
```

The audit therefore supplies negative evidence for registration order, shared
switch identity, Run-ID isolation, and fail-closed configuration validation.
No mutation was committed. The restored source passed the dedicated
composition suite with 3/3 tests, and the audit used zero Provider calls.

## Scope and limits

```text
Planner / policy-v0 changes:        0
CR-005 manifests / fixtures:        0
Production smoke wiring:             0
Model prompt / provider transport:  0
CR-004 Active canary authorization: not granted
```

The static DeepSeek model metadata is used only to construct a real
credential-free AgentSession with network disabled. Context events are sent
directly to that session's real ExtensionRunner; `session.prompt` is not
called. Repository mapping is represented by a deterministic local mapper
stub, while production mapper behavior remains covered by the adjacent LC1
integration suites.

## Decision

```text
AgentSession loader integration:     VERIFIED CREDENTIAL-FREE
AgentSession reload isolation:       VERIFIED CREDENTIAL-FREE
Live Shadow canary:                  NOT AUTHORIZED
CR-004 Active Rewrite:               NO_GO
```
