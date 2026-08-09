# DS-005A execution plan — Provider-neutral local CLI runner

- **Branch:** `agent/deepseek-ds-005-local-cli-adapter`
- **Base:** `main@7c83999` (DS-004 closeout)
- **Status:** PLANNED — fixture review package committed alongside for LEAD approval; DS-005B binding NOT implemented
- **Date:** 2026-08-09
- **Depends on:** DS-003, DS-004 merged; PROPOSAL-028/028A/028B/028C approved
- **Blocks:** DS-005B, DS-007, Product MVP

## 1. Goal

Replace production fixture execution with a provider-neutral local CLI process/policy
boundary and Main-owned Agent runtime discovery/readiness, keeping immutable requests,
isolated worktrees, safe process execution and independently derived patch/check evidence.
The concrete Codex binding (DS-005B) waits for LEAD approval of the argv/schema fixtures.

## 2. ExecutionRequest v1/v2 Context Bundle (`packages/contracts/src/execution-request.ts`)

Implement PROPOSAL-028A verbatim:

- Export `MAX_EXECUTION_CONTEXT_ITEMS = 256`, `MAX_EXECUTION_CONTEXT_BYTES = 4 * 1024 * 1024`.
- `executionContextItemV2Schema` (position/itemType/sourceRef/resolvedContent/contentHash/
  authority/priority/tokenEstimate, strict), `executionContextBundleV2Schema` (items 1..256,
  contentHash, totalBytes 1..MAX, strict).
- Shared strict `executionRequestBaseSchema` (existing v1 fields minus `schemaVersion`);
  `executionRequestV1Schema` (literal 1) and `executionRequestV2Schema` (contextBundle +
  literal 2); `executionRequestSchema = z.discriminatedUnion('schemaVersion', [...])`.
- Export inferred `ExecutionContextItemV2`, `ExecutionContextBundleV2`, `ExecutionRequestContractV1`,
  `ExecutionRequestContractV2`, union `ExecutionRequestContract`.
- Canonicalization: `stableStringify(parsedItems)`; `totalBytes = UTF8.byteLength(canonicalItems)`;
  `contentHash = SHA256(canonicalItems)`; outer `requestHash = SHA256(stableStringify(request minus requestHash))`.
- Semantic validation beyond Zod (positions 0..n-1 contiguous, per-item content hash, byte/hash
  recompute, ≥1 `TASK_INSTRUCTION`/`P0` item, outer request hash) shared by Main and Worker.

Existing `ExecutionRequestContract` imports stay valid; consumers narrow `schemaVersion` before
touching `contextBundle`. Historical v1 JSON remains parseable (no DB migration).

## 3. Main materialization (`apps/desktop/src/main/execution-coordinator.ts` + tests)

For new dispatch:

1. Require the referenced Snapshot `status === 'FROZEN'`.
2. Read ordered persisted items via `listSnapshotItems(contextSnapshotId)` (Persistence),
   ordered by immutable `position`.
3. Map only frozen fields named in the schema; re-verify each stored `contentHash`.
4. Build the canonical bundle (`totalBytes`, bundle `contentHash`).
5. Emit `schemaVersion: 2`; compute the outer `requestHash` last.
6. Reject `expectedRepositoryRevision.workingTreePatchHash !== null` with
   `DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED` **before** any Run record/claim/worktree side effect.

Renderer cannot send or override any bundle field. The production profile becomes
`provider: 'codex-cli'`, `maxDurationMs: 900_000`, `maxToolCalls: 100`,
`maxDiskBytes: 1_000_000_000` (`execution-profile.ts` + tests).

## 4. Worker double-validation & dirty-revision pre-rejection (`packages/worker-runtime/src/**`)

`validateExecutionRequest` (validation.ts) narrows on `schemaVersion`:

- v1: unchanged behavior (Fixture test/dev only).
- v2: run the full semantic bundle validation (contiguous positions, per-item hashes,
  canonical byte/hash recompute, ≥1 P0 TASK_INSTRUCTION, outer request hash) — all **before**
  claim, worktree creation or Agent spawn.

