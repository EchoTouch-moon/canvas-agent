# Codex argv/schema fixture review — LEAD approval package

- **Status:** PENDING LEAD REVIEW — blocks DS-005B (concrete Codex binding)
- **Date:** 2026-08-09
- **Parent:** PROPOSAL-028 (DS-005A authorized; DS-005B authorized after this review)
- **Environment evidence captured on:** 2026-08-09, `codex-cli 0.146.0`

This package records the exact capability probe shapes, the intended non-interactive argv, the
JSONL event samples the parser must handle, and the final-response JSON Schema. The lead reviews
these before DS-005B writes the concrete adapter.

## 1. Version capability probe

Command:

```text
codex --version
```

Observed output (`fixtures/codex-version.txt`):

```text
codex-cli 0.146.0
```

Exit code `0`. The adapter parses `codex-cli <semver>`; a missing/garbage/unsupported major
combination fails closed with `AGENT_VERSION_UNSUPPORTED`.

## 2. Auth probe

Command:

```text
codex login status
```

Observed output (`fixtures/login-status.txt`):

```text
Logged in using ChatGPT
```

Exit code `0` when authenticated; any non-zero exit or explicit unauthenticated message maps to
`AGENT_AUTH_REQUIRED`. Probe output is diagnostic only and never persisted/logged verbatim.

## 3. Launcher facts (Finder-launch safe)

```text
/opt/homebrew/bin/codex -> ../lib/node_modules/@openai/codex/bin/codex.js
shebang: #!/usr/bin/env node
```

`codex` is an npm-installed symlink needing a resolvable `node`. Discovery therefore resolves
the symlink target for validation but retains the original launcher path; the bounded env
allowlist provides a PATH that can resolve both `codex` and `node`.

## 4. Exact intended non-interactive argv

`fixtures/argv.json` (prompt via stdin, never in argv):

```json
[
  "codex",
  "exec",
  "--json",
  "--cd", "<isolated-worktree-path>",
  "--sandbox", "workspace-write",
  "--color", "never",
  "--ephemeral",
  "--output-schema", "<schema-file-path>",
  "-"
]
```

- No `--dangerously-bypass-approvals-and-sandbox`, no bypass flags, no `--add-dir`.
- The prompt is read from stdin (`-`); secrets never appear in argv.
- `--cd` is the Worker-created isolated worktree; no other writable directory.
- `--ephemeral` avoids persisting session files.
- `--output-schema` points to a schema file the adapter writes into the isolated runtime area.

## 5. JSONL event coverage

`--json` emits one event per line framed as:

```json
{"type":"data","data":{"type":"<eventType>","payload":{...}}}
```

Samples in `fixtures/jsonl/`:

| File | Purpose |
|---|---|
| `success.jsonl` | agent_message → tool_call → tool_call_output → result (final structured summary) |
| `unknown-event.jsonl` | a new/unknown event type between known events (must be skipped defensively) |
| `malformed.jsonl` | non-JSON line + wrong framing (must be rejected with `AGENT_OUTPUT_INVALID`) |
| `auth-required.jsonl` | run-level auth error event / non-zero process with auth stderr |
| `non-zero-exit.jsonl` | partial events then non-zero exit (must map to a stable failure, no empty success) |

The parser consumes `result` payloads as the normalized summary; anything else is bounded
diagnostic evidence, never independent acceptance proof.

## 6. Final response JSON Schema

`fixtures/final-response.schema.json` is the schema the adapter writes and passes to
`--output-schema`. Codex is prompted to return exactly one object of this shape as its final
message. The adapter parses the final `result`/last-message payload against it.

## 7. What the reviewer should confirm

1. The argv uses only documented `codex exec` options for this version.
2. Prompt-via-stdin keeps user/task text out of argv.
3. The JSONL framing and result schema are consistent with the intended adapter parser.
4. The error cases map to the PROPOSAL-028 stable codes.

After approval, DS-005B implements the concrete binding using these fixtures; DS-005A runner
work proceeds in parallel.
