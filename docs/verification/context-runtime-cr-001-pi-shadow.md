# CR-001 Verification — Pi model-call Context Shadow Observation

- **Status:** EVIDENCE READY (rev.2) — not self-accepted; awaits lead architect review of PR #14
- **Packet:** `docs/tasks/deepseek/DS-008-pi-context-shadow-observation.md`
- **Owner:** DeepSeek V4 Flash — Context Runtime research integration implementer
- **Branch:** `agent/deepseek-ds-008-pi-context-shadow`
- **Date:** 2026-08-11 (rev.2 after PR #14 architecture review)
- **Pi exact version tested:** `@earendil-works/pi-coding-agent@0.84.1` (npm); local CLI `pi@0.82.1` / global package `0.82.1` were used to verify type shapes; the workspace dependency is pinned to `0.84.1`.
- **Pi integration API used:** extension `context` event — `pi.on("context", async (event) => ({ messages: event.messages }))`. `before_provider_request` was deliberately NOT used as a primary seam.

---

## 1. Architecture boundary actually implemented

```text
Pi Agent Loop
    |
    | context event before each LLM call (agent-loop.ts:288-292)
    v
pi-context-integration
    PiContextShadowObserver.handleContextEvent(event.messages)
    |
    | mapPiMessages -> NormalizedMessageInput[]
    |   fingerprint = text/thinking + tool-call name/id/arguments
    |              + tool-result text/error + image (type+bytes+hash)
    v
context-runtime (provider-neutral)
    buildObservation(...)
    |
    | bounded metadata: role/type/category/size/hash, estimateScope
    v
InMemoryObservationSink  +  opt-in JsonlObservationSink
    |
    v
return { messages: event.messages }  // ORIGINAL, semantically unchanged
    v
Provider / Model
```

- `packages/context-runtime` imports **no** Pi / DeepSeek / OpenCode / Codex code.
- `packages/pi-context-integration` depends on `@canvas-agent/context-runtime` and `@earendil-works/pi-coding-agent@0.84.1` (dependency direction: integration -> runtime).
- The core harness discriminator is provider/Agent-neutral (`string`); `'PI'` is supplied only by pi-context-integration. OpenCode can consume the same core structures without a core change.

## 2. Estimate scope (rev.2)

The `context` event exposes the **Pi `AgentMessage[]` array as observed before any provider transformation**. The size/fingerprint metric therefore measures **only that observed message array** and is explicitly scoped:

```text
estimateScope = 'agent-messages-pre-provider'
```

The metric **does not** include:
- the system prompt;
- tool definitions / tool snippets;
- `convertToLlm` output (image-block filtering, etc.);
- provider-specific request/body construction;
- `before_provider_request` payload rewrites.

Field name: `observedMessageTokenEstimate` (+ `observedMessageCharEstimate`). It is a documented heuristic (whitespace-collapsed, ~4 chars/token) over the canonical in-memory semantic fingerprint, **not** the full model/provider context token count. This naming/scope addresses the PR #14 review item directly.

## 3. Semantic fingerprint (rev.2)

The in-memory fingerprint for each message now includes the complete model-relevant structure available at the `context` seam:

- user/assistant `text` and `thinking` blocks;
- assistant **tool-call name / id / arguments** (deterministic stable-serialized);
- **tool-result text content + error semantics** (toolName, toolCallId, isError);
- image/binary blocks as **type + byte length + sha256 hash** (payload never carried or persisted).

Raw content is never persisted by default: the JSONL sink stores only hash, lengths/counts, category and tool metadata. Proven by tests:

- two different results from the **same tool** → different fingerprint + `contentHash`;
- two tool-calls with **different arguments** → different fingerprint + `contentHash`;
- image blocks contribute `{ type, mimeType, byteLength, contentHash }` and the raw `data` never appears in the fingerprint or serialized observation.

## 4. RawCaptureBudget is UTF-8 byte-accurate (rev.2)

`RawCaptureBudget` now measures and truncates by real UTF-8 bytes (`Buffer.byteLength` + whole-code-point truncation), not JS string length. Multibyte tests cover CJK (3 bytes/char) and emoji (4 bytes/code point), and prove a multi-byte code point is never split at the byte boundary. The per-message truncation is also bounded by the remaining per-run budget (`min(perMessageSizeLimit, remainingBytes)`), so a single message cannot overshoot the run total (rev.3 fix).

## 5. DeepSeek provider / model (live smoke, rev.2)

- Provider: `deepseek` (Pi built-in API-key provider)
- Model: `deepseek-v4-flash`
- Credential source: local `~/.pi/agent/auth.json` (Pi official auth store; `DEEPSEEK_API_KEY` env var also supported by the smoke script). No key was hardcoded or committed.
- **Live smoke status: EXECUTED**
  - Command: `CANVAS_CONTEXT_LIVE_SMOKE=1 pnpm --filter @canvas-agent/pi-context-integration smoke:deepseek`
  - Observed semantic `context` events: **5**
  - Runtime Session: `smoke-2026-08-11T06-18-39-382Z`
  - JSONL trace written to (gitignored): `packages/pi-context-integration/.canvas-agent/research/context-shadow/smoke-2026-08-11T06-18-39-382Z.jsonl`

## 6. Example metadata-only model-call timeline (rev.2)

```text
Runtime Session: smoke-2026-08-11T06-18-39-382Z (harness PI, provider deepseek, model deepseek-v4-flash)
estimate scope: agent-messages-pre-provider (AgentMessage[] only; NOT full provider context)

Call #1  messages: 1   observedMessageTokens: 21    chars: 83    tools/results: 0
Call #2  messages: 3   observedMessageTokens: 101   chars: 401   tools/results: 1
Call #3  messages: 5   observedMessageTokens: 222   chars: 882   tools/results: 2
Call #4  messages: 7   observedMessageTokens: 441   chars: 1758  tools/results: 3
Call #5  messages: 9   observedMessageTokens: 500   chars: 1992  tools/results: 4
```

The task produced a real tool round trip (ls/read/write), so context grew 1 -> 3 -> 5 -> 7 -> 9 messages with tool results 0 -> 1 -> 2 -> 3 -> 4 across the five calls. Tool-result text and tool-call arguments now participate in the fingerprint/size, so the estimate reflects the observed AgentMessage content (e.g. call #5 ≈ 500 tokens) instead of under-counting as before. No raw prompt content is present in the JSONL trace (verified: no `sk-`, `api_key`, `Authorization`, `Bearer` patterns; no `rawPreview` present).

## 7. Deterministic test results (credential-free, no network)

Commands (Node 24):

```bash
pnpm --filter @canvas-agent/context-runtime test        24 passed
pnpm --filter @canvas-agent/pi-context-integration test 19 passed
pnpm --filter @canvas-agent/context-runtime typecheck   PASS
pnpm --filter @canvas-agent/pi-context-integration typecheck PASS
pnpm check                                              all green (513 tests + build)
```

The suites prove the required invariants:

1. each `context` callback produces exactly one Canvas observation;
2. sequence is monotonic within a Runtime Session (1,2,3...);
3. identical normalized input produces identical descriptor/hash;
4. handler returns the ORIGINAL messages array (identity + semantic equality);
5. default serialized observation contains no credentials and no raw content;
6. raw capture is off by default (no `rawPreview`);
7. repeated model calls form a complete timeline with growing tool-result count;
8. the extension handler is a pure pass-through (disabling/omitting the integration leaves Pi native behavior unchanged);
9. **different tool-result contents → distinct fingerprint/hash**;
10. **different tool-call arguments → distinct fingerprint/hash**;
11. image/binary blocks are accounted as type + bytes + hash with no payload leak;
12. estimate scope is `agent-messages-pre-provider`;
13. `RawCaptureBudget` enforces real UTF-8 byte limits (CJK + emoji, no split code points).

## 8. Pi semantic context / retry semantics (verified against pi source)

- `context` fires **once per semantic LLM call**, before provider payload construction (`agent-loop.ts:288-292` -> `transformContext` -> `ExtensionRunner.emitContext`, which `structuredClone`s `event.messages`).
- **Agent-level auto-retry re-triggers `context`**: `agent.continue()` re-enters the loop and calls `transformContext` again; the failed assistant message is removed and the rest of the messages are reused.
- **Provider-level HTTP retry does NOT re-trigger `context`** (nor `before_provider_headers` / `before_provider_request`): it happens inside the pi-ai API layer (`retryProviderRequest`). So `1 semantic context event != 1 HTTP request` under retry.
- `{ messages }` returned from `context` is NOT the literal HTTP payload: `convertToLlm` may filter image blocks, system prompt is appended separately, and `before_provider_request` can still replace the provider body. `context` is the correct semantic observation seam; provider payload hooks are correlation-only.
- Observed live behavior: one user prompt produced 5 `context` events (5 semantic LLM calls with 4 tool round trips), consistent with one event per model call.

## 9. Useful CR-002 candidate fields (provisional)

- `messageCount`, `observedMessageTokenEstimate` / `observedMessageCharEstimate` (whitespace-collapsed char/4 heuristic) — directly usable; **must stay scoped as `agent-messages-pre-provider`**.
- `estimateScope` — explicit non-claim about the full provider context.
- `categoryCounts` (USER / ASSISTANT / TOOL_RESULT / OTHER) and `toolResultCount` — cheap and stable.
- per-message `role` / `contentType` / `toolName` / `toolCallId` / `isError` — reliable from Pi types.
- per-message `contentHash` (sha256 of canonical fingerprint) — deterministic correlation without storing raw text.
- `binaryBlocks` (`{ type, mimeType, byteLength, contentHash }`) — binary accounting without payload.
- `harness` as a neutral experimental id (OpenCode can reuse the core unchanged).
- runtimeSessionId + monotonic sequence — replayable model-call timeline.

## 10. Fields deliberately NOT frozen

- `ModelCallObservation` shape is **experimental/internal only**; no exported stable public contract, no Zod schema, no SQLite schema.
- Exact field names may change after CR-002.
- No `ContextSource` / `ContextUniverse` / `ContextWorkingSet` / `ContextDecision` / `ContextTransition` types were created (PROPOSAL-030/031 remain direction-only).
- `harness` is a neutral experimental string id; the exact identifier vocabulary is not frozen.
- Token estimator is a documented heuristic, not a provider-aware tokenizer.
- `estimateScope` string value may evolve if a second harness reveals different seams.

## 11. Mismatches with PROPOSAL-030/031 assumptions

- PROPOSAL-030/031 assume source-level reconciliation will be observable from real Pi runs. In this shadow smoke, the `context` event exposes **only the assembled `AgentMessage[]`**, not the individual Context Sources. Source identity must be inferred from message shape (tool names, roles) rather than read directly from Pi.
- PROPOSAL-031's `ContextWorkingSet` is a hypothetical planner output; CR-001 proved the observation seam exists but produced no evidence yet about whether Working Set planning can or should operate at this boundary. That question is deferred to CR-003.
- No assumption of 1:1 `context event == HTTP request` held; retry semantics were documented instead (see §8).

## 12. Security / privacy notes

- Default durable output (JSONL) is metadata-only; no raw prompts, no API keys, no Authorization headers, no image payloads.
- `DEEPSEEK_API_KEY` is read only from the environment or Pi's `auth.json`; never logged, never committed.
- `rawCapture` opt-in exists in the Runtime core (`RawCaptureBudget`) with real UTF-8 byte limits per message and per run + redaction, but the Pi integration does not enable it; default remains off.
- Research traces are written under `.canvas-agent/research/**` (gitignored) and were not committed.
- The smoke ran in a throwaway `mkdtemp` fixture workspace removed on completion.

## 13. Verification status vs packet acceptance criteria

| AC | Status |
|---|---|
| 1 context-runtime has no Pi/provider import | ✅ |
| 2 pi-context-integration observes official pre-LLM context | ✅ |
| 3 Shadow handler returns messages semantically unchanged | ✅ |
| 4 credential-free test proves multiple sequential observations | ✅ |
| 5 stable session identity + monotonic sequence | ✅ |
| 6 default durable output is bounded metadata only | ✅ |
| 7 no credentials in default output | ✅ |
| 8 deterministic hashes for identical input | ✅ |
| 9 one optional live Pi + DeepSeek smoke, truthful status | ✅ EXECUTED |
| 10 real run attempted with credentials | ✅ (5 semantic calls) |
| 11 no production persistence/Desktop/Worker/v0.2 contract change | ✅ |
| 12 pnpm check green | ✅ 513 tests |
| 13 evidence identifies CR-002 fields + non-frozen fields | ✅ (§9, §10) |
| 14 not self-accepted; awaits lead review | ✅ |

### PR #14 review items — resolution

| Review item | Resolution |
|---|---|
| P1 semantic fingerprint incomplete (tool-result text, tool-call args) | ✅ fingerprint includes tool-result text/error and tool-call name/id/arguments; distinct-fingerprint tests added; raw never persisted by default |
| P1 rename/scope `nativeContextEstimate` | ✅ renamed `observedMessageTokenEstimate` / `observedMessageCharEstimate` + explicit `estimateScope: 'agent-messages-pre-provider'`; doc states what is excluded (system prompt / tools / convertToLlm / provider payload) |
| P1 core harness Pi-specific | ✅ core uses neutral `string` harness id; `'PI'` supplied by pi-context-integration |
| P2 RawCaptureBudget counts chars not bytes | ✅ UTF-8 byte-accurate budget + CJK/emoji multibyte tests |
| P2 per-run total not enforced per message | ✅ truncation capped by `min(perMessageSizeLimit, remainingBytes)`; strengthened test asserts first message ≤ run total |
| CI ERR_PNPM_IGNORED_BUILDS (`@google/genai@1.52.0`, `protobufjs@7.6.5`) | ✅ exact-version deny decisions in `pnpm-workspace.yaml` (`false` = reviewed, do not run); future upgrades re-gated |