`worker.ts` adds the dirty-revision pre-check: `expectedRepositoryRevision.workingTreePatchHash
!== null` → `DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED` (stable, typed outcome) before claim.

Worker selects the `AgentAdapter` from validated `request.agentConfiguration.provider`;
production never constructs `FixtureAgentAdapter` (Fixture is injectable test/dev-only).

## 5. Provider-neutral CLI runner (`packages/worker-runtime/src/local-cli-runner.ts` + tests)

New module implementing PROPOSAL-028's `LocalCliInvocation`/`LocalCliResult` evidence split:

- `spawn` with argv arrays and `shell: false` only; never build a shell string.
- `cwd` = the Worker-created isolated worktree; no other writable directory.
- `stdin` supported for prompts without interpolation (prompts never reach argv when stdin is used).
- Process-tree cancellation on `AbortSignal`; deadline timeout; distinguish `AGENT_CANCELLED`
  from `AGENT_TIMED_OUT`.
- Independent `maxStdoutBytes` / `maxStderrBytes` bounds with `stdoutTruncated`/`stderrTruncated`.
- Explicit environment allowlist (names only) + provider-required auth variables by exact key;
  never log values; redact secret-bearing keys from diagnostics.
- Reuse/extend `process-runner.ts` safe spawn semantics; keep the git allowlist intact.
- Stable adapter error taxonomy from PROPOSAL-028 (`AGENT_EXECUTABLE_NOT_FOUND`,
  `AGENT_VERSION_UNSUPPORTED`, `AGENT_AUTH_REQUIRED`, `AGENT_POLICY_REJECTED`,
  `AGENT_OUTPUT_INVALID`, `AGENT_OUTPUT_LIMIT_EXCEEDED`, `AGENT_PROCESS_FAILED`,
  `AGENT_REPOSITORY_STATE_Violation`, `AGENT_TIMED_OUT`, `AGENT_CANCELLED`,
  `DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED`).

## 6. AgentRuntimeLocator + settings + path-free readiness (`apps/desktop/src/main/**`)

- New `agent-runtime-locator.ts` + `agent-settings.ts` (PROPOSAL-028B):
  - `agent-settings-v1.json` = `{ schemaVersion: 1, codexCliLauncherPath: string | null }`
    (Zod, atomic temp+rename, corrupt → fallback to discovery).
  - Discovery precedence: saved user choice → inherited PATH → platform known-location
    candidates (Homebrew/local-user bin under `app.getPath('home')`) → `NOT_FOUND`.
  - Symlink launcher: resolve target for validation, retain original launcher path so
    package-manager upgrades refresh the symlink.
  - Bounded `codex --version` and `codex login status` probes through the provider-neutral
    runner; missing shebang interpreter → `INTERPRETER_MISSING` (no login shell, no profile sourcing).
- New `agent.*` commands (PROPOSAL-028C verbatim): `agent.status`, `agent.chooseExecutable`
  (native picker, empty payload, picker-bound to the trusted window), `agent.clearExecutable`.
  `agent.status` is independent of workspace `READY`. While a Run is active,
  choose/clear → `ACTIVE_RUN_BLOCKS_CHANGE`, launch plan unchanged.
- Wire into `command-core.ts`/`command-router.ts`/`command-errors.ts` and the manager/`index.ts`
  composition; the absolute launch plan crosses to the Worker only via the runtime-validated
  init frame (`apps/desktop/src/worker/protocol.ts` versioned field only if required; stop for
  review first).

## 7. Worker host integration (`apps/desktop/src/worker/worker-service.ts`)

- Worker `init` receives the trusted launch plan (resolved executable + env allowlist).
- Adapter selection comes from the validated request, not Renderer.
- Production `verificationCommands` default changes (DS-005B-ready): remove the
  `docs/phase2.md` check; the universal `git diff --cached --check` stays Worker-owned.

