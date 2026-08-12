# DS-005 — Provider-neutral local CLI runner and Codex adapter

## Task owner

DeepSeek V4 Flash — Worker/runtime task with a narrow Electron Worker integration grant.

- **Branch:** `agent/deepseek-ds-005-local-cli-adapter`
- **Depends on:** DS-003 merged; PROPOSAL-028 approved
- **Integration dependency:** rebase/merge current `main` after DS-004 before final review
- **Blocks:** DS-007 and Product MVP

## Goal

Replace production fixture execution with one real, policy-bounded Codex CLI adapter while preserving immutable requests, isolated worktrees, safe process execution and independently derived patch/test evidence.

## Read first

- `CONTRIBUTING.md`
- `docs/architecture/decisions/PROPOSAL-028-local-cli-adapter-v1.md`
- `docs/architecture/decisions/PROPOSAL-028A-execution-request-v2-contract.md`
- `docs/architecture/decisions/PROPOSAL-028B-local-agent-runtime-discovery.md`
- `docs/architecture/decisions/PROPOSAL-028C-agent-readiness-command-contract.md`
- `docs/tasks/deepseek/DS-002-worker-runtime.md`
- `packages/worker-runtime/src/agent-adapter.ts`
- `packages/worker-runtime/src/process-runner.ts`
- `packages/worker-runtime/src/worker.ts`
- `apps/desktop/src/worker/worker-service.ts`
- `apps/desktop/src/main/execution-profile.ts`
- `packages/contracts/src/execution-request.ts`

## Definition of ready

Before writing the concrete adapter, commit test fixtures recording:

- `codex --version` capability probe shape;
- exact intended non-interactive argv;
- representative JSONL success, unknown-event, malformed-output, auth failure and non-zero-exit cases;
- the final response JSON Schema.

The architect reviews these fixtures and argv. DS-005A runner work may proceed before that review; DS-005B concrete binding may not.

## Authorized files

- `packages/worker-runtime/**`
- `packages/contracts/src/execution-request.ts`, exports and adjacent tests for the architect-approved v2 Context Bundle only
- `packages/contracts/src/command.ts`, `ipc.ts`, exports and adjacent tests for the approved `agent.*` commands only
- `apps/desktop/src/main/execution-coordinator.ts` and adjacent tests for frozen bundle materialization only
- new `agent-runtime-locator.ts`, `agent-settings.ts` and adjacent tests under `apps/desktop/src/main/**`
- `apps/desktop/src/main/command-core.ts`, `command-router.ts`, `command-errors.ts`, `index.ts` and DS-004 runtime modules only for approved Agent readiness/launch-plan wiring
- `apps/desktop/src/worker/worker-service.ts` and adjacent tests
- `apps/desktop/src/worker/protocol.ts` only if the accepted provider selection needs a versioned field; stop for review first
- `apps/desktop/src/main/execution-profile.ts` and adjacent tests
- new deterministic CLI fixture scripts under test directories
- `apps/desktop/e2e/**` for opt-in real-Agent smoke
- `docs/verification/**`
- `pnpm-lock.yaml` only as an automatic dependency result

No Renderer, Persistence or domain files are authorized.

## DS-005A — provider-neutral runner

1. Add the backward-readable ExecutionRequest v1/v2 schema split and v2 Context Bundle frozen in PROPOSAL-028.
2. Materialize v2 only from the FROZEN Snapshot's ordered persisted items; verify item hashes, bounds and canonical bundle hash in both Main and Worker.
3. Reject dirty expected revisions in Main and Worker before a Run side effect/claim/worktree is created.
4. Implement PROPOSAL-028B AgentRuntimeLocator, settings and path-free `agent.*` commands.
5. Add executable/version/auth probes with timeout and bounded output, including npm launcher/interpreter failure.
6. Run with argv arrays and `shell: false`; support stdin without interpolating prompts into a shell string.
7. Enforce cwd = Worker-created isolated worktree.
8. Build environment from an explicit allowlist; redact secret-bearing keys from diagnostics.
9. Terminate process trees on AbortSignal/deadline and distinguish cancellation from timeout.
10. Bound stdout/stderr independently and expose truncation.
11. Define stable adapter error codes from PROPOSAL-028/028B.
12. Add deterministic fake-executable tests for every branch.

