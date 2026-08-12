# Codex argv/schema fixture review — LEAD approval package

- **Status:** PENDING LEAD REVIEW (rev 2, rewritten) — blocks DS-005B (concrete Codex binding)
- **Date:** 2026-08-09
- **Parent:** PROPOSAL-028 (DS-005A authorized; DS-005B authorized after this review)
- **Environment evidence captured on:** 2026-08-09, `codex-cli 0.146.0`

## 1. Version capability probe

Command: `codex --version` → `fixtures/codex-version.txt`

```text
codex-cli 0.146.0
```

Exit code `0`. The v1 adapter **freezes support to the stable `0.146.x` line**; other minors,
majors and prereleases fail closed with `AGENT_VERSION_UNSUPPORTED`. The version decision is
shared between the Main `AgentRuntimeLocator` (readiness) and the Worker adapter
(`packages/worker-runtime/src/codex-version.ts`, `isSupportedCodexVersion`) so `agent.status`
READY and execution-time selection can never disagree.

## 2. Auth probe

Command: `codex login status` → `fixtures/login-status.txt`

```text
Logged in using ChatGPT
```

Exit `0` when authenticated; any non-zero exit or explicit unauthenticated message maps to
`AGENT_AUTH_REQUIRED`. Probe output is diagnostic only, never persisted/logged verbatim.

## 3. Launcher facts (Finder-launch safe)

```text
/opt/homebrew/bin/codex -> ../lib/node_modules/@openai/codex/bin/codex.js
shebang: #!/usr/bin/env node
```

`codex` is an npm-installed symlink needing a resolvable `node`. Discovery resolves the symlink
target for validation but retains the original launcher path; the bounded env allowlist provides
a PATH that can resolve both `codex` and `node`.

## 4. Exact intended non-interactive argv

`fixtures/argv.json` (prompt via stdin, never in argv):

```json
["codex","exec","--json","--cd","<worktree>","--sandbox","workspace-write","--color","never",
 "--ephemeral","--ignore-user-config","--ignore-rules","-c","project_doc_max_bytes=0",
 "--output-schema","<schema-file-path>","-"]
```

- No bypass flags (`--dangerously-bypass-approvals-and-sandbox` etc.), no `--add-dir`.
- Prompt is read from stdin (`-`); secrets never appear in argv.
- `--cd` is the Worker-created isolated worktree; no other writable directory.
- `--ephemeral` avoids persisting session files.
- `--ignore-user-config` / `--ignore-rules` isolate the run from user/project config and
  execpolicy rules (exercised by Codex CLI's own `cli_tests.rs`).
- `-c project_doc_max_bytes=0` prevents repository-local project instructions from injecting instructions
  outside the frozen Context Bundle (Canvas Agent accepts only frozen request context).
- `--output-schema` points to a schema file the adapter writes into the isolated runtime area.

## 5. Real JSONL event protocol (0.146.0 capture)

`codex exec --json` emits top-level events tagged by `type` (from `codex-rs/exec/src/exec_events.rs`):

`thread.started` → `turn.started` → `item.started` / `item.updated` / `item.completed` →
`turn.completed` / `turn.failed`, plus a fatal top-level `error`.

Real success capture (`fixtures/jsonl/success.jsonl`, thread_id sanitized):

```json
{"type":"thread.started","thread_id":"thr_<redacted>"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Skill descriptions were shortened …"}}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"OK"}}
{"type":"turn.completed","usage":{"input_tokens":18235,"cached_input_tokens":6912,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}
```

- Agent responses are `item.completed.item.type = "agent_message"` with `text`; with
  `--output-schema`, `text` is the JSON string matching the schema.
- `turn.completed` carries `usage` (token accounting), not the final message.

### Final message selection (DS-005B parser rules)

1. Require `turn.completed` **and** process exit `0` before treating the run as successful.
2. Take the **last qualified `agent_message` item before termination** as the normalized summary.
3. **Do not consume the first schema-valid message**: `--output-schema` can shape intermediate
   agent messages, so the last one wins (OpenAI codex#19816).
4. `success`, `tests_run` and `tool_calls_observed` are **agent self-report only**. Tool counts,
   test evidence and final success are derived independently by the Worker from the worktree
   patch + `git diff --cached --check`; the agent's prose is bounded diagnostic evidence.
5. A malformed line inside the stream → `AGENT_OUTPUT_INVALID` (no fallback to the last message).
6. **Item-level vs terminal errors**: a top-level `error` or `turn.failed` is a failure; an
   `item.completed` with `item.type = "error"` is bounded diagnostic only and does not by itself
   fail the run (the success capture includes such a non-fatal skill-budget item).

### Fixture set + sidecar manifests

Each `.jsonl` has an adjacent `*.manifest.json` recording `cliVersion`, `exitCode`,
`stderrClassification` and `expectedErrorCode` (a bare `.jsonl` cannot express a non-zero exit):

| File | Manifest | capture | exitCode | expected |
|---|---|---|---|---|
| `success.jsonl` | `success.manifest.json` | real 0.146.0 (full argv + schema) | 0 | – |
| `unknown-event.jsonl` | `unknown-event.manifest.json` | forward-compat construction | 0 | – (skip unknown events) |
| `malformed.jsonl` | `malformed.manifest.json` | schema-verified | 0 | `AGENT_OUTPUT_INVALID` |
| `auth-required.jsonl` | `auth-required.manifest.json` | schema-verified | 1 | `AGENT_AUTH_REQUIRED` |
| `non-zero-exit.jsonl` | `non-zero-exit.manifest.json` | schema-verified | 1 | `AGENT_PROCESS_FAILED` |

- `success` is the sanitized real capture (only `thread_id`/absolute paths redacted; event types,
  field names and order preserved) run with the **exact `argv.json` invocation including
  `--output-schema <final-response.schema.json>`**; the final `agent_message.text` is a JSON
  string satisfying `final-response.schema.json` (schema SHA-256 `86855a2c…17b0050` is recorded
  in the manifest). This proves the submitted argv + schema combination actually works.
- `auth-required` / `non-zero-exit` were constructed from the **0.146.0 release** event schema
  (marked `schema-verified`), not from a live logout or failing run.
- `unknown-event` is an explicit **forward-compatibility construction** (marked NOT
  schema-verified): `session.configured` and `item.type = "future_item_v2"` are synthetic
  events absent from 0.146.0, added to exercise the skip-unknown-event path.

## 6. Final response JSON Schema

`fixtures/final-response.schema.json` is written by the adapter and passed to `--output-schema`.
Codex is prompted to return exactly one object of that shape as its final message; the adapter
parses the final `agent_message` text against it.

## 7. What the reviewer should confirm

1. The argv matches documented `codex exec` options for 0.146.0 and the isolation flags.
2. The JSONL envelope and `agent_message`/`turn.completed` semantics match the release source.
3. The sidecar manifests carry the exit-code/stderr/expected-code metadata the parser needs.
4. The version range (frozen `0.146.x`) and final-message selection are consistent with
   DS-005B's adapter and the Worker's independent evidence.

After approval, DS-005B implements the concrete binding; the shared version check and these
fixtures are its contract.
