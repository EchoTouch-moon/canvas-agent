# PROPOSAL-028 — Provider-neutral Local CLI Adapter v1

- **Status:** APPROVED — DS-005A authorized; DS-005B authorized for Codex after exact argv/schema fixture review
- **Decision owner:** Lead architect
- **Date:** 2026-08-09
- **Scope:** Product MVP v0.2

## Problem

The isolated Worker boundary is real, but production dispatch always constructs `FixtureAgentAdapter`. Canvas Agent therefore proves orchestration, not actual agent execution. A direct provider-specific implementation would couple process policy, output parsing and product state to one changing CLI.

## Decision

Split the implementation into:

1. a provider-neutral local CLI process and policy boundary;
2. a versioned concrete adapter;
3. Worker selection from validated `ExecutionRequest.agentConfiguration`.

Fixture remains injectable for tests and explicit development smoke only. It is not a production fallback.

## ExecutionRequest v2 Context Bundle

`ExecutionRequest v1` binds Snapshot identity but contains no materialized instructions. A real Agent cannot execute meaningfully from opaque IDs, and the Worker is forbidden from querying SQLite. Add a backward-readable `ExecutionRequest v2` variant with:

```ts
interface ExecutionContextItemV2 {
  readonly position: number
  readonly itemType: ContextItemType
  readonly sourceRef: string
  readonly resolvedContent: string
  readonly contentHash: Sha256
  readonly authority: ContextAuthority
  readonly priority: ContextPriority
  readonly tokenEstimate: number
}

interface ExecutionContextBundleV2 {
  readonly items: readonly ExecutionContextItemV2[]
  readonly contentHash: Sha256
  readonly totalBytes: number
}
```

The exact Zod names are frozen in a contract addendum before code changes. Semantic rules are already decided:

- Main reads `listSnapshotItems(contextSnapshotId)` only after proving the Snapshot is FROZEN.
- Items are ordered by immutable `position`; positions are unique and contiguous.
- Main re-verifies `sha256(resolvedContent) === contentHash`, computes UTF-8 `totalBytes`, and computes bundle `contentHash` from a canonical serialization of all fields.
- The outer request hash covers the complete bundle.
- Worker repeats item, total-byte and bundle-hash validation before claim/spawn.
- The bundle is capped at 4 MiB and 256 items for v0.2; an oversize Snapshot cannot dispatch and must be reduced explicitly.
- At least one item with `authority === "TASK_INSTRUCTION"` must exist; the P0 frozen task instruction remains authoritative over lower-priority contextual material.
- Historical v1 records remain parseable for Run history. New production real-Agent dispatch emits/requires v2; v1 remains accepted only by explicitly configured fixture tests during transition.

This bundle is transport data inside an immutable request, not a new persisted domain entity and not a second source of truth.

## Provider-neutral boundary

The runner receives already-validated values and returns transport evidence, not domain conclusions:

```ts
interface LocalCliInvocation {
  readonly executable: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdin?: string
  readonly timeoutMs: number
  readonly maxStdoutBytes: number
  readonly maxStderrBytes: number
  readonly environment: Readonly<Record<string, string>>
}

interface LocalCliResult {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly startedAt: string
  readonly finishedAt: string
}
```

Exact exported names may change during the pre-implementation contract review, but the separation and evidence are frozen.

## Security and process policy

- `spawn`/existing safe runner with argv arrays and `shell: false` only.
- Cwd equals the isolated worktree created by `Worker`; no additional writable directory.
- No sandbox/approval bypass flags.
- Prompt uses stdin when the CLI supports it; secrets never appear in argv.
- Inherit only an explicit environment allowlist plus provider-required auth variables. Never log values.
- Bound stdout and stderr independently; mark truncation.
- Abort/timeout terminates the process tree and returns distinguishable outcome.
- Parser rejects malformed, oversized or version-incompatible structured output.
- The adapter cannot write the source repository; it receives only the isolated worktree path.
- A request with `expectedRepositoryRevision.workingTreePatchHash !== null` is rejected before claim/worktree creation with `DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED`; v0.2 does not pretend that a base-commit-only worktree contains dirty source changes.

## Codex adapter v1

Verified local capability baseline on 2026-08-09:

- executable: `codex`
- version: `codex-cli 0.146.0`
- non-interactive command: `codex exec`
- relevant capabilities exposed by local help: `--cd`, `--sandbox workspace-write`, `--json`, `--output-schema`, `--ephemeral`, `--color never`.

