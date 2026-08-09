# DS-005B verification packet — Concrete Codex CLI adapter binding

- **Status:** VERIFIED (rev 4, addressing the blocking contract review) — branch `agent/deepseek-ds-005-local-cli-adapter`; pending final architecture merge review (PR #9)
- **Date:** 2026-08-09
- **Basis:** PROPOSAL-028/028A/028B/028C, DS-005 ticket (DS-005B items), the approved Codex argv/schema fixture review, and the LEAD conditional-approval revisions (streaming budget, private launch plan, host lifecycle, v2 requirement, prompt order, stable-code separation, frozen order)
- **Branches:** base `main@7c83999` → `agent/deepseek-ds-005-local-cli-adapter`
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Runtime evidence

All commands ran under Node 24 (`.nvmrc`/`.node-version` pin `24.14.0`):

```text
node --version
v24.15.0
```

## Blocking review (rev 4) — fixes

| Review item | Fix | Evidence |
|---|---|---|
| P1 stable adapter codes discarded | the Worker persists `LocalCliError.code` verbatim as `rejectionReason` (never provider prose); cancellation records `AGENT_CANCELLED`; `AGENT_TIMED_OUT` sets `timedOut: true`; the bounded message stays only in diagnostic evidence | worker tests: non-zero exit → `AGENT_PROCESS_FAILED`, unsupported version → `AGENT_VERSION_UNSUPPORTED`, cancel → `AGENT_CANCELLED`, timeout → `AGENT_TIMED_OUT` + `timedOut: true` |
| P1 version probe escapes the hard deadline | one monotonic deadline spans version probe, schema preparation and `codex exec`; the probe receives the AbortSignal and the remaining budget and fails closed on cancelled / timed out / truncated / non-zero / exit-127 results | adapter tests: slow probe cut to `AGENT_TIMED_OUT` within a bound, cancel during probe → `CancelledError`, non-zero probe → `AGENT_VERSION_UNSUPPORTED`, truncated probe → `AGENT_OUTPUT_LIMIT_EXCEEDED` |
| P1 ENOENT conflates launcher and interpreter | on spawn ENOENT the adapter checks whether the launcher still exists and is executable: existing+executable → `AGENT_INTERPRETER_MISSING`, absent → `AGENT_EXECUTABLE_NOT_FOUND` | adapter test: existing executable with a missing shebang → `AGENT_INTERPRETER_MISSING` |
| P1 failed staging can become SUCCEEDED | `git add -A` exit is checked; `exportWorktreePatch` no longer re-stages or swallows a diff failure; an unstageable worktree entry that yields an empty staged diff while the agent claimed changes → `PARTIAL` ("agent claimed changes but produced an empty patch") — never an empty success | worker test: a FIFO left by the agent → `PARTIAL`, empty patch, `AGENT_PARTIAL` evidence |
| P1 failure transport evidence dropped | the bounded transport is carried on every typed `LocalCliError` (auth / process / output-invalid / timeout / truncation / cancel) and the Worker persists it into `AGENT_PARTIAL/partial-evidence.json` (no raw stdout/stderr/prompt) | worker test: auth failure → partial-evidence contains `transport['transport.json']` with `stderrClass: 'auth'` and no `stderr` key |
| P1 READY gate collapses the taxonomy | the Main gate maps NOT_FOUND / UNSUPPORTED_VERSION / AUTH_REQUIRED / INTERPRETER_MISSING / ERROR to their approved `AGENT_*` codes | command-core test: AUTH_REQUIRED agent → `HostUnavailableError` message contains `AGENT_AUTH_REQUIRED` |

## DS-005B item → evidence

| # | Item | Evidence | Status |
|---|---|---|---|
| 1 | Support the reviewed Codex version range and fail closed outside it | shared `codex-version.ts` (frozen `0.146.x`); the adapter re-probes `--version` at dispatch and throws `AGENT_VERSION_UNSUPPORTED` outside the range (adapter test `0.147.0`) | **PASS** |
| 2 | `codex exec` non-interactive JSONL workspace-write inside the worktree, no bypass flags | frozen argv via `runLocalCli` (`--cd <worktree> --sandbox workspace-write --color never --ephemeral --ignore-user-config --ignore-rules -c project_doc_max_bytes=0 --output-schema <schema> -`); no bypass flags | **PASS** |
| 3 | JSON Schema final summary + defensive JSONL parse | `codex-output-schema.ts`: frozen schema bytes + Zod mirror + SHA-256 pinned (`86855a2c…17b0050`); `parseCodexEvents` skips unknown events/items, rejects malformed lines (`AGENT_OUTPUT_INVALID`), selects the last qualified `agent_message` | **PASS** |
| 4 | Prompt only from immutable request/bundle/policy | `buildPrompt` uses the validated v2 bundle in **position order** (JSON-escaped items tagged authority/priority/itemType/source) + worker-owned safety/output preamble; stdin only, never argv | **PASS** |
| 5 | Tell Codex not to commit/push/change branches/leave worktree | prompt safety policy + Worker repository-state guard (`AGENT_REPOSITORY_STATE_VIOLATION` on HEAD movement or branch acquisition) | **PASS** |
| 6 | Select only the validated production provider; missing executable/auth/version is a real failure, never Fixture | worker provider selection (`codex-cli` requires v2 + launch plan; `fixture` requires an injected test adapter; unknown → `AGENT_POLICY_REJECTED`) all before claim; adapter returns real `AGENT_EXECUTABLE_NOT_FOUND`/`AGENT_AUTH_REQUIRED`/`AGENT_VERSION_UNSUPPORTED` | **PASS** |
| 7 | Git diff export and verification owned by Worker after adapter exits | Worker exports the staged patch and runs the Worker-owned `git diff --cached --check` (non-closeable); injected verificationCommands only append | **PASS** |
| 8 | Transport diagnostics without credentials or unbounded model text | `transport.json` holds only version/exitCode/signal/timedOut/cancelled/truncation/event counts/tool count/usage/stderrClass; no raw stdout/stderr/prompt/model text persisted; reused `AGENT_SUMMARY`/`AGENT_PARTIAL` artifact kinds (no new kind, no DB field) | **PASS** |
| 9 | Reject Agent commits/branch changes with `AGENT_REPOSITORY_STATE_VIOLATION` | `verifyWorktreeRepositoryState` runs after success OR failure; on violation outcome PARTIAL + stable reason, verification/patch skipped, bounded partial evidence kept (worker test: fake Agent commit) | **PASS** |
| 10 | Replace the `docs/phase2.md` default with Worker-owned `git diff --cached --check`; arbitrary verification test-only | worker-service no longer has a `docs/phase2.md` default; the universal check runs first, injected `verificationCommands` only append | **PASS** |
| 11 | Production profile 15-min / 100-tool-call / 1-GiB + recognized tool-event counting | `execution-profile.ts`: codex-cli, `configured-by-user`, `maxDurationMs 900_000`, `maxToolCalls 100`, `maxDiskBytes 1_000_000_000`; the adapter counts tool IDs via the **streaming** observer and terminates the process tree immediately on `maxToolCalls+1` (`BudgetExceededError`) | **PASS** |

## LEAD revision items → evidence

| Revision | Evidence |
|---|---|
| Streaming budget termination (not after exit) | `runLocalCli` gains `onLine` (StringDecoder, UTF-8 safe, bounded line accumulator); the adapter aborts the process tree on the `maxToolCalls+1`th unique tool id. Known tool item types count, known non-tools do not, unknown item types count conservatively once (tests) |
| Launch plan from private trusted state | `AgentRuntimeLocator.getLaunchPlan()` returns the validated absolute launcher + `{PATH,HOME}` allowlist, synced on committed READY; never derived from the renderer `displayPath`; protocol Zod accepts only PATH/HOME and rejects extra keys |
| WorkerHost launcher lifecycle | `UtilityProcessWorkerHost` fingerprints the initialized plan (sha256 of executable, env values never stored) and disposes + re-inits the Utility Process on fingerprint change; clear → Main READY gate rejects dispatch, no reuse. Tests: A→B restart, clear no-reuse, same-plan no-restart |
| Codex requires v2 | worker rejects `codex-cli + v1` with `EXECUTION_CONTEXT_REQUIRED` before claim; `AgentContext` carries `executionRequestId`/`agentConfiguration`/`contextBundle`; production model `configured-by-user` recorded as request evidence |
| Prompt position order | `buildPrompt` iterates the bundle in `position` order; items JSON-escaped with labels; no authority/priority re-sorting |
| Stable codes + diagnostics separation | `DispatchResult.rejectionReason` is a stable code, never provider prose; transport diagnostics bounded; no new ArtifactKind/DB field; tests assert exact codes for timeout/cancel/missing executable/interpreter/auth/policy/version drift |
| Frozen order | Main gate → persist Run → host plan check/restart → worker provider+v2 → claim/revision/worktree → streaming exec → repo-state guard → `git add -A` → `git diff --cached --check` → patch/evidence |

## Main Agent READY gate

`execution.dispatch` runs inside `manager.withActiveRun` (mutually exclusive with
`withConfigurationChange`) and checks the locator's status; non-READY → `AGENT_NOT_READY`
(HostUnavailableError) before `createDispatchedRun` (no Run, no worker dispatch). If READY but
the launcher is deleted / version drifts / auth expires later, the adapter re-probes and returns
a real failure result. (command-core route + a Main gate guard in the flow.)

## E2E

- `e2e:live`: drives the **real CodexAgentAdapter** with a deterministic fake codex on PATH —
  full freeze → dispatch (SUCCEEDED) → acceptance → apply → baseline activation → restart
  durability, no Fixture, no `docs/phase2.md`. **ALL PASSED**.
- `e2e:agent` (opt-in, `CANVAS_AGENT_REAL_AGENT_SMOKE=1`, otherwise skipped): real
  `codex-cli 0.146.0` creates `docs/hello.md` in a temp repo via the isolated worktree, returns a
  schema-conforming structured summary, records the universal check, and leaves the original
  repository unchanged. **ALL PASSED**. Cost/network/auth assumptions: uses the installed CLI +
  its logged-in ChatGPT session in a temporary repository; CI never requires a personal
  subscription or secret (the deterministic fake-codex suite is the mandatory gate).

## Test totals

```text
packages/domain          5   (unchanged)
packages/contracts      56   (unchanged)
packages/persistence    68   (unchanged)
packages/worker-runtime 89   (+37 schema/adapter/provider/guard/runner/probe/interpreter/transport)
apps/desktop           190   (+11 fake-codex/coordinator/worker-service/host/protocol/gate)
-----------------------
total                  408   (baseline 367)
```

## Commands run (all under Node 24)

```text
pnpm --filter @canvas-agent/worker-runtime typecheck   PASS
pnpm --filter @canvas-agent/worker-runtime test       89 passed
pnpm --filter @canvas-agent/desktop test             190 passed
pnpm check                                            all green (408)
pnpm --filter @canvas-agent/desktop e2e:live          ALL PASSED (real adapter, fake codex)
pnpm --filter @canvas-agent/desktop e2e:workspace     ALL PASSED
pnpm --filter @canvas-agent/desktop build:unpack:unsigned  PASS
pnpm --filter @canvas-agent/desktop e2e:packaged-smoke     ALL PASSED
CANVAS_AGENT_REAL_AGENT_SMOKE=1 pnpm --filter @canvas-agent/desktop e2e:agent   ALL PASSED (opt-in)
```

## Handoff additions

- Version gate / argv: frozen `0.146.x`; exact `codex exec` argv in the adapter (no secrets in argv).
- Launcher/interpreter: symlink resolved for validation, original path retained; packaged
  Finder-launch PATH built from homebrew/usr dirs + inherited PATH.
- Environment key allowlist (names only): `PATH`, `HOME` (the protocol rejects any extra key).
- JSONL event coverage: thread/turn/item lifecycle, unknown-event skip, item-level error =
  diagnostic, top-level error / `turn.failed` = failure, last qualified `agent_message`.
- Tool counting: unique `item.id`; known tool types count, known non-tools don't, unknown count
  once; streaming termination on `maxToolCalls+1`.
- Repository-state guard: HEAD == base + detached; `AGENT_REPOSITORY_STATE_VIOLATION` skips
  verification/patch, keeps bounded partial evidence.
- Budget/truncation: `maxDurationMs`/`maxToolCalls` enforced by the Worker/adapter; stdout 4 MiB
  / stderr 1 MiB bounded with truncation → `AGENT_OUTPUT_LIMIT_EXCEEDED`.
- Fixture test/dev-only: production profile is `codex-cli`; `fixture` requires an injected test
  adapter; `e2e:live` uses a deterministic fake codex, not Fixture.
- Opt-in smoke: cost/network/auth assumptions recorded above.
