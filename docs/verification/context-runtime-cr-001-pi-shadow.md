# CR-001 Verification — Pi model-call Context Shadow Observation

- **Status:** EVIDENCE READY — not self-accepted; awaits lead architect review
- **Packet:** `docs/tasks/deepseek/DS-008-pi-context-shadow-observation.md`
- **Owner:** DeepSeek V4 Flash — Context Runtime research integration implementer
- **Branch:** `agent/deepseek-ds-008-pi-context-shadow`
- **Date:** 2026-08-11
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
    v
context-runtime (provider-neutral)
    buildObservation(...)
    |
    | bounded metadata: role/type/category/size/hash
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

## 2. DeepSeek provider / model (live smoke)

- Provider: `deepseek` (Pi built-in API-key provider)
- Model: `deepseek-v4-flash`
- Credential source: local `~/.pi/agent/auth.json` (Pi official auth store; `DEEPSEEK_API_KEY` env var also supported by the smoke script). No key was hardcoded or committed.
- **Live smoke status: EXECUTED**
  - Command: `CANVAS_CONTEXT_LIVE_SMOKE=1 pnpm --filter @canvas-agent/pi-context-integration smoke:deepseek`
  - Observed semantic `context` events: **4**
  - Runtime Session: `smoke-2026-08-11T05-46-48-857Z`
  - JSONL trace written to (gitignored): `packages/pi-context-integration/.canvas-agent/research/context-shadow/smoke-2026-08-11T05-46-48-857Z.jsonl`

## 3. Example metadata-only model-call timeline

```text
Runtime Session: smoke-2026-08-11T05-46-48-857Z (harness PI, provider deepseek, model deepseek-v4-flash)

Call #1  messages: 1   estimated: 0.02K   tools/results: 0   categories: USER=1
Call #2  messages: 3   estimated: 0.04K   tools/results: 1   categories: USER=1 ASSISTANT=1 TOOL_RESULT=1
Call #3  messages: 5   estimated: 0.04K   tools/results: 2   categories: USER=1 ASSISTANT=2 TOOL_RESULT=2
Call #4  messages: 7   estimated: 0.12K   tools/results: 3   categories: USER=1 ASSISTANT=3 TOOL_RESULT=3
```

The task naturally produced a tool round trip (read/write), so context grew 1 -> 3 -> 5 -> 7 messages with tool results 0 -> 1 -> 2 -> 3 across the four calls. No raw prompt content is present in the JSONL trace (verified: no `sk-`, `api_key`, `Authorization`, `Bearer` patterns).

## 4. Deterministic test results (credential-free, no network)

Commands (Node 24):

```bash
pnpm --filter @canvas-agent/context-runtime test        19 passed
pnpm --filter @canvas-agent/pi-context-integration test 13 passed
pnpm --filter @canvas-agent/context-runtime typecheck   PASS
pnpm --filter @canvas-agent/pi-context-integration typecheck PASS
pnpm check                                              all green (502 tests + build)
```

The pi-context-integration suite proves the eight required invariants:

1. each `context` callback produces exactly one Canvas observation;
2. sequence is monotonic within a Runtime Session (1,2,3...);
3. identical normalized input produces identical descriptor/hash;
4. handler returns the ORIGINAL messages array (identity + semantic equality);
5. default serialized observation contains no credentials;
6. raw capture is off by default (no `rawPreview`);
7. repeated model calls form a complete timeline with growing tool-result count;
8. the extension handler is a pure pass-through (disabling/omitting the integration leaves Pi native behavior unchanged).

## 5. Pi semantic context / retry semantics (verified against pi source)

- `context` fires **once per semantic LLM call**, before provider payload construction (`agent-loop.ts:288-292` -> `transformContext` -> `ExtensionRunner.emitContext`, which `structuredClone`s `event.messages`).
- **Agent-level auto-retry re-triggers `context`**: `agent.continue()` re-enters the loop and calls `transformContext` again; the failed assistant message is removed and the rest of the messages are reused.
- **Provider-level HTTP retry does NOT re-trigger `context`** (nor `before_provider_headers` / `before_provider_request`): it happens inside the pi-ai API layer (`retryProviderRequest`). So `1 semantic context event != 1 HTTP request` under retry.
- `{ messages }` returned from `context` is NOT the literal HTTP payload: `convertToLlm` may filter image blocks, system prompt is appended separately, and `before_provider_request` can still replace the provider body. `context` is the correct semantic observation seam; provider payload hooks are correlation-only.
- Observed live behavior: one user prompt produced 4 `context` events (4 semantic LLM calls with 3 tool round trips), consistent with one event per model call.

## 6. Useful CR-002 candidate fields (provisional)

- `messageCount`, `nativeContextEstimate` (tokens, whitespace-collapsed char/4 heuristic) — directly usable.
- `categoryCounts` (USER / ASSISTANT / TOOL_RESULT / OTHER) and `toolResultCount` — cheap and stable.
- per-message `role` / `contentType` / `toolName` / `isError` — reliable from Pi types.
- per-message `contentHash` (sha256 of bounded text) — deterministic correlation without storing raw text.
- `harness: 'PI'` discriminator — needed once a second harness (OpenCode) is added.
- runtimeSessionId + monotonic sequence — replayable model-call timeline.

## 7. Fields deliberately NOT frozen

- `ModelCallObservation` shape is **experimental/internal only**; no exported stable public contract, no Zod schema, no SQLite schema.
- Exact field names may change after CR-002.
- No `ContextSource` / `ContextUniverse` / `ContextWorkingSet` / `ContextDecision` / `ContextTransition` types were created (PROPOSAL-030/031 remain direction-only).
- `harness` value is a string literal `'PI'`; the union will widen when a second harness arrives.
- Token estimator is a documented heuristic, not a provider-aware tokenizer.

## 8. Mismatches with PROPOSAL-030/031 assumptions

- PROPOSAL-030/031 assume source-level reconciliation will be observable from real Pi runs. In this shadow smoke, the `context` event exposes **only the assembled `AgentMessage[]`**, not the individual Context Sources. Source identity must be inferred from message shape (tool names, roles) rather than read directly from Pi.
- PROPOSAL-031's `ContextWorkingSet` is a hypothetical planner output; CR-001 proved the observation seam exists but produced no evidence yet about whether Working Set planning can or should operate at this boundary. That question is deferred to CR-003.
- No assumption of 1:1 `context event == HTTP request` held; retry semantics were documented instead (see §5).

## 9. Security / privacy notes

- Default durable output (JSONL) is metadata-only; no raw prompts, no API keys, no Authorization headers.
- `DEEPSEEK_API_KEY` is read only from the environment or Pi's `auth.json`; never logged, never committed.
- `rawCapture` opt-in exists in the Runtime core (`RawCaptureBudget`) with per-message and per-run byte limits + redaction, but the Pi integration does not enable it; default remains off.
- Research traces are written under `.canvas-agent/research/**` (gitignored) and were not committed.
- The smoke ran in a throwaway `mkdtemp` fixture workspace removed on completion.

## 10. Verification status vs packet acceptance criteria

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
| 10 real run attempted with credentials | ✅ (4 semantic calls) |
| 11 no production persistence/Desktop/Worker/v0.2 contract change | ✅ |
| 12 pnpm check green | ✅ 502 tests |
| 13 evidence identifies CR-002 fields + non-frozen fields | ✅ (§6, §7) |
| 14 not self-accepted; awaits lead review | ✅ |
