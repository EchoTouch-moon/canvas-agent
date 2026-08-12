# DS-002: Build the isolated Worker runtime prototype

## Task owner

DeepSeek V4 Flash — no visual work. Start only after DS-001 is integrated or the architect explicitly unblocks it.

## Task goal

Implement the smallest real Worker loop that accepts an immutable `ExecutionRequest`, validates it, creates an isolated Git worktree, runs a fake or explicitly configured Agent adapter, executes approved verification commands and returns patch/test/summary artifacts without mutating the user's original workspace.

## Background and context

The Worker is replaceable execution infrastructure, not the owner of project state. It must not query the application database to guess the latest Task, Baseline or Snapshot. The request and referenced frozen content are its contract.

Read first:

- `CONTRIBUTING.md`
- `docs/architecture/implementation-baseline-v0.1.md`
- `canvas_agent_design_baseline_v1.1/03_上下文与执行架构.md` sections 3–5
- `packages/contracts/src/execution-request.ts`
- `packages/domain/src/invariants.ts`

## Current code foundation

- Owned package placeholder: `packages/worker-runtime/`
- Execution request Zod schema: `@canvas-agent/contracts`
- Process decision: Electron Utility Process will host this package later
- MVP workspace strategy: `ISOLATED_WORKTREE` only

## Implementation scope

You may create or modify only:

- `packages/worker-runtime/**`
- `pnpm-lock.yaml` as an automatic dependency result

Implement:

1. request validation: schema, SHA-256 request hash, expiry, capability subset and single-claim guard;
2. repository revision verification for base commit/tree/working patch hash;
3. isolated worktree creation under a caller-supplied runtime directory;
4. `AgentAdapter` interface and deterministic `FixtureAgentAdapter` for tests;
5. safe process runner using argv arrays, `shell: false`, timeouts, cancellation and bounded output capture;
6. patch export, verification command results and Agent summary artifact descriptors;
7. cleanup/recovery metadata when the process is interrupted;
8. integration tests against a temporary Git repository.

## Prohibited scope

- Do not modify application database rows directly.
- Do not implement a Codex/Claude/DeepSeek-specific adapter yet.
- Do not add arbitrary shell strings, remote queues, Docker, distributed leases or automatic patch application.
- Do not invent final RunEvent, ToolInvocation, Checkpoint or Artifact lifecycles.
- Do not change frozen contracts without architecture review.

## Design constraints

- Never run in the source working tree.
- Never use `exec`, `shell: true` or interpolate user content into a command string.
- Reject revision mismatch before an Agent starts.
- Validate allowed tools/paths before each adapter action exposed by this prototype.
- Stop at budget or cancellation boundaries and return explicit partial evidence.
- Test fixtures may create temporary repositories but may not depend on global Git config.

## Acceptance criteria

1. **Given** a request with a bad hash, expired timestamp or missing capability, **when** claimed, **then** it is rejected before a worktree or process is created.
2. **Given** a repository revision mismatch, **when** dispatched, **then** the original repository remains unchanged and the mismatch is reported.
3. **Given** a valid fixture request, **when** executed, **then** only the isolated worktree changes and the result includes a patch, command exit data and summary hashes.
4. **Given** a timed-out or cancelled verification process, **then** its process tree is stopped and a bounded partial result is returned.
5. **Given** the same request is claimed twice, **then** only one claim succeeds.

## Required verification

```bash
pnpm --filter @canvas-agent/worker-runtime typecheck
pnpm --filter @canvas-agent/worker-runtime test
pnpm check
```

## Output requirements

Return the standard handoff contract and explicitly list all subprocess entry points, command allowlists and cleanup guarantees.
