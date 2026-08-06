# `@canvas-agent/worker-runtime`

Isolated Worker runtime prototype. **Owned by DeepSeek V4 Flash / DS-002.**

Implements the smallest real Worker loop: accept an immutable `ExecutionRequest`,
validate it (schema, SHA-256 request hash, expiry, capability subset), verify the
repository revision, create an isolated Git worktree under a caller-supplied runtime
directory, run a deterministic `AgentAdapter`, execute allowlisted verification
commands, and return patch / test / summary artifacts without mutating the source
workspace.

## Guarantees

- Never runs in the source working tree; all work happens in a detached worktree.
- Never uses `exec`, `shell: true`, or interpolated command strings. Every process is
  spawned with an argv array and a command allowlist.
- Rejects a revision mismatch before any worktree or Agent process is started.
- Single-claim guard (compare-and-set) so the same request runs only once.
- Stops at budget or cancellation boundaries and returns explicit partial evidence
  plus `recovery/` metadata.
- Git subprocesses run with an isolated config (`GIT_CONFIG_GLOBAL/SYSTEM=/dev/null`
  and fixed author identity) so execution never depends on global Git config.

## Subprocess entry points

The only process launcher is `runCommand` in `src/process-runner.ts`
(`child_process.spawn` with `shell: false`). Every invocation goes through it:

| Entry point | Trigger | Allowlist check |
|---|---|---|
| `git rev-parse HEAD`, `HEAD^{tree}` | revision verification (`src/revision.ts`) | `git` |
| `git diff HEAD`, `git ls-files --others` | working-tree patch hash | `git` |
| `git worktree add/remove --force` | isolated worktree lifecycle (`src/worktree.ts`) | `git` |
| `git add -A`, `git diff --cached HEAD` | patch export | `git` |
| adapter `runCommand` steps | `FixtureAgentAdapter` tool action | request `toolPolicy` + worker allowlist |
| `verificationCommands` | worker verification phase | worker command allowlist |

Command allowlists are explicit argv-0 allowlists supplied by the caller in
`WorkerConfig.commandAllowlist`; anything else throws `CommandDeniedError`.

## Usage

```ts
import { createWorker, FixtureAgentAdapter, createInMemoryClaimStore } from '@canvas-agent/worker-runtime'

const worker = createWorker({
  runtimeDirectory: '/path/to/runtime',
  sourceRepositoryPath: '/path/to/source-repo',
  capabilities: ['git', 'node'],
  commandAllowlist: ['git', 'node'],
  verificationCommands: [['node', 'test/run.mjs']],
  agent: new FixtureAgentAdapter({ steps: [], summary: 'no-op' }),
  claimStore: createInMemoryClaimStore()
})

const result = await worker.dispatch({ request }) // validated ExecutionRequestContract
```

## Verification

```bash
pnpm --filter @canvas-agent/worker-runtime typecheck
pnpm --filter @canvas-agent/worker-runtime test
pnpm check
```
