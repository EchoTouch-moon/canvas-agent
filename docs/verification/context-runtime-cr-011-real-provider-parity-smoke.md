# Context Runtime CR-011 — Real-provider Parity Smoke

Status: real-provider parity PASS on the formal Node 24 live run.

## Scope

CR-011 is a deliberately narrow follow-up to CR-010. It exercises one real
DeepSeek request through Pi while reusing the frozen Context Runtime contract
and the CR-010 parity extension. It does not change Runtime semantics, add a
planner, or make a provider call during normal tests.

The smoke is enabled only when both variables are present:

```text
CANVAS_CONTEXT_REAL_SMOKE=1
DEEPSEEK_API_KEY=<dedicated key>
```

Without both variables the command exits successfully with `SMOKE_STATUS=SKIPPED`.
The runner does not read Pi's persistent auth store and never prints the key.

## Architecture

```text
CommittedWorkingSet
    → CR-010 PiCommittedContextAdapter
    → Pi context event
    → Pi request construction
    → before_provider_request capture
    → real DeepSeek request
    → CR-010 reconstruction
    → canonical parity comparison
```

The fixture is one deterministic `FULL` representation. It is intentionally
small and has no tools, compaction, or follow-up task. The committed entry's
provenance remains in the verification-side trace; no source IDs or trace
tokens are added to the model-visible text.

## Exact capture seam

The smoke registers `createPiRequestParityExtension()` from
`packages/pi-context-integration/src/active/request-parity.ts`. Its capture
handler listens to Pi's `before_provider_request` event. In Pi 0.84.1 the
event is emitted immediately before the provider adapter's
`client.chat.completions.create()` call for the `openai-completions` API.

The captured record includes provider, model, API, payload, sidecar trace, and
`captureStage: before_provider_request`. Reconstruction reads only that
captured record and its sidecar trace; it does not receive the original
`CommittedWorkingSet`.

## Safety boundary

The regular test suite and `pnpm check` remain provider-free. The live runner
uses static DeepSeek model metadata (`allowModelNetwork: false` and
`refreshOnCreate: false`), a temporary auth file, one dedicated API key, no
tools, and retry settings disabled (`maxRetries: 0`). It wraps `globalThis.fetch`
only after explicit opt-in to count the actual outbound provider request.

The expected live-run counters are:

```text
providerCalls       = 1
transportStopCount  = 0
capturedRequests    = 1
parity              = PASS
```

The default offline invocation has `providerCalls = 0` and
`SMOKE_STATUS=SKIPPED`; it does not substitute an offline capture for the
real-provider result.

## G1–G4 readiness

| Gate | Evidence | Status |
| --- | --- | --- |
| G1 Translation | Reuses CR-010 deterministic committed-to-Pi adapter | PASS from CR-010 |
| G2 Identity | `before_provider_request` sidecar carries source/version/representation/rendered hashes | PASS from CR-010; exercised by live runner |
| G3 Reconstruction | Reconstructs from captured OpenAI-compatible payload | PASS from CR-010; exercised by live runner |
| G4 Parity | Compares canonical intended and observed context after the real request is built | PASS on the formal Node 24 live run |

## Real smoke result

The explicitly opted-in live run completed successfully with the following
metadata-only result:

```text
provider             = deepseek
model                = deepseek-v4-flash
providerCalls        = 1
transportStopCount   = 0
capturedRequests     = 1
parity               = PASS
intendedHash         = 2b2ecba39ddaa05ede47d263d5f10809c67e28eb751b785c903512c826a9eeeb
observedHash         = 2b2ecba39ddaa05ede47d263d5f10809c67e28eb751b785c903512c826a9eeeb
SMOKE_STATUS         = EXECUTED
```

The intended and observed hashes are identical. This proves that the
committed fixture survived Pi request construction and was captured at the
pre-provider boundary in the real request path.

The formal rerun was executed with the repository's Node 24 runtime and
completed without an engine warning. This is the release evidence for the
real-provider parity gate.

```bash
PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin \
pnpm --filter @canvas-agent/pi-context-integration smoke:deepseek:cr011
```

with the two variables above set. The run made one real request. Do not paste
the key, payload, or provider response into the repository.

## Core Contract changes

`NONE`. The following remain frozen and untouched:

```text
UniverseRevision
ProposedWorkingSet
AdmissionReceipt
CommittedWorkingSet
WorkingSetTransition
```

## Known limitations and deferred work

- Only Pi 0.84.1 and `openai-completions` are covered.
- The smoke captures the request at Pi's pre-provider boundary; it does not
  prove transformations performed inside a provider SDK after that boundary.
- It does not compare provider-side tokenization or the model's internal view.
- It uses one deterministic fixture, not the full P1–P8 offline corpus; that
  corpus remains covered by CR-010's zero-provider tests.
- DeepSeek model selection defaults to `deepseek-v4-flash` and can be changed
  with `CANVAS_CONTEXT_REAL_SMOKE_MODEL` for an explicitly supported static
  model.
- CR-011 does not add multi-Harness support, Planner sophistication, memory,
  compression, UI, or embedding work.
- A larger real-provider smoke matrix, SDK post-serialization verification,
  and production request policy belong to later work.

## Deferred next step

The CR-011 real-provider parity gate is complete. Any additional DeepSeek
model/API shapes should be proposed as a later follow-up rather than folded
into this frozen evidence.