DS-005 must capture the final tested argv and JSONL fixtures in its verification record. Unsupported major/capability combinations fail closed with `AGENT_VERSION_UNSUPPORTED`.

The prompt includes only the immutable task objective/non-goals/targets/acceptance criteria, materialized Snapshot items permitted by the request and output instructions. It tells the Agent to work only in the current worktree and not commit, push, modify branches or bypass safety.

Prompt assembly preserves item order and labels authority/priority/source boundaries. Context item content is delimited as untrusted project material; it cannot redefine process policy, output schema or sandbox rules.

The adapter result includes a normalized summary and transport diagnostics. Patch and verification artifacts remain generated independently by the Worker from the worktree and approved commands.

After the adapter returns, Worker verifies that the detached worktree still points to the requested base `HEAD` and has not acquired/switched a branch. Any Agent-authored commit or branch mutation maps to `AGENT_REPOSITORY_STATE_VIOLATION`; Worker does not silently turn it into an empty or partial patch.

## Verification and initial budget

The Phase-2 production default that checks for `docs/phase2.md` is removed. After the repository-state guard, Worker stages/exports the isolated patch and runs the universal, argv-safe integrity check `git diff --cached --check` through its trusted Git runner.

- The result is persisted as verification evidence.
- Agent-emitted tool/test events are bounded diagnostics, not independent acceptance evidence.
- v0.2 does not execute arbitrary commands read from repository files, Task text or Renderer input.
- A repository-specific verification plan is an Enhancement requiring its own sandbox and explicit authorization proposal.

The initial Main-owned production profile requests `maxDurationMs = 900_000`, `maxToolCalls = 100`, and `maxDiskBytes = 1_000_000_000`. Worker enforces elapsed time and counts recognized Codex tool events. An unsupported event stream cannot silently bypass a hard budget.

## Error taxonomy

At minimum:

- `AGENT_EXECUTABLE_NOT_FOUND`
- `AGENT_VERSION_UNSUPPORTED`
- `AGENT_AUTH_REQUIRED`
- `AGENT_POLICY_REJECTED`
- `AGENT_OUTPUT_INVALID`
- `AGENT_OUTPUT_LIMIT_EXCEEDED`
- `AGENT_PROCESS_FAILED`
- `AGENT_REPOSITORY_STATE_VIOLATION`
- `AGENT_TIMED_OUT`
- `AGENT_CANCELLED`
- `DIRTY_REPOSITORY_EXECUTION_UNSUPPORTED`

Provider text is diagnostic detail; persisted control flow uses stable codes.

## Configuration

- `ExecutionRequest.agentConfiguration.provider === "codex-cli"` selects the production adapter.
- Model may be explicit or `configured-by-user`; the adapter must record the resolved/requested model evidence that the CLI safely exposes.
- Provider selection is not controlled through arbitrary executable/argv fields from Renderer.
- No provider profile database is introduced in v0.2.

## Testing strategy

1. Fake executable fixtures validate argv, stdin, output bounds, timeout, cancellation and error mapping without credentials.
2. Parser fixtures cover normal JSONL, unknown events, malformed lines, truncation and version mismatch.
3. ExecutionRequest v2 fixtures cover canonical bundle hashing, item tampering, outer-hash tampering, missing task instruction, non-contiguous positions, byte/item caps and v1 history compatibility.
4. Temporary Git integration proves original repository isolation, unchanged worktree `HEAD` and patch export; a fake Agent commit is rejected.
5. The production verification fixture proves the Phase-2 `docs/phase2.md` check is absent and `git diff --cached --check` is recorded.
6. An opt-in authenticated smoke runs only when explicitly enabled and must use a temporary repository/worktree.
7. CI never requires a personal subscription or secret to pass the deterministic suite.

## Rejected alternatives

1. **Parse plain final prose only:** too weak for stable event/error evidence.
2. **Allow arbitrary executable/argv in ExecutionRequest:** converts Renderer/project data into process authority.
3. **Run with bypass permissions:** defeats the Worker's isolation policy.
4. **Automatically fall back to Fixture:** can present a fake success as a real execution.
5. **Implement Codex and Claude simultaneously:** hides the first adapter's real contract gaps and doubles unstable surface area.

## Non-goals

- Checkpoint/resume or session continuation;
- provider fallback/routing;
- remote API adapter;
- dynamic tool catalog and ToolInvocation persistence;
- repository-defined arbitrary verification commands;
- price accounting beyond transport evidence available from the provider;
- concurrent multi-Agent execution.
