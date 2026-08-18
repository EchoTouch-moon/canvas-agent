# CR-012A — Codex CLI Context Conformance

Status: **PASS / COMPLETE for the fake-Codex conformance boundary**

Date: 2026-08-18

## Scope

CR-012A proves that the same frozen `CommittedWorkingSet` can be consumed by
the existing Pi integration and by a Codex CLI bridge without changing the
Context Runtime core contract.

The evidence is intentionally offline:

```text
CommittedWorkingSet
        ↓
shared canonical intended context
        ├─ Pi adapter → Pi request capture → reconstruction
        └─ Codex adapter → ExecutionContextBundleV2
                         → createCodexAgentAdapter
                         → buildPrompt
                         → fake Codex stdin capture
                         → reconstruction
        ↓
common canonical comparison
```

## Architecture

The provider-neutral canonical layer is located at:

```text
packages/context-conformance/src/canonical.ts
```

It owns:

```text
canonicalizeIntendedContext
canonicalizeObservedContext
compareContextParity
```

Pi re-exports the existing CR-010 API through this package. Codex uses the
same canonical result; it does not depend on Pi's implementation.

The Codex bridge is located at:

```text
packages/codex-context-integration/src/codex-committed-context-adapter.ts
packages/codex-context-integration/src/codex-prompt-reconstruction.ts
```

`CodexCommittedContextAdapter` preserves committed ordering and materialized
representation text, resolves only the existing worker bundle metadata, and
keeps Runtime provenance in a verification-side trace. It does not select,
filter, compress, or re-version context.

## Exact Codex capture seam

The production path under test is:

```text
CodexCommittedContextAdapter.render()
    ↓
ExecutionContextBundleV2
    ↓
worker-runtime createCodexAgentAdapter().run()
    ↓
buildPrompt(executionRequestId, bundle.items, cwd)
    ↓
runLocalCli({ stdin: prompt })
    ↓
fake Codex executable reads process.stdin
```

The exact handoff is `runLocalCli`'s `stdin` field in
`packages/worker-runtime/src/codex-agent-adapter.ts`. The fake executable
captures that exact stdin after the operating-system process boundary. No
real Codex CLI, provider SDK, or network transport is involved.

The Pi side retains the existing CR-010 seam at
`before_provider_request`; its test-only fetch transport stops before the
provider network call.

## Gate results

| Gate | Result | Evidence |
| --- | --- | --- |
| G1 Translation | PASS | Deterministic Codex v2 bundle; materialized `FULL`/`SUMMARY` text; unresolved `contentRef` fails closed. |
| G2 Identity | PASS | Sidecar retains source/version/representation/rendered identity; prompt contains no Runtime version or rendered-hash trace fields. |
| G3 Reconstruction | PASS | Reconstruction accepts only captured Codex stdin plus sidecar traces; it does not accept `CommittedWorkingSet`. |
| G4 Parity | PASS | Codex and Pi observed contexts both compare `PASS` against the shared Core canonical context. |

## P1–P8 corpus

All corpus cases are executable in
`packages/codex-context-integration/tests/codex-conformance.test.ts`.

| Case | Expected evidence | Result |
| --- | --- | --- |
| P1 Basic single source | `A@V1 FULL` only | PASS |
| P2 Multiple ordered sources | Stable `A → B → C` order | PASS |
| P3 `FULL + SUMMARY` | Materialized representation kind and content preserved | PASS |
| P4 Budget rejection | Rejected `C` absent from Codex stdin | PASS |
| P5 `LAST_GOOD` | V1 provenance retained for unavailable source | PASS |
| P6 Same-version representation replacement | `SUMMARY` and `FULL` materializations remain distinct | PASS |
| P7 Source update | V2 emitted; V1 not retained | PASS |
| P8 Source removal | Removed `B` absent from the prompt | PASS |

For the full cross-harness corpus, the fake Codex path records:

```text
providerCalls       = 0
networkCalls        = 0
transportStopCount  = 0
codexExecCalls      = 1
```

The Pi path records:

```text
providerCalls       = 0
transportStopCount  > 0
```

Every successful case has a captured request/prompt and an independent
reconstruction.

## Negative cases

The executable negative corpus verifies:

```text
missing committed entry       → MISSING
extra request content         → EXTRA
source version drift          → VERSION_MISMATCH
representation drift          → REPRESENTATION_MISMATCH
ordering drift                → ORDER_MISMATCH
materialized content drift    → CONTENT_HASH_MISMATCH
```

Unresolved `contentRef` is rejected as `TRANSLATION_FAILURE / UNRESOLVED_CONTENT`.

## Validation

Executed with the repository Node 24 toolchain:

```text
@canvas-agent/context-conformance typecheck  PASS
@canvas-agent/context-conformance test       2 passed
@canvas-agent/pi-context-integration typecheck PASS
@canvas-agent/pi-context-integration test      81 passed
@canvas-agent/codex-context-integration typecheck PASS
@canvas-agent/codex-context-integration test     16 passed
@canvas-agent/context-runtime test               102 passed
@canvas-agent/worker-runtime test                90 passed
@canvas-agent/persistence test                   68 passed
pnpm check                                       PASS
```

The repository-wide format, lint, typecheck, test, and build checks all pass.

## Core Contract changes

**NONE.**

No files under `packages/context-runtime` were changed. The existing
`ExecutionContextBundleV2` and `worker-runtime` Codex adapter contract were
consumed as-is.

## Known limitations

- This phase uses a fake Codex executable and proves the local CLI stdin
  boundary; it does not execute a real Codex turn.
- The Codex bridge currently targets the existing `ExecutionContextBundleV2`
  and prompt format only.
- Provider SDK or service-side request rewriting is outside this observation
  boundary.
- `contentRef` resolution is intentionally deferred; unresolved content fails
  closed.
- Pi's inherited request capture remains limited to its current
  `openai-completions` request shape.
- Provenance is carried by the validation sidecar. It is not represented as
  `sourceVersionId`, `representationId`, or trace tokens in model text.

## Deferred

```text
CR-012B  real Codex CLI smoke / authenticated execution
CR-013   cross-harness evidence and observability model
```