## DS-005B — Codex adapter

1. Support the reviewed Codex CLI capability/version range and fail closed outside it.
2. Use `codex exec` in non-interactive, JSONL, no-color, workspace-write mode inside the worktree. Never use bypass flags.
3. Use a JSON Schema for the final normalized summary and parse JSONL defensively.
4. Generate the prompt only from the immutable request, materialized permitted context and explicit execution policy.
5. Tell Codex not to commit, push, alter branches or leave the worktree.
6. Select this adapter only for the validated production provider value. Missing executable/auth/version is a real failed/interrupted result, never Fixture fallback.
7. Keep Git diff export and verification commands owned by Worker after the adapter exits.
8. Record transport diagnostics without credentials or unbounded model text.
9. After Agent exit, require the detached worktree `HEAD`/branch state to remain at the requested base. Reject Agent commits or branch changes with `AGENT_REPOSITORY_STATE_VIOLATION`.
10. Replace the production `docs/phase2.md` verification with Worker-owned `git diff --cached --check`; keep arbitrary verification injection test-only.
11. Change the Main-owned production resource profile to the approved 15-minute / 100-tool-call / 1-GiB limits and enforce recognized tool-event counting.

## Prohibited scope

- No Claude adapter in this task.
- No arbitrary provider executable, argv or prompt from Renderer.
- No login-shell discovery, shell-profile sourcing, in-app provider login or credential storage.
- No `--dangerously-bypass-approvals-and-sandbox` or equivalent.
- No source-repository execution.
- No provider fallback, Checkpoint/Resume, session continuation or multi-Agent scheduling.
- No secret persistence in request, SQLite, artifact content or logs.
- No treating Agent prose as proof that tests passed or changes exist.
- No repository-, Task- or Renderer-supplied arbitrary verification command in v0.2.

## Acceptance criteria

1. Missing executable, unsupported version, missing auth, bad JSONL, timeout, cancel and non-zero exit map to distinct stable codes.
2. Prompt content containing quotes, newlines, `$()`, backticks or shell operators cannot create a second command or alter argv.
3. Output caps are enforced and truncation is visible.
4. Cancellation/timeout stops the child process tree within the configured bound.
5. A deterministic fake CLI changes only the isolated worktree and yields independently exported patch/check evidence.
6. Context Bundle item tampering, bundle tampering, missing P0 `TASK_INSTRUCTION` authority, non-contiguous positions, more than 256 items or more than 4 MiB is rejected before Agent spawn.
7. Historical v1 requests remain readable; real production dispatch emits and requires v2.
8. A fake Agent commit/branch mutation is rejected and cannot produce an empty-success patch.
9. Production no longer checks `docs/phase2.md`; it records `git diff --cached --check` against the exported patch.
10. Duration and observed tool-call budgets terminate the CLI with stable evidence.
11. Production provider selection never constructs Fixture.
12. Packaged-path tests cover PATH discovery, known-location discovery, native selection, symlink launcher, missing interpreter, auth-required and unsupported version states.
13. Opt-in authenticated smoke with installed Codex creates a requested small file change in a temporary repository and returns a structured summary.
14. The original repository remains unchanged until the existing explicit `artifact.apply` path.
15. A dirty expected revision returns `DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED` before Run persistence, claim, worktree or Agent spawn.

## Required verification

```bash
pnpm --filter @canvas-agent/worker-runtime typecheck
pnpm --filter @canvas-agent/worker-runtime test
pnpm --filter @canvas-agent/desktop test
pnpm check
CANVAS_AGENT_REAL_AGENT_SMOKE=1 pnpm --filter @canvas-agent/desktop e2e:agent
```

The authenticated smoke is opt-in; deterministic adapter tests and capability parsing are mandatory CI gates.

## Handoff additions

Include:

- exact executable/version and argv with secret values omitted;
- discovery source, launcher/interpreter handling and packaged Finder-launch evidence;
- environment key allowlist (names only);
- parser event coverage;
- Context Bundle canonicalization/limits and v1 compatibility evidence;
- timeout/cancel process-tree evidence;
- output limits;
- proof Fixture is test/dev-only;
- cost/network/auth assumptions of the opt-in smoke.
