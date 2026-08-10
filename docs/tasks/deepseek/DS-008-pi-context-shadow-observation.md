# DS-008 — Pi model-call Context Shadow Observation

## Task owner

DeepSeek V4 Flash — Context Runtime research integration implementer. The lead architect owns architecture acceptance and promotion from Shadow to any active rewrite mode.

- **Branch:** `agent/deepseek-ds-008-pi-context-shadow`
- **Milestone:** Context Runtime v0.3 research
- **Status:** ASSIGNED / BLOCKED BY GATE
- **Depends on:** Product MVP v0.2 RC decision by the lead architect; PR #12 Context Runtime architecture merged to `main`
- **Implements:** CR-001 from `docs/plan/context-runtime-v0.3-experiment-plan.md`
- **Blocks:** CR-002 runtime observation model refinement and CR-003 Shadow Working Set Planner

## Goal

Prove that Canvas Agent can observe Pi's model-call context at every pre-LLM boundary without changing Pi Agent behavior, without freezing a premature Runtime persistence schema, and without coupling `packages/context-runtime` to Pi or DeepSeek.

The required experiment boundary is:

```text
Pi Agent Loop
    |
    | context event before each LLM call
    v
Pi Context Integration
    |
    | normalized observation only
    v
Canvas Context Runtime research sink
    |
    | record bounded metadata
    v
return original Pi messages unchanged
    |
    v
Provider / Model
```

For this packet, Canvas observes. Canvas does **not** govern or rewrite the active context.

## Why Pi

Pi currently exposes an extension `context` event immediately before each LLM call. The handler receives a deep copy of `event.messages` and may return replacement messages. Pi also exposes `before_provider_request` after provider-specific payload construction.

DS-008 must use the `context` event as the authoritative semantic model-call observation seam. `before_provider_request` may be used only for optional correlation / provider-payload metadata experiments; it must not become the primary Runtime abstraction.

Pi supports DeepSeek as a built-in API-key provider through `DEEPSEEK_API_KEY`. DeepSeek is the preferred low-cost live smoke backend, but the integration must remain provider-neutral.

## Read first

Repository architecture:

- `AGENTS.md`
- `docs/architecture/context-runtime-v0.3-direction.md`
- `docs/architecture/opencode-v2-context-comparison.md`
- `docs/architecture/decisions/PROPOSAL-030-context-source-universe-model.md`
- `docs/architecture/decisions/PROPOSAL-031-context-working-set-planner.md`
- `docs/plan/context-runtime-v0.3-experiment-plan.md`
- `packages/domain/src/model.ts`
- `packages/contracts/src/source-reference.ts`
- `apps/desktop/src/main/context-resolver.ts` only to understand existing Snapshot semantics; do not reuse it as Runtime observation code

Pi primary references:

- `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md`
- `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md`
- `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md`
- `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts`

Before implementation, verify the installed Pi package/API version still exposes the expected `context` semantics. If the current API materially differs from this packet, stop and return an architecture note rather than silently adapting the Runtime model around a changed Pi API.

## Authorized files

Primary implementation scope:

- new `packages/context-runtime/**`
- new `packages/pi-context-integration/**`
- root `package.json` only if one top-level research command is required
- `pnpm-lock.yaml`
- package-local `package.json` / `tsconfig.json` / build-test config for the two new packages
- new deterministic fixtures adjacent to the new packages
- new `docs/verification/context-runtime-cr-001-pi-shadow.md`

Documentation/status scope:

- `docs/plan/context-runtime-v0.3-experiment-plan.md` evidence/status fields only
- `docs/tasks/README.md` DS-008 status/evidence only

Do not modify:

- `apps/desktop/**`
- `packages/worker-runtime/**`
- `packages/persistence/**`
- existing `packages/contracts/**` public schemas
- existing `packages/domain/**` public domain model unless a separate lead-approved proposal explicitly expands scope
- v0.2 Snapshot / ExecutionRequest contracts

If a shared type appears necessary outside the authorized packages, stop and propose the smallest contract change first.

## Package boundary

Use top-level workspace packages because the current pnpm workspace matches `packages/*`.

Recommended package direction:

```text
packages/context-runtime
    provider-neutral experimental observation structures / utilities

packages/pi-context-integration
    Pi-specific extension / SDK bridge
        |
        v
packages/context-runtime
```

Mandatory dependency rule:

```text
pi-context-integration -> context-runtime
context-runtime -X-> Pi
context-runtime -X-> DeepSeek
context-runtime -X-> OpenCode
context-runtime -X-> Codex
```

`packages/context-runtime` must not import `@mariozechner/pi-coding-agent` or any provider-specific SDK.

## Required implementation

### 1. Create the minimum experimental Context Runtime observation surface

Do **not** implement the full PROPOSAL-030/031 domain model yet.

