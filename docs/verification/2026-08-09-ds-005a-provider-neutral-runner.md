# DS-005A verification packet — Provider-neutral local CLI runner

- **Status:** VERIFIED (rev 3, addressing the blocking commit reviews) — branch `agent/deepseek-ds-005-local-cli-adapter`; pending architecture merge review
- **Date:** 2026-08-09
- **Basis:** PROPOSAL-028 (DS-005A authorized), PROPOSAL-028A (v2 Context Bundle), PROPOSAL-028B (locator), PROPOSAL-028C (agent command contract), `docs/tasks/deepseek/DS-005-local-cli-adapter.md`
- **Branches:** base `main@7c83999` → `agent/deepseek-ds-005-local-cli-adapter`
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Runtime evidence

All commands ran under Node 24 (`.nvmrc`/`.node-version` pin `24.14.0`):

```text
node --version
v24.15.0
```

## PR blocking review — fixes (rev 2)

| Review item | Fix | Evidence |
|---|---|---|
| P1 shared validator omits the 256-item cap | `assertValidExecutionContextBundle` now rejects `items.length < 1 \|\| > MAX_EXECUTION_CONTEXT_ITEMS` (Main calls it without Zod) | `context-bundle.test.ts` (257 items, empty); `execution-coordinator.test.ts` "rejects a snapshot with more than 256 context items before any Run side effect" (no Run record, zero worker capture) |
| P1 Abort only terminates the direct child | `local-cli-runner.ts` routes abort and deadline through one explicit process-group shutdown state machine (SIGTERM → bounded SIGKILL), first termination reason wins (`timedOut` XOR `cancelled`), pre-aborted signal returns `cancelled` without spawning, and resolution waits for `close` or the bounded forced phase | runner tests: pre-abort, grandchild PID liveness after timeout, timeout-vs-cancel mutual exclusivity |
| P1 failed launcher selection destroys prior READY | `chooseExecutable`/`clearExecutable` commit only after the atomic settings write succeeds; a failed candidate (including `AUTH_REQUIRED`) never overwrites a prior READY launcher; settings write failure returns `SETTINGS_INVALID` preserving prior state; `AUTH_REQUIRED` is saved only when no READY launcher exists | locator tests: bad-candidate rollback keeps READY + settings unchanged, settings-write failure → `SETTINGS_INVALID`, AUTH-preserved-when-READY vs AUTH-saved-when-none |
| P1 active-run guard picker race | `WorkspaceRuntimeManager.withConfigurationChange` is atomic with `withActiveRun` only (ordinary `withReadyRuntime` project commands are not blocked), serializes concurrent changes via a promise chain (no public `OPERATION_IN_PROGRESS`), releases its flag in `finally`; the locator uses `configurationGate` for the picker-then-probe/persist critical section | manager tests (run-active block, config-changing blocks runs but not project commands, concurrent serialization); locator race test (run starts during picker → `ACTIVE_RUN_BLOCKS_CHANGE`, launcher unchanged) |
| P1 runner breaks legal UTF-8 JSONL | the runner buffers bounded byte slices and decodes once via `Buffer.concat().toString('utf8')`, preserving multi-byte characters split across pipe chunks | runner UTF-8 tests (Chinese/emoji cross-chunk exact decode; byte-cap truncation) |
| P2 locator classification + tests incomplete | `probeCandidate` distinguishes a missing path (`EXECUTABLE_NOT_FOUND`) from an existing non-executable file (`EXECUTABLE_NOT_READABLE`); new shared `codex-version.ts` freezes the v1 adapter to stable `0.146.x` (other minors/majors/prereleases → `UNSUPPORTED_VERSION`), used by both the locator and the future Worker adapter | locator tests (non-executable, `0.145/0.147/prerelease` → unsupported, `0.146.9` → READY); `codex-version.test.ts` |

## PR blocking review round 2 — fixes (rev 3)