## 8. Fake-executable test matrix (deterministic, no credentials)

| Fixture | Proves |
|---|---|
| fake version `codex-cli 0.146.0` | capability/version probe acceptance |
| fake version unsupported / garbage | `AGENT_VERSION_UNSUPPORTED`, fail closed |
| missing executable (spawn ENOENT) | `AGENT_EXECUTABLE_NOT_FOUND` |
| non-executable file / not a regular file | `AGENT_EXECUTABLE_NOT_READABLE` |
| shebang interpreter missing | `INTERPRETER_MISSING` (npm launcher case) |
| `login status` non-zero / "not logged in" | `AGENT_AUTH_REQUIRED`, no secret exposure |
| JSONL success + unknown event + malformed line | defensive parser; unknown events skipped |
| JSONL with final structured result | normalized summary + transport diagnostics |
| oversized stdout / stderr | independent caps + truncation markers |
| sleep-forever child | `AGENT_TIMED_OUT` vs `AGENT_CANCELLED` distinction; process-tree killed within bound |
| fake Agent commit / branch switch | `AGENT_REPOSITORY_STATE_VIOLATION`, no empty-success patch |
| argv injection prompt (quotes/newlines/`$()`/backticks/`;`) | no second command, argv unchanged |
| prompt via stdin | stdin path exercised, secrets never in argv |
| fake launcher symlink → real target | locator symlink validation |

## 9. Authorized files (DS-005A slice)

- `packages/worker-runtime/**` (runner, adapter boundary, worker double-validation, tests).
- `packages/contracts/src/execution-request.ts` + exports + adjacent tests (v2 only).
- `packages/contracts/src/command.ts`, `ipc.ts` + exports + adjacent tests (`agent.*` only).
- `apps/desktop/src/main/execution-coordinator.ts` + tests (frozen bundle materialization only).
- new `agent-runtime-locator.ts`, `agent-settings.ts` + tests under `apps/desktop/src/main/**`.
- `apps/desktop/src/main/command-core.ts`, `command-router.ts`, `command-errors.ts`, `index.ts`
  + DS-004 runtime modules (Agent readiness/launch-plan wiring only).
- `apps/desktop/src/worker/worker-service.ts` + tests; `worker/protocol.ts` only if a versioned
  field is required (stop for review first).
- `apps/desktop/src/main/execution-profile.ts` + tests.
- deterministic CLI fixture scripts under test directories; `apps/desktop/e2e/**` (opt-in smoke);
  `docs/verification/**`; `pnpm-lock.yaml` only as an automatic result.

No Renderer, Persistence or domain files.

## 10. Verification

```bash
pnpm --filter @canvas-agent/worker-runtime typecheck
pnpm --filter @canvas-agent/worker-runtime test
pnpm --filter @canvas-agent/desktop test
pnpm check
# opt-in authenticated smoke (DS-005B, after LEAD fixture review):
CANVAS_AGENT_REAL_AGENT_SMOKE=1 pnpm --filter @canvas-agent/desktop e2e:agent
```

Deterministic fake-executable + capability-parsing tests are mandatory CI gates; the
authenticated smoke is opt-in and uses a temporary repository/worktree.

## 11. Handoff additions

- exact version probe/argv (secrets omitted), parser event coverage;
- discovery source + launcher/interpreter handling + packaged Finder-launch evidence;
- environment key allowlist (names only);
- Context Bundle canonicalization/limits + v1 compatibility;
- timeout/cancel process-tree evidence; output caps; Fixture dev/test-only proof;
- cost/network/auth assumptions of the opt-in smoke.

## 12. Fixture review package (committed with this plan)

`docs/architecture/codex-argv-schema-fixture-review/` records the real `codex --version`
probe, `codex login status` probe, the exact intended non-interactive `codex exec` argv,
representative JSONL success/unknown-event/malformed/auth/non-zero-exit cases, and the final
response JSON Schema. LEAD approval unblocks DS-005B; DS-005A runner work proceeds in parallel.