Create only the smallest internal research structures needed by CR-001, for example conceptually:

```ts
interface ModelCallObservation {
  runtimeSessionId: string
  sequence: number
  observedAt: string
  harness: 'PI'

  messageCount: number
  nativeContextEstimate: number
  categoryCounts: Record<string, number>

  // Hash / bounded descriptors, not raw secret-bearing provider payload by default.
  messageDescriptors: readonly ModelMessageDescriptor[]
}
```

Exact field names are implementation-level and may change during DS-008.

Requirements:

- internal / experimental namespace only;
- no stable exported SQL contract;
- no SQLite schema;
- no claim that the shape is the final `ModelCallObservation` contract;
- deterministic normalization for the same semantic Pi message input;
- stable per-run/runtime-session call sequence.

### 2. Implement a Pi extension / SDK bridge

Register Pi lifecycle observation through the official extension API.

At minimum:

```ts
pi.on('context', async (event, ctx) => {
  observe(event.messages)
  return { messages: event.messages }
})
```

The real implementation may need copying / normalization details based on Pi's actual types, but the semantic invariant is fixed:

> **Shadow mode returns semantically unchanged messages.**

Do not filter, reorder, summarize, inject, remove or replace messages in DS-008.

### 3. Correlate model calls

Every observed semantic model-call boundary must receive a monotonically increasing sequence within one research Runtime Session.

Record enough lifecycle context to answer:

```text
Run / experiment session
  -> model call #1
  -> model call #2
  -> model call #3
```

Document retry / provider retry semantics if Pi can emit repeated request attempts without a new `context` event.

Do not invent a false one-to-one model if Pi behavior proves otherwise.

### 4. Record bounded context metadata

For every `context` event, capture at least:

- sequence;
- timestamp;
- message count;
- estimated total context size / tokens using a clearly documented estimator;
- message role/type/category distribution where Pi exposes it;
- stable hash or descriptor per message where safe;
- presence/count of tool-result-like messages where distinguishable;
- model / provider identifier only if available without coupling the Runtime core to Pi provider internals.

Raw message content must be **off by default** for durable output.

If a debug flag allows bounded raw content for local research, it must:

- be explicit opt-in;
- redact known credential-bearing fields;
- write only under ignored local research state such as `.canvas-agent/research/**`;
- enforce per-message and per-run size limits;
- be documented as unsafe for arbitrary secret-bearing repositories.

### 5. Provide an in-memory sink and an opt-in local JSONL research sink

Default tests and default library use must work entirely in memory.

Add an opt-in local research sink suitable for collecting CR-001 evidence, for example:

```text
.canvas-agent/research/context-shadow/<session-id>.jsonl
```

The repository already ignores `.canvas-agent/`; do not commit generated research traces.

The JSONL form should contain normalized metadata, not provider Authorization material or environment values.

### 6. Provide deterministic tests without network credentials

Unit/integration tests must exercise the extension callback using synthetic Pi-compatible messages or an official test seam.

Tests must prove:

1. each invocation creates exactly one Canvas semantic observation;
2. sequence is monotonic;
3. normalized metadata is deterministic;
4. original message ordering and semantic content are unchanged by the handler;
5. no credentials are present in default serialized observations;
6. raw capture is disabled by default;
7. repeated identical messages can be correlated by descriptor/hash without being treated as a new SourceVersion contract yet;
8. disabling / omitting the integration leaves normal Pi context behavior unchanged.

Do not require `DEEPSEEK_API_KEY` for the deterministic test suite.

### 7. Add one opt-in live Pi + DeepSeek smoke

Provide a manually enabled smoke command using Pi's built-in DeepSeek provider when `DEEPSEEK_API_KEY` is available.

The smoke must:

- run a tiny deterministic coding/reasoning task in a temporary fixture workspace;
- observe more than one model call if the task naturally produces a tool round trip;
- record a local Shadow JSONL trace;
- state provider/model identity in the verification report;
- state exact observed model-call count;
- fail or skip truthfully when credentials/provider/model are unavailable;
- never claim live evidence when the smoke skipped.

Do not hardcode API keys or commit local auth files.

If DeepSeek tool calling is incompatible with the chosen Pi model at execution time, select another Pi-supported DeepSeek tool-capable model or document the limitation. Do not redesign the Runtime around one model-specific quirk.

### 8. Produce CR-001 verification evidence

Create:

```text
docs/verification/context-runtime-cr-001-pi-shadow.md
```

It must contain:

- exact Pi package/version tested;
- exact DeepSeek provider/model used for optional live smoke;
- architecture diagram of the actual implemented boundary;
- deterministic test commands/results;
- live smoke executed/skipped/failed status;
- example **redacted metadata-only** model-call timeline;
- count of semantic `context` events;
- notes about provider retries / duplicate request behavior;
- list of fields that appear useful for CR-002;
- list of fields that were deliberately not frozen;
- any mismatch discovered between PROPOSAL-030/031 assumptions and real Pi data.