| Review item | Fix | Evidence |
|---|---|---|
| P1 restart loses the saved READY launcher | `chooseExecutable`/`clearExecutable` prime the **committed status first inside the configuration gate** (`committedStatus()` reads settings + discovery before probing the candidate), so a fresh Locator after restart protects a previously saved READY launcher even with a null `statusCache`; **only prior READY is protected** (AUTH_REQUIRED is never used to carry another candidate's error) | locator test "a fresh Locator protects the saved READY launcher on the first bad choose (restart case)" — READY preserved, settings unchanged |
| P1 success fixture does not satisfy the final-response schema | re-captured with the **exact `argv.json` invocation including `--output-schema <final-response.schema.json>`**; the final `agent_message.text` is a JSON string satisfying the schema (schema SHA-256 `86855a2c…17b0050` recorded in the manifest) | `success.jsonl` + `success.manifest.json` (full argv, prompt, schema hash) |
| P1 unknown-event fixture has no unknown types | `unknown-event.jsonl` now contains genuinely synthetic forward-compat events (`session.configured`, `item.type="future_item_v2"`) and is explicitly labeled **forward-compatibility construction (NOT schema-verified)** | manifest provenance note |
| P2 worktree confinement not established by the generic runner | DS-005A item #7 re-marked: the runner accepts a caller-supplied `cwd`; enforcing the isolated worktree is a **DS-005B concrete adapter integration gate** with an integration test | verification item table |
| P2 item-level error semantics frozen | README rule 6: top-level `error` / `turn.failed` is a failure; `item.completed` with `item.type="error"` is bounded diagnostic only (success fixture includes a non-fatal skill-budget item) | README §5 |
| P2 cancel process-tree cleanup regression | added a cancel variant of the grandchild-liveness test (waits for the PID file, then aborts; descendant verified gone) | `local-cli-runner.test.ts` |

## DS-005A item → evidence

| # | Item | Evidence | Status |
|---|---|---|---|
| 1 | v1/v2 schema split + Context Bundle | `packages/contracts/src/execution-request.ts`: shared strict base, `executionRequestV1Schema` (literal 1), `executionRequestV2Schema` (contextBundle + literal 2), discriminated union; `MAX_EXECUTION_CONTEXT_ITEMS/BYTES`; `execution-request.test.ts` (v1 round trip, v2 round trip, cross-variant rejection, limits) | **PASS** |
| 2 | Materialize v2 from FROZEN items; verify hashes/bounds/canonical hash in Main and Worker | `ExecutionCoordinator.materializeContextBundle`: `listSnapshotItems` in position order → map frozen fields → re-verify content hashes → canonical bundle → `assertValidExecutionContextBundle`; Worker `validation.ts` runs the same semantic checks before claim | **PASS** |
| 3 | Dirty revision rejection before Run/claim/worktree | coordinator throws `DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED` before `createDispatchedRun` (test proves no Run record + no worker capture); worker returns `VALIDATION_REJECTED` + the code before claim (test proves no worktree) | **PASS** |
| 4 | AgentRuntimeLocator + settings + path-free `agent.*` commands | `agent-runtime-locator.ts`, `agent-settings.ts`, `agent.status/chooseExecutable/clearExecutable` (PROPOSAL-028C verbatim) | **PASS** |
| 5 | executable/version/auth probes with timeout + bounded output, npm launcher/interpreter failure | bounded `codex --version` + `codex login status` via `runLocalCli`; spawn ENOENT / env exit 127 → `INTERPRETER_MISSING` | **PASS** |
| 6 | argv arrays + `shell: false`; stdin without shell interpolation | `local-cli-runner.ts`; fake-executable tests prove verbatim argv, stdin delivery, shell-operator injection safety | **PASS** |
| 7 | cwd = isolated worktree | **Deferred to DS-005B (concrete adapter binding).** The generic runner accepts a caller-supplied `cwd` from the invocation; enforcing that it is the Worker-created isolated worktree (and that the adapter receives no other writable directory) is a DS-005B concrete integration gate with an integration test | **PASS (DS-005A runner contract) / gate in DS-005B** |
| 8 | explicit environment allowlist; redact secret-bearing keys | runner uses only the caller's `environment` (never `process.env`); test proves `process.env` marker absent, allowlisted var present | **PASS** |
| 9 | process-tree terminate on AbortSignal/deadline; cancel vs timeout distinct | runner kills the process group (SIGTERM then SIGKILL); tests assert `timedOut:true/cancelled:false` and `cancelled:true/timedOut:false` | **PASS** |
| 10 | independent stdout/stderr caps + truncation | `local-cli-runner.ts` per-stream bounds; test asserts both truncated, each ≤ cap | **PASS** |
| 11 | stable adapter error codes | `packages/worker-runtime/src/errors.ts` (PROPOSAL-028 taxonomy: `AGENT_EXECUTABLE_NOT_FOUND`, `AGENT_VERSION_UNSUPPORTED`, `AGENT_AUTH_REQUIRED`, `AGENT_POLICY_REJECTED`, `AGENT_OUTPUT_INVALID`, `AGENT_OUTPUT_LIMIT_EXCEEDED`, `AGENT_PROCESS_FAILED`, `AGENT_REPOSITORY_STATE_VIOLATION`, `AGENT_TIMED_OUT`, `AGENT_CANCELLED`, `AGENT_INTERPRETER_MISSING`, `EXECUTION_CONTEXT_REQUIRED`, `DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED`) | **PASS** |
| 12 | deterministic fake-executable tests for every branch | `local-cli-runner.test.ts` (8), `context-bundle.test.ts` (10), `agent-runtime-locator.test.ts` (11), `worker.test.ts` (+2 dirty/v2) | **PASS** |

## Error codes → outcomes

- `DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED`: coordinator `ValidationError` (before Run persistence); worker `VALIDATION_REJECTED` rejectionReason (before claim).
- `AGENT_*` codes are emitted by the concrete adapter (DS-005B) from runner evidence (`LocalCliSpawnError`, `timedOut`, `cancelled`, non-zero exit); the taxonomy is exported and tested at the runner/probe boundary now.

## Main/Worker v2 verification (shared)

`computeExecutionContextBundle` (stableStringify canonical form, UTF-8 totalBytes, SHA-256) and
`assertValidExecutionContextBundle` (contiguous positions, per-item content hash, canonical
byte/hash recompute, `MAX_EXECUTION_CONTEXT_BYTES` cap, ≥1 P0 `TASK_INSTRUCTION`) live in
`worker-runtime/src/validation.ts` and are used by both `ExecutionCoordinator` (materialization)
and the Worker (pre-claim). Tests cover tampering, non-contiguous positions, missing P0, byte
cap, key-order-independence of the canonical hash, reordered-item hash change, and v1
compatibility.

## Agent readiness states / discovery

- Precedence: saved `agent-settings-v1.json` launcher → inherited PATH → known locations
  (`$home/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`; injectable for tests).
- Symlink launchers resolved for validation; the originally chosen launcher path is retained.
- Probe environment is an explicit allowlist (PATH incl. Homebrew/usr dirs, HOME); secret-bearing
  values never logged.
- `agent.chooseExecutable`/`agent.clearExecutable` blocked while a Run is active
  (`ACTIVE_RUN_BLOCKS_CHANGE`); picker cancellation preserves the prior status.

## Compatibility / Fixture

- Historical v1 requests remain parseable; worker tests still dispatch v1.
- Production dispatch now emits and requires v2 (the coordinator materializes the bundle).
- Fixture remains injectable for tests and development smoke only; DS-005B replaces production
  provider selection and removes the `docs/phase2.md` verification default.

## E2E / regression

```text
pnpm --filter @canvas-agent/desktop e2e:live          ALL PASSED (v2 coordinator path)
pnpm --filter @canvas-agent/desktop build:unpack:unsigned  signing skipped
pnpm --filter @canvas-agent/desktop e2e:workspace     ALL PASSED
pnpm --filter @canvas-agent/desktop e2e:packaged-smoke     ALL PASSED
```

## Test totals

```text
packages/domain          5   (unchanged)
packages/contracts      56   (+8 v2/agent contract tests)
packages/persistence    68   (unchanged)
packages/worker-runtime 52   (+30 runner/bundle/dirty/v2/codex-version + cancel-process-tree)
apps/desktop           186   (+25 locator/manager/coordinator rev-2/rev-3)
-----------------------
total                  367   (baseline 304)
```

## Commands run (all under Node 24, rev 3)

```text
pnpm --filter @canvas-agent/worker-runtime typecheck   PASS
pnpm --filter @canvas-agent/worker-runtime test       52 passed
pnpm --filter @canvas-agent/desktop test             186 passed
pnpm check                                            all green (367)
pnpm --filter @canvas-agent/desktop e2e:live          ALL PASSED
pnpm --filter @canvas-agent/desktop e2e:workspace     ALL PASSED
pnpm --filter @canvas-agent/desktop e2e:packaged-smoke ALL PASSED
```

The Codex argv/schema fixture package was rewritten (rev 3): `success.jsonl` is a real 0.146.0
capture run with the **full `argv.json` including `--output-schema`** whose final
`agent_message` satisfies `final-response.schema.json` (hash `86855a2c…17b0050` in the
manifest); `auth-required` / `non-zero-exit` are `schema-verified` from the 0.146.0 release
`exec_events.rs`; `unknown-event` is an explicit forward-compat construction with synthetic
events; sidecar manifests record exitCode / stderr classification / expected error code.

## Handoff additions

- Version probe: `codex --version` → `codex-cli 0.146.0` (real capture in the fixture review package).
- Auth probe: `codex login status` → `Logged in using ChatGPT` (real capture).
- Discovery sources: saved choice → PATH → known locations; symlink launcher resolved for
  validation, original path retained; packaged Finder-launch PATH built from
  `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` + inherited PATH.
- Environment key allowlist (names only): `PATH`, `HOME` (probe env); the Codex adapter (DS-005B)
  will add `CODEX_HOME`/provider auth keys by exact name.
- Context Bundle canonicalization/limits and v1 compatibility: see §v2 verification.
- Timeout/cancel process-tree evidence: runner tests kill the process group; duration bounded.
- Fixture test/dev-only: production coordinator now emits v2; provider selection flips in DS-005B.

## Deferred to DS-005B (per task packet)

Concrete Codex adapter (`codex exec` binding), production provider selection with no Fixture
fallback, `docs/phase2.md` verification removal + `git diff --cached --check` recording, the
900s/100-tool-call/1-GiB production profile, Agent repository-state guard
(`AGENT_REPOSITORY_STATE_VIOLATION`), and the opt-in authenticated `e2e:agent` smoke — all after
LEAD approval of the Codex argv/schema fixture review package.