## Explicit prohibited scope

DS-008 must **not**:

- implement `ContextWorkingSet` rewrite;
- return modified Pi messages;
- implement KEEP / ADD / REMOVE / REPLACE / COMPRESS / REHYDRATE;
- implement a relevance-ranking algorithm;
- add embeddings or a vector database;
- add a graph database;
- use another LLM to select context;
- persist Runtime observations into the production SQLite schema;
- change ContextSnapshot semantics;
- change ExecutionRequest v2;
- integrate OpenCode;
- integrate Codex Gateway;
- add production Desktop UI;
- create a Context Canvas;
- store API keys, Authorization headers or auth-file contents;
- fork Pi unless the lead architect first approves a written architecture deviation.

## Acceptance criteria

1. `packages/context-runtime` has no Pi/provider-specific import.
2. `packages/pi-context-integration` observes Pi's official pre-LLM `context` boundary.
3. Shadow handler returns messages semantically unchanged.
4. A deterministic credential-free test proves multiple sequential model-call observations.
5. Every semantic observation has stable session identity and monotonic sequence.
6. Default durable research output contains bounded metadata only, not raw full context.
7. Default output contains no API credential / Authorization material.
8. The same normalized input produces deterministic observation hashes/descriptors.
9. One optional live Pi + DeepSeek smoke exists and reports EXECUTED / SKIPPED / FAILED truthfully.
10. At least one real live run is attempted when credentials are intentionally provided; inability to execute is documented rather than hidden.
11. No production persistence, Desktop, Worker or frozen v0.2 contracts change.
12. `pnpm check` remains green.
13. Verification evidence identifies which observation fields should advance to CR-002 and which should remain experimental.
14. The task does not claim CR-001 complete until the lead architect reviews the evidence.

## Required verification

DeepSeek should adapt package-specific commands to the actual package names created, but the final handoff must include equivalents of:

```bash
pnpm install --frozen-lockfile
pnpm --filter @canvas-agent/context-runtime test
pnpm --filter @canvas-agent/pi-context-integration test
pnpm --filter @canvas-agent/context-runtime typecheck
pnpm --filter @canvas-agent/pi-context-integration typecheck
pnpm check
```

Optional live smoke, exact script name to be implemented and documented:

```bash
DEEPSEEK_API_KEY=*** CANVAS_CONTEXT_LIVE_SMOKE=1 \
  pnpm --filter @canvas-agent/pi-context-integration smoke:deepseek
```

The key must be supplied through the environment or Pi's supported local auth mechanism and must never appear in committed output.

## Stop conditions

Stop implementation and return an architecture note if any of these occurs:

1. Pi's current API no longer provides a stable pre-LLM semantic context hook.
2. Observing every semantic model call requires a deep Pi fork rather than an extension / SDK seam.
3. A provider-neutral observation cannot be produced without leaking provider-native payload state into `context-runtime`.
4. Correlation semantics are materially different from the assumed model-call sequence and cannot be represented honestly by a small local refinement.
5. The work appears to require changing v0.2 Snapshot / ExecutionRequest / production persistence contracts.
6. The live DeepSeek path requires unsafe credential persistence or undocumented global state.

Do not work around a stop condition by broadening scope silently.

## Execution order

```text
0. Gate check
   PR #12 merged + lead v0.2 RC go-ahead
        |
        v
1. Verify current Pi hook/API version
        |
        v
2. Scaffold provider-neutral context-runtime research package
        |
        v
3. Scaffold Pi integration package
        |
        v
4. Implement context-event pass-through observation
        |
        v
5. Add in-memory normalization + deterministic tests
        |
        v
6. Add bounded opt-in JSONL sink
        |
        v
7. Run credential-free full checks
        |
        v
8. Attempt opt-in Pi + DeepSeek live smoke
        |
        v
9. Write CR-001 verification report
        |
        v
10. Push branch and hand off for architecture review
```

## Required final handoff

Return exactly:

1. branch name and commit SHA;
2. modified file list;
3. dependency/package versions added;
4. architecture summary in five bullets maximum;
5. exact verification commands and exit results;
6. deterministic model-call observation example with no raw secrets;
7. live DeepSeek smoke status: EXECUTED / SKIPPED / FAILED;
8. observed Pi lifecycle / retry semantics;
9. proposed CR-002 field list, clearly marked provisional;
10. unresolved risks / API mismatches;
11. explicit scope-deviation statement;
12. confirmation that no Working Set rewrite occurred and messages were returned unchanged.

DeepSeek must not mark CR-001 accepted or start CR-002. The lead architect reviews DS-008 evidence and decides whether the observed data justifies refining the Runtime model.
